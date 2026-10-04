// Runs the example briefs against the real survey when it is present (data is not committed).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBrief } from './brief';
import { cornerReport, placeItems } from './solver';
import { createVariant, refresh } from './variants';
import { planSite } from './metrics';
import { pointInPoly } from './geom';
import { DEFAULT_RULES } from './catalog';
import type { SiteModel } from '../types';

const path = new URL('../../../data/projects/plot/site.json', import.meta.url);
const has = existsSync(path);

describe.skipIf(!has)('real plot', () => {
  const site = has ? (JSON.parse(readFileSync(path, 'utf8')) as SiteModel) : (null as unknown as SiteModel);
  const ps = has ? planSite(site) : (null as never);
  const corner = has ? site.zones.find((z) => z.id === 'build-corner')!.polygon : null;
  for (const brief of [
    'a two-storey house near the forest, a garage and a sauna by the road',
    'Pool and gazebo in the middle, keep the garden beds',
    'Guest house 6x6 in the corner behind the sauna, remove the old sheds',
    'Двухэтажный дом у леса, гараж и баня у дороги',
    'a workshop in the corner',
  ]) {
    it(brief, () => {
      const prog = parseBrief(brief, site.elements);
      const placed = placeItems(ps, prog, [], DEFAULT_RULES).placed;
      const v = refresh(ps, { ...createVariant(ps, DEFAULT_RULES, []), program: prog, placed }, DEFAULT_RULES);
      expect(placed.length).toBe(prog.items.length);
      const broken = v.checks.filter((c) => !c.ok && c.severity === 'rule').map((c) => c.label);
      console.log(`\n${brief}\n  placed: ${v.summary} | broken: ${broken.join('; ') || 'none'} | clears: ${v.metrics.removed.join(', ') || '-'}\n  corner: ${cornerReport(ps, prog, DEFAULT_RULES, corner).join(' / ')}`);
      expect(broken).toEqual([]);
      // every building stays inside the boundary
      for (const p of placed) {
        expect(p.u - p.w / 2).toBeGreaterThanOrEqual(0);
        expect(p.u + p.w / 2).toBeLessThanOrEqual(site.plot.width);
        expect(p.v - p.d / 2).toBeGreaterThanOrEqual(0);
        expect(p.v + p.d / 2).toBeLessThanOrEqual(site.plot.depth);
      }
    });
  }
});

// The three placements the review found wrong, checked against the corrected survey.
describe.skipIf(!has)('corrected placements', () => {
  const site = has ? (JSON.parse(readFileSync(path, 'utf8')) as SiteModel) : (null as unknown as SiteModel);
  const el = (id: string) => site.elements.find((e) => e.id === id)!;
  const poly = has ? site.plot.polygon! : [];
  const span = (fp: [number, number][], k: 0 | 1) => [Math.min(...fp.map((p) => p[k])), Math.max(...fp.map((p) => p[k]))];

  it('puts the terrace in front of the sauna, not on the house side', () => {
    const sauna = el('sauna'), terrace = el('sauna-terrace'), house = el('house');
    const [su0, su1] = span(sauna.footprint, 0), [sv0] = span(sauna.footprint, 1);
    const [tu0, tu1] = span(terrace.footprint, 0), [, tv1] = span(terrace.footprint, 1);
    const overlap = Math.min(su1, tu1) - Math.max(su0, tu0);
    expect(overlap / (su1 - su0)).toBeGreaterThan(0.8); // spans the sauna's front
    expect(Math.abs(tv1 - sv0)).toBeLessThan(0.3); // and meets its front wall, on the road side
    expect(tu0).toBeGreaterThan(span(house.footprint, 0)[1]); // entirely clear of the house side
  });

  it('keeps the corner trees inside the boundary', () => {
    const corner = (site.trees ?? []).filter((t) => t.id.startsWith('t-bl-') || t.id.startsWith('t-fl-'));
    expect(corner.length).toBeGreaterThanOrEqual(8);
    for (const t of corner) expect(pointInPoly(t.at, poly)).toBe(true);
  });

  it('stands the utility cabin behind the sauna on its left, mostly outside the back fence', () => {
    const cabin = el('utility-cabin'), sauna = el('sauna');
    const back = Math.max(...poly.map((p) => p[1]));
    const [cv0, cv1] = span(cabin.footprint, 1), [cu0, cu1] = span(cabin.footprint, 0);
    expect(cabin.outside).toBe(true);
    expect((cv1 - Math.max(cv0, back)) / (cv1 - cv0)).toBeGreaterThan(0.9); // mostly beyond the fence
    expect(Math.abs(cv0 - back)).toBeLessThan(0.3); // its door wall is on the fence line
    expect(cu0).toBeLessThan(span(sauna.footprint, 0)[0]); // reaches left of the sauna
    expect((cu0 + cu1) / 2).toBeLessThan(sauna.center![0]); // on the sauna's left
    expect(cv0).toBeGreaterThan(span(sauna.footprint, 1)[1] - 0.3); // behind it
  });
});
