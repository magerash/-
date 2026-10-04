import type { Placed, Program, Rules } from '../types';
import type { PlanSite } from './metrics';
import { placeItems } from './solver';

let worker: Worker | null = null;
let seq = 0;

/** Finds spots for the program's buildings that are not in `fixed`, off the main thread. */
export function place(site: PlanSite, program: Program, fixed: Placed[], rules: Rules, seed = 1): Promise<Placed[]> {
  if (typeof Worker === 'undefined') return Promise.resolve(placeItems(site, program, fixed, rules, seed).placed);
  if (!worker) worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const w = worker!;
    const onMsg = (e: MessageEvent<{ id: number; placed?: Placed[]; error?: string }>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMsg);
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.placed!);
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, site, program, fixed, rules, seed });
  });
}
