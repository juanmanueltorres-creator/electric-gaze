/**
 * Grid sampling.
 *
 * The photo is drawn once at the target size and reduced to a grid of cells.
 * Each cell keeps its average colour, its overall luminance, separate top and
 * bottom half luminances (needed by `halfblocks`) and a normalised edge
 * magnitude (needed by `edgeEmphasis`).
 *
 * Sampling is the expensive step, so the caller caches the result and only
 * rebuilds it when the source, the canvas size or `cellSize` change.
 */

export interface SampleGrid {
  cols: number;
  rows: number;
  cellSize: number;
  width: number;
  height: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  lum: Float32Array;
  lumTop: Float32Array;
  lumBot: Float32Array;
  edge: Float32Array;
  /** Effective (inverted + edge boosted) luminance, rebuilt by the cell layer. */
  eff: Float32Array;
}

/** Pooled readback canvas. Reused across samples to avoid per-frame allocation. */
let scratchCanvas: HTMLCanvasElement | null = null;

function getScratch(): HTMLCanvasElement | null {
  if (!scratchCanvas) {
    if (typeof document === 'undefined') return null;
    scratchCanvas = document.createElement('canvas');
  }
  return scratchCanvas;
}

function intrinsicSize(source: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { w: source.videoWidth, h: source.videoHeight };
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return { w: source.naturalWidth, h: source.naturalHeight };
  }
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    return { w: source.width, h: source.height };
  }
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) {
    return { w: source.width, h: source.height };
  }
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return { w: source.width, h: source.height };
  }
  // ImageData / blob-backed sources: ask the context we are drawing into.
  return { w: 0, h: 0 };
}

/**
 * Cover-fit a source into a box: fills the target without letterboxing,
 * cropping whatever falls outside. Photos read much better this way than
 * contain-fit, which leaves dead bands around the effect.
 */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
): void {
  const { w: srcW, h: srcH } = intrinsicSize(source);
  if (!srcW || !srcH) {
    ctx.drawImage(source, 0, 0, width, height);
    return;
  }
  const scale = Math.max(width / srcW, height / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

/** Rec.709 relative luminance of an sRGB triple in 0..255. */
export function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function sampleGrid(
  source: CanvasImageSource,
  width: number,
  height: number,
  cellSize: number,
): SampleGrid {
  const cs = Math.max(2, Math.round(cellSize));
  const cols = Math.max(1, Math.ceil(width / cs));
  const rows = Math.max(1, Math.ceil(height / cs));
  const n = cols * rows;

  const canvas = getScratch();
  const ctx = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;
  if (!canvas || !ctx) {
    return emptyGrid(cols, rows, cs, width, height, n);
  }

  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  drawCover(ctx, source, width, height);

  const data = ctx.getImageData(0, 0, width, height).data;

  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const lum = new Float32Array(n);
  const lumTop = new Float32Array(n);
  const lumBot = new Float32Array(n);
  const sumW = new Float32Array(n);
  const sumWT = new Float32Array(n);
  const sumWB = new Float32Array(n);
  const sumL = new Float32Array(n);
  const sumLT = new Float32Array(n);
  const sumLB = new Float32Array(n);

  for (let py = 0; py < height; py++) {
    const cellRow = Math.min(rows - 1, (py / cs) | 0);
    const midY = (cellRow + 0.5) * cs;
    const isTop = py < midY;
    const rowOffset = cellRow * cols;
    const yBase = py * width;

    for (let px = 0; px < width; px++) {
      const i = rowOffset + Math.min(cols - 1, (px / cs) | 0);
      const di = (yBase + px) * 4;
      const R = data[di];
      const G = data[di + 1];
      const B = data[di + 2];
      const L = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;

      sumW[i] += 1;
      sumL[i] += L;
      r[i] += R;
      g[i] += G;
      b[i] += B;
      if (isTop) {
        sumWT[i] += 1;
        sumLT[i] += L;
      } else {
        sumWB[i] += 1;
        sumLB[i] += L;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const w = sumW[i] || 1;
    r[i] /= w;
    g[i] /= w;
    b[i] /= w;
    lum[i] = sumL[i] / w;
    lumTop[i] = sumWT[i] ? sumLT[i] / sumWT[i] : lum[i];
    lumBot[i] = sumWB[i] ? sumLB[i] / sumWB[i] : lum[i];
  }

  // Edge magnitude: normalised luminance gradient against the right and
  // bottom neighbours, plus a diagonal term so diagonal boundaries register.
  const edge = new Float32Array(n);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const here = lum[i];
      const right = x + 1 < cols ? lum[i + 1] : here;
      const down = y + 1 < rows ? lum[i + cols] : here;
      const dr = Math.abs(here - right);
      const dd = Math.abs(here - down);
      const diag = x + 1 < cols && y + 1 < rows ? Math.abs(here - lum[i + cols + 1]) : 0;
      edge[i] = Math.min(1, (dr + dd) * 0.5 + diag * 0.25) * 4;
    }
  }

  return {
    cols,
    rows,
    cellSize: cs,
    width,
    height,
    r,
    g,
    b,
    lum,
    lumTop,
    lumBot,
    edge,
    eff: new Float32Array(n),
  };
}

function emptyGrid(
  cols: number,
  rows: number,
  cellSize: number,
  width: number,
  height: number,
  n: number,
): SampleGrid {
  return {
    cols,
    rows,
    cellSize,
    width,
    height,
    r: new Float32Array(n),
    g: new Float32Array(n),
    b: new Float32Array(n),
    lum: new Float32Array(n),
    lumTop: new Float32Array(n),
    lumBot: new Float32Array(n),
    edge: new Float32Array(n),
    eff: new Float32Array(n),
  };
}
