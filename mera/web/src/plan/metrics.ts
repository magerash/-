// Shared evaluation of a layout: paths, metrics and rule checks. Used both by the solver (final
// scoring) and after the owner drags a building by hand, so numbers never go stale.
import type { Check, Metrics, Placed, Program, Rules, SiteElement, SiteModel, Vec2 } from '../types';
import { CATALOG, isVolume } from './catalog';
import { area, centroid, convexOverlap, dist, overlapArea, pathLength, polyDist, rectPoly, sideDist, simplify } from './geom';

export interface PlanSite {
  edges: { id: 'road' | 'right' | 'forest' | 'left'; a: Vec2; b: Vec2 }[]; // CCW, interior on the left
  poly: Vec2[];
  area: number;
  entrance: Vec2;
  existing: SiteElement[];
  corner: Vec2 | null;
  uncertainty: number;
}

export function planSite(site: SiteModel): PlanSite {
  const byId = Object.fromEntries(site.plot.edges.map((e) => [e.id, e]));
  const order = ['road', 'right', 'forest', 'left'] as const;
  const edges = order.map((id) => ({ id, a: byId[id].a, b: byId[id].b }));
  const poly = edges.map((e) => e.a);
  const corner = site.zones.find((z) => z.id === 'build-corner');
  return {
    edges, poly, area: area(poly),
    entrance: [site.plot.entrance.u, 0.2],
    existing: site.elements,
    corner: corner ? centroid(corner.polygon) : null,
    uncertainty: Math.max(0.3, ...site.elements.filter((e) => e.kind === 'house').map((e) => e.uncertainty)),
  };
}

export const placedPoly = (p: Placed) => rectPoly(p.u, p.v, p.w, p.d);
export const VOLUME_KINDS = new Set(['house', 'sauna', 'shed', 'greenhouse', 'woodpile']);
/** Ground-level areas: a building can take part of them without clearing the rest. */
export const AREA_KINDS = new Set(['beds', 'tilled', 'parking', 'rockgarden']);

/** m2 of each ground-level area that the placed buildings would take. */
export function areaUse(placed: Placed[], existing: SiteElement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of placed) {
    if (p.type === 'garden' || p.type === 'parking') continue;
    const poly = placedPoly(p);
    for (const e of existing) {
      if (!AREA_KINDS.has(e.kind) || !convexOverlap(poly, e.footprint)) continue;
      const a = overlapArea(poly, e.footprint);
      if (a > 0.5) out.set(e.id, (out.get(e.id) ?? 0) + a);
    }
  }
  return out;
}
export const HARD_KINDS = new Set(['house', 'sauna', 'shed', 'greenhouse', 'deck', 'woodpile', 'tank', 'trampoline']);

export function setbackFor(p: Placed, edge: 'road' | 'right' | 'forest' | 'left', rules: Rules): number {
  const spec = CATALOG[p.type];
  if (!isVolume(p.type)) return p.type === 'pool' ? 1 : 0.5;
  if (spec.habitable) return edge === 'road' ? rules.houseFromRoad : rules.houseFromSide;
  return edge === 'road' ? rules.outbuildingFromRoad : rules.outbuildingFromSide;
}

const bboxCache = new WeakMap<Vec2[], [number, number, number, number]>();
export function bbox(poly: Vec2[]): [number, number, number, number] {
  let b = bboxCache.get(poly);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of poly) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }
    bboxCache.set(poly, b);
  }
  return b;
}

/** Existing elements that a placement would have to clear (bbox prefilter, then exact SAT). */
export function conflictsWith(poly: Vec2[], existing: SiteElement[], cleared: Set<string>): SiteElement[] {
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const p of poly) { u0 = Math.min(u0, p[0]); v0 = Math.min(v0, p[1]); u1 = Math.max(u1, p[0]); v1 = Math.max(v1, p[1]); }
  return existing.filter((e) => {
    if (cleared.has(e.id) || e.footprint.length < 3 || e.kind === 'gate') return false;
    const b = bbox(e.footprint);
    if (b[0] >= u1 || b[2] <= u0 || b[1] >= v1 || b[3] <= v0) return false;
    return convexOverlap(poly, e.footprint);
  });
}

