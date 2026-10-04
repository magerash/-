// The app runs in two places. Normally it talks to the Mera server. Built with VITE_STATIC=1 it is
// a self-contained copy of one survey: the data sits in files next to the page, each viewer's own
// variants are kept in the page host's per-person store (or this browser as a fallback), and file
// saves go through the host's download prompt.
import JSZip from 'jszip';
import type { Variant } from './types';

export const STATIC = import.meta.env.VITE_STATIC === '1';

type Claude = { use(name: string): Promise<unknown> };

export async function capability<T>(name: string): Promise<T | null> {
  const c = (window as unknown as { claude?: Claude }).claude;
  if (!c?.use) return null;
  try {
    return ((await c.use(name)) as T) ?? null;
  } catch {
    return null;
  }
}

interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
}
interface Db { doc(path: string): DocRef }
interface User { id(): Promise<string | null> }
interface Downloads { save(req: { filename: string; data: Blob | ArrayBuffer | string }): Promise<{ status: string }> }

const LOCAL_KEY = 'mera.variants.v1';

/** What is stored per variant; checks, paths and numbers are recomputed on load. */
type Stored = Pick<Variant, 'id' | 'name' | 'createdAt' | 'brief' | 'program' | 'placed'>;
const compact = (v: Variant): Stored => ({ id: v.id, name: v.name, createdAt: v.createdAt, brief: v.brief, program: v.program, placed: v.placed });

let docRef: Promise<DocRef | null> | null = null;
function personalDoc(): Promise<DocRef | null> {
  docRef ??= (async () => {
    const [db, user] = await Promise.all([capability<Db>('db'), capability<User>('user')]);
    if (!db || !user) return null;
    const id = await user.id().catch(() => null);
    return id ? db.doc(`data/users/${id}/variants`) : null;
  })();
  return docRef;
}

export async function loadVariants(): Promise<Variant[]> {
  const doc = await personalDoc();
  if (doc) {
    try {
      const snap = await doc.get();
      if (snap.exists) return ((snap.data()?.list as Stored[]) ?? []) as Variant[];
    } catch { /* fall back to this browser */ }
  }
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as Variant[];
  } catch {
    return [];
  }
}

export async function saveVariants(vs: Variant[]): Promise<void> {
  const list = vs.map(compact);
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
  const doc = await personalDoc();
  if (doc) await doc.set({ list, savedAt: new Date().toISOString() });
}

/** Binary data; the static copy ships it as base64 text (`*.b64.txt`) because hosts may not serve raw binaries. */
export async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  if (!url.endsWith('.b64.txt')) return r.arrayBuffer();
  const s = atob((await r.text()).trim());
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

// the host only accepts some file types; 3D formats are handed over inside a zip
const HOST_OK = /\.(zip|json|txt|md|csv|png|jpg|jpeg|svg|html|pdf)$/i;

/** Saves through the page host. Returns the file name the viewer was offered. */
export async function hostSave(data: Blob | ArrayBuffer, filename: string): Promise<string> {
  const dl = await capability<Downloads>('downloads');
  if (!dl) throw new Error('saving files is not available in this view. Open the page in claude.ai, or run Mera locally to export.');
  let blob = data instanceof Blob ? data : new Blob([data]);
  let name = filename;
  if (!HOST_OK.test(name)) {
    const zip = new JSZip();
    zip.file(name, blob);
    blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    name = `${name}.zip`;
  }
  await dl.save({ filename: name, data: blob });
  return name;
}
