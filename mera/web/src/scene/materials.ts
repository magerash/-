import * as THREE from 'three';
import { MAT_COLORS, type MatKey } from './geometry';

const cache = new Map<string, THREE.Material>();

/** Matte, calm materials for proposed buildings; the selected one gets a faint accent glow. */
export function mat(key: MatKey, variant: 'solid' | 'highlight' = 'solid'): THREE.Material {
  const id = key + ':' + variant;
  let m = cache.get(id);
  if (m) return m;
  const sm = new THREE.MeshStandardMaterial({ color: new THREE.Color(MAT_COLORS[key]), roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  if (key === 'glass') { sm.transparent = true; sm.opacity = 0.42; sm.roughness = 0.3; sm.depthWrite = false; }
  if (key === 'water') { sm.transparent = true; sm.opacity = 0.8; sm.roughness = 0.2; }
  if (variant === 'highlight') { sm.emissive = new THREE.Color('#2c666b'); sm.emissiveIntensity = 0.18; }
  sm.polygonOffset = true;
  sm.polygonOffsetFactor = 1;
  sm.polygonOffsetUnits = 1;
  m = sm;
  cache.set(id, m);
  return m;
}

const lineCache = new Map<string, THREE.LineBasicMaterial | THREE.LineDashedMaterial>();
export function lineMat(color: string, dashed = false, opacity = 1): THREE.LineBasicMaterial | THREE.LineDashedMaterial {
  const id = `${color}:${dashed}:${opacity}`;
  let m = lineCache.get(id);
  if (!m) {
    m = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.45, gapSize: 0.3, transparent: opacity < 1, opacity })
      : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    lineCache.set(id, m);
  }
  return m;
}

export const COLORS = {
  accent: '#2c666b',
  stated: '#3a5a96',
  recon: '#2f7a4f',
  inferred: '#a8741f',
  warn: '#b0452c',
  ink: '#1d2320',
  edge: '#3b3f3c',
};
