import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import type { SiteModel, Variant } from '../types';
import { useStore } from '../store';
import { SiteModelView } from './SiteModel';
import { Accuracy, CameraPath, Cleared, Dimensions, Grid, Labels, Pins, PointCloud, Proposed, SelectionMark, Zones } from './parts';
import { CameraRig, DragLayer, MeasureLayer, dragEnded } from './interaction';

/** The day it was filmed was overcast: soft light from the whole sky, no hard shadows. */
export const SKY = '#e4e8e9';

function Lights() {
  return (
    <>
      <hemisphereLight args={['#f4f6f6', '#8e9483', 1.9]} />
      <directionalLight position={[-40, 90, 30]} intensity={1.1} />
    </>
  );
}

export function SceneContents({ site, variant, interactive = true }: { site: SiteModel; variant: Variant | null; interactive?: boolean }) {
  const layers = useStore((s) => s.layers);
  const mode = useStore((s) => s.mode);
  return (
    <>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 110, 460]} />
      <Lights />
      <SiteModelView site={site} variant={variant} interactive={interactive} />
      {layers.grid && <Grid site={site} />}
      {layers.dimensions && <Dimensions site={site} />}
      {layers.labels && interactive && <Labels site={site} variant={variant} />}
      {layers.accuracy && <Accuracy site={site} variant={variant} />}
      {(layers.narration || mode === 'plan') && interactive && <Zones site={site} />}
      {layers.narration && interactive && mode === 'site' && <Pins site={site} />}
      {layers.points && <PointCloud site={site} />}
      {layers.photos && interactive && <CameraPath site={site} />}
      {interactive && <SelectionMark site={site} />}
      {variant && <Cleared site={site} variant={variant} labels={interactive && layers.labels} />}
      {variant && <Proposed site={site} variant={variant} interactive={interactive && mode === 'plan'} labels={interactive} />}
      {interactive && <MeasureLayer site={site} />}
      {interactive && mode === 'plan' && <DragLayer site={site} />}
    </>
  );
}

export default function Scene({ site, variant }: { site: SiteModel; variant: Variant | null }) {
  const set = useStore((s) => s.set);
  return (
    <Canvas flat dpr={[1, 2]} camera={{ fov: 45, near: 0.15, far: 2500, position: [0, 60, 80] }} gl={{ antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={() => { if (useStore.getState().tool === 'none' && performance.now() - dragEnded.at > 400) set({ selection: null }); }}>
      <Suspense fallback={null}>
        <SceneContents site={site} variant={variant} />
        <CameraRig site={site} />
      </Suspense>
    </Canvas>
  );
}
