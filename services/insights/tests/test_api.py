"""The endpoints, exercised the way the app and an attacker would call them.

The interesting tests are the refusals. A signed endpoint that accepts a stale request, a
request aimed at a different path, or the same request twice is a public compute endpoint
with extra steps, so each of those has a test here rather than a comment.
"""

from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

from asteria_insights.analytics import MOOD_KEYS
from asteria_insights.main import app
from asteria_insights.signing import SIGNATURE_HEADER, TIMESTAMP_HEADER, sign

SECRET = "test-secret-for-the-insights-service"
MOMENTS = [
    {"id": f"m{index}", "mood": MOOD_KEYS[index % len(MOOD_KEYS)], "intensity": (index % 5) + 1,
     "createdAt": f"2026-03-{index + 1:02d}T22:0{index % 10}:00.000Z", "favorite": index == 0}
    for index in range(9)
]


@pytest.fixture(autouse=True)
def _secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASTERIA_INSIGHTS_SECRET", SECRET)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def signed_headers(path: str, body: bytes, *, secret: str = SECRET, at: float | None = None) -> dict[str, str]:
    timestamp = str(int(at if at is not None else time.time()))
    return {
        "content-type": "application/json",
        "x-asteria-timestamp": timestamp,
        SIGNATURE_HEADER: sign(secret, timestamp, path, body),
    }


def test_health_reports_configuration_without_leaking_it(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["signing"] == "configured"
    assert SECRET not in json.dumps(payload)


def test_health_admits_when_signing_is_missing(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ASTERIA_INSIGHTS_SECRET", raising=False)
    payload = client.get("/health").json()
    assert payload == {**payload, "status": "unconfigured", "signing": "missing"}


def test_insights_answers_a_signed_request(client: TestClient) -> None:
    body = json.dumps({"timeZone": "America/Toronto", "moments": MOMENTS}).encode()
    response = client.post("/insights", content=body, headers=signed_headers("/insights", body))
    assert response.status_code == 200, response.text
    analytics = response.json()["analytics"]
    assert analytics["totals"]["moments"] == 9
    assert len(analytics["weekdays"]) == 7 and len(analytics["hours"]) == 24
    assert sum(mood["count"] for mood in analytics["moods"]) == 9


def test_unsigned_requests_are_refused(client: TestClient) -> None:
    body = json.dumps({"moments": MOMENTS}).encode()
    assert client.post("/insights", content=body).status_code == 401


def test_a_wrong_secret_is_refused(client: TestClient) -> None:
    body = json.dumps({"moments": MOMENTS}).encode()
    headers = signed_headers("/insights", body, secret="not-the-secret")
    assert client.post("/insights", content=body, headers=headers).status_code == 401


def test_a_stale_request_is_refused(client: TestClient) -> None:
    body = json.dumps({"moments": MOMENTS}).encode()
    headers = signed_headers("/insights", body, at=time.time() - 3_600)
    response = client.post("/insights", content=body, headers=headers)
    assert response.status_code == 401
    assert "signing window" in response.json()["error"]


def test_a_signature_for_one_path_cannot_be_aimed_at_another(client: TestClient) -> None:
    """The destination is part of the signed string, so an atlas signature is not an insights key."""
    body = json.dumps({"moments": MOMENTS, "title": "Kept"}).encode()
    headers = signed_headers("/atlas", body)  # signed for /atlas...
    response = client.post("/insights", content=body, headers=headers)  # ...used on /insights
    assert response.status_code == 401
    assert "does not match" in response.json()["error"]


def test_the_same_signed_request_is_refused_the_second_time(client: TestClient) -> None:
    body = json.dumps({"moments": MOMENTS}).encode()
    headers = signed_headers("/insights", body)
    first = client.post("/insights", content=body, headers=headers)
    second = client.post("/insights", content=body, headers=headers)
    assert first.status_code == 200
    assert second.status_code == 401
    assert "already been processed" in second.json()["error"]


def test_a_tampered_body_is_refused(client: TestClient) -> None:
    body = json.dumps({"moments": MOMENTS}).encode()
    headers = signed_headers("/insights", body)
    tampered = json.dumps({"moments": MOMENTS + [{"id": "x", "mood": "serene", "intensity": 3}]}).encode()
    assert client.post("/insights", content=tampered, headers=headers).status_code == 401


def test_an_unknown_time_zone_is_a_validation_error(client: TestClient) -> None:
    body = json.dumps({"timeZone": "Mars/Olympus", "moments": MOMENTS}).encode()
    response = client.post("/insights", content=body, headers=signed_headers("/insights", body))
    assert response.status_code == 422


def test_atlas_returns_one_self_contained_document(client: TestClient) -> None:
    body = json.dumps(
        {
            "title": "A year of small lights",
            "timeZone": "America/Toronto",
            "moments": [
                {
                    **moment,
                    "title": "A walk after rain",
                    "content": "The street smelled of wet stone and I took the long way home.",
                    "x": 10.5 * index,
                    "y": -8.0 * index,
                }
                for index, moment in enumerate(MOMENTS)
            ],
        }
    ).encode()
    response = client.post("/atlas", content=body, headers=signed_headers("/atlas", body))
    assert response.status_code == 200, response.text
    document = response.text
    assert document.startswith("<!doctype html>")
    assert "A year of small lights" in document
    assert "A walk after rain" in document
    assert "<svg" in document and "<circle" in document
    assert "http://" not in document and "https://" not in document  # nothing to fetch
    assert "<script" not in document  # nothing to run


def test_atlas_escapes_anything_a_writer_could_type(client: TestClient) -> None:
    """The app sanitises on the way in; the renderer escapes anyway, because it must not have to know."""
    body = json.dumps(
        {
            "timeZone": "UTC",
            "moments": [
                {
                    "id": "one",
                    "title": '<img src=x onerror="alert(1)">',
                    "content": "<script>alert('x')</script> & a fine afternoon",
                    "mood": "serene",
                    "intensity": 3,
                    "createdAt": "2026-03-04T20:00:00.000Z",
                    "x": 0,
                    "y": 0,
                }
            ],
        }
    ).encode()
    response = client.post("/atlas", content=body, headers=signed_headers("/atlas", body))
    document = response.text
    assert "<script>alert" not in document
    assert "<img src=x" not in document
    assert "&lt;script&gt;" in document and "&amp; a fine afternoon" in document
