import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { BoundaryEdge, SiteElement, SiteModel, Tree, Vec2 } from '../types';
import { area } from '../plan/geom';
import { treeName } from '../scene/parts';
import { terrainHeight } from '../scene/geometry';
import { Prov, fmtT } from './common';

const centerOf = (e: SiteElement): Vec2 => e.center ?? [e.footprint.reduce((s, p) => s + p[0], 0) / e.footprint.length, e.footprint.reduce((s, p) => s + p[1], 0) / e.footprint.length];

function focus(site: SiteModel, c: Vec2, r: number, h: number) {
  return { kind: 'focus' as const, at: Date.now(), target: [c[0], terrainHeight(site, c[0], c[1]) + h / 2, -c[1]] as [number, number, number], radius: r };
}
const focusElement = (site: SiteModel, e: SiteElement) => {
  const c = centerOf(e);
  return focus(site, c, Math.max(...e.footprint.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))), e.ridge ?? e.height);
};
const focusTree = (site: SiteModel, t: Tree) => focus(site, t.at, Math.max(2, t.crown), t.height * 0.6);

const GROUPS: [string, (e: SiteElement) => boolean][] = [
  ['Buildings', (e) => ['house', 'sauna', 'deck', 'shed', 'woodpile', 'greenhouse'].includes(e.kind)],
  ['Yard', (e) => ['tank', 'trampoline', 'other', 'gate', 'rockgarden'].includes(e.kind)],
  ['Garden and parking', (e) => ['parking', 'tilled', 'beds'].includes(e.kind)],
];
const EDGE_NAME = { road: 'Road side', forest: 'Forest side', left: 'Left side', right: 'Right side' } as const;
const FENCE = (e: BoundaryEdge) => ({ picket: 'Wooden picket fence with the gate', boards: 'Board fence with a door to the forest', 'mesh-then-boards': 'Mesh at the front, boards at the back', 'picket-then-boards': 'Dark pickets at the front, boards along the forest' } as Record<string, string>)[e.style ?? ''] ?? 'Board fence';
const sizeOf = (e: SiteElement) => e.size ?? [0, 0];