// ---------- walking paths on a 0.5 m grid ----------
const CELL = 0.5;

export function buildGrid(site: PlanSite, placed: Placed[], removed: Set<string>) {
  const us = site.poly.map((p) => p[0]), vs = site.poly.map((p) => p[1]);
  const u0 = Math.min(...us) - 1, v0 = Math.min(...vs) - 1;
  const nu = Math.ceil((Math.max(...us) + 1 - u0) / CELL), nv = Math.ceil((Math.max(...vs) + 1 - v0) / CELL);
  const cost = new Float32Array(nu * nv).fill(1);
  const mark = (poly: Vec2[], c: number, pad = 0) => {
    const pu = poly.map((p) => p[0]), pv = poly.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...pu) - pad - u0) / CELL)), i1 = Math.min(nu - 1, Math.ceil((Math.max(...pu) + pad - u0) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(...pv) - pad - v0) / CELL)), j1 = Math.min(nv - 1, Math.ceil((Math.max(...pv) + pad - v0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const p: Vec2 = [u0 + (i + 0.5) * CELL, v0 + (j + 0.5) * CELL];
      const inside = pad > 0 ? polyDist([p, [p[0] + 0.01, p[1]], [p[0], p[1] + 0.01]], poly) <= pad : pointInsideConvex(p, poly);
      if (inside) cost[j * nu + i] = Math.max(cost[j * nu + i], c);
    }
  };
  // outside the plot is not walkable
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const p: Vec2 = [u0 + (i + 0.5) * CELL, v0 + (j + 0.5) * CELL];
    if (!pointInsideConvex(p, site.poly)) cost[j * nu + i] = Infinity;
  }
  for (const e of site.existing) {
    if (removed.has(e.id) || e.footprint.length < 3) continue;
    if (VOLUME_KINDS.has(e.kind) || e.kind === 'tank' || e.kind === 'trampoline') mark(e.footprint, Infinity, 0.25);
    else if (e.kind === 'beds' || e.kind === 'tilled' || e.kind === 'rockgarden') mark(e.footprint, 4);
  }
  for (const p of placed) {
    if (isVolume(p.type) || p.type === 'pool') mark(placedPoly(p), Infinity, 0.25);
    else if (p.type === 'garden') mark(placedPoly(p), 4);
  }
  return { u0, v0, nu, nv, cost };
}

function pointInsideConvex(p: Vec2, poly: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const s = sideDist(p, poly[i], poly[(i + 1) % poly.length]);
    if (Math.abs(s) < 1e-9) continue;
    const sg = Math.sign(s);
    if (sign === 0) sign = sg; else if (sg !== sign) return false;
  }
  return true;
}

export function astar(grid: ReturnType<typeof buildGrid>, from: Vec2, to: Vec2): Vec2[] | null {
  const { u0, v0, nu, nv, cost } = grid;
  const idx = (p: Vec2) => {
    const i = Math.min(nu - 1, Math.max(0, Math.floor((p[0] - u0) / CELL)));
    const j = Math.min(nv - 1, Math.max(0, Math.floor((p[1] - v0) / CELL)));
    return j * nu + i;
  };
  const s = idx(from), t = idx(to);
  const g = new Float32Array(nu * nv).fill(Infinity);
  const came = new Int32Array(nu * nv).fill(-1);
  const open: number[] = [s];
  const f = new Float32Array(nu * nv).fill(Infinity);
  g[s] = 0;
  const h = (k: number) => Math.hypot((k % nu) - (t % nu), Math.floor(k / nu) - Math.floor(t / nu));
  f[s] = h(s);
  const closed = new Uint8Array(nu * nv);
  const free = (k: number) => k === t || k === s || Number.isFinite(cost[k]);
  let guard = 0;
  while (open.length && guard++ < 200000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open[bi];
    open.splice(bi, 1);
    if (cur === t) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % nu, cj = Math.floor(cur / nu);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= nu || nj >= nv) continue;
      const nk = nj * nu + ni;
      if (!free(nk) || closed[nk]) continue;
      if (di && dj && (!free(cj * nu + ni) || !free(nj * nu + ci))) continue;
      const step = (di && dj ? Math.SQRT2 : 1) * (Number.isFinite(cost[nk]) ? cost[nk] : 1);
      const ng = g[cur] + step;
      if (ng < g[nk]) { g[nk] = ng; came[nk] = cur; f[nk] = ng + h(nk); open.push(nk); }
    }
  }
  if (came[t] < 0 && s !== t) return null;
  const pts: Vec2[] = [];
  for (let k = t; k >= 0; k = came[k]) {
    pts.push([u0 + ((k % nu) + 0.5) * CELL, v0 + (Math.floor(k / nu) + 0.5) * CELL]);
    if (k === s) break;
  }
  pts.reverse();
  pts[0] = from;
  pts[pts.length - 1] = to;
  return simplify(pts, 0.35);
}

