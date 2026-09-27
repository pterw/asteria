import { requireJournal } from "@/lib/context";
import { jsonResponse, withRoute } from "@/lib/http";
import { recordEvent } from "@/lib/journal";
import { RATE_LIMITS } from "@/lib/ratelimit";
import { issueRecoveryKey } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Issue — or replace — this journal's recovery key.
 *
 * The key is returned exactly once, in this response, and only its HMAC is stored. That is
 * deliberate: nobody, including the operator of the deployment, can recover a writer's sky
 * from the database. It also means a lost key cannot be re-sent; the honest answer is that
 * a new one can be issued, which invalidates the old one.
 *
 * Rotating is therefore the same call as creating, and it is audited either way — a writer
 * who did not ask for a new key can see that one was issued.
 */
export const POST = withRoute(
  async ({ requestId, log }, request) => {
    const journal = await requireJournal(request);
    const key = await issueRecoveryKey(journal.journalId);
    void recordEvent(journal.journalId, "recovery.issued", { rotated: true });
    log.info("recovery key issued", { journalId: journal.journalId });
    return jsonResponse(
      {
        key,
        issuedAt: new Date().toISOString(),
        advice: "Write this down somewhere you keep important things. It is the only way back into this sky on another device, and it cannot be shown again.",
      },
      { requestId },
    );
  },
  { rateLimit: RATE_LIMITS.recovery },
);
