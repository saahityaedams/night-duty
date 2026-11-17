import { test, expect, type Page } from '@playwright/test';

async function boot(page: Page) {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__nd?.ready === true, null, { timeout: 20_000 });
  return consoleErrors;
}

test('boots without errors and renders the scene', async ({ page }, info) => {
  const consoleErrors = await boot(page);
  await page.waitForTimeout(1500);

  const stats = await page.evaluate(() => window.__nd.stats());
  expect(stats.frames).toBeGreaterThan(10);
  expect(stats.drawCalls).toBeGreaterThan(0);

  await page.screenshot({ path: `test-results/screens/boot-${info.project.name}.png` });
  expect(await page.evaluate(() => window.__nd.errors)).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('a tap knocks an object over and physics settles', async ({ page }, info) => {
  await boot(page);
  await page.waitForTimeout(500);

  // Scan the desk area for a cup to tap, rather than hard-coding pixel positions.
  const hit = await page.evaluate(() => {
    for (let y = 0.45; y <= 0.85; y += 0.02) {
      for (let x = 0.1; x <= 0.9; x += 0.02) {
        if (window.__nd.tap(x, y)) return { x, y };
      }
    }
    return null;
  });
  expect(hit).not.toBeNull();

  await page.waitForTimeout(150);
  expect((await page.evaluate(() => window.__nd.stats())).activeBodies).toBeGreaterThan(0);
  await page.screenshot({ path: `test-results/screens/tap-${info.project.name}.png` });

  // Bodies must fall asleep so debris stops costing CPU.
  await expect
    .poll(async () => (await page.evaluate(() => window.__nd.stats())).activeBodies, { timeout: 15_000 })
    .toBe(0);
});

test('frame time stays inside the regression budget', async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__nd.resetStats());
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => window.__nd.stats());
  console.log(`frame p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms draws=${s.drawCalls} tris=${s.triangles}`);
  // Headless browsers on a laptop are not phones; this only catches big regressions.
  expect(s.p95).toBeLessThan(40);
  expect(s.drawCalls).toBeLessThan(250);
});
