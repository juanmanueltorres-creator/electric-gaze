/**
 * Cell layer: turns the sampled grid into shapes.
 *
 * Two passes:
 *   1. build `grid.eff` — luminance after `invert` and `edgeEmphasis`
 *   2. dispatch every covered cell to its renderMode primitive
 *
 * All per-frame randomness is a hash of (cell, seed). No Math.random(), so
 * the picture never crawls between frames.
 */

import type { Params, RenderMode } from '../types';
import { CHAR_RAMPS, RENDER_MODES } from '../types';
import type { SampleGrid } from './sample';

const TAU = Math.PI * 2;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Braille dot bit order: column-major reading order, progressive by level. */
const BRAILLE_ORDER = [0, 3, 1, 4, 2, 5, 6, 7];

const MATRIX_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEF';

const MIXED_POOL: RenderMode[] = ['dots', 'cross', 'diamond', 'triangles', 'lines', 'rings'];

const CONTOUR_LEVELS = 6;

interface CellState {
  ctx: CanvasRenderingContext2D;
  grid: SampleGrid;
  params: Params;
  i: number;
  c: number;
  r: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  cs: number;
  /** shape scale, driven by density */
  ss: number;
  /** density 0..1 */
  dn: number;
  L: number;
  R: number;
  G: number;
  B: number;
  col: string;
  time: number;
}

