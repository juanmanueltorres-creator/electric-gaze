/**
 * Step 6: additive glow points.
 *
 * Points are normalized (x, y in 0..1, radius as a fraction of the shorter
 * edge, intensity 0..100) so a preset scales to any canvas size.
 */

import type { Params } from '../types';
import { alphaSnapshot, clamp, clipToSnapshot } from './util';

/**
 * Pool slot for the pre-lights alpha snapshot: 0-2 are the pipeline's working
 * layers, 3 tint, 4 FX, 5 mask, 6 animation and 9 the work layer, so 7 is free.
 */
const LIGHT_LAYER = 7;

export function applyLights(canvas: HTMLCanvasElement, params: Params): void {
  const points = params.lights?.points;
  if (!params.lights?.enabled || !points || points.length === 0) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const maxDim = Math.max(w, h);

  // Each point paints an opaque radial gradient with `lighter`, whose alpha
  // term adds to whatever is already there. Under `bgMode: "none"` that turns
  // genuinely empty pixels opaque — and it brightens cells it was only meant
  // to glow *on top of*. Snapshot the alpha first and mask the step back to
  // it, so lights only ever brighten pixels that already existed.
  const before = params.bgMode === 'none' ? alphaSnapshot(canvas, LIGHT_LAYER) : null;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of points) {
    const a = clamp(p.intensity, 0, 100) / 100;
    const r = Math.max(1, clamp(p.radius, 0, 1) * maxDim * 0.5);
    if (a <= 0 || !Number.isFinite(r)) continue;
    const cx = clamp(p.x, 0, 1) * w;
    const cy = clamp(p.y, 0, 1) * h;

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    g.addColorStop(0.35, `rgba(255,240,220,${(a * 0.42).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();

  clipToSnapshot(canvas, before);
}
