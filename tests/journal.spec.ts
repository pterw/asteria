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
  await expect(page.getByRole("application")).toBeVisible();
  await page.goto("/about"); await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});

test("hang a star, read it, edit it, star it, release it, undo", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Hang a star", exact: true }).click();
  await page.getByLabel("Title").fill("The light we kept");
  await page.getByLabel("The moment").fill("The room was quiet. For a moment, that was enough.");
  await page.getByRole("dialog").getByRole("button", { name: /Tender/ }).click();
  await page.getByRole("button", { name: "Hang this star", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".reader-title")).toHaveText("The light we kept");
  await expect(page.locator(".reader-meta")).toContainText("Close to home");
  await page.locator(".reader-actions").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title").fill("The light we chose to keep");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".reader-title")).toHaveText("The light we chose to keep");
  await page.locator(".reader-actions").getByRole("button", { name: "Star", exact: true }).click();
  await expect(page.locator(".reader-actions").getByRole("button", { name: "Starred", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".reader-actions").getByRole("button", { name: "Release", exact: true }).click();
  await page.locator(".reader-confirm").getByRole("button", { name: "Release", exact: true }).click();
  await expect(page.locator(".reader")).toHaveCount(0);
  await page.getByRole("button", { name: "Moments", exact: true }).click();
  await expect(page.locator(".ledger-row").filter({ hasText: "The light we chose to keep" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".ledger-row").filter({ hasText: "The light we chose to keep" })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("attention: a constellation chip focuses the sky, the URL and the list agree", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await expect(page.getByTestId("time-readout")).toContainText("24 stars");
  await page.getByRole("button", { name: "Small wonders", exact: true }).click();
  await expect(page).toHaveURL(/mood=luminous/);
  await page.getByRole("button", { name: "Moments", exact: true }).click();
  await expect(page.locator(".ledger-row")).toHaveCount(4);
  await expect(page.locator(".ledger-chips")).toContainText("Small wonders");
  await page.getByRole("button", { name: "Quiet hours", exact: true }).click();
  await expect(page.locator(".ledger-row")).toHaveCount(4);
  await expect(page).toHaveURL(/mood=serene/);
  await page.getByRole("button", { name: "All stars", exact: true }).click();
  await expect(page.locator(".ledger-row")).toHaveCount(24);
  await expect(page).toHaveURL(/\/sky$/);
});

test("time: winding back un-forms the sky, and the list, counts and reader follow", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  const readout = page.getByTestId("time-readout");
  await expect(readout).toContainText("Now");
  await page.locator(".time-scrub").fill("8");
  await expect(readout).toContainText("8 stars");
  await expect(readout).not.toContainText("Now");
  await expect(page.getByRole("button", { name: "All stars", exact: true })).toContainText("8");
  await page.getByRole("button", { name: "Moments", exact: true }).click();
  await expect(page.locator(".ledger-row")).toHaveCount(8);
  await expect(page.locator(".ledger-bar")).toContainText("as of");
  await page.locator(".ledger-row").first().click();
  await expect(page.locator(".reader-nav")).toContainText("/ 8");
  await page.getByRole("button", { name: "Close and return to the sky", exact: true }).click();
  await page.keyboard.press("]");
  await expect(readout).toContainText("9 stars");
  await page.keyboard.press("[");
  await expect(readout).toContainText("8 stars");
  await page.locator(".time-scrub").fill("0");
  await expect(readout).toContainText("Before the first star");
  await page.getByRole("button", { name: "Back to now", exact: true }).click();
  await expect(readout).toContainText("Now");
  await expect(readout).toContainText("24 stars");
  await page.getByRole("button", { name: "Replay how your sky formed", exact: true }).click();
  await expect(readout).not.toContainText("Now");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Back to now", exact: true }).click();
  await expect(readout).toContainText("24 stars");
});

test("search lives in the dock, syncs to the URL and survives reload", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.keyboard.press("m");
  const search = page.getByRole("textbox", { name: "Search your moments" });
  await expect(search).toBeVisible();
  await search.fill("oranges");
  await expect(page.locator(".ledger-row")).toHaveCount(1);
  await expect(page).toHaveURL(/q=oranges/);
  await page.reload({ waitUntil: "networkidle" });
  await page.keyboard.press("m");
  await expect(page.getByRole("textbox", { name: "Search your moments" })).toHaveValue("oranges");
  await search.fill("nothing matches this at all");
  await expect(page.locator(".ledger-empty")).toContainText("Nothing matches that.");
  await search.fill("a".repeat(200));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator(".ledger-row")).toHaveCount(24);
});

test("nights: picking a night from the calendar attends to it", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nights", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nights" });
  await expect(dialog).toBeVisible();
  const lit = dialog.locator("[data-almanac-day]").first();
  const day = await lit.getAttribute("data-almanac-day");
  await lit.click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`day=${day}`));
  await expect(page.locator(".ledger-row")).toHaveCount(1);
  await page.locator(".ledger-chips button").first().click();
  await expect(page).not.toHaveURL(/day=/);
});

