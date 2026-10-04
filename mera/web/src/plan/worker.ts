// Runs the layout search off the main thread so the 3D view stays responsive.
import { generateVariants } from './solver';
import type { PlanSite } from './metrics';
import type { Program, Rules } from '../types';

self.onmessage = (e: MessageEvent<{ id: number; site: PlanSite; program: Program; rules: Rules; brief: string }>) => {
  const { id, site, program, rules, brief } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, variants: generateVariants(site, program, rules, brief) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
