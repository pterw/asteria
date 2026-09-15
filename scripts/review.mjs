import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
const legibility = (page) => page.evaluate(() => {
  const vis = e => e.getClientRects().length && getComputedStyle(e).opacity !== '0' && !e.className.toString().includes('sr-only');
  const small = [...document.querySelectorAll('button, a, input, select')].filter(vis).filter(e => parseFloat(getComputedStyle(e).fontSize) < 12 || (e.getBoundingClientRect().height < 24 && e.tagName !== 'INPUT')).length;
  const tiny = [...document.querySelectorAll('p, span, b, time, label, li, h1, h2, h3, kbd')].filter(e => vis(e) && e.textContent.trim() && !e.closest('[aria-hidden="true"]') && parseFloat(getComputedStyle(e).fontSize) < 12).length;
  return { smallControls: small, tinyText: tiny, overflow: document.documentElement.scrollWidth > innerWidth };
});
for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `artifacts/landing-${name}.png` });
  await page.locator('#yours').scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
  await page.screenshot({ path: `artifacts/landing-yours-${name}.png` });
  await page.goto(`${base}/sky`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `artifacts/sky-${name}.png` });
  console.log(`${name} /sky`, JSON.stringify(await legibility(page)));
  await page.locator('.time-scrub').fill('8'); await page.waitForTimeout(700);
  await page.screenshot({ path: `artifacts/sky-time-${name}.png` });
  console.log(`${name} readout`, (await page.getByTestId('time-readout').innerText()).replace(/\n/g, ' · '));
  await page.close();
}
await browser.close();
console.log(JSON.stringify({ errors }));
