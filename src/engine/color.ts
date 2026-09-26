/**
 * Step 4 of the pipeline: colour grading, in the mandated order.
 *
 *   brightness → contrast → saturation → grayscale
 *   → toneCurve → tint @ tintOpacity via overlayBlend → blurType/blurAmount
 *
 * The first four ride on the canvas `filter` property, the tone curve on an
 * explicit LUT pass, the tint on a composite operation, and the blur on a
 * filtered copy. Everything is applied to the composited backdrop + cells.
 */

import type { Params, TonePoint } from '../types';
import { alphaSnapshot, clamp, clipToSnapshot, scratch } from './util';

/** Build a 256-entry lookup table, or null when the curve is the identity. */
export function buildToneLUT(points: TonePoint[]): Uint8Array | null {
  if (!Array.isArray(points) || points.length < 2) return null;

  const pts = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }))
    .sort((a, b) => a.x - b.x);

  if (pts.length < 2) return null;

  const lut = new Uint8Array(256);
  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    while (seg < pts.length - 2 && x > pts[seg + 1].x) seg++;
    const a = pts[seg];
    const b = pts[seg + 1];
    const span = b.x - a.x;
    const t = span <= 0 ? (x <= a.x ? 0 : 1) : clamp((x - a.x) / span, 0, 1);
    lut[i] = Math.round(clamp(a.y + (b.y - a.y) * t, 0, 1) * 255);
  }

  for (let i = 0; i < 256; i++) {
    if (lut[i] !== i) return lut;
  }
  return null;
}

function filterChain(params: Params): string {
  const brightness = 100 + params.brightness;
  if (
    brightness === 100 &&
    params.contrast === 100 &&
    params.saturation === 100 &&
    params.grayscale === 0
  ) {
    return '';
  }
  return (
    `brightness(${clamp(brightness, 0, 300).toFixed(1)}%) ` +
    `contrast(${clamp(params.contrast, 0, 400).toFixed(1)}%) ` +
    `saturate(${clamp(params.saturation, 0, 400).toFixed(1)}%) ` +
    `grayscale(${clamp(params.grayscale, 0, 100).toFixed(1)}%)`
  );
}

/** Redraw `work` through its own colour filters. */
function applyFilterPass(work: HTMLCanvasElement, filter: string): void {
  const a = scratch(0, work.width, work.height);
  const actx = a.getContext('2d');
  const wctx = work.getContext('2d');
  if (!actx || !wctx) return;

  actx.clearRect(0, 0, a.width, a.height);
  actx.filter = filter;
  actx.drawImage(work, 0, 0);
  actx.filter = 'none';

  wctx.clearRect(0, 0, work.width, work.height);
  wctx.drawImage(a, 0, 0);
}

/**
 * Apply the tone curve to luminance while preserving hue: scale each channel
 * by the ratio of the remapped luminance to the original, so a curve never
 * washes colour out of a saturated photo.
 */
