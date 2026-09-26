/**
 * Step 5: post effects.
 *
 * Every effect mixes against its `intensity` (0..100). All randomness is a
 * hash of (index, frameBucket) so a given frame always looks the same — the
 * grain advances by *stepping* the bucket, not by calling Math.random().
 */

import { PFX_KEYS, type Params, type PfxKey } from '../types';
import { alphaSnapshot, clamp, clipToSnapshot, hash01, scratch } from './util';

/** Noise tile shared by filmGrain. Regenerated only if the size changes. */
let grainTile: HTMLCanvasElement | null = null;
const GRAIN_SIZE = 128;

/** Pool slot for the pre-effect alpha snapshot; 0-2 belong to the effects. */
const FX_LAYER = 4;

function getGrainTile(): HTMLCanvasElement | null {
  if (grainTile) return grainTile;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = GRAIN_SIZE;
  canvas.height = GRAIN_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(GRAIN_SIZE, GRAIN_SIZE);
  const d = img.data;
  for (let y = 0; y < GRAIN_SIZE; y++) {
    for (let x = 0; x < GRAIN_SIZE; x++) {
      const v = Math.round(hash01(x, y, 17) * 255);
      const p = (y * GRAIN_SIZE + x) * 4;
      d[p] = v;
      d[p + 1] = v;
      d[p + 2] = v;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  grainTile = canvas;
  return canvas;
}

function scanLines(w: number, h: number, ctx: CanvasRenderingContext2D, k: number): void {
  const alpha = (k / 100) * 0.85;
  if (alpha <= 0) return;
  const gap = 3;
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
  for (let y = 0; y < h; y += gap) ctx.fillRect(0, y, w, 1);
  ctx.restore();
}

function vignette(w: number, h: number, ctx: CanvasRenderingContext2D, k: number): void {
  const inner = Math.min(w, h) * 0.28;
  const outer = Math.max(w, h) * 0.78;
  const g = ctx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, outer);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${(k / 100).toFixed(3)})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function bloom(
  w: number,
  h: number,
  ctx: CanvasRenderingContext2D,
  k: number,
  canvas: HTMLCanvasElement,
): void {
  const radius = Math.max(3, (k / 100) * Math.max(w, h) * 0.035);
  const tmp = scratch(0, w, h);
  const tctx = tmp.getContext('2d');
  if (!tctx) return;
  tctx.clearRect(0, 0, w, h);
  tctx.filter = `blur(${radius.toFixed(2)}px)`;
  tctx.drawImage(canvas, 0, 0);
  tctx.filter = 'none';

  // 'lighter' adds pixel values, so near-black areas contribute almost
  // nothing: this is a cheap highlight-only glow with no threshold pass.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = (k / 100) * 0.65;
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

function chromatic(
  w: number,
  h: number,
  ctx: CanvasRenderingContext2D,
  k: number,
  canvas: HTMLCanvasElement,
): void {
  const dx = (k / 100) * 9;
  if (dx < 0.4) return;

  const channels: Array<{ canvas: HTMLCanvasElement; tint: string; offset: number }> = [
    { canvas: scratch(0, w, h), tint: '#ff0000', offset: -dx },
    { canvas: scratch(1, w, h), tint: '#00ff00', offset: 0 },
    { canvas: scratch(2, w, h), tint: '#0000ff', offset: dx },
  ];

  for (const ch of channels) {
    const c = ch.canvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
    c.drawImage(canvas, 0, 0);
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = ch.tint;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
  }

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (const ch of channels) ctx.drawImage(ch.canvas, ch.offset, 0);
  ctx.restore();
}

function filmGrain(
  w: number,
  h: number,
  ctx: CanvasRenderingContext2D,
  k: number,
  timeMs: number,
): void {
  const tile = getGrainTile();
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  const shift = Math.floor(timeMs / 50) % GRAIN_SIZE;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = (k / 100) * 0.55;
  ctx.translate(-shift, -((shift * 3) % GRAIN_SIZE));
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w + GRAIN_SIZE, h + GRAIN_SIZE);
  ctx.restore();
}

function glitch(
  w: number,
  h: number,
  ctx: CanvasRenderingContext2D,
  k: number,
  canvas: HTMLCanvasElement,
  timeMs: number,
): void {
  const amount = k / 100;
  const frame = Math.floor(timeMs / 70);
  const bands = Math.round(3 + amount * 14);
  const maxOffset = amount * w * 0.09;

  const src = scratch(0, w, h);
  const sctx = src.getContext('2d');
  if (!sctx) return;
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(canvas, 0, 0);

  ctx.save();
  for (let i = 0; i < bands; i++) {
    const y0 = Math.floor(hash01(i, 1, frame) * h);
    const bh = Math.max(2, Math.floor(3 + hash01(i, 2, frame) * h * 0.05));
    const off = (hash01(i, 3, frame) - 0.5) * 2 * maxOffset;
    if (Math.abs(off) < 0.5) continue;
    ctx.drawImage(src, 0, y0, w, bh, off, y0, w, bh);
  }
  // A short colour-fringed tear, only on stronger settings.
  if (amount > 0.35) {
    const y0 = Math.floor(hash01(97, 4, frame) * h);
    const bh = Math.max(2, Math.floor(hash01(97, 5, frame) * h * 0.02));
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(255,0,80,${(amount * 0.35).toFixed(3)})`;
    ctx.fillRect(0, y0, w, bh);
  }
  ctx.restore();
}

function halftone(
  w: number,
  h: number,
  ctx: CanvasRenderingContext2D,
  k: number,
  canvas: HTMLCanvasElement,
): void {
  const step = Math.max(3, Math.round(3 + (k / 100) * 7));
  const gw = Math.max(1, Math.ceil(w / step));
  const gh = Math.max(1, Math.ceil(h / step));

  const small = scratch(0, gw, gh);
  const sctx = small.getContext('2d');
  if (!sctx) return;
  sctx.imageSmoothingEnabled = true;
  sctx.clearRect(0, 0, gw, gh);
  sctx.drawImage(canvas, 0, 0, gw, gh);

  let data: Uint8ClampedArray;
  try {
    data = sctx.getImageData(0, 0, gw, gh).data;
  } catch {
    return;
  }

  // One path, one fill: batched arcs are dramatically cheaper than per-dot fills.
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = (k / 100) * 0.95;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  const maxR = step * 0.62;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const p = (gy * gw + gx) * 4;
      const lum = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
      const r = maxR * Math.pow(1 - lum, 0.75);
      if (r < 0.35) continue;
      const cx = gx * step + step / 2;
      const cy = gy * step + step / 2;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

function pixelate(
  w: number,
  h: number,
  ctx: CanvasRenderingContext2D,
  k: number,
  canvas: HTMLCanvasElement,
): void {
  const size = Math.max(2, Math.round(2 + (k / 100) * 26));
  const sw = Math.max(1, Math.round(w / size));
  const sh = Math.max(1, Math.round(h / size));

  const small = scratch(0, sw, sh);
  const sctx = small.getContext('2d');
  if (!sctx) return;
  sctx.imageSmoothingEnabled = true;
  sctx.clearRect(0, 0, sw, sh);
  sctx.drawImage(canvas, 0, 0, sw, sh);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(small, 0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.restore();
}

function filmDust(w: number, h: number, ctx: CanvasRenderingContext2D, k: number, timeMs: number): void {
  const amount = k / 100;
  const frame = Math.floor(timeMs / 90);
  const specks = Math.round(amount * 70);
  const alpha = 0.25 + amount * 0.55;

  ctx.save();
  for (let i = 0; i < specks; i++) {
    const x = hash01(i, 11, frame) * w;
    const y = hash01(i, 22, frame) * h;
    const s = 1 + hash01(i, 33, frame) * 3.5;
    const bright = hash01(i, 44, frame) > 0.55;
    ctx.fillStyle = bright
      ? `rgba(255,255,255,${alpha.toFixed(3)})`
      : `rgba(0,0,0,${alpha.toFixed(3)})`;
    ctx.fillRect(x, y, s, s);
  }
  if (amount > 0.35) {
    const sx = hash01(7, 55, frame) * w;
    ctx.strokeStyle = `rgba(255,255,255,${(amount * 0.3).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx + (hash01(8, 66, frame) - 0.5) * 8, h);
    ctx.stroke();
  }
  ctx.restore();
}

/* --------------------------------------------------------------- entry --- */

export function applyPfx(canvas: HTMLCanvasElement, params: Params, timeMs: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const p = params.pfx;

  const run = (key: PfxKey, fn: () => void): void => {
    const entry = p[key];
    if (entry && entry.enabled && entry.intensity > 0) fn();
  };

  // With `bgMode: "none"` the frame has genuinely empty pixels, and most of
  // the effects below paint a full-canvas blend: blending against alpha 0
  // yields alpha 1, so grain, scanlines, vignette, dust and the chromatic
  // channels would replace the transparent backdrop with opaque pixels.
  // Snapshot the alpha before touching anything and mask the whole step back
  // to it — the same guard anim.ts applies to its own overlay pass. On any
  // other backdrop the snapshot alpha is 1 and this is a no-op.
  const protectsAlpha =
    params.bgMode === 'none' &&
    PFX_KEYS.some((key) => {
      const entry = p[key];
      return !!entry && entry.enabled && entry.intensity > 0;
    });
  const before = protectsAlpha ? alphaSnapshot(canvas, FX_LAYER) : null;

  run('scanLines', () => scanLines(w, h, ctx, p.scanLines.intensity));
  run('vignette', () => vignette(w, h, ctx, p.vignette.intensity));
  run('bloom', () => bloom(w, h, ctx, p.bloom.intensity, canvas));
  run('chromatic', () => chromatic(w, h, ctx, p.chromatic.intensity, canvas));
  run('filmGrain', () => filmGrain(w, h, ctx, p.filmGrain.intensity, timeMs));
  run('glitch', () => glitch(w, h, ctx, p.glitch.intensity, canvas, timeMs));
  run('halftone', () => halftone(w, h, ctx, p.halftone.intensity, canvas));
  run('pixelate', () => pixelate(w, h, ctx, p.pixelate.intensity, canvas));
  run('filmDust', () => filmDust(w, h, ctx, p.filmDust.intensity, timeMs));

  clipToSnapshot(canvas, before);
}

export const pfxIntensity = (params: Params, key: PfxKey): number =>
  clamp(params.pfx[key]?.intensity ?? 0, 0, 100);
