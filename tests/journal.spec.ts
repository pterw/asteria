import { test, expect } from "@playwright/test";
import type { StarDto } from "../src/lib/astral";

test("private journals, validated mutations, soft release, restore and export", async ({ request, playwright, baseURL }) => {
  const first = await request.get("/api/stars");
  expect(first.status()).toBe(200);
  const initial = (await first.json()).stars as StarDto[];
  expect(initial).toHaveLength(24);
  const other = await playwright.request.newContext({ baseURL });
  const otherStars = (await (await other.get("/api/stars")).json()).stars as StarDto[];
  expect(otherStars).toHaveLength(24);
  expect(otherStars.map(s => s.id)).not.toContain(initial[0].id);
  expect((await other.patch(`/api/stars/${initial[0].id}`, { data: { favorite: true } })).status()).toBe(404);
  expect((await other.delete(`/api/stars/${initial[0].id}`)).status()).toBe(404);
  expect((await request.post("/api/stars", { data: { content: "", mood: "luminous", intensity: 3 } })).status()).toBe(422);
  expect((await request.post("/api/stars", { data: { content: "A real moment", mood: "unknown", intensity: 3 } })).status()).toBe(422);
  expect((await request.post("/api/stars", { data: { content: "A real moment", mood: "tender", intensity: "3" } })).status()).toBe(422);
  expect((await request.post("/api/stars", { data: { content: "A real moment", mood: "tender", intensity: 3, createdAt: "2020-02-30T12:00:00Z" } })).status()).toBe(422);
  expect((await request.post("/api/stars", { data: [] })).status()).toBe(400);
  expect((await request.delete("/api/stars/not-a-uuid")).status()).toBe(400);
  expect((await request.post("/api/stars", { headers: { "sec-fetch-site": "cross-site" }, data: {} })).status()).toBe(403);
  const created = await request.post("/api/stars", { data: { title: "A small API light", content: "There was a small patch of sunlight by the window.", mood: "luminous", intensity: 4 } });
  expect(created.status()).toBe(201);
  const star = (await created.json()).star as StarDto;
  expect(star.isSample).toBe(false);
  const edited = (await (await request.patch(`/api/stars/${star.id}`, { data: { title: "A light, remembered", favorite: true, mood: "serene" } })).json()).star as StarDto;
  expect(edited.title).toBe("A light, remembered"); expect(edited.favorite).toBe(true); expect(edited.x).toBe(star.x); expect(edited.y).toBe(star.y);
  expect((await request.delete(`/api/stars/${star.id}`)).ok()).toBeTruthy();
  expect((await (await request.get("/api/stars")).json()).stars.map((s: StarDto) => s.id)).not.toContain(star.id);
  expect((await request.patch(`/api/stars/${star.id}`, { data: { restore: true } })).ok()).toBeTruthy();
  const exported = await request.get("/api/journal/export?format=json");
  expect(exported.headers()["content-disposition"]).toContain("attachment");
  const backup = await exported.json();
  expect(backup.moments).toHaveLength(25); expect(backup.moments.some((s: StarDto) => s.id === star.id && s.favorite)).toBe(true);
  expect(JSON.stringify(backup)).not.toContain("journalId");
  expect((await request.get("/api/journal/export?format=unknown")).status()).toBe(400);
  await other.dispose();
});

test("the landing is the front door: it shows your own sky and leads into it", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toContainText("Every life is");
  await expect(page.locator("#yours h2")).toContainText("24 stars");
  await expect(page.locator("#yours canvas")).toBeVisible();
  await page.locator("#yours").getByRole("link", { name: /Enter your sky/ }).click();
  await expect(page).toHaveURL(/\/sky$/);
  expect(errors).toEqual([]);
});

test("hang a star, read it, edit it, star it, release it, undo", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Capture a moment" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Give it a name").fill("The light we kept");
  await dialog.getByLabel("Your moment", { exact: true }).fill("The room was quiet. For a moment, that was enough.");
  await dialog.getByRole("button", { name: /Whimsical/ }).click();
  await dialog.getByRole("button", { name: "Add to my sky" }).click();
  await expect(page.getByText("A new light in your sky.")).toBeVisible();
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.locator(".reader-title")).toHaveText("The light we kept");
  await page.getByRole("dialog").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Give it a name").fill("The light we kept, remembered");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".reader-title")).toHaveText("The light we kept, remembered");
  await page.getByRole("button", { name: "Star this" }).click();
  await expect(page.getByRole("button", { name: "Starred" })).toBeVisible();
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await page.locator(".confirm-release").getByRole("button", { name: "Release", exact: true }).click();
  await expect(page.getByText("A little light, gently released.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Right back where it belongs.")).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.locator(".moment-card").filter({ hasText: "The light we kept, remembered" })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("attention: a feeling chip focuses the sky, the URL and the library agree", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.locator(".sky-legend").getByRole("button", { name: "Grateful", exact: true }).click();
  await expect(page).toHaveURL(/mood=luminous/);
  await page.getByRole("button", { name: "Small wonders" }).click();
  await expect(page.locator(".library-summary")).toContainText(/4\s*moments/i);
  await expect(page.locator(".moment-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".moment-card").first()).toBeVisible();
});

test("search finds a moment from anywhere and lands in the library", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.keyboard.press("/");
  await page.keyboard.type("sunlight");
  await expect(page).toHaveURL(/q=sunlight/);
  await expect(page.locator(".library-summary")).toContainText(/matching/i);
  await expect(page.locator(".moment-card").filter({ hasText: "Sunlight, unannounced" })).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".library-summary")).not.toContainText(/matching/i);
});

