import { useMemo, useState } from 'react';
import { useStore, activeVariantOf } from '../store';
import type { BuildType, Program, Rules, SiteModel, Variant } from '../types';
import { parseBrief } from '../plan/brief';
import { CATALOG } from '../plan/catalog';
import { cornerReport } from '../plan/solver';
import { place } from '../plan/runSolver';
import { planSite } from '../plan/metrics';
import { catalogItem, createVariant, duplicateVariant, mergeItems, refresh, removeItem, updateItem } from '../plan/variants';
import MiniPlan from './MiniPlan';
import { Icon, ICONS } from './common';

const EXAMPLES = [
  'A two-storey house near the forest, a garage and a sauna by the road',
  'Pool and gazebo in the middle, keep the garden beds',
  'Guest house 6x6 in the corner behind the sauna, remove the old sheds',
  'Двухэтажный дом у леса, гараж и баня у дороги',
];

const TYPES = Object.keys(CATALOG) as BuildType[];

export default function PlanPanel({ site }: { site: SiteModel }) {
  const { variants, activeVariant, rules, compare, set } = useStore();
  const ps = useMemo(() => planSite(site), [site]);
  const [showRules, setShowRules] = useState(false);
  const active = activeVariantOf({ variants, activeVariant });

  const startVariant = () => {
    const v = createVariant(ps, rules, variants);
    set({ variants: [...variants, v], activeVariant: v.id, selection: null });
    setTimeout(() => document.querySelector('[data-testid=variant-editor]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <div>
      <div className="section">
        <h3>Your variants <span className="right small muted">{variants.length ? 'click to open · ⊞ compare' : ''}</span></h3>
        {!variants.length && (
          <p className="small muted">
            A variant is your own layout for the plot. Start one, then add buildings from the list or describe them in words.
            Each new building is placed inside the plot with the setbacks below; drag it to move it, press R to rotate it.
          </p>
        )}
        {variants.map((v) => (
          <VariantCard key={v.id} site={site} v={v} active={v.id === active?.id} inCompare={compare.includes(v.id)} />
        ))}
        <button className="btn primary" style={{ marginTop: 10 }} onClick={startVariant}><Icon d={ICONS.plus} size={14} />New variant</button>
      </div>

      {active && <VariantEditor key={active.id} site={site} v={active} />}

      <div className="section">
        <h3 style={{ cursor: 'pointer' }} onClick={() => setShowRules(!showRules)}>Rules and setbacks <span className="right small muted">{showRules ? 'hide' : 'show'}</span></h3>
        {showRules ? <RulesEditor rules={rules} onChange={(r) => {
          set({ rules: r, variants: variants.map((v) => refresh(ps, v, r)) });
        }} /> : <p className="small muted" style={{ margin: 0 }}>House {rules.houseFromSide} m from neighbours, {rules.houseFromRoad} m from the road; outbuildings {rules.outbuildingFromSide} m; sauna {rules.houseToSauna} m from the house. Typical Russian norms (SP 53.13330) — verify with local rules.</p>}
      </div>
    </div>
  );
}

function VariantCard({ site, v, active, inCompare }: { site: SiteModel; v: Variant; active: boolean; inCompare: boolean }) {
  const { set, compare } = useStore();
  const fails = v.checks.filter((c) => !c.ok && c.severity === 'rule').length;
  const marg = v.checks.filter((c) => c.ok && c.marginal && c.severity === 'rule').length;
  return (
    <div className="vcard" aria-selected={active} onClick={() => set({ activeVariant: v.id, selection: null })} data-testid="variant-card">
      <div className="head">
        <b>{v.name}</b>
        <span style={{ marginLeft: 'auto' }} />
        {!v.placed.length ? <span className="badge">empty</span> : fails ? <span className="badge warn">{fails} rule{fails > 1 ? 's' : ''} broken</span> : marg ? <span className="badge marg">{marg} marginal</span> : <span className="badge">all rules met</span>}
        <button className="btn sm ghost" title="Add to comparison" aria-label={`Compare ${v.name}`} aria-pressed={inCompare} onClick={(e) => {
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
          {v.placed.length > 0 && <><span>Walk from gate</span><span className="v">{v.metrics.gateWalk} m</span></>}
          <span>Affects existing</span><span className="v">{v.metrics.removed.length}</span>
        </div>
      </div>
      <div className="sum">{v.summary}</div>
    </div>
  );
}

function VariantEditor({ site, v }: { site: SiteModel; v: Variant }) {
  const { variants, rules, brief, selection, set, updateVariant, removeVariant } = useStore();
  const ps = useMemo(() => planSite(site), [site]);
  const [addType, setAddType] = useState<BuildType>('house');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Program | null>(null);
  const corner = site.zones.find((z) => z.id === 'build-corner');
  const cornerNotes = useMemo(() => (last && corner ? cornerReport(ps, last, rules, corner.polygon) : []), [last, corner, ps, rules]);

  // place new buildings around the ones already in the variant, which stay where they are
  const addProgram = (incoming: Program, text: string) => {
    const { program, added } = mergeItems(v.program, incoming);
    if (!added.length) {
      updateVariant(refresh(ps, { ...v, program }, rules));
      return;
    }
    setBusy(true);
    place(ps, program, v.placed, rules, 1 + v.program.items.length).then((placed) => {
      const cur = useStore.getState().variants.find((x) => x.id === v.id) ?? v;
      const fresh = placed.filter((p) => added.includes(p.itemId));
      const next = refresh(ps, { ...cur, program, placed: [...cur.placed, ...fresh], brief: text ? [cur.brief, text].filter(Boolean).join('\n') : cur.brief }, rules);
      useStore.getState().updateVariant(next);
      set({ selection: { kind: 'placed', id: added[added.length - 1] } });
    }).finally(() => setBusy(false));
  };
  const describe = () => {
    const prog = parseBrief(brief, ps.existing);
    setLast(prog);
    if (prog.items.length || prog.keep.length || prog.clear.length) addProgram(prog, brief.trim());
  };
  const addOne = () => {
    setLast(null);
    addProgram({ items: [catalogItem(addType)], keep: [], clear: [], notes: [], unparsed: [] }, '');
  };

  const ruleChecks = v.checks.filter((c) => c.severity === 'rule');
  const advice = v.checks.filter((c) => c.severity === 'advice');
  return (
    <>
      <div className="section" data-testid="variant-editor">
        <h3>
          <input className="name-input" value={v.name} aria-label="Variant name" onChange={(e) => updateVariant({ ...v, name: e.target.value })} />
          <span className="right" style={{ display: 'flex', gap: 4 }}>
            <button className="btn sm ghost" title="Duplicate" aria-label="Duplicate variant" onClick={() => {
              const c = duplicateVariant(ps, rules, v);
              set({ variants: [...variants, c], activeVariant: c.id, selection: null });
            }}><Icon d={ICONS.copy} size={14} /></button>
            <button className="btn sm ghost" title="Delete variant" aria-label="Delete variant" onClick={() => removeVariant(v.id)}><Icon d={ICONS.trash} size={14} /></button>
            <button className="btn sm" onClick={() => set({ exportOpen: true })}><Icon d={ICONS.download} size={14} />Export</button>
          </span>
        </h3>
        {!v.program.items.length && <p className="small muted">No buildings yet. Add one from the list or describe what you want below.</p>}
        {v.program.items.map((it) => {
          const sel = selection?.kind === 'placed' && selection.id === it.id;
          return (
            <div key={it.id} className={`item${sel ? ' sel' : ''}`} data-testid="building-row" onClick={() => set({ selection: { kind: 'placed', id: it.id } })}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                <select value={it.type} onChange={(e) => updateVariant(updateItem(ps, rules, v, it.id, { type: e.target.value as BuildType }))} aria-label="type">
                  {TYPES.map((t) => <option key={t} value={t}>{CATALOG[t].label}</option>)}
                </select>
                {CATALOG[it.type].storeyHeight > 0 && it.type !== 'greenhouse' && (
                  <select value={it.storeys} onChange={(e) => updateVariant(updateItem(ps, rules, v, it.id, { storeys: Number(e.target.value) }))} aria-label="storeys">
                    <option value={1}>1 storey</option>
                    <option value={1.5}>attic</option>
                    <option value={2}>2 storeys</option>
                    <option value={3}>3 storeys</option>
                  </select>
                )}
              </div>
              <button className="btn sm ghost" title="Remove building" aria-label={`Remove ${it.label}`} onClick={(e) => { e.stopPropagation(); updateVariant(removeItem(ps, rules, v, it.id)); }}><Icon d={ICONS.close} size={14} /></button>
              <div className="meta" onClick={(e) => e.stopPropagation()}>
                <input type="number" step={0.5} min={1} value={it.w} onChange={(e) => updateVariant(updateItem(ps, rules, v, it.id, { w: Math.max(1, Number(e.target.value)) }))} aria-label="width" />×
                <input type="number" step={0.5} min={1} value={it.d} onChange={(e) => updateVariant(updateItem(ps, rules, v, it.id, { d: Math.max(1, Number(e.target.value)) }))} aria-label="depth" /> m
                {!it.sizeFromBrief && <span className="muted" title="Typical size; edit if you know better">typical size</span>}
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
          <select value={addType} onChange={(e) => setAddType(e.target.value as BuildType)} aria-label="Building to add" className="select">
            {TYPES.map((t) => <option key={t} value={t}>{CATALOG[t].label} · {CATALOG[t].w}×{CATALOG[t].d} m</option>)}
          </select>
          <button className="btn" onClick={addOne} disabled={busy}><Icon d={ICONS.plus} size={14} />Add</button>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Drag a building in the 3D view to move it (snaps to 25 cm). R rotates it, Delete removes it.</p>
      </div>

      <div className="section">
        <h3>Or describe it in words</h3>
        <textarea className="textarea" value={brief} placeholder='e.g. "a two-storey house near the forest, a garage and a sauna by the road"'
          onChange={(e) => set({ brief: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) describe(); }} aria-label="Building brief" />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <button className="btn primary" onClick={describe} disabled={!brief.trim() || busy}>{busy ? 'Placing…' : 'Add to this variant'}</button>
          <span className="small muted">English or Russian · Ctrl+Enter</span>
        </div>
        <div className="examples">
          {EXAMPLES.map((x) => <button key={x} onClick={() => set({ brief: x })}>{x}</button>)}
        </div>
        {last && last.notes.map((n) => <div key={n} className="note">{n}</div>)}
        {cornerNotes.map((n) => <div key={n} className={`note ${n.includes('does not') ? 'warn' : ''}`}>{n}</div>)}
        {last && last.unparsed.map((u) => <div key={u} className="note warn">Not understood: “{u}”. Rephrase it or add it from the list.</div>)}
      </div>

      {v.placed.length > 0 && (
        <div className="section">
          <h3>Checks</h3>
          <div className="checks">
            {ruleChecks.map((c) => (
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
          {v.metrics.removed.length > 0 && <div className="note" style={{ marginTop: 10 }}>Would clear or take: {v.metrics.removed.join(', ')}</div>}
        </div>
      )}
    </>
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
