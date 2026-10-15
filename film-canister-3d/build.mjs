// Re-bakes film-canister.glb / .usdz and preview.png from canister.js using headless Chromium.
// Usage (from repo root):  npx http-server film-canister-3d -p 8123 &  NODE_USE_ENV_PROXY=1 node film-canister-3d/build.mjs
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.CANISTER_URL || 'http://127.0.0.1:8123/index.html';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 });
// Optional: serve three from a local install (THREE_DIR=<path>/node_modules/three) when the CDN is unreachable.
// Everything else external (fonts) is fetched from Node; behind a proxy run with NODE_USE_ENV_PROXY=1.
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/';
await page.route(u => !u.href.startsWith('http://127.0.0.1'), async route => {
  const reqUrl = route.request().url();
  if (process.env.THREE_DIR && reqUrl.startsWith(CDN)) {
    return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(process.env.THREE_DIR, reqUrl.slice(CDN.length))) });
  }
  const res = await fetch(reqUrl);
  await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});
page.on('console', m => m.type() === 'error' && console.error('[page]', m.text()));
page.on('pageerror', e => console.error('[page]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__canister?.ready, null, { timeout: 60000 });

const out = (name, b64) => { writeFileSync(join(here, name), Buffer.from(b64, 'base64')); console.log('wrote', name); };
out('film-canister.glb', await page.evaluate(() => window.__canister.glb()));
out('film-canister.usdz', await page.evaluate(() => window.__canister.usdz()));

await page.evaluate(() => window.__canister.freeze('still', 0));
await page.waitForTimeout(400);
await page.locator('#stage').screenshot({ path: join(here, 'preview.png') });
console.log('wrote preview.png');
await page.evaluate(() => window.__canister.freeze('pull', 2.2));
await page.waitForTimeout(400);
await page.locator('#stage').screenshot({ path: join(here, 'preview-pull.png') });
console.log('wrote preview-pull.png');
await page.evaluate(() => window.__canister.freeze('feed', 1.3));
await page.waitForTimeout(400);
await page.locator('#stage').screenshot({ path: join(here, 'preview-feed.png') });
console.log('wrote preview-feed.png');
await browser.close();