function applyToneCurve(work: HTMLCanvasElement, lut: Uint8Array): void {
  const ctx = work.getContext('2d');
  if (!ctx) return;
  const img = ctx.getImageData(0, 0, work.width, work.height);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mapped = lut[l < 0 ? 0 : l > 255 ? 255 : l | 0];
    if (l >= 1) {
      const k = mapped / l;
      d[p] = clamp(r * k, 0, 255);
      d[p + 1] = clamp(g * k, 0, 255);
      d[p + 2] = clamp(b * k, 0, 255);
    } else {
      d[p] = mapped;
      d[p + 1] = mapped;
      d[p + 2] = mapped;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Pool slot for the pre-tint alpha snapshot; 0-2 are busy in this step. */
const TINT_LAYER = 3;

function applyTint(work: HTMLCanvasElement, params: Params): void {
  if (params.tintOpacity <= 0) return;
  const ctx = work.getContext('2d');
  if (!ctx) return;

  // With `bgMode: "none"` the frame still contains genuinely empty pixels, and
  // a full-canvas blend fill turns every one of them opaque (blending against
  // alpha 0 yields alpha 1). Snapshot the alpha first and mask the result back
  // to it — the same guard anim.ts applies to its own overlay pass.
  const before = params.bgMode === 'none' ? alphaSnapshot(work, TINT_LAYER) : null;

  ctx.save();
  ctx.globalCompositeOperation = params.overlayBlend;
  ctx.globalAlpha = clamp(params.tintOpacity / 100, 0, 1);
  ctx.fillStyle = params.tint;
  ctx.fillRect(0, 0, work.width, work.height);
  ctx.restore();

  clipToSnapshot(work, before);
}

/* --------------------------------------------------------------- blur --- */

interface Stops {
  offsets: number[];
  alphas: number[];
}

function pushStop(s: Stops, offset: number, alpha: number): void {
  const prev = s.offsets.length ? s.offsets[s.offsets.length - 1] : -Infinity;
  const clamped = clamp(Number.isFinite(offset) ? offset : 0, Math.max(prev, 0), 1);
  s.offsets.push(clamped);
  s.alphas.push(clamp(alpha, 0, 1));
}

function fillGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  make: (ctx: CanvasRenderingContext2D) => CanvasGradient | null,
): void {
  const g = make(ctx);
  ctx.clearRect(0, 0, w, h);
  if (!g) {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Depth-of-field style blurs: render a blurred copy, mask it with a gradient
 * that says *where* to blur, then composite it over the sharp original.
 * Transparent mask regions keep the sharp pixels; opaque ones are fully blurred.
 */
function applyMaskedBlur(work: HTMLCanvasElement, params: Params, px: number): void {
  const w = work.width;
  const h = work.height;
  const blurred = scratch(0, w, h);
  const mask = scratch(1, w, h);

  const bctx = blurred.getContext('2d');
  const mctx = mask.getContext('2d');
  const wctx = work.getContext('2d');
  if (!bctx || !mctx || !wctx) return;

  bctx.clearRect(0, 0, w, h);
  bctx.filter = `blur(${px.toFixed(2)}px)`;
  bctx.drawImage(work, 0, 0);
  bctx.filter = 'none';

  if (params.blurType === 'tiltshift') {
    const pos = (clamp(params.tiltPosition, 0, 100) / 100) * h;
    const half = (clamp(params.tiltFocus, 0, 100) / 100) * h * 0.5;
    const feather = Math.max(2, (clamp(params.tiltFeather, 0, 100) / 100) * h * 0.5);
    const y0 = pos - half - feather;
    const y3 = pos + half + feather;
    fillGradient(mctx, w, h, (c) => {
      if (y3 - y0 < 2) return null;
      const g = c.createLinearGradient(0, y0, 0, y3);
      const s: Stops = { offsets: [], alphas: [] };
      pushStop(s, 0, 1);
      pushStop(s, pos - half - y0, 0);
      pushStop(s, pos + half - y0, 0);
      pushStop(s, 1, 1);
      for (let k = 0; k < s.offsets.length; k++) {
        g.addColorStop(s.offsets[k], `rgba(255,255,255,${s.alphas[k].toFixed(3)})`);
      }
      return g;
    });
  } else if (params.blurType === 'lens') {
    const cx = (clamp(params.blurCenterX, 0, 100) / 100) * w;
    const cy = (clamp(params.blurCenterY, 0, 100) / 100) * h;
    const maxDim = Math.max(w, h);
    const radius = Math.max(1, (clamp(params.lensFocus, 0, 100) / 100) * maxDim * 0.5);
    const feather = Math.max(2, maxDim * 0.15);
    fillGradient(mctx, w, h, (c) => {
      const g = c.createRadialGradient(cx, cy, radius, cx, cy, radius + feather);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,1)');
      return g;
    });
  } else if (params.blurType === 'progressive') {
    const pos = clamp(params.progressivePosition, 0, 100) / 100;
    fillGradient(mctx, w, h, (c) => {
      if (params.progressiveReverse) {
        const x = pos * w;
        if (x < 2) return null;
        const g = c.createLinearGradient(0, 0, x, 0);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        return g;
      }
      const x = pos * w;
      if (w - x < 2) return null;
      const g = c.createLinearGradient(x, 0, w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,1)');
      return g;
    });
  } else {
    fillGradient(mctx, w, h, () => null);
  }

  bctx.globalCompositeOperation = 'destination-in';
  bctx.drawImage(mask, 0, 0);
  bctx.globalCompositeOperation = 'source-over';

  wctx.globalAlpha = 1;
  wctx.drawImage(blurred, 0, 0);
}

/** Directional blur: average a stack of offset copies into one frame. */
function applyMotionBlur(work: HTMLCanvasElement, params: Params, px: number): void {
  const w = work.width;
  const h = work.height;
  const source = scratch(0, w, h);
  const sctx = source.getContext('2d');
  const wctx = work.getContext('2d');
  if (!sctx || !wctx) return;

  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(work, 0, 0);

  const rad = (params.blurAngle * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const both = params.directionalBothSides;
  const steps = 9;

  wctx.clearRect(0, 0, w, h);
  for (let k = 0; k < steps; k++) {
    const t = k / (steps - 1);
    const along = both ? t - 0.5 : t;
    wctx.globalAlpha = 1 / (k + 1);
    wctx.drawImage(source, ux * px * along, uy * px * along);
  }
  wctx.globalAlpha = 1;
}

function applyBlur(work: HTMLCanvasElement, params: Params): void {
  if (params.blurType === 'off') return;
  const px = clamp(params.blurAmount, 0, 100) * 0.3;
  if (px < 0.05) return;

  switch (params.blurType) {
    case 'gaussian': {
      applyFilterPass(work, `blur(${px.toFixed(2)}px)`);
      return;
    }
    case 'motion': {
      applyMotionBlur(work, params, px);
      return;
    }
    case 'tiltshift':
    case 'lens':
    case 'progressive': {
      applyMaskedBlur(work, params, px);
      return;
    }
    default:
      return;
  }
}

/* ------------------------------------------------------------- entry --- */

export function applyColor(work: HTMLCanvasElement, params: Params): void {
  const filter = filterChain(params);
  if (filter) applyFilterPass(work, filter);

  const lut = buildToneLUT(params.toneCurve);
  if (lut) applyToneCurve(work, lut);

  applyTint(work, params);
  applyBlur(work, params);
}
