import { describe, expect, it } from "vitest";
import {
  escapeBlockquoteContent,
  escapeMarkdown,
  sanitizeLine,
  sanitizeText,
  yamlScalar,
} from "@/lib/sanitize";

/**
 * Text hygiene.
 *
 * The stored string is the one that ends up in Postgres, in a JSON backup, in a Markdown
 * export and in the Python atlas renderer. These tests are written from the attacks and the
 * accidents rather than from the implementation: the quoted-attribute case is here because
 * a naive `<[^>]*>` scanner leaks it, the `3 < 5` case is here because an over-eager
 * scanner eats it, and the bidi cases are here because they are invisible and therefore
 * never caught by eye.
 */

describe("sanitizeText", () => {
  it("strips markup but keeps the sentence around it", () => {
    expect(sanitizeText("<b>A fine</b> afternoon")).toBe("A fine afternoon");
    expect(sanitizeText("<script>alert(1)</script>Safe words")).toBe("alert(1)Safe words");
    expect(sanitizeText("before <!-- a comment --> after")).toBe("before  after");
  });

  it("does not fall for a quoted `>` inside a tag", () => {
    // The classic bypass: one pass of `<[^>]*>` leaves `src=x onerror=alert(1)` behind.
    expect(sanitizeText('<img alt="a > b" src=x onerror=alert(1)>Words')).toBe("Words");
    expect(sanitizeText("a <a title='>' href='#'>link</a> b")).toBe("a link b");
  });

  it("leaves an unterminated angle bracket alone", () => {
    // A writer's arithmetic is not a broken tag: there is no `>`, so nothing is stripped.
    expect(sanitizeText("3 < 5 and 7 > 2")).toBe("3 < 5 and 7 > 2");
    expect(sanitizeText("the queue was < 10 people")).toBe("the queue was < 10 people");
  });

  it("removes pseudo-protocols that a downstream renderer might follow", () => {
    expect(sanitizeText("javascript:alert(1)")).toBe("alert(1)");
    expect(sanitizeText("JavaScript: alert(1)")).toBe("alert(1)");
    expect(sanitizeText("data: text/html;base64,PHNjcmlwdD4=")).not.toMatch(/data\s*:\s*text\/html/i);
    // A colon that is part of ordinary prose survives.
    expect(sanitizeText("Note: I was late")).toBe("Note: I was late");
  });

  it("removes what cannot be seen", () => {
    expect(sanitizeText("zero\u200bwidth")).toBe("zerowidth");
    expect(sanitizeText("soft\u00adhyphen")).toBe("softhyphen");
    expect(sanitizeText("bidi\u202eoverride")).toBe("bidioverride");
    expect(sanitizeText("line\u2028separator")).toBe("lineseparator");
    expect(sanitizeText("null\u0000byte")).toBe("nullbyte");
    expect(sanitizeText("bell\u0007")).toBe("bell");
  });

  it("keeps the shape of the writing", () => {
    // Line breaks and deliberate gaps are part of a journal entry, not whitespace to tidy.
    expect(sanitizeText("first line\nsecond line")).toBe("first line\nsecond line");
    expect(sanitizeText("paragraph\n\n\ntoo many blanks")).toBe("paragraph\n\ntoo many blanks");
    expect(sanitizeText("carriage\r\nreturn")).toBe("carriage\nreturn");
    expect(sanitizeText("  padded  ")).toBe("padded");
    expect(sanitizeText("trailing spaces   \nnext")).toBe("trailing spaces\nnext");
  });

  it("normalises to NFC so two spellings of one word are one word", () => {
    const decomposed = "cafe\u0301"; // e + combining acute
    expect(sanitizeText(decomposed)).toBe("café");
  });

  it("survives a value that is not a string", () => {
    expect(sanitizeText(undefined as unknown as string)).toBe("");
    expect(sanitizeText(null as unknown as string)).toBe("");
  });
});

describe("sanitizeLine", () => {
  it("flattens a multi-line title onto one line", () => {
    expect(sanitizeLine("a\nb\n\nc")).toBe("a b c");
  });

  it("enforces its limit on the sanitised value", () => {
    expect(sanitizeLine("x".repeat(200), 80)).toHaveLength(80);
    // The limit applies after markup is removed, so tags cannot be used to smuggle length.
    expect(sanitizeLine(`<b>${"x".repeat(200)}</b>`, 80)).toHaveLength(80);
  });
});

describe("export escaping", () => {
  it("keeps a title from ending the YAML front matter", () => {
    expect(yamlScalar('a "quoted" name')).toBe('"a \\"quoted\\" name"');
    expect(yamlScalar("line one\nline two")).toBe('"line one\\nline two"');
    expect(yamlScalar("back\\slash")).toBe('"back\\\\slash"');
    expect(yamlScalar("- looks like a list")).toBe('"- looks like a list"');
  });

  it("escapes Markdown syntax that a writer typed on purpose", () => {
    expect(escapeMarkdown("2 * 3 = 6")).toBe("2 \\* 3 = 6");
    expect(escapeMarkdown("# not a heading")).toBe("\\# not a heading");
    expect(escapeMarkdown("> not a quote")).toBe("\\> not a quote");
  });

  it("quotes every line of a blockquote so it cannot escape the quote", () => {
    const quoted = escapeBlockquoteContent("first\n\n> nested & <angle>");
    expect(quoted.split("\n")).toEqual(["> first", "> ", "> &gt; nested &amp; &lt;angle&gt;"]);
  });
});
