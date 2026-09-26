/**
 * Step 7: reveal mask, plus the painting surface that produces it.
 *
 * The mask is an alpha channel. `mask.mode` decides which side shows the
 * *plain photo* composited back over the effect: `'exclude'` (Protect area)
 * keeps the original inside the painted zone — the historical default —
 * while `'include'` (Effect inside) puts the effect there instead. Documents
 * that predate `mode` fall back to `invert`, exactly how they rendered before.
 *
 * Painting keeps three surfaces:
 *   base     strokes already committed
 *   live     the stroke currently being dragged
 *   combined base + live, what the renderer actually consumes
 *
 * The combined surface is handed to the renderer directly while editing so
 * the reveal updates live; the data URL is only written out on stroke end,
 * because re-decoding a PNG per pointermove would thrash the image cache.
 */

import type { MaskTool, Params } from '../types';
import { drawCover } from './sample';
import { ensureSize, scratch } from './util';

/* --------------------------------------------------------- image cache --- */

const imageCache = new Map<string, HTMLImageElement>();
/** One in-flight decode per data URL, so parallel callers share the load. */
const loaders = new Map<string, Promise<HTMLImageElement | null>>();
let readyCallback: (() => void) | null = null;

/** Register a redraw hook so a mask that decodes late still gets painted. */
export function setMaskReadyCallback(fn: () => void): void {
  readyCallback = fn;
}

function load(dataUrl: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(dataUrl);
  if (cached && cached.complete && cached.naturalWidth > 0) return Promise.resolve(cached);
  const inFlight = loaders.get(dataUrl);
  if (inFlight) return inFlight;
  if (typeof Image === 'undefined') return Promise.resolve(null);

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      loaders.delete(dataUrl);
      imageCache.set(dataUrl, img);
      if (imageCache.size > 6) {
        const oldest = imageCache.keys().next().value;
        if (oldest !== undefined && oldest !== dataUrl) imageCache.delete(oldest);
      }
      readyCallback?.();
      resolve(img);
    };
    img.onerror = () => {
      loaders.delete(dataUrl);
      resolve(null);
    };
    img.src = dataUrl;
  });
  loaders.set(dataUrl, promise);
  return promise;
}

function decode(dataUrl: string): HTMLImageElement | null {
  const cached = imageCache.get(dataUrl);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  if (typeof Image === 'undefined') return null;
  void load(dataUrl);
  return null;
}

/**
 * Wait until `dataUrl` is decoded into the image cache.
 *
 * The preview consumes the live painting surface directly and never decodes
 * the data URL, so an export starting from a warm-up-free cache would render
 * its opening frames with no reveal mask at all. Encoding paths await this
 * before their first frame.
 *
 * Resolves even on a decode failure: a missing mask degrades the export the
 * way it always did instead of stalling it.
 */
export async function ensureMaskDecoded(dataUrl: string | null): Promise<void> {
  if (!dataUrl || typeof Image === 'undefined') return;
  const cached = imageCache.get(dataUrl);
  if (cached && cached.complete && cached.naturalWidth > 0) return;
  await load(dataUrl);
}

/* ----------------------------------------------------------- painting --- */

interface PaintState {
  base: HTMLCanvasElement;
  live: HTMLCanvasElement;
  combined: HTMLCanvasElement;
  w: number;
  h: number;
  open: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  tool: MaskTool;
  erase: boolean;
}

let paint: PaintState | null = null;

function makeCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

function paintState(w: number, h: number): PaintState {
  if (!paint) {
    paint = {
      base: makeCanvas(),
      live: makeCanvas(),
      combined: makeCanvas(),
      w,
      h,
      open: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      tool: 'freehand',
      erase: false,
    };
    ensureSize(paint.base, w, h);
    ensureSize(paint.live, w, h);
    ensureSize(paint.combined, w, h);
    return paint;
  }
  if (paint.w !== w || paint.h !== h) scalePaintState(paint, w, h);
  return paint;
}

function scalePaintState(state: PaintState, w: number, h: number): void {
  const scaled = makeCanvas();
  ensureSize(scaled, w, h);
  const sctx = scaled.getContext('2d');
  if (sctx && state.w > 0 && state.h > 0) {
    sctx.drawImage(state.base, 0, 0, w, h);
  }
  ensureSize(state.base, w, h);
  const bctx = state.base.getContext('2d');
  if (bctx) {
    bctx.clearRect(0, 0, w, h);
    bctx.drawImage(scaled, 0, 0);
  }
  ensureSize(state.live, w, h);
  state.live.getContext('2d')?.clearRect(0, 0, w, h);
  ensureSize(state.combined, w, h);
  state.w = w;
  state.h = h;
}

function composeCombined(state: PaintState): void {
  const ctx = state.combined.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, state.w, state.h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(state.base, 0, 0);
  ctx.drawImage(state.live, 0, 0);
}

/** The live mask surface, or null before anything has been painted. */
export function getMaskCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (!paint) return null;
  if (paint.w !== w || paint.h !== h) scalePaintState(paint, w, h);
  composeCombined(paint);
  return paint.combined;
}

export function hasPaint(): boolean {
  return paint !== null;
}

