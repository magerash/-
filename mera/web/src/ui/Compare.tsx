import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { useStore } from '../store';
import type { SiteModel, Variant } from '../types';
import { SceneContents } from '../scene/Scene';
import { terrainHeight, toWorld } from '../scene/geometry';
import MiniPlan from './MiniPlan';

// one shared camera for all compare views: whichever view is being dragged drives the others
const shared = { pos: new THREE.Vector3(), target: new THREE.Vector3(), owner: -1, init: false };

function SyncedCamera({ index, site }: { index: number; site: SiteModel }) {
  const ref = useRef<OrbitImpl>(null);
  const { camera } = useThree();
  useEffect(() => {
    if (!shared.init) {
      const u = site.plot.width / 2, v = site.plot.depth / 2;
      const c = toWorld(u, v, terrainHeight(site, u, v));
      shared.target.copy(c);
      shared.pos.set(c.x - 30, c.y + 55, c.z + 55);
      shared.init = true;
    }
    camera.position.copy(shared.pos);
    ref.current?.target.copy(shared.target);
    ref.current?.update();
  }, [camera, site]);
  useFrame(() => {
    const c = ref.current;
    if (!c) return;
    if (shared.owner === index) {
      shared.pos.copy(camera.position);
      shared.target.copy(c.target);
    } else if (!camera.position.equals(shared.pos) || !c.target.equals(shared.target)) {
      camera.position.copy(shared.pos);
      c.target.copy(shared.target);
      c.update();
    }
  });
  return <OrbitControls ref={ref} makeDefault enableDamping={false} maxPolarAngle={Math.PI / 2 - 0.04} onStart={() => { shared.owner = index; }} />;
}

export function CompareView({ site }: { site: SiteModel }) {
  const { variants, compare } = useStore();
  const list = compare.map((id) => variants.find((v) => v.id === id)).filter(Boolean) as Variant[];
  if (list.length < 2) {
    return (
      <div className="center">
        <div className="card">
          <h2>Pick variants to compare</h2>
          <p className="muted">In Plan, press ⊞ on two to four variants. They appear here side by side with one shared camera and a table of the numbers that matter.</p>
        </div>
      </div>
    );
  }
  // three variants leave a free cell: show today's site there as the baseline
  const cells: (Variant | null)[] = list.length === 3 ? [...list, null] : list;
  const cols = 2;
  const rows = cells.length <= 2 ? 1 : 2;
  return (
    <div className="compare-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
      {cells.map((v, i) => (
        <div key={v?.id ?? 'today'} className="compare-cell" onPointerDown={() => { shared.owner = i; }}>
          <div className="tag chip"><b style={{ fontWeight: 600 }}>{v ? v.name : 'Today · the site as it is'}</b></div>
          <Canvas dpr={[1, 1.5]} camera={{ fov: 45, near: 0.15, far: 2500 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
            <Suspense fallback={null}>
              <SceneContents site={site} variant={v} interactive={false} />
              <SyncedCamera index={i} site={site} />
            </Suspense>
          </Canvas>
        </div>
      ))}
    </div>
  );
}

type Row = { label: string; get: (v: Variant) => number | null; unit: string; better: 'low' | 'high' | null; fmt?: (n: number) => string };

const ROWS: Row[] = [
  { label: 'Rules broken', get: (v) => v.checks.filter((c) => !c.ok && c.severity === 'rule').length, unit: '', better: 'low' },
  { label: 'Marginal (within survey error)', get: (v) => v.checks.filter((c) => c.ok && c.marginal && c.severity === 'rule').length, unit: '', better: 'low' },
  { label: 'Matches the brief', get: (v) => v.metrics.briefScore, unit: '%', better: 'high' },
  { label: 'New footprint', get: (v) => v.metrics.footprint, unit: 'm²', better: null },
  { label: 'Plot covered by buildings', get: (v) => v.metrics.coverage, unit: '%', better: null },
  { label: 'Largest open lawn', get: (v) => v.metrics.largestOpen, unit: 'm²', better: 'high' },
  { label: 'Unbuilt area', get: (v) => v.metrics.openArea, unit: 'm²', better: 'high' },
  { label: 'House ↔ forest fence', get: (v) => v.metrics.houseToForest, unit: 'm', better: null },
  { label: 'House ↔ road', get: (v) => v.metrics.houseToRoad, unit: 'm', better: null },
  { label: 'Walking from the gate', get: (v) => v.metrics.gateWalk, unit: 'm', better: 'low' },
  { label: 'Driveway length', get: (v) => v.metrics.driveway, unit: 'm', better: 'low' },
  { label: 'Existing things cleared', get: (v) => v.metrics.removed.length, unit: '', better: 'low' },
];

export function ComparePanel({ site }: { site: SiteModel }) {
  const { variants, compare, set, updateVariant } = useStore();
  const list = compare.map((id) => variants.find((v) => v.id === id)).filter(Boolean) as Variant[];
  return (
    <div>
      <div className="section">
        <h3>Side by side</h3>
        {list.length < 2 ? <p className="small muted">Choose at least two variants with ⊞ in Plan.</p> : (
          <table className="ctable">
            <thead>
              <tr><th />{list.map((v) => <th key={v.id}><MiniPlan site={site} variant={v} size={64} /><div className="small">{v.name.split(' · ')[0]}</div></th>)}</tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const vals = list.map(r.get);
                const nums = vals.filter((x): x is number => x !== null);
                const best = r.better === 'low' ? Math.min(...nums) : r.better === 'high' ? Math.max(...nums) : null;
                return (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    {vals.map((x, i) => (
                      <td key={i} className={x !== null && best !== null && x === best && new Set(nums).size > 1 ? 'best' : r.label === 'Rules broken' && x ? 'bad' : ''}>
                        {x === null ? '—' : `${x}${r.unit ? ' ' + r.unit : ''}`}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <td>Clears</td>
                {list.map((v) => <td key={v.id} style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--ink-2)' }}>{v.metrics.removed.join(', ') || 'nothing'}</td>)}
              </tr>
            </tbody>
          </table>
        )}
      </div>
      {list.length >= 2 && (
        <div className="section">
          <h3>Decide</h3>
          {list.map((v) => (
            <div key={v.id} className="row" style={{ cursor: 'default' }}>
              <div className="grow"><div className="title">{v.name}</div><div className="small muted">{v.summary}</div></div>
              <button className="btn sm" aria-pressed={!!v.starred} onClick={() => updateVariant({ ...v, starred: !v.starred })}>{v.starred ? '★ Shortlisted' : '☆ Shortlist'}</button>
              <button className="btn sm" onClick={() => set({ activeVariant: v.id, exportOpen: true })}>Export</button>
            </div>
          ))}
          <p className="small muted">Shortlisted variants are saved with the project and survive regeneration.</p>
        </div>
      )}
    </div>
  );
}
