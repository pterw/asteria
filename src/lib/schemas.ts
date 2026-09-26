import { z, type ZodType } from "zod";
import { ApiError } from "./errors";
import { MOOD_KEYS } from "./moods";
import { sanitizeLine, sanitizeText } from "./sanitize";
import { MAX_CONTENT, MAX_IMPORT_MOMENTS, MAX_TITLE } from "./limits";
import { isDayKey } from "./validation";

/**
 * Every payload that crosses the wire is described here, once.
 *
 * Two rules make this the only place validation lives:
 *
 * - **Messages are written for a writer, not a developer.** Zod's defaults ("Too small:
 *   expected string to have >=2 characters") are replaced with the sentence the interface
 *   would have said, so the route layer never has to invent copy for a failure.
 * - **The schema is the type.** `z.infer` produces the TypeScript type the handler uses,
 *   so a field cannot be added to one without the other.
 */

/** Turn a Zod failure into the single sentence a writer should read. */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];

  // Zod's own wording for an unexpected field names the schema's internals ("Unrecognized
  // key(s) in object: 'x'"), which is a developer sentence. A writer gets a sentence about
  // the thing they were doing. Everything else already carries copy this module wrote.
  const message =
    issue?.code === "unrecognized_keys"
      ? "That request included something Asteria does not accept."
      : (issue?.message ?? "That request could not be read.");

  throw new ApiError(422, message, "invalid_request", {
    path: issue?.path.join("."),
    code: issue?.code,
  });
}

/**
 * A tolerant field: run `fn` over whatever arrived, fall back when it cannot be used.
 * Used by the importer, where one malformed row must not reject a whole backup file.
 */
function resilient<T>(fn: (value: unknown) => T, fallback: T) {
  return z.unknown().transform(value => {
    try {
      return fn(value);
    } catch {
      return fallback;
    }
  });
}

/**
 * An instant the writer was living in. Accepts an ISO timestamp, a millisecond number or
 * a bare `YYYY-MM-DD` calendar day, and always yields a `Date`.
 *
 * The range matters: a moment cannot be from before 1900 (a parsing accident, not a
 * memory) and cannot be from tomorrow (a sky has no futures). Both bounds are checked in
 * UTC so they behave identically wherever the server runs.
 */
