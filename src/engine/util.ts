/**
 * Small canvas helpers and a pooled scratch-canvas allocator.
 *
 * The pool holds *resources*, not application state: canvases are memoized
 * by index and only resized when the target dimensions change. Resizing a
 * canvas clears it, so `ensureSize` returning true tells callers they must
 * redraw from scratch.
 */

const pool: HTMLCanvasElement[] = [];

export function scratch(index: number, width: number, height: number): HTMLCanvasElement {
  let canvas = pool[index];
  if (!canvas) {
    canvas = document.createElement('canvas');
    pool[index] = canvas;
  }
  ensureSize(canvas, width, height);
  return canvas;
}

export function ensureSize(canvas: HTMLCanvasElement, width: number, height: number): boolean {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

export function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext('2d');
}

export interface BlitOptions {
  /** CSS filter applied while drawing. */
  filter?: string;
  composite?: GlobalCompositeOperation;
  alpha?: number;
}

/** Copy `src` onto `dst`, optionally filtered, blended and alpha-scaled. */
export function blit(
  dst: HTMLCanvasElement,
  src: CanvasImageSource,
  options: BlitOptions = {},
): void {
  const ctx = dst.getContext('2d');
  if (!ctx) return;
  const prevFilter = ctx.filter;
  const prevComposite = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;

  ctx.filter = options.filter ?? 'none';
  ctx.globalCompositeOperation = options.composite ?? 'source-over';
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.drawImage(src, 0, 0);
  ctx.filter = prevFilter;
  ctx.globalCompositeOperation = prevComposite;
  ctx.globalAlpha = prevAlpha;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Copy `canvas` into a pooled scratch layer so a later pass can mask itself
 * back to the alpha it started with (`destination-in`).
 *
 * `scratch` only clears when the dimensions change, so the copy is preceded by
 * an explicit clear: a stale layer would leave the previous frame's alpha in
 * the corners of this one.
 *
 * @param index pool slot. 0-2 are the pipeline's working layers, 5 the mask
 *   overlay and 6 the animation snapshot, so callers take 3 or 4.
 */
export function alphaSnapshot(
  canvas: HTMLCanvasElement,
  index: number,
): HTMLCanvasElement | null {
  const snap = scratch(index, canvas.width, canvas.height);
  const sctx = snap.getContext('2d');
  if (!sctx) return null;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalAlpha = 1;
  sctx.globalCompositeOperation = 'source-over';
  sctx.filter = 'none';
  sctx.clearRect(0, 0, snap.width, snap.height);
  sctx.drawImage(canvas, 0, 0);
  return snap;
}

/** Clip `canvas` back to the alpha carried by `snap` — see `alphaSnapshot`. */
export function clipToSnapshot(
  canvas: HTMLCanvasElement,
  snap: HTMLCanvasElement | null,
): void {
  if (!snap) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(snap, 0, 0);
  ctx.restore();
}

/** Parse #rgb / #rrggbb, falling back to black on anything unparseable. */
export function parseHex(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [0, 0, 0];
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (ch) => ch + ch);
  const v = parseInt(hex, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Deterministic 32-bit hash → 0..1. Same input always yields same noise. */
export function hash01(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
