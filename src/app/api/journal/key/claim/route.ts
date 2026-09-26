import { requireJournal } from "@/lib/context";
import { notFound } from "@/lib/errors";
import { jsonResponse, readJsonBody, withRoute } from "@/lib/http";
import { journalCounts, recordEvent } from "@/lib/journal";
import { RATE_LIMITS } from "@/lib/ratelimit";
import { parseOrThrow, recoveryKeySchema } from "@/lib/schemas";
import { createSession, deviceLabel, journalForRecoveryKey, sessionCookie } from "@/lib/session";
import { isSecureRequest } from "@/lib/session";
import { isValidTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Open an existing sky on this device.
 *
 * This is the whole of "sign in" in Asteria: a writer pastes the key they saved, and this
 * handler mints a fresh session for the journal that key opens. There is no email, no
 * password reset, no account to be locked out of and no list of users to leak.
 *
 * Two details are load-bearing:
 *
 * - **A wrong key and a key that was never issued give the same answer.** Otherwise the
 *   endpoint would be an oracle for which keys exist.
 * - **It is rate limited hard, in a slow window.** 125 bits makes guessing hopeless; the
 *   limit exists so the endpoint cannot be used as a free CPU or as a log-flooding tool.
 */
export const POST = withRoute(
  async ({ requestId, log }, request) => {
    // Resolve a context first so a *brand-new* browser pasting a key still gets a cookie —
    // and so the very first request from a visitor who is about to lose interest has
    // already provisioned their own journal, which the claim then simply replaces.
    const current = await requireJournal(request);
    const { key } = parseOrThrow(recoveryKeySchema, await readJsonBody(request));

    const journalId = await journalForRecoveryKey(key);
    if (!journalId) {
      log.info("recovery key did not match any journal", { attemptedLength: key.length });
      throw notFound("No sky answers to that key. Check for a missing or mistyped group.");
    }

    const device = deviceLabel(request.headers.get("user-agent"));
    const session = await createSession(journalId, device);
    const timeZone = new URL(request.url).searchParams.get("timeZone");
    const counts = await journalCounts(journalId);
    void recordEvent(journalId, "recovery.claimed", { device });

    const response = jsonResponse(
      {
        ok: true,
        journal: { moments: counts.moments, examples: counts.examples, starred: counts.starred },
        device,
        timeZone: timeZone && isValidTimeZone(timeZone) ? timeZone : null,
        superseded: current.journalId !== journalId ? current.journalId : null,
        serverTime: new Date().toISOString(),
      },
      { requestId },
    );
    response.headers.append("set-cookie", sessionCookie(session.token, isSecureRequest(request)));
    log.info("recovery key claimed", { journalId, device });
    return response;
  },
  { rateLimit: RATE_LIMITS.recovery },
);
