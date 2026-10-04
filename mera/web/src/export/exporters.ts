// GLB / OBJ+MTL / PLY export at true metric scale.
// glTF is meters and Y-up by specification; OBJ carries no units, so the archive states them.
// Blender: File > Import > glTF or Wavefront (defaults) -> 1 Blender unit = 1 m, Z-up.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import JSZip from 'jszip';
import type { SiteModel, Variant } from '../types';
import { STATIC, fetchBinary, hostSave } from '../host';
import { MAT_COLORS, elementParts, fenceParts, placedParts, ribbon, terrainGeometry, type MatKey, type Part } from '../scene/geometry';

export interface ExportOptions {
  includeExisting: boolean;
  includeRemoved: boolean;
  includeTerrain: boolean;
  includePaths: boolean;
}

function materials() {
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

/** Builds the export scene: one named group per category, one named mesh per part. */
export function buildExportScene(site: SiteModel, variant: Variant | null, opt: ExportOptions): THREE.Scene {
  const scene = new THREE.Scene();
  scene.name = variant ? `${site.name} - ${variant.name}` : site.name;
  const mat = materials();
  const group = (name: string, parts: Part[]) => {
    const g = new THREE.Group();
    g.name = name;
    for (const p of parts) {
      const mesh = new THREE.Mesh(p.geom, mat(p.mat));
      mesh.name = p.name;
      g.add(mesh);
    }
    scene.add(g);
    return g;
  };
  group('Boundary', fenceParts(site));
  if (opt.includeTerrain) group('Terrain', [{ name: `Terrain_plot_slope_${site.terrain.slopePct.toFixed(1)}pct`, geom: terrainGeometry(site), mat: 'terrain' }]);
  const removed = new Set(variant?.removed ?? []);
  if (opt.includeExisting) {
    const parts: Part[] = [];
    for (const e of site.elements) {
      if (removed.has(e.id) && !opt.includeRemoved) continue;
      for (const p of elementParts(site, e)) parts.push({ ...p, name: (removed.has(e.id) ? 'TO_CLEAR_' : '') + p.name });
    }
    group('Existing', parts);
  }
  if (variant) {
    const parts: Part[] = [];
    for (const p of variant.placed) parts.push(...placedParts(site, p));
    group('Proposed', parts);
    if (opt.includePaths) {
      group('Paths', variant.paths.map((pts, i) => ({ name: `Path_${i + 1}`, geom: ribbon(site, pts, 1.2, 0.04), mat: 'path' as MatKey })));
    }
  }
  scene.userData = {
    units: 'meters',
    upAxis: 'Y',
    frame: 'x = across the plot (left fence -> right fence), -z = road -> forest',
    plot: `${site.plot.width.toFixed(2)} m x ${site.plot.depth.toFixed(2)} m`,
    source: 'Mera site survey (video + narration)',
    variant: variant?.name ?? 'existing site',
  };
  return scene;
}

export async function toGLB(scene: THREE.Scene): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const res = await exporter.parseAsync(scene, { binary: true, includeCustomExtensions: false });
  return res as ArrayBuffer;
}

/** Plain OBJ + MTL writer: world-space vertices, one `o` per mesh, `usemtl` per material. */
export function toOBJ(scene: THREE.Scene, mtlName: string): { obj: string; mtl: string } {
  const lines: string[] = [
    '# Mera site export',
    '# UNITS: meters (1 unit = 1 m). Up axis: +Y. Plot frame: +X across the plot, -Z from road to forest.',
    `# ${scene.userData.plot ?? ''}`,
    `mtllib ${mtlName}`,
  ];
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  let vOffset = 1;
  let nOffset = 1;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const m = mesh.material as THREE.MeshStandardMaterial;
    mats.set(m.name, m);
    const oname = (mesh.parent?.name ? mesh.parent.name + '/' : '') + mesh.name;
    lines.push(`o ${oname}`, `g ${oname}`);
    lines.push(`usemtl ${m.name}`);
    for (let i = 0; i < pos.count; i++) lines.push(`v ${pos.getX(i).toFixed(4)} ${pos.getY(i).toFixed(4)} ${pos.getZ(i).toFixed(4)}`);
    for (let i = 0; i < nor.count; i++) lines.push(`vn ${nor.getX(i).toFixed(4)} ${nor.getY(i).toFixed(4)} ${nor.getZ(i).toFixed(4)}`);
    for (let i = 0; i < pos.count; i += 3) {
      const a = vOffset + i, b = a + 1, c = a + 2;
      const na = nOffset + i;
      lines.push(`f ${a}//${na} ${b}//${na + 1} ${c}//${na + 2}`);
    }
    vOffset += pos.count;
    nOffset += nor.count;
  });
  const mtl: string[] = ['# Mera materials'];
  for (const [name, m] of mats) {
    const c = m.color;
    mtl.push(`newmtl ${name}`, `Kd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}`, 'Ka 0 0 0', 'Ks 0 0 0', `d ${m.transparent ? m.opacity : 1}`, 'illum 1', '');
  }
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') };
}

export async function toOBJZip(scene: THREE.Scene, base: string, readme: string): Promise<Blob> {
  const { obj, mtl } = toOBJ(scene, `${base}.mtl`);
  const zip = new JSZip();
  zip.file(`${base}.obj`, obj);
  zip.file(`${base}.mtl`, mtl);
  zip.file('README.txt', readme);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
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
    `Plot (model): ${site.plot.width.toFixed(2)} m wide x ${site.plot.depth.toFixed(2)} m deep.`,
    `Owner's figures: ${site.plot.statedWidth.join('-')} m wide, ${site.plot.statedDepth.join('-')} m road->forest.`,
    `Expected accuracy: ${site.scale.expectedAccuracy}`,
    '',
    'Blender: File > Import > Wavefront (.obj), default settings (Forward -Z, Up Y). Scene unit: metric, scale 1.0.',
    'SketchUp: File > Import > OBJ, choose Units = Meters and enable "Swap YZ coordinates" (Y-up -> Z-up).',
    '',
    'Object names ending in _reconstructed come from the video reconstruction; _inferred were placed from',
    'the video frames and narration without enough 3D evidence; TO_CLEAR_ marks things a variant removes.',
  ].join('\n');
}

/** Re-import a GLB we just produced and measure it, as a self-check shown in the UI. */
export async function verifyGLB(buf: ArrayBuffer): Promise<{ boundaryW: number; boundaryD: number; objects: number; height: number }> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buf.slice(0), '');
  const b = gltf.scene.getObjectByName('Boundary');
  const box = new THREE.Box3().setFromObject(b ?? gltf.scene);
  const all = new THREE.Box3().setFromObject(gltf.scene);
  let objects = 0;
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) objects++; });
  return { boundaryW: box.max.x - box.min.x, boundaryD: box.max.z - box.min.z, objects, height: all.max.y - all.min.y };
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
