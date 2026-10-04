import { create } from 'zustand';
import type { FrameInfo, Program, Rules, SiteModel, Transcript, Variant } from './types';
import { DEFAULT_RULES } from './plan/catalog';

export type Mode = 'site' | 'plan' | 'compare';
export type ViewMode = 'orbit' | 'top' | 'walk';
export type Tool = 'none' | 'measure';

export interface Measurement {
  id: number;
  a: [number, number, number];
  b: [number, number, number];
  snappedA?: string;
  snappedB?: string;
}

export interface Layers {
  points: boolean;
  cameras: boolean;
  pins: boolean;
  existing: boolean;
  uncertainty: boolean;
  labels: boolean;
  context: boolean;
  grid: boolean;
}

export interface Selection {
  kind: 'element' | 'camera' | 'pin' | 'placed' | 'edge';
  id: string;
}

interface State {
  projectId: string;
  site: SiteModel | null;
  transcript: Transcript | null;
  frames: FrameInfo[];
  loadError: string | null;
  mode: Mode;
  view: ViewMode;
  tool: Tool;
  layers: Layers;
  selection: Selection | null;
  photo: { frameId: string; aligned: boolean; opacity: number } | null;
  measurements: Measurement[];
  pendingPoint: [number, number, number] | null;
  pendingLabel: string | null;
  variants: Variant[];
  activeVariant: string | null;
  compare: string[];
  rules: Rules;
  brief: string;
  program: Program | null;
  programDirty: boolean;
  sun: { on: boolean; northDeg: number | null; lat: number; month: number; hour: number };
  exportOpen: boolean;
  dragging: string | null;
  cameraRequest: { kind: 'top' | 'home' | 'focus'; at: number; target?: [number, number, number]; radius?: number } | null;
  set: (p: Partial<State>) => void;
  toggleLayer: (k: keyof Layers) => void;
  addMeasurement: (m: Omit<Measurement, 'id'>) => void;
  upsertVariants: (vs: Variant[]) => void;
  updateVariant: (v: Variant) => void;
  removeVariant: (id: string) => void;
}

let mid = 1;

export const useStore = create<State>((set) => ({
  projectId: 'plot',
  site: null,
  transcript: null,
  frames: [],
  loadError: null,
  mode: 'site',
  view: 'orbit',
  tool: 'none',
  layers: { points: true, cameras: false, pins: true, existing: true, uncertainty: true, labels: true, context: true, grid: true },
  selection: null,
  photo: null,
  measurements: [],
  pendingPoint: null,
  pendingLabel: null,
  variants: [],
  activeVariant: null,
  compare: [],
  rules: DEFAULT_RULES,
  brief: '',
  program: null,
  programDirty: false,
  sun: { on: false, northDeg: null, lat: 56.8, month: 6, hour: 14 },
  exportOpen: false,
  dragging: null,
  cameraRequest: null,
  set: (p) => set(p),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, { ...m, id: mid++ }], pendingPoint: null, pendingLabel: null })),
  upsertVariants: (vs) => set((s) => {
    const keep = s.variants.filter((v) => v.starred || v.edited);
    const ids = new Set(vs.map((v) => v.id));
    return { variants: [...keep.filter((v) => !ids.has(v.id)), ...vs] };
  }),
  updateVariant: (v) => set((s) => ({ variants: s.variants.map((x) => (x.id === v.id ? v : x)) })),
  removeVariant: (id) => set((s) => ({
    variants: s.variants.filter((v) => v.id !== id),
    compare: s.compare.filter((c) => c !== id),
    activeVariant: s.activeVariant === id ? null : s.activeVariant,
  })),
}));

export const activeVariantOf = (s: { variants: Variant[]; activeVariant: string | null }) =>
  s.variants.find((v) => v.id === s.activeVariant) ?? null;

// automation / debugging handle (read-only use by the browser journeys)
if (typeof window !== 'undefined') (window as unknown as { __meraStore: typeof useStore }).__meraStore = useStore;