/** Door point: middle of the side facing the entrance, just outside the wall. */
export function doorOf(p: Placed, entrance: Vec2): Vec2 {
  const poly = placedPoly(p);
  let best: Vec2 = [p.u, p.v - p.d / 2 - 0.6];
  let bd = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = poly[i], b = poly[(i + 1) % 4];
    const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const n: Vec2 = [m[0] - p.u, m[1] - p.v];
    const l = Math.hypot(n[0], n[1]) || 1;
    const out: Vec2 = [m[0] + (n[0] / l) * 0.6, m[1] + (n[1] / l) * 0.6];
    const dd = dist(out, entrance);
    if (dd < bd) { bd = dd; best = out; }
  }
  return best;
}

/** Largest empty axis-aligned rectangle (m^2 and its size) on a 0.5 m occupancy grid. */
export function largestOpen(grid: ReturnType<typeof buildGrid>, site: PlanSite, placed: Placed[], removed: Set<string>) {
  const { nu, nv, u0, v0 } = grid;
  const occ = new Uint8Array(nu * nv);
  const block = (poly: Vec2[]) => {
    const pu = poly.map((p) => p[0]), pv = poly.map((p) => p[1]);
    for (let j = Math.max(0, Math.floor((Math.min(...pv) - v0) / CELL)); j <= Math.min(nv - 1, Math.ceil((Math.max(...pv) - v0) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((Math.min(...pu) - u0) / CELL)); i <= Math.min(nu - 1, Math.ceil((Math.max(...pu) - u0) / CELL)); i++) {
        const p: Vec2 = [u0 + (i + 0.5) * CELL, v0 + (j + 0.5) * CELL];
        if (pointInsideConvex(p, poly)) occ[j * nu + i] = 1;
      }
  };
  for (let k = 0; k < nu * nv; k++) if (!Number.isFinite(grid.cost[k]) || grid.cost[k] > 1) occ[k] = 1;
  for (const e of site.existing) if (!removed.has(e.id) && e.footprint.length >= 3 && e.kind !== 'tree') block(e.footprint);
  for (const p of placed) block(placedPoly(p));
  const hts = new Int32Array(nu);
  let best = 0, bw = 0, bh = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) hts[i] = occ[j * nu + i] ? 0 : hts[i] + 1;
    const stack: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const hgt = i === nu ? 0 : hts[i];
      while (stack.length && hts[stack[stack.length - 1]] >= hgt) {
        const top = stack.pop()!;
        const width = stack.length ? i - stack[stack.length - 1] - 1 : i;
        const a = hts[top] * width;
        if (a > best) { best = a; bw = width; bh = hts[top]; }
      }
      stack.push(i);
    }
  }
  return { area: best * CELL * CELL, w: bw * CELL, d: bh * CELL };
}

