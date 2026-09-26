// Imported first so the stylesheet is registered before the first paint.
import './style.css';
import { DEFAULT_PARAMS } from './defaults';
import {
  beginStroke,
  clearMask,
  drawMaskOverlay,
  drawRadialGuide,
  endStroke,
  extendStroke,
  getMaskCanvas,
  setMaskReadyCallback,
} from './engine/mask';
import { invalidate, renderFrame } from './engine/render';
import { drawCover } from './engine/sample';
import { buildControls, normalizeParams } from './ui/controls';
import { createDemoImage } from './ui/demo';
import { downloadBlob, exportReel } from './ui/export';
import { exportGif } from './ui/gif';
import { buildAiPrompt } from './ui/prompt';
import { loadAutosave, saveAutosave } from './ui/autosave';
import { buildShareLink, decodeShareHash } from './ui/share';
import type { OutputState } from './ui/contract';
import type { Params } from './types';

// Resolved up front with explicit non-null types: a hoisted function below
// would otherwise see only the declared `| null` type, not the guard's narrowing.
const stageEl = document.getElementById('stage');
const viewEl = document.getElementById('view') as HTMLCanvasElement | null;
const panelEl = document.getElementById('panel');
const hintEl = document.getElementById('hint');

if (!stageEl || !viewEl || !panelEl) {
  throw new Error('Electric Gaze: required markup is missing from index.html');
}

const stage: HTMLElement = stageEl;
const canvas: HTMLCanvasElement = viewEl;
const panel: HTMLElement = panelEl;
const hint: HTMLElement | null = hintEl;

// Boot precedence: a valid shared link wins (it is what the user just asked
// for), then the autosave, then the defaults. Each layer falls through to the
// next on its own: an absent, oversized or malformed fragment returns null
// and the autosave takes over, so a bad link can never break boot, autosave
// or presets — it just does not participate. `loadAutosave` never throws and
// normalises on the way out; `decodeShareHash` runs the same shared gate.
const sharedConfig = decodeShareHash(window.location.hash);
const restoredConfig = loadAutosave();
const params: Params = sharedConfig ?? restoredConfig ?? normalizeParams(DEFAULT_PARAMS);

// The prompt's subject: typed prose the renderer never reads, so it is held
// beside `params` rather than inside it — Reset all restores parameters, not
// what the user wrote about their image.
const promptSubject = { text: '' };

// Respect the OS setting before the panel reads values for the first time.
if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
  params.animated = false;
}

let source: CanvasImageSource = createDemoImage();
let sourceVersion = 0;
let objectUrl: string | null = null;

/* ------------------------------------------------------------ loop ------ */

let raf = 0;
let dirty = true;
/** Timestamp of the last frame drawn to the preview, reused by the PNG export. */
let lastTimeMs = 0;

function draw(now: number): void {
  if (canvas.width < 1 || canvas.height < 1) return;
  lastTimeMs = now;

  // Before view: the source alone, cover-cropped with the same rule the grid
  // samples with, so the comparison is between the original and what the
  // effect does to that same region. The renderer is deliberately not called
  // — this branch touches the preview canvas only, never `params`, and never
  // an export, which re-renders instead of reading this canvas back.
  if (compareBefore) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawCover(ctx, source, canvas.width, canvas.height);
    }
    return;
  }

  renderFrame(canvas, source, params, now, {
    sourceVersion,
    maskOverride: getMaskCanvas(canvas.width, canvas.height),
  });
  // Editing furniture, painted onto the preview only — after renderFrame has
  // finished, so it never enters the effect and never reaches an export that
  // re-renders instead of reading this canvas back.
  if (paintMode || params.mask.showOverlay) drawMaskOverlay(canvas, 0.5);
  // Radial editing guide: preview furniture, drawn after renderFrame so it
  // never enters the effect and never reaches an export, which re-renders.
  if (params.mask.radialPoints.length > 0) drawRadialGuide(canvas, params.mask.radialPoints);
}

function frame(now: number): void {
  raf = 0;
  draw(now);
  // The before view is a still image: running the loop under it would burn a
  // frame per refresh for a picture that cannot change. Toggling back calls
  // requestRender(), so the effect resumes on the next frame.
  const again = (params.animated && !compareBefore) || dirty;
  dirty = false;
  if (again) raf = requestAnimationFrame(frame);
}

