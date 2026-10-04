import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { SiteModel, Variant } from '../types';
import { useStore, activeVariantOf } from '../store';
import { terrainHeight, toWorld } from './geometry';
import { labelPortal } from './labelPortal';
import { COLORS } from './materials';
import { refresh, removeItem } from '../plan/variants';
import { planSite } from '../plan/metrics';

const EYE = 1.65;

function plotCenter(site: SiteModel) {
  const us = site.plot.edges.map((e) => e.a[0]);
  const vs = site.plot.edges.map((e) => e.a[1]);
  const u = (Math.min(...us) + Math.max(...us)) / 2, v = (Math.min(...vs) + Math.max(...vs)) / 2;
  return toWorld(u, v, terrainHeight(site, u, v));
}

/** Opening view: above the road, a little left of the gate, looking into the plot. */
export function homeView(site: SiteModel, aspect = 1.4) {
  const W = site.plot.width, D = site.plot.depth;
  const tu = W * 0.5, tv = D * 0.47;
  const target = toWorld(tu, tv, terrainHeight(site, tu, tv));
  // far enough that the whole plot fits, further on narrow screens
  const dist = 1.6 * Math.max(W, D) * Math.max(1, 1.35 / aspect);
  // looking from the road, a little left of the gate, 31 degrees down
  const el = (31 * Math.PI) / 180;
  const h = dist * Math.cos(el);
  const du = -0.33, dv = -0.944; // horizontal direction from the plot centre to the camera (u, v)
  const pos = toWorld(tu + h * du, tv + h * dv, target.y + dist * Math.sin(el));
  return { target, pos };
}

