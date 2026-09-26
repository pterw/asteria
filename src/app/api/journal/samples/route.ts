import { requireJournal } from "@/lib/context";
import { jsonResponse, withRoute } from "@/lib/http";
import { clearSamples, insertSampleStars, journalCounts, recordEvent } from "@/lib/journal";
import { RATE_LIMITS } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * The example sky.
 *
 * It exists so a first-time writer is not staring at an empty canvas with no idea what the
 * product does — but it is *examples*, and the two things a writer can do with examples are
 * remove them and ask for them back. Both are here.
 *
 * Clearing is a soft release of the unclaimed samples only: the moment a writer edits an
 * example (changing a word, a feeling, a date) it stops being one, so a sky that has been
 * made personal can never lose something its owner wrote.
 */
export const DELETE = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    const removed = await clearSamples(journal.journalId);
    log.info("examples cleared", { count: removed.length });
    return jsonResponse({ ok: true, removed: removed.length, ids: removed }, { requestId });
  },
  { rateLimit: RATE_LIMITS.starWrite },
);

/** Put the tour back, for a writer who cleared it and wants to see it again. */
export const POST = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    const counts = await journalCounts(journal.journalId);
    if (counts.examples > 0) {
      return jsonResponse({ ok: true, planted: 0, message: "The example sky is already here." }, { requestId });
    }
    const planted = await insertSampleStars(journal.journalId);
    void recordEvent(journal.journalId, "examples.planted", { count: planted });
    log.info("examples planted", { count: planted });
    return jsonResponse({ ok: true, planted }, { status: 201, requestId });
  },
  { rateLimit: RATE_LIMITS.starWrite },
);
