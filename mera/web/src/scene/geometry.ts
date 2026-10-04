// Parametric geometry shared by the viewer and the exporters, so what you download is exactly
// what you looked at. World frame: x = u (m), y = up (m), z = -v (m).
import * as THREE from 'three';
import type { Placed, SiteElement, SiteModel, Vec2 } from '../types';

export const toWorld = (u: number, v: number, y = 0) => new THREE.Vector3(u, y, -v);

export function terrainHeight(site: SiteModel | null, u: number, v: number): number {
  if (!site) return 0;
  const t = site.terrain;
  return t.h0 + t.gu * u + t.gv * v;
}

/** Base height for a footprint: lowest terrain point under it, so nothing floats. */
export function baseHeight(site: SiteModel | null, poly: Vec2[]): number {
  return Math.min(...poly.map((p) => terrainHeight(site, p[0], p[1])));
}

function prismFromPoly(poly: Vec2[], y0: number, h: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  // shape lives in (u, v); extrusion along +z -> rotate so extrusion is +y and v maps to -z
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** Oriented rectangle from a 4-point footprint: center, long-axis angle, sizes. */
export function rectFrame(poly: Vec2[]) {
  const c: Vec2 = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  const e0: Vec2 = [poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]];
  const e1: Vec2 = [poly[2][0] - poly[1][0], poly[2][1] - poly[1][1]];
  const l0 = Math.hypot(...e0), l1 = Math.hypot(...e1);
  return { c, ang: Math.atan2(e0[1], e0[0]), a: l0, b: l1 };
}

/**
 * Walls + roof for a rectangular building. `a` runs along the local x axis (angle `ang` in the
 * u-v plane), `b` along local z. Ridge runs along the longer side unless told otherwise.
 */
export function buildingGeometry(opts: {
  c: Vec2; ang: number; a: number; b: number; y0: number; eave: number; ridge: number;
  roof: 'gable' | 'shed' | 'flat' | 'arch' | 'none' | undefined; ridgeAlongA?: boolean; overhang?: number;
}): { walls: THREE.BufferGeometry; roof: THREE.BufferGeometry | null } {
  const { c, ang, a, b, y0, eave, ridge } = opts;
  const roof = opts.roof ?? 'flat';
  const oh = opts.overhang ?? (roof === 'gable' || roof === 'shed' ? 0.35 : 0);
  const along = opts.ridgeAlongA ?? a >= b;
  const m = new THREE.Matrix4().makeRotationY(ang).setPosition(c[0], y0, -c[1]);
  if (roof === 'arch') {
    // half-cylinder greenhouse along the long side
    const r = Math.min(a, b) / 2;
    const L = Math.max(a, b);
    const g = new THREE.CylinderGeometry(r, r, L, 18, 1, false, 0, Math.PI);
    g.rotateZ(Math.PI / 2); // axis along local x, curved side up
    const s = ridge / r;
    g.scale(1, s, 1);
    if (!(a >= b)) g.rotateY(Math.PI / 2);
    g.applyMatrix4(m);
    return { walls: g, roof: null };
  }
  const walls = new THREE.BoxGeometry(a, eave, b);
  walls.translate(0, eave / 2, 0);
  walls.applyMatrix4(m);
  if (roof === 'none' || roof === 'flat' || ridge <= eave + 0.05) {
    if (roof === 'flat') {
      const r = new THREE.BoxGeometry(a + 0.2, 0.25, b + 0.2);
      r.translate(0, eave + 0.125, 0);
      r.applyMatrix4(m);
      return { walls, roof: r };
    }
    return { walls, roof: null };
  }
  // gable / shed roof as an extruded triangle (or right triangle) profile
  const span = along ? b : a; // across the ridge
  const L = (along ? a : b) + 2 * oh;
  const rise = ridge - eave;
  const hs = span / 2 + oh;
  const slope = rise / (span / 2);
  const profile = new THREE.Shape();
  const t = 0.18; // roof thickness
  if (roof === 'gable') {
    profile.moveTo(-hs, -oh * slope);
    profile.lineTo(0, rise);
    profile.lineTo(hs, -oh * slope);
    profile.lineTo(hs, -oh * slope + t);
    profile.lineTo(0, rise + t);
    profile.lineTo(-hs, -oh * slope + t);
    profile.closePath();
  } else {
    const s2 = rise / span;
    profile.moveTo(-hs, -oh * s2);
    profile.lineTo(hs, rise + oh * s2);
    profile.lineTo(hs, rise + oh * s2 + t);
    profile.lineTo(-hs, -oh * s2 + t);
    profile.closePath();
  }
  const rg = new THREE.ExtrudeGeometry(profile, { depth: L, bevelEnabled: false });
  rg.translate(0, eave, -L / 2);
  if (along) rg.rotateY(Math.PI / 2);
  rg.applyMatrix4(m);
  // gable end walls (triangles) so the massing is closed
  if (roof === 'gable') {
    const tri = new THREE.Shape();
    tri.moveTo(-span / 2, 0);
    tri.lineTo(0, rise);
    tri.lineTo(span / 2, 0);
    tri.closePath();
    const gl = new THREE.ShapeGeometry(tri);
    const g1 = gl.clone().translate(0, eave, (along ? a : b) / 2);
    const g2 = gl.clone().rotateY(Math.PI).translate(0, eave, -(along ? a : b) / 2);
    const both = mergeSimple([g1, g2]);
    if (along) both.rotateY(Math.PI / 2);
    both.applyMatrix4(m);
    return { walls: mergeSimple([walls, both]), roof: rg };
  }
  return { walls, roof: rg };
}