test("draft recovery, then a save that clears it", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.keyboard.press("n");
  await page.getByLabel("Title").fill("An unfinished light");
  await page.getByLabel("The moment").fill("I started this, then life needed me elsewhere.");
  await page.keyboard.press("Escape"); await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Hang a star", exact: true }).click();
  await expect(page.getByLabel("Title")).toHaveValue("An unfinished light");
  await page.getByLabel("The moment").press("Control+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("asteria.moment-draft.v3"))).toBeNull();
});

test("a failed save keeps the words and can be retried", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.route("**/api/stars", route => route.request().method() === "POST" ? route.abort("failed") : route.continue());
  await page.getByRole("button", { name: "Hang a star", exact: true }).click();
  await page.getByLabel("The moment").fill("These words should survive a dead network.");
  await page.getByRole("button", { name: "Hang this star", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("offline");
  await expect(page.getByLabel("The moment")).toHaveValue("These words should survive a dead network.");
  await page.unroute("**/api/stars");
  await page.getByRole("button", { name: "Hang this star", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await expect(page.locator(".ledger-row").filter({ hasText: "These words should survive a dead network." })).toHaveCount(1);
});

test("examples: editing protects a moment, starting fresh keeps it", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "Read Sunlight, unannounced", exact: true }).click();
  await page.locator(".reader-actions").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title").fill("My own light now");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".reader-title")).toHaveText("My own light now");
  await page.getByRole("button", { name: "Close and return to the sky", exact: true }).click();
  await page.getByRole("button", { name: "About this sky", exact: true }).click();
  const notes = page.getByRole("dialog", { name: "About this sky" });
  const download = page.waitForEvent("download");
  await notes.getByRole("button", { name: "JSON", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^asteria-.*\.json$/);
  await notes.getByRole("button", { name: "Start a fresh sky", exact: true }).click();
  await notes.getByRole("button", { name: "Start fresh", exact: true }).click();
  await expect(notes).toHaveCount(0);
  await page.keyboard.press("m");
  await expect(page.locator(".ledger-row")).toHaveCount(1);
  await expect(page.locator(".ledger-row").first()).toContainText("My own light now");
});

test("keyboard browsing announces lit stars and Enter reads one", async ({ page }) => {
  await page.goto("/sky", { waitUntil: "networkidle" });
  await page.getByRole("application").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('canvas + [aria-live="polite"]')).toContainText("Press Enter to read.");
  await page.keyboard.press("Enter");
  await expect(page.locator(".reader-title")).toBeVisible();
  await expect(page.locator(".reader-nav")).toContainText("/ 24");
});

test("mobile: bottom dock, capture flow, legible controls, no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sky", { waitUntil: "networkidle" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const small = await page.evaluate(() => [...document.querySelectorAll("button, a, input, select")]
    .filter(e => e.getClientRects().length && getComputedStyle(e).opacity !== "0" && !e.classList.contains("sr-only") && !e.className.includes("sr-only"))
    .filter(e => parseFloat(getComputedStyle(e).fontSize) < 12 || (e.getBoundingClientRect().height < 24 && e.tagName !== "INPUT")).map(e => e.getAttribute("aria-label") || e.textContent));
  expect(small).toEqual([]);
  await page.getByRole("button", { name: "Hang a star", exact: true }).click();
  await page.getByLabel("The moment").fill("Even a small screen has room for one true sentence.");
  await page.getByRole("button", { name: "Hang this star", exact: true }).click();
  await expect(page.locator(".reader")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Close and return to the sky", exact: true }).click();
  await expect(page.locator(".dock")).toHaveAttribute("data-open", "false");
  await expect(page.locator(".timebar")).toBeVisible();
});
