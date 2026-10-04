import type { Provenance } from '../types';

export function Prov({ p }: { p: Provenance }) {
  const label = p === 'reconstructed' ? 'reconstructed' : p === 'stated' ? 'owner said' : 'inferred';
  const title = p === 'reconstructed'
    ? 'Measured from 3D points reconstructed from the video'
    : p === 'stated' ? "From the owner's own words or figures" : 'Placed from video frames / narration without enough 3D evidence';
  return <span className={`prov ${p}`} title={title}>{label}</span>;
}

export const fmtT = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  orbit: 'M12 3a9 9 0 1 0 9 9M12 3c-2.5 2.6-4 5.6-4 9s1.5 6.4 4 9M3 12h18',
  top: 'M4 4h16v16H4zM4 12h16M12 4v16',
  walk: 'M13 4a1.5 1.5 0 1 0 0 .01M10 21l2-6 3 3v3M9 11l3-3 3 2 2 3M12 8l-1 5',
  ruler: 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  photo: 'M4 7h3l2-3h6l2 3h3v13H4zM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  close: 'M6 6l12 12M18 6 6 18',
  panel: 'M3 4h18v16H3zM15 4v16',
  home: 'M3 11 12 4l9 7M5 10v10h14V10',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  plus: 'M12 5v14M5 12h14',
};
