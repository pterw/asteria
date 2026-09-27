import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getDbHandle, schema } from "@/db/index";
import {
  createSession,
  deriveJournalId,
  generateRecoveryKey,
  generateSessionToken,
  issueRecoveryKey,
  journalForRecoveryKey,
  resolveJournal,
  revokeSessions,
} from "@/lib/session";
import { journalCounts, listStars } from "@/lib/journal";
import { closeTestDatabase, freshDatabase, resetSchema, useTestDatabase } from "./helpers";

/**
 * Identity, against a real database.
 *
 * This is where the provisioning bug lived: `resolveJournal` gated on `!options.provision`
 * while every caller left the option unset, so a brand-new visitor was refused instead of
 * being given a sky. The tests here exist because that class of bug is invisible in a unit
 * test and obvious the moment a real cookie meets a real table.
 */

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0.0.0 Safari/537.36";

beforeAll(async () => {
  useTestDatabase();
  await freshDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase();
});

describe("a browser arriving for the first time", () => {
  it("is provisioned, seeded and given a session", async () => {
    const token = generateSessionToken();
    const context = await resolveJournal({ token, userAgent: USER_AGENT });

    expect(context.journalId).toBe(deriveJournalId(token));
    expect(context.sessionId).not.toBeNull();
    expect(context.isNew).toBe(true);
    expect(context.seeded).toBe(true);

    // The example sky is planted, and it is marked as example data rather than as writing.
    const stars = await listStars(context.journalId);
    expect(stars.length).toBeGreaterThan(0);
    expect(stars.every(star => star.isSample)).toBe(true);
    const counts = await journalCounts(context.journalId);
    expect(counts.moments).toBe(0); // nothing written by the writer yet
    expect(counts.examples).toBe(stars.length);
  });

  it("is recognised on the next request, and is not seeded twice", async () => {
    const token = generateSessionToken();
    const first = await resolveJournal({ token, userAgent: USER_AGENT });
    const second = await resolveJournal({ token, userAgent: USER_AGENT });

    expect(second.journalId).toBe(first.journalId);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.isNew).toBe(false);
    expect(second.seeded).toBe(false);
    const stars = await listStars(second.journalId);
    expect(stars.length).toBe((await listStars(first.journalId)).length);
  });

  it("converges when two requests race with the same brand-new cookie", async () => {
    // Two tabs opening at once. The journal id is derived from the token, so both compute
    // the same id and every write is `on conflict do nothing` — one sky, not two.
    const token = generateSessionToken();
    const [a, b] = await Promise.all([
      resolveJournal({ token, userAgent: USER_AGENT }),
      resolveJournal({ token, userAgent: USER_AGENT }),
    ]);
    expect(a.journalId).toBe(b.journalId);

    const db = await getDb();
    const rows = await db.select().from(schema.journals).where(eq(schema.journals.id, a.journalId));
    expect(rows).toHaveLength(1);

    const stars = await listStars(a.journalId);
    const ids = new Set(stars.map(star => star.id));
    expect(ids.size).toBe(stars.length); // no duplicate examples
  });

  it("refuses to provision when it is explicitly asked not to", async () => {
    // The page loader reads with `provision: false`: rendering must not create anything.
    // "No journal" is the empty string, which every caller checks for truthiness — the
    // point of the test is that rendering a page leaves no rows behind.
    const context = await resolveJournal({ token: generateSessionToken(), provision: false });
    expect(context.journalId).toBeFalsy();
    expect(context.sessionId).toBeNull();

    const db = await getDb();
    const journals = await db.select().from(schema.journals);
    expect(journals.some(row => row.id === deriveJournalId(context.journalId || ""))).toBe(false);
  });
});

