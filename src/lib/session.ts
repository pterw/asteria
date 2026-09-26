import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { journals, sessions } from "@/db/schema";
import { logger } from "./logger";
import { SESSION_TTL_MS } from "./limits";
import { isUuid } from "./validation";

/**
 * Identity, without accounts.
 *
 * The product deliberately has no registration: a writer should be writing within seconds
 * of arriving, and `PRODUCT.md` records that the identity question was left open. What is
 * *not* open is that a sky must survive. The previous build put the journal's UUID in an
 * HttpOnly cookie and stopped there — clear your cookies, change machines, use a private
 * window, and years of writing were gone, because the cookie *was* the identity.
 *
 * This module separates the two things that cookie was conflating:
 *
 * - **A session** is how this browser is recognised. The cookie holds 32 random bytes; the
 *   database holds only their SHA-256. Losing it costs a session, not the record. Sessions
 *   are rows, so they can be listed and revoked.
 * - **A recovery key** is how the *writer* is recognised on any device. It is a
 *   high-entropy phrase, shown once, stored only as an HMAC under a server pepper. Typing
 *   it mints a new session for the same journal. It is not a password: there is no email,
 *   no reset, no account, nothing to breach — and it is exactly the "export/import key"
 *   option that `DESIGN_AUDIT1.md` §D1 raised and left open.
 *
 * Nothing here needs a third party, which is why the product can keep its promise that
 * no one else holds the writing.
 */

export const SESSION_COOKIE = "asteria-journal";

/** 32 bytes of entropy, base64url — 43 characters, no padding, URL-safe. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored. A leaked database yields no usable cookie. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U
const RECOVERY_GROUPS = 5;
const RECOVERY_GROUP_SIZE = 5;

/**
 * A recovery key a person can actually write down: five groups of five, from an alphabet
 * with the ambiguous letters removed, e.g. `K7QM4-9RT2X-4H8NP-2VWZ6-3CFGJ`.
 *
 * 25 characters × 5 bits = 125 bits of entropy. That is not a password and is not meant
 * to be typed daily: it is a key you put somewhere safe, once.
 */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(RECOVERY_GROUPS * RECOVERY_GROUP_SIZE);
  const chars = Array.from(bytes, byte => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]);
  return Array.from({ length: RECOVERY_GROUPS }, (_, group) =>
    chars.slice(group * RECOVERY_GROUP_SIZE, (group + 1) * RECOVERY_GROUP_SIZE).join(""),
  ).join("-");
}

/**
 * Normalise before hashing, so a key typed with lowercase, spaces, or `O` instead of `0`
 * still opens the right sky. This is the whole reason the alphabet excludes I/L/O/U — the
 * substitutions below are lossless.
 */
export function normalizeRecoveryKey(key: string): string {
  return key
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
}

/**
 * The stored form of a recovery key.
 *
 * HMAC rather than a bare hash: the pepper means a stolen database dump cannot be
 * attacked offline against a list of candidate keys. 125 bits of entropy already makes
 * that infeasible, but defence in depth is cheap here.
 */
export function recoveryKeyHash(key: string): string {
  return createHmac("sha256", secret()).update(normalizeRecoveryKey(key)).digest("hex");
}

/**
 * The server pepper. A missing secret is a deployment mistake, not a reason to refuse to
 * serve: in development a deterministic fallback keeps local work frictionless, and in
 * production the problem is logged loudly at startup rather than at 3am on someone's
 * journal.
 */
let warned = false;
function secret(): string {
  const value = process.env.ASTERIA_SECRET?.trim();
  if (value && value.length >= 16) return value;
  if (process.env.NODE_ENV === "production" && !warned) {
    warned = true;
    logger.error("ASTERIA_SECRET is unset or too short — recovery keys and sessions are using a development fallback. Set it before inviting writers.", {
      minLength: 16,
    });
  }
  return "asteria-development-secret-do-not-use-in-production";
}

/** `Firefox on macOS` — enough to recognise a device in a list, nothing tracking-shaped. */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "A browser";
  const browser = /Firefox\/[\d.]+/.test(userAgent)
    ? "Firefox"
    : /Edg\//.test(userAgent)
      ? "Edge"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "A browser";
  const platform = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return platform ? `${browser} on ${platform}` : browser;
}

export interface JournalContext {
  journalId: string;
  sessionId: string | null;
  /** True the first time this browser has ever been seen. */
  isNew: boolean;
  /** True when this request was the one that planted the example sky. */
  seeded: boolean;
  /**
   * Set when the cookie should be replaced. Two cases: a legacy UUID cookie being
   * upgraded to an opaque token, and a recovery key being claimed on a new device.
   */
  rotateToken: string | null;
  device: string;
}

/**
 * The journal id implied by a session token.
 *
 * Derived, not random, and this is the trick that makes first contact safe: two concurrent
 * requests carrying the same brand-new cookie compute the *same* journal id, so there is no
 * race to lose, no orphaned journal to clean up, and `on conflict do nothing` is the whole
 * concurrency story. The token is 256 bits of server-minted entropy and is never shown to
 * anyone, so an attacker cannot derive a journal id without already holding the cookie.
 */
