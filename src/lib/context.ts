import { isSecureRequest, resolveJournal, SESSION_COOKIE, sessionCookie, type JournalContext } from "./session";
import { isValidTimeZone } from "./time";

/**
 * The bridge between a request and a journal.
 *
 * Reading the cookie from the request headers (rather than `next/headers`) matters here:
 * the proxy may have *just* minted the token for this very request and forwarded it as a
 * request header, so a route handler that asked the cookie store instead would see a first
 * visit as anonymous and create a second journal. The forwarded header is the truth.
 */
export async function journalFromRequest(request: Request): Promise<JournalContext> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  const timeZone = clientTimeZone(request);
  return resolveJournal({
    token,
    userAgent: request.headers.get("user-agent"),
    timeZone,
  });
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** The writer's zone, when a client passes one it believes in. */
function clientTimeZone(request: Request): string | null {
  const header = request.headers.get("x-asteria-timezone") ?? new URL(request.url).searchParams.get("timeZone");
  return header && isValidTimeZone(header) ? header : null;
}

/**
 * Return a response, attaching a session cookie when one is due.
 *
 * Two situations need it: a legacy UUID cookie being replaced by an opaque token, and a
 * recovery key being claimed on a device that has never seen this journal. Both are
 * one-time, both are the difference between "your sky is here" and "your sky is gone".
 */
export function withJournalCookie(response: Response, context: JournalContext, request: Request): Response {
  if (context.rotateToken) {
    response.headers.append("set-cookie", sessionCookie(context.rotateToken, isSecureRequest(request)));
  }
  return response;
}

/** The context every route needs: a journal, and a way to hand the cookie back. */
export async function requireJournal(request: Request): Promise<JournalContext> {
  const context = await journalFromRequest(request);
  if (!context.journalId) {
    const { unauthorized } = await import("./errors");
    throw unauthorized("Please reload the page to open your journal.");
  }
  return context;
}
