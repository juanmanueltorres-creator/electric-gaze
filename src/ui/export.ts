/**
 * Export helpers: the shared download trigger, the export-parameter clone and
 * the vertical Reel export. (The GIF lives in gif.ts but builds its params
 * with the same clone, which is why OPAQUE_BG_COLOR stays here.)
 *
 * The Reel export renders into a detached 1080x1920 canvas and records it in
 * real time with MediaRecorder. MP4/H.264 is used because Instagram rejects
 * WebM; when no MP4 mime is supported the export fails loudly instead of
 * producing a file the platform would refuse.
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { ensureMaskDecoded } from '../engine/mask';
import { renderFrame } from '../engine/render';
import type { Params } from '../types';

/** Instagram Reels standard: vertical 9:16. */
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_DURATION_MS = 5000;
export const REEL_FPS = 30;
const REEL_BITRATE = 10_000_000;
const REEL_FILENAME = 'electric-gaze-reel-1080x1920.mp4';

/**
 * The on-screen stage colour (`--bg` in style.css). H.264 has no alpha
 * channel, so a transparent backdrop would encode as black; substituting the
 * stage colour keeps the export looking like the preview.
 */
export const OPAQUE_BG_COLOR = '#05060a';

/** Tried most-specific first; the bare mime is the last resort. */
const MP4_MIME_CANDIDATES: readonly string[] = [
  'video/mp4;codecs="avc1.42E01E"',
  'video/mp4;codecs="avc1.4D401E"',
  'video/mp4;codecs="avc1.640028"',
  'video/mp4',
];

/**
 * H.264 profile/level candidates for a 1080x1920 frame.
 *
 * Level 4.0 is the floor, not a taste choice: this canvas is 68x120 = 8160
 * macroblocks per frame, and level 3.1 only permits 3600 — so the short
 * `-42E01E` string that works for 720p is rejected outright here. 4.0 allows
 * 8192, which is why every candidate below ends in `28` (or `32`, level 5.0).
 */
const AVC_CODEC_CANDIDATES: readonly string[] = [
  'avc1.640028', // High @ 4.0
  'avc1.4d4028', // Main @ 4.0
  'avc1.640032', // High @ 5.0
  'avc1.420028', // Baseline @ 4.0
];

/* ---------------------------------------------------------- download ----- */

/**
 * Hand a blob to the browser as a file download.
 *
 * Shared by every export path so the anchor/object-URL dance lives in exactly
 * one place. The URL is revoked on a timeout: revoking synchronously would
 * cancel a download that has not started yet.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------ reel ------- */

/** First supported MP4 mime, or null when this browser cannot encode MP4. */
function pickMp4Mime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of MP4_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

/**
 * Snapshot of the live parameters for export. The clone is shallow and is the
 * only Params the encoder reads, so edits made while encoding cannot change
 * the output (nested objects are shared but never written here).
 *
 * Shared by the Reel and GIF exports: both render into a canvas of a
 * different size than the preview, and both need an opaque backdrop — H.264
 * and GIF alike decode transparency as black rather than showing the stage.
 *
 * @param exportWidth width of the export canvas in pixels; the denominator
 *   that keeps the cell density equal to what was tuned on screen.
 * @param previewWidth width of the preview canvas when it is framing the same
 *   region the export renders; see the cell-size note below. Omitted (or not a
 *   finite positive number) leaves the export's cell size untouched.
 * @param forceAnimated keep `animated: true` regardless of the caller's flag.
 *   Defaults to `false`, so the Reel honours `params.animated` exactly like
 *   the PNG and the GIF do: a disabled Animate toggle comes back as a still
 *   clip, not a moving one. The GIF passes `false` explicitly for the same
 *   reason, because that flag also decides its frame count.
 */
export function cloneForExport(
  params: Params,
  exportWidth: number,
  previewWidth?: number,
  forceAnimated = false,
): Params {
  const exportParams: Params = { ...params, animated: forceAnimated ? true : params.animated };
  if (exportParams.bgMode === 'none') {
    exportParams.bgMode = 'color';
    exportParams.bgColor = OPAQUE_BG_COLOR;
    exportParams.bgOpacity = 100;
  }
  // The preview and the export show the same crop at different resolutions,
  // and `cellSize` is measured in pixels: left unscaled, a 1080-wide export
  // gets ~2.67x more cells across than the preview showed, so the result
  // would be far denser than what was tuned on screen. Scaling by the width
  // ratio keeps the number of cells across the frame — and thus the look —
  // identical between preview and export.
  if (typeof previewWidth === 'number' && Number.isFinite(previewWidth) && previewWidth > 0) {
    exportParams.cellSize = Math.max(2, Math.round(params.cellSize * (exportWidth / previewWidth)));
  }
  return exportParams;
}

