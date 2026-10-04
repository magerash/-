import type { SiteModel, Variant } from '../types';

/** Small true-to-scale plan (north-up is unknown, so road at the bottom, forest at the top). */
export default function MiniPlan({ site, variant, size = 112 }: { site: SiteModel; variant: Variant | null; size?: number }) {
  const pad = 4;
  const W = site.plot.width, D = site.plot.depth;
  const s = (size - 2 * pad) / Math.max(W, D);
  const ox = pad + ((size - 2 * pad) - W * s) / 2;
  const oy = pad + ((size - 2 * pad) - D * s) / 2;
  const X = (u: number) => ox + u * s;
  const Y = (v: number) => size - oy - v * s;
  const pts = (poly: [number, number][]) => poly.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  const removed = new Set(variant?.removed ?? []);
  const boundary = site.plot.edges.map((e) => e.a);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-label="plan">
      <rect x={0} y={0} width={size} height={oy} fill="#c8d1c1" opacity={0.5} />
      <polygon points={pts(boundary)} fill="#cfd8c4" stroke="#3b2c26" strokeWidth={1} />
      {site.elements.filter((e) => e.kind !== 'tree' && e.footprint.length >= 3).map((e) => (
        <polygon key={e.id} points={pts(e.footprint)}
          fill={removed.has(e.id) ? 'none' : e.kind === 'beds' || e.kind === 'tilled' ? '#9b8569' : e.kind === 'parking' ? '#bdb8ad' : '#8f8578'}
          stroke={removed.has(e.id) ? '#b0452c' : 'none'} strokeDasharray={removed.has(e.id) ? '2 1.5' : undefined} strokeWidth={0.8}
          opacity={e.provenance === 'inferred' && !removed.has(e.id) ? 0.55 : 0.9} />
      ))}
      {site.elements.filter((e) => e.kind === 'tree').map((e) => {
        const c = e.footprint.reduce((a, p) => [a[0] + p[0] / e.footprint.length, a[1] + p[1] / e.footprint.length], [0, 0]);
        return <circle key={e.id} cx={X(c[0])} cy={Y(c[1])} r={Math.max(0.8, 1.2 * s)} fill={removed.has(e.id) ? 'none' : '#6f8a5c'} stroke={removed.has(e.id) ? '#b0452c' : 'none'} strokeWidth={0.6} opacity={0.8} />;
      })}
      {variant?.paths.map((p, i) => (
        <polyline key={i} points={pts(p)} fill="none" stroke="#f3eee2" strokeWidth={Math.max(1, 1.2 * s)} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {variant?.placed.map((p) => (
        <rect key={p.itemId} x={X(p.u - p.w / 2)} y={Y(p.v + p.d / 2)} width={p.w * s} height={p.d * s}
          fill={p.type === 'pool' ? '#6fa3b8' : p.type === 'garden' ? '#8d7154' : '#f2eee6'} stroke="#2c666b" strokeWidth={1.1} />
      ))}
      <line x1={X(site.plot.entrance.u - site.plot.entrance.width / 2)} x2={X(site.plot.entrance.u + site.plot.entrance.width / 2)} y1={Y(0)} y2={Y(0)} stroke="#fbfaf7" strokeWidth={2.5} />
    </svg>
  );
}
