import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/**
 * The card that shows up when somebody shares Asteria.
 *
 * `layout.tsx` pointed at `/opengraph-image` before this file existed, so every share of the
 * deployed app rendered without an image — the kind of gap that is invisible in development
 * and obvious the first time you paste the link into a group chat.
 *
 * Drawn rather than photographed, and drawn from the same palette as the sky: the stars are
 * placed from a fixed list so the card is identical on every render (an OG image that changes
 * between requests looks like a bug to crawlers and to people).
 */

export const alt = `${SITE_NAME} — your life, as a night sky`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BACKGROUND = "#0a0d15";
const GOLD = "#dfc28d";
const INK = "#f5f4ef";
const MUTED = "#98a0b4";

/** Deterministic constellation: x, y in percentages, and the stars it threads through. */
const STARS: { x: number; y: number; r: number; glow?: boolean }[] = [
  { x: 9, y: 24, r: 2 },
  { x: 16, y: 44, r: 1.4 },
  { x: 24, y: 33, r: 2.6, glow: true },
  { x: 33, y: 52, r: 1.6 },
  { x: 41, y: 38, r: 2 },
  { x: 52, y: 62, r: 1.4 },
  { x: 61, y: 47, r: 2.4, glow: true },
  { x: 70, y: 26, r: 1.6 },
  { x: 78, y: 41, r: 2 },
  { x: 88, y: 31, r: 2.8, glow: true },
  { x: 94, y: 58, r: 1.4 },
  { x: 68, y: 78, r: 1.6 },
  { x: 47, y: 84, r: 1.2 },
  { x: 21, y: 72, r: 1.4 },
];

const THREADS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [6, 11], [11, 12], [12, 13], [13, 1],
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: `radial-gradient(120% 90% at 50% 110%, #16203a 0%, ${BACKGROUND} 55%)`,
          padding: "68px 76px",
          fontFamily: "sans-serif",
        }}
      >
        <svg width="1200" height="630" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", top: 0, left: 0 }}>
          {THREADS.map(([from, to], index) => (
            <line
              key={index}
              x1={STARS[from].x}
              y1={STARS[from].y}
              x2={STARS[to].x}
              y2={STARS[to].y}
              stroke="rgba(223,194,141,0.22)"
              strokeWidth="0.12"
            />
          ))}
          {STARS.map((star, index) => (
            <circle key={index} cx={star.x} cy={star.y} r={star.r * 0.22} fill={star.glow ? GOLD : "#ecebe4"} opacity={star.glow ? 1 : 0.85} />
          ))}
        </svg>

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 14, height: 14, borderRadius: 999, background: GOLD, display: "flex" }} />
          <div style={{ color: MUTED, fontSize: 26, letterSpacing: 6, textTransform: "uppercase", display: "flex" }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ color: INK, fontSize: 78, lineHeight: 1.1, letterSpacing: -1.5, display: "flex", maxWidth: 900 }}>
            Your life, as a night sky.
          </div>
          <div style={{ color: MUTED, fontSize: 28, lineHeight: 1.5, display: "flex", maxWidth: 820 }}>{SITE_DESCRIPTION}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: MUTED, fontSize: 24 }}>
          <div style={{ display: "flex" }}>One small moment a night</div>
          <div style={{ display: "flex", color: GOLD }}>asteria</div>
        </div>
      </div>
    ),
    size,
  );
}
