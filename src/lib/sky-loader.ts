import { cookies, headers } from "next/headers";
import { logger } from "./logger";
import { listStars } from "./journal";
import { resolveJournal } from "./session";
import type { StarDto } from "./stars";

/**
 * The server-component entry point into a journal.
 *
 * A page cannot set a cookie, so this path never upgrades a legacy cookie — it reads one
 * and leaves the upgrade to the next API call. That is the deliberate trade: pages stay
 * renderable without side effects, and identity changes only happen on a request the
 * browser already made for a write.
 *
 * **What happens when the database is down** is the important part. The previous build
 * caught the error here and returned fabricated sample stars with a 200, which meant an
 * outage was invisible and a writer could be shown a sky that was not theirs. This returns
 * an explicit failure instead, and the page renders a quiet explanation. Nothing was lost,
 * the words are still in the database, and the interface says so honestly.
 */
export interface SkyLoadSuccess {
  ok: true;
  stars: StarDto[];
  journalId: string;
  isNew: boolean;
  timeZone: string | null;
}

export interface SkyLoadFailure {
  ok: false;
  reason: "unavailable" | "uninitialised";
  message: string;
}

export type SkyLoad = SkyLoadSuccess | SkyLoadFailure;

export async function loadSky(): Promise<SkyLoad> {
  const cookieStore = await cookies();
  const headerList = await headers();
  const token = cookieStore.get("asteria-journal")?.value ?? null;

  try {
    const journal = await resolveJournal({
      token,
      userAgent: headerList.get("user-agent"),
      timeZone: headerList.get("x-asteria-timezone"),
    });
    if (!journal.journalId) {
      return { ok: false, reason: "unavailable", message: "Your journal could not be opened on this request." };
    }
    const stars = await listStars(journal.journalId);
    return { ok: true, stars, journalId: journal.journalId, isNew: journal.isNew, timeZone: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const uninitialised = /relation .* does not exist|no such table/i.test(message);
    logger.withError("sky could not be loaded", error, { uninitialised });
    return {
      ok: false,
      reason: uninitialised ? "uninitialised" : "unavailable",
      message: uninitialised
        ? "The database is reachable but has no schema yet. Run npm run db:migrate and reload."
        : "Your journal is briefly out of reach. Nothing was lost — please try again in a moment.",
    };
  }
}
