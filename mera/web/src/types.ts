// Site coordinates: u = across the plot (m, 0 at the left fence when standing at the road
// facing the forest), v = depth (m, 0 at the road boundary, increasing toward the forest).
// three.js world: x = u, y = up, z = -v.  All values are meters.

export type Vec2 = [number, number];

/**
 * How a piece of geometry is known, most to least certain:
 * reconstructed = fitted to 3D points from the video; located = measured from the frames
 * (ground hits, triangulation); inferred = approximate, from frames and narration;
 * given = supplied with the job (plot dimensions); narration = said in the video by its author.
 */
export type Provenance = 'reconstructed' | 'located' | 'inferred' | 'given' | 'narration';

export interface Evidence {
  frames?: string[]; // keyframe ids that show it
  segments?: number[]; // transcript segment indices that mention it
  points?: number; // supporting SfM points
  note?: string;
}

export interface BoundaryEdge {
  id: 'road' | 'forest' | 'left' | 'right';
  a: Vec2;
  b: Vec2;
  statedLength: [number, number] | null; // supplied range, m
  modelLength: number; // length of this side in the model, m
  reconstructedLength?: number; // fence length measured in the reconstruction, m
  rawResidual: number; // positional uncertainty of this side, m
  method?: string;
  style?: string; // fence type
  how?: string; // how the fence line was measured
  switchAt?: number;
}

export interface FenceLine {
  id: string;
  a: Vec2;
  b: Vec2;
  method: string;
  points?: number;
  label?: string;
}

export interface Terrain {
  /** height = h0 + gu*u + gv*v (+ optional grid) */
  h0: number;
  gu: number;
  gv: number;
  provenance: Provenance;
  slopePct: number;
  fallDirectionDeg: number; // 0 = toward forest (+v), 90 = toward right (+u)
  heightUncertainty: number;
  grid?: { nu: number; nv: number; du: number; dv: number; h: number[] };
  note: string;
}

export type ElementKind =
  | 'house' | 'sauna' | 'shed' | 'greenhouse' | 'deck' | 'parking' | 'beds' | 'tilled'
  | 'tree' | 'tank' | 'trampoline' | 'gate' | 'rockgarden' | 'woodpile' | 'other';

export interface SiteElement {
  id: string;
  kind: ElementKind;
  label: string;
  detail?: string; // one line for the owner
  center?: Vec2;
  size?: [number, number];
  angle?: number;
  how?: string; // how its position was checked against the frames (detail layer)
  outside?: boolean; // stands (mostly) outside the boundary
  parent?: string;
  /** footprint polygon in site coords (closed implicitly) */
  footprint: Vec2[];
  height: number; // eave / top height above local ground, m
  ridge?: number; // ridge height for pitched roofs
  roof?: 'gable' | 'shed' | 'flat' | 'arch' | 'none';
  round?: boolean;
  ridgeAxis?: 'u' | 'v';
  storeys?: number;
  provenance: Provenance;
  uncertainty: number; // +- m on position
  evidence: Evidence;
  removable: boolean; // may a variant clear it?
  note?: string;
}

export interface CameraPose {
  id: string; // keyframe id
  clip: string;
  t: number;
  pos: [number, number, number]; // world (x,y,z) meters
  quat: [number, number, number, number]; // world-from-camera, three.js camera convention (looks -z)
  fovY: number; // degrees
  aspect: number;
  approx?: boolean; // pose from a weaker merged sub-model (orientation may be off by a few degrees)
}

export interface VoicePin {
  segment: number;
  kind: string;
  label: string;
  quote: string;
  clip: string;
  t: number;
  pos: [number, number, number];
  dir: [number, number, number];
  frame: string;
}

export interface ScaleCheck {
  label: string;
  expected: [number, number];
  measured: number;
  ok: boolean;
  note?: string;
}

export interface Tree {
  id: string;
  species: 'birch' | 'conifer' | 'fruit' | 'deciduous';
  at: Vec2;
  height: number;
  crown: number;
  how: string;
  provenance: Provenance;
}

