import type { FrameInfo, SiteModel, Transcript, Variant } from './types';
import { STATIC, loadVariants, saveVariants } from './host';

const base = (pid: string) => `/api/projects/${encodeURIComponent(pid)}`;

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export interface ProjectInfo {
  id: string;
  name: string;
  inputs: string[];
  hasSite: boolean;
  running: boolean;
  job: JobState | null;
}

export interface JobState {
  stages: Record<string, { status: string; message: string; fraction?: number; updated: number }>;
  current?: string;
  running?: boolean;
  error?: string;
}

const server = {
  projects: () => j<ProjectInfo[]>('/api/projects'),
  create: (name: string, plot?: { width: number[]; depth: number[] }) =>
    j<{ id: string }>('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, ...plot }) }),
  upload: async (pid: string, files: File[], onProgress?: (f: number) => void) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${base(pid)}/upload`);
      xhr.upload.onprogress = (e) => onProgress?.(e.loaded / Math.max(1, e.total));
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText)));
      xhr.onerror = () => reject(new Error('upload failed'));
      xhr.send(fd);
    });
  },
  run: (pid: string) => j<{ status: string }>(`${base(pid)}/run`, { method: 'POST' }),
  job: (pid: string) => j<JobState>(`${base(pid)}/job`),
  site: (pid: string) => j<SiteModel>(`${base(pid)}/site`),
  transcript: (pid: string) => j<Transcript>(`${base(pid)}/transcript`),
  frames: async (pid: string) => (await j<{ frames: FrameInfo[] }>(`${base(pid)}/frames`)).frames,
  variants: async (pid: string) => (await j<{ variants: Variant[] }>(`${base(pid)}/variants`)).variants,
  saveVariants: (pid: string, variants: Variant[]) =>
    j(`${base(pid)}/variants`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variants }) }),
  file: (pid: string, path: string) => `${base(pid)}/files/${path}`,
  thumb: (pid: string, frameId: string) => `${base(pid)}/files/thumbs/${frameId}.jpg`,
  frame: (pid: string, frameId: string) => `${base(pid)}/files/frames/${frameId}.jpg`,
};

// static copy: one survey published as files next to the page (see host.ts)
const data = (path: string) => `data/${path}`;
const staticApi: typeof server = {
  ...server,
  projects: async () => {
    const s = await j<SiteModel>(data('site.json'));
    return [{ id: s.id, name: s.name, inputs: [], hasSite: true, running: false, job: null }];
  },
  site: () => j<SiteModel>(data('site.json')),
  transcript: () => j<Transcript>(data('transcript.json')),
  frames: async () => (await j<{ frames: FrameInfo[] }>(data('frames.json'))).frames,
  variants: () => loadVariants(),
  saveVariants: (_pid: string, variants: Variant[]) => saveVariants(variants),
  file: (_pid: string, path: string) => data(path),
  thumb: (_pid: string, frameId: string) => data(`frames/${frameId}.jpg`),
  frame: (_pid: string, frameId: string) => data(`frames/${frameId}.jpg`),
};

export const api = STATIC ? staticApi : server;
