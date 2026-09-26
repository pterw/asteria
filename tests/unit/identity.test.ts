import { beforeAll, describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  deriveJournalId,
  deviceLabel,
  generateRecoveryKey,
  generateSessionToken,
  hashToken,
  isSecureRequest,
  normalizeRecoveryKey,
  recoveryKeyHash,
  sessionCookie,
  withSessionCookie,
} from "@/lib/session";

/**
 * Identity, and the two things it has to be: unguessable, and recoverable.
 *
 * There is no account, no email and no password reset in this product. The cookie is the
 * account on a device and the recovery key is the account everywhere else, so the tests
 * that matter here are the ones about *derivation* (the same browser must always land on
 * the same journal, even when two requests race) and about *normalisation* (a key written
 * down by hand, then typed with lowercase and the wrong letter, must still open the right
 * sky).
 */

beforeAll(() => {
  // Not a secret, just the value every deployment sets. It has to be long enough that the
  // development fallback is not used, so the tests exercise the real code path.
  process.env.ASTERIA_SECRET = "test-secret-that-is-long-enough";
});

describe("session tokens", () => {
  it("are 32 bytes of base64url, and never the same twice", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(token).not.toContain("=");
    }
  });

  it("are stored only as a hash", () => {
    const token = generateSessionToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash); // stable, so lookup works
    expect(hashToken(generateSessionToken())).not.toBe(hash);
  });
});

describe("deriving a journal id from a token", () => {
  it("is deterministic, which is what makes a first visit safe", () => {
    // The trick the whole first-contact story rests on: two concurrent requests carrying
    // the same brand-new cookie compute the *same* journal id, so there is no race to lose
    // and no orphan journal to clean up.
    const token = generateSessionToken();
    expect(deriveJournalId(token)).toBe(deriveJournalId(token));
    expect(deriveJournalId(token)).not.toBe(deriveJournalId(generateSessionToken()));
  });

  it("shapes the result as a UUID a database will accept", () => {
    for (let index = 0; index < 50; index++) {
      // Version 5-style variant bits, so `uuid` columns, indexes and validators all agree.
      expect(deriveJournalId(generateSessionToken())).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("does not leak the token it came from", () => {
    const token = generateSessionToken();
    expect(deriveJournalId(token)).not.toContain(token.slice(0, 8));
  });
});

describe("recovery keys", () => {
  it("are five groups of five, from an alphabet with no ambiguous letters", () => {
    for (let index = 0; index < 100; index++) {
      const key = generateRecoveryKey();
      expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
      // No I, L, O or U: the letters a person misreads when copying a key by hand.
      expect(key).not.toMatch(/[ILOU]/);
    }
  });

  it("does not repeat itself", () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateRecoveryKey()));
    expect(keys.size).toBe(500);
  });

  it("normalises the mistakes a person actually makes", () => {
    const key = "K7QM4-9RT2X-4H8NP-2VWZ6-3CFGJ";
    expect(normalizeRecoveryKey("k7qm4-9rt2x-4h8np-2vwz6-3cfgj")).toBe("K7QM49RT2X4H8NP2VWZ63CFGJ");
    expect(normalizeRecoveryKey("  K7QM4 9RT2X 4H8NP 2VWZ6 3CFGJ  ")).toBe("K7QM49RT2X4H8NP2VWZ63CFGJ");
    // The substitutions that make the alphabet worth choosing: O reads as 0, I and L as 1.
    expect(normalizeRecoveryKey("OOOOO-IIIII-LLLLL")).toBe("000001111111111");
    // U does not exist in the alphabet, so a typed U can only be a misread V.
    expect(normalizeRecoveryKey("UUUUU")).toBe("VVVVV");
  });

  it("hashes to the same value however it was typed", () => {
    const key = generateRecoveryKey();
    const canonical = recoveryKeyHash(key);
    expect(recoveryKeyHash(key.toLowerCase())).toBe(canonical);
    expect(recoveryKeyHash(key.replace(/-/g, " "))).toBe(canonical);
    expect(recoveryKeyHash(` ${key} `)).toBe(canonical);
    expect(recoveryKeyHash(generateRecoveryKey())).not.toBe(canonical);
  });

  it("is stored as an HMAC, not as the key itself", () => {
    const key = generateRecoveryKey();
    const hash = recoveryKeyHash(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
    expect(hash).not.toContain(normalizeRecoveryKey(key));
  });
});

describe("the cookie", () => {
  it("is HttpOnly, SameSite=Lax, scoped to the whole site and long-lived", () => {
    const cookie = sessionCookie("token-value", false);
    expect(cookie).toContain(`${SESSION_COOKIE}=token-value`);
    expect(cookie).toContain("HttpOnly"); // unreadable from JavaScript
    expect(cookie).toContain("SameSite=Lax"); // not sent on cross-site POSTs
    expect(cookie).toContain("Path=/");
    expect(cookie).toMatch(/Max-Age=\d{6,}/);
    expect(cookie).not.toContain("Secure"); // http://localhost is not https
    expect(sessionCookie("token-value", true)).toContain("Secure");
  });

  it("can be cleared in the same shape it was set", () => {
    const cleared = clearSessionCookie(true);
    expect(cleared).toContain(`${SESSION_COOKIE}=;`);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Secure");
  });

  it("is appended to a response rather than replacing one", () => {
    const response = new Response("{}", { headers: { "set-cookie": "other=1" } });
    withSessionCookie(response, "fresh-token", false);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[1]).toContain("fresh-token");
  });

  it("is only marked Secure when the request really is https", () => {
    expect(isSecureRequest(new Request("https://asteria.example/sky"))).toBe(true);
    expect(isSecureRequest(new Request("http://localhost:3000/sky"))).toBe(false);
    // Vercel terminates TLS in front of the function, so the forwarded header is the truth.
    expect(isSecureRequest(new Request("http://internal/sky", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
  });
});

describe("device labels", () => {
  it("names a browser and a platform, and nothing more", () => {
    const chromeOnMac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    expect(deviceLabel(chromeOnMac)).toBe("Chrome on macOS");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1")).toBe("Safari on iOS");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/131.0.0.0")).toBe("Edge on Windows");
    expect(deviceLabel(null)).toBe("A browser");
    expect(deviceLabel("curl/8.5.0")).toBe("A browser"); // unrecognised is not an error
  });
});
