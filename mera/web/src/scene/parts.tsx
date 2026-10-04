// Everything drawn on top of the textured model: the detail layers (all off by default), the
// selection mark, and the buildings a variant proposes.
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Placed, Provenance, SiteElement, SiteModel, Tree, Variant, Vec2 } from '../types';
import { useStore } from '../store';
import { api } from '../api';
import { fetchBinary } from '../host';
import { haloGeometry, placedParts, ribbon, terrainHeight, toWorld } from './geometry';
import { labelPortal } from './labelPortal';
import { dragOrigin, groundHit } from './interaction';
import { COLORS, lineMat, mat } from './materials';
import { describeZone } from '../plan/brief';

const fmt = (m: number) => `${m.toFixed(m < 10 ? 2 : 1)} m`;
const EDGE_NAME = { road: 'Road side', forest: 'Forest side', left: 'Left side', right: 'Right side' } as const;
export const PROV_COLOR: Record<Provenance, string> = {
  reconstructed: COLORS.recon, located: '#3f7f8a', inferred: COLORS.inferred, given: COLORS.stated, narration: COLORS.stated,
};

/** Outline of a geometry, dashed for inferred things. */
export function Outline({ geom, color, dashed = false, opacity = 1 }: { geom: THREE.BufferGeometry; color: string; dashed?: boolean; opacity?: number }) {
  const lines = useMemo(() => {
    const eg = new THREE.EdgesGeometry(geom, 25);
    const l = new THREE.LineSegments(eg, lineMat(color, dashed, opacity));
    if (dashed) l.computeLineDistances();
    l.raycast = () => {};
    return l;
  }, [geom, color, dashed, opacity]);
  return <primitive object={lines} />;
}

const centerOf = (poly: Vec2[]): Vec2 => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
const ring = (site: SiteModel, poly: Vec2[], lift: number) => [...poly, poly[0]].map((q) => toWorld(q[0], q[1], terrainHeight(site, q[0], q[1]) + lift));
const circlePoly = (c: Vec2, r: number, n = 28): Vec2[] => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((i / n) * 2 * Math.PI), c[1] + r * Math.sin((i / n) * 2 * Math.PI)] as Vec2);
export const treeName = (t: Tree) => ({ birch: 'Birch', conifer: 'Pine', fruit: 'Apple tree', deciduous: 'Tree' }[t.species]);

// ---------------- detail layers ----------------