export function evaluate(site: PlanSite, program: Program, placed: Placed[], removedIn: string[], rules: Rules) {
  const removed = new Set(removedIn);
  const grid = buildGrid(site, placed, removed);
  const paths: Vec2[][] = [];
  let gateWalk = 0;
  let driveway: number | null = null;
  for (const p of placed) {
    if (!isVolume(p.type) && p.type !== 'parking') continue;
    const door = p.type === 'parking' ? ([p.u, p.v - p.d / 2] as Vec2) : doorOf(p, site.entrance);
    const path = astar(grid, site.entrance, door);
    if (path) {
      paths.push(path);
      const L = pathLength(path);
      if (CATALOG[p.type].vehicle) driveway = Math.max(driveway ?? 0, L);
      else gateWalk += L;
    }
  }
  const checks: Check[] = [];
  const unc = site.uncertainty;
  const check = (c: Omit<Check, 'ok' | 'detail'> & { ok?: boolean; detail?: string }, value: number, limit: number) => {
    const ok = c.ok ?? value >= limit - 1e-6;
    checks.push({ ...c, detail: c.detail ?? '', ok, value: +value.toFixed(2), limit, marginal: ok && value - limit < unc });
  };
  // boundary setbacks
  for (const p of placed) {
    const poly = placedPoly(p);
    for (const e of site.edges) {
      const dmin = Math.min(...poly.map((q) => sideDist(q, e.a, e.b)));
      const lim = setbackFor(p, e.id, rules);
      if (!isVolume(p.type) && p.type !== 'pool') {
        if (dmin < 0) check({ id: `in-${p.itemId}-${e.id}`, label: `${p.label} inside the plot (${e.id} side)`, severity: 'rule' }, dmin, 0);
        continue;
      }
      check({ id: `sb-${p.itemId}-${e.id}`, label: `${p.label}: ${lim} m from ${e.id === 'road' ? 'road' : e.id === 'forest' ? 'forest-side' : e.id + ' side'} boundary`, severity: 'rule' }, dmin, lim);
    }
    if (CATALOG[p.type].habitable && rules.forestBuffer > 0) {
      const fe = site.edges.find((e) => e.id === 'forest')!;
      const dmin = Math.min(...poly.map((q) => sideDist(q, fe.a, fe.b)));
      check({ id: `fb-${p.itemId}`, label: `${p.label}: ${rules.forestBuffer} m fire buffer to forest`, severity: rules.respectForestBuffer ? 'rule' : 'advice' }, dmin, rules.forestBuffer);
    }
  }
  // pairwise clearances among new buildings and against kept existing volumes
  const vols = placed.filter((p) => isVolume(p.type));
  for (let i = 0; i < vols.length; i++) for (let j = i + 1; j < vols.length; j++) {
    const d = polyDist(placedPoly(vols[i]), placedPoly(vols[j]));
    check({ id: `gap-${vols[i].itemId}-${vols[j].itemId}`, label: `${vols[i].label} ↔ ${vols[j].label}: ${rules.betweenBuildings} m apart`, severity: d <= 0 ? 'rule' : 'advice' }, d, rules.betweenBuildings);
  }
  const keptVolumes = site.existing.filter((e) => !removed.has(e.id) && (VOLUME_KINDS.has(e.kind) || e.kind === 'deck'));
  for (const p of placed) {
    const poly = placedPoly(p);
    for (const e of keptVolumes) {
      if (convexOverlap(poly, e.footprint)) checks.push({ id: `ov-${p.itemId}-${e.id}`, label: `${p.label} overlaps existing ${e.label}`, severity: 'rule', ok: false, detail: 'Clear the existing structure or move the building.' });
    }
  }
  // sanitary distance house <-> sauna (new or kept existing)
  const houses: { label: string; poly: Vec2[] }[] = [
    ...placed.filter((p) => p.type === 'house' || p.type === 'guesthouse').map((p) => ({ label: p.label, poly: placedPoly(p) })),
  ];
  const saunas: { label: string; poly: Vec2[] }[] = placed.filter((p) => p.type === 'sauna').map((p) => ({ label: p.label, poly: placedPoly(p) }));
  const exHouses = site.existing.filter((e) => e.kind === 'house' && !removed.has(e.id)).map((e) => ({ label: `existing ${e.label}`, poly: e.footprint }));
  const exSaunas = site.existing.filter((e) => e.kind === 'sauna' && !removed.has(e.id)).map((e) => ({ label: `existing ${e.label}`, poly: e.footprint }));
  const pairs: [typeof houses[0], typeof saunas[0]][] = [];
  for (const h of houses) for (const s of [...saunas, ...exSaunas]) pairs.push([h, s]);
  for (const h of exHouses) for (const s of saunas) pairs.push([h, s]);
  for (const [h, s] of pairs) {
    const d = polyDist(h.poly, s.poly);
    check({ id: `san-${h.label}-${s.label}`, label: `${h.label} ↔ ${s.label}: ${rules.houseToSauna} m (sanitary)`, severity: 'rule' }, d, rules.houseToSauna);
  }
  for (const p of placed) if (CATALOG[p.type].vehicle && p.type !== 'parking') {
    const ok = paths.length > 0 && driveway !== null;
    checks.push({ id: `car-${p.itemId}`, label: `${p.label} reachable by car from the entrance`, severity: 'rule', ok, detail: ok ? `${driveway!.toFixed(0)} m driveway` : 'No clear route from the gate' });
  }
  for (const c of checks) if (!c.detail) c.detail = c.value !== undefined ? `${c.value.toFixed(1)} m (min ${c.limit} m)` : '';

  // metrics
  const plotArea = site.area;
  const newFoot = vols.reduce((s, p) => s + p.w * p.d, 0);
  const exFoot = keptVolumes.reduce((s, e) => s + area(e.footprint), 0);
  const hard = placed.filter((p) => !isVolume(p.type)).reduce((s, p) => s + p.w * p.d, 0);
  const lo = largestOpen(grid, site, placed, removed);
  const house = placed.find((p) => p.type === 'house');
  const edgeDist = (p: Placed, id: string) => {
    const e = site.edges.find((x) => x.id === id)!;
    return Math.min(...placedPoly(p).map((q) => sideDist(q, e.a, e.b)));
  };
  let briefScore = 0;
  for (const p of placed) briefScore += zoneSatisfaction(p, program, site);
  briefScore = placed.length ? Math.round((100 * briefScore) / placed.length) : 0;
  const metrics: Metrics = {
    footprint: Math.round(newFoot),
    coverage: +((100 * (newFoot + exFoot)) / plotArea).toFixed(1),
    openArea: Math.round(plotArea - newFoot - exFoot - hard),
    largestOpen: Math.round(lo.area),
    houseToForest: house ? +edgeDist(house, 'forest').toFixed(1) : null,
    houseToRoad: house ? +edgeDist(house, 'road').toFixed(1) : null,
    gateWalk: Math.round(gateWalk),
    driveway: driveway === null ? null : Math.round(driveway),
    removed: [
      ...site.existing.filter((e) => removed.has(e.id)).map((e) => e.label.split(' (')[0]),
      ...[...areaUse(placed, site.existing)].map(([id, a]) => `${Math.round(a)} m² of ${site.existing.find((e) => e.id === id)!.label.split(' (')[0].toLowerCase()}`),
    ],
    briefScore,
    checksPassed: checks.filter((c) => c.ok).length,
    checksTotal: checks.length,
  };
  return { paths, checks, metrics, largest: lo };
}

