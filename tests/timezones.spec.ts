import { test, expect } from "@playwright/test";

test("non-UTC browsers hydrate cleanly on both the landing and the sky", async ({ browser, baseURL }) => {
  for (const timezoneId of ["America/Los_Angeles", "Pacific/Auckland"]) {
    const context = await browser.newContext({ baseURL, timezoneId, reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("#yours h2")).toContainText("stars");
    await page.goto("/sky", { waitUntil: "networkidle" });
    await expect(page.locator(".welcome-date").first()).not.toHaveText("");
    await expect(page.getByTestId("time-readout")).toContainText("stars");
    expect(errors, `errors in ${timezoneId}`).toEqual([]);
    await context.close();
  }
});
