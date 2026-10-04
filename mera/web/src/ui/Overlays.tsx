import { useEffect, useMemo, useState } from 'react';
import { useStore, type Layers, type ViewMode } from '../store';
import { api } from '../api';
import type { SiteModel } from '../types';
import { Icon, ICONS, fmtT } from './common';

/** Detail layers, in the order they are offered. All start off. */
export const LAYERS: [keyof Layers, string, string][] = [
  ['labels', 'Names', 'What each structure is'],
  ['dimensions', 'Plot dimensions', 'Boundary lengths and the gate'],
  ['grid', 'Grid', '1, 5 and 10 m squares on the ground'],
  ['photos', 'Video frames', 'Where each frame was shot; open a frame'],
  ['narration', 'Narration', "The video author's remarks where they were said"],
  ['accuracy', 'Accuracy', 'How exactly each thing is placed'],
  ['points', '3D points', 'Raw points reconstructed from the video'],
  ['survey', 'Survey notes', 'How each thing was located, in the side panel'],
];

export function Toolbar() {
  const { view, tool, set, layers, toggleLayer, measurements, photo } = useStore();
  const [open, setOpen] = useState(false);
  const on = LAYERS.filter(([k]) => layers[k]).length;
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === 'm' || e.key === 'M') set({ tool: useStore.getState().tool === 'measure' ? 'none' : 'measure', pendingPoint: null });
      if (e.key === 'l' || e.key === 'L') setOpen((o) => !o);
      if (e.key === 'Escape') { set({ tool: 'none', pendingPoint: null, photo: null, selection: null }); setOpen(false); }
      if (e.key === '1') set({ view: 'orbit' });
      if (e.key === '2') set({ view: 'top' });
      if (e.key === '3') set({ view: 'walk' });
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [set]);
  const V = (v: ViewMode, label: string, icon: string, k: string) => (
    <button aria-pressed={view === v && !photo?.aligned} onClick={() => set({ view: v, photo: photo ? { ...photo, aligned: false } : null })} title={`${label} (${k})`}>
      <Icon d={icon} /><span className="label">{label}</span>
    </button>
  );
  return (
    <>
      <div className="toolbar" role="toolbar" aria-label="View tools">
        {V('orbit', '3D', ICONS.orbit, '1')}
        {V('top', 'Top', ICONS.top, '2')}
        {V('walk', 'Walk', ICONS.walk, '3')}
        <span className="sep" />
        <button aria-pressed={tool === 'measure'} onClick={() => set({ tool: tool === 'measure' ? 'none' : 'measure', pendingPoint: null })} title="Measure (M)">
          <Icon d={ICONS.ruler} /><span className="label">Measure</span>
        </button>
        {measurements.length > 0 && <button onClick={() => set({ measurements: [], pendingPoint: null })} title="Clear measurements"><Icon d={ICONS.trash} /></button>}
        <button aria-pressed={open} aria-expanded={open} onClick={() => setOpen(!open)} title="Layers (L)" data-testid="layers-button">
          <Icon d={ICONS.layers} /><span className="label">Layers</span>{on > 0 && <span className="count">{on}</span>}
        </button>
      </div>
      {open && (
        <div className="layers-pop" role="group" aria-label="Layers">
          <div className="layers-head"><b>Layers</b><span className="muted small">Details over the model</span>
            <span className="spacer" /><button className="btn sm ghost" onClick={() => setOpen(false)} aria-label="Close layers"><Icon d={ICONS.close} size={13} /></button></div>
          {LAYERS.map(([k, label, hint]) => (
            <label key={k} className="layer-opt">
              <input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} data-layer={k} />
              <span><span className="layer-name">{label}</span><span className="layer-hint">{hint}</span></span>
            </label>
          ))}
          {on > 0 && <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => set({ layers: Object.fromEntries(LAYERS.map(([k]) => [k, false])) as unknown as Layers })}>Hide all</button>}
        </div>
      )}
      {tool === 'measure' && (
        <div className="chip hint-top">Click two points. Snaps to plot and building corners. <span className="muted">Esc to stop</span></div>
      )}
      {view === 'walk' && !photo?.aligned && (
        <div className="chip hint-top">Eye height 1.65 m · drag to look · WASD or arrows to move · Shift to hurry</div>
      )}
    </>
  );
}

