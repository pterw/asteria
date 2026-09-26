import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { journalEvents, journals, stars, type StarRow } from "@/db/schema";
import { ApiError, notFound } from "./errors";
import { EVENT_RETENTION, MAX_CONTENT, MAX_TITLE } from "./limits";
import { isMoodKey, type MoodKey } from "./moods";
import { makeSamples } from "./samples";
import { constellationPosition, type StarDto, type StarInput } from "./stars";

/**
 * Everything that reads or writes a star.
 *
 * Two invariants are enforced here rather than trusted to callers:
 *
 * - **Ownership.** Every statement is scoped by `journal_id`, and the journal id comes
 *   from `resolveJournal` (the session cookie), never from the request body. A star id
 *   from another journal is indistinguishable from one that does not exist, which is the
 *   answer that leaks least.
 * - **A position is spent once.** Coordinates are allocated under a transaction-scoped
 *   advisory lock keyed on the journal, counting *all* rows for that mood including
 *   released ones. Positions are therefore never reused, so restoring a released star
 *   puts it back exactly where it was and releasing one can never shift its neighbours.
 */

export function toStar(row: StarRow): StarDto {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    mood: isMoodKey(row.mood) ? row.mood : "serene",
    intensity: row.intensity,
    x: row.x,
    y: row.y,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    favorite: row.favorite,
    isSample: row.isSample,
  };
}

/** True when the caller asked for the server to make up its mind about a field. */
function lockKey(journalId: string) {
  return sql`select pg_advisory_xact_lock(hashtext(${journalId}))`;
}

/** Every star in a journal, newest first. Deleted stars are included only on request. */
export async function listStars(journalId: string, { includeReleased = false } = {}): Promise<StarDto[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(stars)
    .where(
      includeReleased
        ? eq(stars.journalId, journalId)
        : and(eq(stars.journalId, journalId), isNull(stars.deletedAt)),
    )
    .orderBy(desc(stars.createdAt), desc(stars.id));
  return rows.map(toStar);
}

/** Counts the interface needs before the full list arrives, plus the sample split. */
export interface JournalCounts {
  /** Moments the writer actually wrote. Examples are reported separately, never folded in. */
  moments: number;
  /** Everything present, examples included — the number the sky itself holds. */
  all: number;
  constellations: number;
  released: number;
  examples: number;
  starred: number;
}

/**
 * How big the sky is, counted in one pass.
 *
 * The `deleted_at is null` condition lives *inside each aggregate* rather than in the
 * query's `where` clause. Putting it in the `where` (the obvious thing, and what this did
 * first) filters released rows out before the aggregates see them, which quietly makes
 * `released` always zero — the count of things you cannot count because you excluded them.
 * Released moments are the writer's own; released examples are just the example sky being
 * tidied away and are not reported.
 */
export async function journalCounts(journalId: string): Promise<JournalCounts> {
  const db = await getDb();
  const live = sql`${stars.deletedAt} is null`;
  // The `::int` casts are load-bearing, not tidiness. `count(*)` is `bigint`, and the two
  // drivers disagree about what that means: the embedded driver hands back a JavaScript
  // number, while node-postgres hands back a *string*, because a JavaScript number cannot
  // hold every bigint. Without the cast the API would answer `{"moments":"1"}` in production
  // and `{"moments":1}` in development — a difference no local test could see.
  const rows = await db
    .select({
      all: sql<number>`count(*) filter (where ${live})::int`,
      examples: sql<number>`count(*) filter (where ${stars.isSample} and ${live})::int`,
      released: sql<number>`count(*) filter (where not ${stars.isSample} and ${stars.deletedAt} is not null)::int`,
      starred: sql<number>`count(*) filter (where ${stars.favorite} and ${live})::int`,
      constellations: sql<number>`count(distinct ${stars.mood}) filter (where ${live} and not ${stars.isSample})::int`,
    })
    .from(stars)
    .where(eq(stars.journalId, journalId));
  const row = rows[0];
  const all = Number(row?.all ?? 0);
  const examples = Number(row?.examples ?? 0);
  return {
    all,
    moments: all - examples,
    examples,
    released: Number(row?.released ?? 0),
    starred: Number(row?.starred ?? 0),
    constellations: Number(row?.constellations ?? 0),
  };
}

/**
 * Create a moment.
 *
 * The advisory lock serialises allocation within one journal — two tabs saving at the
 * same instant cannot compute the same index for the same constellation and land on top
 * of each other. It is transaction-scoped, so it releases on commit or rollback with no
 * cleanup path to get wrong.
 */
