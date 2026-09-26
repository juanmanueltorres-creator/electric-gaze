/**
 * Electric Gaze parameter model.
 *
 * Every field mirrors the reference JSON payload. Fields that the payload
 * references but does not enumerate (bgColor, charSet options, blurType
 * options, light points) are declared here with their accepted domains.
 */

export type RenderMode =
  | 'characters'
  | 'dither'
  | 'mosaic'
  | 'pixel'
  | 'dots'
  | 'cross'
  | 'diamond'
  | 'voxel'
  | 'lego'
  | 'mixed'
  | 'lines'
  | 'diagonal'
  | 'braille'
  | 'disco'
  | 'hexdump'
  | 'matrix'
  | 'rings'
  | 'hearts'
  | 'stars'
  | 'hexagons'
  | 'triangles'
  | 'bubbles'
  | 'hatch'
  | 'contour'
  | 'halfblocks';

export type BgMode = 'none' | 'color' | 'original' | 'blur';

export type CharSetName =
  | 'standard'
  | 'blocks'
  | 'braille'
  | 'binary'
  | 'hex'
  | 'minimal'
  | 'custom';

export type BlurType =
  | 'off'
  | 'gaussian'
  | 'motion'
  | 'tiltshift'
  | 'lens'
  | 'progressive';

export type AnimStyle = 'wave' | 'pulse' | 'shimmer' | 'ripple' | 'flicker';

export type MaskTool = 'freehand' | 'rect' | 'circle';

/**
 * Which side of the painted area the effect touches.
 * `'exclude'` — Protect area: the painted zone keeps the original photo.
 * `'include'` — Effect inside: the painted zone receives the effect.
 * Legacy documents carry only `invert`; readers derive the mode from it
 * (`invert` off = `'exclude'`), so old configs render byte-identically.
 */
export type MaskMode = 'include' | 'exclude';

export type BlendMode = GlobalCompositeOperation;

export type PfxKey =
  | 'scanLines'
  | 'vignette'
  | 'bloom'
  | 'chromatic'
  | 'filmGrain'
  | 'glitch'
  | 'pixelate'
  | 'halftone'
  | 'filmDust';

export interface PfxEntry {
  enabled: boolean;
  intensity: number;
}

export interface LightPoint {
  /** Normalized 0..1 */
  x: number;
  /** Normalized 0..1 */
  y: number;
  /** Normalized radius, 0..1 of the shorter canvas edge */
  radius: number;
  /** 0..100 */
  intensity: number;
}

export interface TonePoint {
  /** 0..1 input luminance */
  x: number;
  /** 0..1 output luminance */
  y: number;
}

export interface MaskShape {
  type: MaskTool;
  /** Normalized coordinates, 0..1 */
  points: number[];
}

/**
 * A radial mask region: the primary way to protect (or reveal) an area
 * without painting it. Normalized so a config scales to any canvas.
 */
export interface RadialMaskPoint {
  /** Normalized 0..1 x position on the canvas */
  x: number;
  /** Normalized 0..1 y position on the canvas */
  y: number;
  /** Normalized radius: fraction of the canvas' shorter edge, 0..1 */
  radius: number;
  /** 0..100 — how much mask this point applies at its core */
  strength: number;
  /** 0..100 — 0 is a hard edge, 100 fades across the whole radius */
  feather: number;
}

export interface MaskState {
  enabled: boolean;
  tool: MaskTool;
  brushSize: number;
  showOverlay: boolean;
  invert: boolean;
  mode: MaskMode;
  dataUrl: string | null;
  shapes: MaskShape[];
  /**
   * Primary mask flow; the paint bitmap is the advanced/manual layer.
   * Both layers combine with a max alpha (never a sum).
   */
  radialPoints: RadialMaskPoint[];
}

export interface AnimBand {
  enabled: boolean;
  intensity: number;
}

export interface Params {
  renderMode: RenderMode;
  bgMode: BgMode;
  bgBlur: number;
  bgOpacity: number;
  bgColor: string;
  cellSize: number;
  coverage: number;
  invert: boolean;
  styleBlend: BlendMode;
  charSet: CharSetName;
  customChars: string;
  brightness: number;
  contrast: number;
  edgeEmphasis: number;
  density: number;
  toneCurve: TonePoint[];
  tint: string;
  tintOpacity: number;
  overlayBlend: BlendMode;
  saturation: number;
  grayscale: number;
  blurType: BlurType;
  blurAmount: number;
  blurAngle: number;
  directionalBothSides: boolean;
  tiltFocus: number;
  tiltPosition: number;
  tiltFeather: number;
  lensFocus: number;
  blurCenterX: number;
  blurCenterY: number;
  progressivePosition: number;
  progressiveReverse: boolean;
  pfx: Record<PfxKey, PfxEntry>;
  animated: boolean;
  animStyle: AnimStyle;
  animSpeed: AnimBand;
  animIntensity: AnimBand;
  lights: { enabled: boolean; points: LightPoint[] };
  mask: MaskState;
}

/* ---------------------------------------------------------------- domains */

export const RENDER_MODES: readonly RenderMode[] = [
  'characters',
  'dither',
  'mosaic',
  'pixel',
  'dots',
  'cross',
  'diamond',
  'voxel',
  'lego',
  'mixed',
  'lines',
  'diagonal',
  'braille',
  'disco',
  'hexdump',
  'matrix',
  'rings',
  'hearts',
  'stars',
  'hexagons',
  'triangles',
  'bubbles',
  'hatch',
  'contour',
  'halfblocks',
];

export const BG_MODES: readonly BgMode[] = ['none', 'color', 'original', 'blur'];

export const CHAR_SETS: readonly CharSetName[] = [
  'standard',
  'blocks',
  'braille',
  'binary',
  'hex',
  'minimal',
  'custom',
];

export const BLUR_TYPES: readonly BlurType[] = [
  'off',
  'gaussian',
  'motion',
  'tiltshift',
  'lens',
  'progressive',
];

export const ANIM_STYLES: readonly AnimStyle[] = [
  'wave',
  'pulse',
  'shimmer',
  'ripple',
  'flicker',
];

/** Applied in pipeline order. */
export const PFX_KEYS: readonly PfxKey[] = [
  'scanLines',
  'vignette',
  'bloom',
  'chromatic',
  'filmGrain',
  'glitch',
  'halftone',
  'pixelate',
  'filmDust',
];

export const BLEND_MODES: readonly BlendMode[] = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'lighter',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

/** Character ramps keyed by charSet name. Index 0 is the darkest sample. */
export const CHAR_RAMPS: Record<Exclude<CharSetName, 'custom'>, string> = {
  standard: ' .:-=+*#%@',
  blocks: ' .░▒▓█',
  braille: ' .·:*oO@',
  binary: ' 01',
  hex: ' 0123456789ABCDEF',
  minimal: ' .#',
};
