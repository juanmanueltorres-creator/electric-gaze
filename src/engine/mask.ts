/**
 * Reveal mask: the radial point list (primary flow), the painting surface
 * (advanced/manual), and how the two become the one alpha the renderer reads.
 *
 * The mask is an alpha channel. `mask.mode` decides which side shows the
 * *plain photo* composited back over the effect: `'exclude'` (Protect area)
 * keeps the original inside the masked zone — the historical default —
 * while `'include'` (Effect inside) puts the effect there instead. Documents
 * that predate `mode` fall back to `invert`, exactly how they rendered before.
 *
 * Two layers produce that alpha:
 *   radial  `mask.radialPoints`, parametric circles — no painting required
 *   paint   the painted bitmap (base / live / combined)
 * They combine with `max` per pixel — never a sum, so the two layers can
 * never saturate into a stronger mask than either one alone. Feathering
 * reshapes the MASK alpha only: the output is never blurred by it.
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

import type { MaskState, MaskTool, Params, RadialMaskPoint } from '../types';
import { drawCover } from './sample';
import { ensureSize, scratch } from './util';

/* --------------------------------------------------------- image cache --- */

const imageCache = new Map<string, HTMLImageElement>();
/** One in-flight decode per data URL, so parallel callers share the load. */
const loaders = new Map<string, Promise<HTMLImageElement | null>>();
let readyCallback: (() => void) | null = null;

/**
 * Identity of the paint bitmap — the live surface and its data-URL twin —
 * for cache invalidation. Every path that mutates the paint bitmap bumps it,
 * and so does a mask image newly landing in the decode cache: the bitmap it
 * stands for just changed, so a combine frame built from the old one is stale.
 */
let paintVersion = 0;

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
      // A new decode is a new paint bitmap: cached combine frames keyed on
      // the old one must not be served.
      paintVersion++;
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
  // The bitmap was rescaled: cached combine frames no longer match it.
  paintVersion++;
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
  paintVersion++;
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
  paintVersion++;
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
  paintVersion++;
  return exportMask();
}

