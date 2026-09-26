/**
 * Control panel.
 *
 * Controls are declared as data and rendered into the panel, so adding a
 * parameter is one row rather than one function. Every parameter stays
 * reachable through the JSON editor even when it has no slider.
 */

import { DEFAULT_PARAMS } from '../defaults';
import { DENSITY_INERT_MODES } from '../engine/cells';
import { BUILTIN_PRESETS } from './builtins';
import { fromContract, readConfig, toContract, type OutputState } from './contract';
import {
  ANIM_STYLES,
  BG_MODES,
  BLEND_MODES,
  CHAR_SETS,
  BLUR_TYPES,
  PFX_KEYS,
  RENDER_MODES,
  type LightPoint,
  type MaskMode,
  type Params,
  type RadialMaskPoint,
} from '../types';
import { downloadBlob } from './export';
import {
  listPresets,
  removePreset,
  upsertPreset,
  writePresets,
  type Preset,
} from './presets';
import { getPresetThumb } from './thumbs';

type Kind = 'range' | 'check' | 'select' | 'color' | 'text';

interface Def {
  /** Dotted path into Params. */
  p: string;
  l: string;
  k: Kind;
  min?: number;
  max?: number;
  step?: number;
  opts?: readonly string[];
  /** Display text per option value; falls back to the value itself. */
  optLabels?: Record<string, string>;
  /**
   * Grey the control out when the current params make it a no-op, so the panel
   * never offers a knob the renderer ignores. Re-evaluated on every refresh,
   * which runs after any non-text control changes.
   */
  disableWhen?: (params: Params) => boolean;
  /** Shown as the disabled row's tooltip. */
  disabledHint?: string;
}

interface Section {
  title: string;
  defs: Def[];
}

const BLEND_OPTS = BLEND_MODES as readonly string[];

