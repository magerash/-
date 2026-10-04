import { describe, expect, it } from 'vitest';
import { parseBrief } from './brief';
import { generateVariants } from './solver';
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

describe('solver', () => {
  it('places every building inside the plot and honours setbacks', () => {
    const site = fakeSite();
    const ps = planSite(site);
    const prog = parseBrief('a two-storey house near the forest, a garage and a sauna by the road', site.elements);
    const vs = generateVariants(ps, prog, DEFAULT_RULES, 'x');
    expect(vs.length).toBeGreaterThanOrEqual(2);
    for (const v of vs) {
      for (const p of v.placed) {
        expect(p.u - p.w / 2).toBeGreaterThanOrEqual(0.99);
        expect(p.u + p.w / 2).toBeLessThanOrEqual(48.5 - 0.99);
        expect(p.v - p.d / 2).toBeGreaterThanOrEqual(0.99);
        expect(p.v + p.d / 2).toBeLessThanOrEqual(50 - 0.99);
      }
      const house = v.placed.find((p) => p.type === 'house')!;
      expect(house.v + house.d / 2).toBeLessThanOrEqual(50 - 3 + 1e-6);
      expect(house.u - house.w / 2).toBeGreaterThanOrEqual(3 - 1e-6);
      const broken = v.checks.filter((c) => !c.ok && c.severity === 'rule');
      expect(broken.map((c) => c.label)).toEqual([]);
    }
    const lit = vs[0];
    const house = lit.placed.find((p) => p.type === 'house')!;
    const garage = lit.placed.find((p) => p.type === 'garage')!;
    expect(50 - (house.v + house.d / 2)).toBeLessThan(8); // near the forest
    expect(garage.v - garage.d / 2).toBeLessThan(8); // by the road
  });
  it('is deterministic for the same brief', () => {
    const site = fakeSite();
    const ps = planSite(site);
    const prog = parseBrief('a house near the forest and a garage by the road', site.elements);
    const a = generateVariants(ps, prog, DEFAULT_RULES, 'same');
    const b = generateVariants(ps, prog, DEFAULT_RULES, 'same');
    expect(a.map((v) => v.placed.map((p) => [p.u, p.v]))).toEqual(b.map((v) => v.placed.map((p) => [p.u, p.v])));
  });
});
