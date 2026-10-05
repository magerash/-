import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const PID = process.env.PID ?? 'plot';
const OUT = path.resolve('test-results/exports');
const ROOT = path.resolve('..');
// the Python with trimesh/pillow (and optionally bpy): python3 on Linux and macOS, python on Windows
const PYTHON = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

type Win = {
  __mera: { project: (x: number, y: number, z: number) => [number, number] };
  __meraStore: { getState: () => { layers: Record<string, boolean>; selection: { kind: string; id: string } | null } };
};

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // the server sends the same content policy as the hosted copy: nothing may be refused
  page.on('console', (m) => { if (/Refused to|Content Security Policy|site model:/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  const model = page.waitForResponse((r) => r.url().includes('/site/model.gltf.json') && r.ok(), { timeout: 60_000 });
  const ground = page.waitForResponse((r) => r.url().includes('/site/tex/ground.jpg') && r.ok(), { timeout: 60_000 });
  await page.goto(`/?p=${PID}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await Promise.all([model, ground]);
  await page.waitForTimeout(3000);
  return errors;
}

/** Page pixels of a site point (u across, v road -> forest, h up) with the live camera. */
const screenOf = (page: Page, u: number, v: number, h = 0) =>
  page.evaluate(([u, v, h]) => (window as unknown as Win).__mera.project(u, h, -v), [u, v, h]);

const site = (page: Page) => page.evaluate(async (pid) => (await fetch(`/api/projects/${pid}/site`)).json(), PID);
const heightAt = (s: { terrain: { h0: number; gu: number; gv: number } }, u: number, v: number) => s.terrain.h0 + s.terrain.gu * u + s.terrain.gv * v;

/** How busy the 3D view is: standard deviation of a downsampled copy of the canvas. */
const canvasSpread = (page: Page) => page.evaluate(() => {
  const src = document.querySelector('canvas')!;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 40;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0, 64, 40);
  const d = g.getImageData(0, 0, 64, 40).data;
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] + d[i + 1] + d[i + 2]) / 3; s += y; s2 += y * y; n++; }
  return Math.sqrt(s2 / n - (s / n) ** 2);
});

test('first open: the textured model and nothing else', async ({ page }) => {
  const errors = await open(page);
  // a real picture, not an empty or flat canvas
  expect(await canvasSpread(page)).toBeGreaterThan(18);
  // every detail layer starts off: no labels, pins, points or camera glyphs
  const layers = await page.evaluate(() => (window as unknown as Win).__meraStore.getState().layers);
  expect(Object.values(layers).every((v) => v === false)).toBe(true);
  await expect(page.locator('.lbl')).toHaveCount(0);
  await expect(page.locator('.pin-dot')).toHaveCount(0);
  await expect(page.getByTestId('survey-notes')).toHaveCount(0);
  await expect(page.getByText("The 3D model didn't load")).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'About this plot' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'On the plot' })).toBeVisible();
  // the narration is the video author's, never presented as the owner's words
  expect((await page.locator('body').innerText()).toLowerCase()).not.toContain('owner');
  const s = await site(page);
  expect(s.units).toBe('m');
  expect(s.plot.width).toBe(49);
  expect(s.plot.depth).toBe(50);
  expect(errors).toEqual([]);
});

test('detail layers reveal the survey and hide again', async ({ page }) => {
  const errors = await open(page);
  const points = page.waitForResponse((r) => r.url().includes('points_model.bin') && r.ok());
  await page.getByTestId('layers-button').click();
  const layer = (k: string) => page.locator(`[data-layer=${k}]`);
  await layer('labels').check();
  await expect(page.locator('.lbl', { hasText: 'Utility cabin' })).toHaveCount(1);
  await layer('dimensions').check();
  await expect(page.locator('.lbl.dim', { hasText: 'Road side · 49.0 m' })).toBeVisible();
  await layer('narration').check();
  await expect(page.locator('.pin-dot').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: "What the video's author says" })).toBeVisible();
  await layer('survey').check();
  await expect(page.getByTestId('survey-notes')).toBeVisible();
  await layer('accuracy').check();
  await layer('grid').check();
  await layer('photos').check();
  await layer('points').check();
  await points;
  // a structure's card shows how it was located, with the frames that show it
  await page.locator('[data-item=utility-cabin]').click();
  const card = page.getByTestId('selection-card');
  await expect(card).toContainText('Utility cabin');
  await expect(card).toContainText('Mostly outside the boundary');
  await expect(card.locator('.frame-strip img').first()).toBeVisible();
  await card.locator('.frame-strip img').first().click();
  await expect(page.getByTestId('photo-panel')).toBeVisible();
  await page.getByText('Look through this frame').click();
  await expect(page.locator('.photo-overlay img')).toBeVisible();
  await page.getByText('Back to the model').click();
  await page.getByText('Hide all').click();
  await expect(page.locator('.lbl')).toHaveCount(1); // only the selected structure's name stays
  await expect(page.locator('.pin-dot')).toHaveCount(0);
  await expect(page.getByTestId('survey-notes')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('click the corrected structures in the model', async ({ page }) => {
  const errors = await open(page);
  const s = await site(page);
  await page.getByRole('toolbar').getByText('Top').click();
  await page.waitForTimeout(1500);
  const el = (id: string) => s.elements.find((e: { id: string }) => e.id === id);
  const click = async (u: number, v: number, h: number) => {
    const [x, y] = await screenOf(page, u, v, heightAt(s, u, v) + h);
    await page.mouse.click(x, y);
    await page.waitForTimeout(400);
  };
  const card = page.getByTestId('selection-card');
  // the utility cabin roof, beyond the back fence behind the sauna
  const cab = el('utility-cabin');
  await click(cab.center[0], cab.center[1] + 0.8, 2.3);
  await expect(card).toContainText('Utility cabin');
  // the terrace, on the road side of the sauna (a corner away from the tree growing through it)
  const t = el('sauna-terrace').footprint;
  await click(t[0][0] + 0.8, t[0][1] + 0.8, 0.36);
  await expect(card).toContainText('Sauna terrace');
  await expect(card).toContainText('Part of');
  // a birch in the back-left corner, inside the fence
  const birch = s.trees.find((x: { id: string }) => x.id === 't-bl-3');
  await click(birch.at[0], birch.at[1], birch.height * 0.66);
  await expect(card).toContainText('Birch');
  // a fence: the boundary card
  await click(24, 0, 1.2);
  await expect(card).toContainText('Boundary');
  expect(errors).toEqual([]);
});

test('measures the road side at 49 m and walks in', async ({ page }) => {
  const errors = await open(page);
  const s = await site(page);
  await page.getByRole('toolbar').getByText('Top').click();
  await page.waitForTimeout(1500);
  const road = s.plot.edges.find((e: { id: string }) => e.id === 'road');
  await page.getByRole('toolbar').getByText('Measure').click();
  // click slightly off the corners: the tool snaps to them
  const a = await screenOf(page, road.a[0] + 0.3, road.a[1] + 0.3, heightAt(s, road.a[0], road.a[1]));
  const b = await screenOf(page, road.b[0] - 0.3, road.b[1] + 0.3, heightAt(s, road.b[0], road.b[1]));
  await page.mouse.click(a[0], a[1]);
  await page.mouse.click(b[0], b[1]);
  const label = page.locator('.lbl.measure').first();
  await expect(label).toBeVisible();
  const m = parseFloat((await label.textContent())!);
  expect(m).toBeGreaterThan(48.8);
  expect(m).toBeLessThan(49.2);
  await page.keyboard.press('Escape');
  await page.getByRole('toolbar').getByText('Walk').click();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  await expect(page.getByText('Eye height 1.65 m')).toBeVisible();
  await page.getByRole('toolbar').getByText('3D').click();
  expect(errors).toEqual([]);
});

test('makes own variants on the corrected site, compares them and exports a textured model', async ({ page }) => {
  // start from no saved variants
  await page.request.put(`/api/projects/${PID}/variants`, { data: { variants: [] } });
  const errors = await open(page);
  mkdirSync(OUT, { recursive: true });
  await page.getByRole('navigation').getByText('Plan').click();
  await expect(page.getByTestId('variant-card')).toHaveCount(0); // nothing is generated on its own
  await page.getByRole('button', { name: 'New variant' }).click();
  await expect(page.getByLabel('Variant name')).toHaveValue('Variant 1');
  await page.getByLabel('Building brief').fill('a two-storey house near the forest, a garage and a sauna by the road');
  await page.getByRole('button', { name: 'Add to this variant' }).click();
  await expect(page.getByTestId('building-row')).toHaveCount(3, { timeout: 90_000 });
  // add one from the list, then remove it with the Delete key
  await page.getByLabel('Building to add').selectOption('shed');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('building-row')).toHaveCount(4, { timeout: 30_000 });
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('building-row')).toHaveCount(3);
  // every new building sits inside the plot and clears none of the kept structures
  const v1 = await page.evaluate(() => (window as unknown as { __meraStore: { getState: () => { variants: { placed: { u: number; v: number; w: number; d: number }[]; removed: string[] }[] } } }).__meraStore.getState().variants[0]);
  for (const p of v1.placed) {
    expect(p.u - p.w / 2).toBeGreaterThanOrEqual(0);
    expect(p.u + p.w / 2).toBeLessThanOrEqual(49);
    expect(p.v - p.d / 2).toBeGreaterThanOrEqual(0);
    expect(p.v + p.d / 2).toBeLessThanOrEqual(50);
  }
  for (const kept of ['house', 'veranda', 'sauna', 'sauna-terrace', 'utility-cabin']) expect(v1.removed).not.toContain(kept);
  // a second variant with just a house
  await page.getByRole('button', { name: 'New variant' }).click();
  await expect(page.getByLabel('Variant name')).toHaveValue('Variant 2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('building-row')).toHaveCount(1, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Compare Variant 1' }).click();
  await page.getByRole('button', { name: 'Compare Variant 2' }).click();
  await page.getByTestId('variant-card').first().click();
  await page.getByRole('navigation').getByText('Compare').click();
  await expect(page.getByRole('heading', { name: 'Side by side' })).toBeVisible();
  await expect(page.locator('.compare-cell')).toHaveCount(2);
  await page.waitForTimeout(3000);
  // export Variant 1 as GLB and OBJ, then re-import both in trimesh and Blender
  const files: string[] = [];
  for (const fmt of ['glTF (.glb)', 'OBJ (.zip)']) {
    await page.locator('header').getByText('Export').click();
    await page.getByText(fmt).click();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByTestId('do-export').click()]);
    const p = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(p);
    files.push(p);
    const result = page.getByTestId('export-result');
    await expect(result).toContainText(fmt.startsWith('glTF') ? 'Same as the model' : 'units = meters', { timeout: 60_000 });
    const n = parseInt(/(\d+) textures/.exec((await result.textContent())!)![1]);
    expect(n).toBeGreaterThan(20);
    await page.mouse.click(5, 300);
  }
  const out = execFileSync(PYTHON, [path.join(ROOT, 'pipeline/verify_export.py'), ...files, '--site', path.join(ROOT, `data/projects/${PID}/site.json`)], { encoding: 'utf8' });
  console.log(out.split('\n').filter((l) => /expected|trimesh|obj-text|blender :|New_|ALL|FAIL/.test(l)).join('\n'));
  expect(out).toContain('ALL OK');
  await page.request.put(`/api/projects/${PID}/variants`, { data: { variants: [] } });
  expect(errors).toEqual([]);
});
