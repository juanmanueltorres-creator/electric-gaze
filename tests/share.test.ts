import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/defaults';
import { normalizeParams } from '../src/ui/controls';
import {
  MAX_SHARE_PAYLOAD,
  SHARE_PREFIX,
  buildShareLink,
  decodeShareHash,
  encodeShareParams,
} from '../src/ui/share';
import type { Params } from '../src/types';

/** A params object with an oversized light list: well past the payload cap. */
function paramsWithHugeLights(): Params {
  return normalizeParams({
    lights: {
      enabled: true,
      points: Array.from({ length: 600 }, () => ({
        x: 0.5,
        y: 0.4,
        radius: 0.4,
        intensity: 80,
      })),
    },
  });
}

const frag = (params: Params): string => {
  const encoded = encodeShareParams(params);
  expect(encoded).not.toBeNull();
  return `#${encoded}`;
};

describe('share link encoding', () => {
  it('produces a versioned fragment', () => {
    const encoded = encodeShareParams(normalizeParams(DEFAULT_PARAMS));
    expect(encoded).not.toBeNull();
    expect(encoded!.startsWith(SHARE_PREFIX)).toBe(true);
  });

  it('drops the mask bitmap but keeps the effect parameters', () => {
    const params = normalizeParams({
      cellSize: 17,
      renderMode: 'matrix',
      tint: '#ff3355',
      tintOpacity: 61,
      mask: { enabled: true, dataUrl: 'data:image/png;base64,AAAA' },
    });
    const decoded = decodeShareHash(frag(params));
    expect(decoded).not.toBeNull();
    expect(decoded!.cellSize).toBe(17);
    expect(decoded!.renderMode).toBe('matrix');
    expect(decoded!.tint).toBe('#ff3355');
    expect(decoded!.mask.dataUrl).toBeNull();
  });

  it('round-trips the defaults exactly (no output or schema keys ride along)', () => {
    const live = normalizeParams(DEFAULT_PARAMS);
    const decoded = decodeShareHash(frag(live));
    expect(decoded).toEqual(live);
    expect(decoded).not.toHaveProperty('output');
    expect(decoded).not.toHaveProperty('schemaVersion');
  });

  it('keeps default-sized links well under the cap', () => {
    const encoded = encodeShareParams(normalizeParams(DEFAULT_PARAMS));
    expect(encoded).not.toBeNull();
    expect(encoded!.length).toBeLessThan(MAX_SHARE_PAYLOAD);
  });

  it('refuses to encode a payload past the cap', () => {
    expect(encodeShareParams(paramsWithHugeLights())).toBeNull();
  });

  it('builds a full URL and discards any previous fragment', () => {
    const link = buildShareLink(normalizeParams(DEFAULT_PARAMS), 'http://localhost:5173/#old');
    expect(link).not.toBeNull();
    expect(link!.startsWith('http://localhost:5173/#')).toBe(true);
    expect(link).not.toContain('#old');
  });

  it('returns null instead of a link when the payload is too large', () => {
    expect(buildShareLink(paramsWithHugeLights(), 'http://localhost:5173/')).toBeNull();
  });
});

describe('share link decoding', () => {
  const garbage: Array<[string, string]> = [
    ['an empty hash', ''],
    ['a bare hash', '#'],
    ['the prefix with no payload', '#s1.'],
    ['not base64', '#s1.@@ definitely not base64 @@'],
    ['valid base64 that is not JSON', `#${btoa('not json').replace(/=+$/, '')}`],
    ['valid base64 of a non-object', `#${btoa('1234').replace(/=+$/, '')}`],
    ['a future format version', '#s2.whatever'],
    ['text that is not a share link at all', '#section-2'],
    ['an oversized payload', `#s1.${'A'.repeat(MAX_SHARE_PAYLOAD + 1)}`],
  ];

  for (const [label, hash] of garbage) {
    it(`ignores ${label}`, () => {
      expect(decodeShareHash(hash)).toBeNull();
    });
  }

  it('applies the shared gate: an unsupported schema is refused', () => {
    const payload = btoa(JSON.stringify({ schemaVersion: 99, cellSize: 3 }));
    expect(decodeShareHash(`#s1.${payload.replace(/=+$/, '')}`)).toBeNull();
  });

  it('clamps hostile values through normalizeParams instead of trusting them', () => {
    const payload = btoa(JSON.stringify({ cellSize: 9999, renderMode: 'not-a-mode' }));
    const decoded = decodeShareHash(`#s1.${payload.replace(/=+$/, '')}`);
    expect(decoded).not.toBeNull();
    expect(decoded!.cellSize).toBe(64);
    expect(decoded!.renderMode).toBe(DEFAULT_PARAMS.renderMode);
  });
});