export async function createStar(journalId: string, input: StarInput): Promise<StarDto> {
  const db = await getDb();
  const row = await db.transaction(async tx => {
    await tx.execute(lockKey(journalId));
    const [existing] = await tx
      .select({ value: count() })
      .from(stars)
      .where(and(eq(stars.journalId, journalId), eq(stars.mood, input.mood)));
    const position = constellationPosition(input.mood, Number(existing?.value ?? 0));
    const [inserted] = await tx
      .insert(stars)
      .values({
        journalId,
        title: input.title.slice(0, MAX_TITLE),
        content: input.content.slice(0, MAX_CONTENT),
        mood: input.mood,
        intensity: input.intensity,
        createdAt: input.createdAt,
        updatedAt: new Date(),
        x: position.x,
        y: position.y,
      })
      .returning();
    return inserted;
  });
  void recordEvent(journalId, "star.created", { starId: row.id, mood: row.mood, intensity: row.intensity });
  return toStar(row);
}

export interface StarPatch {
  title?: string;
  content?: string;
  mood?: MoodKey;
  intensity?: number;
  createdAt?: Date;
  favorite?: boolean;
  restore?: true;
}

/**
 * Change a moment.
 *
 * Editing claims an example: once a writer has touched a sample, it is theirs and the
 * "clear the examples" action must never remove it. `restore` is the inverse of a
 * release and is deliberately its own request, so an undo cannot be bundled with an edit.
 */
export async function updateStar(journalId: string, starId: string, patch: StarPatch): Promise<StarDto> {
  const db = await getDb();
  const update: Partial<typeof stars.$inferInsert> = { updatedAt: new Date() };

  // What the caller actually asked to change. A caller that hands over an object with every
  // field in it — the route used to — otherwise makes "was this only a favourite?" impossible
  // to answer, and every star ever starred was logged as a plain update.
  const touched = (Object.keys(patch) as (keyof StarPatch)[]).filter(key => patch[key] !== undefined);

  if (patch.title !== undefined) update.title = patch.title.slice(0, MAX_TITLE);
  if (patch.content !== undefined) update.content = patch.content.slice(0, MAX_CONTENT);
  if (patch.mood !== undefined) update.mood = patch.mood;
  if (patch.intensity !== undefined) update.intensity = patch.intensity;
  if (patch.createdAt !== undefined) update.createdAt = patch.createdAt;
  if (patch.favorite !== undefined) update.favorite = patch.favorite;
  if (patch.restore) update.deletedAt = null;

  // Editing claims an example, and so does starring one: both are the writer saying "this
  // is mine". Without the favourite case, a writer who keeps an example and then tidies
  // the example sky would watch the one they kept disappear.
  const claims =
    (["title", "content", "mood", "intensity", "createdAt"] as const).some(key => touched.includes(key)) ||
    patch.favorite === true;
  if (claims) update.isSample = false;

  const where = and(
    eq(stars.id, starId),
    eq(stars.journalId, journalId),
    patch.restore ? undefined : isNull(stars.deletedAt),
  );
  const [row] = await db.update(stars).set(update).where(where).returning();
  if (!row) throw notFound("That star isn't in your sky.", { starId });

  if (patch.restore) void recordEvent(journalId, "star.restored", { starId });
  // A favourite-only patch is its own event. `touched` is filtered, not `Object.keys(patch)`:
  // the count has to be about what changed, not about how many fields the object happens to
  // carry, or this branch is unreachable from any caller that passes a fixed shape.
  else if (patch.favorite !== undefined && touched.length === 1) {
    void recordEvent(journalId, patch.favorite ? "star.starred" : "star.unstarred", { starId });
  } else void recordEvent(journalId, "star.updated", { starId, fields: touched.join(",") });

  return toStar(row);
}

/** Soft delete. The row stays, so undo is exact and a released star keeps its position. */
export async function releaseStar(journalId: string, starId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .update(stars)
    .set({ deletedAt: new Date() })
    .where(and(eq(stars.id, starId), eq(stars.journalId, journalId), isNull(stars.deletedAt)))
    .returning({ id: stars.id });
  if (!row) throw notFound("That star is already released, or isn't in your sky.", { starId });
  void recordEvent(journalId, "star.released", { starId });
  return row.id;
}

