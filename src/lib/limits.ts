/**
 * Product limits, in one place, importable from both the server and the browser.
 *
 * These are product decisions, not implementation details: 420 characters is a
 * deliberate ceiling on a moment, because the act this product is built around takes
 * thirty to ninety seconds and an unbounded textarea invites an essay. The interface
 * counts characters against these numbers and the server enforces them, from here.
 */

/** A moment's body. Long enough for a paragraph that matters, short enough to stay one. */
export const MAX_CONTENT = 420;

/** The optional name given to a moment. */
export const MAX_TITLE = 80;

/** A journal's optional display name. */
export const MAX_DISPLAY_NAME = 60;

/** One import may carry this many moments; larger backups are split by the writer. */
export const MAX_IMPORT_MOMENTS = 500;

/** How long a released star can be restored. */
export const UNDO_WINDOW_MS = 30_000;

/** Sessions last a year and are refreshed on use, so a returning writer is not logged out. */
export const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1_000;

/** Events kept per journal for the "how this sky grew" reading. */
export const EVENT_RETENTION = 500;