function requestRender(): void {
  dirty = true;
  if (!raf) raf = requestAnimationFrame(frame);
}

/* ---------------------------------------------------------- sizing ------ */

function resize(): void {
  const rect = stage.getBoundingClientRect();
  const stageW = Math.max(1, Math.round(rect.width));
  const stageH = Math.max(1, Math.round(rect.height));
  let w = stageW;
  let h = stageH;
  if (framing === 'vertical') {
    // Largest 9:16 box that fits the stage, centred: this is the exact crop
    // the Reel export renders, so the preview is what gets exported.
    h = stageH;
    w = Math.round((h * 9) / 16);
    if (w > stageW) {
      w = stageW;
      h = Math.round((w * 16) / 9);
    }
    w = Math.max(1, w);
    h = Math.max(1, h);
  }
  // Inline px overrides the stylesheet, so the layout size is decided here and
  // never by the width/height attributes: an intrinsic-size dependency between
  // the canvas and its parent is what once made resize() rewrite the canvas on
  // every animation frame. These two writes happen even when the backing store
  // is unchanged, otherwise a mode switch that lands on the same pixel size
  // would leave the previous size in place.
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  invalidate(canvas);
  requestRender();
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(resize).observe(stage);
}
window.addEventListener('resize', resize);

/* ----------------------------------------------------------- source ----- */

function loadImageFile(file: File): void {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = url;
    source = img;
    sourceVersion++;
    requestRender();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function useDemo(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  source = createDemoImage();
  sourceVersion++;
  requestRender();
}

stage.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (hint) hint.hidden = false;
});
stage.addEventListener('dragleave', () => {
  if (hint) hint.hidden = true;
});
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  // Handled here only: the page-level listener below must not load the same
  // file a second time on the way up.
  e.stopPropagation();
  if (hint) hint.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
});

// Drag & drop across the whole page. Without this, dropping outside the stage
// lets the browser navigate away to the image file, which looks like the app
// lost the user's picture. The drop runs through the same loadImageFile path
// the stage already used, so the existing flow is untouched.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
});

/* ------------------------------------------------------ view state ------- */

// View state, not a render parameter: it decides which region of the source
// the preview shows, so it lives beside `paintMode` rather than in `params`.
// 'free' keeps today's whole-stage framing; 'vertical' letterboxes the 9:16
// crop the Reel exports so framing and cell density both match the output.
let framing: 'free' | 'vertical' = 'free';

/**
 * The two view facts that decide what a frame looks like but live outside
 * `params`: the framing, and the dimensions the grid samples at. Read fresh
 * on every call, because the panel serialises them after any resize.
 */
function readOutput(): OutputState {
  return { framing, width: canvas.width, height: canvas.height };
}

const framingToggle = document.createElement('button');
framingToggle.type = 'button';
framingToggle.id = 'framing-toggle';
framingToggle.textContent = 'Framing: Free';
stage.append(framingToggle);

framingToggle.addEventListener('click', () => {
  framing = framing === 'free' ? 'vertical' : 'free';
  framingToggle.classList.toggle('active', framing === 'vertical');
  framingToggle.textContent = framing === 'vertical' ? 'Framing: 9:16' : 'Framing: Free';
  // resize() is enough: framing only moves the canvas edges, which is where
  // the cover-crop is derived from, so no other view state changes.
  resize();
});

/* ------------------------------------------------- before / after view ---- */

// View state, not a render parameter — it sits beside `framing` for the same
// reason: switching it must leave the effect, the exports and the copied
// prompt byte-for-byte identical, so nothing here writes to `params`.
let compareBefore = false;

const compareToggle = document.createElement('button');
compareToggle.type = 'button';
compareToggle.id = 'compare-toggle';
compareToggle.textContent = 'After: effect';
compareToggle.title = 'Before / After: show the original source instead of the effect';
stage.append(compareToggle);

compareToggle.addEventListener('click', () => {
  compareBefore = !compareBefore;
  compareToggle.classList.toggle('active', compareBefore);
  compareToggle.textContent = compareBefore ? 'Before: original' : 'After: effect';
  requestRender();
});

/* ------------------------------------------------------ mask painting ---- */

let paintMode = false;
let painting = false;

const paintToggle = document.createElement('button');
paintToggle.type = 'button';
paintToggle.id = 'paint-toggle';
paintToggle.textContent = 'Paint mask';
stage.append(paintToggle);

