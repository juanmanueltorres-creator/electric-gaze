import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS } from '../src/defaults';
import { AUTOSAVE_KEY, loadAutosave, saveAutosave } from '../src/ui/autosave';
import type { OutputState } from '../src/ui/contract';
import type { Params } from '../src/types';

const view: OutputState = { framing: 'vertical', width: 405, height: 720 };

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

/** Write a raw payload straight into the key, bypassing the writer. */
const writeRaw = (value: string) => globalThis.localStorage.setItem(AUTOSAVE_KEY, value);

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  vi.restoreAllMocks();
});

describe('autosave round trip', () => {
  it('restores the last config, including the mask', () => {
    const params: Params = {
      ...DEFAULT_PARAMS,
      cellSize: 25,
      renderMode: 'matrix',
      mask: { ...DEFAULT_PARAMS.mask, dataUrl: 'data:image/png;base64,AAAA' },
    };
    saveAutosave(params, view);
    const restored = loadAutosave();
    expect(restored).not.toBeNull();
    expect(restored?.cellSize).toBe(25);
    expect(restored?.renderMode).toBe('matrix');
    expect(restored?.mask.dataUrl).toBe('data:image/png;base64,AAAA');
  });

  it('keeps document-level keys out of the restored params', () => {
    saveAutosave({ ...DEFAULT_PARAMS, cellSize: 17 }, view);
    const restored = loadAutosave() as unknown as Record<string, unknown>;
    expect(restored).not.toHaveProperty('schemaVersion');
    expect(restored).not.toHaveProperty('output');
  });
});

describe('autosave fallbacks', () => {
  it('returns null when nothing was ever saved', () => {
    expect(loadAutosave()).toBeNull();
  });

  it('returns null for corrupted JSON instead of blocking boot', () => {
    writeRaw('{definitely not json');
    expect(loadAutosave()).toBeNull();
  });

  it('returns null for an unsupported future schema version', () => {
    writeRaw(JSON.stringify({ schemaVersion: 99, cellSize: 1 }));
    expect(loadAutosave()).toBeNull();
  });

  it('returns null for a payload that is not an object', () => {
    writeRaw(JSON.stringify([1, 2, 3]));
    expect(loadAutosave()).toBeNull();
  });

  it('returns null when the view block is malformed', () => {
    writeRaw(JSON.stringify({ schemaVersion: 1, cellSize: 5, output: { framing: 'x' } }));
    expect(loadAutosave()).toBeNull();
  });

  it('survives a missing storage without throwing on either side', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => saveAutosave(DEFAULT_PARAMS, view)).not.toThrow();
    expect(loadAutosave()).toBeNull();
  });
});