export function clearMask(): void {
  if (!paint) return;
  paint.base.getContext('2d')?.clearRect(0, 0, paint.w, paint.h);
  paint.live.getContext('2d')?.clearRect(0, 0, paint.w, paint.h);
  paint.open = false;
  composeCombined(paint);
  paintVersion++;
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

/* ------------------------------------------------------- radial points --- */

/** Clamped, integer per-point bounding box in canvas pixels (inclusive). */
interface RadialBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface RadialEntry {
  /** The cache key this entry was built for. */
  key: string;
  canvas: HTMLCanvasElement;
  boxes: RadialBox[];
}

interface CombineEntry {
  canvas: HTMLCanvasElement;
}

/**
 * Both caches are hard-capped at 2 entries: the preview and an export canvas
 * of a different size can interleave frames, and a third size simply evicts
 * the least recently inserted one instead of growing without bound.
 */
const CACHE_MAX_ENTRIES = 2;
const radialCache = new Map<string, RadialEntry>();
const combineCache = new Map<string, CombineEntry>();

function capCache<V>(map: Map<string, V>): void {
  while (map.size > CACHE_MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

/** `t*t*(3-2t)` — the smoothstep the feather falloff is measured with. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Rasterize the radial points into a white alpha layer.
 *
 * Only each point's bounding box is visited, so dragging a slider over a
 * large canvas stays smooth. `feather` shapes this alpha and nothing else:
 * `inner = r * (1 - feather/100)`, full strength inside `d <= inner`, zero
 * outside `d >= r`, smoothstep in between. With `feather = 0` `inner === r`,
 * so the falloff branch (the only division by `span`) is unreachable.
 */
function renderRadial(points: RadialMaskPoint[], w: number, h: number): RadialEntry {
  const key = `${w}x${h}|${JSON.stringify(points)}`;
  const hit = radialCache.get(key);
  if (hit) return hit;

  const canvas = makeCanvas();
  ensureSize(canvas, w, h);
  const boxes: RadialBox[] = [];
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const img = ctx.createImageData(w, h);
    const data = img.data;
    const shorter = Math.min(w, h);

    for (const p of points) {
      if (p.strength <= 0 || p.radius <= 0) continue;
      const cx = p.x * w;
      const cy = p.y * h;
      const r = Math.max(1, p.radius * shorter);
      const inner = r * (1 - p.feather / 100);
      const span = r - inner;
      const s = p.strength / 100;

      const x0 = Math.max(0, Math.floor(cx - r));
      const y0 = Math.max(0, Math.floor(cy - r));
      const x1 = Math.min(w - 1, Math.ceil(cx + r));
      const y1 = Math.min(h - 1, Math.ceil(cy + r));
      if (x1 < x0 || y1 < y0) continue;
      boxes.push({ x0, y0, x1, y1 });

      for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const d = Math.sqrt(dx * dx + dy * dy);
          let a: number;
          if (d <= inner) a = s;
          else if (d >= r) a = 0;
          else a = s * (1 - smoothstep((d - inner) / span));
          if (a <= 0) continue;
          const i = (y * w + x) * 4;
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          const alpha = Math.round(a * 255);
          if (alpha > data[i + 3]) data[i + 3] = alpha;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  const entry: RadialEntry = { key, canvas, boxes };
  radialCache.set(key, entry);
  capCache(radialCache);
  return entry;
}

/**
 * The single alpha the include/exclude body consumes.
 *
 * No radial points → the paint source is returned untouched: a paint-only
 * config runs exactly the code it always ran, with no new per-pixel work.
 * No paint → the radial layer alone. Both → `max` per alpha byte over the
 * radial boxes only. Never a sum: adding the alphas would saturate a
 * partial feather into a full mask.
 *
 * The result is cached by radial key + `paintVersion`, so an idle preview
 * frame does no pixel work just because animation is running, while a live
 * stroke (which bumps the version) rebuilds it.
 */
export function buildRevealAlpha(
  mask: MaskState,
  w: number,
  h: number,
  paintSource: CanvasImageSource | null,
): CanvasImageSource | null {
  const points = mask.radialPoints;
  if (points.length === 0) return paintSource;

  const radial = renderRadial(points, w, h);
  if (!paintSource) return radial.canvas;

  const key = `${radial.key}|${paintVersion}|p`;
  const cached = combineCache.get(key);
  if (cached) return cached.canvas;

  const canvas = makeCanvas();
  ensureSize(canvas, w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return radial.canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(paintSource, 0, 0, w, h);

  const rctx = radial.canvas.getContext('2d');
  if (rctx) {
    try {
      for (const box of radial.boxes) {
        const bw = box.x1 - box.x0 + 1;
        const bh = box.y1 - box.y0 + 1;
        if (bw <= 0 || bh <= 0) continue;
        const paintData = ctx.getImageData(box.x0, box.y0, bw, bh);
        const radialData = rctx.getImageData(box.x0, box.y0, bw, bh);
        const pd = paintData.data;
        const rd = radialData.data;
        for (let i = 3; i < pd.length; i += 4) {
          if (rd[i] > pd[i]) pd[i] = rd[i];
        }
        ctx.putImageData(paintData, box.x0, box.y0);
      }
    } catch {
      // getImageData only throws on a tainted canvas (a cross-origin mask
      // URL pasted into a config). The paint layer already applied.
    }
  }

  combineCache.set(key, { canvas });
  capCache(combineCache);
  return canvas;
}

/**
 * Preview-only editing guide: the circles the radial points describe.
 *
 * Pure UI furniture — it is drawn after `renderFrame` and therefore never
 * enters the effect and never reaches an export, which re-renders instead of
 * reading the preview back.
 */
export function drawRadialGuide(target: HTMLCanvasElement, points: RadialMaskPoint[]): void {
  if (points.length === 0) return;
  const w = target.width;
  const h = target.height;
  if (w < 1 || h < 1) return;
  const ctx = target.getContext('2d');
  if (!ctx) return;

  const lineWidth = Math.max(1, Math.round(h / 300));
  ctx.save();
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = lineWidth;
  ctx.fillStyle = '#00e5ff';

  for (const p of points) {
    const cx = p.x * w;
    const cy = p.y * h;
    const r = p.radius * Math.min(w, h);

    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2);
    ctx.stroke();

    const inner = r * (1 - p.feather / 100);
    if (p.feather > 0 && inner > 2) {
      ctx.setLineDash([4, 6]);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, inner, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, lineWidth * 1.5), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* ------------------------------------------------------------- reveal --- */

export function applyMask(
  work: HTMLCanvasElement,
  source: CanvasImageSource,
  params: Params,
  override?: CanvasImageSource | null,
): void {
  const mask = params.mask;
  if (!mask.enabled) return;
  const paintSource: CanvasImageSource | null =
    override ?? (mask.dataUrl ? decode(mask.dataUrl) : null);
  const revealAlpha = buildRevealAlpha(mask, work.width, work.height, paintSource);
  if (!revealAlpha) return;

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
