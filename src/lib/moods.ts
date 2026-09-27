/**
 * The six feelings, and the vocabulary that hangs off them.
 *
 * A mood is three things at once and they must stay in step: an identity (`key`), the
 * word a writer reads (`label`), and a colour that is the *same string* the canvas
 * draws, the legend dot paints, and the CSS token `--color-*` declares. The hexes are
 * the single source of the palette; `globals.css` mirrors them and
 * `src/test/palette.test.ts` fails if the two ever drift.
 */

export const MOOD_KEYS = ["luminous", "tender", "serene", "electric", "verdant", "vesper"] as const;

export type MoodKey = (typeof MOOD_KEYS)[number];

export interface Mood {
  key: MoodKey;
  /** The word shown to the writer. */
  label: string;
  /** The constellation's name when it is read as a shape in the sky. */
  constellation: string;
  /** The colour, as the canvas and the DOM both need it. */
  hex: string;
  /** One line of orientation, used in tooltips and the composer. */
  blurb: string;
}

export const MOODS: Record<MoodKey, Mood> = {
  luminous: { key: "luminous", label: "Grateful", constellation: "Grateful", hex: "#e6c88d", blurb: "gratitude · small joys" },
  tender: { key: "tender", label: "Whimsical", constellation: "Whimsical", hex: "#dca8b7", blurb: "affection · domestic humor" },
  serene: { key: "serene", label: "Serene", constellation: "Serene", hex: "#9dbdd6", blurb: "calm · clarity" },
  electric: { key: "electric", label: "Energized", constellation: "Energized", hex: "#b8a2da", blurb: "awe · voltage" },
  verdant: { key: "verdant", label: "Depleted", constellation: "Depleted", hex: "#a2c6ab", blurb: "weariness · quiet endurance" },
  vesper: { key: "vesper", label: "Lyrical", constellation: "Lyrical", hex: "#909dd0", blurb: "longing · the in-between" },
};

/** Where each constellation sits on the sky. Six anchors; the journal grows outward. */
export const MOOD_CENTERS: Record<MoodKey, { x: number; y: number }> = {
  luminous: { x: -205, y: -55 },
  tender: { x: 175, y: -75 },
  serene: { x: 135, y: 110 },
  electric: { x: -160, y: 110 },
  verdant: { x: -25, y: -145 },
  vesper: { x: 5, y: 5 },
};

/** Invitations offered inside the composer, rotated so the same one is not always first. */
export const PROMPTS = [
  "What small thing made today lighter?",
  "What would you lose if you forgot it?",
  "When did you feel most like yourself?",
  "Who made the day warmer?",
  "What did you notice when you slowed down?",
  "What is quietly growing?",
  "What surprised you, kindly?",
] as const;

/** 1–5, in the writer's own terms. Index 0 is unused so the number is the index. */
export const INTENSITY_LABELS = ["", "a flicker", "a soft glow", "steady light", "bright", "blinding"] as const;

export function isMoodKey(value: unknown): value is MoodKey {
  return typeof value === "string" && (MOOD_KEYS as readonly string[]).includes(value);
}

/** Never throws, never returns null: an unknown mood reads as the calm one. */
export function moodOf(key: unknown): Mood {
  return isMoodKey(key) ? MOODS[key] : MOODS.serene;
}
