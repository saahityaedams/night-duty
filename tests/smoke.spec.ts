import { test, expect, type Page } from '@playwright/test';

async function boot(page: Page) {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__nd?.ready === true, null, { timeout: 30_000 });
  await page.waitForTimeout(800);
  return consoleErrors;
}

test('boots without errors and renders the scene', async ({ page }, info) => {
  const consoleErrors = await boot(page);
  await page.waitForTimeout(1000);
  const stats = await page.evaluate(() => window.__nd.stats());
  expect(stats.frames).toBeGreaterThan(10);
  expect(stats.drawCalls).toBeGreaterThan(20);
  // Three mugs and the glass pen jar.
  expect((await page.evaluate(() => window.__nd.counts())).intact).toBe(4);
  await page.screenshot({ path: `test-results/screens/boot-${info.project.name}.png` });
  expect(await page.evaluate(() => window.__nd.errors)).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('flicking a mug at the monitor breaks it', async ({ page }, info) => {
  await boot(page);
  const grabbed = await page.evaluate(async () => {
    const m = window.__nd.mugScreenPositions()[2];
    return window.__nd.flick(m.x, m.y, m.x, m.y - 0.35, 90);
  });
  expect(grabbed).toBe(true);
  await expect.poll(async () => (await page.evaluate(() => window.__nd.counts())).breaks, { timeout: 4000 }).toBe(1);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `test-results/screens/flick-${info.project.name}.png` });
  const c = await page.evaluate(() => window.__nd.counts());
  expect(c.shards).toBeGreaterThan(4);
  expect(c.intact).toBe(3);
});

test('a quick tap knocks a mug without grabbing it for long', async ({ page }) => {
  await boot(page);
  const hit = await page.evaluate(() => {
    const m = window.__nd.mugScreenPositions()[0];
    return window.__nd.tap(m.x, m.y);
  });
  expect(hit).toBe(true);
  await page.waitForTimeout(120);
  expect((await page.evaluate(() => window.__nd.stats())).activeBodies).toBeGreaterThan(0);
});

test('shards come to rest and a new round of mugs appears', async ({ page }, info) => {
  await boot(page);
  const n = await page.evaluate(() => window.__nd.breakAll(200));
  expect(n).toBe(4); // three mugs and the pen jar
  // All debris must fall asleep so it stops costing CPU.
  await expect
    .poll(async () => (await page.evaluate(() => window.__nd.stats())).activeBodies, { timeout: 15_000, intervals: [500] })
    .toBeLessThanOrEqual(3); // the new round may still be landing
  await expect.poll(async () => (await page.evaluate(() => window.__nd.counts())).intact, { timeout: 6000 }).toBe(3);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `test-results/screens/aftermath-${info.project.name}.png` });
  expect(await page.evaluate(() => window.__nd.errors)).toEqual([]);
});

test('frame time and scene cost stay inside budget during a three-mug break', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__nd.resetStats());
  await page.evaluate(() => window.__nd.breakAll(200));
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => window.__nd.stats());
  // Once settled, debris is batched: the scene must be back near its resting cost.
  await page.waitForTimeout(2500);
  const settled = await page.evaluate(() => window.__nd.stats());
  console.log(`settled draws=${settled.drawCalls} tris=${settled.triangles}`);
  expect(settled.drawCalls).toBeLessThan(250);
  console.log(`frame p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms draws=${s.drawCalls} tris=${s.triangles}`);
  // Headless browsers on a laptop are not phones; these catch big regressions.
  expect(s.p95).toBeLessThan(40);
  expect(s.drawCalls).toBeLessThan(400);
  expect(s.triangles).toBeLessThan(700_000);
});

test('audio unlocks on the first touch and every sample decodes', async ({ page }) => {
  await boot(page);
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.1); // empty area: no throw
  await expect.poll(async () => (await page.evaluate(() => window.__nd.audio())).loaded, { timeout: 10_000 }).toBe(true);
  const a = await page.evaluate(() => window.__nd.audio());
  expect(a.samples).toEqual({ break: 18, debris: 3, clink: 3, glass: 8, metal: 6, plastic: 7, paper: 5, spark: 3 });
  expect(['running', 'suspended']).toContain(a.state);
});

test('bat and hammer break things in the locker and printer views', async ({ page }) => {
  await boot(page);
  const box = (await page.locator('#game').boundingBox())!;
  const X = (f: number) => box.x + box.width * f;
  const Y = (f: number) => box.y + box.height * f;
  // Bat: swipes across the locker.
  await page.evaluate(() => window.__nd.shot('left', 0));
  await page.locator('button[aria-label="bat"]').dispatchEvent('pointerdown');
  for (let rep = 0; rep < 4; rep++) {
    await page.mouse.move(X(0.15), Y(0.45));
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(X(0.15 + i * 0.09), Y(0.45 + i * 0.01));
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  // Hammer: charged blows on the printer.
  await page.evaluate(() => window.__nd.shot('right', 0));
  await page.locator('button[aria-label="hammer"]').dispatchEvent('pointerdown');
  for (let rep = 0; rep < 3; rep++) {
    await page.mouse.move(X(0.62), Y(0.62));
    await page.mouse.down();
    await page.waitForTimeout(950);
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  const broken = (await page.evaluate(() => window.__nd.objects())).filter((o) => o.broken).map((o) => o.name);
  expect(broken).toContain('locker');
  expect(broken).toContain('printer');
  expect(await page.evaluate(() => window.__nd.errors)).toEqual([]);
});
