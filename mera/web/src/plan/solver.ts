// Placement: simulated annealing over building positions/rotations inside the plot, with hard
// constraints (plot setbacks, no overlap with kept structures) and soft objectives (stated
// location, access from the gate, what has to be cleared). It places only the buildings the
// owner asked for; buildings already in the variant stay where the owner put them.
import type { Placed, Program, ProgramItem, Rules, SiteElement, Variant, Vec2 } from '../types';
import { CATALOG, heightsFor, isVolume } from './catalog';
import { AREA_KINDS, conflictsWith, evaluate, placedPoly, setbackFor, zoneSlack, HARD_KINDS, type PlanSite } from './metrics';
import { convexOverlap, dist, overlapArea, polyDist, rng, sideDist } from './geom';
import { describeZone } from './brief';

interface Weights {
  wZone: number;
  wRemove: number;
  wAccess: number;
}

const WEIGHTS: Weights = { wZone: 10, wRemove: 1, wAccess: 0.3 };

// removal cost per existing element kind (per item); areas are charged per m2 actually taken
const AREA_RATE: Partial<Record<SiteElement['kind'], number>> = { beds: 0.8, tilled: 0.3, parking: 0.5, rockgarden: 1.5 };
const REMOVE_COST: Partial<Record<SiteElement['kind'], (e: SiteElement) => number>> = {
  tree: () => 10,
  shed: () => 6,
  greenhouse: () => 18,
  woodpile: () => 3,
  tank: () => 2,
  trampoline: () => 2,
  deck: () => 60,
  other: () => 4,
};

export function makePlaced(it: ProgramItem, u: number, v: number, rot: 0 | 90): Placed {
  const spec = CATALOG[it.type];
  const { height, ridge } = heightsFor(it.type, it.storeys);
  const w = rot === 0 ? it.w : it.d;
  const d = rot === 0 ? it.d : it.w;
  return { itemId: it.id, type: it.type, label: it.label, u, v, w, d, rot, storeys: it.storeys, height, ridge, roof: spec.roof };
}

function removable(e: SiteElement, program: Program): boolean {
  if (program.keep.includes(e.id)) return false;
  if (program.clear.includes(e.id)) return true;
  return e.removable;
}

interface Ctx {
  site: PlanSite;
  program: Program;
  rules: Rules;
  s: Weights;
  cleared: Set<string>;
}