paintToggle.addEventListener('click', () => {
  paintMode = !paintMode;
  paintToggle.classList.toggle('active', paintMode);
  paintToggle.textContent = paintMode ? 'Stop painting' : 'Paint mask';
  if (paintMode) {
    // A parameter change that skips the panel, so it re-arms the autosave here.
    params.mask.enabled = true;
    scheduleAutosave();
  }
  refresh();
  requestRender();
});

/* ------------------------------------------------------------ export ---- */

// One container for every output action: absolute positioning on the buttons
// themselves would let them drift apart as labels change width.
const stageActions = document.createElement('div');
stageActions.id = 'stage-actions';
stage.append(stageActions);

const exportToggle = document.createElement('button');
exportToggle.type = 'button';
exportToggle.id = 'export-toggle';
exportToggle.textContent = 'Export PNG';
stageActions.append(exportToggle);

exportToggle.addEventListener('click', exportPng);

const reelToggle = document.createElement('button');
reelToggle.type = 'button';
reelToggle.id = 'reel-toggle';
reelToggle.textContent = 'Export Reel';
stageActions.append(reelToggle);

reelToggle.addEventListener('click', () => {
  void exportReelVideo();
});

const REEL_IDLE_LABEL = 'Export Reel';

async function exportReelVideo(): Promise<void> {
  reelToggle.disabled = true;
  try {
    await exportReel(
      source,
      params,
      sourceVersion,
      (fraction) => {
        reelToggle.textContent = `Recording ${Math.round(fraction * 100)}%`;
      },
      // Only a vertical preview is the export's 9:16 crop, so it is the only
      // case where the preview's cell density says anything about the output;
      // in 'free' framing nothing is passed and the export keeps its own cell
      // size, exactly as before.
      framing === 'vertical' ? canvas.width : undefined,
    );
    reelToggle.textContent = REEL_IDLE_LABEL;
    reelToggle.title = '';
  } catch (err) {
    // Surface the failure: the label returns to idle, the message stays on
    // the button tooltip, and the full error goes to the console.
    const message = err instanceof Error ? err.message : String(err);
    console.error('Electric Gaze: reel export failed', err);
    reelToggle.textContent = REEL_IDLE_LABEL;
    reelToggle.title = message;
  } finally {
    reelToggle.disabled = false;
  }
}

const GIF_IDLE_LABEL = 'Export GIF';

const gifToggle = document.createElement('button');
gifToggle.type = 'button';
gifToggle.id = 'gif-toggle';
gifToggle.textContent = GIF_IDLE_LABEL;
stageActions.append(gifToggle);

gifToggle.addEventListener('click', () => {
  void exportGifVideo();
});

async function exportGifVideo(): Promise<void> {
  gifToggle.disabled = true;
  try {
    await exportGif(
      source,
      params,
      sourceVersion,
      // The export mirrors the current view, whatever the framing: the preview
      // dimensions are what define the aspect ratio and the cell density.
      canvas.width,
      canvas.height,
      (fraction) => {
        gifToggle.textContent = `Encoding ${Math.round(fraction * 100)}%`;
      },
    );
    gifToggle.textContent = GIF_IDLE_LABEL;
    gifToggle.title = '';
  } catch (err) {
    // Surface the failure: the label returns to idle, the message stays on
    // the button tooltip, and the full error goes to the console.
    const message = err instanceof Error ? err.message : String(err);
    console.error('Electric Gaze: gif export failed', err);
    gifToggle.textContent = GIF_IDLE_LABEL;
    gifToggle.title = message;
  } finally {
    gifToggle.disabled = false;
  }
}

const promptToggle = document.createElement('button');
promptToggle.type = 'button';
promptToggle.id = 'prompt-toggle';
promptToggle.textContent = 'Copy prompt';
stageActions.append(promptToggle);

promptToggle.addEventListener('click', () => {
  void copyAiPrompt();
});

// Sits beside "Copy prompt": both hand the current state to someone else.
// The link carries effect parameters only — see share.ts for what is left out.
const shareToggle = document.createElement('button');
shareToggle.type = 'button';
shareToggle.id = 'share-toggle';
shareToggle.textContent = 'Copy share link';
shareToggle.title = 'Copy a URL that carries the current parameters (no image, no mask)';
stageActions.append(shareToggle);

