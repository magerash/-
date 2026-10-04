import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Placed, SiteElement, SiteModel, Variant, Vec2 } from '../types';
import { useStore } from '../store';
import { api } from '../api';
import { elementParts, haloGeometry, placedParts, ribbon, terrainGeometry, terrainHeight, toWorld } from './geometry';
import { labelPortal } from './labelPortal';
import { COLORS, lineMat, mat } from './materials';
import { describeZone } from '../plan/brief';

const fmt = (m: number) => `${m.toFixed(m < 10 ? 2 : 1)} m`;

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

// ---------------- terrain, grid, context ----------------

export function Ground({ site }: { site: SiteModel }) {
  const plot = useMemo(() => terrainGeometry(site, 0, 24), [site]);
  const outer = useMemo(() => {
    const g = terrainGeometry(site, 140, 8);
    g.translate(0, -0.03, 0);
    return g;
  }, [site]);
  return (
    <group>
      <mesh geometry={outer} receiveShadow name="ground-outside" userData={{ pickable: true }}>
        <meshStandardMaterial color="#d9ddd2" roughness={1} />
      </mesh>
      <mesh geometry={plot} receiveShadow name="terrain" userData={{ pickable: true }}>
        <meshStandardMaterial color="#b3c09f" roughness={1} polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={2} />
      </mesh>
    </group>
  );
}

