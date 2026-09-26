/**
 * GIF export.
 *
 * The Reel hands raw RGBA frames to an H.264 encoder; a GIF can do none of
 * that, and three constraints shape this path:
 *
 *   - GIF is palette-limited (256 colours) and has no usable alpha here, so
 *     `cloneForExport` swaps a transparent backdrop for the opaque stage
 *     colour before a pixel is ever read. Encoding transparency instead would
 *     paint it black in most viewers.
 *   - GIF files grow with pixels x frames, so the long edge is capped at
 *     GIF_MAX_DIM rather than exported at the preview's full resolution.
 *   - Each frame is quantized on its own (a local palette per frame), which
 *     keeps colour faithful frame by frame at the cost of the temporal
 *     consistency a single global palette would give.
 *
 * Frames are yielded between encodes for the same reason the WebCodecs path
 * does it: rasterising on the main thread without a break freezes the progress
 * label and the tab with it.
 */

import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { ensureMaskDecoded } from '../engine/mask';
import { renderFrame } from '../engine/render';
import type { Params } from '../types';
import { cloneForExport, downloadBlob } from './export';

/** Long edge of the exported GIF, in pixels. */
export const GIF_MAX_DIM = 960;
export const GIF_FPS = 15;
export const GIF_DURATION_MS = 4000;
/** GIF hard limit: 8 bits per pixel means at most 256 palette entries. */
const GIF_COLORS = 256;

/**
 * Render the current view as a GIF and download it.
 *
 * Sized from the preview dimensions so the exported aspect ratio matches
 * whatever framing is on screen — wide in 'free', 9:16 in 'vertical' — with
 * the long edge clamped to GIF_MAX_DIM.
 *
 * @param source the image being displayed.
 * @param params the live parameters; `animated` decides the frame count.
 * @param sourceVersion bumped by callers that mutate the source in place.
 * @param previewWidth preview canvas width, forwarded to cloneForExport.
 * @param previewHeight preview canvas height, used for the aspect ratio.
 * @param onProgress called with 0..1 after each frame is encoded.
 */
export async function exportGif(
  source: CanvasImageSource,
  params: Params,
  sourceVersion: number,
  previewWidth: number,
  previewHeight: number,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const scale = GIF_MAX_DIM / Math.max(previewWidth, previewHeight);
  const width = Math.max(1, Math.round(previewWidth * scale));
  const height = Math.max(1, Math.round(previewHeight * scale));

  // Never inserted into the DOM: renderFrame keeps its cache in a WeakMap, so
  // this detached canvas samples the source once and reuses it for every frame.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  // forceAnimated stays false — as it does for the Reel — so the caller's
  // `animated` flag is what both counts the frames below and switches
  // animation off inside the renderer (anim.ts returns early when it is
  // false). A static setup must produce one frame of the resting image rather
  // than an animated clip.
  const exportParams = cloneForExport(params, width, previewWidth, false);

  // Decode the mask before the first frame: the preview feeds the renderer
  // the live painting surface and never warms the data-URL cache, so without
  // this the opening frames of the GIF would render with no reveal mask.
  if (exportParams.mask.enabled) await ensureMaskDecoded(exportParams.mask.dataUrl);

  const totalFrames = params.animated ? Math.round((GIF_DURATION_MS / 1000) * GIF_FPS) : 1;
  const delay = Math.round(1000 / GIF_FPS);
  const gif = GIFEncoder();

  for (let i = 0; i < totalFrames; i++) {
    renderFrame(canvas, source, exportParams, (i * 1000) / GIF_FPS, { sourceVersion });

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error(`GIF export could not acquire a 2D context for a ${width}x${height} canvas`);
    }

    let pixels: Uint8ClampedArray;
    try {
      pixels = ctx.getImageData(0, 0, width, height).data;
    } catch (err) {
      // getImageData throws on a tainted canvas; the message would otherwise
      // be a bare SecurityError with no indication of which export failed.
      throw new Error(
        `GIF export could not read pixels from the ${width}x${height} frame: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    const palette = quantize(pixels, GIF_COLORS);
    const index = applyPalette(pixels, palette);
    // repeat: 0 = loop forever, which is the only sensible default for a
    // short effect clip; the first frame also carries the global palette.
    gif.writeFrame(index, width, height, { palette, delay, repeat: 0 });

    onProgress?.((i + 1) / totalFrames);
    // Yield every frame: rendering plus quantizing blocks the main thread, so
    // without this the progress label never repaints and the tab looks frozen.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  gif.finish();
  const bytes = gif.bytes();
  if (bytes.length === 0) {
    throw new Error(`GIF export produced no data for the ${width}x${height} frame`);
  }

  downloadBlob(new Blob([bytes], { type: 'image/gif' }), `electric-gaze-${width}x${height}.gif`);
}
