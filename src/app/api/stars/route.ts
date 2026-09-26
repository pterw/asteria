import { withJournalCookie, requireJournal } from "@/lib/context";
import { cachedJson, jsonResponse, readJsonBody, withRoute } from "@/lib/http";
import { createStar, listStars } from "@/lib/journal";
import { RATE_LIMITS } from "@/lib/ratelimit";
import { parseOrThrow, starCreateSchema } from "@/lib/schemas";
import { dayKey, isValidTimeZone } from "@/lib/time";
import type { StarDto } from "@/lib/stars";

export const dynamic = "force-dynamic";

interface StarsPayload {
  stars: StarDto[];
  counts: {
    /** Moments the writer actually wrote. Examples are reported separately. */
    moments: number;
    /** Everything the sky holds, examples included — the length of `stars`. */
    all: number;
    examples: number;
    nights: number;
    constellations: number;
    starred: number;
  };
  timeZone: string;
  serverTime: string;
}

/**
 * The whole sky, in one request.
 *
 * The canvas, the timeline, the census and the library all read from this list, so a
 * moment cannot be visible in one surface and missing from another. An ETag lets a
 * returning tab revalidate for nothing — a sky changes far more slowly than it is looked at.
 *
 * The counts here are the *real* ones: example moments are reported separately and never
 * folded into "nights remembered", because a brand-new writer's journal must not claim
 * forty nights it did not have.
 */
export const GET = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    const requested = new URL(request.url).searchParams.get("timeZone");
    const timeZone = requested && isValidTimeZone(requested) ? requested : "UTC";
    const stars = await listStars(journal.journalId);

    const nights = new Set<string>();
    const moods = new Set<string>();
    let examples = 0;
    let starred = 0;
    for (const star of stars) {
      if (star.favorite) starred++;
      if (star.isSample) examples++;
      else {
        nights.add(dayKey(new Date(star.createdAt), timeZone));
        moods.add(star.mood);
      }
    }

    const payload: StarsPayload = {
      stars,
      counts: {
        moments: stars.length - examples,
        all: stars.length,
        examples,
        nights: nights.size,
        constellations: moods.size,
        starred,
      },
      timeZone,
      serverTime: new Date().toISOString(),
    };
    log.debug("sky read", { moments: stars.length, examples });
    return cachedJson(payload, { request, requestId, maxAge: 15 });
  },
  { rateLimit: RATE_LIMITS.starRead },
);

/**
 * Capture a moment.
 *
 * The response is the created star *with its final coordinates*, so the client can place
 * it immediately rather than guessing and correcting. The sky animates a star being born,
 * and a correction a frame later would be visible.
 */
export const POST = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    const payload = parseOrThrow(starCreateSchema, await readJsonBody(request));
    const star = await createStar(journal.journalId, {
      title: payload.title,
      content: payload.content,
      mood: payload.mood,
      intensity: payload.intensity,
      createdAt: payload.createdAt,
    });
    log.info("star created", { starId: star.id, mood: star.mood, intensity: star.intensity });
    return withJournalCookie(jsonResponse({ star }, { status: 201, requestId }), journal, request);
  },
  { rateLimit: RATE_LIMITS.starWrite },
);
