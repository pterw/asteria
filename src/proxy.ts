import { NextRequest, NextResponse } from "next/server";

/**
 * The edge of the application: identity provisioning and response hardening.
 *
 * This runs before every matched request, in the edge runtime, so it can only use web
 * platform APIs — no `node:crypto`, no database. That boundary shapes what belongs here:
 *
 * - **Mint a session token for a browser that has none.** 32 bytes from `getRandomValues`,
 *   base64url. The token is opaque: it is not a journal id, carries no timestamp and no
 *   signature, and is meaningless anywhere but this deployment. Its journal is derived
 *   server-side by HMAC, which is why the cookie never has to contain an identity.
 * - **Upgrade the old cookie.** The previous build put the journal's UUID in this cookie.
 *   Those values are passed through untouched so the database can adopt the journal and
 *   hand back a proper token; a writer who has been here for months does not lose a night.
 * - **Refuse cross-site writes.** A state-changing request that the browser itself marks as
 *   cross-site is rejected before it reaches a route.
 * - **Set security headers**, including a CSP that is strict in production and loosened only
 *   as far as the dev server requires.
 */

const SESSION_COOKIE = "asteria-journal";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{43,86}$/;

function mintToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isUsableCookie(value: string | undefined): boolean {
  if (!value) return false;
  return TOKEN_RE.test(value) || UUID_RE.test(value);
}

function contentSecurityPolicy(development: boolean): string {
  const typekit = "https://use.typekit.net https://p.typekit.net https://fonts.adobe.com";
  return [
    "default-src 'self'",
    // Next.js ships inline bootstrap scripts. A nonce-based policy is the next step, and is
    // tracked in SECURITY.md — 'unsafe-eval' is development-only and never reaches a deploy.
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline' ${typekit}`,
    `font-src 'self' data: ${typekit}`,
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const development = process.env.NODE_ENV !== "production";

  // A write the browser itself labels cross-site never reaches a handler.
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return NextResponse.json(
      { error: "Please make changes from your own journal.", code: "forbidden" },
      { status: 403, headers: { "content-security-policy": contentSecurityPolicy(development) } },
    );
  }

  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  const usable = isUsableCookie(existing);

  if (!usable) {
    const token = mintToken();
    // Forward it as a request cookie so *this* request already has an identity: the route
    // handler and the response then agree, and a first visit does not create two journals.
    request.cookies.set(SESSION_COOKIE, token);
    request.headers.set("cookie", request.cookies.toString());
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
      secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    });
    applySecurityHeaders(response, development);
    return response;
  }

  const response = NextResponse.next();
  applySecurityHeaders(response, development);
  return response;
}

function applySecurityHeaders(response: NextResponse, development: boolean) {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy(development));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");
}

export const config = {
  matcher: ["/", "/sky/:path*", "/about", "/api/:path*"],
};
