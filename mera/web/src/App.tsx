import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useStore, activeVariantOf, type Mode } from './store';
import { api, type ProjectInfo } from './api';
import SitePanel from './ui/SitePanel';
import PlanPanel from './ui/PlanPanel';
import { ComparePanel, CompareView } from './ui/Compare';
import { FirstHint, Legend, PhotoOverlay, PhotoPanel, Toolbar } from './ui/Overlays';
import ExportDialog from './ui/ExportDialog';
import { NewSurvey, Progress } from './ui/Onboarding';
import { Icon, ICONS } from './ui/common';

import Scene from './scene/Scene';
import { labelPortal } from './scene/labelPortal';

export default function App() {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [screen, setScreen] = useState<'loading' | 'new' | 'progress' | 'site'>('loading');
  const [panelOpen, setPanelOpen] = useState(true);
  const { site, mode, set, variants, compare, exportOpen, loadError } = useStore();
  const variant = useStore(activeVariantOf);
  const pid = useStore((s) => s.projectId);
  const selection = useStore((s) => s.selection);
  const photoId = useStore((s) => s.photo?.frameId);
  const panelRef = useRef<HTMLElement>(null);
  // details for a newly selected thing appear at the top of the panel: bring them into view
  useEffect(() => { if (selection || photoId) panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [selection, photoId]);

  const open = useCallback(async (id: string) => {
    set({ projectId: id, site: null, loadError: null });
    const url = new URL(window.location.href);
    url.searchParams.set('p', id);
    window.history.replaceState(null, '', url);
    try {
      const [s, tr, fr, vs] = await Promise.all([api.site(id), api.transcript(id).catch(() => null), api.frames(id).catch(() => []), api.variants(id).catch(() => [])]);
      set({ site: s, transcript: tr, frames: fr, variants: vs, activeVariant: vs.find((v) => v.starred)?.id ?? vs[0]?.id ?? null, compare: vs.filter((v) => v.starred).map((v) => v.id).slice(0, 4) });
      setScreen('site');
    } catch (e) {
      set({ loadError: (e as Error).message });
    }
  }, [set]);

  useEffect(() => {
    api.projects().then((ps) => {
      setProjects(ps);
      const want = new URL(window.location.href).searchParams.get('p');
      const p = ps.find((x) => x.id === want) ?? ps.find((x) => x.hasSite) ?? ps.find((x) => x.running);
      if (!p) setScreen('new');
      else if (p.hasSite) open(p.id);
      else { set({ projectId: p.id }); setScreen('progress'); }
    }).catch((e) => { set({ loadError: String(e) }); setScreen('new'); });
  }, [open, set]);

  // persist variants (debounced) so decisions survive reloads
  const saveTimer = useRef<number | undefined>(undefined);
  const loaded = useRef(false);
  useEffect(() => {
    if (!site) return;
    if (!loaded.current) { loaded.current = true; return; }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { api.saveVariants(pid, variants).catch(() => {}); }, 600);
  }, [variants, pid, site]);

  if (screen === 'new') return <NewSurvey onOpen={open} existing={projects ?? []} />;
  if (screen === 'progress') return <Progress pid={pid} onOpen={open} />;
  if (!site) {
    return <div className="center"><div className="card">{loadError ? <><h2>Couldn't load the survey</h2><p className="muted">{loadError}</p></> : <p className="muted">Loading survey…</p>}</div></div>;
  }

  const tab = (m: Mode, label: string, count?: number) => (
    <button aria-pressed={mode === m} onClick={() => set({ mode: m, selection: null, tool: 'none', photo: null, dragging: null })}>
      {label}{count ? <span className="count">{count}</span> : null}
    </button>
  );
  const shownVariant = mode === 'site' ? null : variant;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><b>Mera</b><span className="proj">{site.name} · {site.plot.width.toFixed(1)} × {site.plot.depth.toFixed(1)} m</span></div>
        <nav className="tabs" aria-label="Mode">
          {tab('site', 'Site')}
          {tab('plan', 'Plan', variants.length)}
          {tab('compare', 'Compare', compare.length)}
        </nav>
        <span className="spacer" />
        <button className="btn" onClick={() => set({ exportOpen: true })}><Icon d={ICONS.download} /><span className="label">Export</span></button>
        <button className="btn ghost" title={panelOpen ? 'Hide panel' : 'Show panel'} onClick={() => setPanelOpen(!panelOpen)}><Icon d={ICONS.panel} /></button>
      </header>
      <div className={`main ${panelOpen ? '' : 'panel-closed'}`}>
        <div className="viewport">
          {mode === 'compare' ? <CompareView site={site} /> : (
            <>
              <Suspense fallback={<div className="center muted">Loading 3D…</div>}>
                <Scene site={site} variant={shownVariant} />
              </Suspense>
              <div ref={(el) => { if (el) labelPortal.current = el; }} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 1 }} />
              <PhotoOverlay site={site} />
              <div className="hud tl"><Legend site={site} /><FirstHint /></div>
              <Toolbar />
            </>
          )}
        </div>
        <aside className="panel" aria-label="Details" ref={panelRef}>
          {panelOpen && (
            <>
              {mode !== 'compare' && <PhotoPanel site={site} />}
              {mode === 'site' && <SitePanel site={site} />}
              {mode === 'plan' && <PlanPanel site={site} />}
              {mode === 'compare' && <ComparePanel site={site} />}
            </>
          )}
        </aside>
      </div>
      {exportOpen && <ExportDialog site={site} />}
    </div>
  );
}