/* ------------------------------------------------------------- utilities */

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function rand01(x: number, y: number): number {
  return hash2(x, y) / 4294967296;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function shade(s: CellState, f: number): string {
  return `rgb(${Math.round(clamp(s.R * f, 0, 255))},${Math.round(
    clamp(s.G * f, 0, 255),
  )},${Math.round(clamp(s.B * f, 0, 255))})`;
}

function rampFor(params: Params): string {
  if (params.charSet === 'custom') {
    return params.customChars.length > 0 ? params.customChars : CHAR_RAMPS.standard;
  }
  return CHAR_RAMPS[params.charSet];
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.beginPath();
  const inner = radius * 0.382;
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? radius : inner;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function heartPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  // Classic implicit heart, sampled: x = 16 sin^3 t, y = 13 cos t - ...
  const k = size / 34;
  ctx.beginPath();
  for (let n = 0; n <= 48; n++) {
    const t = (n / 48) * TAU;
    const sx = 16 * Math.pow(Math.sin(t), 3);
    const sy =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    const px = cx + sx * k;
    const py = cy - sy * k;
    if (n === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function polygonPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
): void {
  ctx.beginPath();
  for (let k = 0; k < sides; k++) {
    const a = rotation + (k * TAU) / sides;
    const px = cx + Math.cos(a) * radius;
    const py = cy + Math.sin(a) * radius;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/* --------------------------------------------------------------- drawCell */

function drawCell(s: CellState, mode: RenderMode): void {
  const { ctx, cs, ss, L, col, cx, cy, x, y, c, r, i, grid } = s;
  const half = cs / 2;

  switch (mode) {
    case 'characters': {
      const ramp = rampFor(s.params);
      const last = ramp.length - 1;
      const idx = Math.round(clamp(L, 0, 1) * last);
      ctx.fillStyle = col;
      ctx.fillText(ramp[idx], cx, cy);
      break;
    }

    case 'dither': {
      const sub = cs / 4;
      const sz = sub * Math.min(1, 0.5 + s.dn * 0.5);
      ctx.fillStyle = col;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const threshold = (BAYER4[sy * 4 + sx] + 0.5) / 16;
          if (L <= threshold) continue;
          const px = x + sx * sub + (sub - sz) / 2;
          const py = y + sy * sub + (sub - sz) / 2;
          ctx.fillRect(px, py, sz, sz);
        }
      }
      break;
    }

    case 'mosaic': {
      const gap = cs >= 6 ? 1 : 0;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, cs - gap, cs - gap);
      break;
    }

    case 'pixel': {
      const sz = cs * (0.3 + L * 0.7) * ss;
      ctx.fillStyle = col;
      ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz);
      break;
    }

    case 'dots': {
      const rad = half * (0.22 + L * 0.78) * ss;
      if (rad <= 0.2) break;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, TAU);
      ctx.fill();
      break;
    }

    case 'cross': {
      const arm = half * (0.35 + L * 0.65) * ss;
      const lw = Math.max(1, cs * 0.11 * (0.5 + L));
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(cx - arm, cy - arm);
      ctx.lineTo(cx + arm, cy + arm);
      ctx.moveTo(cx + arm, cy - arm);
      ctx.lineTo(cx - arm, cy + arm);
      ctx.stroke();
      break;
    }

    case 'diamond': {
      const rad = half * (0.3 + L * 0.7) * ss;
      if (rad <= 0.2) break;
      ctx.fillStyle = col;
      polygonPath(ctx, cx, cy, rad, 4, -Math.PI / 2);
      ctx.fill();
      break;
    }

    case 'voxel': {
      const w = cs * 0.72 * ss * (0.4 + L * 0.6);
      const d = w * 0.5;
      const h = w * 0.45;
      const topY = cy - h / 2;
      ctx.fillStyle = shade(s, 0.45);
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, topY);
      ctx.lineTo(cx, topY + d / 2);
      ctx.lineTo(cx, topY + d / 2 + h);
      ctx.lineTo(cx - w / 2, topY + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(s, 0.72);
      ctx.beginPath();
      ctx.moveTo(cx + w / 2, topY);
      ctx.lineTo(cx, topY + d / 2);
      ctx.lineTo(cx, topY + d / 2 + h);
      ctx.lineTo(cx + w / 2, topY + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(s, 1.35);
      ctx.beginPath();
      ctx.moveTo(cx, topY - d / 2);
      ctx.lineTo(cx + w / 2, topY);
      ctx.lineTo(cx, topY + d / 2);
      ctx.lineTo(cx - w / 2, topY);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'lego': {
      const w = cs * 0.82 * ss * (0.5 + L * 0.5);
      const h = cs * 0.58 * ss * (0.5 + L * 0.5);
      const sr = Math.max(1, w * 0.16);
      ctx.fillStyle = col;
      ctx.fillRect(cx - w / 2, cy - h / 2 + sr, w, h - sr);
      ctx.fillStyle = shade(s, 1.4);
      ctx.beginPath();
      ctx.ellipse(cx, cy - h / 2 + sr, sr, sr * 0.6, 0, 0, TAU);
      ctx.fill();
      break;
    }

    case 'mixed': {
      const pick = MIXED_POOL[hash2(c * 7 + 13, r * 3 + 5) % MIXED_POOL.length];
      if (pick !== mode) drawCell(s, pick);
      break;
    }

    case 'lines': {
      const len = cs * ss * (0.35 + L * 0.65);
      const lw = Math.max(1, cs * 0.14 * (0.35 + L));
      ctx.fillStyle = col;
      ctx.fillRect(cx - len / 2, cy - lw / 2, len, lw);
      break;
    }

    case 'diagonal': {
      const len = half * ss * (0.4 + L * 0.6) * 2;
      const lw = Math.max(1, cs * 0.11 * (0.4 + L));
      const down = hash2(c, r) % 2 === 0;
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      if (down) {
        ctx.moveTo(cx - len / 2, cy - len / 2);
        ctx.lineTo(cx + len / 2, cy + len / 2);
      } else {
        ctx.moveTo(cx + len / 2, cy - len / 2);
        ctx.lineTo(cx - len / 2, cy + len / 2);
      }
      ctx.stroke();
      break;
    }

    case 'braille': {
      const level = Math.round(clamp(L, 0, 1) * 8);
      let mask = 0;
      for (let k = 0; k < level; k++) mask |= 1 << BRAILLE_ORDER[k];
      ctx.fillStyle = col;
      ctx.fillText(String.fromCharCode(0x2800 + mask), cx, cy);
      break;
    }

    case 'disco': {
      const baseHue = (Math.atan2(s.G - s.B, s.R - s.G) * 180) / Math.PI;
      const hue = (baseHue + 360 + s.time * 0.02 * (0.5 + s.dn)) % 360;
      const light = clamp(25 + L * 45, 8, 78);
      const rad = half * ss * (0.35 + L * 0.65);
      ctx.fillStyle = `hsl(${hue.toFixed(0)} 85% ${light.toFixed(0)}%)`;
      polygonPath(ctx, cx, cy, rad, 6, Math.PI / 6);
      ctx.fill();
      ctx.fillStyle = `hsl(${((hue + 40) % 360).toFixed(0)} 90% ${clamp(
        light + 22,
        10,
        92,
      ).toFixed(0)}%)`;
      polygonPath(ctx, cx, cy, rad * 0.5, 6, Math.PI / 6);
      ctx.fill();
      break;
    }

    case 'hexdump': {
      const v = Math.round(clamp(L, 0, 1) * 255);
      ctx.fillStyle = col;
      ctx.fillText(v.toString(16).toUpperCase().padStart(2, '0'), cx, cy);
      break;
    }

    case 'matrix': {
      // Self-animated code rain: a bright head sweeps down each column at its
      // own speed, leaving a fading trail behind it.
      const t = s.time * 0.001;
      const speed = 2.4 + rand01(c, 991) * 5.5;
      const head = ((t * speed + rand01(c, 7) * (grid.rows + 40)) % (grid.rows + 40)) - 20;
      const d = r - head;
      if (d > 0 && d < 26) {
        const fade = 1 - d / 26;
        const ch = MATRIX_GLYPHS[hash2(c, Math.floor(t * 9)) % MATRIX_GLYPHS.length];
        ctx.fillStyle =
          d < 1.4
            ? `rgba(215,255,225,${(0.85 * fade).toFixed(3)})`
            : `rgba(20,${Math.round(170 + 80 * fade)},70,${(0.75 * fade).toFixed(3)})`;
        ctx.fillText(ch, cx, cy);
      } else if (d <= 0 && d > -4) {
        const fade = 1 + d / 4;
        const ch = MATRIX_GLYPHS[hash2(c + 31, Math.floor(t * 9)) % MATRIX_GLYPHS.length];
        ctx.fillStyle = `rgba(245,255,248,${(0.55 * fade).toFixed(3)})`;
        ctx.fillText(ch, cx, cy);
      }
      break;
    }

    case 'rings': {
      const rad = half * ss * (0.28 + L * 0.72);
      if (rad <= 0.3) break;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, cs * 0.1 * (0.3 + L));
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, TAU);
      ctx.stroke();
      if (L > 0.7) {
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(cx, cy, rad * 0.55, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      break;
    }

    case 'hearts': {
      const size = cs * ss * (0.35 + L * 0.65);
      if (size <= 0.5) break;
      ctx.fillStyle = col;
      heartPath(ctx, cx, cy, size);
      ctx.fill();
      break;
    }

    case 'stars': {
      const rad = half * ss * (0.32 + L * 0.68);
      if (rad <= 0.3) break;
      ctx.fillStyle = col;
      starPath(ctx, cx, cy, rad);
      ctx.fill();
      break;
    }

    case 'hexagons': {
      const rad = half * ss * (0.34 + L * 0.66);
      if (rad <= 0.3) break;
      ctx.fillStyle = col;
      polygonPath(ctx, cx, cy, rad, 6, 0);
      ctx.fill();
      break;
    }

    case 'triangles': {
      const rad = half * ss * (0.34 + L * 0.66);
      if (rad <= 0.3) break;
      const rot = (hash2(c, r) % 3) * (TAU / 3) - Math.PI / 2;
      ctx.fillStyle = col;
      polygonPath(ctx, cx, cy, rad, 3, rot);
      ctx.fill();
      break;
    }

    case 'bubbles': {
      const rad = half * ss * (0.25 + L * 0.75);
      if (rad <= 0.3) break;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, cs * 0.07);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, TAU);
      ctx.stroke();
      if (L > 0.45) {
        ctx.fillStyle = shade(s, 1.6);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(cx - rad * 0.32, cy - rad * 0.32, Math.max(0.6, rad * 0.2), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      break;
    }

    case 'hatch': {
      const n = Math.round(L * 4);
      if (n <= 0) break;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cs, cs);
      ctx.clip();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, cs * 0.09);
      const step = (2 * cs) / (n + 1);
      ctx.beginPath();
      for (let k = 1; k <= n; k++) {
        const off = k * step;
        ctx.moveTo(x + off - cs, y);
        ctx.lineTo(x + off, y + cs);
      }
      if (L > 0.7) {
        for (let k = 1; k <= n; k++) {
          const off = k * step;
          ctx.moveTo(x + off, y);
          ctx.lineTo(x + off - cs, y + cs);
        }
      }
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'contour': {
      const eff = grid.eff;
      const band = (v: number): number => clamp(Math.floor(v * CONTOUR_LEVELS), 0, CONTOUR_LEVELS - 1);
      const b = band(L);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, cs * 0.07);
      ctx.beginPath();
      if (c + 1 >= grid.cols || band(eff[i + 1]) !== b) {
        ctx.moveTo(x + cs, y);
        ctx.lineTo(x + cs, y + cs);
      }
      if (r + 1 >= grid.rows || band(eff[i + grid.cols]) !== b) {
        ctx.moveTo(x, y + cs);
        ctx.lineTo(x + cs, y + cs);
      }
      if (c === 0 || band(eff[i - 1]) !== b) {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + cs);
      }
      if (r === 0 || band(eff[i - grid.cols]) !== b) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + cs, y);
      }
      ctx.stroke();
      break;
    }

    case 'halfblocks': {
      // Two independent luminance samples stacked vertically — double the
      // vertical detail of a single cell.
      const inv = s.params.invert;
      const topL = inv ? 1 - grid.lumTop[i] : grid.lumTop[i];
      const botL = inv ? 1 - grid.lumBot[i] : grid.lumBot[i];
      const edgeAmt = (s.params.edgeEmphasis / 100) * grid.edge[i];
      const t = clamp(0.5 + (topL - 0.5) * (1 + edgeAmt * 2.5), 0, 1);
      const bo = clamp(0.5 + (botL - 0.5) * (1 + edgeAmt * 2.5), 0, 1);
      const gap = cs >= 8 ? 1 : 0;
      const midY = y + half;
      const hTop = Math.max(1, (half - gap * 0.5) * (0.3 + t * 0.7));
      const hBot = Math.max(1, (half - gap * 0.5) * (0.3 + bo * 0.7));
      ctx.fillStyle = shade(s, 0.55 + t * 0.75);
      ctx.fillRect(x, midY - hTop, cs, hTop);
      ctx.fillStyle = shade(s, 0.55 + bo * 0.75);
      ctx.fillRect(x, midY, cs, hBot);
      break;
    }

    default: {
      const ramp = rampFor(s.params);
      const last = ramp.length - 1;
      ctx.fillStyle = col;
      ctx.fillText(ramp[Math.round(clamp(L, 0, 1) * last)], cx, cy);
    }
  }
}

