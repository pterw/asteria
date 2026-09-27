"""The atlas: a journal you can keep, printed as one self-contained document.

An export that needs a CDN, a font server or a running app is not an export — it is a
bookmark. This renderer emits a single file with inline SVG and inline CSS, no external
requests of any kind, which will still open on a laptop in ten years with the network off.
That constraint is the reason the Python service exists at all: it can afford to lay out a
whole document, with the rhythm arithmetic woven into it, where the in-process TypeScript
fallback has to stay small enough to run inside a request it is already late for.

What it renders, and why each part earns its space:

* **The sky** — the writer's own stars, threaded into constellations by the same rule the
  app uses (each star joins the nearest earlier star of its own feeling). Positions come
  from the app; if they are missing the service lays the sky out itself rather than
  drawing an empty box.
* **The rhythm** — weekday bars and a night-by-night grid, so a year of writing is
  visible at a glance without reading a number.
* **The feelings** — counts, shares and average brightness per feeling.
* **The nights** — every moment, in order, grouped by the night it belongs to.

Everything a writer typed is escaped here, even though the app sanitises on the way in:
the service does not get to assume anything about its input, and this is the last place a
journal's text is handled before it becomes a document.
"""

from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

from .analytics import (
    MOOD_HEX,
    MOOD_KEYS,
    MOOD_LABELS,
    collect_nights,
    compute_analytics,
    day_key,
    parse_instant,
    shift_day,
    weekday_index,
)

WEEKDAY_LABELS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
SERVICE_VERSION = "1.0.0"

# A year of cells is already more sky than a page can hold; beyond that, the grid shows the
# most recent stretch and says so, instead of shrinking each night into a dust mote.
CALENDAR_CELL_LIMIT = 371