export interface SiteModel {
  id: string;
  name: string;
  units: 'm';
  createdAt: string;
  plot: {
    width: number; // along the road (longest side)
    depth: number; // road -> forest
    statedWidth: [number, number];
    statedDepth: [number, number];
    polygon?: Vec2[];
    edges: BoundaryEdge[];
    fences?: FenceLine[];
    reconstructedSize?: [number, number];
    entrance: { u: number; width: number; provenance: Provenance; evidence: Evidence };
    note?: string;
  };
  trees?: Tree[];
  model?: { url: string };
  warp?: { recQuad: Vec2[]; modelQuad: Vec2[]; maxShift: number; reconstructedWidth: number[]; reconstructedDepth: number[] };
  terrain: Terrain;
  elements: SiteElement[];
  zones: { id: string; label: string; polygon: Vec2[]; provenance: Provenance; note: string; evidence: Evidence }[];
  context: { forestDepth: number; forestHeight: number; roadWidth: number; provenance: Provenance; note: string };
  scale: {
    method: string;
    metersPerUnit: number;
    aspectFit: number;
    aspectStated: number;
    checks: ScaleCheck[];
    expectedAccuracy: string;
  };
  reconstruction: {
    frames: number;
    registered: number;
    points: number;
    reprojectionError: number;
    clips: { id: string; registered: number; total: number }[];
    gravity: string;
  };
  cameras: CameraPose[];
  pins: VoicePin[];
  pointcloud: { url: string; count: number } | null;
  conflicts: { topic: string; detail: string; resolution: string }[];
  sourceClips: Record<string, string>; // input file -> clip id
  transcriptGloss?: Record<string, string>; // segment index -> English (analyst translation)
}

export interface Transcript {
  language: string;
  primary_model: string;
  segments: { source: string; t0: number; t1: number; text: string; alt?: string; whisper?: string; gigaam?: string }[];
}

export interface FrameInfo {
  id: string;
  clip: string;
  t: number;
  sharpness: number;
}

// ---------- planning ----------

export type BuildType =
  | 'house' | 'garage' | 'carport' | 'sauna' | 'guesthouse' | 'shed' | 'workshop' | 'greenhouse'
  | 'gazebo' | 'pool' | 'garden' | 'parking' | 'playground' | 'terrace';

export type Zone = 'forest' | 'road' | 'center' | 'left' | 'right' | 'entrance' | 'corner' | 'any';

export interface ProgramItem {
  id: string;
  type: BuildType;
  label: string;
  storeys: number;
  w: number; // along u before rotation
  d: number; // along v before rotation
  zone: Zone;
  zone2?: Zone; // optional secondary preference, e.g. forest + right
  near?: string; // id of another item it should be close to
  sizeFromBrief: boolean;
  phrase: string; // the words it came from
}

export interface Program {
  items: ProgramItem[];
  keep: string[]; // existing element ids explicitly kept
  clear: string[]; // existing element ids the brief asks to remove
  notes: string[]; // interpretation notes shown to the owner
  unparsed: string[];
}

export interface Placed {
  itemId: string;
  type: BuildType;
  label: string;
  u: number; // center
  v: number;
  w: number; // extents along u / v after rotation
  d: number;
  rot: 0 | 90;
  storeys: number;
  height: number;
  ridge: number;
  roof: 'gable' | 'shed' | 'flat' | 'none';
}

export interface Check {
  id: string;
  label: string;
  severity: 'rule' | 'advice';
  ok: boolean;
  detail: string;
  value?: number;
  limit?: number;
  marginal?: boolean; // passes, but by less than the reconstruction uncertainty
}

export interface Metrics {
  footprint: number;
  coverage: number;
  openArea: number;
  largestOpen: number;
  houseToForest: number | null;
  houseToRoad: number | null;
  gateWalk: number;
  driveway: number | null;
  removed: string[];
  briefScore: number;
  checksPassed: number;
  checksTotal: number;
}

export interface Variant {
  id: string;
  name: string;
  summary: string;
  brief: string;
  program: Program;
  placed: Placed[];
  removed: string[];
  paths: Vec2[][];
  metrics: Metrics;
  checks: Check[];
  createdAt: string;
}

export interface Rules {
  houseFromSide: number;
  houseFromRoad: number;
  outbuildingFromSide: number;
  outbuildingFromRoad: number;
  houseToSauna: number;
  betweenBuildings: number;
  forestBuffer: number; // advisory
  respectForestBuffer: boolean;
}
