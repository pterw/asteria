import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { journals, stars } from "@/db/schema";
import { requireJournal, withJournalCookie } from "@/lib/context";
import { checksumMoments } from "@/lib/export";
import { jsonResponse, readJsonBody, withRoute } from "@/lib/http";
import { recordEvent } from "@/lib/journal";
import { MAX_IMPORT_MOMENTS } from "@/lib/limits";
import { RATE_LIMITS } from "@/lib/ratelimit";
import { importSchema, parseOrThrow } from "@/lib/schemas";
import { constellationPosition } from "@/lib/stars";

export const dynamic = "force-dynamic";

/**
 * A moment's identity for de-duplication: the instant, the feeling, the name and the words.
 * Brightness and favourite are deliberately excluded — a writer who re-imports a backup
 * after starring something should not get a second copy of it.
 */
function signature(moment: { createdAt: Date; mood: string; title: string; content: string }): string {
  return createHash("sha1")
    .update([moment.createdAt.toISOString(), moment.mood, moment.title, moment.content].join("\u001f"))
    .digest("hex")
    .slice(0, 20);
}

/**
 * Restore a backup.
 *
 * Design decisions worth stating, because each one is a way this could have been worse:
 *
 * - **Idempotent without trusting ids.** A moment already in *this* journal — same instant,
 *   feeling, name and words — is skipped, so importing the same file twice does not double a
 *   sky. Identity comes from the moment's content, not from the id in the file: a backup
 *   imported into two different journals must be able to exist in both, and reusing a
 *   primary key would silently drop rows in exactly that case.
 * - **Coordinates are re-derived, not trusted.** The file carries positions, but a
 *   hand-edited backup could stack every star in one place; allocation happens here, under
 *   the same advisory lock the write path uses, so the result is always a valid sky.
 * - **`replace` is opt-in and recoverable.** Nothing is deleted — replaced moments are
 *   released (soft), so the undo window still applies.
 * - **The checksum is advisory, not a gate.** A mismatch is reported back to the writer
 *   rather than refusing their only copy of a year of writing.
 */
export const POST = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    const payload = parseOrThrow(importSchema, await readJsonBody(request, { maxBytes: 512_000 }));

    const usable = payload.moments.filter(moment => moment.content.trim().length >= 1);
    const skipped = payload.moments.length - usable.length;
    const rawChecksum = (payload as Record<string, unknown>).checksum;
    const claimedChecksum = typeof rawChecksum === "string" ? rawChecksum : null;

    if (!usable.length) {
      return jsonResponse(
        { ok: false, imported: 0, skipped, message: "None of the moments in that file had any words in them." },
        { status: 422, requestId },
      );
    }

    const db = await getDb();

    const result = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${journal.journalId}))`);

      // Which of these already exist here? Bounded by the import size: only rows whose
      // timestamp matches one being imported are candidates for a duplicate.
      const instants = [...new Set(usable.map(moment => moment.createdAt.getTime()))].map(
        millis => new Date(millis),
      );
      const candidates = instants.length
        ? await tx
            .select({ createdAt: stars.createdAt, content: stars.content, title: stars.title, mood: stars.mood })
            .from(stars)
            .where(and(eq(stars.journalId, journal.journalId), inArray(stars.createdAt, instants)))
        : [];
      const existingSignatures = new Set(candidates.map(row => signature(row)));

      if (payload.mode === "replace") {
        await tx
          .update(stars)
          .set({ deletedAt: new Date() })
          .where(and(eq(stars.journalId, journal.journalId), eq(stars.isSample, false)));
      }

      const counts = await tx
        .select({ mood: stars.mood, value: sql<number>`count(*)` })
        .from(stars)
        .where(eq(stars.journalId, journal.journalId))
        .groupBy(stars.mood);
      const perMood = new Map(counts.map(row => [row.mood, Number(row.value)]));

      let inserted = 0;
      let duplicates = 0;
      const rows: (typeof stars.$inferInsert)[] = [];

      for (const moment of usable) {
        if (existingSignatures.has(signature(moment))) {
          duplicates++;
          continue;
        }
        const index = perMood.get(moment.mood) ?? 0;
        perMood.set(moment.mood, index + 1);
        const position = constellationPosition(moment.mood as never, index);
        rows.push({
          journalId: journal.journalId,
          title: moment.title,
          content: moment.content,
          mood: moment.mood,
          intensity: moment.intensity,
          favorite: moment.favorite,
          isSample: false,
          createdAt: moment.createdAt,
          updatedAt: new Date(),
          x: position.x,
          y: position.y,
        });
      }

      // Chunked so a 500-moment restore does not build one enormous statement. Counted from
      // what the database actually returned, never from what was attempted.
      for (let offset = 0; offset < rows.length; offset += 100) {
        const chunk = rows.slice(offset, offset + 100);
        const written = await tx.insert(stars).values(chunk).returning({ id: stars.id });
        inserted += written.length;
      }

      if (payload.timeZone) {
        await tx.update(journals).set({ timeZone: payload.timeZone }).where(eq(journals.id, journal.journalId));
      }
      return { inserted, duplicates };
    });

    // A checksum mismatch is worth telling the writer about: it means the file changed after
    // it was written, which is the difference between "restored" and "restored something else".
    const expected = checksumMoments(
      usable.map((moment, index) => ({
        id: moment.id ?? `imported-${index}`,
        createdAt: moment.createdAt.toISOString(),
        mood: moment.mood as never,
        intensity: moment.intensity,
        title: moment.title,
        content: moment.content,
      })),
    );
    const checksumVerified = claimedChecksum ? claimedChecksum === expected : null;

    void recordEvent(journal.journalId, "journal.imported", {
      inserted: result.inserted,
      duplicates: result.duplicates,
      skipped,
      mode: payload.mode,
    });
    log.info("import complete", { ...result, skipped, mode: payload.mode, checksumVerified });

    return withJournalCookie(
      jsonResponse(
        {
          ok: true,
          imported: result.inserted,
          duplicates: result.duplicates,
          skipped,
          totalRequested: payload.moments.length,
          maxPerImport: MAX_IMPORT_MOMENTS,
          checksumVerified,
          mode: payload.mode,
        },
        { status: 201, requestId },
      ),
      journal,
      request,
    );
  },
  { rateLimit: RATE_LIMITS.import },
);
