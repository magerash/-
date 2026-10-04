// Export site + a variant from the running app and save the files: node e2e/export.mjs <url> <outdir>
import { chromium } from '@playwright/test';
const [url, outdir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(url);
await page.waitForTimeout(3000);
await page.click('text=Plan');
await page.click('text=A two-storey house near the forest');
await page.click('text=Generate variants');
await page.waitForSelector('[data-testid=variant-card]', { timeout: 60000 });
const results = [];
for (const [what, fmt] of [['site', 'glb'], ['variant', 'glb'], ['variant', 'obj'], ['site', 'ply']]) {
  await page.click('header >> text=Export');
  if (what === 'site') await page.selectOption('[aria-label="what to export"]', 'site');
  await page.click(fmt === 'glb' ? 'text=glTF (.glb)' : fmt === 'obj' ? 'text=OBJ (.zip)' : 'text=Point cloud (.ply)');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=do-export]')]);
  const path = `${outdir}/${dl.suggestedFilename()}`;
  await dl.saveAs(path);
  await page.waitForSelector('[data-testid=export-result]');
  results.push([path, await page.textContent('[data-testid=export-result]')]);
  await page.keyboard.press('Escape');
  await page.click('.modal-back', { position: { x: 5, y: 5 } }).catch(() => {});
}
console.log(JSON.stringify(results, null, 1));
console.log('errors:', errs);
await browser.close();