/** Orbit / plan / walk navigation plus "look through this photo". */
export function CameraRig({ site }: { site: SiteModel }) {
  const view = useStore((s) => s.view);
  const req = useStore((s) => s.cameraRequest);
  const photo = useStore((s) => s.photo);
  const dragging = useStore((s) => s.dragging);
  const tool = useStore((s) => s.tool);
  const { camera, gl } = useThree();
  const controls = useRef<OrbitImpl>(null);
  const saved = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; fov: number } | null>(null);
  const keys = useRef<Record<string, boolean>>({});
  const walkYaw = useRef(0);
  const walkPitch = useRef(0);
  const center = useMemo(() => plotCenter(site), [site]);
  const persp = camera as THREE.PerspectiveCamera;

  const home = () => {
    // from the road, the way you arrive: the house ahead, the sauna behind it to the right
    const v = homeView(site, persp.aspect);
    persp.fov = 40;
    persp.updateProjectionMatrix();
    camera.position.copy(v.pos);
    controls.current?.target.copy(v.target);
    controls.current?.update();
  };
  const top = () => {
    persp.fov = 35;
    persp.updateProjectionMatrix();
    camera.position.set(center.x, center.y + 105, center.z + 0.01);
    controls.current?.target.copy(center);
    controls.current?.update();
  };

  useEffect(() => { home(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [site]);

  // automation hook (used by the browser journeys): world point -> page pixels with the live camera
  useEffect(() => {
    (window as unknown as { __mera: unknown }).__mera = {
      look: (pos: [number, number, number], target: [number, number, number]) => {
        camera.position.set(...pos);
        controls.current?.target.set(...target);
        controls.current?.update();
      },
      project: (x: number, y: number, z: number) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      },
    };
  }, [camera, gl]);

  useEffect(() => {
    if (view === 'top') top();
    if (view === 'orbit' && camera.position.y > center.y + 90) home();
    if (view === 'walk') {
      // stand at the gate looking into the plot
      const u = site.plot.entrance.u, v = 2.5;
      camera.position.copy(toWorld(u, v, terrainHeight(site, u, v) + EYE));
      walkYaw.current = 0;
      walkPitch.current = -0.05;
      persp.fov = 60;
      persp.updateProjectionMatrix();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const fly = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; k: number } | null>(null);
  useEffect(() => {
    if (!req) return;
    if (req.kind === 'home') home();
    if (req.kind === 'top') top();
    if (req.kind === 'focus' && req.target && controls.current && view !== 'walk') {
      const tTo = new THREE.Vector3(...req.target);
      const dir = camera.position.clone().sub(controls.current.target).normalize();
      const r = Math.max(16, (req.radius ?? 6) * 4 + 10);
      fly.current = { from: camera.position.clone(), to: tTo.clone().add(dir.multiplyScalar(r)), tFrom: controls.current.target.clone(), tTo, k: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);
  useFrame((_, dt) => {
    const f = fly.current;
    if (!f || !controls.current) return;
    f.k = Math.min(1, f.k + dt * 2.2);
    const e = 1 - Math.pow(1 - f.k, 3);
    camera.position.lerpVectors(f.from, f.to, e);
    controls.current.target.lerpVectors(f.tFrom, f.tTo, e);
    controls.current.update();
    if (f.k >= 1) fly.current = null;
  });

  // photo alignment: put the virtual camera exactly where the phone was
  useEffect(() => {
    if (photo?.aligned) {
      const cam = site.cameras.find((c) => c.id === photo.frameId);
      if (!cam) return;
      if (!saved.current) saved.current = { pos: camera.position.clone(), target: controls.current?.target.clone() ?? center.clone(), fov: persp.fov };
      camera.position.set(...cam.pos);
      camera.quaternion.set(...cam.quat);
      persp.fov = cam.fovY;
      persp.updateProjectionMatrix();
    } else if (saved.current) {
      camera.position.copy(saved.current.pos);
      persp.fov = saved.current.fov;
      persp.updateProjectionMatrix();
      controls.current?.target.copy(saved.current.target);
      controls.current?.update();
      saved.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.aligned, photo?.frameId]);

  // walk mode: drag to look, WASD / arrows to move, eye height follows the terrain
  useEffect(() => {
    if (view !== 'walk') return;
    const el = gl.domElement;
    let down = false, lx = 0, ly = 0;
    const kd = (e: KeyboardEvent) => { if ((e.target as HTMLElement).tagName !== 'TEXTAREA' && (e.target as HTMLElement).tagName !== 'INPUT') keys.current[e.code] = true; };
    const ku = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    const pd = (e: PointerEvent) => { down = true; lx = e.clientX; ly = e.clientY; };
    const pu = () => { down = false; };
    const pm = (e: PointerEvent) => {
      if (!down || useStore.getState().tool !== 'none') return;
      walkYaw.current -= (e.clientX - lx) * 0.004;
      walkPitch.current = Math.max(-1.2, Math.min(1.2, walkPitch.current - (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    el.addEventListener('pointerdown', pd);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointermove', pm);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      el.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointermove', pm);
    };
  }, [view, gl]);

  useFrame((_, dt) => {
    if (view !== 'walk' || photo?.aligned) return;
    const k = keys.current;
    const speed = (k.ShiftLeft || k.ShiftRight ? 6 : 2.2) * Math.min(dt, 0.1);
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const side = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const yaw = walkYaw.current;
    camera.position.x += (-Math.sin(yaw) * fwd + Math.cos(yaw) * side) * speed;
    camera.position.z += (-Math.cos(yaw) * fwd - Math.sin(yaw) * side) * speed;
    const u = camera.position.x, v = -camera.position.z;
    camera.position.y = terrainHeight(site, u, v) + EYE;
    camera.quaternion.setFromEuler(new THREE.Euler(walkPitch.current, yaw, 0, 'YXZ'));
  });

  const enabled = view !== 'walk' && !photo?.aligned && !dragging;
  return (
    <OrbitControls ref={controls} makeDefault enabled={enabled} enableRotate={view !== 'top'} enableDamping dampingFactor={0.12}
      maxPolarAngle={Math.PI / 2 - 0.04} minDistance={2} maxDistance={400} screenSpacePanning={view === 'top'}
      mouseButtons={{ LEFT: view === 'top' || tool === 'measure' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }} />
  );
}

// ---------------- measuring ----------------

/** Snap targets: plot corners and building/footprint corners (true scale anchors). */
function snapTargets(site: SiteModel, variant: Variant | null) {
  const out: { p: THREE.Vector3; label: string }[] = [];
  for (const e of site.plot.edges) out.push({ p: toWorld(e.a[0], e.a[1], terrainHeight(site, e.a[0], e.a[1])), label: `${e.id} corner` });
  for (const el of site.elements) {
    if (!['house', 'sauna', 'shed', 'greenhouse', 'deck', 'woodpile'].includes(el.kind) || el.footprint.length !== 4) continue;
    for (const q of el.footprint) out.push({ p: toWorld(q[0], q[1], terrainHeight(site, q[0], q[1])), label: `${el.label} corner` });
  }
  for (const p of variant?.placed ?? []) {
    for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const u = p.u + (du * p.w) / 2, v = p.v + (dv * p.d) / 2;
      out.push({ p: toWorld(u, v, terrainHeight(site, u, v)), label: `${p.label} corner` });
    }
  }
  return out;
}

export function MeasureLayer({ site }: { site: SiteModel }) {
  const tool = useStore((s) => s.tool);
  const measurements = useStore((s) => s.measurements);
  const pending = useStore((s) => s.pendingPoint);
  const variant = useStore(activeVariantOf);
  const hover = useRef<THREE.Mesh>(null);
  const targets = useMemo(() => snapTargets(site, variant), [site, variant]);
  const catchGeom = useMemo(() => catcher(site), [site]);
  const snap = (p: THREE.Vector3): { p: THREE.Vector3; label?: string } => {
    let best: { p: THREE.Vector3; label: string } | null = null, bd = 0.9;
    for (const t of targets) {
      const d = Math.hypot(t.p.x - p.x, t.p.z - p.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best ? { p: best.p.clone(), label: best.label } : { p };
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (tool !== 'measure' || !hover.current) return;
    const s = snap(e.point);
    hover.current.position.copy(s.p);
    hover.current.visible = true;
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (tool !== 'measure') return;
    if (e.delta > 4) return; // it was a drag (pan), not a click
    e.stopPropagation();
    const s = snap(e.point);
    const st = useStore.getState();
    const pt: [number, number, number] = [s.p.x, s.p.y, s.p.z];
    if (!st.pendingPoint) st.set({ pendingPoint: pt, pendingLabel: s.label ?? null });
    else st.addMeasurement({ a: st.pendingPoint, b: pt, snappedA: st.pendingLabel ?? undefined, snappedB: s.label });
  };
  return (
    <group>
      {tool === 'measure' && (
        <group onPointerMove={onMove} onClick={onClick}>
          {/* invisible catcher so clicks anywhere on the plot register, terrain-following */}
          <mesh visible={false} geometry={catchGeom} />
        </group>
      )}
      <mesh ref={hover} visible={false} raycast={() => null}>
        <sphereGeometry args={[0.18, 12, 8]} />
        <meshBasicMaterial color={COLORS.warn} />
      </mesh>
      {pending && (
        <mesh position={pending} raycast={() => null}>
          <sphereGeometry args={[0.2, 12, 8]} />
          <meshBasicMaterial color={COLORS.ink} />
        </mesh>
      )}
      {measurements.map((m) => {
        const a = new THREE.Vector3(...m.a), b = new THREE.Vector3(...m.b);
        const horiz = Math.hypot(b.x - a.x, b.z - a.z);
        const dz = b.y - a.y;
        const mid = a.clone().add(b).multiplyScalar(0.5);
        return (
          <group key={m.id}>
            <Line points={[a.clone().setY(a.y + 0.08), b.clone().setY(b.y + 0.08)]} color={COLORS.ink} lineWidth={2.5} />
            {[a, b].map((p, i) => (
              <mesh key={i} position={p} raycast={() => null}>
                <cylinderGeometry args={[0.05, 0.05, 1.2, 8]} />
                <meshBasicMaterial color={COLORS.ink} />
              </mesh>
            ))}
            <Html portal={labelPortal} position={[mid.x, mid.y + 0.9, mid.z]} center zIndexRange={[30, 20]}>
              <div className="lbl measure" style={{ transform: 'none' }}>
                {horiz.toFixed(2)} m{Math.abs(dz) > 0.08 ? <span className="muted small"> · Δh {dz > 0 ? '+' : ''}{dz.toFixed(2)}</span> : null}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function catcher(site: SiteModel) {
  const g = new THREE.PlaneGeometry(400, 400, 40, 40);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), v = -pos.getZ(i);
    pos.setY(i, terrainHeight(site, u, v) + 0.01);
  }
  g.computeBoundingSphere();
  return g;
}

// ---------------- dragging proposals ----------------

/** Where the pointer met the ground when a drag started (set by the building's pointer-down). */
export const dragOrigin: { current: { u: number; v: number; pu: number; pv: number } | null } = { current: null };
/** Time the last drag ended: the click that ends a drag must not count as "clicked empty space". */
export const dragEnded = { at: 0 };

export function groundHit(site: SiteModel, ray: THREE.Ray, nearU: number, nearV: number): [number, number] | null {
  const y = terrainHeight(site, nearU, nearV);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
  const p = new THREE.Vector3();
  return ray.intersectPlane(plane, p) ? [p.x, -p.z] : null;
}

export function DragLayer({ site }: { site: SiteModel }) {
  const dragging = useStore((s) => s.dragging);
  const variant = useStore(activeVariantOf);
  const start = dragOrigin;
  const ps = useMemo(() => planSite(site), [site]);
  const geom = useMemo(() => catcher(site), [site]);
  useEffect(() => {
    if (!dragging) { start.current = null; return; }
    const up = () => {
      const st = useStore.getState();
      const v = activeVariantOf(st);
      if (v) st.updateVariant(refresh(ps, v, st.rules));
      st.set({ dragging: null });
      dragEnded.at = performance.now();
      document.body.style.cursor = '';
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [dragging, ps]);
  useEffect(() => {
    // R rotates the selected building by 90 degrees, Delete removes it
    const kd = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      const st = useStore.getState();
      const v = activeVariantOf(st);
      if (!v || st.selection?.kind !== 'placed') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        st.updateVariant(removeItem(ps, st.rules, v, st.selection.id));
        st.set({ selection: null });
        return;
      }
      if (e.key !== 'r' && e.key !== 'R') return;
      const placed = v.placed.map((p) => (p.itemId === st.selection!.id && p.type !== 'garage' && p.type !== 'carport' ? { ...p, rot: (p.rot === 0 ? 90 : 0) as 0 | 90, w: p.d, d: p.w } : p));
      st.updateVariant(refresh(ps, { ...v, placed }, st.rules));
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [ps]);
  if (!dragging || !variant) return null;
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const p = variant.placed.find((x) => x.itemId === dragging);
    if (!p) return;
    const g = groundHit(site, e.ray, p.u, p.v);
    if (!g) return;
    const [u, v] = g;
    if (!start.current) start.current = { u, v, pu: p.u, pv: p.v };
    const nu = Math.round((start.current.pu + u - start.current.u) * 4) / 4;
    const nv = Math.round((start.current.pv + v - start.current.v) * 4) / 4;
    if (nu === p.u && nv === p.v) return;
    const placed = variant.placed.map((x) => (x.itemId === dragging ? { ...x, u: nu, v: nv } : x));
    // light update while dragging (checks recomputed on release)
    useStore.getState().updateVariant({ ...variant, placed });
    document.body.style.cursor = 'grabbing';
  };
  return <mesh geometry={geom} visible={false} onPointerMove={onMove} />;
}
