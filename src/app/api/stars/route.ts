import { db } from "@/db";
import { stars } from "@/db/schema";
import { and, count, eq, sql } from "drizzle-orm";
import { constellationPosition } from "@/lib/astral";
import { getJournalStars, requireJournal, toStar } from "@/lib/journal";
import { errorResponse, readBody, validateMoment, type MomentInput } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({ stars: await getJournalStars() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const input = validateMoment(await readBody(request)) as MomentInput;
    const journalId = await requireJournal();
    const star = await db.transaction(async tx => {
      // Serialise allocation within a journal, including released stars, so positions remain stable.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${journalId}))`);
      const [{ value }] = await tx.select({ value: count() }).from(stars).where(and(eq(stars.journalId, journalId), eq(stars.mood, input.mood)));
      const [row] = await tx.insert(stars).values({ ...input, journalId, ...constellationPosition(input.mood, Number(value)) }).returning();
      return row;
    });
    return Response.json({ star: toStar(star) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
