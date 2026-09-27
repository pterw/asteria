import { relations, sql, type SQL } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * `tsvector` has no first-class builder in this Drizzle version, so it is declared
 * here. The only use is the `stars.search` generated column below.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/**
 * Asteria's data model.
 *
 * Three ideas hold the whole thing up:
 *
 * 1. **A journal is the unit of ownership.** Everything a writer owns hangs off
 *    `journals.id`, and that id is never sent to the browser. The browser holds a
 *    session token; the server maps token → journal on every request. Losing the
 *    cookie therefore costs a *session*, not the sky — a recovery key can mint a
 *    new session for the same journal (see `sessions` and `journals.recoveryKeyHash`).
 *
 * 2. **A star's position is decided once, at birth, and never moves.** `x`/`y` are
 *    allocated inside the constellation belonging to the star's feeling under an
 *    advisory lock, so concurrent writes cannot collide and editing an entry never
 *    shifts a light a reader has learned the position of.
 *
 * 3. **Nothing is destroyed by accident.** Star removal is a soft delete with an
 *    undo window (`deletedAt`); erasure of a whole journal is explicit, logged, and
 *    cascades. `journalEvents` records what happened, for the writer's own
 *    "how this sky grew" view and for debugging a live deployment.
 */

/** A writer's private sky. One row per journal; there is no account system. */
export const journals = pgTable(
  "journals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Optional, writer-chosen. Shown nowhere public — there is nowhere public. */
    displayName: varchar("display_name", { length: 60 }),
    /** Last timezone seen from this journal, used for server-side day arithmetic. */
    timeZone: varchar("time_zone", { length: 64 }),
    /** HMAC-SHA256(pepper, normalised recovery key). Never the key itself. */
    recoveryKeyHash: text("recovery_key_hash"),
    recoveryKeyCreatedAt: timestamp("recovery_key_created_at", { withTimezone: true }),
    /** Set when the example sky is planted, so it happens at most once per journal. */
    seededAt: timestamp("seeded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Analytics opt-out, honoured before anything leaves the process. */
    shareAnonymousMetrics: boolean("share_anonymous_metrics").notNull().default(false),
  },
  table => [
    uniqueIndex("journals_recovery_key_idx").on(table.recoveryKeyHash),
    index("journals_last_seen_idx").on(table.lastSeenAt),
  ],
);

/** One row per signed-in browser. The cookie holds the token; the table holds its hash. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => journals.id, { onDelete: "cascade" }),
    /** SHA-256 of the session token. A database leak does not yield a usable cookie. */
    tokenHash: text("token_hash").notNull(),
    /** Human-readable device label, derived server-side from the user agent. */
    device: varchar("device", { length: 48 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  table => [
    uniqueIndex("sessions_token_idx").on(table.tokenHash),
    index("sessions_journal_idx").on(table.journalId, table.expiresAt),
  ],
);

/** One captured moment = one star. */
export const stars = pgTable(
  "stars",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => journals.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 80 }).notNull().default(""),
    content: text("content").notNull(),
    mood: varchar("mood", { length: 24 }).notNull(),
    intensity: smallint("intensity").notNull().default(3),
    x: real("x").notNull(),
    y: real("y").notNull(),
    favorite: boolean("favorite").notNull().default(false),
    isSample: boolean("is_sample").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * Search index, derived and never written by the application. `title` is weighted
     * above `content` so a moment whose *name* matches outranks one that merely
     * mentions the word. Generated rather than maintained by a trigger: the database
     * cannot then hold a row whose index disagrees with its text.
     */
    search: tsvector("search").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(content, '')), 'B')`,
    ),
  },
  table => [
    check("stars_mood_check", sql`${table.mood} in ('luminous','tender','serene','electric','verdant','vesper')`),
    check("stars_intensity_check", sql`${table.intensity} between 1 and 5`),
    check("stars_content_length_check", sql`char_length(${table.content}) between 1 and 420`),
    check("stars_title_length_check", sql`char_length(${table.title}) <= 80`),
    check("stars_coords_check", sql`${table.x} between -100000 and 100000 and ${table.y} between -100000 and 100000`),
    index("stars_journal_created_idx").on(table.journalId, table.createdAt),
    index("stars_search_idx").using("gin", table.search),
    index("stars_journal_mood_idx").on(table.journalId, table.mood),
  ],
);

/**
 * What happened, in order. Two consumers: the writer's own "how this sky grew"
 * reading, and an operator trying to understand a live deployment without asking
 * the database for its whole contents.
 */
export const journalEvents = pgTable(
  "journal_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    journalId: uuid("journal_id").references(() => journals.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 40 }).notNull(),
    starId: uuid("star_id"),
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index("journal_events_journal_idx").on(table.journalId, table.createdAt)],
);

/**
 * Rate-limit buckets in the database, not in the process.
 *
 * The previous implementation kept a `Map` in module scope. On Vercel that means
 * every concurrent lambda has its own counter, so a caller who triggers ten
 * instances gets ten times the intended allowance — the limit only exists on a
 * single long-lived server. A fixed window in Postgres costs one upsert per
 * request and is correct everywhere.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  table => [
    primaryKey({ columns: [table.bucket, table.windowStart] }),
    index("rate_limits_expiry_idx").on(table.expiresAt),
  ],
);

export const journalRelations = relations(journals, ({ many }) => ({
  stars: many(stars),
  sessions: many(sessions),
}));

export const starRelations = relations(stars, ({ one }) => ({
  journal: one(journals, { fields: [stars.journalId], references: [journals.id] }),
}));

export type JournalRow = typeof journals.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type StarRow = typeof stars.$inferSelect;
export type NewStarRow = typeof stars.$inferInsert;
export type JournalEventRow = typeof journalEvents.$inferSelect;
