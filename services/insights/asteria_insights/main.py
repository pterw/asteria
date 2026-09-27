"""The insights service.

Three endpoints, and the shape of all three follows from one decision: the app must work
when this process is not running. Every expensive thing here — the rhythm arithmetic, the
atlas layout — has an in-process equivalent in TypeScript, so this service is an
optimisation and never a dependency. It is also why the answer to "the service is down" is
a logged fallback rather than an error page.

* ``GET  /health``  — liveness plus whether signing is configured. No secrets, ever.
* ``POST /insights`` — rhythm analytics for metadata-only moments. Signed.
* ``POST /atlas``   — the whole printable journal as one HTML document. Signed.

Requests are verified against the raw body before the body is parsed, which is why these
handlers take ``Request`` rather than a Pydantic parameter: a framework that validates the
body for you has parsed it before your signature check could run, and by then the bytes
that were signed no longer exist.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import ValidationError

from .analytics import compute_analytics
from .atlas import SERVICE_VERSION, render_atlas
from .models import AtlasRequest, HealthResponse, InsightsRequest, as_moment_dicts, parse_now
from .signing import SIGNATURE_HEADER, TIMESTAMP_HEADER, SignatureError, secret, verify

logger = logging.getLogger("asteria.insights")

STARTED_AT = time.time()

app = FastAPI(
    title="Asteria insights",
    description="Rhythm analytics and atlas rendering for the Asteria observatory.",
    version=SERVICE_VERSION,
    docs_url="/docs",
    redoc_url=None,
)


def _invalid(error: ValidationError) -> JSONResponse:
    """422, with the offending field and never its value.

    Because the body is parsed here rather than by FastAPI (so that the signature is
    checked first), Pydantic's error has to be turned into a response by hand. Only the
    location, the rule and the message survive: a validation error on a journal's text must
    not echo that text back through a log or a public endpoint.
    """
    details = [
        {"field": ".".join(str(part) for part in item["loc"]), "rule": item["type"], "message": item["msg"]}
        for item in error.errors(include_url=False, include_input=False, include_context=False)
    ]
    logger.warning("refused an invalid body: %s", details)
    return JSONResponse(
        {"error": "The request body does not match the agreed contract.", "details": details},
        status_code=422,
    )


def _refused(error: SignatureError) -> JSONResponse:
    # The reason is safe to return (it never echoes the secret or the expected digest) and
    # it is the difference between a five-minute debugging session and an afternoon.
    logger.warning("refused a request: %s", error.reason)
    return JSONResponse({"error": error.reason}, status_code=error.status)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    configured = secret() is not None
    return HealthResponse(
        status="ok" if configured else "unconfigured",
        signing="configured" if configured else "missing",
        uptimeSeconds=int(time.time() - STARTED_AT),
    )


@app.get("/", include_in_schema=False)
async def root() -> dict[str, Any]:
    return {
        "service": "asteria-insights",
        "version": SERVICE_VERSION,
        "endpoints": ["/health", "/insights", "/atlas"],
        "note": "Signed POST endpoints. The app falls back to a local implementation when this service is unavailable.",
    }


@app.post("/insights")
async def insights(request: Request) -> JSONResponse:
    body = await request.body()
    try:
        # The *observed* path is what gets signed, not a constant: if a proxy ever rewrites
        # the route, the signature stops matching and the failure is loud instead of a
        # silently unprotected endpoint.
        verify(
            path=request.url.path,
            body=body,
            signature=request.headers.get(SIGNATURE_HEADER),
            timestamp=request.headers.get(TIMESTAMP_HEADER),
        )
    except SignatureError as error:
        return _refused(error)

    try:
        payload = InsightsRequest.model_validate_json(body)
    except ValidationError as error:
        return _invalid(error)

    analytics = compute_analytics(
        as_moment_dicts(payload.moments),
        time_zone=payload.timeZone,
        now=parse_now(payload.now),
        include_examples=payload.includeExamples,
    )
    return JSONResponse({"analytics": analytics, "source": "service"})


@app.post("/atlas", response_class=HTMLResponse)
async def atlas(request: Request) -> Any:
    body = await request.body()
    try:
        verify(
            path=request.url.path,
            body=body,
            signature=request.headers.get(SIGNATURE_HEADER),
            timestamp=request.headers.get(TIMESTAMP_HEADER),
        )
    except SignatureError as error:
        return _refused(error)

    try:
        payload = AtlasRequest.model_validate_json(body)
    except ValidationError as error:
        return _invalid(error)

    document = render_atlas(
        {
            "moments": [moment.model_dump() for moment in payload.moments],
            "timeZone": payload.timeZone,
            "title": payload.title,
            "now": payload.now,
        }
    )
    # HTML (not JSON) so a browser can open the signed response directly, and so the app's
    # `remote.html` path is the same string a person would see.
    return HTMLResponse(document, headers={"x-asteria-renderer": "service"})
