import { describe, expect, it } from "vitest";
import { codeOf, describeError, isDatabaseUnavailable, nameOf } from "@/lib/errors";

/**
 * Reading a failure out loud.
 *
 * The case that prompted this file: `@neondatabase/serverless` cannot connect, and raises a
 * browser-style `ErrorEvent` — an object with a perfectly good `message` that is *not* an
 * `instanceof Error`. The reflexive `error instanceof Error ? error.message : String(error)`
 * therefore prints `[object ErrorEvent]`, and the one sentence explaining the deployment
 * failure is thrown away. It arrived as a real symptom: a migration against an unreachable Neon
 * host failed with `ErrorEvent { type: 'error', … }` and nothing else.
 *
 * The stand-in below is faithful to what the driver actually raises (observed, not guessed):
 * a non-`Error` object whose `message`/`type`/`name` live on the prototype and whose `error`
 * property carries the underlying cause.
 */

class ErrorEventLike {
  readonly type: string;
  readonly message: string;
  readonly error?: unknown;
  constructor(type: string, message: string, error?: unknown) {
    this.type = type;
    this.message = message;
    this.error = error;
  }
  get name() {
    return "ErrorEvent";
  }
  toString() {
    return "[object ErrorEvent]";
  }
}

describe("the failure the Neon driver raises", () => {
  it("is reported with its real sentence, not the stringified object", () => {
    const failure = new ErrorEventLike("error", "Received network error or non-101 status code.");
    expect(describeError(failure)).toBe("Received network error or non-101 status code.");
    // The behaviour this replaced, kept as a reminder of why the helper exists:
    expect(String(failure)).toBe("[object ErrorEvent]");
    expect(failure instanceof Error).toBe(false);
  });

  it("is classified as the database being unreachable, so the answer is 503 not 500", () => {
    const failure = new ErrorEventLike("error", "Received network error or non-101 status code.");
    expect(isDatabaseUnavailable(failure)).toBe(true);
    expect(nameOf(failure)).toBe("ErrorEvent");
  });

  it("reaches the underlying error when the outer message is empty", () => {
    const failure = new ErrorEventLike("error", "", new Error("getaddrinfo ENOTFOUND ep-nope.neon.tech"));
    expect(describeError(failure)).toContain("ENOTFOUND");
    expect(isDatabaseUnavailable(failure)).toBe(true);
  });

  it("still says something when there is literally nothing to say", () => {
    expect(describeError(new ErrorEventLike("error", ""))).toBe("transport error (error)");
  });
});

describe("Postgres errors", () => {
  const pgError = (code: string, message: string, detail?: string) =>
    Object.assign(new Error(message), { code, detail });

  it("keeps the code and Postgres's own detail", () => {
    const failure = pgError("28P01", 'password authentication failed for user "asteria"', "role: asteria");
    expect(describeError(failure)).toBe('password authentication failed for user "asteria" (28P01) — role: asteria');
  });

  it("treats a bad password as a real error rather than an outage", () => {
    // 28P01 means the server answered. That is a 500-class problem with a configuration cause,
    // not a 503 — saying "try again later" to a wrong password wastes everybody's time.
    expect(isDatabaseUnavailable(pgError("28P01", "password authentication failed"))).toBe(false);
  });

  it("treats too many connections as an outage, because retrying works", () => {
    expect(isDatabaseUnavailable(pgError("53300", "remaining connection slots are reserved"))).toBe(true);
  });

  it("recognises the socket-level codes node-postgres uses", () => {
    expect(isDatabaseUnavailable(pgError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432"))).toBe(true);
    expect(codeOf(pgError("ETIMEDOUT", "timeout exceeded"))).toBe("ETIMEDOUT");
  });

  it("does not print a code twice when the message already contains it", () => {
    expect(describeError(pgError("ECONNREFUSED", "connect ECONNREFUSED 10.0.0.1:5432"))).toBe(
      "connect ECONNREFUSED 10.0.0.1:5432",
    );
  });

  it("finds a code nested inside a cause", () => {
    const wrapped = new Error("connection failed", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) });
    expect(codeOf(wrapped)).toBe("ECONNREFUSED");
    expect(isDatabaseUnavailable(wrapped)).toBe(true);
  });
});

describe("whatever else gets thrown", () => {
  it("handles a thrown string, which is legal JavaScript", () => {
    expect(describeError("the database went away")).toBe("the database went away");
    expect(nameOf("the database went away")).toBe("string");
  });

  it("handles null and undefined without throwing", () => {
    expect(describeError(null)).toBe("unknown error");
    expect(describeError(undefined)).toBe("unknown error");
  });

  it("survives a circular object", () => {
    const circular: Record<string, unknown> = { type: "error" };
    circular.self = circular;
    expect(describeError(circular)).toBe("transport error (error)");
  });

  it("never returns an empty string, whatever it is handed", () => {
    for (const value of ["", "   ", {}, [], 0, false, Symbol("nope"), () => {}]) {
      expect(describeError(value).length).toBeGreaterThan(0);
    }
  });
});