def _escape(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def _percent(bps: int) -> str:
    return f"{bps / 100:.0f}%" if bps % 100 == 0 else f"{bps / 100:.2f}%"


def _scaled(value: int, factor: int, digits: int = 1) -> str:
    return f"{value / factor:.{digits}f}"


def _phyllotaxis(index: int, spread: float = 1.0) -> tuple[float, float]:
    """Golden-angle placement, used only when the app did not send coordinates."""
    from math import cos, sin, sqrt

    angle = index * 2.399963
    radius = (17 + sqrt(index + 1) * 21) * spread
    return cos(angle) * radius, sin(angle) * radius * 0.68


def _drawable(moments: Sequence[dict[str, Any]], time_zone: str) -> list[dict[str, Any]]:
    """Moments that can be drawn: placed in time, of a known feeling, not an example."""
    placed: list[dict[str, Any]] = []
    fallback_index = 0
    for moment in moments:
        if moment.get("isSample") or moment.get("mood") not in MOOD_KEYS:
            continue
        instant = parse_instant(moment.get("createdAt"))
        if instant is None:
            continue
        x, y = moment.get("x"), moment.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            x, y = _phyllotaxis(fallback_index)
            fallback_index += 1
        placed.append(
            {
                "instant": instant,
                "id": str(moment.get("id") or ""),
                "title": str(moment.get("title") or ""),
                "content": str(moment.get("content") or ""),
                "mood": str(moment["mood"]),
                "intensity": int(moment.get("intensity") or 0),
                "day": day_key(instant, time_zone),
                "favorite": bool(moment.get("favorite")),
                "x": float(x),
                "y": float(y),
            }
        )
    # Oldest first, ties broken by id: the same total order as the app's own sky.
    placed.sort(key=lambda moment: (moment["instant"], moment["id"]))
    return placed


def _sky_svg(stars: Sequence[dict[str, Any]], *, width: int = 900) -> str:
    if not stars:
        return (
            '<svg class="sky" viewBox="0 0 400 220" role="img" aria-label="An empty sky">'
            '<rect x="0" y="0" width="400" height="220" fill="#07080d"/>'
            '<text x="200" y="114" text-anchor="middle" fill="#7d88a8" '
            'font-family="ui-sans-serif, system-ui, sans-serif" font-size="12">'
            "No moments yet — the sky is waiting.</text></svg>"
        )

    xs = [star["x"] for star in stars]
    ys = [star["y"] for star in stars]
    min_x, max_x = min(xs) - 60.0, max(xs) + 60.0
    min_y, max_y = min(ys) - 60.0, max(ys) + 60.0
    span_x = max(320.0, max_x - min_x)
    span_y = max(320.0, max_y - min_y)

    # Each star threads to the nearest *earlier* star of its own feeling — the same rule the
    # live sky uses, so an exported sky and the app's sky are recognisably the same place.
    threads: list[str] = []
    for mood in MOOD_KEYS:
        members = [star for star in stars if star["mood"] == mood]
        for index in range(1, len(members)):
            best, best_distance = 0, float("inf")
            for candidate in range(index):
                distance = (
                    (members[index]["x"] - members[candidate]["x"]) ** 2
                    + (members[index]["y"] - members[candidate]["y"]) ** 2
                ) ** 0.5
                if distance < best_distance:
                    best_distance, best = distance, candidate
            threads.append(
                f'<line x1="{members[best]["x"]:.1f}" y1="{members[best]["y"]:.1f}" '
                f'x2="{members[index]["x"]:.1f}" y2="{members[index]["y"]:.1f}" '
                f'stroke="{MOOD_HEX[mood]}" stroke-opacity="0.28" stroke-width="0.7"/>'
            )

    points = "".join(
        f'<circle cx="{star["x"]:.1f}" cy="{star["y"]:.1f}" '
        f'r="{1.1 + star["intensity"] * 0.5:.2f}" fill="{MOOD_HEX[star["mood"]]}">'
        f'<title>{_escape(star["title"] or star["content"][:24] or "A moment")} — {_escape(star["day"])}'
        f"</title></circle>"
        for star in stars
    )

    return (
        f'<svg class="sky" viewBox="{min_x:.0f} {min_y:.0f} {span_x:.0f} {span_y:.0f}" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="Your sky: {len(stars)} stars across {len({s["day"] for s in stars})} nights" '
        f'style="width:{width}px">'
        f'<rect x="{min_x:.0f}" y="{min_y:.0f}" width="{span_x:.0f}" height="{span_y:.0f}" fill="#07080d"/>'
        f'{"".join(threads)}{points}</svg>'
    )


def _weekday_bars(weekdays: Iterable[int]) -> str:
    counts = list(weekdays)
    peak = max(counts) or 1
    rows = []
    for index, count in enumerate(counts):
        height = 4 + (count / peak) * 40
        rows.append(
            f'<div class="bar"><span class="bar-fill" style="height:{height:.1f}px"></span>'
            f'<span class="bar-count">{count or ""}</span>'
            f'<span class="bar-label">{WEEKDAY_LABELS[index]}</span></div>'
        )
    return f'<div class="bars">{"".join(rows)}</div>'


def _calendar(nights: Sequence[str], *, today: str) -> str:
    if not nights:
        return '<p class="muted">No nights to show yet.</p>'
    last = max(nights[-1], today)
    first = nights[0]
    # Grow the window backwards until it covers the limit, so the grid never exceeds it.
    start = first
    span = (datetime.strptime(last, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")).days + 1
    if span > CALENDAR_CELL_LIMIT:
        start = shift_day(last, -(CALENDAR_CELL_LIMIT - 1))
        span = CALENDAR_CELL_LIMIT
    written = set(nights)

    cells = ['<span class="cell blank"></span>'] * weekday_index(start)
    day = start
    for _ in range(span):
        cells.append(
            f'<span class="cell{" is-on" if day in written else ""}" title="{day}"></span>'
        )
        day = shift_day(day, 1)

    caption = ""
    if first != start:
        caption = f'<p class="muted small">Showing the most recent {span} days (your first night was {first}).</p>'
    return (
        f'<div class="calendar" aria-hidden="true">{"".join(cells)}</div>{caption}'
    )


def _stat_cards(analytics: dict[str, Any]) -> str:
    cadence = analytics["cadence"]
    totals = analytics["totals"]
    cards = [
        ("Nights written", str(totals["nights"]), f"across {totals['moments']} moments"),
        ("Longest run", f"{cadence['longestRun']}", "consecutive nights"),
        (
            "Current run",
            f"{cadence['currentRun']}",
            "counting yesterday as today",
        ),
        (
            "Longest pause",
            f"{cadence['longestGapDays']}",
            "days between two nights",
        ),
        ("Written on", _percent(cadence["densityBps"]), "of the nights since you began"),
        (
            "Average brightness",
            _scaled(analytics["intensity"]["averageX100"], 100, 2),
            "of 5",
        ),
    ]
    return (
        '<div class="cards">'
        + "".join(
            f'<div class="card"><p class="card-label">{_escape(label)}</p>'
            f'<strong>{_escape(value)}</strong><p class="card-note">{_escape(note)}</p></div>'
            for label, value, note in cards
        )
        + "</div>"
    )


def _mood_rows(analytics: dict[str, Any]) -> str:
    rows = []
    for mood in analytics["moods"]:
        key = mood["key"]
        rows.append(
            f'<div class="mood"><span class="dot" style="background:{MOOD_HEX[key]}"></span>'
            f'<span class="mood-name">{_escape(MOOD_LABELS[key])}</span>'
            f'<span class="mood-count">{mood["count"]}</span>'
            f'<span class="mood-share"><span class="mood-share-fill" '
            f'style="width:{mood["shareBps"] / 100:.2f}%;background:{MOOD_HEX[key]}"></span></span>'
            f'<span class="mood-pct">{_percent(mood["shareBps"])}</span>'
            f'<span class="mood-avg">{_scaled(mood["avgIntensityX100"], 100)} / 5</span></div>'
        )
    return '<div class="moods">' + "".join(rows) + "</div>"


def _nights(stars: Sequence[dict[str, Any]]) -> str:
    by_night: dict[str, list[dict[str, Any]]] = {}
    for star in stars:
        by_night.setdefault(star["day"], []).append(star)

    sections: list[str] = []
    for day, moments in sorted(by_night.items()):
        # "Thursday 12 March 2026" — spelled out, because this document is meant to be read
        # in ten years by someone who should not have to decode a locale-dependent order.
        anchor = datetime.strptime(day, "%Y-%m-%d")
        label = f"{anchor.strftime('%A')} {anchor.day} {anchor.strftime('%B %Y')}"
        entries = []
        for moment in moments:
            title = moment["title"] or moment["content"][:60]
            entries.append(
                f'<article class="entry" style="--mood:{MOOD_HEX[moment["mood"]]}">'
                f'<h4>{_escape(title)}</h4>'
                f'<p class="entry-meta">{_escape(MOOD_LABELS[moment["mood"]])} · '
                f'brightness {moment["intensity"]}/5'
                f'{" · starred" if moment["favorite"] else ""}</p>'
                f'<p class="entry-body">{_escape(moment["content"])}</p></article>'
            )
        sections.append(
            f'<section class="night"><h3>{_escape(label)}'
            f'<span class="night-count">{len(moments)}</span></h3>{"".join(entries)}</section>'
        )
    return "".join(sections)


STYLE = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 48px 28px 72px; background: #07080d; color: #e9e7e2;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px; line-height: 1.65; }
.page { max-width: 900px; margin: 0 auto; }
header.top { border-bottom: 1px solid #ffffff14; padding-bottom: 24px; margin-bottom: 32px; }
.eyebrow { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 11px;
  letter-spacing: .22em; text-transform: uppercase; color: #dfc28d; margin: 0 0 10px; }
h1 { font-family: ui-serif, Georgia, "Times New Roman", serif; font-weight: 400;
  font-size: 40px; line-height: 1.15; margin: 0 0 10px; color: #f5f4ef; }
h2 { font-family: ui-serif, Georgia, serif; font-weight: 400; font-size: 24px; margin: 44px 0 14px; color: #f5f4ef; }
h3 { font-family: ui-serif, Georgia, serif; font-weight: 400; font-size: 19px; margin: 0 0 12px; color: #f5f4ef; }
h4 { font-size: 15px; margin: 0 0 4px; color: #f5f4ef; font-weight: 600; }
p { margin: 0 0 12px; }
.meta { color: #9499a8; font-size: 13px; margin: 0; }
.muted { color: #7d88a8; }
.small { font-size: 12px; }
.sky { display: block; width: 100%; height: auto; border: 1px solid #ffffff12; border-radius: 12px; background: #07080d; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.card { border: 1px solid #ffffff12; border-radius: 10px; padding: 14px 16px; background: #0c0e15; }
.card-label { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #9499a8; margin: 0 0 6px; }
.card strong { font-family: ui-serif, Georgia, serif; font-size: 26px; font-weight: 600; display: block; color: #f5f4ef; }
.card-note { font-size: 12px; color: #7d88a8; margin: 4px 0 0; }
.bars { display: flex; align-items: flex-end; gap: 14px; height: 74px; margin: 6px 0 10px; }
.bar { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
.bar-fill { width: 100%; max-width: 34px; background: linear-gradient(180deg, #dfc28d, #8c7442); border-radius: 3px 3px 0 0; }
.bar-count { font-size: 11px; color: #9499a8; margin-top: 4px; }
.bar-label { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #7d88a8; }
.calendar { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 11px); gap: 3px; margin-top: 10px; }
.cell { width: 11px; height: 11px; border-radius: 3px; background: #ffffff0d; display: block; }
.cell.is-on { background: #dfc28d; }
.cell.blank { background: transparent; }
.moods { border: 1px solid #ffffff12; border-radius: 10px; overflow: hidden; }
.mood { display: grid; grid-template-columns: 10px 92px 40px 1fr 54px 62px; align-items: center;
  gap: 10px; padding: 9px 14px; border-bottom: 1px solid #ffffff0a; font-size: 13px; }
.mood:last-child { border-bottom: none; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: block; }
.mood-name { color: #e9e7e2; }
.mood-count { color: #9499a8; font-variant-numeric: tabular-nums; }
.mood-share { height: 5px; border-radius: 3px; background: #ffffff0f; overflow: hidden; }
.mood-share-fill { display: block; height: 100%; border-radius: 3px; }
.mood-pct, .mood-avg { color: #7d88a8; font-size: 12px; font-variant-numeric: tabular-nums; text-align: right; }
.night { border-top: 1px solid #ffffff12; padding-top: 22px; margin-top: 26px; }
.night-count { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #7d88a8; margin-left: 10px; }
.entry { border-left: 2px solid var(--mood, #dfc28d); padding: 2px 0 2px 14px; margin: 0 0 18px; }
.entry-meta { font-family: ui-monospace, Menlo, monospace; font-size: 10px; letter-spacing: .1em;
  text-transform: uppercase; color: #9499a8; margin: 0 0 6px; }
.entry-body { white-space: pre-wrap; margin: 0; color: #dcdad4; }
footer { margin-top: 54px; border-top: 1px solid #ffffff12; padding-top: 18px; color: #7d88a8; font-size: 12px; }
@media print {
  :root { color-scheme: light; }
  body { background: #fff; color: #16171b; padding: 0; }
  h1, h2, h3, h4, .card strong { color: #16171b; }
  .eyebrow { color: #8a6d2f; }
  .sky { background: #0b0d14; border-color: #16171b22; }
  .card, .moods { border-color: #16171b22; background: #fff; }
  .entry-body { color: #26282e; }
  .meta, .muted, .card-note, .bar-label, .mood-pct, .mood-avg, .entry-meta { color: #5c6068; }
  footer { color: #5c6068; }
  .night { break-inside: avoid; }
}
"""


def render_atlas(payload: dict[str, Any]) -> str:
    """Render the whole document. Pure function of the payload — no I/O, no clock beyond it."""
    time_zone = str(payload.get("timeZone") or "UTC")
    title = str(payload.get("title") or "Your sky")
    moments = list(payload.get("moments") or [])
    now = parse_instant(payload.get("now")) or datetime.now(timezone.utc)

    analytics = compute_analytics(
        moments, time_zone=time_zone, now=now, include_examples=False
    )
    stars = _drawable(moments, time_zone)
    nights = collect_nights(moments, time_zone)
    today = day_key(now, time_zone)

    span = analytics["range"]
    if span["firstDay"]:
        covered = f'{span["firstDay"]} → {span["lastDay"]}'
    else:
        covered = "not started yet"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{_escape(title)} — Asteria atlas</title>
<style>{STYLE}</style>
</head>
<body>
<div class="page">
  <header class="top">
    <p class="eyebrow">Asteria · your observatory</p>
    <h1>{_escape(title)}</h1>
    <p class="meta">{analytics["totals"]["moments"]} moments · {analytics["totals"]["nights"]} nights ·
      {covered} · drawn {_escape(now.strftime("%d %B %Y"))} in {_escape(time_zone)}</p>
  </header>

  <section>
    <h2>The sky</h2>
    {_sky_svg(stars)}
  </section>

  <section>
    <h2>The rhythm</h2>
    {_stat_cards(analytics)}
    <h3 style="margin-top:26px">Which nights you write</h3>
    {_weekday_bars(analytics["weekdays"])}
    <h3 style="margin-top:26px">Every night, in order</h3>
    {_calendar(nights, today=today)}
  </section>

  <section>
    <h2>The feelings</h2>
    {_mood_rows(analytics)}
  </section>

  <section>
    <h2>The nights</h2>
    {_nights(stars) or '<p class="muted">No moments to read yet.</p>'}
  </section>

  <footer>
    <p>Rendered by the Asteria insights service (v{SERVICE_VERSION}) · one self-contained file,
      no external assets, no tracking. Keep it wherever you keep things you would miss.</p>
  </footer>
</div>
</body>
</html>
"""
