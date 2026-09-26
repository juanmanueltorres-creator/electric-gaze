/**
 * Cheap preset thumbnails.
 *
 * One small frame rendered through the normal pipeline — no effect code is
 * touched, and the bitmap exists only in this module's memory cache: it is
 * never written to `localStorage`, which is what keeps the storage documents
 * small. The source is the demo image on purpose, so every card is judged
 * against the same picture and presets are compared like for like.
 *
 * The mask is switched off for previews: it belongs to the user's image, not
 * to the effect, and decoding a stored bitmap per card would cost far more
 * than it shows at this size.
 */

import { renderFrame } from '../engine/render';
import { createDemoImage } from './demo';
import type { Params } from '../types';

const THUMB_WIDTH = 168;
const THUMB_HEIGHT = 94;

let demo: CanvasImageSource | null = null;
const cache = new Map<string, string>();

/**
 * Identity of a config for caching and gallery signatures: everything the
 * effect reads, minus the mask bitmap (which previews ignore anyway).
 */
export function configSignature(config: unknown): string {
  const raw: Record<string, unknown> =
    config !== null && typeof config === 'object' && !Array.isArray(config)
      ? { ...(config as Record<string, unknown>) }
      : { value: config };
  const mask = raw.mask;
  if (mask !== null && typeof mask === 'object' && !Array.isArray(mask)) {
    raw.mask = { ...(mask as Record<string, unknown>), dataUrl: null };
  }
  return JSON.stringify(raw);
}

/** Render (or reuse) a 168 x 94 preview of `params` as a data URL. */
export function getPresetThumb(params: Params): string {
  const key = configSignature(params);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  if (!demo) demo = createDemoImage();
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const view: Params = {
    ...params,
    mask: { ...params.mask, enabled: false, dataUrl: null, showOverlay: false },
  };
  // A fixed time makes the frame deterministic: an animated preset always
  // shows the same pose, so the gallery never flickers between renders.
  renderFrame(canvas, demo, view, 0, { sourceVersion: 0 });
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
