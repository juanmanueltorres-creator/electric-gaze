import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/defaults';
import { BUILTIN_PRESETS } from '../src/ui/builtins';
import { normalizeParams, presetMatches } from '../src/ui/controls';

describe('built-in presets', () => {
  it('offers a fixed starter set of at most six', () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThan(0);
    expect(BUILTIN_PRESETS.length).toBeLessThanOrEqual(6);
  });

  it('has unique, non-empty names (they become card labels and messages)', () => {
    const names = BUILTIN_PRESETS.map((p) => p.name);
    for (const name of names) expect(name.trim()).not.toBe('');
    expect(new Set(names).size).toBe(names.length);
  });

  it('stores params-only documents: no schema key, no view block', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.config).not.toHaveProperty('schemaVersion');
      expect(preset.config).not.toHaveProperty('output');
    }
  });

  it('names a render mode this build supports (no silent clamp to a default)', () => {
    for (const preset of BUILTIN_PRESETS) {
      const normalized = normalizeParams(preset.config);
      expect(normalized.renderMode).toBe(preset.config.renderMode);
    }
  });

  it('normalises to a stable document: a second pass changes nothing', () => {
    for (const preset of BUILTIN_PRESETS) {
      const once = normalizeParams(preset.config);
      expect(normalizeParams(once)).toEqual(once);
    }
  });

  it('every preset differs from the defaults (none is a no-op card)', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(presetMatches(normalizeParams(DEFAULT_PARAMS), preset.config)).toBe(false);
    }
  });

  it('matches itself after being loaded, the way the badge compares', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(presetMatches(normalizeParams(preset.config), preset.config)).toBe(true);
    }
  });
});

describe('presetMatches', () => {
  it('matches a stored contract document the panel just applied', () => {
    const live = normalizeParams({ renderMode: 'braille', cellSize: 9 });
    // The contract document is flat: schema key, params spread at the top
    // level, view block beside them (see toContract).
    const stored = {
      schemaVersion: 1,
      cellSize: 9,
      renderMode: 'braille',
      output: { framing: 'vertical', width: 608, height: 1080 },
    };
    expect(presetMatches(live, stored)).toBe(true);
  });

  it('detects a changed parameter', () => {
    const live = normalizeParams({ cellSize: 17 });
    expect(presetMatches(live, { cellSize: 25 })).toBe(false);
  });

  it('treats values that normalise the same as a match', () => {
    const live = normalizeParams({ cellSize: '17' });
    expect(presetMatches(live, { cellSize: 17 })).toBe(true);
  });

  it('ignores key order, including in unknown extra keys', () => {
    const live = normalizeParams({ cellSize: 17, zzz: 1, aaa: 2 });
    expect(presetMatches(live, { aaa: 2, zzz: 1, cellSize: 17 })).toBe(true);
  });

  it('a different mask bitmap is a different preset', () => {
    const live = normalizeParams({
      mask: { enabled: true, dataUrl: 'data:image/png;base64,AAAA' },
    });
    const stored = { mask: { enabled: true, dataUrl: 'data:image/png;base64,BBBB' } };
    expect(presetMatches(live, stored)).toBe(false);
  });

  it('the same mask bitmap still matches', () => {
    const live = normalizeParams({
      mask: { enabled: true, dataUrl: 'data:image/png;base64,AAAA' },
    });
    const stored = { mask: { enabled: true, dataUrl: 'data:image/png;base64,AAAA' } };
    expect(presetMatches(live, stored)).toBe(true);
  });
});
