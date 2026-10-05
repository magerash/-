// The textured site model (site/model.gltf.json, built by pipeline/model.py) and what the viewer
// adds on top of it: picking, hover, and hiding whatever a variant clears.
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ThreeEvent } from '@react-three/fiber';
import type { SiteModel as Site, Variant } from '../types';
import { useStore, type Selection } from '../store';
import { api } from '../api';
import { base64Bytes, packGLB, type GltfJson } from './glb';

const cache = new Map<string, Promise<GLTF>>();

/** Loads and caches the model; every view (and the exporter) gets the same parsed glTF. */
export function loadSiteModel(pid: string, site: Site): Promise<GLTF> {
  const url = api.file(pid, site.model!.url);
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const json: GltfJson = await r.json();
      const base = url.slice(0, url.lastIndexOf('/') + 1);
      // geometry is embedded as base64; unpack it here, since hosts may refuse to fetch data: URLs
      const b0 = json.buffers?.[0];
      const gltf = typeof b0?.uri === 'string' && b0.uri.startsWith('data:')
        ? await new GLTFLoader().parseAsync(packGLB(json, base64Bytes(b0.uri.slice(b0.uri.indexOf(',') + 1))), base)
        : await new GLTFLoader().parseAsync(JSON.stringify(json), base);
      gltf.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!m) return;
        // photo surfaces show the footage as filmed: no tone mapping, no lighting
        if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial) m.toneMapped = false;
        const map = (m as THREE.MeshBasicMaterial).map;
        if (map) map.anisotropy = 8;
      });
      return gltf;
    })();
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/** Which surveyed thing a model node stands for, from the node's extras (kind, id, edge). */
export function pickOf(o: THREE.Object3D): Selection | null {
  const d = o.userData as { kind?: string; id?: string; edge?: string };
  if (d.kind === 'tree' && d.id) return { kind: 'tree', id: d.id };
  if (d.kind === 'fence' && d.edge) return { kind: 'edge', id: d.edge };
  if (d.id && d.kind !== 'terrain' && d.kind !== 'scenery') return { kind: 'element', id: d.id };
  return null;
}

/** Scenery around the plot (surroundings, forest backdrop): looked at, not picked or exported. */
export const isScenery = (o: THREE.Object3D) => (o.userData as { kind?: string }).kind === 'scenery';

function pickTarget(o: THREE.Object3D | null): Selection | null {
  for (let n = o; n; n = n.parent) {
    const p = pickOf(n);
    if (p) return p;
  }
  return null;
}

export function SiteModelView({ site, variant, interactive }: { site: Site; variant: Variant | null; interactive: boolean }) {
  const pid = useStore((s) => s.projectId);
  const set = useStore((s) => s.set);
  const [gltf, setGltf] = useState<GLTF | null>(null);
  useEffect(() => {
    let alive = true;
    loadSiteModel(pid, site).then((g) => alive && setGltf(g)).catch((e) => {
      console.warn('site model:', e);
      if (alive) set({ modelError: (e as Error).message ?? String(e) });
    });
    return () => { alive = false; };
  }, [pid, site]);
  // each view gets its own node tree; geometry, materials and textures are shared
  const root = useMemo(() => gltf?.scene.clone(true) ?? null, [gltf]);
  useEffect(() => {
    if (!root) return;
    const removed = new Set(variant?.removed ?? []);
    for (const node of root.children) {
      const p = pickOf(node);
      if (p && (p.kind === 'element' || p.kind === 'tree')) node.visible = !removed.has(p.id);
      if (isScenery(node)) node.traverse((o) => { o.raycast = () => {}; });
    }
  }, [root, variant]);
  if (!root) return null;
  if (!interactive) return <primitive object={root} />;
  const mode = () => useStore.getState();
  return (
    <primitive object={root}
      onClick={(ev: ThreeEvent<MouseEvent>) => {
        if (mode().tool !== 'none' || mode().dragging || ev.delta > 4) return;
        // nearest surface decides: a click on open ground clears the selection
        ev.stopPropagation();
        set({ selection: pickTarget(ev.object) });
      }}
      onPointerOver={(ev: ThreeEvent<PointerEvent>) => {
        if (mode().tool !== 'none') return;
        const t = pickTarget(ev.object);
        if (t) { ev.stopPropagation(); document.body.style.cursor = 'pointer'; }
      }}
      onPointerOut={() => { document.body.style.cursor = ''; }} />
  );
}
