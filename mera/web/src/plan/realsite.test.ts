// Runs the example briefs against the real survey when it is present (data is not committed).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBrief } from './brief';
import { cornerReport, generateVariants } from './solver';
import { planSite } from './metrics';
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
      const vs = generateVariants(ps, prog, DEFAULT_RULES, brief);
      expect(vs.length).toBeGreaterThan(0);
      const lines = vs.map((v) => `${v.name} | broken: ${v.checks.filter((c) => !c.ok && c.severity === 'rule').map((c) => c.label).join('; ') || 'none'} | clears: ${v.metrics.removed.join(', ') || '-'}`);
      console.log(`\n${brief}\n  ${lines.join('\n  ')}\n  corner: ${cornerReport(ps, prog, DEFAULT_RULES, corner).join(' / ')}`);
      // every variant keeps every building inside the owner's boundary
      for (const v of vs) for (const p of v.placed) {
        expect(p.u - p.w / 2).toBeGreaterThanOrEqual(0);
        expect(p.u + p.w / 2).toBeLessThanOrEqual(site.plot.width);
        expect(p.v - p.d / 2).toBeGreaterThanOrEqual(0);
        expect(p.v + p.d / 2).toBeLessThanOrEqual(site.plot.depth);
      }
    });
  }
});
