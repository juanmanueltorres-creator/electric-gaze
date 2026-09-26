/**
 * Batch 8 — mask mode (include/exclude).
 *
 * Legacy documents carry only `invert`; the normaliser derives the mode from
 * it so old configs render byte-identically, an explicit mode always wins,
 * and `invert` is kept as its mirror. The share link rides the mode along
 * while still excluding the mask bitmap.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/defaults';
import { normalizeParams } from '../src/ui/controls';
import { decodeShareHash, encodeShareParams } from '../src/ui/share';
import type { Params } from '../src/types';

const frag = (params: Params): string => `#${encodeShareParams(params)}`;

describe('mask mode compatibility', () => {
  it('derives exclude from a legacy config with invert off', () => {
    const params = normalizeParams({ mask: { invert: false } });
    expect(params.mask.mode).toBe('exclude');
    expect(params.mask.invert).toBe(false);
  });

  it('derives include from a legacy config with invert on', () => {
    const params = normalizeParams({ mask: { invert: true } });
    expect(params.mask.mode).toBe('include');
    expect(params.mask.invert).toBe(true);
  });

  it('defaults normalize to exclude (today\u2019s default render)', () => {
    expect(normalizeParams(DEFAULT_PARAMS).mask.mode).toBe('exclude');
  });

  it('an explicit mode wins over invert and re-mirrors it', () => {
    const params = normalizeParams({ mask: { mode: 'exclude', invert: true } });
    expect(params.mask.mode).toBe('exclude');
    expect(params.mask.invert).toBe(false);
  });

  it('an invalid mode falls back to the invert-derived mode', () => {
    expect(normalizeParams({ mask: { mode: 'sideways', invert: true } }).mask.mode).toBe(
      'include',
    );
    expect(normalizeParams({ mask: { mode: 'sideways' } }).mask.mode).toBe('exclude');
  });

  it('a config without a mask block still gets a mode', () => {
    expect(normalizeParams({ cellSize: 17 }).mask.mode).toBe('exclude');
  });
});

describe('mask mode persistence', () => {
  it('share links carry the mode but still drop the bitmap', () => {
    const params = normalizeParams({
      mask: {
        mode: 'include',
        enabled: true,
        invert: true,
        dataUrl: 'data:image/png;base64,AAAA',
      },
    });
    const decoded = decodeShareHash(frag(params));
    expect(decoded).not.toBeNull();
    expect(decoded!.mask.mode).toBe('include');
    expect(decoded!.mask.invert).toBe(true);
    expect(decoded!.mask.dataUrl).toBeNull();
  });

  it('round-trips exclude through encode/decode unchanged', () => {
    const live = normalizeParams(DEFAULT_PARAMS);
    const decoded = decodeShareHash(frag(live));
    expect(decoded).toEqual(live);
  });
});