export default function SitePanel({ site }: { site: SiteModel }) {
  const selection = useStore((s) => s.selection);
  const layers = useStore((s) => s.layers);
  const set = useStore((s) => s.set);
  const [showTrees, setShowTrees] = useState(false);
  const poly = site.plot.polygon ?? site.plot.edges.map((e) => e.a);
  const plotArea = useMemo(() => area(poly), [poly]);
  const edge = (id: string) => site.plot.edges.find((e) => e.id === id)!;
  const t = site.terrain;
  const fallTo = (() => {
    const d = ((t.fallDirectionDeg % 360) + 360) % 360;
    if (d < 45 || d >= 315) return 'toward the forest';
    if (d < 135) return 'toward the right fence';
    if (d < 225) return 'toward the road';
    return 'toward the left fence';
  })();
  const trees = site.trees ?? [];
  const sel = selection?.kind === 'element' ? site.elements.find((e) => e.id === selection.id) : null;
  const tree = selection?.kind === 'tree' ? trees.find((x) => x.id === selection.id) : null;
  const edgeSel = selection?.kind === 'edge' ? site.plot.edges.find((e) => e.id === selection.id) : null;
  const pin = selection?.kind === 'pin' ? site.pins[Number(selection.id)] : null;

  return (
    <div>
      {sel && <ElementCard site={site} e={sel} />}
      {tree && (
        <div className="section sel-card" data-testid="selection-card">
          <Head title={treeName(tree)} />
          <div className="kv">
            <span className="k">Height</span><span className="v num">≈ {tree.height.toFixed(0)} m</span>
            <span className="k">Crown</span><span className="v num">≈ {(tree.crown * 2).toFixed(0)} m across</span>
          </div>
          {layers.survey && <Survey prov={tree.provenance} how={tree.how} />}
        </div>
      )}
      {edgeSel && (
        <div className="section sel-card" data-testid="selection-card">
          <Head title={`Boundary · ${EDGE_NAME[edgeSel.id].toLowerCase()}`} />
          <div className="kv">
            <span className="k">Length</span><span className="v num">{edgeSel.modelLength.toFixed(1)} m</span>
            {edgeSel.statedLength && <><span className="k">Supplied figure</span><span className="v num">{edgeSel.statedLength[0] === edgeSel.statedLength[1] ? `≈ ${edgeSel.statedLength[0]}` : edgeSel.statedLength.join('–')} m</span></>}
            <span className="k">Fence</span><span className="v">{FENCE(edgeSel)}</span>
          </div>
          {layers.survey && (
            <>
              <div className="kv small" style={{ marginTop: 8 }}>
                {edgeSel.reconstructedLength !== undefined && <><span className="k">Fence length in the video</span><span className="v num">{edgeSel.reconstructedLength.toFixed(1)} m</span></>}
                <span className="k">Line position</span><span className="v num">± {edgeSel.rawResidual.toFixed(1)} m</span>
              </div>
              {edgeSel.how && <p className="small how">{edgeSel.how}</p>}
            </>
          )}
        </div>
      )}
      {pin && (
        <div className="section sel-card" data-testid="selection-card">
          <Head title="Said here in the video" />
          <div className="quote"><span className="t">{pin.clip} {fmtT(pin.t)}</span>{pin.quote}
            {site.transcriptGloss?.[String(pin.segment)] && <div className="small" style={{ color: 'var(--ink)' }}>{site.transcriptGloss[String(pin.segment)]}</div>}</div>
          <p className="small muted">The video's author, at the spot where the camera was; the dashed line shows where it pointed.</p>
        </div>
      )}

      <div className="section">
        <h3>About this plot</h3>
        <div className="bignum">
          <div><span className="lab">Road side</span><span className="big num">{edge('road').modelLength.toFixed(0)}</span><span className="small muted">m</span></div>
          <div><span className="lab">Road → forest</span><span className="big num">{site.plot.depth.toFixed(0)}</span><span className="small muted">m</span></div>
          <div><span className="lab">Area</span><span className="big num">{Math.round(plotArea).toLocaleString('en')}</span><span className="small muted">m² · {(plotArea / 100).toFixed(1)} sotki</span></div>
        </div>
        <p className="small" style={{ color: 'var(--ink-2)', margin: '10px 0 0' }}>
          Forest side {edge('forest').modelLength.toFixed(0)} m. The land falls about {t.slopePct.toFixed(0)}% {fallTo}. The gate is on the road side, {(site.plot.entrance.u - site.plot.entrance.width / 2).toFixed(0)} m from the left corner.
          Forest starts right behind the back fence.
        </p>
      </div>

      <div className="section">
        <h3>On the plot</h3>
        {GROUPS.map(([g, test]) => {
          const list = site.elements.filter(test);
          if (!list.length) return null;
          return (
            <div key={g} className="group">
              <div className="group-title">{g}</div>
              <div className="list">
                {list.map((e) => (
                  <div key={e.id} className="row" role="button" aria-selected={selection?.kind === 'element' && selection.id === e.id} data-item={e.id}
                    onClick={() => set({ selection: { kind: 'element', id: e.id }, cameraRequest: focusElement(site, e) })}>
                    <div className="grow"><div className="title">{e.label}</div>{e.outside && <div className="small muted">Mostly outside the boundary</div>}</div>
                    {layers.survey && <Prov p={e.provenance} />}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {trees.length > 0 && (
          <div className="group">
            <div className="group-title" role="button" style={{ cursor: 'pointer' }} onClick={() => setShowTrees(!showTrees)}>
              Trees <span className="muted">· {trees.length}</span> <span className="right small muted">{showTrees ? 'hide' : 'show'}</span>
            </div>
            {showTrees && (
              <div className="list">
                {trees.map((tr) => (
                  <div key={tr.id} className="row" role="button" aria-selected={selection?.kind === 'tree' && selection.id === tr.id}
                    onClick={() => set({ selection: { kind: 'tree', id: tr.id }, cameraRequest: focusTree(site, tr) })}>
                    <div className="grow"><div className="title">{treeName(tr)} <span className="muted small">≈ {tr.height.toFixed(0)} m</span></div></div>
                    {layers.survey && <Prov p={tr.provenance} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {layers.survey && <SurveyNotes site={site} />}
      {layers.narration && <Narration site={site} />}
      {!layers.survey && !layers.narration && (
        <p className="small muted" style={{ padding: '0 16px 16px' }}>How each thing was located, the accuracy and the narration are under Layers.</p>
      )}
    </div>
  );
}

function Head({ title }: { title: string }) {
  const set = useStore((s) => s.set);
  return <h3 className="sel-title">{title}<span className="right"><button className="btn sm ghost" onClick={() => set({ selection: null })}>Close</button></span></h3>;
}

function Survey({ prov, how, uncertainty }: { prov: SiteElement['provenance']; how?: string; uncertainty?: number }) {
  return (
    <div className="survey-box">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Prov p={prov} />{uncertainty !== undefined && <span className="small muted num">± {uncertainty.toFixed(1)} m</span>}</div>
      {how && <p className="small how">{how}</p>}
    </div>
  );
}

function ElementCard({ site, e }: { site: SiteModel; e: SiteElement }) {
  const set = useStore((s) => s.set);
  const pid = useStore((s) => s.projectId);
  const layers = useStore((s) => s.layers);
  const transcript = useStore((s) => s.transcript);
  const [a, b] = sizeOf(e);
  const children = site.elements.filter((x) => x.parent === e.id);
  const parent = e.parent ? site.elements.find((x) => x.id === e.parent) : null;
  const flat = e.height < 0.5;
  return (
    <div className="section sel-card" data-testid="selection-card">
      <Head title={e.label} />
      {e.detail && <p className="small" style={{ margin: '0 0 8px', color: 'var(--ink-2)' }}>{e.detail}</p>}
      <div className="kv">
        {a > 0 && <><span className="k">{e.round ? 'Diameter' : 'Footprint'}</span><span className="v num">{e.round ? `${a.toFixed(1)} m` : `${a.toFixed(1)} × ${b.toFixed(1)} m`}</span></>}
        {!flat && <><span className="k">{e.ridge ? 'Eaves / ridge' : 'Height'}</span><span className="v num">{e.height.toFixed(1)}{e.ridge ? ` / ${e.ridge.toFixed(1)}` : ''} m</span></>}
        {e.outside && <><span className="k">Where</span><span className="v">Mostly outside the boundary; its door is on the fence line</span></>}
        {parent && <><span className="k">Part of</span><span className="v"><a className="link" onClick={() => set({ selection: { kind: 'element', id: parent.id }, cameraRequest: focusElement(site, parent) })}>{parent.label}</a></span></>}
        {children.length > 0 && <><span className="k">With</span><span className="v">{children.map((c, i) => <span key={c.id}>{i ? ', ' : ''}<a className="link" onClick={() => set({ selection: { kind: 'element', id: c.id }, cameraRequest: focusElement(site, c) })}>{c.label.toLowerCase()}</a></span>)}</span></>}
      </div>
      {layers.survey && (
        <>
          <Survey prov={e.provenance} how={e.how} uncertainty={e.uncertainty} />
          {!!e.evidence.frames?.length && (
            <div className="frame-strip" style={{ marginTop: 8 }}>
              {e.evidence.frames.slice(0, 8).map((f) => (
                <img key={f} src={api.thumb(pid, f)} alt={f} title={f} loading="lazy" onClick={() => set({ photo: { frameId: f, aligned: false, opacity: 0.6 } })} />
              ))}
            </div>
          )}
        </>
      )}
      {layers.narration && e.evidence.segments?.map((si) => transcript?.segments[si] && (
        <div key={si} className="quote"><span className="t">The video's author · {site.sourceClips[transcript.segments[si].source] ?? ''} {fmtT(transcript.segments[si].t0)}</span>{transcript.segments[si].text}
          {site.transcriptGloss?.[String(si)] && <div className="small" style={{ color: 'var(--ink)' }}>{site.transcriptGloss[String(si)]}</div>}</div>
      ))}
    </div>
  );
}

function SurveyNotes({ site }: { site: SiteModel }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of site.elements) c[e.provenance] = (c[e.provenance] ?? 0) + 1;
    for (const t of site.trees ?? []) c[t.provenance] = (c[t.provenance] ?? 0) + 1;
    return c;
  }, [site]);
  const w = site.warp;
  return (
    <div className="section" data-testid="survey-notes">
      <h3>Survey notes</h3>
      <div className="kv small">
        <span className="k">Frames placed in 3D</span><span className="v num">{site.reconstruction.registered} <span className="muted">of {site.reconstruction.frames}</span></span>
        <span className="k">3D points</span><span className="v num">{site.reconstruction.points.toLocaleString('en')}</span>
        <span className="k">Reprojection error</span><span className="v num">{site.reconstruction.reprojectionError.toFixed(2)} px</span>
        <span className="k">Expected accuracy</span><span className="v">{site.scale.expectedAccuracy}</span>
      </div>
      <p className="small how">{site.scale.method}</p>
      {w && (
        <p className="small how">
          Fence to fence the video measures {w.reconstructedWidth[0].toFixed(1)} m along the road, {w.reconstructedWidth[1].toFixed(1)} m along the forest and {w.reconstructedDepth[0].toFixed(1)} m deep.
          Those fence lines are mapped onto the supplied outline; nothing moved by more than {w.maxShift.toFixed(1)} m. Coordinates quoted in the notes are in the video's own frame, before this mapping.
        </p>
      )}
      {site.scale.checks.length > 0 && (
        <div className="checks" style={{ marginTop: 8 }}>
          {site.scale.checks.map((c) => (
            <div key={c.label} className={`check ${c.ok ? '' : 'fail'}`}>
              <span className="dot" />
              <span>{c.label}{c.note ? <span className="muted"> · {c.note}</span> : null}</span>
              <span className="num">{c.measured.toFixed(2)} m <span className="muted">({c.expected[0]}–{c.expected[1]})</span></span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        {(['reconstructed', 'located', 'inferred'] as const).filter((p) => counts[p]).map((p) => <span key={p} className={`prov ${p}`}>{counts[p]} <Prov p={p} bare /></span>)}
      </div>
      {site.conflicts.map((c) => (
        <div key={c.topic} style={{ marginBottom: 10 }}>
          <b style={{ fontWeight: 500 }}>{c.topic}</b>
          <div className="small" style={{ color: 'var(--ink-2)' }}>{c.detail}</div>
          <div className="small" style={{ color: 'var(--accent)' }}>→ {c.resolution}</div>
        </div>
      ))}
    </div>
  );
}

function Narration({ site }: { site: SiteModel }) {
  const transcript = useStore((s) => s.transcript);
  const set = useStore((s) => s.set);
  if (!transcript) return null;
  return (
    <div className="section" data-testid="narration">
      <h3>What the video's author says</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Narration by the person who filmed the video, transcribed from Russian; English lines are a translation. Lines with a blue edge are pinned on the map.</p>
      {transcript.segments.map((s, i) => ({ s, i })).filter(({ s }) => s.text.split(' ').length > 2).map(({ s, i }) => {
        const pinIdx = site.pins.findIndex((p) => p.segment === i);
        return (
          <div key={i} className="quote" style={{ cursor: pinIdx >= 0 ? 'pointer' : 'default', borderColor: pinIdx >= 0 ? 'var(--stated)' : 'var(--line)' }}
            onClick={() => { if (pinIdx >= 0) set({ selection: { kind: 'pin', id: String(pinIdx) } }); }}>
            <span className="t">{site.sourceClips[s.source] ?? ''} {fmtT(s.t0)}</span>{s.text}
            {site.transcriptGloss?.[String(i)] && <div className="small" style={{ color: 'var(--ink)' }}>{site.transcriptGloss[String(i)]}</div>}
          </div>
        );
      })}
    </div>
  );
}