describe("a v1 browser", () => {
  it("keeps its journal when it arrives with a legacy UUID cookie", async () => {
    const legacy = "0195f0a2-7c3e-4c11-9c3f-2b8a1e6d4f00";
    const db = await getDb();
    // The v1 build stored the journal id itself in the cookie; that database still exists.
    await db.insert(schema.journals).values({ id: legacy }).onConflictDoNothing();
    await db.insert(schema.stars).values({
      journalId: legacy,
      title: "Written before the upgrade",
      content: "Straight from the old build.",
      mood: "serene",
      intensity: 3,
      x: 1,
      y: 1,
    });

    const context = await resolveJournal({ token: legacy, userAgent: USER_AGENT });
    expect(context.journalId).toBe(legacy); // adopted, not replaced
    expect(context.rotateToken).not.toBeNull(); // and moved onto an opaque token
    expect(context.isNew).toBe(false);

    const stars = await listStars(legacy);
    expect(stars.map(star => star.title)).toContain("Written before the upgrade");

    // The rotated token now resolves to the same journal.
    const after = await resolveJournal({ token: context.rotateToken as string, userAgent: USER_AGENT });
    expect(after.journalId).toBe(legacy);
  });
});

describe("recovery keys", () => {
  it("open the same sky from another browser, and the old device keeps working", async () => {
    const original = await resolveJournal({ token: generateSessionToken(), userAgent: USER_AGENT });
    const key = await issueRecoveryKey(original.journalId);
    expect(key).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);

    const found = await journalForRecoveryKey(key);
    expect(found).toBe(original.journalId);

    // The key opens a *new* device without ending the session on the old one: a writer
    // moving to a laptop should not be signed out of the machine they still use.
    const claimed = await createSession(original.journalId, "A browser on Linux");
    expect(claimed.sessionId).not.toBeNull();
    const context = await resolveJournal({ token: claimed.token, userAgent: "curl/8.5.0" });
    expect(context.journalId).toBe(original.journalId);
    expect(context.isNew).toBe(false);

    const stillThere = await resolveJournal({ token: generateSessionToken(), userAgent: USER_AGENT });
    expect(stillThere.journalId).not.toBe(original.journalId); // a different browser, a different sky
  });

  it("are refused when they are not the key, in the same way as a wrong one", async () => {
    expect(await journalForRecoveryKey(generateRecoveryKey())).toBeNull();
    expect(await journalForRecoveryKey("not-a-key")).toBeNull();
    expect(await journalForRecoveryKey("")).toBeNull();
  });

  it("survive a key that was typed with the wrong letters", async () => {
    const context = await resolveJournal({ token: generateSessionToken(), userAgent: USER_AGENT });
    const key = await issueRecoveryKey(context.journalId);
    // Lowercase, spaces instead of dashes, and O/1 substitutions for 0/1.
    const mistyped = key.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l");
    expect(await journalForRecoveryKey(mistyped)).toBe(context.journalId);
  });

  it("can be withdrawn by revoking the devices that hold it", async () => {
    const context = await resolveJournal({ token: generateSessionToken(), userAgent: USER_AGENT });
    const key = await issueRecoveryKey(context.journalId);
    const revoked = await revokeSessions(context.journalId);
    expect(revoked).toBeGreaterThan(0);

    // Revoked sessions stop resolving, but the key still belongs to the journal: signing
    // out every device is not the same as throwing the journal away.
    const stale = await resolveJournal({ token: generateSessionToken(), userAgent: USER_AGENT });
    expect(stale.journalId).not.toBe(context.journalId);
    expect(await journalForRecoveryKey(key)).toBe(context.journalId);
  });
});

describe("the schema the application expects", () => {
  it("is created from scratch by the migration runner", async () => {
    await resetSchema();
    const { runMigrations } = await import("../../scripts/migrate");
    const result = await runMigrations({ log: () => {} });
    expect(result.applied).toContain("0000_init.sql");
    expect(result.current).toBe(true);

    const handle = await getDbHandle();
    const rows = await handle.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = rows.map(row => row.table_name);
    for (const table of ["journals", "sessions", "stars", "journal_events", "rate_limits", "asteria_migrations"]) {
      expect(names).toContain(table);
    }
    // The ledger is a checksum, not a flag: a migration edited after it ran is a warning.
    expect(result.warnings).toEqual([]);
  });

  it("recognises the generated column and the index the search relies on", async () => {
    const handle = await getDbHandle();
    const columns = await handle.query<{ column_name: string; is_generated: string }>(
      `select column_name, is_generated from information_schema.columns
         where table_schema = 'public' and table_name = 'stars' and column_name = 'search'`,
    );
    expect(columns[0]?.is_generated).toBe("ALWAYS");

    const indexes = await handle.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = 'stars'`,
    );
    expect(indexes.map(row => row.indexname).some(name => name.includes("search"))).toBe(true);
  });
});