/**
 * Render frames until the target duration elapses, one per animation frame.
 *
 * The wall clock only *paces* the recording — `captureStream` samples in real
 * time, so the clip has to last as long as it records, and dropping the clock
 * would cut the video in half. It no longer decides *what* is rendered: the
 * frame time is quantised onto the frame grid (`frameIndex / FPS`), the same
 * stamps the WebCodecs path uses, so both paths show the same sequence of
 * animation phases instead of whatever instant the tab happened to be at when
 * the callback fired. The encoder's own sampling is still real time — that is
 * MediaRecorder — but the frames themselves are deterministic.
 */
function recordFrames(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  params: Params,
  sourceVersion: number,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const totalFrames = Math.round((REEL_DURATION_MS / 1000) * REEL_FPS);
  const t0 = performance.now();
  return new Promise((resolve) => {
    function tick(): void {
      const elapsed = performance.now() - t0;
      // Capped at the last frame: the WebCodecs path stamps 0 .. totalFrames-1,
      // so the fallback renders the same range rather than a 151st frame the
      // encoder would never see.
      const frameIndex = Math.min(
        totalFrames - 1,
        Math.max(0, Math.floor((elapsed * REEL_FPS) / 1000)),
      );
      renderFrame(canvas, source, params, (frameIndex * 1000) / REEL_FPS, { sourceVersion });
      onProgress?.(Math.min(1, elapsed / REEL_DURATION_MS));
      if (elapsed >= REEL_DURATION_MS) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

/**
 * Real-time path: capture the canvas as a stream and let MediaRecorder mux it.
 *
 * Kept as the fallback because WebCodecs is unavailable in some browsers. Its
 * output is a fragmented MP4, and because the recorder is paced by wall-clock
 * time the export always costs as long as the clip itself.
 *
 * @param onProgress called with 0..1 as the recording advances.
 * @param previewWidth preview canvas width, forwarded to cloneForExport.
 */
async function recordWithMediaRecorder(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  params: Params,
  sourceVersion: number,
  mimeType: string,
  onProgress?: (fraction: number) => void,
  previewWidth?: number,
): Promise<Blob> {
  const exportParams = cloneForExport(params, REEL_WIDTH, previewWidth);
  const stream = canvas.captureStream(REEL_FPS);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: REEL_BITRATE,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  // `stop()` flushes a final dataavailable before the stop event, so awaiting
  // `stopped` guarantees every chunk has been collected.
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  let recordError: Error | null = null;
  recorder.onerror = (event) => {
    recordError = new Error(event.message || 'MediaRecorder failed while recording');
  };

  try {
    // Prime the first frame before recording starts, so the video never opens
    // on an untouched (transparent) canvas.
    renderFrame(canvas, source, exportParams, 0, { sourceVersion });
    recorder.start();
    await recordFrames(canvas, source, exportParams, sourceVersion, onProgress);
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    if (recordError) throw recordError;
  } finally {
    // Always release the capture tracks, including on failure.
    if (recorder.state !== 'inactive') recorder.stop();
    for (const track of stream.getTracks()) track.stop();
  }

  if (chunks.length === 0) {
    throw new Error('the recorder produced no video data');
  }

  return new Blob(chunks, { type: 'video/mp4' });
}

/* ------------------------------------------------------- webcodecs ------ */

/**
 * First H.264 profile/level the encoder actually accepts for this canvas.
 *
 * `avc: { format: 'avc' }` is load-bearing: mp4-muxer writes its `avcC` box
 * from the decoder config, which only exists in AVCC form. WebCodecs defaults
 * to `annexb`, which inlines SPS/PPS into the stream and would leave the muxer
 * with nothing to write.
 */
async function pickAvcCodec(): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of AVC_CODEC_CANDIDATES) {
    try {
      const probe = await VideoEncoder.isConfigSupported({
        codec,
        width: REEL_WIDTH,
        height: REEL_HEIGHT,
        bitrate: REEL_BITRATE,
        framerate: REEL_FPS,
        avc: { format: 'avc' },
      });
      if (probe.supported) return codec;
    } catch {
      /* a rejected candidate throws instead of reporting supported: false */
    }
  }
  return null;
}

/**
 * Preferred path: encode frame by frame with WebCodecs and mux to MP4.
 *
 * Unlike MediaRecorder this is not real time — frames are rendered as fast as
 * the encoder drains them — so the export is usually quicker than 5 s and the
 * pacing is exact instead of at the mercy of the wall clock. It also yields a
 * regular MP4 with the index at the front rather than a fragmented one.
 *
 * @param onProgress called with 0..1 as the recording advances.
 * @param previewWidth preview canvas width, forwarded to cloneForExport.
 */
async function recordWithWebCodecs(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  params: Params,
  sourceVersion: number,
  onProgress?: (fraction: number) => void,
  previewWidth?: number,
): Promise<Blob> {
  const codec = await pickAvcCodec();
  if (!codec) throw new Error('no H.264 encoder accepted a 1080x1920 config');

  const frameDurationUs = Math.round(1_000_000 / REEL_FPS);
  const totalFrames = Math.round((REEL_DURATION_MS / 1000) * REEL_FPS);
  const exportParams = cloneForExport(params, REEL_WIDTH, previewWidth);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: REEL_WIDTH, height: REEL_HEIGHT, frameRate: REEL_FPS },
    fastStart: 'in-memory',
    // No-op while the first delivered chunk is pinned to 0, but it normalises a
    // stray offset instead of aborting if the stamping below is ever bypassed.
    firstTimestampBehavior: 'offset',
  });

  // The muxer's strict mode demands DTS 0 on the very first chunk and strict
  // increase after it, and it reads that timestamp off the chunk. Some encoders
  // do not hand back a timeline that starts at 0, which kills the export before
  // a single frame is written. Frames are submitted in presentation order, so
  // the Nth chunk out is the Nth frame: stamping it here makes DTS 0 on the
  // first chunk true by construction rather than by hoping the encoder agrees.
  let outputIndex = 0;
  let firstEncoderTimestamp: number | null = null;
  let lastEncoderTimestamp: number | null = null;

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (firstEncoderTimestamp === null) firstEncoderTimestamp = chunk.timestamp;
      lastEncoderTimestamp = chunk.timestamp;
      muxer.addVideoChunk(chunk, meta, outputIndex * frameDurationUs);
      outputIndex++;
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  try {
    encoder.configure({
      codec,
      width: REEL_WIDTH,
      height: REEL_HEIGHT,
      bitrate: REEL_BITRATE,
      framerate: REEL_FPS,
      avc: { format: 'avc' },
    });

    for (let i = 0; i < totalFrames; i++) {
      if (encoderError) throw encoderError;
      renderFrame(canvas, source, exportParams, (i * 1000) / REEL_FPS, { sourceVersion });

      const frame = new VideoFrame(canvas, {
        timestamp: i * frameDurationUs,
        duration: frameDurationUs,
      });
      encoder.encode(frame, { keyFrame: i % (REEL_FPS * 2) === 0 });
      frame.close();

      onProgress?.((i + 1) / totalFrames);
      // Yield every frame: rasterising 2 MP blocks the main thread, so without
      // this the progress label never repaints and the tab looks frozen.
      await new Promise<void>((resolve) =>
        setTimeout(resolve, encoder.encodeQueueSize > 8 ? 16 : 0),
      );
    }

    await encoder.flush();
    if (encoderError) throw encoderError;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  // A short result means frames were silently dropped, and muxing it would
  // download a file that plays as a stuttering stub. Fail with the counts
  // instead so the loss is visible rather than shipped.
  if (outputIndex !== totalFrames) {
    throw new Error(
      `encoder delivered ${outputIndex}/${totalFrames} chunks ` +
        `(encoder timestamps ${firstEncoderTimestamp} .. ${lastEncoderTimestamp})`,
    );
  }

  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

/**
 * Render a 5 s 1080x1920 MP4 of the current view and download it.
 *
 * Tries WebCodecs first and MediaRecorder second. If neither can produce MP4,
 * the rejection carries every probe result and the user agent, so a failure is
 * diagnosable from the console instead of being a bare "not supported".
 *
 * @param onProgress called with 0..1 as the recording advances.
 * @param previewWidth width of the preview canvas when it is framing the same
 *   9:16 crop as the export; omitted (or not a finite positive number) leaves
 *   the export's cell size untouched.
 */
export async function exportReel(
  source: CanvasImageSource,
  params: Params,
  sourceVersion: number,
  onProgress?: (fraction: number) => void,
  previewWidth?: number,
): Promise<void> {
  // Decode the mask before the first frame. The preview feeds the renderer
  // the live painting surface and never warms the data-URL cache, so without
  // this the opening frames would render with no reveal mask at all.
  if (params.mask.enabled) await ensureMaskDecoded(params.mask.dataUrl);

  // Never inserted into the DOM: renderFrame keeps its cache in a WeakMap, so
  // this offscreen canvas resamples the source exactly once for the export.
  const canvas = document.createElement('canvas');
  canvas.width = REEL_WIDTH;
  canvas.height = REEL_HEIGHT;

  const attempts: string[] = [];
  let blob: Blob | null = null;

  try {
    blob = await recordWithWebCodecs(
      canvas,
      source,
      params,
      sourceVersion,
      onProgress,
      previewWidth,
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    attempts.push(`WebCodecs: ${detail}`);
    // Log even when the fallback below succeeds, otherwise a silently degraded
    // export looks identical to a clean one and nobody ever investigates.
    console.warn(`Electric Gaze: WebCodecs MP4 path failed, falling back — ${detail}`);
  }

  if (!blob) {
    const mimeType = pickMp4Mime();
    if (!mimeType) {
      attempts.push('MediaRecorder: no MP4 mime type supported');
    } else {
      try {
        blob = await recordWithMediaRecorder(
          canvas,
          source,
          params,
          sourceVersion,
          mimeType,
          onProgress,
          previewWidth,
        );
      } catch (err) {
        attempts.push(`MediaRecorder: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (!blob) {
    throw new Error(`MP4 export is unavailable. ${attempts.join(' | ')} | UA: ${navigator.userAgent}`);
  }

  downloadBlob(blob, REEL_FILENAME);
}