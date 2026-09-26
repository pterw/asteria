/**
 * Text hygiene, in one direction: what a writer typed comes back exactly as typed, minus
 * the things that are not text.
 *
 * Asteria renders user content as *text* through React, so it is not an HTML injection
 * surface to begin with — but the same strings are also written to Postgres, exported to
 * Markdown, embedded in a JSON backup, and rendered into a self-contained atlas document
 * by the Python service. Every one of those is a downstream consumer that may treat
 * `<` as markup, so the stored value is normalised here, once, on the way in.
 *
 * What this is *not*: an HTML sanitiser for content that will be rendered as HTML. There
 * is no such content in this product, and adding one would suggest there is.
 */

/** Characters that are invisible but affect how text is compared, searched or spoofed. */
const INVISIBLE = /[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]/g;

/** C0/C1 controls except tab, newline and carriage return — which the composer allows. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** Runs of three or more newlines collapse to a paragraph break. */
const BLANK_RUN = /\n{3,}/g;

/** `javascript:`, `vbscript:`, `data:text/html` and friends, followed by a colon. */
const PSEUDO_PROTOCOL = /\b(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/gi;

/**
 * Remove tags with a scanner rather than a regex.
 *
 * The naive regex (`/<[^>]*>/`) breaks on a quoted attribute containing `>`, which is
 * exactly where tag-stripping filters leak: `<img alt="a > b" src=x onerror=alert(1)>`
 * survives one pass and leaves `src=x onerror=alert(1)` in the text. This walks the
 * string once, tracks whether it is inside a quoted attribute, and only then looks for
 * the closing bracket. An unterminated `<` (a writer's "3 < 5") is left alone.
 */
function stripTags(input: string): string {
  let out = "";
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char !== "<") {
      out += char;
      index++;
      continue;
    }

    // A comment, or a tag whose name starts with a letter or `/` + letter.
    if (input.startsWith("<!--", index)) {
      const end = input.indexOf("-->", index + 4);
      index = end === -1 ? input.length : end + 3;
      continue;
    }
    const next = input[index + 1] ?? "";
    if (!/[A-Za-z/]/.test(next)) {
      out += char;
      index++;
      continue;
    }

    let cursor = index + 1;
    let quote: string | null = null;
    let closed = -1;
    while (cursor < input.length) {
      const current = input[cursor];
      if (quote) {
        if (current === quote) quote = null;
      } else if (current === '"' || current === "'") {
        quote = current;
      } else if (current === ">") {
        closed = cursor;
        break;
      }
      cursor++;
    }
    if (closed === -1) {
      // No closing bracket: not a tag. Keep the text after the `<` as typed.
      out += char;
      index++;
      continue;
    }
    if (out.endsWith(" ") || out.length === 0) out = out.trimEnd();
    index = closed + 1;
  }
  return out;
}

/**
 * The canonical form of anything a writer typed that will be stored or exported:
 * NFC-normalised, stripped of invisible and control characters, free of markup and
 * pseudo-protocols, with its leading and trailing whitespace removed.
 *
 * Internal whitespace is preserved exactly — a poem's line breaks and a paragraph's
 * deliberate gap are part of the writing.
 */
export function sanitizeText(input: string): string {
  if (typeof input !== "string") return "";
  return stripTags(
    input
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      .replace(CONTROL, "")
      .replace(INVISIBLE, ""),
  )
    .replace(PSEUDO_PROTOCOL, "")
    .replace(/[ \t]+$/gm, "")
    .replace(BLANK_RUN, "\n\n")
    .trim();
}

/** A single-line version, for titles and names. */
export function sanitizeLine(input: string, maxLength = 80): string {
  return sanitizeText(input).replace(/\s*\n\s*/g, " ").slice(0, maxLength).trim();
}

/** Escape the characters that would otherwise become Markdown syntax in an export. */
export function escapeMarkdown(text: string): string {
  if (typeof text !== "string") return "";
  return text.replace(/([\\`*_[\]()#+!|])/g, "\\$1").replace(/^([->])/gm, "\\$1");
}

/**
 * Escape a value for a YAML front-matter block.
 *
 * A title is arbitrary text a writer typed, and an export is a real file that another
 * program will parse: a newline or a leading `-` in a title must not be able to end the
 * document's header, and `"` must not be able to close the quoted scalar early.
 */
export function yamlScalar(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")
    .replace(/[\u0000-\u001f\u007f]/g, "")}"`;
}

/**
 * Escape multiline content for a Markdown blockquote, preserving line structure: every
 * line is prefixed so a paragraph cannot escape the quote and be read as document
 * structure, while `<` and `&` are neutralised for downstream HTML renderers.
 */
export function escapeBlockquoteContent(content: string): string {
  if (typeof content !== "string") return "";
  return content
    .split("\n")
    .map(line => `> ${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}`)
    .join("\n");
}