test("time: winding back un-forms the sky, stepping and returning to now work", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  const readout = page.locator(".time-readout").first();
  await expect(readout.locator("b")).toHaveText("Now");
  const bar = page.locator(".time-scrub").first();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(readout.locator("b")).not.toHaveText("Now");
  const wound = await readout.innerText();
  await page.getByRole("button", { name: "Step forward one star" }).first().click();
  await expect(readout).not.toHaveText(wound);
  await page.getByRole("button", { name: "Back to now" }).first().click();
  await expect(readout.locator("b")).toHaveText("Now");
  await expect(readout).toContainText("24 stars");
});

test("keyboard browsing announces lit stars and Enter reads one", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.getByRole("application").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('canvas + [aria-live="polite"]')).toContainText("Press Enter to read.");
  await page.keyboard.press("Enter");
  await expect(page.locator(".reader-title")).toBeVisible();
  await expect(page.locator(".reader-navigation")).toContainText("of 24");
});

test("a draft survives closing and a dead network keeps your words", async ({ page, context }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.keyboard.press("n");
  await page.getByLabel("Your moment", { exact: true }).fill("These words should survive a dead network.");
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  await page.keyboard.press("n");
  await expect(page.getByText("Your draft, right where you left it")).toBeVisible();
  await expect(page.getByLabel("Your moment", { exact: true })).toHaveValue("These words should survive a dead network.");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add to my sky" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Your moment", { exact: true })).toHaveValue("These words should survive a dead network.");
  await context.setOffline(false);
});

test("examples: editing protects a moment, starting fresh keeps it; export downloads", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.keyboard.press("j");
  await page.getByRole("button", { name: "Read Sunlight, unannounced", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Give it a name").fill("My own light now");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".reader-title")).toHaveText("My own light now");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Your journal settings" }).first().click();
  const settings = page.getByRole("dialog");
  const download = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Download JSON" }).click();
  expect((await download).suggestedFilename()).toMatch(/^asteria-.*\.json$/);
  await settings.getByRole("button", { name: "Start a fresh sky" }).click();
  await settings.getByRole("button", { name: "Start fresh", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Start a fresh sky" })).toHaveCount(0);
  await settings.getByRole("button", { name: "Close dialog" }).click();
  await expect(settings).toHaveCount(0);
  await page.keyboard.press("j");
  await expect(page.locator(".moment-card")).toHaveCount(1);
  await expect(page.locator(".moment-card").first()).toContainText("My own light now");
});

test("mobile: navigation drawer, capture flow, legible controls, no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sky", { waitUntil: "networkidle" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const small = await page.evaluate(() => [...document.querySelectorAll("button, a, input, select")]
    .filter(e => e.getClientRects().length && getComputedStyle(e).opacity !== "0" && !e.classList.contains("sr-only") && !e.className.includes("sr-only"))
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left < innerWidth && r.right > 0 && r.top < innerHeight && r.bottom > 0; })
    .filter(e => { const fs = parseFloat(getComputedStyle(e).fontSize);
      const hasVisibleText = (e.textContent || "").trim().length > 0 && fs >= 1;
      const tinyType = hasVisibleText && fs < 12;
      const shortTarget = e.getBoundingClientRect().height < 24 && e.tagName !== "INPUT";
      return tinyType || shortTarget; }).map(e => e.getAttribute("aria-label") || e.textContent));
  expect(small).toEqual([]);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".sidebar.is-open")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Capture a moment" }).first().click();
  await page.getByLabel("Your moment", { exact: true }).fill("Even a small screen has room for one true sentence.");
  await page.getByRole("button", { name: "Add to my sky" }).click();
  await expect(page.getByText("A new light in your sky.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".timebar")).toBeVisible();
});