/** 0..1: how literally an item satisfies its stated location. */
export function zoneSatisfaction(p: Placed, program: Program, site: PlanSite): number {
  const it = program.items.find((i) => i.id === p.itemId);
  if (!it) return 1;
  const slack = zoneSlack(p, it.zone, site) + (it.zone2 ? 0.5 * zoneSlack(p, it.zone2, site) : 0);
  return Math.exp(-slack / 8);
}

export function zoneSlack(p: Placed, zone: string, site: PlanSite): number {
  const poly = placedPoly(p);
  const edge = (id: string) => {
    const e = site.edges.find((x) => x.id === id)!;
    return Math.min(...poly.map((q) => sideDist(q, e.a, e.b)));
  };
  const c: Vec2 = [p.u, p.v];
  switch (zone) {
    case 'forest': return Math.max(0, edge('forest') - 3);
    case 'road': return Math.max(0, edge('road') - 5);
    case 'entrance': return Math.max(0, dist(c, site.entrance) - Math.max(p.w, p.d));
    case 'left': return Math.max(0, edge('left') - 3);
    case 'right': return Math.max(0, edge('right') - 3);
    case 'center': return dist(c, centroid(site.poly)) * 0.6;
    case 'corner': return site.corner ? Math.max(0, dist(c, site.corner) - 4) : 0;
    default: return 0;
  }
}
