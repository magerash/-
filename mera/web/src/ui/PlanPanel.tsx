import { useMemo, useState } from 'react';
import { useStore, activeVariantOf } from '../store';
import type { BuildType, Program, ProgramItem, Rules, SiteModel, Variant, Zone } from '../types';
import { parseBrief, describeZone } from '../plan/brief';
import { CATALOG } from '../plan/catalog';
import { cornerReport, reevaluate } from '../plan/solver';
import { solve } from '../plan/runSolver';
import { planSite } from '../plan/metrics';
import MiniPlan from './MiniPlan';
import { Icon, ICONS } from './common';

const EXAMPLES = [
  'A two-storey house near the forest, a garage and a sauna by the road',
  'Pool and gazebo in the middle, keep the garden beds',
  'Guest house 6x6 in the corner behind the sauna, remove the old sheds',
  'Двухэтажный дом у леса, гараж и баня у дороги',
];

const ZONES: Zone[] = ['any', 'forest', 'road', 'center', 'left', 'right', 'corner'];
const TYPES = Object.keys(CATALOG) as BuildType[];

export default function PlanPanel({ site }: { site: SiteModel }) {
  const { brief, program, programDirty, variants, activeVariant, rules, compare, set, upsertVariants } = useStore();
  const ps = useMemo(() => planSite(site), [site]);
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const active = activeVariantOf({ variants, activeVariant });
  const corner = site.zones.find((z) => z.id === 'build-corner');
  const cornerNotes = useMemo(() => (program && corner ? cornerReport(ps, program, rules, corner.polygon) : []), [program, corner, ps, rules]);

  const run = (prog: Program) => {
    setBusy(true);
    solve(ps, prog, rules, brief).then((vs) => {
      upsertVariants(vs);
      set({ activeVariant: vs[0]?.id ?? null, programDirty: false, selection: null, compare: vs.slice(0, 3).map((v) => v.id) });
    }).finally(() => setBusy(false));
  };
  const interpret = () => {
    const prog = parseBrief(brief, site.elements);
    set({ program: prog });
    if (prog.items.length) run(prog);
  };
  const editItem = (id: string, patch: Partial<ProgramItem>) => {
    if (!program) return;
    set({ program: { ...program, items: program.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }, programDirty: true });
  };
  const ordered = [...variants].sort((a, b) => Number(!!b.starred) - Number(!!a.starred));

  return (
    <div>
      <div className="section">
        <h3>Describe what you want to build</h3>
        <textarea className="textarea" value={brief} placeholder='e.g. "a two-storey house near the forest, a garage and a sauna by the road"'
          onChange={(e) => set({ brief: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) interpret(); }} aria-label="Building brief" />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <button className="btn primary" onClick={interpret} disabled={!brief.trim() || busy}>{busy ? 'Placing…' : 'Generate variants'}</button>
          <span className="small muted">English or Russian · Ctrl+Enter</span>
        </div>
        <div className="examples">
          {EXAMPLES.map((x) => <button key={x} onClick={() => set({ brief: x })}>{x}</button>)}
        </div>
      </div>

      {program && (
        <div className="section">
          <h3>Understood as <span className="right small muted">edit, then regenerate</span></h3>
          {program.items.map((it) => (
            <div key={it.id} className="item">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select value={it.type} onChange={(e) => {
                  const t = e.target.value as BuildType;
                  editItem(it.id, { type: t, label: CATALOG[t].label, w: CATALOG[t].w, d: CATALOG[t].d });
                }} aria-label="type">
                  {TYPES.map((t) => <option key={t} value={t}>{CATALOG[t].label}</option>)}
                </select>
                {CATALOG[it.type].storeyHeight > 0 && it.type !== 'greenhouse' && (
                  <select value={it.storeys} onChange={(e) => {
                    const n = Number(e.target.value);
                    editItem(it.id, { storeys: n, label: CATALOG[it.type].label + (n === 1.5 ? ' with attic' : n > 1 ? ` · ${n} storeys` : '') });
                  }} aria-label="storeys">
                    <option value={1}>1 storey</option>
                    <option value={1.5}>attic</option>
                    <option value={2}>2 storeys</option>
                    <option value={3}>3 storeys</option>
                  </select>
                )}
              </div>
              <button className="btn sm ghost" title="Remove" onClick={() => set({ program: { ...program, items: program.items.filter((i) => i.id !== it.id) }, programDirty: true })}><Icon d={ICONS.close} size={14} /></button>
              <div className="meta">
                <input type="number" step={0.5} min={1} value={it.w} onChange={(e) => editItem(it.id, { w: Math.max(1, Number(e.target.value)) })} aria-label="width" />×
                <input type="number" step={0.5} min={1} value={it.d} onChange={(e) => editItem(it.id, { d: Math.max(1, Number(e.target.value)) })} aria-label="depth" /> m
                <select value={it.zone} onChange={(e) => editItem(it.id, { zone: e.target.value as Zone })} aria-label="location">
                  {ZONES.map((z) => <option key={z} value={z}>{describeZone(z)}</option>)}
                </select>
                {!it.sizeFromBrief && <span className="muted" title="Typical size; edit if you know better">typical size</span>}
              </div>
              <div className="meta muted" style={{ fontStyle: 'italic' }}>“{it.phrase}”</div>
            </div>
          ))}
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => {
            const t: BuildType = 'shed';
            const it: ProgramItem = { id: `shed-x${Date.now() % 100000}`, type: t, label: CATALOG[t].label, storeys: 1, w: CATALOG[t].w, d: CATALOG[t].d, zone: 'any', sizeFromBrief: false, phrase: 'added by hand' };
            set({ program: { ...program, items: [...program.items, it] }, programDirty: true });
          }}><Icon d={ICONS.plus} size={14} />Add building</button>
          {program.notes.map((n) => <div key={n} className="note">{n}</div>)}
          {cornerNotes.map((n) => <div key={n} className={`note ${n.includes('does not') ? 'warn' : ''}`}>{n}</div>)}
          {program.unparsed.map((u) => <div key={u} className="note warn">Not understood: “{u}”. Rephrase or add it by hand.</div>)}
          {programDirty && <button className="btn primary" style={{ marginTop: 10 }} onClick={() => run(program)} disabled={busy}>Regenerate with these changes</button>}
        </div>
      )}

      <div className="section">
        <h3 style={{ cursor: 'pointer' }} onClick={() => setShowRules(!showRules)}>Rules and setbacks <span className="right small muted">{showRules ? 'hide' : 'show'}</span></h3>
        {showRules ? <RulesEditor rules={rules} onChange={(r) => {
          set({ rules: r, variants: variants.map((v) => reevaluate(ps, v, r)) });
        }} /> : <p className="small muted" style={{ margin: 0 }}>House {rules.houseFromSide} m from neighbours, {rules.houseFromRoad} m from the road; outbuildings {rules.outbuildingFromSide} m; sauna {rules.houseToSauna} m from the house. Typical Russian norms (SP 53.13330) — verify with local rules.</p>}
      </div>

      <div className="section">
        <h3>Variants <span className="right small muted">{variants.length ? 'click to view · ★ shortlist · ⊞ compare' : ''}</span></h3>
        {!variants.length && <p className="small muted">Variants appear here. Each one is placed inside the plot with the setbacks above and keeps clear of what is already there unless it can be removed.</p>}
        {ordered.map((v) => (
          <VariantCard key={v.id} site={site} v={v} active={v.id === active?.id} inCompare={compare.includes(v.id)} />
        ))}
      </div>

      {active && <VariantDetail v={active} />}
    </div>
  );
}

