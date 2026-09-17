import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/astral";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://use.typekit.net https://p.typekit.net",
  "font-src 'self' https://use.typekit.net https://fonts.adobe.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://use.typekit.net https://performance.typekit.net",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function applySecurityHeaders(headers: Headers) {
  headers.set("Content-Security-Policy", CSP_DIRECTIVES);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

export function proxy(request: NextRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("sec-fetch-site") === "cross-site") {
    const forbidden = NextResponse.json({ error: "Please make changes from your own journal." }, { status: 403 });
    applySecurityHeaders(forbidden.headers);
    return forbidden;
  }
  const current = request.cookies.get("asteria-journal")?.value;
  if (isUuid(current)) {
    const nextResponse = NextResponse.next();
    applySecurityHeaders(nextResponse.headers);
    return nextResponse;
  }
  const token = crypto.randomUUID();
  request.cookies.set("asteria-journal", token);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set("asteria-journal", token, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
  });
  applySecurityHeaders(response.headers);
  return response;
}
export const config = { matcher: ["/", "/sky/:path*", "/about", "/api/stars/:path*", "/api/journal/:path*"] };