shareToggle.addEventListener('click', () => {
  void copyShareLink();
});

/**
 * Copy the reproduction prompt for the current params, subject and source.
 *
 * The clipboard API is undefined outside a secure context and its write is
 * rejected when the tab is not focused or permission is denied; in both cases
 * the prompt is downloaded as a text file instead so the button never fails
 * silently.
 */
async function copyAiPrompt(): Promise<void> {
  const text = buildAiPrompt(params, { subject: promptSubject.text, source, output: readOutput() });
  try {
    if (typeof navigator.clipboard?.writeText !== 'function') {
      throw new Error('clipboard API unavailable');
    }
    await navigator.clipboard.writeText(text);
  } catch {
    downloadBlob(new Blob([text], { type: 'text/plain' }), 'electric-gaze-prompt.txt');
  }
}

/**
 * Copy the current parameters as a shareable URL. The link carries effect
 * parameters only (share.ts strips the mask bitmap and never touches the
 * image or the view), and every failure — clipboard unavailable, payload
 * over the size cap — degrades to a fading chip instead of blocking the
 * editor. The URL only ever reaches the clipboard or a chip as text.
 */
async function copyShareLink(): Promise<void> {
  // The whole path — link construction included — sits inside the try, so a
  // rejected build can never surface as an uncaught promise rejection from
  // the `void copyShareLink()` call in the click handler. Every failure lands
  // on the same user-facing chip.
  try {
    const link = buildShareLink(params, window.location.href);
    if (link === null) {
      console.warn('Electric Gaze: share payload too large to link');
      showStageNote('Could not copy share link', 'share-note');
      return;
    }
    if (typeof navigator.clipboard?.writeText !== 'function') {
      throw new Error('clipboard API unavailable');
    }
    await navigator.clipboard.writeText(link);
    showStageNote('Share link copied', 'share-note');
  } catch {
    console.warn('Electric Gaze: share link could not be copied');
    showStageNote('Could not copy share link', 'share-note');
  }
}

function exportPng(): void {
  const name = `electric-gaze-${params.renderMode}.png`;
  if (canvas.width < 1 || canvas.height < 1) return;

  // Re-rendered into a detached canvas at the preview's size and animation
  // phase instead of reading `canvas` back. Reading the preview would bake in
  // the red mask-editing overlay, which is UI furniture and not part of the
  // effect; the mask's *content* still applies because the live mask surface
  // is passed through as the override.
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  renderFrame(out, source, params, lastTimeMs, {
    sourceVersion,
    maskOverride: getMaskCanvas(canvas.width, canvas.height),
  });

  // The exported bitmap keeps a transparent backdrop (`bgMode: 'none'`)
  // transparent in the PNG.
  out.toBlob((blob) => {
    if (blob) {
      downloadBlob(blob, name);
      return;
    }
    // toBlob can return null on a tainted or oversized canvas; fall back to
    // a data URL rather than failing silently, converted to a blob so the
    // download still goes through the single shared helper.
    downloadBlob(dataUrlToBlob(out.toDataURL('image/png')), name);
  }, 'image/png');
}

/** Minimal data URL reader: the PNG fallback is the only caller. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const mime = /^data:([^;,]*)/.exec(dataUrl.slice(0, comma))?.[1] ?? 'application/octet-stream';
  const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function toCanvas(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width > 0 ? canvas.width / rect.width : 1;
  const sy = rect.height > 0 ? canvas.height / rect.height : 1;
  return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
}

canvas.addEventListener('pointerdown', (e) => {
  if (!paintMode) return;
  e.preventDefault();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* capture is best-effort; painting still works without it */
  }
  const p = toCanvas(e);
  beginStroke(p.x, p.y, params.mask.tool, e.altKey, canvas.width, canvas.height);
  painting = true;
  extendStroke(p.x, p.y, params.mask.brushSize);
  requestRender();
});

canvas.addEventListener('pointermove', (e) => {
  if (!paintMode || !painting) return;
  const p = toCanvas(e);
  extendStroke(p.x, p.y, params.mask.brushSize);
  requestRender();
});

function endPaint(e: PointerEvent): void {
  if (!painting) return;
  painting = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* already released by the browser */
  }
  params.mask.dataUrl = endStroke();
  requestRender();
  scheduleAutosave();
}

