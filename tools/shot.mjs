// Screenshot the running game the way a phone sees it, for visual iteration.
// Usage: node tools/shot.mjs <out.png> [--engine webkit|chrome] [--wait ms] [--url http://localhost:5173/] [--eval "js"]
import { webkit, chromium, devices } from '@playwright/test';

const args = process.argv.slice(2);
const out = args[0] ?? 'shot.png';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const engine = opt('engine', 'webkit');
const wait = Number(opt('wait', '2500'));
const url = opt('url', 'http://localhost:5173/');
const evalJs = opt('eval', '');

const browser = engine === 'chrome' ? await chromium.launch({ channel: 'chrome' }) : await webkit.launch();
const page = await browser.newPage({ ...devices[engine === 'chrome' ? 'Pixel 7' : 'iPhone 15 Pro'] });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
await page.goto(url);
await page.waitForFunction(() => window.__nd?.ready === true, null, { timeout: 30000 });
if (evalJs) await page.evaluate(evalJs);
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
const stats = await page.evaluate(() => window.__nd.stats());
const errors = await page.evaluate(() => window.__nd.errors);
console.log(JSON.stringify({ stats, errors: [...new Set(errors)] }));
for (const l of [...new Set(logs)].filter((l) => !l.includes('[debug]'))) console.log(l);
await browser.close();
