import type { Program, Rules, Variant } from '../types';
import type { PlanSite } from './metrics';
import { generateVariants } from './solver';

let worker: Worker | null = null;
let seq = 0;

export function solve(site: PlanSite, program: Program, rules: Rules, brief: string): Promise<Variant[]> {
  if (typeof Worker === 'undefined') return Promise.resolve(generateVariants(site, program, rules, brief));
  if (!worker) worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const w = worker!;
    const onMsg = (e: MessageEvent<{ id: number; variants?: Variant[]; error?: string }>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMsg);
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.variants!);
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, site, program, rules, brief });
  });
}
