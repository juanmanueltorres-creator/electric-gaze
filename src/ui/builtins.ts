/**
 * Built-in presets: a fixed starter set that lives in the bundle.
 *
 * Deliberately outside every storage document: built-ins never touch
 * `localStorage`, cannot be deleted, and are loaded through the same
 * `readConfig` path as user presets — saving the current config under a name
 * afterwards stores an ordinary user preset, exactly as before.
 *
 * Every value configures an effect family that already exists in the
 * renderer. These are presets, not new effects.
 */

export interface BuiltinPreset {
  /** Display name, unique within the set; used in messages and card labels. */
  readonly name: string;
  /** Params-only document: no `schemaVersion`, no view block. */
  readonly config: Readonly<Record<string, unknown>>;
}

export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  {
    name: 'Clean Dither',
    config: {
      renderMode: 'dither',
      cellSize: 8,
      coverage: 100,
      brightness: 6,
      contrast: 118,
      saturation: 100,
      bgMode: 'none',
      animated: false,
    },
  },
  {
    name: 'Dense ASCII',
    config: {
      renderMode: 'characters',
      charSet: 'standard',
      cellSize: 5,
      density: 82,
      coverage: 100,
      animated: false,
    },
  },
  {
    name: 'Braille',
    config: {
      renderMode: 'braille',
      cellSize: 9,
      density: 55,
      coverage: 100,
      animated: false,
    },
  },
  {
    name: 'Neon Disco',
    config: {
      renderMode: 'disco',
      animated: true,
      animStyle: 'wave',
      animSpeed: { enabled: true, intensity: 70 },
      animIntensity: { enabled: true, intensity: 75 },
      tint: '#ff3ca6',
      tintOpacity: 45,
      pfx: {
        bloom: { enabled: true, intensity: 45 },
        chromatic: { enabled: true, intensity: 25 },
      },
    },
  },
  {
    name: 'CRT Matrix',
    config: {
      renderMode: 'matrix',
      animated: true,
      animStyle: 'flicker',
      animSpeed: { enabled: true, intensity: 55 },
      animIntensity: { enabled: true, intensity: 35 },
      bgMode: 'color',
      bgColor: '#04120a',
      tint: '#39ff88',
      tintOpacity: 35,
      pfx: {
        scanLines: { enabled: true, intensity: 55 },
        vignette: { enabled: true, intensity: 45 },
        bloom: { enabled: true, intensity: 20 },
      },
    },
  },
  {
    name: 'Soft Shimmer',
    config: {
      renderMode: 'mosaic',
      cellSize: 10,
      density: 45,
      brightness: 10,
      contrast: 95,
      animated: true,
      animStyle: 'shimmer',
      animSpeed: { enabled: true, intensity: 60 },
      animIntensity: { enabled: true, intensity: 40 },
      tint: '#3ca6ff',
      tintOpacity: 18,
      pfx: {
        vignette: { enabled: true, intensity: 25 },
        filmGrain: { enabled: true, intensity: 18 },
        bloom: { enabled: true, intensity: 15 },
      },
    },
  },
];