/** Minimal non-indexed merge (avoids pulling BufferGeometryUtils into every chunk). */
export function mergeSimple(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (const g0 of geoms) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    pos.push(...Array.from(g.getAttribute('position').array as ArrayLike<number>));
    nor.push(...Array.from(g.getAttribute('normal').array as ArrayLike<number>));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

export function slab(poly: Vec2[], y0: number, h: number) {
  return prismFromPoly(poly, y0, h);
}

/** Flat ribbon along a polyline (paths, driveways), draped on the terrain plane. */
export function ribbon(site: SiteModel | null, pts: Vec2[], width: number, lift = 0.03): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const hw = width / 2;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const n: Vec2 = [-dy * hw, dx * hw];
    for (const s of [1, -1]) {
      const u = p[0] + n[0] * s, v = p[1] + n[1] * s;
      pos.push(u, terrainHeight(site, u, v) + lift, -v);
    }
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ring band around a footprint, used to draw positional uncertainty. */
export function haloGeometry(site: SiteModel | null, poly: Vec2[], r: number): THREE.BufferGeometry {
  const c: Vec2 = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  const outer = poly.map((p) => {
    const dx = p[0] - c[0], dy = p[1] - c[1];
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / l) * r * 1.41, p[1] + (dy / l) * r * 1.41] as Vec2;
  });
  const pos: number[] = [];
  const idx: number[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (const q of [poly[i], outer[i]]) pos.push(q[0], terrainHeight(site, q[0], q[1]) + 0.02, -q[1]);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface Part {
  name: string;
  geom: THREE.BufferGeometry;
  mat: MatKey;
}

export type MatKey =
  | 'wall-existing' | 'roof-existing' | 'wall-inferred' | 'roof-inferred' | 'deck' | 'beds' | 'tilled' | 'gravel'
  | 'glass' | 'tank' | 'trunk' | 'crown' | 'fence' | 'terrain' | 'wall-new' | 'roof-new' | 'path' | 'water' | 'garden-new'
  | 'paving' | 'rock' | 'forest';

export const MAT_COLORS: Record<MatKey, string> = {
  'wall-existing': '#b8a487', 'roof-existing': '#6f665e', 'wall-inferred': '#c9bfb0', 'roof-inferred': '#8b847c',
  deck: '#9a7b5b', beds: '#7b6248', tilled: '#5a4a3c', gravel: '#b4afa5', glass: '#dfe9ea', tank: '#e6e6e0',
  trunk: '#6d5a48', crown: '#6f8a5c', fence: '#6b4a3d', terrain: '#a9b894', 'wall-new': '#f2eee6', 'roof-new': '#5f7377',
  path: '#d8d0c0', water: '#6fa3b8', 'garden-new': '#8d7154', paving: '#cfc8bb', rock: '#9c9a92', forest: '#3f5a3c',
};

/** Geometry parts for one surveyed element. */
export function elementParts(site: SiteModel | null, e: SiteElement): Part[] {
  const inferred = e.provenance === 'inferred';
  const y0 = baseHeight(site, e.footprint);
  const name = `${e.label.replace(/[^\w]+/g, '_')}_${e.provenance}`;
  switch (e.kind) {
    case 'house': case 'sauna': case 'shed': case 'woodpile': case 'other': {
      if (e.footprint.length !== 4) return [{ name, geom: prismFromPoly(e.footprint, y0, e.height), mat: inferred ? 'wall-inferred' : 'wall-existing' }];
      const f = rectFrame(e.footprint);
      const { walls, roof } = buildingGeometry({ c: f.c, ang: f.ang, a: f.a, b: f.b, y0, eave: e.height, ridge: e.ridge ?? e.height, roof: e.roof, ridgeAlongA: e.ridgeAxis ? (e.ridgeAxis === 'u') === (Math.abs(Math.cos(f.ang)) > 0.7) : undefined });
      const parts: Part[] = [{ name: name + '_walls', geom: walls, mat: e.kind === 'woodpile' ? 'deck' : inferred ? 'wall-inferred' : 'wall-existing' }];
      if (roof) parts.push({ name: name + '_roof', geom: roof, mat: inferred ? 'roof-inferred' : 'roof-existing' });
      return parts;
    }
    case 'greenhouse': {
      const f = rectFrame(e.footprint);
      const { walls } = buildingGeometry({ c: f.c, ang: f.ang, a: f.a, b: f.b, y0, eave: e.height, ridge: e.ridge ?? 2.1, roof: 'arch' });
      return [{ name, geom: walls, mat: 'glass' }];
    }
    case 'deck': return [{ name, geom: prismFromPoly(e.footprint, y0, e.height || 0.35), mat: 'deck' }];
    case 'beds': return [{ name, geom: prismFromPoly(e.footprint, y0, e.height || 0.25), mat: 'beds' }];
    case 'tilled': return [{ name, geom: prismFromPoly(e.footprint, y0, 0.04), mat: 'tilled' }];
    case 'parking': return [{ name, geom: prismFromPoly(e.footprint, y0, 0.03), mat: 'gravel' }];
    case 'rockgarden': return [{ name, geom: prismFromPoly(e.footprint, y0, e.height || 0.5), mat: 'rock' }];
    case 'tank': return [{ name, geom: prismFromPoly(e.footprint, y0, e.height || 1.15), mat: 'tank' }];
    case 'trampoline': {
      const f = rectFrame(e.footprint);
      const r = Math.max(f.a, f.b) / 2;
      const g = new THREE.CylinderGeometry(r, r, 0.08, 40);
      g.translate(f.c[0], y0 + (e.height || 0.9), -f.c[1]);
      return [{ name, geom: g, mat: 'tank' }];
    }
    case 'tree': {
      const f = rectFrame(e.footprint);
      const r = Math.max(f.a, f.b) / 2;
      const h = e.height || 6;
      const trunk = new THREE.CylinderGeometry(0.12, 0.16, h * 0.45, 8);
      trunk.translate(f.c[0], y0 + h * 0.225, -f.c[1]);
      const crown = new THREE.IcosahedronGeometry(1, 1);
      crown.scale(r, h * 0.36, r);
      crown.translate(f.c[0], y0 + h * 0.62, -f.c[1]);
      return [{ name: name + '_trunk', geom: trunk, mat: 'trunk' }, { name: name + '_crown', geom: crown, mat: 'crown' }];
    }
    default: return [];
  }
}

/** Geometry parts for a proposed building. */
export function placedParts(site: SiteModel | null, p: Placed): Part[] {
  const poly: Vec2[] = [[p.u - p.w / 2, p.v - p.d / 2], [p.u + p.w / 2, p.v - p.d / 2], [p.u + p.w / 2, p.v + p.d / 2], [p.u - p.w / 2, p.v + p.d / 2]];
  const y0 = baseHeight(site, poly);
  const name = `New_${p.label.replace(/[^\w]+/g, '_')}_${p.w.toFixed(1)}x${p.d.toFixed(1)}m`;
  switch (p.type) {
    case 'pool': {
      const coping = new THREE.Shape([new THREE.Vector2(-p.w / 2 - 0.4, -p.d / 2 - 0.4), new THREE.Vector2(p.w / 2 + 0.4, -p.d / 2 - 0.4), new THREE.Vector2(p.w / 2 + 0.4, p.d / 2 + 0.4), new THREE.Vector2(-p.w / 2 - 0.4, p.d / 2 + 0.4)]);
      coping.holes.push(new THREE.Path([new THREE.Vector2(-p.w / 2, -p.d / 2), new THREE.Vector2(-p.w / 2, p.d / 2), new THREE.Vector2(p.w / 2, p.d / 2), new THREE.Vector2(p.w / 2, -p.d / 2)]));
      const cg = new THREE.ExtrudeGeometry(coping, { depth: 0.12, bevelEnabled: false });
      cg.rotateX(-Math.PI / 2);
      cg.translate(p.u, y0, -p.v);
      const water = new THREE.PlaneGeometry(p.w, p.d);
      water.rotateX(-Math.PI / 2);
      water.translate(p.u, y0 + 0.02, -p.v);
      return [{ name: name + '_coping', geom: cg, mat: 'paving' }, { name: name + '_water', geom: water, mat: 'water' }];
    }
    case 'garden': return [{ name, geom: prismFromPoly(poly, y0, 0.22), mat: 'garden-new' }];
    case 'parking': return [{ name, geom: prismFromPoly(poly, y0, 0.04), mat: 'gravel' }];
    case 'playground': return [{ name, geom: prismFromPoly(poly, y0, 0.05), mat: 'paving' }];
    case 'terrace': return [{ name, geom: prismFromPoly(poly, y0, p.height), mat: 'deck' }];
    case 'greenhouse': {
      const { walls } = buildingGeometry({ c: [p.u, p.v], ang: 0, a: p.w, b: p.d, y0, eave: p.height, ridge: p.ridge, roof: 'arch' });
      return [{ name, geom: walls, mat: 'glass' }];
    }
    default: {
      const { walls, roof } = buildingGeometry({ c: [p.u, p.v], ang: 0, a: p.w, b: p.d, y0, eave: p.height, ridge: p.ridge, roof: p.roof });
      const parts: Part[] = [{ name: name + '_walls', geom: walls, mat: 'wall-new' }];
      if (roof) parts.push({ name: name + '_roof', geom: roof, mat: 'roof-new' });
      return parts;
    }
  }
}

/** Fence panels along the boundary edges. */
export function fenceParts(site: SiteModel): Part[] {
  return site.plot.edges.map((e) => {
    const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    const ang = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]);
    const g = new THREE.BoxGeometry(L, 1.6, 0.05);
    const c: Vec2 = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    g.translate(0, 0.8, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(ang).setPosition(c[0], terrainHeight(site, c[0], c[1]), -c[1]));
    return { name: `Boundary_${e.id}_${e.modelLength.toFixed(2)}m`, geom: g, mat: 'fence' as MatKey };
  });
}

/** Terrain plate over the plot (plane fitted by the reconstruction), slightly larger than the plot. */
export function terrainGeometry(site: SiteModel, margin = 0, seg = 24): THREE.BufferGeometry {
  const us = site.plot.edges.flatMap((e) => [e.a[0], e.b[0]]);
  const vs = site.plot.edges.flatMap((e) => [e.a[1], e.b[1]]);
  const u0 = Math.min(...us) - margin, u1 = Math.max(...us) + margin;
  const v0 = Math.min(...vs) - margin, v1 = Math.max(...vs) + margin;
  const g = new THREE.PlaneGeometry(u1 - u0, v1 - v0, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + (u0 + u1) / 2;
    const v = -pos.getZ(i) + (v0 + v1) / 2;
    pos.setXYZ(i, u, terrainHeight(site, u, v), -v);
  }
  g.computeVertexNormals();
  return g;
}
