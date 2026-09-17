/**
 * Asteria Content Sanitization & Security Utilities
 *
 * Provides defense-in-depth sanitization for user-generated content (star titles,
 * moment reflections, and prompts) before persistence into PostgreSQL, preventing
 * stored XSS, HTML injection, and malicious control characters.
 */

// Matches complete script and style blocks including their contents
const SCRIPT_BLOCK_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const STYLE_BLOCK_REGEX = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi;

// Matches any remaining HTML tags
const HTML_TAG_REGEX = /<(?:\/?[a-zA-Z][^>]*|!--[\s\S]*?--)>/gi;

// Matches dangerous pseudo-protocols in plain text
const DANGEROUS_PROTOCOLS_REGEX = /(?:javascript|vbscript|data):/gi;

// Control characters (excluding standard newline \n, tab \t, and carriage return \r)
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Sanitizes user-provided plain text before saving to the database.
 * - Strips all script and style blocks along with their contents
 * - Strips all remaining HTML tags
 * - Neutralizes dangerous pseudo-protocols
 * - Strips non-printable ASCII control characters
 * - Trims whitespace
 */
export function sanitizeText(input: string): string {
  if (typeof input !== "string") return "";
  return input
    .replace(CONTROL_CHARS_REGEX, "")
    .replace(SCRIPT_BLOCK_REGEX, "")
    .replace(STYLE_BLOCK_REGEX, "")
    .replace(HTML_TAG_REGEX, "")
    .replace(DANGEROUS_PROTOCOLS_REGEX, "")
    .trim();
}

/**
 * Escapes characters for safe inclusion in exported Markdown documents.
 * Prevents downstream Markdown parsers (Obsidian, GitHub, VS Code, Notion)
 * from executing embedded HTML tags or breaking blockquote formatting.
 */
export function escapeMarkdown(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_#\[\]]/g, "\\$&");
}

/**
 * Escapes multiline content specifically for markdown blockquotes.
 * Escapes HTML angle brackets while preserving line structure with `>` prefixes.
 */
export function escapeBlockquoteContent(content: string): string {
  if (typeof content !== "string") return "";
  return content
    .split("\n")
    .map(line => `> ${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}`)
    .join("\n");
}
