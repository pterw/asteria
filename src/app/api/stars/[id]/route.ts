import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { stars } from "@/db/schema";
import { requireJournal, withJournalCookie } from "@/lib/context";
import { notFound } from "@/lib/errors";
import { jsonResponse, readJsonBody, withRoute } from "@/lib/http";
import { releaseStar, toStar, updateStar, type StarPatch } from "@/lib/journal";
import { RATE_LIMITS } from "@/lib/ratelimit";
import { parseOrThrow, starPatchSchema } from "@/lib/schemas";
import { isUuid } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Extra = { params: Promise<{ id: string }> };

/**
 * A star id that is not a UUID cannot address a row, so it is answered as a 404 rather than
 * a 400. The reply to "is this star in my sky" is then identical for a malformed id, a
 * missing id and someone else's id — which is what keeps the endpoint from confirming that
 * other journals exist at all.
 */
async function resolveId(journalId: string, extra: Extra): Promise<string> {
  const { id } = await extra.params;
  if (!isUuid(id)) throw notFound("That star isn't in your sky.");
  return id;
}

export const GET = withRoute<Extra>(
  async ({ requestId }, request, extra) => {
    const journal = await requireJournal(request);
    const id = await resolveId(journal.journalId, extra);
    const db = await getDb();
    const [row] = await db
      .select()
      .from(stars)
      .where(and(eq(stars.id, id), eq(stars.journalId, journal.journalId)))
      .limit(1);
    if (!row) throw notFound("That star isn't in your sky.");
    return jsonResponse({ star: toStar(row) }, { requestId });
  },
  { rateLimit: RATE_LIMITS.starRead },
);

/**
 * Change a moment.
 *
 * Every branch is the same story: the words are the writer's to revise, the *place* is not.
 * `x` and `y` are never accepted from a client, which is what keeps a star where the reader
 * learned to find it.
 */
export const PATCH = withRoute<Extra>(
  async ({ requestId, log }, request, extra) => {
    const journal = await requireJournal(request);
    const id = await resolveId(journal.journalId, extra);
    const payload = parseOrThrow(starPatchSchema, await readJsonBody(request));

    // Only the fields the writer actually sent. Passing a fixed object with every key is the
    // difference between "they starred this" and "they sent a patch", and the difference is
    // visible in the activity log.
    const patch: StarPatch = {};
    if (payload.title !== undefined) patch.title = payload.title;
    if (payload.content !== undefined) patch.content = payload.content;
    if (payload.mood !== undefined) patch.mood = payload.mood;
    if (payload.intensity !== undefined) patch.intensity = payload.intensity;
    if (payload.createdAt !== undefined) patch.createdAt = payload.createdAt;
    if (payload.favorite !== undefined) patch.favorite = payload.favorite;
    if (payload.restore) patch.restore = true;

    const star = await updateStar(journal.journalId, id, patch);
    log.info("star updated", { starId: star.id, fields: Object.keys(patch).join(",") });
    return withJournalCookie(jsonResponse({ star }, { requestId }), journal, request);
  },
  { rateLimit: RATE_LIMITS.starWrite },
);

/**
 * Release a star.
 *
 * Soft, always: the row stays, its coordinates stay spent, and the client offers an undo.
 * Nothing a writer typed leaves the database without an explicit erasure.
 */
export const DELETE = withRoute<Extra>(
  async ({ requestId, log }, request, extra) => {
    const journal = await requireJournal(request);
    const id = await resolveId(journal.journalId, extra);
    const released = await releaseStar(journal.journalId, id);
    log.info("star released", { starId: released });
    return withJournalCookie(jsonResponse({ ok: true, id: released }, { requestId }), journal, request);
  },
  { rateLimit: RATE_LIMITS.starWrite },
);
