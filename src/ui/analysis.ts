/**
 * Source-image description for the AI prompt.
 *
 * The prompt asks a model to recreate a subject it cannot see, so the facts
 * about the loaded image — size, framing, dominant colours, overall
 * brightness — must be measured rather than guessed. They are derived here
 * from one pixel readback of a ~64 px thumbnail: client-side only, no
 * network calls, no new dependencies and no randomness, so the same image
 * always yields the same description and prompts stay diffable.
 *
 * Every failure path degrades to a minimal (zero-size, empty-palette)
 * description instead of throwing: the prompt is still useful without the
 * facts, and it must never break the copy action.
 */

import { luma } from '../engine/sample';

/** What the prompt needs to know about the loaded image. */
export interface ImageDescription {
  /** Intrinsic source width in px; 0 when unknown or unreadable. */
  width: number;
  /** Intrinsic source height in px; 0 when unknown or unreadable. */
  height: number;
  /** Width:height reduced by gcd, e.g. `1920x1080` -> `16:9`; `0:0` when unknown. */
  aspect: string;
  orientation: 'landscape' | 'portrait' | 'square';
  /** Up to six dominant colours, most frequent first, lowercase `#rrggbb`. */
  palette: string[];
  /** Mean Rec.709 luminance bucketed into three readable labels. */
  brightness: 'dark' | 'balanced' | 'bright';
}

/** Longest side of the sampling thumbnail: enough for colour, cheap to read. */
const BOX = 64;

/** Alpha at or above this counts towards the palette; faded-out pixels don't. */
const OPAQUE = 128;

/** A source we cannot measure: no size, no colours, nothing to describe. */
function emptyDescription(): ImageDescription {
  return {
    width: 0,
    height: 0,
    aspect: '0:0',
    orientation: 'square',
    palette: [],
    brightness: 'balanced',
  };
}

/**
 * Intrinsic pixel size of a drawable source, mirroring the sampler's
 * detection: the DOM element types expose their size differently, and
 * anything else (blob-backed sources, ImageData) reports 0 so the caller
 * can decide whether to bail out.
 */
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
  return { w: 0, h: 0 };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Reduced `w:h` pair; `0:0` for a source with no measurable size. */
function aspectOf(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '0:0';
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

/** One hex channel: `toString(16)` is lowercase, matching the prompt's style. */
function hex2(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

/**
 * Bucket the sampled pixels into coarse RGB cells (each channel >> 5, i.e.
 * 32 levels) and summarise the six largest buckets plus the mean luminance.
 *
 * Pure by design: the canvas plumbing stays in `describeImage`, and this
 * part can be reasoned about (and tested) on raw bytes alone.
 */
function describePixels(data: Uint8ClampedArray, width: number, height: number): ImageDescription {
  interface Bucket {
    count: number;
    r: number;
    g: number;
    b: number;
  }

  const buckets = new Map<number, Bucket>();
  let lumSum = 0;
  let opaque = 0;

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < OPAQUE) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
    lumSum += luma(r, g, b);
    opaque++;
  }

  // Ties break on the bucket key so the palette order depends only on the
  // pixels, never on Map iteration accidents.
  const palette = [...buckets.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0] - b[0])
    .slice(0, 6)
    .map(
      ([, bucket]) =>
        `#${hex2(bucket.r / bucket.count)}${hex2(bucket.g / bucket.count)}${hex2(
          bucket.b / bucket.count,
        )}`,
    );

  const mean = opaque > 0 ? lumSum / opaque : 0.5;
  const brightness = mean < 0.35 ? 'dark' : mean > 0.65 ? 'bright' : 'balanced';

  return {
    width,
    height,
    aspect: aspectOf(width, height),
    orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square',
    palette,
    brightness,
  };
}

/**
 * Measure a drawable source for the prompt: intrinsic size, reduced aspect,
 * orientation, the six dominant opaque colours and the overall brightness.
 *
 * The source is drawn into a small offscreen canvas that keeps its aspect
 * ratio (so nothing is stretched or cropped) and read back once. Tainted
 * canvases, unsupported sources and missing DOM all fall back to
 * {@link emptyDescription}.
 */
export function describeImage(source: CanvasImageSource): ImageDescription {
  if (typeof document === 'undefined') return emptyDescription();

  const { w, h } = intrinsicSize(source);
  if (w <= 0 || h <= 0) return emptyDescription();

  const tw = w >= h ? BOX : Math.max(1, Math.round((BOX * w) / h));
  const th = w >= h ? Math.max(1, Math.round((BOX * h) / w)) : BOX;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return emptyDescription();
    ctx.drawImage(source, 0, 0, tw, th);
    return describePixels(ctx.getImageData(0, 0, tw, th).data, w, h);
  } catch {
    return emptyDescription();
  }
}
