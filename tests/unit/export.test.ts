import { describe, expect, it } from "vitest";
import { EXPORT_VERSION, buildBundle, checksumMoments, renderAtlasFallback, renderMarkdown } from "@/lib/export";
import type { StarDto } from "@/lib/stars";

/**
 * Taking your words with you.
 *
 * An export is the one feature where being wrong is unrecoverable: it is what a writer
 * keeps if the app disappears. So the tests are about the two things that would make a
 * backup untrustworthy — a checksum that changes when nothing did (or holds still when
 * something did), and any way for the exported file to contain something the writer did
 * not write, or to lose something they did.
 */

const star = (overrides: Partial<StarDto> = {}): StarDto => ({
  id: "11111111-2222-4333-8444-555555555555",
  title: "",
  content: "The street smelled of wet stone.",
  mood: "serene",
  intensity: 3,
  x: 12.5,
  y: -40.25,
  createdAt: "2026-03-06T22:30:00.000Z",
  updatedAt: "2026-03-06T22:31:00.000Z",
  favorite: false,
  isSample: false,
  ...overrides,
});

describe("checksums", () => {
  it("holds still when only the metadata moves", () => {
    const original = star();
    const starredLater = star({ favorite: true, updatedAt: "2026-09-01T00:00:00.000Z" });
    expect(checksumMoments([starredLater])).toBe(checksumMoments([original]));
  });

  it("changes when a word changes", () => {
    const original = checksumMoments([star()]);
    expect(checksumMoments([star({ content: "The street smelled of wet ston." })])).not.toBe(original);
    expect(checksumMoments([star({ title: "A name" })])).not.toBe(original);
    expect(checksumMoments([star({ mood: "tender" })])).not.toBe(original);
    expect(checksumMoments([star({ intensity: 4 })])).not.toBe(original);
  });

  it("is stable for an empty journal and is versioned by shape, not by guesswork", () => {
    expect(checksumMoments([])).toMatch(/^sha256:[0-9a-f]{32}$/);
    expect(checksumMoments([])).toBe(checksumMoments([]));
  });
});

describe("the JSON bundle", () => {
  it("is versioned, ordered and summarised", () => {
    const bundle = buildBundle(
      [
        star({ id: "b", createdAt: "2026-03-07T22:30:00.000Z" }),
        star({ id: "a", createdAt: "2026-03-06T22:30:00.000Z" }),
      ],
      "America/Toronto",
      new Date("2026-09-26T12:00:00.000Z"),
    );
    expect(bundle.version).toBe(EXPORT_VERSION);
    expect(bundle.format).toBe("asteria.journal");
    expect(bundle.exportedAt).toBe("2026-09-26T12:00:00.000Z");
    expect(bundle.moments.map(moment => moment.id)).toEqual(["a", "b"]);
    expect(bundle.summary).toEqual({ moments: 2, nights: 2, first: "2026-03-06", last: "2026-03-07" });
    expect(bundle.moments[0].day).toBe("2026-03-06");
    expect(bundle.checksum).toBe(checksumMoments(bundle.moments));
  });

  it("carries nothing that could be used to claim the journal it came from", () => {
    const serialised = JSON.stringify(buildBundle([star()], "UTC", new Date("2026-09-26T12:00:00Z")));
    // No journal id, no session token, no recovery key, no device list. The only ids in the
    // file are the moments' own, which is what makes an export safe to email to yourself.
    for (const secret of ["journalId", "session", "recovery", "token", "device", "asteria-journal"]) {
      expect(serialised.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });
});

describe("the Markdown reading copy", () => {
  const moments = [
    star({ id: "a", title: "A walk after rain", createdAt: "2026-03-06T22:30:00.000Z" }),
    star({ id: "b", title: "", createdAt: "2026-03-06T23:50:00.000Z", content: "Late, and still awake." }),
    star({ id: "c", title: "Morning", createdAt: "2026-03-09T12:00:00.000Z", mood: "luminous" }),
  ];

  it("opens with front matter another program can parse", () => {
    const markdown = renderMarkdown(moments, { timeZone: "America/Toronto", now: new Date("2026-09-26T12:00:00Z") });
    expect(markdown.startsWith("---\n")).toBe(true);
    const frontMatter = markdown.split("---")[1];
    expect(frontMatter).toContain("application: Asteria");
    expect(frontMatter).toContain(`version: ${EXPORT_VERSION}`);
    expect(frontMatter).toContain('timezone: "America/Toronto"');
    expect(frontMatter).toContain("moments: 3");
    expect(frontMatter).toContain("nights: 2");
    expect(frontMatter).toContain("checksum: sha256:");
  });

  it("groups by night, oldest first, and names the unnamed", () => {
    const markdown = renderMarkdown(moments, { timeZone: "America/Toronto" });
    const body = markdown.split("---").slice(2).join("---");
    const headings = body.match(/^## .+$/gm) ?? [];
    expect(headings).toHaveLength(2);
    expect(body.indexOf("A walk after rain")).toBeLessThan(body.indexOf("Morning"));
    // A moment without a name still appears, under words taken from its own first line.
    expect(body).toContain("Late, and still awake.");
  });

  it("escapes a title that would otherwise break the document's structure", () => {
    // A title is arbitrary text a writer typed, and this file is parsed by other programs.
    const markdown = renderMarkdown(
      [star({ title: "--- end of front matter", content: "> quoted and <angled> & joined" })],
      { timeZone: "UTC" },
    );
    const frontMatter = markdown.split("---")[1];
    const rest = markdown.split("---").slice(2).join("---");
    expect(frontMatter).toContain("application: Asteria");
    expect(markdown).toContain("\\--- end of front matter"); // the heading is inert
    // Content stays inside its blockquote, with HTML-ish characters neutralised for any
    // downstream renderer that treats the Markdown body as HTML.
    expect(rest).toContain("&gt; quoted and &lt;angled&gt; &amp; joined");
    expect(rest.split("\n").find(line => line.includes("quoted"))).toMatch(/^> /);
  });
});

describe("the local atlas fallback", () => {
  it("is a whole document with nothing to fetch", () => {
    const html = renderAtlasFallback([star(), star({ id: "b", mood: "tender" })], {
      timeZone: "America/Toronto",
      title: "Your sky",
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<script");
    expect(html).toContain("2 moments");
  });

  it("escapes the words it draws", () => {
    const html = renderAtlasFallback([star({ title: "<b>bold</b>", content: "5 < 6 & rising" })], {
      timeZone: "UTC",
    });
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("5 &lt; 6 &amp; rising");
  });

  it("survives a journal with nothing in it", () => {
    const html = renderAtlasFallback([], { timeZone: "UTC", title: "An empty sky" });
    expect(html).toContain("An empty sky");
    expect(html).toContain("<svg");
  });
});
