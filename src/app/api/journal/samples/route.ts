import { db } from "@/db";
import { stars } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireJournal } from "@/lib/journal";
import { errorResponse } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function DELETE() {
  try {
    const journalId = await requireJournal();
    const rows = await db.update(stars).set({ deletedAt: new Date() })
      .where(and(eq(stars.journalId, journalId), eq(stars.isSample, true), isNull(stars.deletedAt)))
      .returning({ id: stars.id });
    return Response.json({ ok: true, removed: rows.map(r => r.id) });
  } catch (error) { return errorResponse(error); }
}
