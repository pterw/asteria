import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions } from "@/db/schema";
import { requireJournal } from "@/lib/context";
import { clearSessionCookie, isSecureRequest } from "@/lib/session";
import { jsonResponse, readJsonBody, withRoute } from "@/lib/http";
import { eraseJournal, getJournal, journalCounts, updateJournal } from "@/lib/journal";
import { RATE_LIMITS } from "@/lib/ratelimit";
import { eraseSchema, parseOrThrow, settingsSchema } from "@/lib/schemas";
import { isValidTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";

/** The journal itself: what it holds, how it is configured, and where it can be reopened. */
export const GET = withRoute(async ({ requestId }, request) => {
  const journal = await requireJournal(request);
  const [details, counts] = await Promise.all([getJournal(journal.journalId), journalCounts(journal.journalId)]);
  const db = await getDb();
  const devices = await db
    .select({ id: sessions.id, device: sessions.device, lastSeenAt: sessions.lastSeenAt, createdAt: sessions.createdAt })
    .from(sessions)
    .where(and(eq(sessions.journalId, journal.journalId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(20);

  return jsonResponse(
    {
      journal: {
        displayName: details.displayName,
        timeZone: details.timeZone,
        createdAt: details.createdAt,
        seededAt: details.seededAt,
        hasRecoveryKey: details.hasRecoveryKey,
        shareAnonymousMetrics: details.shareAnonymousMetrics,
      },
      counts,
      devices: devices.map(device => ({
        id: device.id,
        label: device.device ?? "A browser",
        current: device.id === journal.sessionId,
        lastSeenAt: device.lastSeenAt,
      })),
      serverTime: new Date().toISOString(),
    },
    { requestId },
  );
});

/** Settings: a display name, a timezone, an analytics preference. */
export const PATCH = withRoute(
  async ({ requestId }, request) => {
    const journal = await requireJournal(request);
    const payload = parseOrThrow(settingsSchema, await readJsonBody(request));
    if (payload.timeZone !== undefined && !isValidTimeZone(payload.timeZone)) {
      return jsonResponse({ error: "That timezone isn't one this device recognises." }, { status: 422, requestId });
    }
    await updateJournal(journal.journalId, payload);
    const details = await getJournal(journal.journalId);
    return jsonResponse(
      { journal: { displayName: details.displayName, timeZone: details.timeZone, shareAnonymousMetrics: details.shareAnonymousMetrics } },
      { requestId },
    );
  },
  { rateLimit: RATE_LIMITS.starWrite },
);

/**
 * Erasure.
 *
 * The only path in the product that destroys writing, so it asks for a typed confirmation,
 * is rate limited, is audited, and removes the journal row itself — every star, session and
 * event cascades from it. The cookie is cleared in the same response, because leaving a
 * session pointing at a deleted journal would strand the next request.
 */
export const DELETE = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    parseOrThrow(eraseSchema, await readJsonBody(request));
    await eraseJournal(journal.journalId);
    log.warn("journal erased", { journalId: journal.journalId });
    const response = jsonResponse({ ok: true, erased: true }, { requestId });
    response.headers.append("set-cookie", clearSessionCookie(isSecureRequest(request)));
    return response;
  },
  { rateLimit: RATE_LIMITS.erase },
);
