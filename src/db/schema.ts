import { boolean, index, integer, pgTable, real, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** A browser's journal. The id lives only in an HttpOnly cookie — it is never a client-supplied field. */
export const journals = pgTable("journals", {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One captured moment = one star. `x`/`y` are fixed at creation inside the
 * constellation belonging to its feeling, so editing never moves a light.
 */
export const stars = pgTable("stars", {
  id: uuid("id").defaultRandom().primaryKey(),
  journalId: uuid("journal_id").references(() => journals.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 80 }).notNull().default(""),
  content: text("content").notNull(),
  mood: varchar("mood", { length: 24 }).notNull(),
  intensity: integer("intensity").notNull().default(3),
  x: real("x").notNull(),
  y: real("y").notNull(),
  favorite: boolean("favorite").notNull().default(false),
  isSample: boolean("is_sample").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, table => [index("stars_journal_date_idx").on(table.journalId, table.createdAt)]);

export type StarRow = typeof stars.$inferSelect;