/** One quiet line on first open; it goes away after the first interaction. */
export function FirstHint() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const hide = () => setShow(false);
    const t = window.setTimeout(hide, 9000);
    window.addEventListener('pointerdown', hide, { once: true });
    window.addEventListener('wheel', hide, { once: true });
    return () => { window.clearTimeout(t); window.removeEventListener('pointerdown', hide); window.removeEventListener('wheel', hide); };
  }, []);
  if (!show) return null;
  return <div className="first-hint">Drag to look around · scroll to zoom · click a building for details</div>;
}

export function PhotoPanel({ site }: { site: SiteModel }) {
  const { photo, set, frames } = useStore();
  const pid = useStore((s) => s.projectId);
  const idx = useMemo(() => site.cameras.findIndex((c) => c.id === photo?.frameId), [site, photo?.frameId]);
  if (!photo) return null;
  const cam = site.cameras[idx];
  const fr = frames.find((f) => f.id === photo.frameId);
  const step = (d: number) => {
    const n = site.cameras[Math.max(0, Math.min(site.cameras.length - 1, idx + d))];
    if (n) set({ photo: { ...photo, frameId: n.id } });
  };
  return (
    <div className="section" style={{ background: 'var(--panel-2)' }} data-testid="photo-panel">
      <h3>Video frame <span className="right"><button className="btn sm ghost" onClick={() => set({ photo: null })} aria-label="Close frame"><Icon d={ICONS.close} size={13} /></button></span></h3>
      <img className="photo-card" src={api.frame(pid, photo.frameId)} alt="video frame" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <span className="small muted num">{cam?.clip ?? fr?.clip} · {fmtT(cam?.t ?? fr?.t ?? 0)}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => step(-1)} disabled={idx <= 0}>‹</button>
        <button className="btn sm" onClick={() => step(1)} disabled={idx < 0 || idx >= site.cameras.length - 1}>›</button>
      </div>
      {cam ? (
        <div style={{ marginTop: 8 }}>
          <button className="btn sm" aria-pressed={photo.aligned} onClick={() => set({ photo: { ...photo, aligned: !photo.aligned } })}>
            <Icon d={ICONS.photo} size={14} />{photo.aligned ? 'Back to the model' : 'Look through this frame'}
          </button>
          {photo.aligned && (
            <label className="opt small" style={{ marginTop: 6 }}>Frame
              <input type="range" min={0} max={1} step={0.05} value={photo.opacity} onChange={(e) => set({ photo: { ...photo, opacity: Number(e.target.value) } })} />model</label>
          )}
          <p className="small muted" style={{ margin: '6px 0 0' }}>Puts the 3D camera where the phone was, so you can check the model against the frame.</p>
          {cam.approx && <div className="note warn">This frame's pose comes from a weaker part of the reconstruction; expect a few degrees of misalignment.</div>}
        </div>
      ) : <p className="small muted">This frame was not placed in 3D, so it can't be aligned.</p>}
    </div>
  );
}

export function PhotoOverlay({ site }: { site: SiteModel }) {
  const photo = useStore((s) => s.photo);
  const pid = useStore((s) => s.projectId);
  if (!photo?.aligned) return null;
  const cam = site.cameras.find((c) => c.id === photo.frameId);
  if (!cam) return null;
  return (
    <div className="photo-overlay" style={{ opacity: 1 - photo.opacity }}>
      <img src={api.file(pid, `site/undistorted/${photo.frameId}.jpg`)} onError={(e) => { (e.target as HTMLImageElement).src = api.frame(pid, photo.frameId); }} alt="" style={{ aspectRatio: String(cam.aspect) }} />
    </div>
  );
}
