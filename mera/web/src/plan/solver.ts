// Layout generation: simulated annealing over building positions/rotations inside the plot,
// with hard constraints (plot setbacks, no overlap with kept structures) and soft objectives
// weighted differently per strategy so the variants are genuinely different answers.
import type { Placed, Program, ProgramItem, Rules, SiteElement, Variant, Vec2 } from '../types';
import { CATALOG, heightsFor, isVolume } from './catalog';
import { conflictsWith, evaluate, placedPoly, setbackFor, zoneSlack, HARD_KINDS, type PlanSite } from './metrics';
import { convexOverlap, dist, hash, polyDist, rng, sideDist, area } from './geom';
import { describeZone } from './brief';

interface Strategy {
  id: string;
  name: string;
  blurb: string;
  wZone: number;
  wRemove: number;
  wAccess: number;
  wCompact: number;
  wPeriph: number;
}

export const STRATEGIES: Strategy[] = [
  { id: 'literal', name: 'As described', blurb: 'Follows the brief as literally as the rules allow.', wZone: 10, wRemove: 1, wAccess: 0.3, wCompact: 0, wPeriph: 0 },
  { id: 'keep', name: 'Keep what is there', blurb: 'Disturbs the fewest beds, trees and sheds.', wZone: 3, wRemove: 9, wAccess: 0.2, wCompact: 0, wPeriph: 0.5 },
  { id: 'compact', name: 'Short walks', blurb: 'Buildings close to the gate and to each other.', wZone: 3, wRemove: 1.5, wAccess: 2, wCompact: 1, wPeriph: 0 },
  { id: 'lawn', name: 'Open lawn', blurb: 'Keeps one large open area in the middle.', wZone: 3, wRemove: 1.5, wAccess: 0.2, wCompact: 0, wPeriph: 3 },
];

// removal cost per existing element kind (per m^2 for areas, per item for objects)
const REMOVE_COST: Partial<Record<SiteElement['kind'], (e: SiteElement) => number>> = {
  beds: (e) => 0.6 * area(e.footprint),
  tilled: (e) => 0.25 * area(e.footprint),
  rockgarden: () => 12,
  tree: () => 10,
  shed: () => 6,
  greenhouse: () => 18,
  woodpile: () => 3,
  tank: () => 2,
  trampoline: () => 2,
  parking: (e) => 0.8 * area(e.footprint),
  deck: () => 60,
  other: () => 4,
};

function makePlaced(it: ProgramItem, u: number, v: number, rot: 0 | 90): Placed {
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
  s: Strategy;
  cleared: Set<string>;
  /** lateral target (0..1 of plot width) for the main building, to explore distinct arrangements */
  biasU?: number;
}

