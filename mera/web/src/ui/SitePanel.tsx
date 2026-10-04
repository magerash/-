import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { SiteElement, SiteModel } from '../types';
import { area } from '../plan/geom';
import { Prov, fmtT } from './common';

function focusOn(site: SiteModel, e: SiteElement) {
  const c = e.footprint.reduce((a, p) => [a[0] + p[0] / e.footprint.length, a[1] + p[1] / e.footprint.length], [0, 0]);
  const r = Math.max(...e.footprint.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
  const t = site.terrain;
  return { kind: 'focus' as const, at: Date.now(), target: [c[0], t.h0 + t.gu * c[0] + t.gv * c[1] + (e.height || 1) / 2, -c[1]] as [number, number, number], radius: r };
}

const KIND_ORDER: SiteElement['kind'][] = ['house', 'sauna', 'deck', 'shed', 'greenhouse', 'parking', 'beds', 'tilled', 'rockgarden', 'woodpile', 'tank', 'trampoline', 'tree', 'gate', 'other'];

export default function SitePanel({ site }: { site: SiteModel }) {
  const selection = useStore((s) => s.selection);
  const transcript = useStore((s) => s.transcript);
  const set = useStore((s) => s.set);
  const [showAll, setShowAll] = useState(false);
  const plotArea = useMemo(() => area(site.plot.edges.map((e) => e.a)), [site]);
  const counts = useMemo(() => {
    const c = { reconstructed: 0, inferred: 0, stated: 0 } as Record<string, number>;
    for (const e of site.elements) c[e.provenance]++;
    return c;
  }, [site]);
  const elements = useMemo(() => [...site.elements].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)), [site]);
  const sel = selection?.kind === 'element' ? site.elements.find((e) => e.id === selection.id) : null;
  const edge = selection?.kind === 'edge' ? site.plot.edges.find((e) => e.id === selection.id) : null;
  const pin = selection?.kind === 'pin' ? site.pins[Number(selection.id)] : null;
  const t = site.terrain;
  const fallTo = (() => {
    const d = ((t.fallDirectionDeg % 360) + 360) % 360;
    if (d < 45 || d >= 315) return 'toward the forest';
    if (d < 135) return 'toward the right fence';
    if (d < 225) return 'toward the road';
    return 'toward the left fence';
  })();

  return (
    <div>
      {sel && <ElementDetail site={site} e={sel} />}
      {edge && (
        <div className="section">
          <h3>Boundary · {edge.id} side <span className="right"><button className="btn sm ghost" onClick={() => set({ selection: null })}>Close</button></span></h3>
          <div className="kv">
            <span className="k">Model length</span><span className="v num">{edge.modelLength.toFixed(2)} m</span>
            <span className="k">Owner's figure</span><span className="v num">{edge.statedLength ? `${edge.statedLength[0]}–${edge.statedLength[1]} m` : '—'}</span>
            {edge.reconstructedLength !== undefined && <><span className="k">Fence to fence in the video</span><span className="v num">{edge.reconstructedLength.toFixed(1)} m</span></>}
            <span className="k">This side's position</span><span className="v num">±{edge.rawResidual.toFixed(1)} m</span>
            <span className="k">Evidence</span><span className="v small">{edge.method === 'fence points' ? `${edge.points?.toLocaleString()} fence points` : 'walking path (fence barely reconstructed)'}</span>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>The boundary uses your plot figures; the dashed line next to it is where the video puts this fence (green: fence points, amber: walking path). Measure corner to corner with the ruler.</p>
        </div>
      )}
      {pin && (
        <div className="section">
          <h3>Said at this spot <span className="right"><button className="btn sm ghost" onClick={() => set({ selection: null })}>Close</button></span></h3>
          <div className="quote"><span className="t">{pin.clip} {fmtT(pin.t)}</span>{pin.quote}
            {site.transcriptGloss?.[String(pin.segment)] && <div className="small" style={{ color: 'var(--ink)' }}>{site.transcriptGloss[String(pin.segment)]}</div>}</div>
          <p className="small muted">Pinned where the camera was when this was said; the dashed line shows where it was pointing.</p>
        </div>
      )}

      {(site.scale.checks.some((c) => !c.ok) || site.conflicts.some((c) => c.topic === 'Footage coverage')) && (
        <div className="section"><div className="note warn" style={{ marginTop: 0 }}>
          <b>Treat this survey with caution.</b> {site.conflicts.find((c) => c.topic === 'Footage coverage')?.detail ?? 'Some scale checks failed.'} {site.conflicts.find((c) => c.topic === 'Footage coverage')?.resolution}
        </div></div>
      )}
      <div className="section">
        <h3>The plot</h3>
        <div className="bignum">
          <div><span className="lab">Width</span><span className="big num">{site.plot.width.toFixed(1)}</span><span className="small muted">m · owner {site.plot.statedWidth.join('–')}</span></div>
          <div><span className="lab">Road → forest</span><span className="big num">{site.plot.depth.toFixed(1)}</span><span className="small muted">m · owner {site.plot.statedDepth[0] === site.plot.statedDepth[1] ? '~' + site.plot.statedDepth[0] : site.plot.statedDepth.join('–')}</span></div>
          <div><span className="lab">Area</span><span className="big num">{Math.round(plotArea)}</span><span className="small muted">m² · {(plotArea / 100).toFixed(1)} sotki</span></div>
        </div>
        <div className="kv" style={{ marginTop: 12 }}>
          <span className="k">Fall of the land</span>
          <span className="v"><span className="num">{t.slopePct.toFixed(1)}%</span> {fallTo} <Prov p={t.provenance} /></span>
          <span className="k">Height difference across plot</span>
          <span className="v num">≈ {(Math.hypot(t.gu * site.plot.width, t.gv * site.plot.depth)).toFixed(1)} m ± {t.heightUncertainty.toFixed(1)}</span>
          <span className="k">Expected accuracy</span><span className="v small">{site.scale.expectedAccuracy}</span>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>{t.note}</p>
      </div>

      <div className="section">
        <h3>How it was measured</h3>
        <div className="kv small">
          <span className="k">Frames placed in 3D</span><span className="v num">{site.reconstruction.registered} <span className="muted">of {site.reconstruction.frames} keyframes</span></span>
          <span className="k">3D points</span><span className="v num">{site.reconstruction.points.toLocaleString()}</span>
          <span className="k">Reprojection error</span><span className="v num">{site.reconstruction.reprojectionError.toFixed(2)} px</span>
          <span className="k">Scale anchor</span><span className="v">{site.scale.method}</span>
          <span className="k">Aspect ratio, model vs owner</span><span className="v num">{site.scale.aspectFit.toFixed(3)} vs {site.scale.aspectStated.toFixed(3)}</span>
          <span className="k">Vertical direction</span><span className="v">{site.reconstruction.gravity}</span>
        </div>
        {site.scale.checks.length > 0 && (
          <>
            <div className="small" style={{ margin: '10px 0 4px', color: 'var(--ink-2)' }}>Independent checks with objects of known size</div>
            <div className="checks">
              {site.scale.checks.map((c) => (
                <div key={c.label} className={`check ${c.ok ? '' : 'fail'}`}>
                  <span className="dot" />
                  <span>{c.label}{c.note ? <span className="muted"> · {c.note}</span> : null}</span>
                  <span className="num">{c.measured.toFixed(2)} m <span className="muted">(exp. {c.expected[0]}–{c.expected[1]})</span></span>
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="prov reconstructed">{counts.reconstructed} reconstructed</span>
          <span className="prov inferred">{counts.inferred} inferred</span>
          {counts.stated > 0 && <span className="prov stated">{counts.stated} stated</span>}
        </div>
      </div>

      <div className="section">
        <h3>On the land <span className="right small muted">{site.elements.length} items</span></h3>
        <div className="list">
          {(showAll ? elements : elements.filter((e) => e.kind !== 'tree' && e.kind !== 'beds')).map((e) => (
            <div key={e.id} className="row" aria-selected={selection?.id === e.id} onClick={() => set({ selection: { kind: 'element', id: e.id }, cameraRequest: focusOn(site, e) })}>
              <div className="grow"><div className="title">{e.label}</div></div>
              <Prov p={e.provenance} />
            </div>
          ))}
        </div>
        <button className="btn sm ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all incl. trees and beds (${elements.length})`}</button>
      </div>

      {site.conflicts.length > 0 && (
        <div className="section">
          <h3>Owner vs footage</h3>
          {site.conflicts.map((c) => (
            <div key={c.topic} style={{ marginBottom: 10 }}>
              <b style={{ fontWeight: 500 }}>{c.topic}</b>
              <div className="small" style={{ color: 'var(--ink-2)' }}>{c.detail}</div>
              <div className="small" style={{ color: 'var(--stated)' }}>→ {c.resolution}</div>
            </div>
          ))}
        </div>
      )}

      {transcript && (
        <div className="section">
          <h3>What the owner said <span className="right small muted">{transcript.language.toUpperCase()} · {transcript.primary_model}</span></h3>
          {transcript.segments.map((s, i) => ({ s, i })).filter(({ s }) => s.text.split(' ').length > 2).map(({ s, i }) => {
            const pinIdx = site.pins.findIndex((p) => p.segment === i);
            const clip = site.sourceClips[s.source];
            return (
              <div key={i} className="quote" style={{ cursor: pinIdx >= 0 ? 'pointer' : 'default', borderColor: pinIdx >= 0 ? 'var(--stated)' : 'var(--line)' }}
                onClick={() => { if (pinIdx >= 0) set({ selection: { kind: 'pin', id: String(pinIdx) }, photo: { frameId: site.pins[pinIdx].frame, aligned: false, opacity: 0.6 } }); }}>
                <span className="t">{clip ?? ''} {fmtT(s.t0)}</span>{s.text}
                {site.transcriptGloss?.[String(i)] && <div className="small" style={{ color: 'var(--ink)' }}>{site.transcriptGloss[String(i)]}</div>}
                {s.alt && s.alt.toLowerCase().replace(/[^\p{L}\s]/gu, '') !== s.text.toLowerCase() && s.alt.length > 3 && (
                  <div className="small muted" title="Second speech model (Whisper) heard this">alt: {s.alt}</div>
                )}
              </div>
            );
          })}
          <p className="small muted">Russian as transcribed (GigaAM); English lines are an analyst translation. Click a blue-marked line to see where on the plot it was said and what the camera saw.</p>
        </div>
      )}
    </div>
  );
}

function ElementDetail({ site, e }: { site: SiteModel; e: SiteElement }) {
  const set = useStore((s) => s.set);
  const pid = useStore((s) => s.projectId);
  const transcript = useStore((s) => s.transcript);
  const xs = e.footprint.map((p) => p[0]), ys = e.footprint.map((p) => p[1]);
  const dims = e.footprint.length === 4
    ? [Math.hypot(e.footprint[1][0] - e.footprint[0][0], e.footprint[1][1] - e.footprint[0][1]), Math.hypot(e.footprint[2][0] - e.footprint[1][0], e.footprint[2][1] - e.footprint[1][1])]
    : [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  const why = e.provenance === 'reconstructed'
    ? `Position and footprint fitted to ${e.evidence.points ?? 'reconstructed'} 3D points from the video.`
    : e.provenance === 'stated' ? 'Taken from the owner\'s description.' : 'Seen in the video and placed from frames and narration; not enough 3D points to measure it. Treat size and position as approximate.';
  void site;
  return (
    <div className="section" style={{ background: 'var(--panel-2)' }}>
      <h3>Selected <span className="right"><button className="btn sm ghost" onClick={() => set({ selection: null })}>Close</button></span></h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 500 }}>{e.label}</span>
        <Prov p={e.provenance} />
      </div>
      <div className="kv">
        <span className="k">Footprint</span><span className="v num">{dims[0].toFixed(1)} × {dims[1].toFixed(1)} m</span>
        {e.height > 0.5 && <><span className="k">{e.ridge ? 'Eave / ridge' : 'Height'}</span><span className="v num">{e.height.toFixed(1)}{e.ridge ? ` / ${e.ridge.toFixed(1)}` : ''} m</span></>}
        <span className="k">Position uncertainty</span><span className="v num">±{e.uncertainty.toFixed(1)} m</span>
        <span className="k">Plans may clear it</span><span className="v">{e.removable ? 'yes' : 'no (kept)'}</span>
      </div>
      <p className="small" style={{ color: 'var(--ink-2)', margin: '8px 0' }}>{why}{e.note ? ' ' + e.note : ''}</p>
      {e.evidence.segments?.map((si) => transcript?.segments[si] && (
        <div key={si} className="quote"><span className="t">{fmtT(transcript.segments[si].t0)}</span>{transcript.segments[si].text}</div>
      ))}
      {!!e.evidence.frames?.length && (
        <div className="frame-strip" style={{ marginTop: 8 }}>
          {e.evidence.frames.slice(0, 8).map((f) => (
            <img key={f} src={api.thumb(pid, f)} alt={f} loading="lazy" onClick={() => set({ photo: { frameId: f, aligned: false, opacity: 0.6 } })} />
          ))}
        </div>
      )}
    </div>
  );
}
