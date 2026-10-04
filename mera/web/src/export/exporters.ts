// Textured GLB, OBJ + MTL + JPEG, and PLY export at true metric scale.
// The export is built from the same textured model the viewer shows (site/model.gltf.json), minus
// the scenery around the plot, plus the buildings and paths of a variant.
// glTF is meters and Y-up by specification; OBJ carries no units, so the archive states them.
// Blender: File > Import > glTF or Wavefront (defaults) -> 1 Blender unit = 1 m, Z-up.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import JSZip from 'jszip';
import type { SiteModel, Variant } from '../types';
import { STATIC, fetchBinary, hostSave } from '../host';
import { api } from '../api';
import { isScenery, loadSiteModel, pickOf } from '../scene/SiteModel';
import { MAT_COLORS, placedParts, ribbon, type MatKey, type Part } from '../scene/geometry';

export interface ExportOptions {
  includeExisting: boolean;
  includeRemoved: boolean;
  includePaths: boolean;
}

function plainMaterials() {
  const cache = new Map<MatKey, THREE.MeshStandardMaterial>();
  return (k: MatKey) => {
    if (!cache.has(k)) {
      const m = new THREE.MeshStandardMaterial({ color: MAT_COLORS[k], roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
      m.name = k;
      if (k === 'glass' || k === 'water') { m.transparent = true; m.opacity = 0.55; }
      cache.set(k, m);
    }
    return cache.get(k)!;
  };
}

const hasAlpha = (m: THREE.Material) => m.alphaTest > 0 || m.transparent;

/**
 * Export scene: groups Terrain, Fences, Existing, Proposed, Paths; one named node per thing.
 * Geometry, materials and textures are shared with the viewer's model.
 */
export async function buildExportScene(pid: string, site: SiteModel, variant: Variant | null, opt: ExportOptions): Promise<THREE.Scene> {
  const gltf = await loadSiteModel(pid, site);
  const scene = new THREE.Scene();
  scene.name = variant ? `${site.name} - ${variant.name}` : site.name;
  const group = (name: string) => {
    const g = new THREE.Group();
    g.name = name;
    scene.add(g);
    return g;
  };
  const terrain = group('Terrain'), fences = group('Fences'), existing = group('Existing');
  const removed = new Set(variant?.removed ?? []);
  for (const node of gltf.scene.children) {
    if (isScenery(node)) continue; // the scenery around the plot stays in the viewer
    const p = pickOf(node);
    const isFence = p?.kind === 'edge';
    const isThing = !isFence && node.name !== 'terrain';
    if (isThing && !opt.includeExisting) continue;
    const gone = !!p && (p.kind === 'element' || p.kind === 'tree') && removed.has(p.id);
    if (gone && !opt.includeRemoved) continue;
    const c = node.clone(true);
    c.name = (gone ? 'TO_CLEAR_' : '') + node.name;
    c.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      // photos go out as JPEG; leaf masks keep their alpha as PNG
      if (m?.map) m.map.userData.mimeType = hasAlpha(m) ? 'image/png' : 'image/jpeg';
    });
    (node.name === 'terrain' ? terrain : isFence ? fences : existing).add(c);
  }
  if (variant) {
    const mat = plainMaterials();
    const add = (g: THREE.Group, parts: Part[]) => {
      for (const p of parts) {
        const mesh = new THREE.Mesh(p.geom, mat(p.mat));
        mesh.name = p.name;
        g.add(mesh);
      }
    };
    add(group('Proposed'), variant.placed.flatMap((p) => placedParts(site, p)));
    if (opt.includePaths && variant.paths.length) {
      add(group('Paths'), variant.paths.map((pts, i) => ({ name: `Path_${i + 1}`, geom: ribbon(site, pts, 1.2, 0.06), mat: 'path' as MatKey })));
    }
  }
  scene.userData = {
    units: 'meters',
    upAxis: 'Y',
    frame: 'x = across the plot (left fence -> right fence, seen from the road), -z = road -> forest',
    plot: `${site.plot.width.toFixed(2)} m x ${site.plot.depth.toFixed(2)} m`,
    source: 'Mera site model (video and narration)',
    variant: variant?.name ?? 'the site as filmed',
  };
  scene.updateMatrixWorld(true);
  return scene;
}