function cost(ctx: Ctx, L: Placed[]): { c: number; removed: Set<string> } {
  const { site, program, rules, s } = ctx;
  let c = 0;
  const removed = new Set(ctx.cleared);
  for (const p of L) {
    const poly = placedPoly(p);
    const it = program.items.find((i) => i.id === p.itemId)!;
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
      if (!removable(e, program)) { c += 3000 + 50 * overlapDepth(poly, e.footprint); continue; }
      if (!removed.has(e.id)) {
        removed.add(e.id);
        c += s.wRemove * (REMOVE_COST[e.kind]?.(e) ?? 4);
      }
    }
    // stated location
    c += s.wZone * zoneSlack(p, it.zone, site);
    if (it.zone2) c += 0.5 * s.wZone * zoneSlack(p, it.zone2, site);
    if (it.near) {
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
    // hug the boundary to leave the middle open
    if (s.wPeriph) {
      const m = Math.min(...site.edges.map((e) => Math.min(...poly.map((q) => sideDist(q, e.a, e.b))) - setbackFor(p, e.id, rules)));
      c += s.wPeriph * Math.max(0, m);
    }
  }
  if (ctx.biasU !== undefined && L.length) {
    const main = L.reduce((a, b) => (a.w * a.d * (isVolume(a.type) ? 2 : 1) >= b.w * b.d * (isVolume(b.type) ? 2 : 1) ? a : b));
    const us = site.poly.map((q) => q[0]);
    const target = Math.min(...us) + ctx.biasU * (Math.max(...us) - Math.min(...us));
    c += 1.2 * Math.abs(main.u - target);
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
    if (s.wCompact && isVolume(a.type) && isVolume(b.type)) c += s.wCompact * 0.3 * d;
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

function anneal(ctx: Ctx, seed: number): { L: Placed[]; c: number; removed: Set<string> } {
  const R = rng(seed);
  const { site, program } = ctx;
  const us = site.poly.map((p) => p[0]), vs = site.poly.map((p) => p[1]);
  const umin = Math.min(...us), umax = Math.max(...us), vmin = Math.min(...vs), vmax = Math.max(...vs);
  const items = program.items;
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
  let cur = cost(ctx, L);
  let best = { L, ...cur };
  const iters = 2200 + 600 * items.length;
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
    const nc = cost(ctx, NL);
    if (nc.c < cur.c || R() < Math.exp((cur.c - nc.c) / T)) {
      L = NL;
      cur = nc;
      if (cur.c < best.c) best = { L, ...cur };
    }
  }
  // snap to a 0.25 m grid so dimensions read cleanly, keep only if still as good
  const snapped = best.L.map((p) => ({ ...p, u: Math.round(p.u * 4) / 4, v: Math.round(p.v * 4) / 4 }));
  const sc = cost(ctx, snapped);
  return sc.c <= best.c + 1 ? { L: snapped, ...sc } : best;
}

const BIASES: (number | undefined)[] = [undefined, 0.22, 0.78, 0.5];

function layoutDistance(a: Placed[], b: Placed[]): number {
  let d = 0;
  for (let k = 0; k < a.length; k++) d += dist([a[k].u, a[k].v], [b[k].u, b[k].v]) + (a[k].rot !== b[k].rot ? 3 : 0);
  return d / Math.max(1, a.length);
}

export function generateVariants(site: PlanSite, program: Program, rules: Rules, brief: string): Variant[] {
  if (!program.items.length) return [];
  const cleared = new Set(program.clear);
  const seed0 = hash(brief + JSON.stringify(rules) + JSON.stringify(program.items.map((i) => [i.type, i.w, i.d, i.zone, i.storeys])));
  const literal: Ctx = { site, program, rules, s: STRATEGIES[0], cleared };
  // 1. explore: every strategy x lateral bias
  const cands: { L: Placed[]; removed: string[]; s: Strategy; score: number }[] = [];
  for (const [si, s] of STRATEGIES.entries()) {
    for (const [bi, biasU] of BIASES.entries()) {
      const res = anneal({ site, program, rules, s, cleared, biasU }, seed0 + si * 101 + bi * 7919);
      const score = cost(literal, res.L).c; // judge everything on one yardstick: the brief + the rules
      cands.push({ L: res.L, removed: [...res.removed], s, score });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  const feasible = cands.filter((c) => c.score < 2000);
  const pool = feasible.length ? feasible : cands;
  // 2. select: best first, then the best candidates that are genuinely different arrangements
  const chosen: typeof cands = [pool[0]];
  const s0 = pool[0].score;
  for (const minD of [6, 3.5, 2]) {
    for (const c of pool) {
      if (chosen.length >= 4) break;
      if (chosen.includes(c)) continue;
      if (c.score > s0 + 160) continue; // not much worse than the best
      if (Math.min(...chosen.map((x) => layoutDistance(x.L, c.L))) >= minD) chosen.push(c);
    }
  }
  const out: Variant[] = [];
  for (const c of chosen) {
    const ev = evaluate(site, program, c.L, c.removed, rules);
    out.push({
      id: `v-${seed0.toString(36)}-${out.length}`,
      name: '',
      strategy: c.s.id,
      summary: '',
      brief,
      program,
      placed: c.L,
      removed: c.removed,
      paths: ev.paths,
      metrics: ev.metrics,
      checks: ev.checks,
      createdAt: new Date().toISOString(),
    });
  }
  nameVariants(out, site);
  return out;
}

/** Name each variant by what it does best among the set, and describe its arrangement. */
function nameVariants(vs: Variant[], site: PlanSite) {
  const best = (f: (v: Variant) => number, dir: 1 | -1) => {
    let b: Variant | null = null;
    for (const v of vs) if (!b || dir * f(v) > dir * f(b)) b = v;
    return b;
  };
  const titles = new Map<Variant, string>();
  const claim = (v: Variant | null, t: string) => { if (v && !titles.has(v)) titles.set(v, t); };
  claim(vs[0], 'Closest to the brief');
  claim(best((v) => v.metrics.largestOpen, 1), 'Largest open lawn');
  claim(best((v) => v.metrics.removed.length, -1), 'Keeps the most');
  claim(best((v) => v.metrics.gateWalk + (v.metrics.driveway ?? 0), -1), 'Shortest walks');
  const us = site.poly.map((q) => q[0]);
  const vs2 = site.poly.map((q) => q[1]);
  const W = Math.max(...us) - Math.min(...us);
  const D = Math.max(...vs2) - Math.min(...vs2);
  const sideOf = (u: number) => (u < W * 0.38 ? 'left' : u > W * 0.62 ? 'right' : 'centre');
  // arrangement phrases, most important first, used to tell variants apart
  const phrases = vs.map((v) => {
    const sorted = [...v.placed].sort((a, b) => b.w * b.d * (isVolume(b.type) ? 2 : 1) - a.w * a.d * (isVolume(a.type) ? 2 : 1));
    return sorted.map((p, k) => {
      const short = p.label.split(' ·')[0].split(' (')[0];
      if (k === 0) return `${short} ${sideOf(p.u)}`;
      if (p.v < D / 2) return `${short.toLowerCase()} ${p.u < site.entrance[0] ? 'left' : 'right'} of gate`;
      return `${short.toLowerCase()} ${sideOf(p.u)} back`;
    });
  });
  const names = vs.map((v, i) => titles.get(v) ?? phrases[i][0]);
  for (let depth = 1; depth < 4; depth++) {
    const counts = new Map<string, number>();
    names.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
    let changed = false;
    names.forEach((n, i) => {
      if ((counts.get(n) ?? 0) > 1 && !titles.has(vs[i]) && phrases[i][depth]) { names[i] = `${n}, ${phrases[i][depth]}`; changed = true; }
    });
    if (!changed) break;
  }
  vs.forEach((v, i) => {
    const main = v.placed.reduce((a, b) => (a.w * a.d >= b.w * b.d ? a : b));
    v.name = `${String.fromCharCode(65 + i)} · ${names[i]}`;
    v.summary = describe(v, site, sideOf(main.u));
  });
}

function describe(v: Variant, site: PlanSite, side: string): string {
  const m = v.metrics;
  const parts: string[] = [];
  const main = v.placed.reduce((a, b) => (a.w * a.d >= b.w * b.d ? a : b));
  parts.push(`${main.label.split(' ·')[0]} on the ${side} ${main.v > 25 ? 'forest side' : 'road side'}${m.houseToForest !== null && main.type === 'house' ? `, ${m.houseToForest.toFixed(1)} m from the back fence` : ''}.`);
  for (const p of v.placed) {
    if (p === main || !CATALOG[p.type].vehicle) continue;
    parts.push(`${p.label} ${p.u < site.entrance[0] ? 'left' : 'right'} of the gate${m.driveway !== null ? ` (${m.driveway} m drive)` : ''}.`);
    break;
  }
  parts.push(m.removed.length ? `Clears ${m.removed.slice(0, 3).join(', ')}${m.removed.length > 3 ? ` +${m.removed.length - 3}` : ''}.` : 'Clears nothing.');
  return parts.join(' ');
}

export function reevaluate(site: PlanSite, v: Variant, rules: Rules): Variant {
  // removals follow the current positions: anything removable under a building is cleared
  const removed = new Set(v.program.clear);
  for (const p of v.placed) {
    for (const e of conflictsWith(placedPoly(p), site.existing, new Set())) {
      if (p.type === 'garden' && (e.kind === 'beds' || e.kind === 'tilled')) continue;
      if (p.type === 'parking' && e.kind === 'parking') continue;
      if (removable(e, v.program)) removed.add(e.id);
    }
  }
  const ev = evaluate(site, v.program, v.placed, [...removed], rules);
  return { ...v, removed: [...removed], paths: ev.paths, metrics: ev.metrics, checks: ev.checks };
}

export { describeZone };
