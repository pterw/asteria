import { requireJournal } from "@/lib/context";
import { jsonResponse, withRoute } from "@/lib/http";
import { listStars } from "@/lib/journal";
import { RATE_LIMITS } from "@/lib/ratelimit";
import { requestAnalytics } from "@/lib/insights-service";
import { isValidTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * The shape of a journal, as numbers.
 *
 * Two implementations exist — `services/insights` in Python, and `src/lib/analytics.ts` in
 * TypeScript — and this route prefers the service, then falls back without the caller
 * noticing. Which one answered is reported in `source`, because a portfolio-grade system
 * does not hide the fact that it degraded; the interface decides whether that is worth
 * showing a writer (it usually is not).
 *
 * What is sent to the service is metadata only: ids, feelings, brightnesses and timestamps.
 * Titles and bodies never leave the process for analytics. That is what makes it acceptable
 * to run the same computation in a second language at all.
 */
export const GET = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    const params = new URL(request.url).searchParams;
    const requested = params.get("timeZone");
    const timeZone = requested && isValidTimeZone(requested) ? requested : "UTC";
    const includeExamples = params.get("includeExamples") === "true";

    const stars = await listStars(journal.journalId);
    const { analytics, source } = await requestAnalytics(
      stars.map(star => ({
        id: star.id,
        mood: star.mood,
        intensity: star.intensity,
        createdAt: star.createdAt,
        favorite: star.favorite,
        isSample: star.isSample,
      })),
      { timeZone, includeExamples },
    );

    log.debug("analytics", { source, moments: analytics.totals.moments });
    return jsonResponse({ analytics, source }, { requestId });
  },
  { rateLimit: RATE_LIMITS.starRead },
);