export function beginStroke(
  x: number,
  y: number,
  tool: MaskTool,
  erase: boolean,
  w: number,
  h: number,
): void {
  const state = paintState(w, h);
  state.open = true;
  state.startX = x;
  state.startY = y;
  state.lastX = x;
  state.lastY = y;
  state.tool = tool;
  state.erase = erase;
  state.live.getContext('2d')?.clearRect(0, 0, state.w, state.h);
}

export function extendStroke(x: number, y: number, size: number): void {
  if (!paint || !paint.open) return;
  const ctx = paint.live.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.globalCompositeOperation = paint.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (paint.tool === 'freehand') {
    ctx.beginPath();
    ctx.moveTo(paint.lastX, paint.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (paint.lastX === paint.startX && paint.lastY === paint.startY && x === paint.startX && y === paint.startY) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, size / 2), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (paint.tool === 'rect') {
    ctx.fillRect(
      Math.min(paint.startX, x),
      Math.min(paint.startY, y),
      Math.abs(x - paint.startX),
      Math.abs(y - paint.startY),
    );
  } else {
    const rx = Math.abs(x - paint.startX) / 2;
    const ry = Math.abs(y - paint.startY) / 2;
    const cx = (paint.startX + x) / 2;
    const cy = (paint.startY + y) / 2;
    if (rx > 0.5 || ry > 0.5) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
  paint.lastX = x;
  paint.lastY = y;
}

/** Commit the live stroke into the base layer. Returns the serialized mask. */
export function endStroke(): string | null {
  if (!paint || !paint.open) return null;
  const ctx = paint.base.getContext('2d');
  if (!ctx) return null;
  ctx.save();
  ctx.globalCompositeOperation = paint.erase ? 'destination-out' : 'source-over';
  ctx.drawImage(paint.live, 0, 0);
  ctx.restore();
  paint.live.getContext('2d')?.clearRect(0, 0, paint.w, paint.h);
  paint.open = false;
  composeCombined(paint);
  return exportMask();
}

export function clearMask(): void {
  if (!paint) return;
  paint.base.getContext('2d')?.clearRect(0, 0, paint.w, paint.h);
  paint.live.getContext('2d')?.clearRect(0, 0, paint.w, paint.h);
  paint.open = false;
  composeCombined(paint);
}

export function exportMask(): string | null {
  if (!paint) return null;
  composeCombined(paint);
  const ctx = paint.combined.getContext('2d');
  if (!ctx) return null;
  try {
    const data = ctx.getImageData(0, 0, paint.w, paint.h).data;
    for (let p = 3; p < data.length; p += 4) {
      if (data[p] !== 0) return paint.combined.toDataURL('image/png');
    }
  } catch {
    return null;
  }
  return null;
}

/** Red-tinted overlay so the user can see where the mask has been painted. */
export function drawMaskOverlay(target: HTMLCanvasElement, alpha = 0.5): void {
  if (!paint) return;
  composeCombined(paint);
  const w = target.width;
  const h = target.height;
  const tctx = target.getContext('2d');
  if (!tctx) return;

  const tinted = scratch(5, w, h);
  const ctx = tinted.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(paint.combined, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#ff3355';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  tctx.save();
  tctx.globalAlpha = alpha;
  tctx.drawImage(tinted, 0, 0);
  tctx.restore();
}

/* ------------------------------------------------------------- reveal --- */

export function applyMask(
  work: HTMLCanvasElement,
  source: CanvasImageSource,
  params: Params,
  override?: CanvasImageSource | null,
): void {
  const mask = params.mask;
  const revealAlpha =
    override ?? (mask.enabled && mask.dataUrl ? decode(mask.dataUrl) : null);
  if (!mask.enabled || !revealAlpha) return;

  const w = work.width;
  const h = work.height;
  const wctx = work.getContext('2d');
  if (!wctx) return;

  // `reveal` holds the alpha that decides where the plain photo appears.
  const reveal = scratch(0, w, h);
  const rctx = reveal.getContext('2d');
  if (!rctx) return;

  rctx.clearRect(0, 0, w, h);
  rctx.globalCompositeOperation = 'source-over';
  rctx.drawImage(revealAlpha, 0, 0, w, h);

  // 'include' puts the effect inside the painted zone; 'exclude' protects it.
  // A document without `mode` is legacy and keeps its exact old polarity
  // through `invert`, which is what it has always keyed on.
  const effectInside: boolean = mask.mode ? mask.mode === 'include' : !!mask.invert;
  if (effectInside) {
    // Reveal the original everywhere EXCEPT the paint: fill opaque, then
    // punch out where the mask painted.
    rctx.fillStyle = '#ffffff';
    rctx.fillRect(0, 0, w, h);
    rctx.globalCompositeOperation = 'destination-out';
    rctx.drawImage(revealAlpha, 0, 0, w, h);
    rctx.globalCompositeOperation = 'source-over';
  }

  const photo = scratch(1, w, h);
  const pctx = photo.getContext('2d');
  if (!pctx) return;
  pctx.clearRect(0, 0, w, h);
  pctx.globalCompositeOperation = 'source-over';
  drawCover(pctx, source, w, h);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(reveal, 0, 0);
  pctx.globalCompositeOperation = 'source-over';

  wctx.globalAlpha = 1;
  wctx.globalCompositeOperation = 'source-over';
  wctx.drawImage(photo, 0, 0);
}
