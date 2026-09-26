/**
 * One place that knows the product's public identity and its own origin.
 *
 * `siteUrl()` prefers an explicit `NEXT_PUBLIC_SITE_URL` (set it on Vercel to the
 * canonical domain so canonicals and OG tags point at production, not at a preview
 * deployment), then falls back to the deployment's own URL, then to localhost.
 */
export const SITE_NAME = "Asteria";
export const SITE_TAGLINE = "your life, as a night sky";
export const SITE_DESCRIPTION =
  "A journal for the quiet hours. Capture one small moment a night — Asteria hangs it as a star, and your days gather into constellations you can walk back through.";

const FALLBACK_ORIGIN = "http://localhost:3000";

export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return FALLBACK_ORIGIN;
}

export function siteUrl(): URL {
  try {
    return new URL(siteOrigin());
  } catch {
    return new URL(FALLBACK_ORIGIN);
  }
}
