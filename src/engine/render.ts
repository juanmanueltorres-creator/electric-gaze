/**
 * Render pipeline orchestrator — the eight steps in mandated order.
 *
 *   1 backdrop   2 sample grid   3 draw cells   4 colour grade
 *   5 post-fx    6 lights        7 mask         8 animation
 *
 * Steps 2 and 3 are the expensive ones, so both are cached per target canvas
 * and only invalidated when their inputs actually change. Steps 4-8 are
 * cheap full-canvas composites and run every frame.
 */

import { applyAnimation } from './anim';
import { applyColor } from './color';
import { applyLights } from './lights';
import { applyMask } from './mask';
import { applyPfx } from './pfx';
import { drawCells } from './cells';
import { drawCover, sampleGrid, type SampleGrid } from './sample';
import { clamp, ctx2d, ensureSize, scratch } from './util';
import type { Params } from '../types';

/** Layer index reserved for the composited frame. 0-5 are transient. */
const WORK_LAYER = 9;

interface FrameCache {
  grid: SampleGrid | null;
  gridKey: string;
  cells: HTMLCanvasElement | null;
  cellsKey: string;
  source: CanvasImageSource | null;
}

const caches = new WeakMap<HTMLCanvasElement, FrameCache>();

function cacheFor(target: HTMLCanvasElement): FrameCache {
  let c = caches.get(target);
  if (!c) {
    c = { grid: null, gridKey: '', cells: null, cellsKey: '', source: null };
    caches.set(target, c);
  }
  return c;
}

/** Force the next frame to resample and redraw — call after a destructive edit. */
export function invalidate(target: HTMLCanvasElement): void {
  const c = caches.get(target);
  if (!c) return;
  c.grid = null;
  c.gridKey = '';
  c.cellsKey = '';
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  params: Params,
  w: number,
  h: number,
): void {
  const opacity = clamp(params.bgOpacity / 100, 0, 1);
  switch (params.bgMode) {
    case 'color': {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = params.bgColor || '#000000';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      break;
    }
    case 'original': {
      ctx.save();
      ctx.globalAlpha = opacity;
      drawCover(ctx, source, w, h);
      ctx.restore();
      break;
    }
    case 'blur': {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.filter = `blur(${clamp(params.bgBlur, 0, 100).toFixed(1)}px)`;
      drawCover(ctx, source, w, h);
      ctx.restore();
      break;
    }
    case 'none':
    default:
      break;
  }
}

function gridKeyFor(params: Params, w: number, h: number): string {
  return `${w}x${h}|${params.cellSize}`;
}

function cellsKeyFor(params: Params, bucket: number): string {
  return [
    params.renderMode,
    params.charSet,
    params.customChars,
    params.coverage,
    params.density,
    params.invert,
    params.edgeEmphasis,
    params.cellSize,
    bucket,
  ].join('|');
}

export interface RenderFrameOptions {
  /** Bumped by callers that mutate the source in place. */
  sourceVersion?: number;
  /**
   * Live mask surface. While the user is painting, the renderer consumes
   * this directly instead of waiting for the data URL to decode.
   */
  maskOverride?: CanvasImageSource | null;
}

export function renderFrame(
  target: HTMLCanvasElement,
  source: CanvasImageSource,
  params: Params,
  timeMs: number,
  options: RenderFrameOptions = {},
): void {
  const w = target.width;
  const h = target.height;
  if (w < 1 || h < 1) return;
  const tctx = ctx2d(target);
  if (!tctx) return;

  const cache = cacheFor(target);
  const version = options.sourceVersion ?? 0;

  /* 1 — backdrop ------------------------------------------------------- */
  const work = scratch(WORK_LAYER, w, h);
  const wctx = ctx2d(work);
  if (!wctx) return;
  wctx.setTransform(1, 0, 0, 1, 0, 0);
  wctx.globalAlpha = 1;
  wctx.filter = 'none';
  wctx.globalCompositeOperation = 'source-over';
  wctx.clearRect(0, 0, w, h);
  drawBackdrop(wctx, source, params, w, h);

  /* 2 — sample grid (cached) ------------------------------------------ */
  const gKey = `${gridKeyFor(params, w, h)}|${version}`;
  if (!cache.grid || cache.gridKey !== gKey || cache.source !== source) {
    cache.grid = sampleGrid(source, w, h, params.cellSize);
    cache.gridKey = gKey;
    cache.source = source;
    cache.cellsKey = '';
  }
  const grid = cache.grid;
  if (!grid) return;

  /* 3 — cell layer (cached) ------------------------------------------- */
  // `matrix` and `disco` animate inside the cell layer, so they alone need a
  // per-frame bucket; every other mode is fully described by its parameters.
  // Without a bucket the cells key never changes for those two, the cache
  // keeps serving the first frame and their time-dependent paint (code-rain
  // head, rotating hue) freezes after one draw.
  const timeDriven = params.renderMode === 'matrix' || params.renderMode === 'disco';
  const bucket = timeDriven && params.animated ? Math.floor(timeMs / 55) : 0;
  const cKey = `${w}x${h}|${cellsKeyFor(params, bucket)}`;
  if (!cache.cells || cache.cellsKey !== cKey) {
    const canvas = cache.cells ?? (cache.cells = document.createElement('canvas'));
    ensureSize(canvas, w, h);
    const cctx = ctx2d(canvas);
    if (!cctx) return;
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.globalAlpha = 1;
    cctx.filter = 'none';
    cctx.globalCompositeOperation = 'source-over';
    drawCells(cctx, grid, params, timeMs);
    cache.cellsKey = cKey;
  }

  wctx.save();
  wctx.globalCompositeOperation = params.styleBlend;
  wctx.drawImage(cache.cells, 0, 0);
  wctx.restore();

  /* 4 — colour --------------------------------------------------------- */
  applyColor(work, params);

  /* 5 — post effects --------------------------------------------------- */
  applyPfx(work, params, timeMs);

  /* 6 — lights --------------------------------------------------------- */
  applyLights(work, params);

  /* 7 — mask ----------------------------------------------------------- */
  applyMask(work, source, params, options.maskOverride);

  /* 8 — animation ------------------------------------------------------ */
  applyAnimation(work, params, timeMs);

  /* Present ------------------------------------------------------------ */
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.globalAlpha = 1;
  tctx.filter = 'none';
  tctx.globalCompositeOperation = 'source-over';
  tctx.clearRect(0, 0, w, h);
  tctx.drawImage(work, 0, 0);
}