export async function toGLB(scene: THREE.Scene): Promise<ArrayBuffer> {
  const res = await new GLTFExporter().parseAsync(scene, { binary: true });
  return res as ArrayBuffer;
}

interface ObjResult { obj: string; mtl: string; textures: Map<string, THREE.Texture> }

/** OBJ + MTL writer: world-space vertices, texture coordinates, one `o` per mesh, `usemtl` per material. */
export function toOBJ(scene: THREE.Scene, mtlName: string): ObjResult {
  const lines: string[] = [
    '# Mera site export',
    '# UNITS: meters (1 unit = 1 m). Up axis: +Y. Plot frame: +X across the plot, -Z from road to forest.',
    `# ${scene.userData.plot ?? ''}`,
    `mtllib ${mtlName}`,
  ];
  const mats = new Map<string, { name: string; m: THREE.MeshBasicMaterial }>();
  const used = new Set<string>();
  const textures = new Map<string, THREE.Texture>();
  const matName = (m: THREE.MeshBasicMaterial) => {
    let e = mats.get(m.uuid);
    if (!e) {
      let name = (m.name || 'material').replace(/[^\w.-]+/g, '_');
      for (let k = 2; used.has(name); k++) name = `${(m.name || 'material').replace(/[^\w.-]+/g, '_')}_${k}`;
      used.add(name);
      e = { name, m };
      mats.set(m.uuid, e);
      if (m.map) textures.set(texFile(m.map), m.map);
    }
    return e.name;
  };
  let vOff = 1, tOff = 1, nOff = 1;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const top = mesh.parent && mesh.parent.parent && mesh.parent.parent !== scene ? mesh.parent : mesh;
    const oname = `${top.parent?.name ?? ''}/${top.name}${top === mesh ? '' : '_' + mesh.name}`;
    lines.push(`o ${oname}`, `g ${oname}`, `usemtl ${matName(mesh.material as THREE.MeshBasicMaterial)}`);
    for (let i = 0; i < pos.count; i++) lines.push(`v ${pos.getX(i).toFixed(4)} ${pos.getY(i).toFixed(4)} ${pos.getZ(i).toFixed(4)}`);
    if (uv) for (let i = 0; i < uv.count; i++) lines.push(`vt ${uv.getX(i).toFixed(5)} ${(1 - uv.getY(i)).toFixed(5)}`); // glTF top-left origin -> OBJ bottom-left
    for (let i = 0; i < nor.count; i++) lines.push(`vn ${nor.getX(i).toFixed(4)} ${nor.getY(i).toFixed(4)} ${nor.getZ(i).toFixed(4)}`);
    for (let i = 0; i < pos.count; i += 3) {
      const f = [0, 1, 2].map((k) => uv ? `${vOff + i + k}/${tOff + i + k}/${nOff + i + k}` : `${vOff + i + k}//${nOff + i + k}`);
      lines.push(`f ${f.join(' ')}`);
    }
    vOff += pos.count;
    nOff += nor.count;
    if (uv) tOff += uv.count;
  });
  const mtl: string[] = ['# Mera materials. Textures are in textures/ next to this file.'];
  for (const { name, m } of mats.values()) {
    const c = m.color;
    mtl.push(`newmtl ${name}`, `Kd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}`, 'Ka 0 0 0', 'Ks 0 0 0', `d ${m.transparent ? m.opacity : 1}`, 'illum 1');
    if (m.map) {
      mtl.push(`map_Kd textures/${texFile(m.map)}`);
      if (hasAlpha(m)) mtl.push(`map_d textures/${texFile(m.map)}`);
    }
    mtl.push('');
  }
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n'), textures };
}

/** The image file a texture came from (pipeline/model.py names every image after its file). */
const texFile = (t: THREE.Texture) => t.name || `${t.uuid}.png`;