const SECTIONS: Section[] = [
  {
    title: 'Render',
    defs: [
      { p: 'renderMode', l: 'Mode', k: 'select', opts: RENDER_MODES as readonly string[] },
      { p: 'cellSize', l: 'Cell size', k: 'range', min: 2, max: 40, step: 1 },
      { p: 'coverage', l: 'Coverage %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'density', l: 'Density', k: 'range', min: 0, max: 100, step: 1,
        disableWhen: (p) => DENSITY_INERT_MODES.includes(p.renderMode),
        disabledHint: 'This mode does not read density' },
      { p: 'edgeEmphasis', l: 'Edge emphasis', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'invert', l: 'Invert', k: 'check' },
      { p: 'styleBlend', l: 'Cell blend', k: 'select', opts: BLEND_OPTS,
        // The cells layer is composited over the backdrop, and a blend against
        // zero alpha resolves to plain source-over per the compositing spec:
        // with no visible backdrop there is nothing to blend with, so the
        // control would be a silent no-op. Value is kept, only the input is
        // locked, and an opaque backdrop restores it untouched.
        disableWhen: (p) => p.bgMode === 'none' || p.bgOpacity <= 0,
        disabledHint: 'Blending needs a visible backdrop' },
      { p: 'charSet', l: 'Char set', k: 'select', opts: CHAR_SETS as readonly string[] },
      { p: 'customChars', l: 'Custom chars', k: 'text' },
    ],
  },
  {
    title: 'Backdrop',
    defs: [
      { p: 'bgMode', l: 'Background', k: 'select', opts: BG_MODES as readonly string[] },
      { p: 'bgBlur', l: 'Blur radius', k: 'range', min: 0, max: 60, step: 1 },
      { p: 'bgOpacity', l: 'Opacity %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'bgColor', l: 'Solid colour', k: 'color' },
    ],
  },
  {
    title: 'Colour',
    defs: [
      { p: 'brightness', l: 'Brightness', k: 'range', min: -100, max: 100, step: 1 },
      { p: 'contrast', l: 'Contrast %', k: 'range', min: 0, max: 300, step: 1 },
      { p: 'saturation', l: 'Saturation %', k: 'range', min: 0, max: 300, step: 1 },
      { p: 'grayscale', l: 'Grayscale %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'tint', l: 'Tint', k: 'color' },
      { p: 'tintOpacity', l: 'Tint opacity %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'overlayBlend', l: 'Tint blend', k: 'select', opts: BLEND_OPTS },
      { p: 'blurType', l: 'Blur type', k: 'select', opts: BLUR_TYPES as readonly string[] },
      { p: 'blurAmount', l: 'Blur amount', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'blurAngle', l: 'Motion angle', k: 'range', min: 0, max: 360, step: 1 },
      { p: 'directionalBothSides', l: 'Both directions', k: 'check' },
      { p: 'tiltFocus', l: 'Tilt focus %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'tiltPosition', l: 'Tilt position %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'tiltFeather', l: 'Tilt feather %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'lensFocus', l: 'Lens focus %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'blurCenterX', l: 'Lens centre X %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'blurCenterY', l: 'Lens centre Y %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'progressivePosition', l: 'Progressive from %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'progressiveReverse', l: 'Progressive reverse', k: 'check' },
    ],
  },
  {
    title: 'Post FX',
    defs: PFX_KEYS.flatMap((key) => [
      { p: `pfx.${key}.enabled`, l: key, k: 'check' },
      { p: `pfx.${key}.intensity`, l: `${key} amount`, k: 'range', min: 0, max: 100, step: 1 },
    ]),
  },
  {
    title: 'Motion',
    defs: [
      { p: 'animated', l: 'Animate', k: 'check' },
      { p: 'animStyle', l: 'Style', k: 'select', opts: ANIM_STYLES as readonly string[] },
      { p: 'animSpeed.enabled', l: 'Speed on', k: 'check' },
      { p: 'animSpeed.intensity', l: 'Speed %', k: 'range', min: 0, max: 100, step: 1 },
      { p: 'animIntensity.enabled', l: 'Intensity on', k: 'check' },
      { p: 'animIntensity.intensity', l: 'Intensity %', k: 'range', min: 0, max: 100, step: 1 },
    ],
  },
  {
    title: 'Lights',
    defs: [{ p: 'lights.enabled', l: 'Enable glow points', k: 'check' }],
  },
  {
    title: 'Mask',
    defs: [
      { p: 'mask.enabled', l: 'Reveal mask', k: 'check' },
      {
        p: 'mask.mode',
        l: 'Mask mode',
        k: 'select',
        opts: ['include', 'exclude'] as const,
        optLabels: { include: 'Effect inside', exclude: 'Protect area' },
      },
      { p: 'mask.showOverlay', l: 'Show mask overlay', k: 'check' },
      {
        p: 'mask.tool',
        l: 'Tool',
        k: 'select',
        opts: ['freehand', 'rect', 'circle'] as const,
      },
      { p: 'mask.brushSize', l: 'Brush size', k: 'range', min: 4, max: 160, step: 1 },
    ],
  },
];

/* ------------------------------------------------------------ get / set --- */

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop();
  if (!last) return;
  let cur = obj as Record<string, unknown>;
  for (const key of keys) {
    const next = cur[key];
    if (next === null || typeof next !== 'object') cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[last] = value;
}

/* ------------------------------------------------------- normalisation --- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function merge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const target = isPlainObject(base) ? base : {};
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) ? merge(target[key], value) : value;
  }
  return out;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Merge an arbitrary parsed object over the defaults, then clamp every field
 * into its domain. A partial or malformed payload must never crash a frame.
 */
export function normalizeParams(raw: unknown): Params {
  const base = typeof structuredClone === 'function' ? structuredClone(DEFAULT_PARAMS) : DEFAULT_PARAMS;
  const merged = merge(base, isPlainObject(raw) ? raw : {}) as unknown as Params;

  merged.renderMode = pick(merged.renderMode, RENDER_MODES, DEFAULT_PARAMS.renderMode);
  merged.bgMode = pick(merged.bgMode, BG_MODES, DEFAULT_PARAMS.bgMode);
  merged.charSet = pick(merged.charSet, CHAR_SETS, DEFAULT_PARAMS.charSet);
  merged.blurType = pick(merged.blurType, BLUR_TYPES, DEFAULT_PARAMS.blurType);
  merged.animStyle = pick(merged.animStyle, ANIM_STYLES, DEFAULT_PARAMS.animStyle);

  const blendAllowed = BLEND_MODES as readonly string[];
  merged.styleBlend =
    typeof merged.styleBlend === 'string' && blendAllowed.includes(merged.styleBlend)
      ? merged.styleBlend
      : DEFAULT_PARAMS.styleBlend;
  merged.overlayBlend =
    typeof merged.overlayBlend === 'string' && blendAllowed.includes(merged.overlayBlend)
      ? merged.overlayBlend
      : DEFAULT_PARAMS.overlayBlend;

  merged.cellSize = Math.round(clampNum(num(merged.cellSize, 9), 2, 64));
  merged.coverage = clampNum(num(merged.coverage, 100), 0, 100);
  merged.density = clampNum(num(merged.density, 20), 0, 100);
  merged.edgeEmphasis = clampNum(num(merged.edgeEmphasis, 0), 0, 100);
  merged.brightness = clampNum(num(merged.brightness, 0), -100, 100);
  merged.contrast = clampNum(num(merged.contrast, 100), 0, 300);
  merged.saturation = clampNum(num(merged.saturation, 100), 0, 300);
  merged.grayscale = clampNum(num(merged.grayscale, 0), 0, 100);
  merged.tintOpacity = clampNum(num(merged.tintOpacity, 0), 0, 100);
  merged.blurAmount = clampNum(num(merged.blurAmount, 0), 0, 100);
  merged.bgBlur = clampNum(num(merged.bgBlur, 0), 0, 60);
  merged.bgOpacity = clampNum(num(merged.bgOpacity, 100), 0, 100);
  merged.invert = !!merged.invert;
  merged.animated = !!merged.animated;
  merged.directionalBothSides = !!merged.directionalBothSides;
  merged.progressiveReverse = !!merged.progressiveReverse;
  merged.tint = typeof merged.tint === 'string' ? merged.tint : DEFAULT_PARAMS.tint;
  merged.bgColor = typeof merged.bgColor === 'string' ? merged.bgColor : DEFAULT_PARAMS.bgColor;
  merged.customChars = typeof merged.customChars === 'string' ? merged.customChars : '';
  merged.styleBlend = merged.styleBlend as Params['styleBlend'];
  merged.overlayBlend = merged.overlayBlend as Params['overlayBlend'];

  if (!Array.isArray(merged.toneCurve) || merged.toneCurve.length < 2) {
    merged.toneCurve = [...DEFAULT_PARAMS.toneCurve];
  }

  if (!isPlainObject(merged.pfx)) merged.pfx = structuredClone(DEFAULT_PARAMS.pfx);
  for (const key of PFX_KEYS) {
    const entry = merged.pfx[key];
    if (!isPlainObject(entry)) {
      merged.pfx[key] = { ...DEFAULT_PARAMS.pfx[key] };
      continue;
    }
    merged.pfx[key] = {
      enabled: !!entry.enabled,
      intensity: clampNum(num(entry.intensity, 0), 0, 100),
    };
  }

  if (!isPlainObject(merged.animSpeed)) merged.animSpeed = { ...DEFAULT_PARAMS.animSpeed };
  if (!isPlainObject(merged.animIntensity)) merged.animIntensity = { ...DEFAULT_PARAMS.animIntensity };
  merged.animSpeed = {
    enabled: !!merged.animSpeed.enabled,
    intensity: clampNum(num(merged.animSpeed.intensity, 100), 0, 100),
  };
  merged.animIntensity = {
    enabled: !!merged.animIntensity.enabled,
    intensity: clampNum(num(merged.animIntensity.intensity, 60), 0, 100),
  };

  // Light points are user-editable from the panel now, so they are clamped
  // here like every other parameter: a malformed JSON payload degrades to
  // sensible coordinates instead of feeding NaN sliders or gradients.
  if (!isPlainObject(merged.lights)) merged.lights = { enabled: false, points: [] };
  const rawPoints = Array.isArray(merged.lights.points) ? merged.lights.points : [];
  merged.lights = {
    enabled: !!merged.lights.enabled,
    points: rawPoints.map((raw) => {
      const p: Record<string, unknown> = isPlainObject(raw) ? raw : {};
      return {
        x: clampNum(num(p.x, 0.5), 0, 1),
        y: clampNum(num(p.y, 0.4), 0, 1),
        radius: clampNum(num(p.radius, 0.4), 0, 1),
        intensity: clampNum(num(p.intensity, 80), 0, 100),
      };
    }),
  };

  if (!isPlainObject(merged.mask)) merged.mask = { ...DEFAULT_PARAMS.mask };
  // The deep merge above always leaves a `mode` on the mask (the defaults
  // carry one), so the "legacy document" test has to look at the RAW input:
  // a config that never mentions `mode` must derive it from its own `invert`
  // so it renders byte-identically (invert off = the painted zone keeps the
  // original = 'exclude'). An explicit mode wins and re-mirrors `invert`, so
  // a reader that only knows the old flag still reproduces this polarity.
  const rawMask: unknown = isPlainObject(raw) ? (raw as Record<string, unknown>).mask : undefined;
  const rawMode: unknown = isPlainObject(rawMask) ? rawMask.mode : undefined;
  const legacyMode: MaskMode = merged.mask.invert ? 'include' : 'exclude';
  const maskMode: MaskMode =
    rawMode === 'include' || rawMode === 'exclude' ? rawMode : legacyMode;
  // Radial points are the primary mask flow, clamped here like every other
  // parameter: a malformed payload degrades to defaults instead of feeding
  // NaN into the renderer's per-pixel loop. No point-count cap — the renderer
  // only ever visits each point's bounding box.
  const rawRadial: unknown[] = Array.isArray(merged.mask.radialPoints)
    ? merged.mask.radialPoints
    : [];
  merged.mask = {
    enabled: !!merged.mask.enabled,
    tool: pick(merged.mask.tool, ['freehand', 'rect', 'circle'] as const, 'freehand'),
    brushSize: clampNum(num(merged.mask.brushSize, 30), 4, 160),
    showOverlay: !!merged.mask.showOverlay,
    invert: maskMode === 'include',
    mode: maskMode,
    dataUrl: typeof merged.mask.dataUrl === 'string' ? merged.mask.dataUrl : null,
    shapes: Array.isArray(merged.mask.shapes) ? merged.mask.shapes : [],
    radialPoints: rawRadial.map((rawPoint) => {
      const p: Record<string, unknown> = isPlainObject(rawPoint) ? rawPoint : {};
      return {
        x: clampNum(num(p.x, 0.5), 0, 1),
        y: clampNum(num(p.y, 0.3), 0, 1),
        radius: clampNum(num(p.radius, 0.25), 0, 1),
        strength: clampNum(num(p.strength, 100), 0, 100),
        feather: clampNum(num(p.feather, 35), 0, 100),
      };
    }),
  };

  return merged;
}

/**
 * Do the live parameters still equal a preset's? Both sides pass through the
 * same document split and normalisation the panel applies, so key order,
 * document keys (`schemaVersion`, `output`) and equivalent values (`'8'` vs
 * `8`) can neither fake nor hide a difference. Only effect parameters take
 * part: framing and pixel size are view facts, not preset facts.
 */
export function presetMatches(current: Params, config: unknown): boolean {
  const raw = fromContract(config).params;
  return stableStringify(normalizeParams(current)) === stableStringify(normalizeParams(raw));
}

/** `JSON.stringify` with object keys sorted, so unordered objects compare by value. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown): unknown => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const source = item as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) sorted[key] = source[key];
      return sorted;
    }
    return item;
  });
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------ builder --- */

export interface ControlsHost {
  params: Params;
  /**
   * Holder for the prompt's subject. It is typed prose the renderer never
   * reads, so it lives outside `params`: JSON edits and Reset all must not
   * touch what the user wrote here.
   */
  promptSubject: { text: string };
  /**
   * The view the JSON editor serialises beside the parameters: framing and
   * pixel dimensions decide which region is sampled and at what resolution,
   * so a params-only copy reproduces a different picture. Descriptive only —
   * see contract.ts.
   */
  output(): OutputState;
  onChange(): void;
  onImageFile(file: File): void;
  onUseDemo(): void;
  onClearMask(): void;
}

export function buildControls(root: HTMLElement, host: ControlsHost): () => void {
  const updaters: Array<() => void> = [];
  const frag = document.createDocumentFragment();

  // Several rows enable or disable themselves from *other* parameters (Mode
  // gates Density, Backdrop gates Cell blend), so a change has to re-read the
  // panel as well as re-render. Text inputs stay out of this: rewriting their
  // value on every keystroke would jump the caret.
  const notify = (): void => {
    refresh();
    host.onChange();
  };

  /* source picker --------------------------------------------------------- */
  const source = section('Source');
  const fileRow = el('label', 'row file-row');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) host.onImageFile(file);
  });
  fileRow.append(text('Load image'), input);
  source.append(fileRow);

  const demoBtn = button('Use demo image', () => host.onUseDemo());
  source.append(el('div', 'row', demoBtn));
  frag.append(source);

  /* prompt subject --------------------------------------------------------- */
  // Placed right after Source because it describes what that image is
  // standing in for. The holder lives on the host, not in `params`, so the
  // Reset all button below never clears it.
  const promptBox = section('Prompt');
  const subjectRow = el('label', 'row');
  subjectRow.append(text('Subject'));
  const subjectInput = document.createElement('input');
  subjectInput.type = 'text';
  subjectInput.placeholder = 'e.g. a 3D banana with glass effect';
  subjectInput.value = host.promptSubject.text;
  subjectInput.addEventListener('input', () => {
    host.promptSubject.text = subjectInput.value;
  });
  updaters.push(() => {
    subjectInput.value = host.promptSubject.text;
  });
  subjectRow.append(subjectInput);
  promptBox.append(subjectRow);
  frag.append(promptBox);

  /* parameter sections ---------------------------------------------------- */
  for (const sectionDef of SECTIONS) {
    const box = section(sectionDef.title);
    for (const def of sectionDef.defs) {
      const control = buildControl(def, host, updaters, notify);
      if (control) box.append(control);
    }
    if (sectionDef.title === 'Lights') {
      box.append(buildLightPoints(host, updaters, notify));
    }
    if (sectionDef.title === 'Mask') {
      // Radial points first: they are the primary flow, so they sit above the
      // paint controls. `Clear mask` keeps clearing the PAINT bitmap only —
      // it never touches `radialPoints`.
      box.append(buildRadialMaskPoints(host, updaters, notify));
      box.append(el('div', 'row', button('Clear mask', () => host.onClearMask())));
    }
    frag.append(box);
  }

  /* json ------------------------------------------------------------------ */
  const jsonBox = section('JSON');
  const ta = document.createElement('textarea');
  ta.spellcheck = false;
  ta.rows = 12;
  ta.placeholder =
    'Paste a config (schemaVersion, params, optional "output" block) and press Apply.';
  jsonBox.append(el('div', 'row textarea-row', ta));

  const err = el('div', 'error');
  err.hidden = true;
  jsonBox.append(err);

  // Params plus the view block: what the panel emits is exactly what it also
  // accepts back, minus the view block, which is reported rather than applied.
  const contractJson = (): string => JSON.stringify(toContract(host.params, host.output()), null, 2);

  const show = (box: HTMLElement, className: string, message: string): void => {
    box.className = className;
    box.textContent = message;
    box.hidden = false;
  };

  /**
   * Validate, then apply. Nothing is mutated until the document has cleared
   * `readConfig` and `normalizeParams`, so a rejected import, paste or preset
   * load leaves the live effect exactly as it was.
   *
   * The message element and its base class are passed in because the panel
   * reports three separate features (paste, file import, preset load) from
   * their own positions in the panel.
   */
  const applyConfig = (
    raw: unknown,
    box: HTMLElement,
    baseClass: string,
    successNote?: string,
  ): boolean => {
    let next: Params;
    let output: OutputState | null;
    try {
      const read = readConfig(raw);
      next = normalizeParams(read.params);
      output = read.output;
    } catch (e) {
      show(box, baseClass, `Invalid config: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    for (const key of Object.keys(host.params)) delete (host.params as never)[key];
    Object.assign(host.params, next);
    refresh();
    host.onChange();

    const outputNote = output
      ? ` The output block (${output.framing}, ${output.width} x ${output.height} px) ` +
        'describes the view it was captured in; this view keeps its current framing and size.'
      : '';
    if (outputNote || successNote) {
      show(box, `${baseClass} notice`, `${successNote ?? 'Applied.'}${outputNote}`);
    } else {
      box.hidden = true;
    }
    return true;
  };

  const showBtn = button('Show current', () => {
    err.hidden = true;
    ta.value = contractJson();
    ta.scrollTop = 0;
  });
  const copyBtn = button('Copy JSON', () => {
    ta.value = contractJson();
    void copyToClipboard(ta.value);
    err.hidden = true;
    err.className = 'error notice';
    err.textContent = 'JSON written to the box (and clipboard if permitted).';
    err.hidden = false;
  });
  const applyBtn = button('Apply JSON', () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ta.value);
    } catch (e) {
      show(err, 'error', `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    applyConfig(parsed, err, 'error');
  });
  const resetBtn = button('Reset all', () => {
    const fresh = normalizeParams(DEFAULT_PARAMS);
    for (const key of Object.keys(host.params)) delete (host.params as never)[key];
    Object.assign(host.params, fresh);
    refresh();
    host.onChange();
    err.hidden = true;
  });

  /* import / export ------------------------------------------------------- */
  // The file pair writes and reads the very same document the textarea shows,
  // so an exported config can be pasted back in and a pasted config saved out.

  const exportBtn = button('Export JSON', () => {
    downloadBlob(
      new Blob([contractJson()], { type: 'application/json' }),
      'electric-gaze-config.json',
    );
    show(err, 'error notice', 'Config downloaded as electric-gaze-config.json.');
  });

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.json,application/json';
  importInput.hidden = true;
  const importBtn = button('Import JSON', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    // Cleared first so choosing the same file twice still fires a change.
    importInput.value = '';
    if (!file) return;
    void file.text().then(
      (value) => {
        // Shown whether or not it applies: a rejected file must be inspectable.
        ta.value = value;
        ta.scrollTop = 0;
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch (e) {
          show(err, 'error', `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        applyConfig(parsed, err, 'error', 'Config imported from file.');
      },
      (e: unknown) => {
        show(err, 'error', `Could not read the file: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  });

  jsonBox.append(
    el('div', 'row btn-row', showBtn, copyBtn, applyBtn, resetBtn, exportBtn, importBtn),
    importInput,
  );

  /* presets ---------------------------------------------------------------- */
  // Built before the JSON box is appended so it sits above it: presets are the
  // everyday path, the textarea is the escape hatch.
  const presetBox = section('Presets');
  const presetMsg = el('div', 'status');
  presetMsg.hidden = true;

  const nameRow = el('label', 'row');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'e.g. soft scanlines';
  nameInput.setAttribute('aria-label', 'Preset name');
  nameRow.append(text('Name'), nameInput);

  const listRow = el('label', 'row');
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Saved presets');
  listRow.append(text('Preset'), select);

  /**
   * The gallery: built-ins first, then stored presets. Each card carries a
   * runtime-rendered thumbnail (memory only — never written to storage), the
   * render mode, a Load action and, for user presets only, Delete. Built-ins
   * are bundle data: no storage document, no delete, and loading one is just
   * another `readConfig` apply — saving afterwards stores a user preset.
   *
   * The select above stays exactly as it was (user presets only): the Batch 4
   * suites assert against that list, and this is additive around it.
   */
  const gallery = el('div', 'preset-gallery');

  interface GalleryCard {
    node: HTMLElement;
    config: unknown;
  }
  let galleryCards: GalleryCard[] = [];

  const makeCard = (name: string, config: unknown, kind: 'builtin' | 'user'): HTMLElement => {
    const params = normalizeParams(fromContract(config).params);
    const card = el('div', 'preset-card');
    card.dataset.name = name;
    card.dataset.kind = kind;
    const thumb = document.createElement('img');
    thumb.className = 'preset-thumb';
    thumb.alt = '';
    thumb.src = getPresetThumb(params);
    const label = el('span', 'preset-name', name);
    label.title = name;
    const current = el('span', 'preset-current', 'current');
    current.hidden = true;
    const meta = el(
      'div',
      'preset-meta',
      label,
      el('span', 'preset-mode', params.renderMode),
      current,
    );
    // The visible text stays "Load"/"Delete" for everyone; the label carries
    // the preset's name for assistive tech (and keeps role lookups exact).
    const load = button('Load', () => loadNamed(name, config));
    load.setAttribute('aria-label', `Load ${name}`);
    const actions = el('div', 'preset-actions', load);
    if (kind === 'user') {
      const remove = button('Delete', () => deleteNamed(name));
      remove.setAttribute('aria-label', `Delete ${name}`);
      actions.append(remove);
    }
    card.append(thumb, meta, actions);
    return card;
  };

  /** Rebuild every card. Runs only when the stored list itself changes. */
  const rebuildGallery = (list: Preset[]): void => {
    const cards = document.createDocumentFragment();
    galleryCards = [];
    cards.append(el('div', 'gallery-heading', 'Built-in'));
    for (const preset of BUILTIN_PRESETS) {
      const config: unknown = preset.config;
      const node = makeCard(preset.name, config, 'builtin');
      galleryCards.push({ node, config });
      cards.append(node);
    }
    if (list.length > 0) {
      cards.append(el('div', 'gallery-heading', 'Saved'));
      for (const preset of list) {
        const node = makeCard(preset.name, preset.config, 'user');
        galleryCards.push({ node, config: preset.config });
        cards.append(node);
      }
    }
    gallery.replaceChildren(cards);
  };

  /**
   * Mark the cards whose normalised parameters equal the live ones. Runs on
   * every refresh (any panel edit), so the badge tracks the effect itself,
   * not just which preset was last loaded.
   */
  const updateGalleryMatches = (): void => {
    for (const card of galleryCards) {
      const matches = presetMatches(host.params, card.config);
      card.node.classList.toggle('is-current', matches);
      const chip = card.node.querySelector<HTMLElement>('.preset-current');
      if (chip) chip.hidden = !matches;
    }
  };

  /** Rebuild the list, keep the selection when it still exists, sync buttons. */
  const syncPresets = (preferred?: string): void => {
    const keep = preferred ?? select.value;
    const list = listPresets();
    select.replaceChildren();
    if (list.length === 0) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No presets yet';
      select.append(empty);
    } else {
      for (const preset of list) {
        const option = document.createElement('option');
        option.value = preset.name;
        option.textContent = preset.name;
        select.append(option);
      }
    }
    if (keep && Array.from(select.options).some((o) => o.value === keep)) select.value = keep;
    const empty = select.value === '';
    loadBtn.disabled = empty;
    deleteBtn.disabled = empty;
    rebuildGallery(list);
    updateGalleryMatches();
  };

  const saveBtn = button('Save preset', () => {
    const name = nameInput.value.trim();
    if (!name) {
      show(presetMsg, 'status', 'Give the preset a name first.');
      nameInput.focus();
      return;
    }
    const list = listPresets();
    const replacing = list.some((p) => p.name === name);
    try {
      writePresets(
        upsertPreset(list, {
          name,
          savedAt: new Date().toISOString(),
          config: toContract(host.params, host.output()),
        }),
      );
    } catch (e) {
      show(presetMsg, 'status', `Could not save the preset: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    nameInput.value = '';
    syncPresets(name);
    show(
      presetMsg,
      'status notice',
      replacing ? `Preset "${name}" updated.` : `Preset "${name}" saved.`,
    );
  });

  /** Shared by the select's Load button and the gallery cards. */
  const loadNamed = (name: string, config: unknown): void => {
    applyConfig(config, presetMsg, 'status', `Preset "${name}" loaded.`);
  };

  const loadBtn = button('Load', () => {
    const name = select.value;
    const preset = listPresets().find((p) => p.name === name);
    if (!preset) {
      show(presetMsg, 'status', 'That preset is no longer stored.');
      syncPresets();
      return;
    }
    loadNamed(preset.name, preset.config);
  });

  /** Shared by the select's Delete button and the gallery cards. */
  const deleteNamed = (name: string): void => {
    if (!name) return;
    try {
      writePresets(removePreset(listPresets(), name));
    } catch (e) {
      show(presetMsg, 'status', `Could not delete: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    syncPresets();
    show(presetMsg, 'status notice', `Preset "${name}" deleted.`);
  };

  const deleteBtn = button('Delete', () => deleteNamed(select.value));

  presetBox.append(
    nameRow,
    listRow,
    el('div', 'row btn-row', saveBtn, loadBtn, deleteBtn),
    presetMsg,
    gallery,
  );
  syncPresets();

  frag.append(presetBox, jsonBox);

  root.append(frag);

  function refresh(): void {
    for (const fn of updaters) fn();
    updateGalleryMatches();
  }

  return refresh;
}

function buildControl(
  def: Def,
  host: ControlsHost,
  updaters: Array<() => void>,
  notify: () => void,
): HTMLElement | null {
  const row = el('label', 'row');
  row.append(text(def.l));

  const commit: () => void = def.k === 'text' ? () => host.onChange() : notify;

  // Locked controls keep their value and their row, just visibly inactive:
  // a knob the renderer ignores must not look adjustable.
  const disableWhen = def.disableWhen;
  const trackDisabled = (node: { disabled: boolean }): void => {
    if (!disableWhen) return;
    row.title = def.disabledHint ?? '';
    const sync = (): void => {
      const off = disableWhen(host.params);
      node.disabled = off;
      row.style.opacity = off ? '0.55' : '';
    };
    updaters.push(sync);
    sync();
  };

  if (def.k === 'check') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!getPath(host.params, def.p);
    input.addEventListener('change', () => {
      setPath(host.params, def.p, input.checked);
      commit();
    });
    updaters.push(() => {
      input.checked = !!getPath(host.params, def.p);
    });
    row.append(input);
    trackDisabled(input);
    return row;
  }

  if (def.k === 'select') {
    const select = document.createElement('select');
    for (const opt of def.opts ?? []) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = def.optLabels?.[opt] ?? opt;
      select.append(o);
    }
    select.value = String(getPath(host.params, def.p) ?? '');
    select.addEventListener('change', () => {
      setPath(host.params, def.p, select.value);
      // The mode selector is the modern spelling of the legacy polarity flag:
      // keep `invert` mirroring it so configs saved or shared from this very
      // session still render correctly for readers that only know `invert`.
      if (def.p === 'mask.mode') host.params.mask.invert = select.value === 'include';
      commit();
    });
    updaters.push(() => {
      select.value = String(getPath(host.params, def.p) ?? '');
    });
    row.append(select);
    trackDisabled(select);
    return row;
  }

  if (def.k === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    const raw = String(getPath(host.params, def.p) ?? '#000000');
    input.value = /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#000000';
    input.addEventListener('input', () => {
      setPath(host.params, def.p, input.value);
      commit();
    });
    updaters.push(() => {
      const v = String(getPath(host.params, def.p) ?? '');
      if (/^#[0-9a-f]{6}$/i.test(v)) input.value = v;
    });
    row.append(input);
    trackDisabled(input);
    return row;
  }

  if (def.k === 'text') {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = ' .:-=+*#%@';
    input.value = String(getPath(host.params, def.p) ?? '');
    input.addEventListener('input', () => {
      setPath(host.params, def.p, input.value);
      commit();
    });
    updaters.push(() => {
      input.value = String(getPath(host.params, def.p) ?? '');
    });
    row.append(input);
    trackDisabled(input);
    return row;
  }

  // range
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(def.min ?? 0);
  input.max = String(def.max ?? 100);
  input.step = String(def.step ?? 1);
  const read = (): number => num(getPath(host.params, def.p), Number(input.min));
  const value = el('span', 'value');
  const sync = (): void => {
    const v = read();
    input.value = String(v);
    value.textContent = String(v);
  };
  input.addEventListener('input', () => {
    setPath(host.params, def.p, Number(input.value));
    value.textContent = input.value;
    commit();
  });
  updaters.push(sync);
  sync();
  row.append(input, value);
  trackDisabled(input);
  return row;
}

/**
 * Per-point controls for `lights.points`, built once per points array.
 *
 * A light point is the only parameter that is a list, so it cannot be a static
 * row: adding or removing one has to rebuild this block. The rebuild is keyed
 * on the array's identity, not just its length — "Apply JSON" replaces the
 * array wholesale, and rows holding the old objects would silently write to a
 * detached copy. Slider edits never rebuild (same array), so dragging stays
 * smooth.
 */
function buildLightPoints(
  host: ControlsHost,
  updaters: Array<() => void>,
  notify: () => void,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  const list = el('div', 'lights');
  frag.append(list);

  let rendered: LightPoint[] | null = null;
  let count = -1;
  const syncs: Array<() => void> = [];

  const rebuild = (): void => {
    const points = host.params.lights.points;
    list.replaceChildren();
    syncs.length = 0;
    if (points.length === 0) {
      list.append(el('div', 'row', 'No light points yet'));
    }
    points.forEach((point, index) => {
      const block = el('div', 'light');

      const head = el('div', 'row');
      head.append(text(`Light ${index + 1}`));
      const remove = button('Remove', () => {
        host.params.lights.points.splice(index, 1);
        notify();
      });
      remove.style.marginLeft = 'auto';
      head.append(remove);
      block.append(head);

      const slider = (label: string, read: () => number, write: (v: number) => void): void => {
        const srow = el('label', 'row');
        srow.append(text(label));
        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = '100';
        input.step = '1';
        const out = el('span', 'value');
        const sync = (): void => {
          const v = read();
          input.value = String(v);
          out.textContent = String(v);
        };
        input.addEventListener('input', () => {
          write(Number(input.value));
          out.textContent = input.value;
          host.onChange();
        });
        syncs.push(sync);
        srow.append(input, out);
        block.append(srow);
        sync();
      };

      // x/y/radius are normalized 0..1 in Params; the panel speaks percent.
      slider('X %', () => Math.round(point.x * 100), (v) => {
        point.x = v / 100;
      });
      slider('Y %', () => Math.round(point.y * 100), (v) => {
        point.y = v / 100;
      });
      slider('Radius %', () => Math.round(point.radius * 100), (v) => {
        point.radius = v / 100;
      });
      slider('Intensity %', () => Math.round(point.intensity), (v) => {
        point.intensity = v;
      });

      list.append(block);
    });
    rendered = points;
    count = points.length;
  };

  updaters.push(() => {
    const points = host.params.lights.points;
    if (rendered !== points || count !== points.length) rebuild();
    else for (const sync of syncs) sync();
  });
  rebuild();

  frag.append(
    el(
      'div',
      'row',
      button('Add light point', () => {
        // Added switched on as well: a point that renders nothing until a
        // second checkbox is found is not a working path from the panel.
        host.params.lights.points.push({ x: 0.5, y: 0.38, radius: 0.4, intensity: 80 });
        host.params.lights.enabled = true;
        notify();
      }),
    ),
  );
  return frag;
}

/**
 * Per-point controls for `mask.radialPoints`, built once per points array.
 *
 * Same mechanics as `buildLightPoints`: the rebuild is keyed on the array's
 * identity, not just its length, because "Apply JSON" replaces the array
 * wholesale and rows holding the old objects would silently write to a
 * detached copy. Slider edits never rebuild (same array), so dragging stays
 * smooth — the slider only writes the value and asks for one render.
 *
 * x/y/radius are normalized 0..1 in Params (radius as a fraction of the
 * canvas' shorter edge); the panel speaks percent for those. Strength and
 * feather are 0..100 in Params and are shown as-is.
 */
function buildRadialMaskPoints(
  host: ControlsHost,
  updaters: Array<() => void>,
  notify: () => void,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  const list = el('div', 'lights');
  frag.append(list);

  let rendered: RadialMaskPoint[] | null = null;
  let count = -1;
  const syncs: Array<() => void> = [];

  const rebuild = (): void => {
    const points = host.params.mask.radialPoints;
    list.replaceChildren();
    syncs.length = 0;
    if (points.length === 0) {
      list.append(el('div', 'row', 'No mask points yet'));
    }
    points.forEach((point, index) => {
      const block = el('div', 'light');

      const head = el('div', 'row');
      head.append(text(`Mask ${index + 1}`));
      const remove = button('Remove', () => {
        host.params.mask.radialPoints.splice(index, 1);
        notify();
      });
      remove.style.marginLeft = 'auto';
      head.append(remove);
      block.append(head);

      const slider = (label: string, read: () => number, write: (v: number) => void): void => {
        const srow = el('label', 'row');
        srow.append(text(label));
        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = '100';
        input.step = '1';
        const out = el('span', 'value');
        const sync = (): void => {
          const v = read();
          input.value = String(v);
          out.textContent = String(v);
        };
        input.addEventListener('input', () => {
          write(Number(input.value));
          out.textContent = input.value;
          host.onChange();
        });
        syncs.push(sync);
        srow.append(input, out);
        block.append(srow);
        sync();
      };

      // x/y/radius are normalized 0..1 in Params; the panel speaks percent.
      slider('X %', () => Math.round(point.x * 100), (v) => {
        point.x = v / 100;
      });
      slider('Y %', () => Math.round(point.y * 100), (v) => {
        point.y = v / 100;
      });
      slider('Radius %', () => Math.round(point.radius * 100), (v) => {
        point.radius = v / 100;
      });
      slider('Strength %', () => point.strength, (v) => {
        point.strength = v;
      });
      slider('Feather %', () => point.feather, (v) => {
        point.feather = v;
      });

      list.append(block);
    });
    rendered = points;
    count = points.length;
  };

  updaters.push(() => {
    const points = host.params.mask.radialPoints;
    if (rendered !== points || count !== points.length) rebuild();
    else for (const sync of syncs) sync();
  });
  rebuild();

  frag.append(
    el(
      'div',
      'row',
      button('Add mask point', () => {
        // Added switched on as well: a point that renders nothing until a
        // second checkbox is found is not a working path from the panel.
        host.params.mask.radialPoints.push({
          x: 0.5,
          y: 0.3,
          radius: 0.25,
          strength: 100,
          feather: 35,
        });
        host.params.mask.enabled = true;
        notify();
      }),
    ),
  );
  return frag;
}

/* --------------------------------------------------------------- utils --- */

function section(title: string): HTMLElement {
  const box = el('section', 'group');
  const h = document.createElement('h2');
  h.textContent = title;
  box.append(h);
  return box;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    node.append(typeof child === 'string' ? text(child) : child);
  }
  return node;
}

function text(value: string): Text {
  return document.createTextNode(value);
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard is unavailable over plain http; the textarea still holds it.
  }
}