/** Release every example the writer has not claimed. Their own words are never touched. */
export async function clearSamples(journalId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .update(stars)
    .set({ deletedAt: new Date() })
    .where(and(eq(stars.journalId, journalId), eq(stars.isSample, true), isNull(stars.deletedAt)))
    .returning({ id: stars.id });
  if (rows.length) void recordEvent(journalId, "examples.cleared", { count: rows.length });
  return rows.map(row => row.id);
}

/** Re-plant the example sky for a writer who cleared it and wants the tour again. */
export async function insertSampleStars(journalId: string): Promise<number> {
  const db = await getDb();
  const rows = makeSamples(journalId);
  for (let index = 0; index < rows.length; index += 100) {
    await db.insert(stars).values(rows.slice(index, index + 100));
  }
  return rows.length;
}

/** The journal itself: display name, timezone, whether the tour was shown. */
export async function getJournal(journalId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: journals.id,
      displayName: journals.displayName,
      timeZone: journals.timeZone,
      createdAt: journals.createdAt,
      lastSeenAt: journals.lastSeenAt,
      seededAt: journals.seededAt,
      hasRecoveryKey: isNotNull(journals.recoveryKeyHash),
      shareAnonymousMetrics: journals.shareAnonymousMetrics,
    })
    .from(journals)
    .where(eq(journals.id, journalId))
    .limit(1);
  if (!row) throw notFound("That sky is no longer here.");
  return { ...row, hasRecoveryKey: Boolean(row.hasRecoveryKey) };
}

export async function updateJournal(
  journalId: string,
  patch: { displayName?: string | null; timeZone?: string; shareAnonymousMetrics?: boolean },
): Promise<void> {
  const db = await getDb();
  const update: Partial<typeof journals.$inferInsert> = {};
  if (patch.displayName !== undefined) update.displayName = patch.displayName;
  if (patch.timeZone !== undefined) update.timeZone = patch.timeZone;
  if (patch.shareAnonymousMetrics !== undefined) update.shareAnonymousMetrics = patch.shareAnonymousMetrics;
  if (!Object.keys(update).length) return;
  await db.update(journals).set(update).where(eq(journals.id, journalId));
}

/**
 * Erasure. Explicit, complete, and cascading: every star, session and event goes with the
 * row because each of those tables declares `on delete cascade`.
 */
export async function eraseJournal(journalId: string): Promise<void> {
  const db = await getDb();
  const deleted = await db.delete(journals).where(eq(journals.id, journalId)).returning({ id: journals.id });
  if (!deleted.length) throw notFound("That sky is already gone.");
}

/**
 * Append to the journal's own history. Best-effort by design: a missing event is a
 * smaller problem than a failed save, so callers do not await it and never see its error.
 */
export async function recordEvent(
  journalId: string,
  kind: string,
  meta: Record<string, string | number | boolean | null> = {},
  starId?: string,
): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(journalEvents).values({ journalId, kind, starId: starId ?? null, meta });
    if (Math.random() < 0.02) {
      await db.execute(sql`
        delete from journal_events
        where journal_id = ${journalId}
          and id not in (
            select id from journal_events where journal_id = ${journalId} order by id desc limit ${EVENT_RETENTION}
          )
      `);
    }
  } catch {
    /* Telemetry must never be the reason a save fails. */
  }
}

export async function recentEvents(journalId: string, limit = 40) {
  const db = await getDb();
  return db
    .select({
      kind: journalEvents.kind,
      starId: journalEvents.starId,
      meta: journalEvents.meta,
      createdAt: journalEvents.createdAt,
    })
    .from(journalEvents)
    .where(eq(journalEvents.journalId, journalId))
    .orderBy(desc(journalEvents.createdAt), desc(journalEvents.id))
    .limit(limit);
}

/**
 * The ids of every star that is not an example, oldest first. Used by the timeline's
 * "how the sky formed" replay and by the atlas, where the sample stars are excluded.
 */
export async function realStarIds(journalId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: stars.id })
    .from(stars)
    .where(and(eq(stars.journalId, journalId), eq(stars.isSample, false), isNull(stars.deletedAt)))
    .orderBy(asc(stars.createdAt));
  return rows.map(row => row.id);
}

/** A guard for routes that take a star id: an unusable id is a 404, not a 400. */
export function assertOwned(star: unknown, journalId: string) {
  const row = star as StarRow | undefined;
  if (!row || row.journalId !== journalId) throw new ApiError(404, "That star isn't in your sky.");
  return row;
}