export function deriveJournalId(token: string): string {
  const digest = createHmac("sha256", secret()).update(`asteria:journal:${token}`).digest("hex").slice(0, 32);
  // Shape it as a UUID: version 5-style variant bits, so the column and the UUID checks
  // in validation.ts both accept it without a special case.
  const hex = `${digest.slice(0, 12)}5${digest.slice(13, 16)}8${digest.slice(17, 32)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface ResolveOptions {
  token: string | null;
  userAgent?: string | null;
  timeZone?: string | null;
  /** Set false for read-only paths that must not create rows (health checks, tests). */
  provision?: boolean;
}

/**
 * Turn a cookie value into a journal.
 *
 * Three cases, in order of likelihood:
 *
 * 1. **An opaque token** — the normal path. One indexed lookup on the token hash, with the
 *    expiry pushed forward on use so a writer is never signed out of their own sky. A
 *    token we have never seen is a browser arriving for the first time.
 * 2. **A UUID** — a cookie minted by the previous build, which used the journal id itself.
 *    The journal is adopted as-is (its stars are untouched) and a fresh token is issued, so
 *    the next request upgrades the cookie. Nothing is lost, and the id stops travelling.
 * 3. **Nothing usable** — handled by the proxy before we get here.
 */
export async function resolveJournal(options: ResolveOptions): Promise<JournalContext> {
  const db = await getDb();
  const device = deviceLabel(options.userAgent ?? null);
  const token = options.token?.trim() || null;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const empty: JournalContext = {
    journalId: "",
    sessionId: null,
    isNew: false,
    seeded: false,
    rotateToken: null,
    device,
  };

  if (token && !isUuid(token)) {
    const tokenHash = hashToken(token);
    const [existing] = await db
      .select({ id: sessions.id, journalId: sessions.journalId, revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    if (existing && !existing.revokedAt) {
      // Refresh on use. Fire-and-forget: failing to record presence must not fail the read,
      // and the session stays valid until its stored expiry either way.
      void db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt, device })
        .where(eq(sessions.id, existing.id))
        .catch(() => undefined);
      await touchJournal(existing.journalId, options.timeZone);
      return { ...empty, journalId: existing.journalId, sessionId: existing.id };
    }

    if (options.provision === false) return empty;

    // A token we minted and have never seen: this browser is new. Every statement is
    // idempotent, so two tabs opening at once converge on the same journal.
    const journalId = deriveJournalId(token);
    await db
      .insert(journals)
      .values({ id: journalId, timeZone: options.timeZone ?? null })
      .onConflictDoNothing();
    const seeded = await ensureSeeded(journalId);
    const [session] = await db
      .insert(sessions)
      .values({ journalId, tokenHash, device, expiresAt })
      .onConflictDoNothing()
      .returning({ id: sessions.id });
    if (!session) {
      const [winner] = await db
        .select({ id: sessions.id, journalId: sessions.journalId })
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);
      return { ...empty, journalId: winner?.journalId ?? journalId, sessionId: winner?.id ?? null };
    }
    return { ...empty, journalId, sessionId: session.id, isNew: true, seeded };
  }

  if (options.provision === false) return empty;

  // A legacy UUID cookie: adopt the journal so no writing is lost, then move the browser
  // onto an opaque token.
  if (token && isUuid(token)) {
    await db.insert(journals).values({ id: token, timeZone: options.timeZone ?? null }).onConflictDoNothing();
    const seeded = await ensureSeeded(token);
    const session = await createSession(token, device);
    return { ...empty, journalId: token, sessionId: session.sessionId, isNew: false, seeded, rotateToken: session.token };
  }

  return empty;
}

/** Stamp a journal as seeded exactly once, and plant the examples for the winner. */
async function ensureSeeded(journalId: string): Promise<boolean> {
  const db = await getDb();
  const [claimed] = await db
    .update(journals)
    .set({ seededAt: new Date() })
    .where(and(eq(journals.id, journalId), isNull(journals.seededAt)))
    .returning({ id: journals.id });
  if (!claimed) return false;
  const { insertSampleStars } = await import("./journal");
  await insertSampleStars(journalId);
  return true;
}

/** Create a session row for a journal, returning the token *once* — it is never stored. */
export async function createSession(
  journalId: string,
  device: string,
): Promise<{ sessionId: string; token: string }> {
  const db = await getDb();
  const token = generateSessionToken();
  const [row] = await db
    .insert(sessions)
    .values({
      journalId,
      tokenHash: hashToken(token),
      device,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .returning({ id: sessions.id });
  return { sessionId: row.id, token };
}

/** Find the journal a recovery key opens. Returns null when nothing answers. */
export async function journalForRecoveryKey(key: string): Promise<string | null> {
  const db = await getDb();
  const hash = recoveryKeyHash(key);
  const [row] = await db
    .select({ id: journals.id })
    .from(journals)
    .where(eq(journals.recoveryKeyHash, hash))
    .limit(1);
  return row?.id ?? null;
}

/** Issue (or replace) a recovery key. The plaintext is returned once and never stored. */
export async function issueRecoveryKey(journalId: string): Promise<string> {
  const db = await getDb();
  const key = generateRecoveryKey();
  await db
    .update(journals)
    .set({ recoveryKeyHash: recoveryKeyHash(key), recoveryKeyCreatedAt: new Date() })
    .where(eq(journals.id, journalId));
  return key;
}

/** Revoke every session for a journal — "sign out everywhere". */
export async function revokeSessions(journalId: string, exceptSessionId?: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.journalId, journalId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.filter(row => row.id !== exceptSessionId).length;
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function isSecureRequest(request: Request): boolean {
  return (
    request.headers.get("x-forwarded-proto") === "https" ||
    new URL(request.url).protocol === "https:"
  );
}

/** Attach a refreshed or upgraded session cookie to a response. */
export function withSessionCookie(response: Response, token: string, secure: boolean): Response {
  response.headers.append("set-cookie", sessionCookie(token, secure));
  return response;
}

async function touchJournal(journalId: string, timeZone?: string | null): Promise<void> {
  try {
    const db = await getDb();
    await db
      .update(journals)
      .set({ lastSeenAt: new Date(), ...(timeZone ? { timeZone } : {}) })
      .where(eq(journals.id, journalId));
  } catch {
    /* Presence tracking is not worth failing a request over. */
  }
}
