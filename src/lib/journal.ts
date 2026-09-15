import { cookies } from "next/headers";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { journals, stars, type StarRow } from "@/db/schema";
import { isMoodKey, isUuid, type StarDto } from "./astral";
import { makeSamples } from "./samples";
import { ApiError } from "./api";

export function toStar(row: StarRow): StarDto {
  return {
    id: row.id, title: row.title, content: row.content,
    mood: isMoodKey(row.mood) ? row.mood : "serene", intensity: row.intensity,
    x: row.x, y: row.y, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    favorite: row.favorite, isSample: row.isSample,
  };
}
/** Every read and write resolves the HttpOnly cookie on the server; never trust a client-supplied owner. */
export async function requireJournal() {
  const token = (await cookies()).get("asteria-journal")?.value;
  if (!isUuid(token)) throw new ApiError(401, "Please reload the page to open your journal.");
  // Creation and sample seeding are atomic. Concurrent initial requests cannot duplicate examples.
  await db.transaction(async tx => {
    const inserted = await tx.insert(journals).values({ id: token }).onConflictDoNothing().returning({ id: journals.id });
    if (inserted.length) await tx.insert(stars).values(makeSamples(token));
  });
  return token;
}
export async function getJournalStars() {
  const journalId = await requireJournal();
  const rows = await db.select().from(stars).where(and(eq(stars.journalId, journalId), isNull(stars.deletedAt))).orderBy(desc(stars.createdAt));
  return rows.map(toStar);
}
