"""Contract tests: Python must agree with TypeScript, digit for digit.

`contract/analytics.json` is generated from the TypeScript implementation by
`scripts/emit-contract.ts` and checked in. TypeScript is asserted against it in
`tests/unit/analytics.contract.test.ts`; this file asserts the Python side. Neither
language is the reference — the file is — which is the only arrangement in which "the two
implementations agree" is a claim a test can actually make.

Run from the repository root:

    npm run test:python
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from asteria_insights.analytics import compute_analytics

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = json.loads((ROOT / "contract" / "fixtures.json").read_text(encoding="utf-8"))
EXPECTED = json.loads((ROOT / "contract" / "analytics.json").read_text(encoding="utf-8"))


def _case(case_id: str) -> dict:
    for entry in EXPECTED["cases"]:
        if entry["id"] == case_id:
            return entry
    raise AssertionError(f"no such contract case: {case_id}")


@pytest.mark.parametrize("case", EXPECTED["cases"], ids=lambda case: case["id"])
def test_python_matches_the_contract(case: dict) -> None:
    from datetime import datetime

    moments = [] if case["id"].startswith("nothing") else FIXTURES["moments"]
    produced = compute_analytics(
        moments,
        time_zone=case["timeZone"],
        now=datetime.fromisoformat(case["now"].replace("Z", "+00:00")),
        include_examples=case["includeExamples"],
    )
    # Reported as a diff so a failure names the field that drifted rather than dumping a
    # hundred lines of JSON the reader has to compare by eye.
    assert produced == case["expected"]


def test_fixtures_are_not_vacuous() -> None:
    """A contract everyone passes is worth nothing — this one has to have teeth."""
    toronto = _case("toronto")["expected"]
    with_examples = _case("toronto-with-examples")["expected"]
    kolkata = _case("kolkata")["expected"]
    nothing = _case("nothing-yet")["expected"]

    assert toronto["totals"]["moments"] == 10  # two examples and two unusable rows dropped
    assert toronto["totals"]["examples"] == 2
    assert with_examples["totals"]["moments"] == 12  # includeExamples changes the reading
    assert toronto["cadence"]["longestRun"] == 5
    assert toronto["cadence"]["longestGapDays"] == 14
    assert toronto["range"]["spanDays"] == 19
    assert toronto["intensity"]["histogram"][0] == 0  # brightness 0 is not in the histogram
    assert kolkata["hours"] != toronto["hours"]  # the zone really does move the buckets
    assert nothing["totals"]["moments"] == 0 and nothing["notable"]["brightest"] is None


def test_a_year_of_reading_is_still_one_definition() -> None:
    """Every case is read by both implementations, so the shapes must be identical."""
    for case in EXPECTED["cases"]:
        assert set(case["expected"]) == {
            "generatedAt",
            "timeZone",
            "range",
            "totals",
            "cadence",
            "weekdays",
            "hours",
            "moods",
            "intensity",
            "flow",
            "notable",
        }