function VariantCard({ site, v, active, inCompare }: { site: SiteModel; v: Variant; active: boolean; inCompare: boolean }) {
  const { set, updateVariant, removeVariant, compare } = useStore();
  const fails = v.checks.filter((c) => !c.ok && c.severity === 'rule').length;
  const marg = v.checks.filter((c) => c.ok && c.marginal && c.severity === 'rule').length;
  return (
    <div className="vcard" aria-selected={active} onClick={() => set({ activeVariant: v.id, selection: null })} data-testid="variant-card">
      <div className="head">
        <b>{v.name}</b>{v.edited && <span className="small muted">edited</span>}
        <span style={{ marginLeft: 'auto' }} />
        {fails ? <span className="badge warn">{fails} rule{fails > 1 ? 's' : ''} broken</span> : marg ? <span className="badge marg">{marg} marginal</span> : <span className="badge">all rules met</span>}
        <button className="btn sm ghost" title="Shortlist" aria-pressed={!!v.starred} onClick={(e) => { e.stopPropagation(); updateVariant({ ...v, starred: !v.starred }); }}><Icon d={ICONS.star} size={14} /></button>
        <button className="btn sm ghost" title="Add to comparison" aria-pressed={inCompare} onClick={(e) => {
          e.stopPropagation();
          set({ compare: inCompare ? compare.filter((c) => c !== v.id) : [...compare, v.id].slice(-4) });
        }}>⊞</button>
      </div>
      <div className="body">
        <MiniPlan site={site} variant={v} />
        <div className="stats">
          <span>New footprint</span><span className="v">{v.metrics.footprint} m²</span>
          <span>Plot covered</span><span className="v">{v.metrics.coverage}%</span>
          <span>Largest open lawn</span><span className="v">{v.metrics.largestOpen} m²</span>
          {v.metrics.houseToForest !== null && <><span>House ↔ forest fence</span><span className="v">{v.metrics.houseToForest} m</span></>}
          {v.metrics.driveway !== null && <><span>Driveway</span><span className="v">{v.metrics.driveway} m</span></>}
          <span>Walk from gate</span><span className="v">{v.metrics.gateWalk} m</span>
          <span>Clears</span><span className="v">{v.metrics.removed.length}</span>
          <span>Matches brief</span><span className="v">{v.metrics.briefScore}%</span>
        </div>
      </div>
      <div className="sum">{v.summary}
        {!v.starred && <button className="btn sm ghost" style={{ float: 'right' }} title="Delete" onClick={(e) => { e.stopPropagation(); removeVariant(v.id); }}><Icon d={ICONS.trash} size={13} /></button>}
      </div>
    </div>
  );
}

