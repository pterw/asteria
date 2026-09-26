import { createHash } from "node:crypto";
import { MOODS, MOOD_KEYS } from "./moods";
import { escapeBlockquoteContent, escapeMarkdown, yamlScalar } from "./sanitize";
import { starTitle, type StarDto } from "./stars";
import { dayKey, formatDay, shortDay } from "./time";

/**
 * The export is a design surface, not a data dump.
 *
 * `DESIGN_AUDIT1.md` names the export file as the only Asteria artefact that outlives the
 * browser, and the three renderers here take that seriously:
 *
 * - **JSON** is the backup: versioned, checksummed, and free of anything that could be
 *   used to claim the journal. It carries no journal id, no session, no recovery key —
 *   a shared backup file cannot be used to take over the sky it came from.
 * - **Markdown** is the reading copy: YAML front matter a note-taking app can index,
 *   then one section per night, in the order the nights happened.
 * - **Atlas** is the keepsake: a single self-contained HTML document with the whole sky
 *   drawn as inline SVG, rendered by the Python service when it is reachable and by a
 *   local fallback when it is not. No external assets, so it still opens in ten years.
 */

export const EXPORT_VERSION = 3;

export interface ExportBundle {
  application: "Asteria";
  format: "asteria.journal";
  version: number;
  exportedAt: string;
  timeZone: string;
  summary: { moments: number; nights: number; first: string | null; last: string | null };
  checksum: string;
  moments: (StarDto & { day: string })[];
}

/**
 * A checksum over the moments that survives a round trip.
 *
 * It exists so an import can say "this file is intact" or "this file changed after it was
 * written" rather than silently accepting a truncated download. Only stable fields are
 * included: an id, an instant and the words. `updatedAt` is deliberately out, because it
 * moves when a star is merely starred.
 */
export function checksumMoments(moments: Pick<StarDto, "id" | "createdAt" | "mood" | "intensity" | "title" | "content">[]): string {
  const canonical = moments
    .map(moment =>
      [moment.id, moment.createdAt, moment.mood, moment.intensity, moment.title, moment.content].join("\u001f"),
    )
    .join("\u001e");
  return `sha256:${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}

export function buildBundle(moments: StarDto[], timeZone: string, now = new Date()): ExportBundle {
  const ordered = [...moments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const days = ordered.map(moment => dayKey(new Date(moment.createdAt), timeZone));
  return {
    application: "Asteria",
    format: "asteria.journal",
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    timeZone,
    summary: {
      moments: ordered.length,
      nights: new Set(days).size,
      first: days[0] ?? null,
      last: days[days.length - 1] ?? null,
    },
    checksum: checksumMoments(ordered),
    moments: ordered.map((moment, index) => ({ ...moment, day: days[index] })),
  };
}

/** The reading copy: front matter, then one section per night, oldest first. */
export function renderMarkdown(moments: StarDto[], { timeZone, now = new Date() }: { timeZone: string; now?: Date }): string {
  const ordered = [...moments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const bundle = buildBundle(ordered, timeZone, now);
  const byDay = new Map<string, StarDto[]>();
  for (const moment of ordered) {
    const key = dayKey(new Date(moment.createdAt), timeZone);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(moment);
    else byDay.set(key, [moment]);
  }

  const header = [
    "---",
    "application: Asteria",
    "format: asteria.journal",
    `version: ${EXPORT_VERSION}`,
    `exported: ${bundle.exportedAt}`,
    `timezone: ${yamlScalar(timeZone)}`,
    `checksum: ${bundle.checksum}`,
    `moments: ${bundle.summary.moments}`,
    `nights: ${bundle.summary.nights}`,
    bundle.summary.first ? `first-night: ${bundle.summary.first}` : null,
    bundle.summary.last ? `last-night: ${bundle.summary.last}` : null,
    "---",
    "",
    "# Asteria — your little lights",
    "",
    bundle.summary.moments === 1
      ? "One moment, kept."
      : `${bundle.summary.moments} moments across ${bundle.summary.nights} ${bundle.summary.nights === 1 ? "night" : "nights"}.`,
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const body = [...byDay.entries()]
    .map(([day, dayMoments]) => {
      const sections = dayMoments
        .map(moment => {
          const mood = MOODS[moment.mood];
          const meta = [
            mood.label,
            `brightness ${moment.intensity}/5`,
            moment.favorite ? "starred" : null,
            moment.isSample ? "example moment" : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return [
            moment.title.trim() ? `### ${escapeMarkdown(starTitle(moment))}` : null,
            `*${meta}*`,
            "",
            escapeBlockquoteContent(moment.content),
          ]
            .filter((line): line is string => line !== null)
            .join("\n");
        })
        .join("\n\n");
      return `## ${formatDay(dayMoments[0].createdAt, timeZone)}\n\n${sections}`;
    })
    .join("\n\n---\n\n");

  return `${header}\n${body}\n\n---\n\n*Exported from Asteria. Your words, in your hands.*\n`;
}