export function Grid({ site }: { site: SiteModel }) {
  const geoms = useMemo(() => {
    const us = site.plot.edges.flatMap((e) => [e.a[0], e.b[0]]);
    const vs = site.plot.edges.flatMap((e) => [e.a[1], e.b[1]]);
    const u0 = Math.floor(Math.min(...us)), u1 = Math.ceil(Math.max(...us));
    const v0 = Math.floor(Math.min(...vs)), v1 = Math.ceil(Math.max(...vs));
    const mk = (step: number, skip?: number) => {
      const pts: number[] = [];
      const lift = 0.05;
      for (let u = Math.ceil(u0 / step) * step; u <= u1; u += step) {
        if (skip && Math.abs(u % skip) < 1e-6) continue;
        pts.push(u, terrainHeight(site, u, v0) + lift, -v0, u, terrainHeight(site, u, v1) + lift, -v1);
      }
      for (let v = Math.ceil(v0 / step) * step; v <= v1; v += step) {
        if (skip && Math.abs(v % skip) < 1e-6) continue;
        pts.push(u0, terrainHeight(site, u0, v) + lift, -v, u1, terrainHeight(site, u1, v) + lift, -v);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return g;
    };
    return { minor: mk(1, 5), major: mk(5, 10), ten: mk(10) };
  }, [site]);
  return (
    <group raycast={() => null}>
      <lineSegments geometry={geoms.minor} material={lineMat('#ffffff', false, 0.25)} />
      <lineSegments geometry={geoms.major} material={lineMat('#ffffff', false, 0.55)} />
      <lineSegments geometry={geoms.ten} material={lineMat('#ffffff', false, 0.9)} />
    </group>
  );
}

/** Plot outline with the length of each side and the gate. */
export function Dimensions({ site }: { site: SiteModel }) {
  const selection = useStore((s) => s.selection);
  const { u, width } = site.plot.entrance;
  const gate = toWorld(u, 0, terrainHeight(site, u, 0) + 2.5);
  return (
    <group>
      {site.plot.edges.map((e) => {
        const a = toWorld(e.a[0], e.a[1], terrainHeight(site, e.a[0], e.a[1]) + 0.08);
        const b = toWorld(e.b[0], e.b[1], terrainHeight(site, e.b[0], e.b[1]) + 0.08);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const sel = selection?.kind === 'edge' && selection.id === e.id;
        return (
          <group key={e.id}>
            <Line points={[a, b]} color={sel ? COLORS.accent : '#fbfaf7'} lineWidth={sel ? 4 : 2.5} />
            <Html portal={labelPortal} position={[mid.x, mid.y + 2.4, mid.z]} center zIndexRange={[10, 0]}>
              <div className="lbl dim" style={{ transform: 'none' }}>{EDGE_NAME[e.id]} · {fmt(e.modelLength)}</div>
            </Html>
          </group>
        );
      })}
      <Html portal={labelPortal} position={gate} center zIndexRange={[10, 0]}>
        <div className="lbl" style={{ transform: 'none' }}>Gate · {width.toFixed(1)} m</div>
      </Html>
    </group>
  );
}

/** Names over the structures. */
export function Labels({ site, variant }: { site: SiteModel; variant: Variant | null }) {
  const removed = useMemo(() => new Set(variant?.removed ?? []), [variant]);
  const selection = useStore((s) => s.selection);
  return (
    <group>
      {site.elements.filter((e) => !removed.has(e.id) && e.parent === undefined && !(selection?.kind === 'element' && selection.id === e.id)).map((e) => {
        const c = e.center ?? centerOf(e.footprint);
        const p = toWorld(c[0], c[1], terrainHeight(site, c[0], c[1]) + (e.ridge ?? e.height) + 0.8);
        return (
          <Html key={e.id} portal={labelPortal} position={p} center zIndexRange={[10, 0]}>
            <div className="lbl" style={{ transform: 'none' }}>{e.label}</div>
          </Html>
        );
      })}
    </group>
  );
}

/** How well each thing is placed: a band as wide as its position uncertainty, coloured by how it is known. */
export function Accuracy({ site, variant }: { site: SiteModel; variant: Variant | null }) {
  const removed = useMemo(() => new Set(variant?.removed ?? []), [variant]);
  const halos = useMemo(() => site.elements.filter((e) => e.footprint.length >= 3).map((e) => ({ e, g: haloGeometry(site, e.footprint, e.uncertainty) })), [site]);
  return (
    <group raycast={() => null}>
      {halos.filter(({ e }) => !removed.has(e.id)).map(({ e, g }) => (
        <group key={e.id}>
          <mesh geometry={g} raycast={() => null} renderOrder={2}>
            <meshBasicMaterial color={PROV_COLOR[e.provenance]} transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
          <Line points={ring(site, e.footprint, 0.06)} color={PROV_COLOR[e.provenance]} lineWidth={1.5} dashed={e.provenance === 'inferred'} dashSize={0.4} gapSize={0.25} />
        </group>
      ))}
    </group>
  );
}

/** The author's remark about a "corner for something new", where it was said. */
export function Zones({ site }: { site: SiteModel }) {
  return (
    <group>
      {site.zones.map((z) => {
        const c = centerOf(z.polygon);
        return (
          <group key={z.id}>
            <Line points={ring(site, z.polygon, 0.07)} color={COLORS.stated} lineWidth={2} dashed dashSize={0.6} gapSize={0.35} />
            <Html portal={labelPortal} position={toWorld(c[0], c[1], terrainHeight(site, c[0], c[1]) + 0.5)} center zIndexRange={[10, 0]}>
              <div className="lbl" style={{ transform: 'none', borderColor: COLORS.stated, color: COLORS.stated }}>{z.label}</div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

// ---------------- selection and clearing ----------------

/** A ring on the ground around the selected thing, with its name. */
export function SelectionMark({ site }: { site: SiteModel }) {
  const selection = useStore((s) => s.selection);
  const mark = useMemo(() => {
    if (selection?.kind === 'element') {
      const e = site.elements.find((x) => x.id === selection.id);
      if (!e || e.footprint.length < 3) return null;
      const c = e.center ?? centerOf(e.footprint);
      return { poly: e.footprint, label: e.label, top: toWorld(c[0], c[1], terrainHeight(site, c[0], c[1]) + (e.ridge ?? e.height) + 0.8) };
    }
    if (selection?.kind === 'tree') {
      const t = site.trees?.find((x) => x.id === selection.id);
      if (!t) return null;
      return { poly: circlePoly(t.at, Math.max(0.8, t.crown)), label: `${treeName(t)} · ${t.height.toFixed(0)} m`, top: toWorld(t.at[0], t.at[1], terrainHeight(site, t.at[0], t.at[1]) + t.height + 0.6) };
    }
    return null;
  }, [site, selection]);
  if (!mark) return null;
  return (
    <group>
      <Line points={ring(site, mark.poly, 0.1)} color={COLORS.accent} lineWidth={3} />
      <Html portal={labelPortal} position={mark.top} center zIndexRange={[12, 0]}>
        <div className="lbl new" style={{ transform: 'none' }}>{mark.label}</div>
      </Html>
    </group>
  );
}

/** Dashed outline where a variant clears something away. */
export function Cleared({ site, variant, labels }: { site: SiteModel; variant: Variant; labels: boolean }) {
  const items = useMemo(() => {
    const out: { id: string; poly: Vec2[]; label: string }[] = [];
    for (const id of variant.removed) {
      const e: SiteElement | undefined = site.elements.find((x) => x.id === id);
      if (e && e.footprint.length >= 3) { out.push({ id, poly: e.footprint, label: e.label }); continue; }
      const t = site.trees?.find((x) => x.id === id);
      if (t) out.push({ id, poly: circlePoly(t.at, Math.max(0.6, t.crown * 0.6), 18), label: treeName(t) });
    }
    return out;
  }, [site, variant]);
  return (
    <group>
      {items.map((it) => {
        const c = centerOf(it.poly);
        return (
          <group key={it.id}>
            <Line points={ring(site, it.poly, 0.09)} color={COLORS.warn} lineWidth={2} dashed dashSize={0.4} gapSize={0.25} />
            {labels && (
              <Html portal={labelPortal} position={toWorld(c[0], c[1], terrainHeight(site, c[0], c[1]) + 0.8)} center zIndexRange={[10, 0]}>
                <div className="lbl warn" style={{ transform: 'none' }}>Cleared · {it.label}</div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ---------------- evidence ----------------

export function PointCloud({ site }: { site: SiteModel }) {
  const pid = useStore((s) => s.projectId);
  const [geom, setGeom] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    if (!site.pointcloud) return;
    let alive = true;
    fetchBinary(api.file(pid, site.pointcloud.url)).then((buf) => {
      if (!alive) return;
      const n = Math.floor(buf.byteLength / 15);
      const dv = new DataView(buf);
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const o = i * 15;
        pos[i * 3] = dv.getFloat32(o, true);
        pos[i * 3 + 1] = dv.getFloat32(o + 4, true);
        pos[i * 3 + 2] = dv.getFloat32(o + 8, true);
        col[i * 3] = dv.getUint8(o + 12) / 255;
        col[i * 3 + 1] = dv.getUint8(o + 13) / 255;
        col[i * 3 + 2] = dv.getUint8(o + 14) / 255;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      setGeom(g);
    }).catch(() => {});
    return () => { alive = false; };
  }, [pid, site.pointcloud]);
  if (!geom) return null;
  return (
    <points geometry={geom} raycast={() => null} name="pointcloud">
      <pointsMaterial size={0.1} vertexColors sizeAttenuation toneMapped={false} />
    </points>
  );
}

/** Where the phone was for each frame; click one to see the frame. */
export function CameraPath({ site }: { site: SiteModel }) {
  const set = useStore((s) => s.set);
  const photo = useStore((s) => s.photo);
  const byClip = useMemo(() => {
    const m = new Map<string, THREE.Vector3[]>();
    for (const c of site.cameras) {
      if (!m.has(c.clip)) m.set(c.clip, []);
      m.get(c.clip)!.push(new THREE.Vector3(...c.pos));
    }
    return [...m.entries()];
  }, [site]);
  const glyphs = useMemo(() => site.cameras.filter((_, i) => i % 6 === 0), [site]);
  const palette = ['#2c666b', '#7a5c9e', '#a8741f', '#3a5a96', '#9e4b5c'];
  return (
    <group>
      {byClip.map(([clip, pts], i) => pts.length > 1 && <Line key={clip} points={pts} color={palette[i % palette.length]} lineWidth={1.5} transparent opacity={0.85} />)}
      {glyphs.map((c) => {
        const active = photo?.frameId === c.id;
        return (
          <group key={c.id} position={c.pos} quaternion={new THREE.Quaternion(...c.quat)}>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.18]} name={`camera:${c.id}`}
              onClick={(ev) => { ev.stopPropagation(); set({ photo: { frameId: c.id, aligned: false, opacity: 0.6 }, selection: { kind: 'camera', id: c.id } }); }}
              onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
              <coneGeometry args={[0.18, 0.4, 4, 1, true]} />
              <meshBasicMaterial color={active ? COLORS.warn : '#1d2320'} wireframe toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** The video author's remarks, pinned where they were said. */
export function Pins({ site }: { site: SiteModel }) {
  const set = useStore((s) => s.set);
  const selection = useStore((s) => s.selection);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <group>
      {site.pins.map((p, i) => {
        const sel = selection?.kind === 'pin' && selection.id === String(i);
        const pos = new THREE.Vector3(...p.pos);
        const tip = pos.clone().add(new THREE.Vector3(...p.dir).multiplyScalar(5));
        const open = sel || hover === i;
        return (
          <group key={i}>
            {sel && <Line points={[pos, tip]} color={COLORS.stated} lineWidth={2} dashed dashSize={0.4} gapSize={0.25} />}
            <Html portal={labelPortal} position={[pos.x, pos.y + 0.6, pos.z]} center zIndexRange={[20, 10]}>
              <div className={`pin-dot ${open ? 'open' : ''}`} title={p.label}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onClick={() => set({ selection: { kind: 'pin', id: String(i) } })}>
                <span className="pin-glyph">“</span>{open && <span className="pin-text">{p.label}</span>}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

// ---------------- proposals ----------------

export function Proposed({ site, variant, interactive, labels }: { site: SiteModel; variant: Variant; interactive: boolean; labels: boolean }) {
  const selection = useStore((s) => s.selection);
  return (
    <group>
      {variant.paths.map((pts, i) => (
        <mesh key={'p' + i} geometry={ribbon(site, pts, i === 0 && variant.metrics.driveway !== null && variant.placed.some((p) => p.type === 'garage' || p.type === 'carport') ? 1.4 : 1.2, 0.06)} raycast={() => null}>
          <meshStandardMaterial color="#d9d1c0" roughness={1} />
        </mesh>
      ))}
      {variant.placed.map((p) => (
        <PlacedMesh key={p.itemId} site={site} p={p} variant={variant} interactive={interactive} labels={labels} selected={selection?.kind === 'placed' && selection.id === p.itemId} />
      ))}
    </group>
  );
}

function PlacedMesh({ site, p, variant, interactive, labels, selected }: { site: SiteModel; p: Placed; variant: Variant; interactive: boolean; labels: boolean; selected: boolean }) {
  const parts = useMemo(() => placedParts(site, p), [site, p]);
  const set = useStore((s) => s.set);
  const failing = variant.checks.some((c) => !c.ok && c.severity === 'rule' && c.id.includes(p.itemId));
  const it = variant.program.items.find((i) => i.id === p.itemId);
  const top = toWorld(p.u, p.v, terrainHeight(site, p.u, p.v) + p.ridge + 0.7);
  return (
    <group>
      {parts.map((part) => (
        <group key={part.name}>
          <mesh geometry={part.geom} material={mat(part.mat, selected ? 'highlight' : 'solid')} castShadow receiveShadow name={'placed-' + p.itemId}
            userData={{ pickable: true, placedId: p.itemId }}
            onPointerDown={(ev: ThreeEvent<PointerEvent>) => {
              if (!interactive || useStore.getState().tool !== 'none') return;
              ev.stopPropagation();
              const g = groundHit(site, ev.ray, p.u, p.v);
              dragOrigin.current = g ? { u: g[0], v: g[1], pu: p.u, pv: p.v } : null;
              set({ selection: { kind: 'placed', id: p.itemId }, dragging: p.itemId });
            }}
            onClick={(ev: ThreeEvent<MouseEvent>) => { if (interactive) ev.stopPropagation(); }}
            onPointerOver={(ev) => { if (interactive) { ev.stopPropagation(); document.body.style.cursor = 'grab'; } }}
            onPointerOut={() => { document.body.style.cursor = ''; }} />
          {(selected || failing) && <Outline geom={part.geom} color={failing ? COLORS.warn : COLORS.accent} opacity={0.95} />}
        </group>
      ))}
      {labels && (
        <Html portal={labelPortal} position={top} center zIndexRange={[12, 0]}>
          <div className={`lbl new ${failing ? 'warn' : ''}`} style={{ transform: 'none' }}>
            {p.label.replace(' (banya)', '')} <span className="num">{p.w.toFixed(1)}×{p.d.toFixed(1)} m</span>
            {selected && it && it.zone !== 'any' ? <span className="muted"> · {describeZone(it.zone)}</span> : null}
          </div>
        </Html>
      )}
      {selected && <SetbackDims site={site} p={p} />}
    </group>
  );
}

/** Dimension lines from a selected building to each boundary: the numbers that decide permits. */
function SetbackDims({ site, p }: { site: SiteModel; p: Placed }) {
  const lines = useMemo(() => {
    const out: { a: THREE.Vector3; b: THREE.Vector3; d: number; id: string }[] = [];
    const mids: Record<string, Vec2> = {
      road: [p.u, p.v - p.d / 2], forest: [p.u, p.v + p.d / 2], left: [p.u - p.w / 2, p.v], right: [p.u + p.w / 2, p.v],
    };
    for (const e of site.plot.edges) {
      const m = mids[e.id];
      const ex = e.b[0] - e.a[0], ey = e.b[1] - e.a[1];
      const L2 = ex * ex + ey * ey;
      const t = ((m[0] - e.a[0]) * ex + (m[1] - e.a[1]) * ey) / L2;
      const q: Vec2 = [e.a[0] + ex * t, e.a[1] + ey * t];
      const d = Math.hypot(q[0] - m[0], q[1] - m[1]);
      out.push({ id: e.id, d, a: toWorld(m[0], m[1], terrainHeight(site, m[0], m[1]) + 0.15), b: toWorld(q[0], q[1], terrainHeight(site, q[0], q[1]) + 0.15) });
    }
    return out;
  }, [site, p]);
  return (
    <group>
      {lines.map((l) => (
        <group key={l.id}>
          <Line points={[l.a, l.b]} color={COLORS.ink} lineWidth={1.5} dashed dashSize={0.3} gapSize={0.2} />
          <Html portal={labelPortal} position={l.a.clone().add(l.b).multiplyScalar(0.5)} center zIndexRange={[15, 0]}>
            <div className="lbl dim" style={{ transform: 'none' }}>{l.d.toFixed(1)} m</div>
          </Html>
        </group>
      ))}
    </group>
  );
}
