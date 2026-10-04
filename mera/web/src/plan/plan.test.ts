import { describe, expect, it } from 'vitest';
import { parseBrief } from './brief';
import { placeItems } from './solver';
import { createVariant, mergeItems, refresh, removeItem, updateItem } from './variants';
import { planSite } from './metrics';
import { DEFAULT_RULES } from './catalog';
import type { SiteElement, SiteModel } from '../types';

const rect = (u0: number, v0: number, u1: number, v1: number): [number, number][] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
const el = (id: string, kind: SiteElement['kind'], fp: [number, number][], removable = true, height = 3): SiteElement => ({
  id, kind, label: id, footprint: fp, height, provenance: 'reconstructed', uncertainty: 0.4, evidence: {}, removable,
});

function fakeSite(): SiteModel {
  const W = 48.5, D = 50;
  return {
    id: 't', name: 'test', units: 'm', createdAt: '',
    plot: {
      width: W, depth: D, statedWidth: [48, 49], statedDepth: [50, 50],
      edges: [
        { id: 'road', a: [0, 0], b: [W, 0], statedLength: [48, 49], modelLength: W, rawResidual: 0.2 },
        { id: 'right', a: [W, 0], b: [W, D], statedLength: [50, 50], modelLength: D, rawResidual: 0.2 },
        { id: 'forest', a: [W, D], b: [0, D], statedLength: [48, 49], modelLength: W, rawResidual: 0.2 },
        { id: 'left', a: [0, D], b: [0, 0], statedLength: [50, 50], modelLength: D, rawResidual: 0.2 },
      ],
      entrance: { u: 30, width: 4, provenance: 'reconstructed', evidence: {} },
    },
    terrain: { h0: 0, gu: 0, gv: -0.02, provenance: 'reconstructed', slopePct: 2, fallDirectionDeg: 0, heightUncertainty: 0.3, note: '' },
    elements: [
      el('house', 'house', rect(14, 24, 23, 32), false),
      el('sauna', 'sauna', rect(30, 30, 36, 35), false),
      el('shed1', 'shed', rect(38, 44, 42, 48)),
      el('beds', 'beds', rect(5, 8, 20, 18)),
    ],
    zones: [], context: { forestDepth: 30, forestHeight: 22, roadWidth: 6, provenance: 'stated', note: '' },
    scale: { method: '', metersPerUnit: 1, aspectFit: 1, aspectStated: 1, checks: [], expectedAccuracy: '' },
    reconstruction: { frames: 0, registered: 0, points: 0, reprojectionError: 0, clips: [], gravity: '' },
    cameras: [], pins: [], pointcloud: null, conflicts: [], sourceClips: {},
  };
}

describe('brief parser', () => {
  it('reads the reference English brief', () => {
    const p = parseBrief('a two-storey house near the forest, a garage and a sauna by the road', fakeSite().elements);
    expect(p.items.map((i) => [i.type, i.zone, i.storeys])).toEqual([
      ['house', 'forest', 2],
      ['garage', 'road', 1],
      ['sauna', 'road', 1],
    ]);
    expect(p.unparsed).toEqual([]);
  });
  it('reads Russian', () => {
    const p = parseBrief('Двухэтажный дом у леса, гараж и баня у дороги', fakeSite().elements);
    expect(p.items.map((i) => [i.type, i.zone, i.storeys])).toEqual([
      ['house', 'forest', 2],
      ['garage', 'road', 1],
      ['sauna', 'road', 1],
    ]);
  });
  it('reads sizes, counts and keep/remove', () => {
    const p = parseBrief('guest house 6x7 in the corner, remove the old sheds, two greenhouses', fakeSite().elements);
    expect(p.items[0]).toMatchObject({ type: 'guesthouse', w: 7, d: 6, zone: 'corner', sizeFromBrief: true });
    expect(p.items.filter((i) => i.type === 'greenhouse')).toHaveLength(2);
    expect(p.clear).toContain('shed1');
  });
  it('reports what it did not understand', () => {
    const p = parseBrief('a house, and a helipad', fakeSite().elements);
    expect(p.items).toHaveLength(1);
    expect(p.unparsed.join(' ')).toMatch(/helipad/);
  });
});

