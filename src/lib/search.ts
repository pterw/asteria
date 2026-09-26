import { and, asc, desc, eq, gte, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { stars } from "@/db/schema";
import { isMoodKey, MOOD_KEYS, type MoodKey } from "./moods";
import { toStar } from "./journal";
import type { StarDto } from "./stars";
import { dayKey, shiftDay, zonedDayRange, zonedTrailingRange } from "./time";
import type { SearchQuery } from "./schemas";

/**
 * Search, done by the database.
 *
 * The previous implementation was `ilike '%term%'` over two columns with no index: a
 * sequential scan that also could not rank, could not match a stem ("wandering" did not
 * find "wandered"), and returned matches ordered by date rather than by how well they
 * matched. `stars.search` is a generated `tsvector` — title weighted `A`, body weighted
 * `B` — with a GIN index, so this module can do all three properly.
 *
 * Two details make it feel right while a writer types:
 *
 * - **Prefix matching.** Every term is turned into `term:*`, so "kit" finds "kitchen"
 *   before the word is finished. `websearch_to_tsquery` is safer but does not do prefixes.
 * - **A short-query escape hatch.** Below three characters a stemmed index has nothing to
 *   work with, so the predicate falls back to a case-insensitive prefix match on the raw
 *   text. That is the difference between a search box that answers on the first keystroke
 *   and one that looks broken for two of them.
 */

const SAFE_TERM = /[^a-z0-9'’-]+/g;

/** Turn what someone typed into a tsquery that cannot be malformed. */
export function toPrefixQuery(input: string, maxTerms = 8): string | null {
  const terms = input
    .toLowerCase()
    .replace(SAFE_TERM, " ")
    .split(/\s+/)
    .map(term => term.replace(/^['’-]+|['’-]+$/g, ""))
    .filter(term => term.length > 0)
    .slice(0, maxTerms);
  if (!terms.length) return null;
  return terms.map(term => `${term}:*`).join(" & ");
}

export interface SearchResult {
  stars: StarDto[];
  total: number;
  limit: number;
  offset: number;
  /** Counts over the whole matched set, not just the page — so the UI can show facets. */
  facets: {
    moods: Record<MoodKey, number>;
    starred: number;
    examples: number;
    nights: number;
  };
  /** True when the result came from the prefix fallback rather than the text index. */
  prefixFallback: boolean;
}

export async function searchStars(
  journalId: string,
  options: SearchQuery,
  now = new Date(),
): Promise<SearchResult> {
  const db = await getDb();
  const timeZone = options.timeZone && options.period !== undefined ? options.timeZone : (options.timeZone ?? "UTC");
  const today = dayKey(now, timeZone);
  const query = options.q?.trim() ?? "";

  const where: SQL[] = [eq(stars.journalId, journalId)];
  // Released stars are always excluded. Examples are included by default, matching what the
  // interface does with the list it filters client-side: a writer who still has the example
  // sky sees it in results. `includeSamples=false` is how a caller says "only my own words".
  where.push(isNull(stars.deletedAt));
  if (options.includeSamples === "false") where.push(eq(stars.isSample, false));

  if (isMoodKey(options.mood)) where.push(eq(stars.mood, options.mood));
  if (options.starred === "true" || options.starred === "1") where.push(eq(stars.favorite, true));
  if (options.intensityMin !== undefined) where.push(gte(stars.intensity, options.intensityMin));
  if (options.intensityMax !== undefined) where.push(lte(stars.intensity, options.intensityMax));

  // A single calendar day, or a trailing window, both resolved to UTC instants so the
  // predicate stays on the index instead of wrapping the column in a timezone conversion.
  if (options.day && /^\d{4}-\d{2}-\d{2}$/.test(options.day)) {
    const range = zonedDayRange(options.day, timeZone);
    where.push(gte(stars.createdAt, range.start), lt(stars.createdAt, range.end));
  } else if (options.period === "week") {
    where.push(gte(stars.createdAt, zonedTrailingRange(today, 7, timeZone).start));
  } else if (options.period === "month") {
    where.push(gte(stars.createdAt, zonedDayRange(`${today.slice(0, 7)}-01`, timeZone).start));
  } else if (options.period === "all") {
    // No lower bound; but never show a moment dated after today, in the writer's calendar.
    where.push(lt(stars.createdAt, zonedDayRange(shiftDay(today, 1), timeZone).start));
  }

  if (options.since) {
    const date = new Date(options.since);
    if (Number.isFinite(date.getTime())) where.push(gte(stars.createdAt, date));
  }
  if (options.until) {
    const date = new Date(options.until);
    if (Number.isFinite(date.getTime())) where.push(lte(stars.createdAt, date));
  }

  let prefixFallback = false;
  let rank: SQL<number> | null = null;
  if (query.length > 0 && query.length < 3) {
    prefixFallback = true;
    // Two characters cannot be stemmed, so match them anywhere in the text. The set is
    // small by construction and the writer is mid-word: a substring answer on the second
    // keystroke is worth more here than the index it does not use.
    const escaped = query.replace(/([%_\\])/g, match => `\\${match}`);
    const pattern = `%${escaped}%`;
    where.push(or(sql`${stars.title} ilike ${pattern}`, sql`${stars.content} ilike ${pattern}`)!);
  } else if (query.length >= 3) {
    const tsquery = toPrefixQuery(query);
    if (tsquery) {
      where.push(sql`${stars.search} @@ to_tsquery('english', ${tsquery})`);
      rank = sql<number>`ts_rank_cd(${stars.search}, to_tsquery('english', ${tsquery}))`;
    }
  }

  const predicate = and(...where);

  // Every branch ends in `id`, so the order is *total*. Without it, two moments written in
  // the same millisecond can swap places between requests, and a paged list then repeats
  // one row and hides another — the kind of bug that only shows up in someone's journal.
  const order = (() => {
    if (options.sort === "oldest") return [asc(stars.createdAt), asc(stars.id)];
    if (options.sort === "brightest") return [desc(stars.intensity), desc(stars.createdAt), desc(stars.id)];
    if (options.sort === "dimmest") return [asc(stars.intensity), desc(stars.createdAt), desc(stars.id)];
    // With a query and no explicit order, best match first; ties break by recency.
    if (rank && (options.sort === undefined || options.sort === "relevance" || options.sort === "newest")) {
      return [desc(rank), desc(stars.createdAt), desc(stars.id)];
    }
    return [desc(stars.createdAt), desc(stars.id)];
  })();

  const [rows, totals, span] = await Promise.all([
    db
      .select()
      .from(stars)
      .where(predicate)
      .orderBy(...order)
      .limit(options.limit)
      .offset(options.offset),
    db
      .select({
        mood: stars.mood,
        count: sql<number>`count(*)`,
        starred: sql<number>`count(*) filter (where ${stars.favorite})`,
        examples: sql<number>`count(*) filter (where ${stars.isSample})`,
        nights: sql<number>`count(distinct (${stars.createdAt} at time zone ${timeZone})::date)`,
      })
      .from(stars)
      .where(predicate)
      .groupBy(stars.mood),
    // Nights are counted *once each*, not per feeling: summing the per-mood distinct counts
    // would count a night on which a writer felt two things as two nights.
    db
      .select({
        nights: sql<number>`count(distinct (${stars.createdAt} at time zone ${timeZone})::date)`,
      })
      .from(stars)
      .where(predicate),
  ]);

  const moods = Object.fromEntries(MOOD_KEYS.map(key => [key, 0])) as Record<MoodKey, number>;
  let total = 0;
  let starred = 0;
  let examples = 0;
  for (const row of totals) {
    const value = Number(row.count);
    total += value;
    starred += Number(row.starred);
    examples += Number(row.examples);
    if (isMoodKey(row.mood)) moods[row.mood] += value;
  }
  const nights = Number(span[0]?.nights ?? 0);

  return {
    stars: rows.map(toStar),
    total,
    limit: options.limit,
    offset: options.offset,
    facets: { moods, starred, examples, nights },
    prefixFallback,
  };
}
