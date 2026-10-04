import { useEffect, useMemo, useState } from 'react';
import { useStore, type ViewMode } from '../store';
import { api } from '../api';
import type { SiteModel } from '../types';
import { Icon, ICONS, fmtT } from './common';
import { sunPosition } from '../scene/Scene';

export function Toolbar() {
  const { view, tool, set, layers, toggleLayer, measurements, sun, photo } = useStore();
  const [layersOpen, setLayersOpen] = useState(false);
  const [sunOpen, setSunOpen] = useState(false);
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === 'm' || e.key === 'M') set({ tool: useStore.getState().tool === 'measure' ? 'none' : 'measure', pendingPoint: null });
      if (e.key === 'Escape') set({ tool: 'none', pendingPoint: null, photo: null, selection: null });
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
        {V('orbit', 'Orbit', ICONS.orbit, '1')}
        {V('top', 'Plan', ICONS.top, '2')}
        {V('walk', 'Walk', ICONS.walk, '3')}
        <span className="sep" />
        <button aria-pressed={tool === 'measure'} onClick={() => set({ tool: tool === 'measure' ? 'none' : 'measure', pendingPoint: null })} title="Measure (M)">
          <Icon d={ICONS.ruler} /><span className="label">Measure</span>
        </button>
        {measurements.length > 0 && <button onClick={() => set({ measurements: [], pendingPoint: null })} title="Clear measurements"><Icon d={ICONS.trash} /></button>}
        <button aria-pressed={sun.on} onClick={() => setSunOpen(!sunOpen)} title="Sun and shadows"><Icon d={ICONS.sun} /><span className="label">Sun</span></button>
        <button aria-pressed={layersOpen} onClick={() => setLayersOpen(!layersOpen)} title="Layers"><Icon d={ICONS.layers} /><span className="label">Layers</span></button>
      </div>
      {layersOpen && (
        <div className="chip" style={{ position: 'absolute', bottom: 66, left: '50%', transform: 'translateX(40px)', zIndex: 45, padding: 10, minWidth: 220 }}>
          {([
            ['points', 'Reconstruction points (evidence)'],
            ['existing', 'Existing structures'],
            ['uncertainty', 'Position uncertainty'],
            ['cameras', 'Camera path (where frames were shot)'],
            ['pins', 'Owner\'s remarks on the map'],
            ['labels', 'Labels and dimensions'],
            ['grid', '1 / 5 / 10 m grid'],
            ['context', 'Forest and road context'],
          ] as const).map(([k, label]) => (
            <label key={k} className="opt"><input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} />{label}</label>
          ))}
        </div>
      )}
      {sunOpen && <SunControls onClose={() => setSunOpen(false)} />}
      {tool === 'measure' && (
        <div className="chip" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 45 }}>
          Click two points. Snaps to plot and building corners. Drag pans. <span className="muted">Esc to stop</span>
        </div>
      )}
      {view === 'walk' && !photo?.aligned && (
        <div className="chip" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 45 }}>
          Walking at 1.65 m eye height · drag to look · WASD / arrows to move · Shift to hurry
        </div>
      )}
    </>
  );
}