describe('placement', () => {
  it('places every requested building inside the plot and honours setbacks', () => {
    const site = fakeSite();
    const ps = planSite(site);
    const prog = parseBrief('a two-storey house near the forest, a garage and a sauna by the road', site.elements);
    const v = refresh(ps, { ...createVariant(ps, DEFAULT_RULES, []), program: prog, placed: placeItems(ps, prog, [], DEFAULT_RULES).placed }, DEFAULT_RULES);
    expect(v.placed.map((p) => p.type).sort()).toEqual(['garage', 'house', 'sauna']);
    for (const p of v.placed) {
      expect(p.u - p.w / 2).toBeGreaterThanOrEqual(0.99);
      expect(p.u + p.w / 2).toBeLessThanOrEqual(48.5 - 0.99);
      expect(p.v - p.d / 2).toBeGreaterThanOrEqual(0.99);
      expect(p.v + p.d / 2).toBeLessThanOrEqual(50 - 0.99);
    }
    const house = v.placed.find((p) => p.type === 'house')!;
    const garage = v.placed.find((p) => p.type === 'garage')!;
    expect(house.v + house.d / 2).toBeLessThanOrEqual(50 - 3 + 1e-6);
    expect(house.u - house.w / 2).toBeGreaterThanOrEqual(3 - 1e-6);
    expect(50 - (house.v + house.d / 2)).toBeLessThan(8); // near the forest
    expect(garage.v - garage.d / 2).toBeLessThan(8); // by the road
    expect(v.checks.filter((c) => !c.ok && c.severity === 'rule').map((c) => c.label)).toEqual([]);
  });
  it('leaves buildings the owner already placed where they are', () => {
    const site = fakeSite();
    const ps = planSite(site);
    const first = parseBrief('a garage by the road', site.elements);
    const fixed = placeItems(ps, first, [], DEFAULT_RULES).placed;
    const moved = fixed.map((p) => ({ ...p, u: 10, v: 6 })); // the owner dragged it
    const { program, added } = mergeItems(first, parseBrief('a sauna', site.elements));
    const out = placeItems(ps, program, moved, DEFAULT_RULES).placed;
    expect(out[0]).toEqual(moved[0]);
    expect(out.map((p) => p.itemId)).toEqual([moved[0].itemId, ...added]);
  });
  it('is deterministic', () => {
    const site = fakeSite();
    const ps = planSite(site);
    const prog = parseBrief('a house near the forest and a garage by the road', site.elements);
    const a = placeItems(ps, prog, [], DEFAULT_RULES, 3).placed;
    const b = placeItems(ps, prog, [], DEFAULT_RULES, 3).placed;
    expect(a.map((p) => [p.u, p.v])).toEqual(b.map((p) => [p.u, p.v]));
  });
});

describe('owner variants', () => {
  it('start empty and get distinct names', () => {
    const ps = planSite(fakeSite());
    const a = createVariant(ps, DEFAULT_RULES, []);
    const b = createVariant(ps, DEFAULT_RULES, [a]);
    expect([a.name, b.name]).toEqual(['Variant 1', 'Variant 2']);
    expect(a.placed).toEqual([]);
    expect(a.summary).toBe('No buildings yet');
  });
  it('keeps item ids unique when briefs are added twice', () => {
    const site = fakeSite();
    const a = parseBrief('a sauna', site.elements);
    const b = parseBrief('a sauna', site.elements);
    const { program } = mergeItems(mergeItems({ items: [], keep: [], clear: [], notes: [], unparsed: [] }, a).program, b);
    expect(new Set(program.items.map((i) => i.id)).size).toBe(2);
  });
  it('resizes in place and removes buildings', () => {
    const site = fakeSite();
    const ps = planSite(site);
    const prog = parseBrief('a garage by the road', site.elements);
    let v = refresh(ps, { ...createVariant(ps, DEFAULT_RULES, []), program: prog, placed: placeItems(ps, prog, [], DEFAULT_RULES).placed }, DEFAULT_RULES);
    const id = v.placed[0].itemId;
    const before = v.placed[0];
    v = updateItem(ps, DEFAULT_RULES, v, id, { w: 7 });
    expect([v.placed[0].u, v.placed[0].v, v.placed[0].w]).toEqual([before.u, before.v, 7]);
    v = removeItem(ps, DEFAULT_RULES, v, id);
    expect(v.placed).toEqual([]);
    expect(v.program.items).toEqual([]);
  });
});

describe('geometry', () => {
  it('computes convex overlap areas', async () => {
    const { overlapArea } = await import('./geom');
    expect(overlapArea(rect(0, 0, 4, 4), rect(2, 2, 6, 6))).toBeCloseTo(4, 6);
    expect(overlapArea(rect(0, 0, 4, 4), rect(5, 5, 6, 6))).toBe(0);
    expect(overlapArea(rect(0, 0, 4, 4), rect(1, 1, 2, 2))).toBeCloseTo(1, 6);
  });
});
