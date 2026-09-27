import { requireJournal } from "@/lib/context";
import { jsonResponse, withRoute } from "@/lib/http";
import { recentEvents } from "@/lib/journal";
import { RATE_LIMITS } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * How this sky grew, as a list.
 *
 * Every write path leaves an event behind, which turns "when did I write this?" into a
 * question the product can answer about itself. Only kinds, ids and counts are returned —
 * never the words, which are already available from the star itself.
 */
export const GET = withRoute(
  async ({ requestId }, request) => {
    const journal = await requireJournal(request);
    const events = await recentEvents(journal.journalId, 60);
    return jsonResponse(
      {
        events: events.map(event => ({
          kind: event.kind,
          starId: event.starId,
          meta: event.meta,
          at: event.createdAt,
        })),
      },
      { requestId },
    );
  },
  { rateLimit: RATE_LIMITS.starRead },
);
