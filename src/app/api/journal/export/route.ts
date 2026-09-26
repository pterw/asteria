import { requireJournal } from "@/lib/context";
import { badRequest } from "@/lib/errors";
import { withRoute } from "@/lib/http";
import { buildBundle, renderAtlasFallback, renderMarkdown } from "@/lib/export";
import { listStars, recordEvent } from "@/lib/journal";
import { requestAtlas } from "@/lib/insights-service";
import { RATE_LIMITS } from "@/lib/ratelimit";
import { isValidTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";

type Format = "json" | "markdown" | "atlas";

/**
 * Take your words with you.
 *
 * Three formats, one route, because they are three readings of the same list:
 *
 * - `json` — the backup, versioned and checksummed, with nothing in it that could be used
 *   to claim the journal it came from.
 * - `markdown` — the reading copy, one section per night, with YAML front matter.
 * - `atlas` — a single self-contained HTML document with the whole sky drawn as inline SVG,
 *   rendered by the Python service when it answers and locally when it does not.
 *
 * Every export is logged as an event. A writer who wonders "did I download this before?"
 * can find out, and an operator can see that a backup left the building.
 */
export const GET = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    const params = new URL(request.url).searchParams;
    const format = (params.get("format") ?? "json") as Format;
    const timeZoneParam = params.get("timeZone") ?? "UTC";
    if (!["json", "markdown", "atlas"].includes(format)) {
      throw badRequest("Choose JSON, Markdown or the atlas.");
    }
    if (!isValidTimeZone(timeZoneParam)) throw badRequest("Choose a valid timezone.");

    const includeExamples = params.get("includeExamples") === "true";
    const all = await listStars(journal.journalId);
    const moments = includeExamples ? all : all.filter(star => !star.isSample);
    const today = new Date().toISOString().slice(0, 10);
    const title = params.get("title")?.slice(0, 80) || "Your sky";

    void recordEvent(journal.journalId, "journal.exported", { format, moments: moments.length });

    if (format === "json") {
      const bundle = buildBundle(moments, timeZoneParam);
      return new Response(JSON.stringify(bundle, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="asteria-journal-${today}.json"`,
          "cache-control": "private, no-store",
          "x-request-id": requestId,
        },
      });
    }

    if (format === "markdown") {
      const markdown = renderMarkdown(moments, { timeZone: timeZoneParam });
      return new Response(markdown, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="asteria-journal-${today}.md"`,
          "cache-control": "private, no-store",
          "x-request-id": requestId,
        },
      });
    }

    const remote = await requestAtlas({
      moments: moments.map(moment => ({
        id: moment.id,
        title: moment.title,
        content: moment.content,
        mood: moment.mood,
        intensity: moment.intensity,
        createdAt: moment.createdAt,
        favorite: moment.favorite,
        x: moment.x,
        y: moment.y,
      })),
      timeZone: timeZoneParam,
      title,
      now: new Date().toISOString(),
    });

    const html = remote?.html ?? renderAtlasFallback(moments, { timeZone: timeZoneParam, title });
    log.info("atlas rendered", { source: remote?.source ?? "local", moments: moments.length });
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": params.get("download") === "true" ? `attachment; filename="asteria-atlas-${today}.html"` : "inline",
        "cache-control": "private, no-store",
        "x-asteria-renderer": remote?.source ?? "local",
        "x-request-id": requestId,
      },
    });
  },
  { rateLimit: RATE_LIMITS.export },
);
