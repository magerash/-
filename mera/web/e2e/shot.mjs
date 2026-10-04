// quick visual smoke: node e2e/shot.mjs <url> <out.png> [actions json]
import { chromium } from '@playwright/test';
const [url, out, actions] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(url);
await page.waitForTimeout(4000);
for (const a of JSON.parse(actions || '[]')) {
  if (a.click) await page.click(a.click, { timeout: 5000 }).catch((e) => logs.push('click fail ' + a.click + ' ' + e.message.split('\n')[0]));
  if (a.fill) await page.fill(a.fill, a.text);
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.mouse) await page.mouse.click(a.mouse[0], a.mouse[1]);
  if (a.key) await page.keyboard.press(a.key);
  if (a.shot) await page.screenshot({ path: a.shot });
}
await page.screenshot({ path: out });
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
