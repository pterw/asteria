import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions } from "@/db/schema";
import { requireJournal } from "@/lib/context";
import { jsonResponse, withRoute } from "@/lib/http";
import { recordEvent } from "@/lib/journal";
import { RATE_LIMITS } from "@/lib/ratelimit";
import { revokeSessions } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Where this sky is open.
 *
 * A session list is the honest counterpart to a recovery key: the key is how a writer gets
 * *into* their sky on a new device, and this is how they get *out* of anywhere they no
 * longer want it open. Revoking is immediate (the row is marked, not deleted) and never
 * touches the writing.
 */
export const GET = withRoute(async ({ requestId }, request) => {
  const journal = await requireJournal(request);
  const db = await getDb();
  const rows = await db
    .select({
      id: sessions.id,
      device: sessions.device,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(eq(sessions.journalId, journal.journalId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())),
    )
    .orderBy(desc(sessions.lastSeenAt))
    .limit(50);

  return jsonResponse(
    {
      devices: rows.map(row => ({
        id: row.id,
        label: row.device ?? "A browser",
        current: row.id === journal.sessionId,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
      })),
    },
    { requestId },
  );
});

/** Close every other session. The one making the request is kept, so nobody signs themselves out. */
export const DELETE = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    const revoked = await revokeSessions(journal.journalId, journal.sessionId ?? undefined);
    void recordEvent(journal.journalId, "sessions.revoked", { count: revoked });
    log.info("sessions revoked", { count: revoked });
    return jsonResponse({ ok: true, revoked }, { requestId });
  },
  { rateLimit: RATE_LIMITS.starWrite },
);