function VariantDetail({ v }: { v: Variant }) {
  const set = useStore((s) => s.set);
  const rules = v.checks.filter((c) => c.severity === 'rule');
  const advice = v.checks.filter((c) => c.severity === 'advice');
  return (
    <div className="section">
      <h3>{v.name} · checks <span className="right"><button className="btn sm" onClick={() => set({ exportOpen: true })}><Icon d={ICONS.download} size={14} />Export</button></span></h3>
      <p className="small muted">Drag a building in the 3D view to move it (snaps to 25 cm), press R to rotate it. Numbers update when you let go.</p>
      <div className="checks">
        {rules.map((c) => (
          <div key={c.id} className={`check ${c.ok ? (c.marginal ? 'marg' : '') : 'fail'}`} title={c.marginal ? 'Passes, but by less than the survey uncertainty' : ''}>
            <span className="dot" /><span>{c.label}</span><span className="num">{c.detail}</span>
          </div>
        ))}
        {advice.map((c) => (
          <div key={c.id} className={`check adv ${c.ok ? '' : 'fail'}`}>
            <span className="dot" /><span>{c.label} <span className="muted">(advice)</span></span><span className="num">{c.detail}</span>
          </div>
        ))}
      </div>
      {v.metrics.removed.length > 0 && <div className="note" style={{ marginTop: 10 }}>Would clear: {v.metrics.removed.join(', ')}</div>}
    </div>
  );
}

function RulesEditor({ rules, onChange }: { rules: Rules; onChange: (r: Rules) => void }) {
  const row = (k: keyof Rules, label: string) => (
    <label className="opt" key={k}>
      <span style={{ flex: 1 }}>{label}</span>
      <input type="number" step={0.5} min={0} value={rules[k] as number} style={{ width: 60 }} className="num"
        onChange={(e) => onChange({ ...rules, [k]: Number(e.target.value) })} /> m
    </label>
  );
  return (
    <div className="small">
      {row('houseFromSide', 'House from neighbour / forest-side boundary')}
      {row('houseFromRoad', 'House from road boundary')}
      {row('outbuildingFromSide', 'Outbuildings from side boundaries')}
      {row('outbuildingFromRoad', 'Outbuildings from road boundary')}
      {row('houseToSauna', 'House ↔ sauna (sanitary)')}
      {row('betweenBuildings', 'Between buildings (access)')}
      {row('forestBuffer', 'Fire buffer from forest')}
      <label className="opt"><input type="checkbox" checked={rules.respectForestBuffer} onChange={(e) => onChange({ ...rules, respectForestBuffer: e.target.checked })} />
        Treat the forest buffer as a hard rule (managed forest land)</label>
      <p className="muted" style={{ margin: '6px 0 0' }}>Defaults follow SP 53.13330.2019 (p. 6.7–6.8) and SP 4.13130.2013 (p. 4.14). They are planning aids, not legal advice.</p>
    </div>
  );
}
