import type { Vec2 } from '../types';

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function rectPoly(u: number, v: number, w: number, d: number): Vec2[] {
  const hw = w / 2, hd = d / 2;
  return [[u - hw, v - hd], [u + hw, v - hd], [u + hw, v + hd], [u - hw, v + hd]];
}

export function area(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function centroid(poly: Vec2[]): Vec2 {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

export function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function axes(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const e = sub(poly[(i + 1) % poly.length], poly[i]);
    const l = len(e) || 1;
    out.push([-e[1] / l, e[0] / l]);
  }
  return out;
}

/** Separating-axis test for convex polygons. */
export function convexOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const ax of [...axes(a), ...axes(b)]) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const p of a) { const s = dot(p, ax); amin = Math.min(amin, s); amax = Math.max(amax, s); }
    for (const p of b) { const s = dot(p, ax); bmin = Math.min(bmin, s); bmax = Math.max(bmax, s); }
    if (amax <= bmin || bmax <= amin) return false;
  }
  return true;
}

export function segPointDist(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}

/** Minimum distance between two convex polygons (0 when they overlap). */
export function polyDist(a: Vec2[], b: Vec2[]): number {
  if (convexOverlap(a, b)) return 0;
  let m = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    m = Math.min(m, segPointDist(a[i], b[j], b[(j + 1) % b.length]), segPointDist(b[j], a[i], a[(i + 1) % a.length]));
  }
  return m;
}

/** Signed distance from p to the line through a->b; positive on the left side. */
export function sideDist(p: Vec2, a: Vec2, b: Vec2): number {
  const e = sub(b, a);
  const l = len(e) || 1;
  return (e[0] * (p[1] - a[1]) - e[1] * (p[0] - a[0])) / l;
}

/** Douglas-Peucker style simplification for grid paths. */
export function simplify(pts: Vec2[], tol = 0.3): Vec2[] {
  if (pts.length < 3) return pts;
  let idx = -1, md = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segPointDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > md) { md = d; idx = i; }
  }
  if (md <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

export function pathLength(p: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
  return s;
}

/** Deterministic PRNG so the same brief always yields the same variants. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