function SunControls({ onClose }: { onClose: () => void }) {
  const { sun, set } = useStore();
  const pos = sunPosition(sun.lat, sun.month, sun.hour);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="chip" style={{ position: 'absolute', bottom: 66, left: '50%', transform: 'translateX(-20px)', zIndex: 45, padding: 12, width: 300 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><b style={{ fontWeight: 600 }}>Sun and shadows</b><span className="spacer" /><button className="btn sm ghost" onClick={onClose}><Icon d={ICONS.close} size={13} /></button></div>
      {sun.northDeg === null ? (
        <>
          <p className="small" style={{ margin: '0 0 8px', color: 'var(--ink-2)' }}>The footage doesn't show which way is north (overcast day, no shadows), so shadows stay off until you set it.</p>
          <div className="small">Where is north, looking from the gate into the plot?</div>
          <div className="examples">
            {[['ahead (toward forest)', 0], ['to the right', 90], ['behind (toward road)', 180], ['to the left', 270]].map(([l, d]) => (
              <button key={l as string} onClick={() => set({ sun: { ...sun, northDeg: d as number, on: true } })}>{l}</button>
            ))}
          </div>
        </>
      ) : (
        <div className="small">
          <label className="opt"><input type="checkbox" checked={sun.on} onChange={(e) => set({ sun: { ...sun, on: e.target.checked } })} />Show sun and cast shadows</label>
          <label className="opt" style={{ display: 'grid', gridTemplateColumns: '64px 1fr 44px' }}>North
            <input type="range" min={0} max={359} value={sun.northDeg} onChange={(e) => set({ sun: { ...sun, northDeg: Number(e.target.value) } })} /><span className="num">{sun.northDeg}°</span></label>
          <label className="opt" style={{ display: 'grid', gridTemplateColumns: '64px 1fr 44px' }}>Month
            <input type="range" min={1} max={12} value={sun.month} onChange={(e) => set({ sun: { ...sun, month: Number(e.target.value) } })} /><span>{months[sun.month - 1]}</span></label>
          <label className="opt" style={{ display: 'grid', gridTemplateColumns: '64px 1fr 44px' }}>Time
            <input type="range" min={4} max={22} step={0.25} value={sun.hour} onChange={(e) => set({ sun: { ...sun, hour: Number(e.target.value) } })} /><span className="num">{Math.floor(sun.hour)}:{String(Math.round((sun.hour % 1) * 60)).padStart(2, '0')}</span></label>
          <label className="opt" style={{ display: 'grid', gridTemplateColumns: '64px 1fr 44px' }}>Latitude
            <input type="range" min={41} max={70} step={0.5} value={sun.lat} onChange={(e) => set({ sun: { ...sun, lat: Number(e.target.value) } })} /><span className="num">{sun.lat}°</span></label>
          <div className="muted">Sun {Math.max(0, (pos.el * 180) / Math.PI).toFixed(0)}° above the horizon. North and latitude are your input, not from the footage (latitude default ≈ Urals).</div>
          <button className="btn sm ghost" onClick={() => set({ sun: { ...sun, northDeg: null, on: false } })}>Forget north</button>
        </div>
      )}
    </div>
  );
}

export function Legend({ site }: { site: SiteModel }) {
  const mode = useStore((s) => s.mode);
  return (
    <div className="chip legend" aria-label="legend">
      <span className="sw recon" /><span>Reconstructed from video</span>
      <span className="sw inferred" /><span>Inferred (approximate)</span>
      <span className="sw stated" /><span>Owner's statement</span>
      {mode !== 'site' && <><span className="sw new" /><span>Proposed</span></>}
      <span />
      <span className="muted">Scale anchor: {site.plot.statedWidth.join('–')} × {site.plot.statedDepth[0]} m</span>
    </div>
  );
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
    <div className="section" style={{ background: 'var(--panel-2)' }}>
      <h3>Source frame <span className="right"><button className="btn sm ghost" onClick={() => set({ photo: null })}><Icon d={ICONS.close} size={13} /></button></span></h3>
      <img className="photo-card" src={api.frame(pid, photo.frameId)} alt="video frame" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <span className="small muted num">{cam?.clip ?? fr?.clip} · {fmtT(cam?.t ?? fr?.t ?? 0)}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => step(-1)} disabled={idx <= 0}>‹</button>
        <button className="btn sm" onClick={() => step(1)} disabled={idx < 0 || idx >= site.cameras.length - 1}>›</button>
      </div>
      {cam ? (
        <div style={{ marginTop: 8 }}>
          <button className="btn primary sm" aria-pressed={photo.aligned} onClick={() => set({ photo: { ...photo, aligned: !photo.aligned } })}>
            <Icon d={ICONS.photo} size={14} />{photo.aligned ? 'Leave photo view' : 'Look through this photo'}
          </button>
          {photo.aligned && (
            <label className="opt small" style={{ marginTop: 6 }}>Photo
              <input type="range" min={0} max={1} step={0.05} value={photo.opacity} onChange={(e) => set({ photo: { ...photo, opacity: Number(e.target.value) } })} />model</label>
          )}
          <p className="small muted" style={{ margin: '6px 0 0' }}>Puts the 3D camera where the phone was. If the model and the photo line up, the reconstruction is right there.</p>
          {cam.approx && <div className="note warn">This frame's pose comes from a weaker part of the reconstruction: its direction can be a few degrees off, so expect some misalignment.</div>}
        </div>
      ) : <p className="small muted">This frame was not registered in 3D (blurred or too little overlap), so it can't be aligned.</p>}
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

export function FirstHint() {
  const [show, setShow] = useState(() => {
    try { return localStorage.getItem('mera.hint') !== '1'; } catch { return true; }
  });
  if (!show) return null;
  const close = () => { setShow(false); try { localStorage.setItem('mera.hint', '1'); } catch { /* private mode */ } };
  return (
    <div className="chip" style={{ maxWidth: 300, lineHeight: 1.45 }}>
      <b style={{ fontWeight: 600 }}>Your plot, rebuilt from the video at true scale.</b>
      <div className="muted">Drag to orbit, scroll to zoom, right-drag to pan. Click anything to see the frames and words it came from.</div>
      <button className="btn sm" style={{ marginTop: 6 }} onClick={close}>Got it</button>
    </div>
  );
}
