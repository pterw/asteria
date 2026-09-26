/**
 * Small, dependency-free predicates shared by server and client.
 *
 * These exist so that a value coming off the wire is checked *once*, with the same rule
 * everywhere. A UUID that the proxy accepts must be a UUID the route handler accepts,
 * or the session layer ends up with a class of input that only some layers believe in.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Session and recovery tokens: 32 bytes of entropy, base64url. Opaque by construction —
 * they carry no journal id, no timestamp and no signature, so there is nothing in them
 * to decode, guess or replay against a different deployment.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{43,86}$/;

export function isOpaqueToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(new Date(value).getTime());
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
