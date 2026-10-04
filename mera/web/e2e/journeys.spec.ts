import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const PID = process.env.PID ?? 'plot';
const OUT = path.resolve('test-results/exports');
const ROOT = path.resolve('..');

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?p=${PID}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  return errors;
}

/** Project a site point (u, v, height) to page pixels using the live camera. */
async function screenOf(page: Page, u: number, v: number, h = 0) {
  return page.evaluate(([u, v, h]) => (window as unknown as { __mera: { project: (x: number, y: number, z: number) => [number, number] } }).__mera.project(u, h, -v), [u, v, h]);
}

test('loads the surveyed plot with evidence', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByRole('heading', { name: 'The plot' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How it was measured' })).toBeVisible();
  await expect(page.locator('.check').first()).toBeVisible(); // independent scale checks are listed
  const site = await page.evaluate(async (pid) => (await fetch(`/api/projects/${pid}/site`)).json(), PID);
  expect(site.units).toBe('m');
  expect(site.plot.width).toBeGreaterThan(46);
  expect(site.plot.width).toBeLessThan(51);
  expect(site.plot.depth).toBeGreaterThan(47.5);
  expect(site.plot.depth).toBeLessThan(52.5);
  expect(site.cameras.length).toBeGreaterThan(200);
  expect(errors).toEqual([]);
});

test('navigates: orbit, plan, walk and look through a source photo', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('toolbar').getByText('Plan').click();
  await page.waitForTimeout(1200);
  await page.getByRole('toolbar').getByText('Walk').click();
  await page.waitForTimeout(800);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  await expect(page.getByText('Walking at 1.65 m eye height')).toBeVisible();
  await page.getByRole('toolbar').getByText('Orbit').click();
  // open a remark pinned on the map, then align the 3D camera with the phone
  await page.locator('.pin-dot').first().click();
  await expect(page.getByText('Source frame')).toBeVisible();
  await page.getByText('Look through this photo').click();
  await expect(page.locator('.photo-overlay img')).toBeVisible();
  await page.getByText('Leave photo view').click();
  expect(errors).toEqual([]);
});

test('measures a boundary at about 48-49 m', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('toolbar').getByText('Plan').click();
  await page.waitForTimeout(1500);
  const site = await page.evaluate(async (pid) => (await fetch(`/api/projects/${pid}/site`)).json(), PID);
  const road = site.plot.edges.find((e: { id: string }) => e.id === 'road');
  await page.getByRole('toolbar').getByText('Measure').click();
  const t = site.terrain;
  const hAt = (u: number, v: number) => t.h0 + t.gu * u + t.gv * v;
  // click slightly off the corners: the tool snaps to the plot corners
  const a = await screenOf(page, road.a[0] + 0.3, road.a[1] + 0.3, hAt(road.a[0], road.a[1]));
  const b = await screenOf(page, road.b[0] - 0.3, road.b[1] + 0.3, hAt(road.b[0], road.b[1]));
  await page.mouse.click(a[0], a[1]);
  await page.mouse.click(b[0], b[1]);
  const label = page.locator('.lbl.measure').first();
  await expect(label).toBeVisible();
  const m = parseFloat((await label.textContent())!);
  expect(m).toBeGreaterThan(47.5);
  expect(m).toBeLessThan(49.5);
  expect(errors).toEqual([]);
});

test('describes a build, gets placed variants, compares and exports at true scale', async ({ page }) => {
  const errors = await open(page);
  mkdirSync(OUT, { recursive: true });
  await page.getByRole('navigation').getByText('Plan').click();
  await page.getByLabel('Building brief').fill('a two-storey house near the forest, a garage and a sauna by the road');
  await page.getByText('Generate variants').click();
  await expect(page.getByTestId('variant-card').first()).toBeVisible({ timeout: 90_000 });
  const n = await page.getByTestId('variant-card').count();
  expect(n).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('Understood as')).toBeVisible();
  await expect(page.locator('.item select[aria-label=type]').first()).toHaveValue('house');
  // compare
  await page.getByRole('navigation').getByText('Compare').click();
  await expect(page.getByRole('heading', { name: 'Side by side' })).toBeVisible();
  await expect(page.locator('.compare-cell')).toHaveCount(n >= 3 ? 4 : 2);
  // export the first variant as GLB and OBJ, then re-import both in trimesh + Blender
  const files: string[] = [];
  for (const fmt of ['glTF (.glb)', 'OBJ (.zip)']) {
    await page.locator('header').getByText('Export').click();
    await page.getByText(fmt).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('do-export').click()]);
    const p = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(p);
    files.push(p);
    await expect(page.getByTestId('export-result')).toContainText(fmt.startsWith('glTF') ? 'identical to the model' : 'units = meters');
    await page.mouse.click(5, 300);
  }
  const out = execFileSync('python3', [path.join(ROOT, 'pipeline/verify_export.py'), ...files, '--site', path.join(ROOT, `data/projects/${PID}/site.json`)], { encoding: 'utf8' });
  console.log(out.split('\n').filter((l) => /expected|trimesh|obj-text|blender|ALL|FAIL/.test(l)).join('\n'));
  expect(out).toContain('ALL OK');
  expect(errors).toEqual([]);
});