export async function toOBJZip(pid: string, scene: THREE.Scene, base: string, readme: string): Promise<{ blob: Blob; obj: string; textures: number }> {
  const { obj, mtl, textures } = toOBJ(scene, `${base}.mtl`);
  const zip = new JSZip();
  zip.file(`${base}.obj`, obj);
  zip.file(`${base}.mtl`, mtl);
  zip.file('README.txt', readme);
  await Promise.all([...textures.keys()].map(async (name) => {
    zip.file(`textures/${name}`, await fetchBinary(api.file(pid, `site/tex/${name}`)));
  }));
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), obj, textures: textures.size };
}

/**
 * Point cloud as binary PLY in meters, Z-up (x = across the plot, y = road -> forest, z = up),
 * the convention Blender, CloudCompare and MeshLab assume for PLY. It lands exactly on top of
 * the glTF / OBJ exports after their Y-up -> Z-up import conversion.
 */
export async function pointCloudPLY(url: string): Promise<Blob> {
  const src = new DataView(await fetchBinary(url));
  const n = Math.floor(src.byteLength / 15);
  const out = new DataView(new ArrayBuffer(n * 15));
  for (let i = 0; i < n; i++) {
    const o = i * 15;
    const x = src.getFloat32(o, true), y = src.getFloat32(o + 4, true), z = src.getFloat32(o + 8, true);
    out.setFloat32(o, x, true);
    out.setFloat32(o + 4, -z, true);
    out.setFloat32(o + 8, y, true);
    out.setUint8(o + 12, src.getUint8(o + 12));
    out.setUint8(o + 13, src.getUint8(o + 13));
    out.setUint8(o + 14, src.getUint8(o + 14));
  }
  const header = `ply\nformat binary_little_endian 1.0\ncomment Mera reconstruction, units meters, Z-up (x across plot, y road->forest)\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
  return new Blob([header, out.buffer]);
}

export function readmeFor(site: SiteModel, variant: Variant | null): string {
  return [
    `Mera export - ${site.name}${variant ? ' - ' + variant.name : ''}`,
    '',
    'UNITS: meters. 1 unit = 1 m.',
    'AXES: +Y up. +X runs across the plot (left fence -> right fence, seen from the road).',
    '      -Z runs from the road boundary toward the forest.',
    '',
    `Plot: ${site.plot.edges.map((e) => `${e.id} side ${e.modelLength.toFixed(1)} m`).join(', ')}.`,
    `Expected accuracy: ${site.scale.expectedAccuracy}`,
    '',
    'Textures: photos from the video (ground, walls, fences) and leaf masks, in textures/.',
    'Blender: File > Import > Wavefront (.obj), default settings (Forward -Z, Up Y). Scene unit: metric, scale 1.0.',
    'SketchUp: File > Import > OBJ, choose Units = Meters and enable "Swap YZ coordinates" (Y-up -> Z-up).',
    '',
    'Groups: Terrain, Fences, Existing (buildings, yard things, trees), Proposed and Paths for a variant.',
    'TO_CLEAR_ marks existing things the variant removes, when they are included.',
  ].join('\n');
}

/** Re-import a GLB we just produced and measure it, as a self-check shown in the UI. */
export async function verifyGLB(buf: ArrayBuffer): Promise<{ fenceW: number; fenceD: number; objects: number; textures: number; height: number }> {
  const gltf = await new GLTFLoader().parseAsync(buf.slice(0), '');
  const f = gltf.scene.getObjectByName('Fences');
  const box = new THREE.Box3().setFromObject(f ?? gltf.scene);
  const all = new THREE.Box3().setFromObject(gltf.scene);
  let objects = 0;
  const images = new Set<unknown>();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    objects++;
    const map = (m.material as THREE.MeshBasicMaterial).map;
    if (map?.image) images.add(map.image);
  });
  return { fenceW: box.max.x - box.min.x, fenceD: box.max.z - box.min.z, objects, textures: images.size, height: all.max.y - all.min.y };
}

/** Saves a file and resolves with the name it was saved under. */
export async function download(data: Blob | ArrayBuffer, filename: string): Promise<string> {
  if (STATIC) return hostSave(data, filename);
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return filename;
}
