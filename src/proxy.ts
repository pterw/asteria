import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/astral";

export function proxy(request: NextRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Please make changes from your own journal." }, { status: 403 });
  }
  const current = request.cookies.get("asteria-journal")?.value;
  if (isUuid(current)) return NextResponse.next();
  const token = crypto.randomUUID();
  request.cookies.set("asteria-journal", token);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set("asteria-journal", token, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
  });
  return response;
}
export const config = { matcher: ["/", "/sky/:path*", "/about", "/api/stars/:path*", "/api/journal/:path*"] };
