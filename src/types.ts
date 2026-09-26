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

export interface MaskState {
  enabled: boolean;
  tool: MaskTool;
  brushSize: number;
  showOverlay: boolean;
  invert: boolean;
  dataUrl: string | null;
  shapes: MaskShape[];
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
