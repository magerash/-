import { useState } from 'react';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import * as THREE from 'three';
import { useStore, activeVariantOf } from '../store';
import type { SiteModel } from '../types';
import { api } from '../api';
import { buildExportScene, download, pointCloudPLY, readmeFor, toGLB, toOBJ, toOBJZip, verifyGLB, type ExportOptions } from '../export/exporters';
import { Icon, ICONS } from './common';

type Fmt = 'glb' | 'obj' | 'ply';

export default function ExportDialog({ site }: { site: SiteModel }) {
  const { set, variants } = useStore();
  const pid = useStore((s) => s.projectId);
  const active = useStore(activeVariantOf);
  const [target, setTarget] = useState<string>(active?.id ?? 'site');
  const [fmt, setFmt] = useState<Fmt>('glb');
  const [opt, setOpt] = useState<ExportOptions>({ includeExisting: true, includeRemoved: false, includeTerrain: true, includePaths: true });
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const variant = target === 'site' ? null : variants.find((v) => v.id === target) ?? null;
  const base = `${site.id}_${variant ? variant.name.split(' · ')[0] + '_' + variant.strategy : 'site'}`.replace(/[^\w-]+/g, '_');

  const go = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (fmt === 'ply') {
        if (!site.pointcloud) throw new Error('no point cloud');
        download(await pointCloudPLY(api.file(pid, site.pointcloud.url)), `${site.id}_points.ply`);
        setResult(`Saved ${site.pointcloud.count.toLocaleString()} points (meters, Y-up).`);
        return;
      }
      const scene = buildExportScene(site, variant, opt);
      const before = new THREE.Box3().setFromObject(scene.getObjectByName('Boundary')!);
      const edges = site.plot.edges.map((e) => `${e.id} ${e.modelLength.toFixed(2)}`).join(', ');
      if (fmt === 'glb') {
        const buf = await toGLB(scene);
        download(buf, `${base}.glb`);
        const v = await verifyGLB(buf);
        const same = Math.abs(v.boundaryW - (before.max.x - before.min.x)) < 0.001 && Math.abs(v.boundaryD - (before.max.z - before.min.z)) < 0.001;
        setResult(`Re-imported the file: fence extents ${v.boundaryW.toFixed(2)} × ${v.boundaryD.toFixed(2)} m, ${v.objects} objects, ${v.height.toFixed(1)} m tall. ` +
          (same ? '✓ identical to the model, 1 unit = 1 m.' : '⚠ differs from the model!') + ` Boundary edges (m): ${edges}.`);
      } else {
        const blob = await toOBJZip(scene, base, readmeFor(site, variant));
        download(blob, `${base}_obj.zip`);
        const { obj } = toOBJ(scene, `${base}.mtl`);
        const parsed = new OBJLoader().parse(obj);
        const bnd = new THREE.Box3();
        parsed.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.startsWith('Boundary/')) bnd.expandByObject(o); });
        setResult(`OBJ + MTL + README in a zip. Re-parsed: boundary ${(bnd.max.x - bnd.min.x).toFixed(2)} × ${(bnd.max.z - bnd.min.z).toFixed(2)} units = meters.`);
      }
    } catch (e) {
      setResult('Export failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={() => set({ exportOpen: false })}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Export">
        <header><h2>Download a 3D file</h2><span className="spacer" /><button className="btn sm ghost" onClick={() => set({ exportOpen: false })}><Icon d={ICONS.close} size={14} /></button></header>
        <div className="content">
          <div className="small" style={{ marginBottom: 4, color: 'var(--ink-2)' }}>What</div>
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: '100%', padding: 6, borderRadius: 6, border: '1px solid var(--line-2)' }} aria-label="what to export">
            <option value="site">The site as it is today</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.name}{v.starred ? ' ★' : ''}</option>)}
          </select>
          <div className="small" style={{ margin: '12px 0 4px', color: 'var(--ink-2)' }}>Format</div>
          <div className="seg">
            <button aria-pressed={fmt === 'glb'} onClick={() => setFmt('glb')}>glTF (.glb)</button>
            <button aria-pressed={fmt === 'obj'} onClick={() => setFmt('obj')}>OBJ (.zip)</button>
            <button aria-pressed={fmt === 'ply'} onClick={() => setFmt('ply')} disabled={!site.pointcloud}>Point cloud (.ply)</button>
          </div>
          {fmt !== 'ply' && (
            <div style={{ marginTop: 10 }} className="small">
              <label className="opt"><input type="checkbox" checked={opt.includeExisting} onChange={(e) => setOpt({ ...opt, includeExisting: e.target.checked })} />Existing structures, beds and trees</label>
              {variant && <label className="opt"><input type="checkbox" checked={opt.includeRemoved} onChange={(e) => setOpt({ ...opt, includeRemoved: e.target.checked })} />Also things this variant clears (named TO_CLEAR_…)</label>}
              <label className="opt"><input type="checkbox" checked={opt.includeTerrain} onChange={(e) => setOpt({ ...opt, includeTerrain: e.target.checked })} />Ground plate with the measured slope</label>
              {variant && <label className="opt"><input type="checkbox" checked={opt.includePaths} onChange={(e) => setOpt({ ...opt, includePaths: e.target.checked })} />Paths and driveway</label>}
            </div>
          )}
          <p className="small muted" style={{ margin: '10px 0' }}>
            Units are meters at true scale. glTF opens directly in Blender (File › Import › glTF). For SketchUp use OBJ and pick “Meters” on import.
          </p>
          <button className="btn primary" onClick={go} disabled={busy} data-testid="do-export"><Icon d={ICONS.download} size={14} />{busy ? 'Preparing…' : 'Download'}</button>
          {result && <div className="note" style={{ marginTop: 10 }} data-testid="export-result">{result}</div>}
        </div>
      </div>
    </div>
  );
}
