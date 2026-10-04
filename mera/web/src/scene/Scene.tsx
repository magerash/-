import { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import type { SiteModel, Variant } from '../types';
import { useStore } from '../store';
import { terrainHeight, toWorld } from './geometry';
import { Boundary, CameraPath, Context, Existing, Grid, Ground, PointCloud, Pins, Proposed } from './parts';
import { CameraRig, DragLayer, MeasureLayer, Zones } from './interaction';

/** Solar elevation/azimuth (azimuth from north, clockwise) for a latitude, month and local solar hour. */
export function sunPosition(lat: number, month: number, hour: number) {
  const N = Math.round(30.4 * (month - 1) + 15);
  const d = (23.44 * Math.PI / 180) * Math.sin((2 * Math.PI * (284 + N)) / 365);
  const phi = (lat * Math.PI) / 180;
  const H = ((hour - 12) * 15 * Math.PI) / 180;
  const el = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi));
  return { el, az: azS + Math.PI };
}

function Lights({ site }: { site: SiteModel }) {
  const sun = useStore((s) => s.sun);
  const center = useMemo(() => {
    const u = site.plot.width / 2, v = site.plot.depth / 2;
    return toWorld(u, v, terrainHeight(site, u, v));
  }, [site]);
  const sunOn = sun.on && sun.northDeg !== null;
  const dir = useMemo(() => {
    if (!sunOn) return new THREE.Vector3(-0.45, 0.85, 0.35).normalize();
    const { el, az } = sunPosition(sun.lat, sun.month, sun.hour);
    const bearing = (sun.northDeg! * Math.PI) / 180 + az; // site bearing: 0 = toward forest (+v), clockwise
    const h = Math.cos(el);
    return new THREE.Vector3(Math.sin(bearing) * h, Math.sin(el), -Math.cos(bearing) * h).normalize();
  }, [sunOn, sun.lat, sun.month, sun.hour, sun.northDeg]);
  const below = sunOn && dir.y <= 0.01;
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.copy(center);
    return o;
  }, [center]);
  return (
    <>
      <hemisphereLight args={['#eef2f1', '#8d927f', below ? 0.5 : sunOn ? 0.75 : 1.25]} />
      <ambientLight intensity={0.18} />
      <primitive object={target} />
      {!below && (
        <directionalLight position={center.clone().add(dir.clone().multiplyScalar(160))} target={target} intensity={sunOn ? 2.1 : 0.9}
          castShadow={sunOn} shadow-mapSize={[2048, 2048]} shadow-camera-left={-70} shadow-camera-right={70} shadow-camera-top={70}
          shadow-camera-bottom={-70} shadow-camera-near={10} shadow-camera-far={400} shadow-bias={-0.0004} />
      )}
    </>
  );
}

export function SceneContents({ site, variant, interactive = true }: { site: SiteModel; variant: Variant | null; interactive?: boolean }) {
  const layers = useStore((s) => s.layers);
  const mode = useStore((s) => s.mode);
  return (
    <>
      <fog attach="fog" args={['#e8ebe8', 160, 520]} />
      <Lights site={site} />
      <Ground site={site} />
      {layers.grid && <Grid site={site} />}
      <Boundary site={site} labels={layers.labels && interactive} />
      {layers.context && <Context site={site} labels={layers.labels && interactive} />}
      {layers.existing && <Existing site={site} variant={variant} labels={layers.labels && interactive} uncertainty={layers.uncertainty} />}
      {mode === 'site' && <Zones site={site} />}
      {layers.points && <PointCloud site={site} />}
      {layers.cameras && interactive && <CameraPath site={site} />}
      {layers.pins && interactive && mode === 'site' && <Pins site={site} />}
      {variant && <Proposed site={site} variant={variant} interactive={interactive && mode === 'plan'} labels={layers.labels && interactive} />}
      {interactive && <MeasureLayer site={site} />}
      {interactive && mode === 'plan' && <DragLayer site={site} />}
    </>
  );
}

export default function Scene({ site, variant }: { site: SiteModel; variant: Variant | null }) {
  const set = useStore((s) => s.set);
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 45, near: 0.15, far: 2500, position: [0, 60, 80] }} gl={{ antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={() => { if (useStore.getState().tool === 'none') set({ selection: null }); }}>
      <Suspense fallback={null}>
        <SceneContents site={site} variant={variant} />
        <CameraRig site={site} />
      </Suspense>
    </Canvas>
  );
}
