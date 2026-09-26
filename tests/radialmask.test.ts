/**
 * Radial (parametric) mask points — the primary mask flow.
 *
 * The normaliser is the contract: a legacy document carries no points and
 * must keep rendering paint-only, every field is clamped into its domain
 * instead of rejecting the payload, junk degrades to defaults, and the
 * points ride along share links while the painted bitmap stays behind.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/defaults';
import { normalizeParams } from '../src/ui/controls';
import { decodeShareHash, encodeShareParams } from '../src/ui/share';
import type { Params } from '../src/types';

const frag = (params: Params): string => `#${encodeShareParams(params)}`;

describe('radial mask point normalisation', () => {
  it('defaults to an empty list', () => {
    expect(normalizeParams({}).mask.radialPoints).toEqual([]);
  });

  it('a legacy config without radialPoints renders paint-only', () => {
    const legacy = normalizeParams({
      mask: { enabled: true, dataUrl: 'data:image/png;base64,AAAA' },
    });
    expect(legacy.mask.radialPoints).toEqual([]);
    expect(legacy.mask.dataUrl).toBe('data:image/png;base64,AAAA');
    expect(DEFAULT_PARAMS.mask.radialPoints).toEqual([]);
  });

  it('clamps every field into its domain', () => {
    const params = normalizeParams({
      mask: { radialPoints: [{ x: 5, y: -1, radius: 9, strength: 350, feather: -3 }] },
    });
    expect(params.mask.radialPoints).toEqual([
      { x: 1, y: 0, radius: 1, strength: 100, feather: 0 },
    ]);
  });

  it('a junk entry falls back to the default fields', () => {
    const params = normalizeParams({ mask: { radialPoints: ['abc'] } });
    expect(params.mask.radialPoints).toEqual([
      { x: 0.5, y: 0.3, radius: 0.25, strength: 100, feather: 35 },
    ]);
  });

  it('a non-array radialPoints degrades to an empty list', () => {
    expect(normalizeParams({ mask: { radialPoints: '{}' } }).mask.radialPoints).toEqual([]);
    expect(normalizeParams({ mask: { radialPoints: 'abc' } }).mask.radialPoints).toEqual([]);
  });

  it('an explicit point survives with its values clamped, not rounded', () => {
    const params = normalizeParams({
      mask: { radialPoints: [{ x: 0.25, y: 0.75, radius: 0.4, strength: 60, feather: 20 }] },
    });
    expect(params.mask.radialPoints).toEqual([
      { x: 0.25, y: 0.75, radius: 0.4, strength: 60, feather: 20 },
    ]);
  });
});

describe('radial mask point persistence', () => {
  it('share links carry the points but still drop the bitmap', () => {
    const params = normalizeParams({
      mask: {
        enabled: true,
        dataUrl: 'data:image/png;base64,AAAA',
        radialPoints: [{ x: 0.4, y: 0.6, radius: 0.3, strength: 80, feather: 45 }],
      },
    });
    const decoded = decodeShareHash(frag(params));
    expect(decoded).not.toBeNull();
    expect(decoded!.mask.radialPoints).toEqual([
      { x: 0.4, y: 0.6, radius: 0.3, strength: 80, feather: 45 },
    ]);
    expect(decoded!.mask.dataUrl).toBeNull();
  });
});

describe('radial mask points and the mode coexist', () => {
  it('keeps an inverted mode while the point rides along', () => {
    const params = normalizeParams({
      mask: { invert: true, radialPoints: [{ x: 0.2, y: 0.8, radius: 0.5, strength: 10, feather: 90 }] },
    });
    expect(params.mask.mode).toBe('include');
    expect(params.mask.invert).toBe(true);
    expect(params.mask.radialPoints).toEqual([
      { x: 0.2, y: 0.8, radius: 0.5, strength: 10, feather: 90 },
    ]);
  });
});
