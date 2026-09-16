import { test, expect } from "@playwright/test";
import { TRAVEL_PCT } from "../src/lib/hero-reveal";

/**
 * A25. The hero reveals each word from inside its own `overflow-hidden` inline-block, so the
 * mask's bottom padding is load-bearing in two directions: too shallow and the daith-vf-italic
 * descenders of *night* and *sky.* are sliced flat (at a position that scales with the type,
 * which is how it shipped — it looked identical at 1080p and 1440p and survived a 1920-only
 * rig); too deep and the word peeks above the mask before the reveal starts. Both directions
 * are measured here, in ink rather than font metrics, because metrics overstate the descent.
 * The travel figure is imported from the same module the component renders with, so the two
 * can never drift: a hardcoded copy here is what let a face swap pass review and fail CI.
 */
test("hero reveal mask clears the italic descenders without unsealing the word", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // The ink can only be measured against the mask once the word is at rest.
  await page.waitForFunction(() => {
    const inner = document.querySelector("h1 em")?.parentElement;
    if (!inner) return false;
    const t = getComputedStyle(inner).transform;
    if (t === "none") return true;
    const ty = parseFloat(t.split(",")[5] ?? "0");
    return Number.isFinite(ty) && Math.abs(ty) < 0.5;
  }, null, { timeout: 20_000 });

  const mask = await page.evaluate((travelPct: number) => {
    const em = document.querySelector("h1 em");
    const inner = em?.parentElement;
    const heroWord = inner?.parentElement; // HeroWord: inline-block + overflow-hidden
    if (!em || !inner || !heroWord) throw new Error("hero reveal mask not found");
    const cs = getComputedStyle(em);
    // A zero-size inline-block on the baseline marks where the glyphs meet it.
    const probe = document.createElement("span");
    probe.setAttribute("style", "display:inline-block;width:0;height:0;vertical-align:baseline");
    em.appendChild(probe);
    const baselineY = probe.getBoundingClientRect().top;
    probe.remove();
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const maskRect = heroWord.getBoundingClientRect();
    const ink = (s: string) => {
      const m = ctx.measureText(s);
      return {
        glyph: s,
        belowMask: baselineY + m.actualBoundingBoxDescent - maskRect.bottom,
        aboveMask: maskRect.top - (baselineY - m.actualBoundingBoxAscent),
      };
    };
    const maskDepth = inner.getBoundingClientRect().height + parseFloat(getComputedStyle(heroWord).paddingBottom);
    return { glyphs: [ink("g"), ink("y"), ink("h"), ink("Every")], maskDepth, travel: inner.getBoundingClientRect().height * travelPct };
  }, TRAVEL_PCT);

  for (const g of mask.glyphs) {
    expect(g.belowMask, `"${g.glyph}" is clipped by the reveal mask`).toBeLessThan(-1);
    expect(g.aboveMask, `"${g.glyph}" breaks the mask's top edge`).toBeLessThan(-1);
  }
  expect(mask.travel / mask.maskDepth, "the reveal travel must exceed the mask depth").toBeGreaterThan(1.05);
});
