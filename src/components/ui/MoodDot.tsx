import type { CSSProperties } from "react";
import { MOODS, type MoodKey } from "@/lib/astral";
export default function MoodDot({ mood }: { mood: MoodKey }) {
  return <span aria-hidden="true" className="mood-dot" style={{ "--mood": MOODS[mood].hex } as CSSProperties} />;
}