function cost(ctx: Ctx, L: Placed[]): { c: number; removed: Set<string> } {
  const { site, program, rules, s } = ctx;
  let c = 0;
  const removed = new Set(ctx.cleared);
  for (const p of L) {
    const poly = placedPoly(p);
    const it = program.items.find((i) => i.id === p.itemId);
    // plot + setbacks (hard)
    for (const e of site.edges) {
      const dmin = Math.min(...poly.map((q) => sideDist(q, e.a, e.b)));
      const lim = setbackFor(p, e.id, rules) + 0.05;
      if (dmin < lim) c += 2000 + 800 * (lim - dmin);
    }
    if (CATALOG[p.type].habitable && rules.respectForestBuffer) {
      const fe = site.edges.find((e) => e.id === 'forest')!;
      const dmin = Math.min(...poly.map((q) => sideDist(q, fe.a, fe.b)));
      if (dmin < rules.forestBuffer) c += 2000 + 300 * (rules.forestBuffer - dmin);
    }
    // existing structures: kept ones block, removable ones cost
    const pad = isVolume(p.type) ? 0.6 : 0.2;
    const grown: Vec2[] = [[poly[0][0] - pad, poly[0][1] - pad], [poly[1][0] + pad, poly[1][1] - pad], [poly[2][0] + pad, poly[2][1] + pad], [poly[3][0] - pad, poly[3][1] + pad]];
    for (const e of conflictsWith(grown, site.existing, new Set())) {
      if (p.type === 'garden' && (e.kind === 'beds' || e.kind === 'tilled')) continue; // a garden over beds is no loss
      if (p.type === 'parking' && e.kind === 'parking') continue;
      if (AREA_KINDS.has(e.kind)) { // takes part of a bed / field / parking: pay per m2, the rest stays
        if (!removable(e, program)) c += 3000;
        else c += s.wRemove * (AREA_RATE[e.kind] ?? 0.5) * overlapArea(poly, e.footprint);
        continue;
      }
      if (!removable(e, program)) { c += 3000 + 50 * overlapDepth(poly, e.footprint); continue; }
      if (!removed.has(e.id)) {
        removed.add(e.id);
        c += s.wRemove * (REMOVE_COST[e.kind]?.(e) ?? 4);
      }
    }
    // stated location
    if (it) c += s.wZone * zoneSlack(p, it.zone, site);
    if (it?.zone2) c += 0.5 * s.wZone * zoneSlack(p, it.zone2, site);
    if (it?.near) {
      const other = L.find((q) => q.itemId === it.near);
      const ex = site.existing.find((e) => e.id === it.near);
      const d = other ? polyDist(poly, placedPoly(other)) : ex ? polyDist(poly, ex.footprint) : 0;
      c += 3 * Math.max(0, d - rules.betweenBuildings - 1);
    }
    // access from the gate
    const dg = dist([p.u, p.v], site.entrance);
    c += s.wAccess * dg * (CATALOG[p.type].vehicle ? 3 : 1);
    if (CATALOG[p.type].vehicle) {
      // keep the strip between gate and garage door free of other buildings
      const door: Vec2 = [p.u, p.v - p.d / 2];
      for (const q of L) if (q !== p && isVolume(q.type) && segmentHitsRect(site.entrance, door, placedPoly(q), 1.5)) c += 400;
      for (const e of site.existing) if (!removed.has(e.id) && HARD_KINDS.has(e.kind) && segmentHitsRect(site.entrance, door, e.footprint, 1.5)) c += removable(e, program) ? 60 : 400;
    }
  }
  // pairwise
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j];
    const d = polyDist(placedPoly(a), placedPoly(b));
    const need = isVolume(a.type) && isVolume(b.type) ? rules.betweenBuildings : 0.5;
    if (d <= 0) c += 3000 + 50 * overlapDepth(placedPoly(a), placedPoly(b));
    else if (d < need) c += 150 * (need - d);
    const san = (a.type === 'sauna' && (b.type === 'house' || b.type === 'guesthouse')) || (b.type === 'sauna' && (a.type === 'house' || a.type === 'guesthouse'));
    if (san && d < rules.houseToSauna) c += 120 * (rules.houseToSauna - d);
  }
  // sanitary distance to existing house / sauna that stay
  for (const p of L) {
    const isSauna = p.type === 'sauna';
    const isHouse = p.type === 'house' || p.type === 'guesthouse';
    if (!isSauna && !isHouse) continue;
    for (const e of site.existing) {
      if (removed.has(e.id)) continue;
      if ((isSauna && e.kind === 'house') || (isHouse && e.kind === 'sauna')) {
        const d = polyDist(placedPoly(p), e.footprint);
        if (d < ctx.rules.houseToSauna) c += 120 * (ctx.rules.houseToSauna - d);
      }
    }
  }
  return { c, removed };
}

function overlapDepth(a: Vec2[], b: Vec2[]): number {
  const au = a.map((p) => p[0]), av = a.map((p) => p[1]), bu = b.map((p) => p[0]), bv = b.map((p) => p[1]);
  const ou = Math.min(Math.max(...au), Math.max(...bu)) - Math.max(Math.min(...au), Math.min(...bu));
  const ov = Math.min(Math.max(...av), Math.max(...bv)) - Math.max(Math.min(...av), Math.min(...bv));
  return Math.max(0, Math.min(ou, ov));
}