export function Grid({ site }: { site: SiteModel }) {
  const geoms = useMemo(() => {
    const us = site.plot.edges.flatMap((e) => [e.a[0], e.b[0]]);
    const vs = site.plot.edges.flatMap((e) => [e.a[1], e.b[1]]);
    const u0 = Math.floor(Math.min(...us)), u1 = Math.ceil(Math.max(...us));
    const v0 = Math.floor(Math.min(...vs)), v1 = Math.ceil(Math.max(...vs));
    const mk = (step: number, skip?: number) => {
      const pts: number[] = [];
      const lift = 0.025;
      for (let u = Math.ceil(u0 / step) * step; u <= u1; u += step) {
        if (skip && Math.abs(u % skip) < 1e-6) continue;
        for (let v = v0; v < v1; v += 2) {
          const vb = Math.min(v + 2, v1);
          pts.push(u, terrainHeight(site, u, v) + lift, -v, u, terrainHeight(site, u, vb) + lift, -vb);
        }
      }
      for (let v = Math.ceil(v0 / step) * step; v <= v1; v += step) {
        if (skip && Math.abs(v % skip) < 1e-6) continue;
        for (let u = u0; u < u1; u += 2) {
          const ub = Math.min(u + 2, u1);
          pts.push(u, terrainHeight(site, u, v) + lift, -v, ub, terrainHeight(site, ub, v) + lift, -v);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return g;
    };
    return { minor: mk(1, 5), major: mk(5, 10), ten: mk(10) };
  }, [site]);
  return (
    <group raycast={() => null}>
      <lineSegments geometry={geoms.minor} material={lineMat('#ffffff', false, 0.22)} />
      <lineSegments geometry={geoms.major} material={lineMat('#ffffff', false, 0.5)} />
      <lineSegments geometry={geoms.ten} material={lineMat('#ffffff', false, 0.85)} />
    </group>
  );
}

export function Boundary({ site, labels }: { site: SiteModel; labels: boolean }) {
  const select = useStore((s) => s.set);
  const selection = useStore((s) => s.selection);
  return (
    <group>
      {site.plot.edges.map((e) => {
        const a = toWorld(e.a[0], e.a[1], terrainHeight(site, e.a[0], e.a[1]) + 0.04);
        const b = toWorld(e.b[0], e.b[1], terrainHeight(site, e.b[0], e.b[1]) + 0.04);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const sel = selection?.kind === 'edge' && selection.id === e.id;
        const stated = e.statedLength ? `${e.statedLength[0]}${e.statedLength[1] !== e.statedLength[0] ? '–' + e.statedLength[1] : ''} m stated` : 'not stated';
        const L = a.distanceTo(b);
        const ang = Math.atan2(-(b.z - a.z), b.x - a.x);
        return (
          <group key={e.id}>
            <Line points={[a, b]} color={sel ? COLORS.accent : '#3b2c26'} lineWidth={sel ? 4 : 2.5} />
            {/* fence panel: translucent, clickable */}
            <mesh position={[mid.x, mid.y + 0.8, mid.z]} rotation={[0, ang, 0]} name={`fence-${e.id}`} userData={{ pickable: true, snapEdge: e.id }}
              onClick={(ev: ThreeEvent<MouseEvent>) => { if (useStore.getState().tool !== 'none') return; ev.stopPropagation(); select({ selection: { kind: 'edge', id: e.id } }); }}>
              <boxGeometry args={[L, 1.6, 0.04]} />
              <meshStandardMaterial color="#6b4a3d" transparent opacity={sel ? 0.5 : 0.28} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {labels && (
              <Html portal={labelPortal} position={[mid.x, mid.y + 1.9, mid.z]} center zIndexRange={[10, 0]}>
                <div className="lbl dim" style={{ transform: 'none' }}>
                  {e.id === 'road' ? 'Road side' : e.id === 'forest' ? 'Forest side' : e.id === 'left' ? 'Left side' : 'Right side'} · {fmt(e.modelLength)}
                  <span style={{ opacity: 0.65 }}> · {stated}{e.reconstructedLength ? ` · video ${e.reconstructedLength.toFixed(1)}` : ''}</span>
                </div>
              </Html>
            )}
          </group>
        );
      })}
      {site.plot.edges.map((e) => {
        const p = toWorld(e.a[0], e.a[1], terrainHeight(site, e.a[0], e.a[1]));
        return (
          <mesh key={'post' + e.id} position={[p.x, p.y + 0.9, p.z]} userData={{ pickable: true, snapCorner: e.id }}>
            <boxGeometry args={[0.12, 1.8, 0.12]} />
            <meshStandardMaterial color="#3b2c26" />
          </mesh>
        );
      })}
      <Entrance site={site} labels={labels} />
      {site.plot.fences?.map((f, i) => {
        const a = toWorld(f.a[0], f.a[1], terrainHeight(site, f.a[0], f.a[1]) + 0.08);
        const b = toWorld(f.b[0], f.b[1], terrainHeight(site, f.b[0], f.b[1]) + 0.08);
        const strong = f.method === 'fence points';
        return <Line key={'fe' + i} points={[a, b]} color={strong ? COLORS.recon : COLORS.inferred} lineWidth={1.6} dashed dashSize={0.5} gapSize={0.35} />;
      })}
    </group>
  );
}

function Entrance({ site, labels }: { site: SiteModel; labels: boolean }) {
  const { u, width } = site.plot.entrance;
  const a = toWorld(u - width / 2, 0, terrainHeight(site, u - width / 2, 0) + 0.06);
  const b = toWorld(u + width / 2, 0, terrainHeight(site, u + width / 2, 0) + 0.06);
  const c = a.clone().add(b).multiplyScalar(0.5);
  return (
    <group>
      <Line points={[a, b]} color={site.plot.entrance.provenance === 'inferred' ? COLORS.inferred : '#f7f4ec'} lineWidth={6} />
      {labels && (
        <Html portal={labelPortal} position={[c.x, c.y + 2.6, c.z]} center zIndexRange={[10, 0]}>
          <div className="lbl" style={{ transform: 'none' }}>Entrance · gate</div>
        </Html>
      )}
    </group>
  );
}

export function Context({ site, labels = true }: { site: SiteModel; labels?: boolean }) {
  const { forestDepth, forestHeight, roadWidth } = site.context;
  const fe = site.plot.edges.find((e) => e.id === 'forest')!;
  const re = site.plot.edges.find((e) => e.id === 'road')!;
  const forest = useMemo(() => {
    const L = Math.hypot(fe.b[0] - fe.a[0], fe.b[1] - fe.a[1]) + 30;
    const g = new THREE.BoxGeometry(L, forestHeight, forestDepth);
    const ang = Math.atan2(fe.b[1] - fe.a[1], fe.b[0] - fe.a[0]);
    const c: Vec2 = [(fe.a[0] + fe.b[0]) / 2, (fe.a[1] + fe.b[1]) / 2];
    // shift outward (to the right of b->a means outside for CCW order)
    const n: Vec2 = [Math.sin(ang), -Math.cos(ang)];
    const cc: Vec2 = [c[0] + n[0] * (forestDepth / 2 + 2), c[1] + n[1] * (forestDepth / 2 + 2)];
    g.translate(0, forestHeight / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(ang).setPosition(cc[0], terrainHeight(site, cc[0], cc[1]), -cc[1]));
    return { g, top: toWorld(cc[0], cc[1], forestHeight + 2) };
  }, [site, fe, forestDepth, forestHeight]);
  const road = useMemo(() => {
    const L = Math.hypot(re.b[0] - re.a[0], re.b[1] - re.a[1]) + 60;
    const g = new THREE.PlaneGeometry(L, roadWidth);
    g.rotateX(-Math.PI / 2);
    const c: Vec2 = [(re.a[0] + re.b[0]) / 2, (re.a[1] + re.b[1]) / 2 - roadWidth / 2 - 1.5];
    g.translate(c[0], terrainHeight(site, c[0], 0) - 0.01, -c[1]);
    return g;
  }, [site, re, roadWidth]);
  return (
    <group>
      <mesh geometry={forest.g} raycast={() => null}>
        <meshStandardMaterial color="#47603f" transparent opacity={0.1} depthWrite={false} />
      </mesh>
      <Outline geom={forest.g} color="#47603f" dashed opacity={0.6} />
      {labels && (
        <Html portal={labelPortal} position={forest.top} center zIndexRange={[10, 0]}>
          <div className="lbl inferred" style={{ transform: 'none' }}>Forest · stated by owner · ~{forestHeight} m pines seen in video, depth not surveyed</div>
        </Html>
      )}
      <mesh geometry={road} raycast={() => null}>
        <meshStandardMaterial color="#a7a49c" roughness={1} />
      </mesh>
    </group>
  );
}

// ---------------- surveyed elements ----------------

export function Existing({ site, variant, labels, uncertainty }: { site: SiteModel; variant: Variant | null; labels: boolean; uncertainty: boolean }) {
  const selection = useStore((s) => s.selection);
  const set = useStore((s) => s.set);
  const removed = useMemo(() => new Set(variant?.removed ?? []), [variant]);
  return (
    <group>
      {site.elements.map((e) => (
        <ElementMesh key={e.id} site={site} e={e} removed={removed.has(e.id)} selected={selection?.kind === 'element' && selection.id === e.id}
          labels={labels} uncertainty={uncertainty} onSelect={() => set({ selection: { kind: 'element', id: e.id } })} />
      ))}
    </group>
  );
}

const BIG = new Set(['house', 'sauna', 'shed', 'greenhouse', 'deck', 'parking', 'beds', 'tilled', 'woodpile']);
const LABELLED = new Set(['house', 'sauna', 'shed', 'greenhouse', 'woodpile', 'parking']);

function ElementMesh({ site, e, removed, selected, labels, uncertainty, onSelect }: {
  site: SiteModel; e: SiteElement; removed: boolean; selected: boolean; labels: boolean; uncertainty: boolean; onSelect: () => void;
}) {
  const parts = useMemo(() => elementParts(site, e), [site, e]);
  const halo = useMemo(() => (e.uncertainty >= 0.3 && e.footprint.length >= 3 ? haloGeometry(site, e.footprint, e.uncertainty) : null), [site, e]);
  const inferred = e.provenance === 'inferred';
  const variant = removed ? 'ghost' : selected ? 'highlight' : inferred ? 'inferred' : 'solid';
  const top = useMemo(() => {
    const c = e.footprint.reduce((s, p) => [s[0] + p[0] / e.footprint.length, s[1] + p[1] / e.footprint.length], [0, 0]);
    return toWorld(c[0], c[1], terrainHeight(site, c[0], c[1]) + (e.ridge ?? e.height) + 0.6);
  }, [site, e]);
  const edgeColor = removed ? COLORS.warn : selected ? COLORS.accent : inferred ? COLORS.inferred : COLORS.edge;
  return (
    <group>
      {parts.map((p) => (
        <group key={p.name}>
          <mesh geometry={p.geom} material={mat(p.mat, variant)} castShadow={!removed && e.kind !== 'tree'} receiveShadow name={e.id}
            userData={{ pickable: true, elementId: e.id }}
            onClick={(ev: ThreeEvent<MouseEvent>) => { if (useStore.getState().tool !== 'none' || useStore.getState().dragging) return; ev.stopPropagation(); onSelect(); }}
            onPointerOver={(ev) => { ev.stopPropagation(); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { document.body.style.cursor = ''; }} />
          {(BIG.has(e.kind) || selected || removed) && <Outline geom={p.geom} color={edgeColor} dashed={inferred || removed} opacity={removed ? 0.9 : 0.75} />}
        </group>
      ))}
      {uncertainty && halo && !removed && (
        <mesh geometry={halo} raycast={() => null}>
          <meshBasicMaterial color={inferred ? COLORS.inferred : COLORS.recon} transparent opacity={0.16} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {((labels && LABELLED.has(e.kind)) || selected || removed) && (
        <Html portal={labelPortal} position={top} center zIndexRange={[10, 0]}>
          <div className={`lbl ${removed ? 'warn' : inferred ? 'inferred' : ''}`} style={{ transform: 'none' }}>
            {removed ? 'Cleared · ' : ''}{selected ? e.label : e.label.split(' (')[0]}{e.uncertainty >= 0.3 && !removed ? <span className="muted"> ±{e.uncertainty.toFixed(1)} m</span> : null}
          </div>
        </Html>
      )}
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
    fetch(api.file(pid, site.pointcloud.url)).then((r) => r.arrayBuffer()).then((buf) => {
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
      <pointsMaterial size={0.09} vertexColors sizeAttenuation transparent opacity={0.9} depthWrite={false} />
    </points>
  );
}

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
      {byClip.map(([clip, pts], i) => pts.length > 1 && <Line key={clip} points={pts} color={palette[i % palette.length]} lineWidth={1.5} transparent opacity={0.8} />)}
      {glyphs.map((c) => {
        const q = new THREE.Quaternion(...c.quat);
        const active = photo?.frameId === c.id;
        return (
          <group key={c.id} position={c.pos} quaternion={q}>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.18]}
              onClick={(ev) => { ev.stopPropagation(); set({ photo: { frameId: c.id, aligned: false, opacity: 0.6 }, selection: { kind: 'camera', id: c.id } }); }}
              onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
              <coneGeometry args={[0.16, 0.36, 4, 1, true]} />
              <meshBasicMaterial color={active ? COLORS.warn : '#2a2f2c'} wireframe />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

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
              <div className={`pin-dot ${open ? 'open' : ''}`} title={p.quote}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onClick={() => set({ selection: { kind: 'pin', id: String(i) }, photo: { frameId: p.frame, aligned: false, opacity: 0.6 } })}>
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
        <mesh key={'p' + i} geometry={ribbon(site, pts, i === 0 && variant.metrics.driveway !== null && variant.placed.some((p) => p.type === 'garage' || p.type === 'carport') ? 1.4 : 1.2, 0.035)} raycast={() => null} receiveShadow>
          <meshStandardMaterial color="#e3dccd" roughness={1} />
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
              set({ selection: { kind: 'placed', id: p.itemId }, dragging: p.itemId });
            }}
            onPointerOver={(ev) => { if (interactive) { ev.stopPropagation(); document.body.style.cursor = 'grab'; } }}
            onPointerOut={() => { document.body.style.cursor = ''; }} />
          <Outline geom={part.geom} color={failing ? COLORS.warn : COLORS.accent} opacity={0.95} />
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
