import { requireJournal } from "@/lib/context";
import { jsonResponse, withRoute } from "@/lib/http";
import { RATE_LIMITS } from "@/lib/ratelimit";
import { parseOrThrow, searchQuerySchema } from "@/lib/schemas";
import { searchStars } from "@/lib/search";
import { isValidTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Search and filtering.
 *
 * Returns the page *and* the facets for the whole matched set, because the interface shows
 * both at once: the moment list, and the six feeling counts it can be narrowed by. Computing
 * the facets client-side would mean the client needed every match — which is exactly what
 * pagination exists to avoid.
 */
export const GET = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const options = parseOrThrow(searchQuerySchema, params);
    const timeZone = options.timeZone && isValidTimeZone(options.timeZone) ? options.timeZone : "UTC";

    const result = await searchStars(journal.journalId, { ...options, timeZone });
    log.debug("search", {
      queryLength: options.q?.length ?? 0,
      mood: options.mood ?? "all",
      matched: result.total,
      returned: result.stars.length,
      prefixFallback: result.prefixFallback,
    });

    return jsonResponse(
      {
        stars: result.stars,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        facets: result.facets,
        prefixFallback: result.prefixFallback,
        query: { q: options.q ?? "", mood: options.mood ?? "all", sort: options.sort ?? "newest" },
      },
      { requestId },
    );
  },
  { rateLimit: RATE_LIMITS.search },
);
