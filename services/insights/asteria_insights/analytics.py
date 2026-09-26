"""The shape of a journal, from metadata alone.

This is a port of ``src/lib/analytics.ts``, and it is a port on purpose: the numbers a
writer sees in the app and the numbers baked into an exported atlas must be the same
numbers. That is only true if both implementations agree exactly, so the rules are
written down where they cannot drift:

* **Never the writing.** The input is ids, feelings, brightnesses and instants. No title,
  no body, not one word of the journal ever reaches this process. That is what makes it
  acceptable to send a journal's shape to a second service at all, and it is why the
  payload is small enough to be honest about.
* **Integers, not floats.** Every derived ratio is a scaled integer (``shareBps`` =
  basis points, ``avgIntensityX100``, ``medianGapDaysX10``). Two languages do not agree
  on how to round a half or how to print ``0.1``. Integers let
  ``contract/analytics.json`` be compared by equality, from both sides, on every run.
* **Half-up rounding** (``floor(x + 0.5)``), matching JavaScript's ``Math.round`` for
  non-negative values. Python's built-in ``round`` is banker's rounding — it would
  disagree on exactly the ties that matter, so it is never used here.
* **A rhythm, never a score.** There is no completion percentage and no target. A run
  that ended yesterday still counts as running, because absence costs nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import floor
from typing import Any, Iterable, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# The six feelings, in the order the interface draws them (see src/lib/moods.ts).
MOOD_KEYS: tuple[str, ...] = ("luminous", "tender", "serene", "electric", "verdant", "vesper")

MOOD_LABELS: dict[str, str] = {
    "luminous": "Luminous",
    "tender": "Tender",
    "serene": "Serene",
    "electric": "Electric",
    "verdant": "Verdant",
    "vesper": "Vesper",
}

MOOD_HEX: dict[str, str] = {
    "luminous": "#e6c88d",
    "tender": "#dca8b7",
    "serene": "#9dbdd6",
    "electric": "#b8a2da",
    "verdant": "#a2c6ab",
    "vesper": "#8f9ed6",
}


@dataclass(frozen=True)
class _Dated:
    """A moment once it is known to be usable: parseable, and of a known feeling."""

    id: str
    mood: str
    intensity: int
    created_at: str
    day: str
    hour: int
    favorite: bool


def scaled(value: float, factor: int | float) -> int:
    """Half-up rounding to an integer, the rule both implementations follow."""
    return floor(value * factor + 0.5)


def _zone(time_zone: str) -> ZoneInfo:
    try:
        return ZoneInfo(time_zone)
    except (ZoneInfoNotFoundError, ValueError):
        # An unknown zone is the caller's mistake, but a wrong *day key* is silent
        # corruption, so fall back to UTC rather than guessing an offset.
        return ZoneInfo("UTC")


def parse_instant(value: Any) -> datetime | None:
    """Parse what the wire can carry, or ``None``.

    Accepts ISO-8601 (with ``Z`` or an offset) and epoch milliseconds. Anything else is
    dropped rather than assumed, matching ``Number.isFinite(new Date(x).getTime())`` on
    the TypeScript side — a moment that cannot be placed in time must not be placed in
    the wrong night.
    """
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str) or not value:
        return None
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def day_key(instant: datetime, time_zone: str) -> str:
    """The local calendar day of an instant, as ``YYYY-MM-DD``."""
    return instant.astimezone(_zone(time_zone)).strftime("%Y-%m-%d")


def zoned_hour(instant: datetime, time_zone: str) -> int:
    """The local hour of an instant, 0–23."""
    return instant.astimezone(_zone(time_zone)).hour


def shift_day(day: str, days: int) -> str:
    anchor = datetime.strptime(day, "%Y-%m-%d").date()
    return (anchor + timedelta(days=days)).strftime("%Y-%m-%d")


def days_between(from_day: str, to_day: str) -> int:
    """Whole days between two day keys, parsed at noon so no zone can round them."""
    start = datetime.strptime(from_day, "%Y-%m-%d")
    end = datetime.strptime(to_day, "%Y-%m-%d")
    return int(round((end - start).total_seconds() / 86_400))


def weekday_index(day: str) -> int:
    """Monday-first weekday index, matching ISO-8601 and the calendar the app draws."""
    return datetime.strptime(day, "%Y-%m-%d").isoweekday() - 1


def collect_nights(moments: Sequence[dict[str, Any]], time_zone: str) -> list[str]:
    """Sorted, de-duplicated local nights written. Shared with the atlas renderer."""
    days = {
        day_key(instant, time_zone)
        for moment in moments
        if (instant := parse_instant(moment.get("createdAt"))) is not None
        and moment.get("mood") in MOOD_KEYS
    }
    return sorted(days)


def compute_analytics(
    moments: Iterable[dict[str, Any]],
    *,
    time_zone: str = "UTC",
    now: datetime | None = None,
    include_examples: bool = False,
) -> dict[str, Any]:
    """The same reading as ``computeAnalytics`` in TypeScript, to the digit."""
    now = now or datetime.now(timezone.utc)
    considered = list(moments)

    examples = sum(1 for moment in considered if moment.get("isSample"))
    if not include_examples:
        considered = [moment for moment in considered if not moment.get("isSample")]

    dated: list[_Dated] = []
    for moment in considered:
        mood = moment.get("mood")
        instant = parse_instant(moment.get("createdAt"))
        if mood not in MOOD_KEYS or instant is None:
            continue
        try:
            intensity = int(moment.get("intensity") or 0)
        except (TypeError, ValueError):
            intensity = 0
        dated.append(
            _Dated(
                id=str(moment.get("id") or ""),
                mood=str(mood),
                intensity=intensity,
                created_at=str(moment.get("createdAt")),
                day=day_key(instant, time_zone),
                hour=zoned_hour(instant, time_zone),
                favorite=bool(moment.get("favorite")),
            )
        )

    # Oldest first, ties broken by id: the same total order as the TypeScript sort.
    dated.sort(key=lambda moment: (moment.created_at, moment.id))

    today = day_key(now, time_zone)
    nights = sorted({moment.day for moment in dated})

    # ── cadence ─────────────────────────────────────────────────────────────────────
    current_run = 0
    cursor = today
    if cursor not in nights:
        cursor = shift_day(cursor, -1)
    while cursor in nights:
        current_run += 1
        cursor = shift_day(cursor, -1)

    longest_run = 0
    running = 0
    previous: str | None = None
    gaps: list[int] = []
    for day in nights:
        if previous is None:
            running = 1
        else:
            difference = days_between(previous, day)
            if difference == 1:
                running += 1
            else:
                gaps.append(difference)
                running = 1
        longest_run = max(longest_run, running)
        previous = day

    median_gap_days_x10 = 0
    if gaps:
        ordered = sorted(gaps)
        middle = len(ordered) // 2
        median = (
            float(ordered[middle])
            if len(ordered) % 2 == 1
            else (ordered[middle - 1] + ordered[middle]) / 2
        )
        median_gap_days_x10 = scaled(median, 10)
    longest_gap_days = max(gaps) if gaps else 0

    month = today[:7]
    week_start = shift_day(today, -6)
    nights_this_month = sum(1 for day in nights if day.startswith(month))
    moments_this_week = sum(1 for moment in dated if week_start <= moment.day <= today)

    first_day = nights[0] if nights else None
    span_days = days_between(first_day, today) if first_day else 0
    if span_days > 0:
        density_bps = scaled((len(nights) / (span_days + 1)) * 10_000, 1)
    else:
        density_bps = 10_000 if nights else 0

    # ── shape ───────────────────────────────────────────────────────────────────────
    weekdays = [0] * 7
    hours = [0] * 24
    histogram = [0] * 6
    mood_counts = {key: {"count": 0, "intensity_sum": 0} for key in MOOD_KEYS}

    intensity_sum = 0
    brightest: dict[str, Any] | None = None
    per_night: dict[str, int] = {}

    for moment in dated:
        weekdays[weekday_index(moment.day)] += 1
        hours[moment.hour] += 1
        if 1 <= moment.intensity <= 5:
            histogram[moment.intensity] += 1
            intensity_sum += moment.intensity
        mood_counts[moment.mood]["count"] += 1
        mood_counts[moment.mood]["intensity_sum"] += moment.intensity
        per_night[moment.day] = per_night.get(moment.day, 0) + 1
        if brightest is None or moment.intensity > brightest["intensity"]:
            brightest = {
                "id": moment.id,
                "mood": moment.mood,
                "intensity": moment.intensity,
                "day": moment.day,
            }

    flow_map: dict[tuple[str, str], int] = {}
    for index in range(1, len(dated)):
        key = (dated[index - 1].mood, dated[index].mood)
        flow_map[key] = flow_map.get(key, 0) + 1
    flow = [
        {"from": pair[0], "to": pair[1], "count": count}
        for pair, count in sorted(flow_map.items(), key=lambda item: (-item[1], item[0][0], item[0][1]))
    ]

    busiest_night: dict[str, Any] | None = None
    for day, count in sorted(per_night.items()):
        if busiest_night is None or count > busiest_night["count"]:
            busiest_night = {"day": day, "count": count}

    longest_gap: dict[str, Any] | None = None
    for index in range(1, len(nights)):
        days = days_between(nights[index - 1], nights[index])
        if longest_gap is None or days > longest_gap["days"]:
            longest_gap = {"from": nights[index - 1], "to": nights[index], "days": days}

    total = len(dated)
    moods = [
        {
            "key": key,
            "count": mood_counts[key]["count"],
            "shareBps": scaled((mood_counts[key]["count"] / total) * 10_000, 1) if total else 0,
            "avgIntensityX100": (
                scaled(mood_counts[key]["intensity_sum"] / mood_counts[key]["count"], 100)
                if mood_counts[key]["count"]
                else 0
            ),
        }
        for key in MOOD_KEYS
    ]

    return {
        "generatedAt": now.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "timeZone": time_zone,
        "range": {"firstDay": first_day, "lastDay": nights[-1] if nights else None, "spanDays": span_days},
        "totals": {
            "moments": total,
            "nights": len(nights),
            "constellations": sum(1 for mood in moods if mood["count"] > 0),
            "starred": sum(1 for moment in dated if moment.favorite),
            "examples": examples,
        },
        "cadence": {
            "currentRun": current_run,
            "longestRun": longest_run,
            "medianGapDaysX10": median_gap_days_x10,
            "longestGapDays": longest_gap_days,
            "nightsThisMonth": nights_this_month,
            "momentsThisWeek": moments_this_week,
            "densityBps": density_bps,
        },
        "weekdays": weekdays,
        "hours": hours,
        "moods": moods,
        "intensity": {
            "averageX100": scaled(intensity_sum / total, 100) if total else 0,
            "histogram": histogram,
        },
        "flow": flow[:18],
        "notable": {
            "brightest": brightest,
            "busiestNight": busiest_night,
            "longestGap": longest_gap,
            "firstMoment": (
                {"id": dated[0].id, "day": dated[0].day} if dated else None
            ),
        },
    }
