import { db } from "@/db";
import { stars } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { isUuid } from "@/lib/astral";
import { requireJournal, toStar } from "@/lib/journal";
import { ApiError, errorResponse, readBody, validateMoment } from "@/lib/api";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function owned(context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) throw new ApiError(400, "That star address is not valid.");
  const journalId = await requireJournal();
  return and(eq(stars.id, id), eq(stars.journalId, journalId));
}
export async function PATCH(request: Request, context: Context) {
  try {
    const where = await owned(context);
    const body = await readBody(request);
    const allowed = ["title", "content", "mood", "intensity", "createdAt", "favorite", "restore"];
    if (!Object.keys(body).length || Object.keys(body).some(k => !allowed.includes(k))) throw new ApiError(422, "Choose a moment field to update.");
    const update: Partial<typeof stars.$inferInsert> = { ...validateMoment(body, true), updatedAt: new Date() };
    // Once someone makes an example their own, sample cleanup must never remove it.
    if (["title", "content", "mood", "intensity", "createdAt"].some(key => key in body)) update.isSample = false;
    if ("favorite" in body) {
      if (typeof body.favorite !== "boolean") throw new ApiError(422, "Favorite must be true or false.");
      update.favorite = body.favorite;
    }
    if ("restore" in body) {
      if (body.restore !== true || Object.keys(body).length !== 1) throw new ApiError(422, "Restore a star in a separate request.");
      update.deletedAt = null;
    }
    const [row] = await db.update(stars).set(update).where(body.restore ? where : and(where, isNull(stars.deletedAt))).returning();
    if (!row) throw new ApiError(404, "That star isn't in your sky.");
    return Response.json({ star: toStar(row) });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(_request: Request, context: Context) {
  try {
    const where = await owned(context);
    const [row] = await db.update(stars).set({ deletedAt: new Date() }).where(and(where, isNull(stars.deletedAt))).returning({ id: stars.id });
    if (!row) throw new ApiError(404, "That star is already released, or isn't in your sky.");
    return Response.json({ ok: true, id: row.id });
  } catch (error) { return errorResponse(error); }
}
