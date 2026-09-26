/**
 * Step 8: animation.
 *
 * A post-pass over the finished frame. It modulates the look without ever
 * re-sampling the source or touching the grid, which is what keeps the cell
 * layer cacheable at 60fps.
 *
 * `wave`/`ripple`/`shimmer` ride on `overlay`, whose neutral value is 128
 * grey — so a gradient can brighten on one side of the cycle and darken on
 * the other in a single pass.
 */

import type { AnimStyle, Params } from '../types';
import { clamp, hash01, scratch } from './util';

const TAU = Math.PI * 2;
const NEUTRAL = 128;

/**
 * Pool slot for the pre-animation alpha snapshot. Animation runs last, so it
 * never overlaps the layers the colour/mask/post-effect steps borrow (0, 1, 2).
 */
const ANIM_LAYER = 6;

function tone(v: number, amp: number): string {
  const c = Math.round(clamp(NEUTRAL + v * 127 * amp, 0, 255));
  return `rgb(${c},${c},${c})`;
}

function addStops(g: CanvasGradient, stops: Array<[number, string]>): void {
  stops.sort((a, b) => a[0] - b[0]);
  let last = -Infinity;
  for (const [rawT, color] of stops) {
    const t = clamp(rawT, Math.max(last, 0), 1);
    g.addColorStop(t, color);
    last = t;
  }
}

/** Cycle rate in radians per millisecond for each style. */
const BASE_RATE: Record<AnimStyle, number> = {
  wave: TAU / 3000,
  shimmer: TAU / 2800,
  ripple: TAU / 2600,
  pulse: TAU / 2400,
  flicker: TAU / 1000,
};

/**
 * Wall-clock milliseconds for one full cycle of each style at Speed 100%, or
 * `null` when the style has no cycle at all.
 *
 * Derived from what the pass below actually paints, not from `BASE_RATE`:
 * `shimmer` does not ride on `phase` — it advances its own band through a
 * 3200 ms wrap — and `flicker` steps a pseudo-random hash, so its frame at
 * t = 0 is not its frame at t = D for any meaningful D. Exporters and the AI
 * prompt read this to say honestly whether a given clip length lands on a
 * cycle boundary; a "seamless loop" claim has to come from here.
 */
export const ANIM_CYCLE_MS: Record<AnimStyle, number | null> = {
  wave: 3000,
  shimmer: 3200,
  ripple: 2600,
  pulse: 2400,
  flicker: null,
};

function wave(ctx: CanvasRenderingContext2D, w: number, h: number, phase: number, amp: number): void {
  const g = ctx.createLinearGradient(0, h, w, 0);
  const cycles = 2;
  const n = cycles * 8;
  const stops: Array<[number, string]> = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    stops.push([t, tone(Math.sin(t * TAU * cycles + phase), amp)]);
  }
  addStops(g, stops);
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function shimmer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeMs: number,
  speed: number,
  amp: number,
): void {
  // Travels from just before the left edge to just past the right, so the
  // band enters and exits instead of snapping back at the border.
  const pos = -0.25 + (((timeMs * speed) / 3200) % 1) * 1.5;
  const band = 0.16;
  const g = ctx.createLinearGradient(0, h, w, 0);
  addStops(g, [
    [0, tone(0, amp)],
    [pos - band, tone(0, amp)],
    [pos, tone(1, amp)],
    [pos + band, tone(0, amp)],
    [1, tone(0, amp)],
  ]);
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function ripple(ctx: CanvasRenderingContext2D, w: number, h: number, phase: number, amp: number): void {
  const maxR = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, maxR);
  const cycles = 3;
  const n = cycles * 8;
  const stops: Array<[number, string]> = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    stops.push([t, tone(Math.sin(t * TAU * cycles - phase), amp)]);
  }
  addStops(g, stops);
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function pulse(ctx: CanvasRenderingContext2D, w: number, h: number, phase: number, amp: number): void {
  const v = Math.sin(phase);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.abs(v) * amp;
  ctx.fillStyle = v >= 0 ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

function flicker(
  w: number,
  h: number,
  ctx: CanvasRenderingContext2D,
  timeMs: number,
  speed: number,
  amp: number,
): void {
  // Steps ~14 times a second: a smooth flicker reads as a breathing filter,
  // a stepped one reads as a failing tube. This is the failing-tube one.
  // The step clock runs on speed-scaled time so Speed % actually changes the
  // rate — at 100% it is the original 70 ms step, at 50% half as often, and
  // at 0% the step never advances (the tube holds one state). Every other
  // style already scales its phase the same way.
  const frame = Math.floor((timeMs * speed) / 70);
  const v = hash01(3, 11, frame) * 2 - 1;
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.abs(v) * amp * 0.75;
  ctx.fillStyle = v >= 0 ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

export function applyAnimation(canvas: HTMLCanvasElement, params: Params, timeMs: number): void {
  if (!params.animated) return;
  // The two toggles gate their own slider rather than overriding it: off means
  // the parameter contributes nothing. Reading them as "1" used to turn
  // "Intensity on"/"Speed on" off into full intensity and full speed, which is
  // the opposite of what an off switch says. Intensity 0 skips the pass
  // entirely (no modulation at all); speed 0 freezes the motion in place.
  const amp =
    (params.animIntensity?.enabled ? clamp(params.animIntensity.intensity, 0, 100) / 100 : 0) * 0.42;
  if (amp <= 0.002) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  const speed = params.animSpeed?.enabled ? clamp(params.animSpeed.intensity, 0, 100) / 100 : 0;
  const rate = BASE_RATE[params.animStyle] ?? BASE_RATE.wave;
  const phase = timeMs * rate * speed;

  // Every style below paints an opaque fill with `overlay`. Per the Canvas
  // compositing formula the non-blended term is source-over, so wherever the
  // frame is transparent — which is the whole point of `bgMode: "none"` — the
  // gradient's neutral grey would be composited at full alpha and flood the
  // empty pixels. Snapshot the frame first and mask the result back to it, so
  // animation only ever modulates pixels that already existed.
  const before = scratch(ANIM_LAYER, w, h);
  const bctx = before.getContext('2d');
  if (!bctx) return;
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.globalAlpha = 1;
  bctx.globalCompositeOperation = 'source-over';
  bctx.filter = 'none';
  bctx.clearRect(0, 0, w, h);
  bctx.drawImage(canvas, 0, 0);

  ctx.save();
  switch (params.animStyle) {
    case 'wave':
      wave(ctx, w, h, phase, amp);
      break;
    case 'shimmer':
      shimmer(ctx, w, h, timeMs, speed, amp);
      break;
    case 'ripple':
      ripple(ctx, w, h, phase, amp);
      break;
    case 'pulse':
      pulse(ctx, w, h, phase, amp);
      break;
    case 'flicker':
      flicker(w, h, ctx, timeMs, speed, amp);
      break;
    default:
      wave(ctx, w, h, phase, amp);
  }
  ctx.restore();

  ctx.save();
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(before, 0, 0);
  ctx.restore();
}