canvas.addEventListener('pointerup', endPaint);
canvas.addEventListener('pointercancel', endPaint);

setMaskReadyCallback(() => requestRender());

/* ---------------------------------------------------------- autosave ----- */

// The editable configuration persists after every change, through the same
// contract document the JSON panel writes and `readConfig` validates. The view
// block rides along for format uniformity but is never replayed — framing and
// pixel size belong to the viewport — and any read that fails the shared gate
// falls back to the defaults instead of blocking boot.
const AUTOSAVE_DELAY_MS = 300;

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

// A shared fragment is a claim on the URL that must not outlive the user's
// agreement with it: while nothing has been edited, refresh replays the link
// (that is the point of sharing). The first real parameter change — exactly
// the paths that arm the autosave, and only those — takes the address bar
// back with replaceState: no reload, path and query untouched, and the edited
// configuration keeps winning on the next refresh instead of being overwritten
// by the original shared one. Render, resize, Before/After and the status
// chips never reach this hook, so they leave the hash alone.
let sharedHashPending = false;

function clearSharedHash(): void {
  if (!sharedHashPending) return;
  sharedHashPending = false;
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

function scheduleAutosave(): void {
  clearSharedHash();
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    saveAutosave(params, readOutput());
  }, AUTOSAVE_DELAY_MS);
}

// A debounce alone loses the last change when the tab goes away inside the
// delay, so the pending write is flushed synchronously on the way out. Only a
// *pending* change is worth writing: when no timer is outstanding the stored
// document already equals the live one, and rewriting it anyway would turn
// every visit — even a purely passive one — into a "session restored" banner
// on the next boot.
function flushAutosave(): void {
  if (autosaveTimer === null) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  saveAutosave(params, readOutput());
}

window.addEventListener('pagehide', flushAutosave);

/* ---------------------------------------------------------- controls ----- */

const refresh = buildControls(panel, {
  params,
  promptSubject,
  output: readOutput,
  onChange: () => {
    requestRender();
    // One hook for every panel edit: controls route all parameter changes
    // through here, so this is the single place the autosave re-arms.
    scheduleAutosave();
  },
  onImageFile: loadImageFile,
  onUseDemo: useDemo,
  onClearMask: () => {
    clearMask();
    params.mask.dataUrl = null;
    refresh();
    requestRender();
    scheduleAutosave();
  },
});

/* ------------------------------------------------------------- boot ------ */

resize();
requestRender();

/**
 * One fading status chip at the top-right of the stage, shared by the boot
 * messages and the share confirmation: role=status, text only — content from
 * a link or the clipboard never becomes markup — and never a modal, so it
 * cannot block the first frame or any click below it.
 */
function showStageNote(text: string, id: string): void {
  for (const stale of stage.querySelectorAll('.stage-note')) stale.remove();
  const note = document.createElement('div');
  note.id = id;
  note.className = 'stage-note';
  note.setAttribute('role', 'status');
  note.textContent = text;
  stage.append(note);
  window.setTimeout(() => note.classList.add('faded'), 5500);
}

// The chip says which layer won. A shared link deliberately suppresses the
// session note: this boot came from the URL, not from the previous visit,
// and both messages at once would be noise.
if (sharedConfig) {
  // Arm the claim: this hash stays until the user's first real edit.
  sharedHashPending = true;
  showStageNote('Shared configuration loaded', 'shared-note');
} else if (restoredConfig) {
  showStageNote('Previous session restored', 'session-note');
}

// Pasting a share link into a tab that already has the app open changes only
// the fragment, which browsers handle as a same-document navigation: boot
// never runs. This listener is that same apply path for the live document —
// same validation, same gate, same chip — while an absent or malformed
// fragment keeps the live configuration untouched.
window.addEventListener('hashchange', () => {
  const shared = decodeShareHash(window.location.hash);
  if (!shared) return;
  // The incoming fragment must survive its own save: disarm around the
  // schedule below (a previously armed claim would strip the hash we just
  // received), then re-arm so the next real edit clears this new hash.
  sharedHashPending = false;
  for (const key of Object.keys(params)) delete (params as never)[key];
  Object.assign(params, shared);
  refresh();
  requestRender();
  scheduleAutosave();
  sharedHashPending = true;
  showStageNote('Shared configuration loaded', 'shared-note');
});
