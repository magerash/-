// Runs the placement search off the main thread so the 3D view stays responsive.
import { placeItems } from './solver';
import type { PlanSite } from './metrics';
import type { Placed, Program, Rules } from '../types';

self.onmessage = (e: MessageEvent<{ id: number; site: PlanSite; program: Program; fixed: Placed[]; rules: Rules; seed: number }>) => {
  const { id, site, program, fixed, rules, seed } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, placed: placeItems(site, program, fixed, rules, seed).placed });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
