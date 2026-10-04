// Variants are the owner's own layouts. One starts empty; buildings are added from the catalogue
// or from a plain-words description, then moved, resized or removed. Mera only proposes a spot
// for each newly added building; it never generates layouts on its own.
import type { BuildType, Metrics, Placed, Program, ProgramItem, Rules, Variant, Zone } from '../types';
import { CATALOG } from './catalog';
import type { PlanSite } from './metrics';
import { makePlaced, reevaluate } from './solver';

export const emptyProgram = (): Program => ({ items: [], keep: [], clear: [], notes: [], unparsed: [] });

export const EMPTY_METRICS: Metrics = {
  footprint: 0, coverage: 0, openArea: 0, largestOpen: 0, houseToForest: null, houseToRoad: null,
  gateWalk: 0, driveway: null, removed: [], briefScore: 0, checksPassed: 0, checksTotal: 0,
};

export function nextVariantName(variants: Variant[]): string {
  const taken = new Set(variants.map((v) => v.name));
  let n = variants.length + 1;
  for (let k = 1; k <= variants.length + 1; k++) if (!taken.has(`Variant ${k}`)) { n = k; break; }
  return `Variant ${n}`;
}

const newId = () => `v-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export function summarize(v: Pick<Variant, 'placed'>): string {
  if (!v.placed.length) return 'No buildings yet';
  const counts = new Map<string, number>();
  for (const p of v.placed) counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
  return [...counts].map(([l, n]) => (n > 1 ? `${n} × ${l}` : l)).join(', ');
}

/** Re-runs every check and refreshes the summary. */
export function refresh(site: PlanSite, v: Variant, rules: Rules): Variant {
  const r = reevaluate(site, v, rules);
  return { ...r, summary: summarize(r) };
}

/** A saved variant only needs its buildings; everything derived is recomputed. */
export function rehydrate(site: PlanSite, saved: Partial<Variant> & Pick<Variant, 'id' | 'name' | 'program' | 'placed'>, rules: Rules): Variant {
  const base: Variant = { summary: '', brief: '', createdAt: '', removed: [], paths: [], checks: [], metrics: EMPTY_METRICS, ...saved };
  return refresh(site, base, rules);
}

export function createVariant(site: PlanSite, rules: Rules, existing: Variant[]): Variant {
  return refresh(site, {
    id: newId(), name: nextVariantName(existing), summary: '', brief: '',
    program: emptyProgram(), placed: [], removed: [], paths: [], metrics: EMPTY_METRICS, checks: [],
    createdAt: new Date().toISOString(),
  }, rules);
}

export function duplicateVariant(site: PlanSite, rules: Rules, v: Variant): Variant {
  const copy: Variant = JSON.parse(JSON.stringify(v));
  return refresh(site, { ...copy, id: newId(), name: `${v.name} copy`, createdAt: new Date().toISOString() }, rules);
}

export function labelFor(type: BuildType, storeys: number): string {
  return CATALOG[type].label + (storeys === 1.5 ? ' with attic' : storeys > 1 ? ` · ${storeys} storeys` : '');
}

export function catalogItem(type: BuildType): ProgramItem {
  const spec = CATALOG[type];
  return {
    id: type, type, label: spec.label, storeys: 1, w: spec.w, d: spec.d,
    zone: spec.defaultZone as Zone, sizeFromBrief: false, phrase: 'added from the list',
  };
}

/**
 * Adds items to a variant's program with ids that are unique inside the variant (briefs parsed
 * in different sessions restart their numbering). Returns the merged program and the new ids.
 */
export function mergeItems(base: Program, incoming: Program): { program: Program; added: string[] } {
  const used = new Set(base.items.map((i) => i.id));
  const remap = new Map<string, string>();
  const items: ProgramItem[] = [];
  for (const it of incoming.items) {
    let k = 1;
    while (used.has(`${it.type}-${k}`)) k++;
    const id = `${it.type}-${k}`;
    used.add(id);
    remap.set(it.id, id);
    items.push({ ...it, id });
  }
  for (const it of items) if (it.near && remap.has(it.near)) it.near = remap.get(it.near);
  const uniq = (a: string[]) => [...new Set(a)];
  return {
    program: {
      items: [...base.items, ...items],
      keep: uniq([...base.keep, ...incoming.keep]),
      clear: uniq([...base.clear.filter((id) => !incoming.keep.includes(id)), ...incoming.clear]),
      notes: incoming.notes,
      unparsed: incoming.unparsed,
    },
    added: items.map((i) => i.id),
  };
}

export function removeItem(site: PlanSite, rules: Rules, v: Variant, itemId: string): Variant {
  return refresh(site, {
    ...v,
    program: { ...v.program, items: v.program.items.filter((i) => i.id !== itemId).map((i) => (i.near === itemId ? { ...i, near: undefined } : i)) },
    placed: v.placed.filter((p) => p.itemId !== itemId),
  }, rules);
}

/** Changes a building's type, size or storeys in place, keeping its centre and orientation. */
export function updateItem(site: PlanSite, rules: Rules, v: Variant, itemId: string, patch: Partial<Pick<ProgramItem, 'type' | 'w' | 'd' | 'storeys'>>): Variant {
  const old = v.program.items.find((i) => i.id === itemId);
  if (!old) return v;
  const it: ProgramItem = { ...old, ...patch };
  if (patch.type && patch.type !== old.type) {
    it.w = patch.w ?? CATALOG[patch.type].w;
    it.d = patch.d ?? CATALOG[patch.type].d;
    if (CATALOG[patch.type].storeyHeight === 0) it.storeys = 1;
    it.sizeFromBrief = false;
  }
  it.label = labelFor(it.type, it.storeys);
  const placed = v.placed.map((p): Placed => (p.itemId === itemId ? makePlaced(it, p.u, p.v, CATALOG[it.type].vehicle ? 0 : p.rot) : p));
  return refresh(site, { ...v, program: { ...v.program, items: v.program.items.map((i) => (i.id === itemId ? it : i)) }, placed }, rules);
}