/** Does a corridor of +-halfWidth around segment a->b overlap the polygon? (one SAT test) */
function segmentHitsRect(a: Vec2, b: Vec2, poly: Vec2[], halfWidth: number): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * halfWidth, ny = (dx / L) * halfWidth;
  const corridor: Vec2[] = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
  return convexOverlap(corridor, poly);
}

function anneal(ctx: Ctx, seed: number, fixed: Placed[]): { L: Placed[]; c: number; removed: Set<string> } {
  const R = rng(seed);
  const { site, program } = ctx;
  const us = site.poly.map((p) => p[0]), vs = site.poly.map((p) => p[1]);
  const umin = Math.min(...us), umax = Math.max(...us), vmin = Math.min(...vs), vmax = Math.max(...vs);
  const fixedIds = new Set(fixed.map((p) => p.itemId));
  const items = program.items.filter((it) => !fixedIds.has(it.id));
  const cost0 = (L: Placed[]) => cost(ctx, [...fixed, ...L]);
  const fixedRot = (it: ProgramItem) => CATALOG[it.type].vehicle;
  let L: Placed[] = items.map((it) => {
    // seed near the stated zone
    let u = umin + R() * (umax - umin), v = vmin + R() * (vmax - vmin);
    if (it.zone === 'forest') v = vmax - 4 - it.d / 2 - R() * 6;
    if (it.zone === 'road') v = vmin + 5 + it.d / 2 + R() * 6;
    if (it.zone === 'left') u = umin + 3 + it.w / 2 + R() * 6;
    if (it.zone === 'right') u = umax - 3 - it.w / 2 - R() * 6;
    if (it.zone === 'corner' && site.corner) { u = site.corner[0] + (R() - 0.5) * 6; v = site.corner[1] + (R() - 0.5) * 6; }
    const rot: 0 | 90 = fixedRot(it) ? 0 : R() < 0.5 ? 0 : 90;
    return makePlaced(it, u, v, rot);
  });
  let cur = cost0(L);
  let best = { L, ...cur };
  const iters = items.length ? 2200 + 600 * items.length : 0;
  let T = 60;
  for (let k = 0; k < iters; k++) {
    T = 60 * Math.pow(0.02 / 60, k / iters) + 0.02;
    const i = Math.floor(R() * L.length);
    const it = items[i];
    const p = L[i];
    const r = R();
    let np: Placed;
    if (r < 0.12 && !fixedRot(it)) np = makePlaced(it, p.u, p.v, p.rot === 0 ? 90 : 0);
    else if (r < 0.2) np = makePlaced(it, umin + R() * (umax - umin), vmin + R() * (vmax - vmin), p.rot);
    else {
      const step = 0.4 + 6 * (T / 60);
      np = makePlaced(it, p.u + (R() - 0.5) * 2 * step, p.v + (R() - 0.5) * 2 * step, p.rot);
    }
    const NL = L.slice();
    NL[i] = np;
    const nc = cost0(NL);
    if (nc.c < cur.c || R() < Math.exp((cur.c - nc.c) / T)) {
      L = NL;
      cur = nc;
      if (cur.c < best.c) best = { L, ...cur };
    }
  }
  // snap to a 0.25 m grid so dimensions read cleanly, keep only if still as good
  const snapped = best.L.map((p) => ({ ...p, u: Math.round(p.u * 4) / 4, v: Math.round(p.v * 4) / 4 }));
  const sc = cost0(snapped);
  return sc.c <= best.c + 1 ? { L: snapped, ...sc } : best;
}

/**
 * Place the buildings of `program` that are not yet in `fixed`, leaving `fixed` untouched.
 * Returns all placed buildings (fixed first) and the existing structures that would be cleared.
 */
