import { create } from 'zustand';
import type { FrameInfo, Rules, SiteModel, Transcript, Variant } from './types';
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

/** Detail layers: all off on first open, so the model is all you see. */
export interface Layers {
  labels: boolean; // names of structures
  dimensions: boolean; // boundary lengths and plot outline
  survey: boolean; // how each thing was located, accuracy, survey notes
  accuracy: boolean; // uncertainty halos, coloured by how each thing is known
  points: boolean; // reconstruction points
  photos: boolean; // where the frames were shot
  narration: boolean; // the author's remarks where they were said
  grid: boolean; // 1 / 5 / 10 m grid
}

export interface Selection {
  kind: 'element' | 'tree' | 'camera' | 'pin' | 'placed' | 'edge';
  id: string;
}

interface State {
  projectId: string;
  site: SiteModel | null;
  transcript: Transcript | null;
  frames: FrameInfo[];
  loadError: string | null;
  modelError: string | null; // the 3D model could not be loaded
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
  exportOpen: boolean;
  dragging: string | null;
  cameraRequest: { kind: 'top' | 'home' | 'focus'; at: number; target?: [number, number, number]; radius?: number } | null;
  set: (p: Partial<State>) => void;
  toggleLayer: (k: keyof Layers) => void;
  addMeasurement: (m: Omit<Measurement, 'id'>) => void;
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
  modelError: null,
  mode: 'site',
  view: 'orbit',
  tool: 'none',
  layers: { labels: false, dimensions: false, survey: false, accuracy: false, points: false, photos: false, narration: false, grid: false },
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
  exportOpen: false,
  dragging: null,
  cameraRequest: null,
  set: (p) => set(p),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, { ...m, id: mid++ }], pendingPoint: null, pendingLabel: null })),
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
