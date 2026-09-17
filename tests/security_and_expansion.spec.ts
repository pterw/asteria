import { test, expect } from "@playwright/test";
import type { StarDto } from "../src/lib/astral";

test.describe("Security Hardening, XSS Protection & Backend Expansion", () => {
  test("security headers: CSP, nosniff, x-frame-options, and disabled x-powered-by", async ({ request }) => {
    const res = await request.get("/api/stars");
    expect(res.status()).toBe(200);

    const headers = res.headers();
    // Verify Content-Security-Policy
    expect(headers["content-security-policy"]).toBeDefined();
    const csp = headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("https://use.typekit.net");
    expect(csp).toContain("https://fonts.adobe.com");
    expect(csp).toContain("frame-ancestors 'none'");

    // Verify Standard Security Headers
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");

    // Verify x-powered-by is disabled/removed
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("XSS protection: script and style injections are sanitized on write", async ({ request }) => {
    const maliciousPayload = {
      title: '<script>alert("xss")</script>Security Star',
      content: '<style>body{color:red}</style>A gentle evening with <img src=x onerror=alert(1)> starlight.',
      mood: "luminous",
      intensity: 4,
    };

    const res = await request.post("/api/stars", { data: maliciousPayload });
    expect(res.status()).toBe(201);

    const data = await res.json();
    const star = data.star as StarDto;

    // Verify the script and style tags and contents were stripped
    expect(star.title).not.toContain("<script>");
    expect(star.title).not.toContain("alert");
    expect(star.title).toBe("Security Star");

    expect(star.content).not.toContain("<style>");
    expect(star.content).not.toContain("<img");
    expect(star.content).not.toContain("onerror");
    expect(star.content).toBe("A gentle evening with  starlight.");
  });

  test("markdown export: escapes HTML brackets preventing viewer code injection", async ({ request }) => {
    // Insert a star with non-tag angle brackets that survive tag stripping
    await request.post("/api/stars", {
      data: {
        title: "Star brightness: 1 < 5",
        content: "When 1 < 2 and 3 > 2, the night is peaceful.",
        mood: "serene",
        intensity: 3,
      },
    });

    const exportRes = await request.get("/api/journal/export?format=markdown");
    expect(exportRes.status()).toBe(200);

    const md = await exportRes.text();
    // Angle brackets must be safely escaped in markdown export
    expect(md).toContain("&lt; 2 and 3 &gt; 2");
  });

  test("backend expansion: GET /api/health returns latency and telemetry", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data.status).toBe("healthy");
    expect(data.database.status).toBe("connected");
    expect(typeof data.database.latencyMs).toBe("number");
    expect(typeof data.system.uptimeSeconds).toBe("number");
  });

  test("backend expansion: GET /api/stars/search supports query and filters", async ({ request }) => {
    // Search for moments
    const res = await request.get("/api/stars/search?q=evening&mood=luminous");
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data.stars)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(data.query.q).toBe("evening");
    expect(data.query.mood).toBe("luminous");
  });

  test("backend expansion: GET /api/journal/stats returns celestial analytics", async ({ request }) => {
    const res = await request.get("/api/journal/stats");
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(typeof data.stars).toBe("number");
    expect(typeof data.nights).toBe("number");
    expect(Array.isArray(data.moodBreakdown)).toBe(true);
    expect(data.moodBreakdown).toHaveLength(6);
    expect(typeof data.averageIntensity).toBe("number");
    expect(data.timeOfDay).toHaveProperty("morning");
    expect(data.timeOfDay).toHaveProperty("evening");
    expect(data.streaks).toHaveProperty("current");
    expect(data.streaks).toHaveProperty("longest");
  });

  test("backend expansion: POST /api/journal/import restores moments atomically", async ({ request }) => {
    const backup = {
      application: "Asteria",
      version: 2,
      moments: [
        {
          title: "Restored Light",
          content: "A memory carried across the night sky.",
          mood: "vesper",
          intensity: 4,
          createdAt: "2026-08-10T20:00:00.000Z",
          favorite: true,
        },
      ],
    };

    const res = await request.post("/api/journal/import", {
      headers: { "Content-Type": "application/json" },
      data: backup,
    });
    expect(res.status()).toBe(201);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.imported).toBe(1);

    // Verify it appears in search
    const searchRes = await request.get("/api/stars/search?q=Restored");
    const searchData = await searchRes.json();
    expect(searchData.stars.some((s: StarDto) => s.title === "Restored Light")).toBe(true);
  });

  test("frontend features: keyboard shortcuts modal opens with '?' key", async ({ page }) => {
    await page.goto("/sky", { waitUntil: "networkidle" });
    await page.keyboard.press("?");
    await expect(page.getByText("Observatory Keyboard Shortcuts")).toBeVisible();
    await expect(page.getByText("Navigation & Views")).toBeVisible();
    await expect(page.getByText("Time & Constellations")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Observatory Keyboard Shortcuts")).not.toBeVisible();
  });
});
