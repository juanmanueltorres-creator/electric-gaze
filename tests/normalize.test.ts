import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/defaults';
import { readConfig, toContract } from '../src/ui/contract';
import { normalizeParams } from '../src/ui/controls';

describe('normalizeParams', () => {
  it('keeps a valid edit', () => {
    expect(normalizeParams({ cellSize: 17 }).cellSize).toBe(17);
  });

  it('clamps an out-of-domain value instead of rejecting the payload', () => {
    expect(normalizeParams({ cellSize: 999 }).cellSize).toBe(64);
  });

  it('falls back to the default when the value is unreadable', () => {
    expect(normalizeParams({ cellSize: 'not-a-number' }).cellSize).toBe(DEFAULT_PARAMS.cellSize);
  });

  it('renders a partial payload onto the defaults', () => {
    const params = normalizeParams({ cellSize: 17 });
    expect(params.renderMode).toBe(DEFAULT_PARAMS.renderMode);
    expect(params.mask.dataUrl).toBeNull();
  });

  it('tolerates an unrelated key rather than failing the payload', () => {
    const params = normalizeParams({ cellSize: 17, strayKey: true }) as unknown as Record<
      string,
      unknown
    >;
    expect(params.cellSize).toBe(17);
    expect(params.strayKey).toBe(true);
  });

  it('never lets document keys reach params', () => {
    const doc = toContract({ ...DEFAULT_PARAMS, cellSize: 25 }, {
      framing: 'free',
      width: 800,
      height: 600,
    });
    const { params } = readConfig(doc);
    expect(params).not.toHaveProperty('schemaVersion');
    expect(params).not.toHaveProperty('output');
    expect((params as Record<string, unknown>).cellSize).toBe(25);
  });
});
