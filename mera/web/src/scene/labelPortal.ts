import type { RefObject } from 'react';

/**
 * Stable DOM container for 3D labels (drei <Html portal>), owned by the viewport rather than the
 * canvas, so labels unmount cleanly when the canvas is swapped (e.g. switching to Compare).
 */
export const labelPortal: RefObject<HTMLElement> = { current: null as unknown as HTMLElement };