/**
 * The keepsake, assembled locally.
 *
 * When the Python renderer is unreachable this is what a writer still gets: the entire sky
 * as inline SVG — constellation threads and all — above the moments themselves, in one
 * file with no external requests. It is deliberately plainer than the service's version
 * (no rhythm panel, no typographic atlas spreads) and it is not a stub: it opens, it
 * prints, and it holds everything.
 */
export function renderAtlasFallback(
  moments: StarDto[],
  { timeZone, title = "Your sky", now = new Date() }: { timeZone: string; title?: string; now?: Date },
): string {
  const bundle = buildBundle(moments, timeZone, now);
  const drawable = moments.filter(moment => !moment.isSample);
  const xs = drawable.map(moment => moment.x);
  const ys = drawable.map(moment => moment.y);
  const minX = xs.length ? Math.min(...xs) - 60 : -200;
  const maxX = xs.length ? Math.max(...xs) + 60 : 200;
  const minY = ys.length ? Math.min(...ys) - 60 : -200;
  const maxY = ys.length ? Math.max(...ys) + 60 : 200;
  const width = Math.max(320, maxX - minX);
  const height = Math.max(320, maxY - minY);

  const escapedTitle = escapeHtml(title);
  const threads = MOOD_KEYS.flatMap(mood => {
    const members = drawable
      .filter(moment => moment.mood === mood)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const lines: string[] = [];
    for (let index = 1; index < members.length; index++) {
      // Same rule as the live sky: each star threads to the nearest earlier star of its kind.
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let candidate = 0; candidate < index; candidate++) {
        const distance = Math.hypot(
          members[index].x - members[candidate].x,
          members[index].y - members[candidate].y,
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      lines.push(
        `<line x1="${members[best].x.toFixed(1)}" y1="${members[best].y.toFixed(1)}" x2="${members[index].x.toFixed(1)}" y2="${members[index].y.toFixed(1)}" stroke="${MOODS[mood].hex}" stroke-opacity="0.28" stroke-width="0.7"/>`,
      );
    }
    return lines;
  });

  const points = drawable
    .map(
      moment =>
        `<circle cx="${moment.x.toFixed(1)}" cy="${moment.y.toFixed(1)}" r="${(1.1 + moment.intensity * 0.5).toFixed(2)}" fill="${MOODS[moment.mood].hex}"><title>${escapeHtml(starTitle(moment))} — ${dayKey(new Date(moment.createdAt), timeZone)}</title></circle>`,
    )
    .join("");

  const sections = [...moments]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(moment => {
      const mood = MOODS[moment.mood];
      return `<article><h3>${escapeHtml(starTitle(moment))}</h3><p class="meta">${escapeHtml(shortDay(moment.createdAt, timeZone))} · ${escapeHtml(mood.label)} · brightness ${moment.intensity}/5</p><p>${escapeHtml(moment.content).replace(/\n/g, "<br/>")}</p></article>`;
    })
    .join("\n");

  return page(escapedTitle, timeZone, `
    <header>
      <p class="eyebrow">Asteria</p>
      <h1>${escapedTitle}</h1>
      <p class="meta">${bundle.summary.moments} moments · ${bundle.summary.nights} nights · exported ${escapeHtml(bundle.exportedAt.slice(0, 10))}</p>
    </header>
    <section class="sky">
      <svg viewBox="${minX.toFixed(0)} ${minY.toFixed(0)} ${width.toFixed(0)} ${height.toFixed(0)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Your sky: ${drawable.length} stars">
        <rect x="${minX.toFixed(0)}" y="${minY.toFixed(0)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}" fill="#030409"/>
        ${threads.join("")}
        ${points}
      </svg>
    </section>
    <section class="moments">${sections}</section>
  `);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Shared shell for any locally-rendered stand-alone document. */
function page(title: string, timeZone: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} · Asteria</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #030409; color: #eef2ff;
         font-family: Georgia, "Times New Roman", serif; line-height: 1.6; }
  header, section, footer { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem; }
  .eyebrow { font: 500 .7rem/1 ui-monospace, monospace; letter-spacing: .22em;
             text-transform: uppercase; color: #7d88a8; margin: 0 0 1rem; }
  h1 { font-size: clamp(2rem, 5vw, 3.4rem); line-height: 1.05; margin: 0 0 .75rem; font-weight: 400; }
  h3 { font-size: 1.15rem; font-weight: 400; margin: 0 0 .35rem; }
  .meta { font: 400 .78rem/1.5 ui-monospace, monospace; color: #98a3c5; margin: 0; }
  .sky svg { width: 100%; height: auto; border: 1px solid rgba(238,242,255,.09); border-radius: .5rem; }
  .moments article { border-top: 1px solid rgba(238,242,255,.09); padding: 1.6rem 0; }
  .moments article p { margin: .4rem 0 0; color: #ccd3e6; }
  footer { color: #7d88a8; font: 400 .78rem/1.6 ui-monospace, monospace; }
  @media print { body { background: #fff; color: #111; } .sky svg, .meta { color: inherit; } }
</style>
</head>
<body>
${body}
<footer>Rendered by Asteria's built-in fallback renderer · ${escapeHtml(timeZone)} · open this file anywhere, it needs nothing.</footer>
</body>
</html>`;
}