export const momentDate = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value, ctx): Date => {
    if (value === undefined || value === "") return new Date();
    if (typeof value === "string" && isDayKey(value.slice(0, 10)) && value.length <= 10) {
      // A whole day: noon UTC keeps the date from sliding across a zone edge.
      return new Date(`${value.slice(0, 10)}T12:00:00Z`);
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      ctx.addIssue({ code: "custom", message: "Choose a valid date." });
      return z.NEVER;
    }
    if (parsed.getUTCFullYear() < 1900 || parsed.getTime() > Date.now() + 86_400_000) {
      ctx.addIssue({ code: "custom", message: "Choose a date between 1900 and today." });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * The optional name of a moment.
 *
 * Two shapes of the same field, and the difference matters: `titleField` *defaults* to an
 * empty string, which is right when creating (a moment without a name is normal) and wrong
 * when patching — Zod's `.default()` materialises the key in the parsed output, so a patch
 * of `{ restore: true }` would silently arrive as `{ title: "", restore: true }` and the
 * "restore must be alone" rule would reject a perfectly good undo.
 */
export const titleField = z
  .string({ message: "A name has to be text." })
  .transform(value => sanitizeLine(value, MAX_TITLE))
  .pipe(z.string().max(MAX_TITLE, `Keep the name under ${MAX_TITLE} characters.`))
  .optional()
  .default("");

/** The same field, absent when the caller did not send it. */
export const titlePatchField = z
  .string({ message: "A name has to be text." })
  .transform(value => sanitizeLine(value, MAX_TITLE))
  .pipe(z.string().max(MAX_TITLE, `Keep the name under ${MAX_TITLE} characters.`))
  .optional();

export const contentField = z
  .string({ message: "Write a few words first." })
  .transform(value => sanitizeText(value))
  .pipe(
    z
      .string()
      .min(2, "A moment needs at least 2 characters.")
      .max(MAX_CONTENT, `A moment can hold up to ${MAX_CONTENT} characters.`),
  );

export const moodField = z.enum(MOOD_KEYS, { message: "Choose one of the six feelings." });

export const intensityField = z
  .number({ message: "Brightness has to be a number from 1 to 5." })
  .int("Brightness must be a whole number from 1 to 5.")
  .min(1, "Brightness runs from 1 to 5.")
  .max(5, "Brightness runs from 1 to 5.");

export const starCreateSchema = z
  .object({
    title: titleField,
    content: contentField,
    mood: moodField,
    intensity: intensityField,
    createdAt: momentDate,
    timeZone: z.string().max(64).optional(),
  })
  .strict();

export type StarCreatePayload = z.infer<typeof starCreateSchema>;

export const starPatchSchema = z
  .object({
    title: titlePatchField,
    content: contentField.optional(),
    mood: moodField.optional(),
    intensity: intensityField.optional(),
    createdAt: momentDate.optional(),
    favorite: z.boolean({ message: "Favorite must be true or false." }).optional(),
    /** The undo half of a release. Only meaningful on its own. */
    restore: z.literal(true, { message: "Restore a star in a separate request." }).optional(),
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, { message: "Choose something to update." })
  .refine(value => !(value.restore && Object.keys(value).length > 1), {
    message: "Restore a star in a separate request.",
  });

export type StarPatchPayload = z.infer<typeof starPatchSchema>;

/** Free-text search, as it arrives in a query string. */
export const searchQuerySchema = z.object({
  q: z.string().max(160).optional(),
  mood: z.union([moodField, z.literal("all")]).optional(),
  period: z.enum(["all", "week", "month"]).optional(),
  sort: z.enum(["newest", "oldest", "brightest", "dimmest", "relevance"]).optional(),
  day: z.string().optional(),
  starred: z.enum(["true", "false", "1", "0"]).optional(),
  intensityMin: z.coerce.number().int().min(1).max(5).optional(),
  intensityMax: z.coerce.number().int().min(1).max(5).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  includeSamples: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  timeZone: z.string().max(64).optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Optional settings a writer may set on their own sky. */
export const settingsSchema = z
  .object({
    displayName: z
      .union([z.string(), z.null()])
      .transform(value => (value === null ? null : sanitizeLine(value, 60)))
      .optional(),
    timeZone: z.string().max(64).optional(),
    shareAnonymousMetrics: z.boolean().optional(),
  })
  .strict();

/**
 * Import payloads.
 *
 * Deliberately lenient: a backup file is something a writer made months ago with an
 * older build, and refusing the whole file because one row has a malformed date would be
 * the wrong trade. Individual fields degrade, a moment with no text at all is skipped,
 * and the response reports `imported` and `skipped` honestly rather than pretending.
 */
const importedMomentSchema = z.object({
  id: z.string().optional(),
  title: resilient(value => (typeof value === "string" ? sanitizeLine(value, MAX_TITLE) : ""), ""),
  content: resilient(
    value => (typeof value === "string" ? sanitizeText(value).slice(0, MAX_CONTENT).trim() : ""),
    "",
  ),
  mood: resilient(value => (MOOD_KEYS.includes(value as never) ? (value as string) : "serene"), "serene"),
  intensity: resilient(
    value => (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5 ? Number(value) : 3),
    3,
  ),
  createdAt: resilient(value => {
    const date = typeof value === "string" || typeof value === "number" ? new Date(value) : new Date();
    if (!Number.isFinite(date.getTime())) throw new Error("unparseable");
    if (date.getUTCFullYear() < 1900 || date.getTime() > Date.now() + 86_400_000) throw new Error("out of range");
    return date;
  }, new Date()),
  favorite: resilient(value => value === true, false),
  isSample: resilient(value => value === true, false),
});

export const importSchema = z.looseObject({
  application: z.string().max(40).optional(),
  version: z.number().int().optional(),
  timeZone: z.string().max(64).optional(),
  moments: z
    .array(importedMomentSchema)
    .min(1, "That file has no moments in it.")
    .max(MAX_IMPORT_MOMENTS, `Import up to ${MAX_IMPORT_MOMENTS} moments at a time.`),
  mode: z.enum(["merge", "replace"]).optional().default("merge"),
});

export type ImportPayload = z.infer<typeof importSchema>;
export type ImportedMoment = z.infer<typeof importedMomentSchema>;

/** A recovery key, as typed by a person who will probably include the dashes. */
export const recoveryKeySchema = z.object({
  key: z
    .string({ message: "Paste your recovery key." })
    .min(16, "That key looks too short.")
    .max(128, "That key looks too long."),
});

export const eraseSchema = z
  .object({
    /** The exact phrase the interface asks for, so this cannot happen by accident. */
    confirm: z.literal("release my sky", { message: 'Type "release my sky" to confirm.' }),
  })
  .strict();