export function placeItems(site: PlanSite, program: Program, fixed: Placed[], rules: Rules, seed = 1): { placed: Placed[]; removed: string[] } {
  const ctx: Ctx = { site, program, rules, s: WEIGHTS, cleared: new Set(program.clear) };
  let best: ReturnType<typeof anneal> | null = null;
  for (let r = 0; r < 3; r++) {
    const res = anneal(ctx, seed + r * 7919, fixed);
    if (!best || res.c < best.c) best = res;
  }
  return { placed: [...fixed, ...best!.L], removed: [...best!.removed] };
}

export function reevaluate(site: PlanSite, v: Variant, rules: Rules): Variant {
  // removals follow the current positions: anything removable under a building is cleared
  const removed = new Set(v.program.clear);
  for (const p of v.placed) {
    for (const e of conflictsWith(placedPoly(p), site.existing, new Set())) {
      if (AREA_KINDS.has(e.kind)) continue; // partly taken, reported in m2
      if (removable(e, v.program)) removed.add(e.id);
    }
  }
  const ev = evaluate(site, v.program, v.placed, [...removed], rules);
  return { ...v, removed: [...removed], paths: ev.paths, metrics: ev.metrics, checks: ev.checks };
}

/**
 * Does each building of the program fit in the corner the video's author points out? Returns plain-language
 * findings, e.g. "House: no — would be 3.1 m from the existing sauna (8 m needed)".
 */
export function cornerReport(site: PlanSite, program: Program, rules: Rules, zone: Vec2[] | null): string[] {
  if (!zone) return [];
  const us = zone.map((p) => p[0]), vs = zone.map((p) => p[1]);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of program.items) {
    if (!isVolume(it.type) || seen.has(it.type + it.w + it.d)) continue;
    seen.add(it.type + it.w + it.d);
    let best: { score: number; reasons: string[] } | null = null;
    for (const rot of [0, 90] as const) {
      const p0 = makePlaced(it, 0, 0, rot);
      for (let u = Math.min(...us) + p0.w / 2; u <= Math.max(...us) - p0.w / 2 + 1e-6; u += 0.5) {
        for (let v = Math.min(...vs) + p0.d / 2; v <= Math.max(...vs) - p0.d / 2 + 1e-6; v += 0.5) {
          const p = makePlaced(it, u, v, rot);
          const poly = placedPoly(p);
          const reasons: string[] = [];
          let score = 0;
          for (const e of site.edges) {
            const d = Math.min(...poly.map((q) => sideDist(q, e.a, e.b)));
            const lim = setbackFor(p, e.id, rules);
            if (d < lim - 1e-6) { reasons.push(`only ${Math.max(0, d).toFixed(1)} m from the ${e.id === 'forest' ? 'forest-side' : e.id} boundary (${lim} m needed)`); score += lim - d; }
          }
          for (const e of site.existing) {
            if (e.footprint.length < 3) continue;
            const d = polyDist(poly, e.footprint);
            const san = (CATALOG[it.type].habitable && e.kind === 'sauna') || (it.type === 'sauna' && e.kind === 'house');
            if (san && d < rules.houseToSauna) { reasons.push(`${d.toFixed(1)} m from the existing ${e.label.split(' (')[0].toLowerCase()} (${rules.houseToSauna} m sanitary distance)`); score += rules.houseToSauna - d; }
            if (d <= 0 && !e.removable && e.kind !== 'gate') { reasons.push(`overlaps the ${e.label.split(' (')[0].toLowerCase()}`); score += 5; }
          }
          if (!best || score < best.score) best = { score, reasons };
        }
      }
    }
    const name = it.label.split(' ·')[0];
    if (!best) out.push(`${name} (${it.w}×${it.d} m) is larger than the corner.`);
    else if (best.score <= 1e-6) out.push(`${name} (${it.w}×${it.d} m) fits in the corner named in the video.`);
    else out.push(`${name} (${it.w}×${it.d} m) does not fit in the corner named in the video: at best it is ${[...new Set(best.reasons)].join('; ')}.`);
  }
  return out;
}

export { describeZone };