/* -------------------------------------------------------------- drawCells */

/**
 * Modes whose primitive never reads `params.density`.
 *
 * Density only reaches a cell through the two derived fields on `CellState`
 * — `ss` (shape scale) and `dn` (0..1 density) — so every mode that ignores
 * both renders identically no matter where the slider sits. The control panel
 * greys Density out for exactly these modes instead of advertising a knob the
 * renderer drops on the floor. `mixed` is absent on purpose: it delegates to
 * MIXED_POOL, whose members all read `ss`.
 *
 * Keep this list in sync with the primitives in `drawCell` below.
 */
export const DENSITY_INERT_MODES: readonly RenderMode[] = [
  'characters',
  'mosaic',
  'braille',
  'hexdump',
  'matrix',
  'hatch',
  'contour',
  'halfblocks',
];

export function drawCells(
  ctx: CanvasRenderingContext2D,
  grid: SampleGrid,
  params: Params,
  timeMs: number,
): void {
  const { cols, rows, cellSize: cs, eff, edge, lum } = grid;
  const n = cols * rows;
  const invert = params.invert;
  const edgeAmt = params.edgeEmphasis / 100;

  // Pass 1 — effective luminance.
  for (let i = 0; i < n; i++) {
    const l = invert ? 1 - lum[i] : lum[i];
    eff[i] = edgeAmt > 0 ? clamp(0.5 + (l - 0.5) * (1 + edgeAmt * 2.5 * edge[i]), 0, 1) : l;
  }

  ctx.save();
  ctx.clearRect(0, 0, grid.width, grid.height);
  // Cells render onto their own transparent layer; `styleBlend` is applied
  // by the compositor when that layer is merged over the backdrop, because
  // a blend against transparency would discard it here.
  ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(6, cs * 1.05)}px ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace`;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const dn = clamp(params.density / 100, 0, 1);
  const ss = clamp(0.5 + dn, 0.15, 1.8);
  const coverage = clamp(params.coverage, 0, 100);
  const mode: RenderMode =
    RENDER_MODES.indexOf(params.renderMode) >= 0 ? params.renderMode : 'characters';

  const state: CellState = {
    ctx,
    grid,
    params,
    i: 0,
    c: 0,
    r: 0,
    x: 0,
    y: 0,
    cx: 0,
    cy: 0,
    cs,
    ss,
    dn,
    L: 0,
    R: 0,
    G: 0,
    B: 0,
    col: '#000',
    time: timeMs,
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (coverage < 100 && rand01(c, r) * 100 >= coverage) continue;
      const i = r * cols + c;
      const R = grid.r[i];
      const G = grid.g[i];
      const B = grid.b[i];
      state.i = i;
      state.c = c;
      state.r = r;
      state.x = c * cs;
      state.y = r * cs;
      state.cx = state.x + cs / 2;
      state.cy = state.y + cs / 2;
      state.L = eff[i];
      state.R = R;
      state.G = G;
      state.B = B;
      state.col = `rgb(${R | 0},${G | 0},${B | 0})`;
      drawCell(state, mode);
    }
  }

  ctx.restore();
}
