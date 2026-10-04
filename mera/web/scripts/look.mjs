// Screenshots from given camera positions: node scripts/look.mjs <url> '[{"pos":[x,y,z],"target":[x,y,z],"out":"a.png","setup":"js"}]'
import { chromium } from '@playwright/test';
const [url, views] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.__mera && window.__meraStore?.getState().site, null, { timeout: 30000 });
await page.waitForTimeout(5000);
for (const v of JSON.parse(views)) {
  if (v.setup) await page.evaluate(v.setup);
  if (v.pos) await page.evaluate(([p, t]) => window.__mera.look(p, t), [v.pos, v.target]);
  await page.waitForTimeout(v.wait ?? 1500);
  await page.screenshot({ path: v.out });
}
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
