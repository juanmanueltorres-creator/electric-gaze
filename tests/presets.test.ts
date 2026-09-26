import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRESETS_STORAGE_KEY,
  listPresets,
  removePreset,
  upsertPreset,
  writePresets,
  type Preset,
} from '../src/ui/presets';

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

const preset = (name: string, cellSize = 17): Preset => ({
  name,
  savedAt: '2026-09-25T00:00:00.000Z',
  config: { schemaVersion: 1, cellSize },
});

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  vi.restoreAllMocks();
});

describe('presets persistence', () => {
  it('round-trips a saved preset through storage', () => {
    writePresets([preset('one')]);
    const list = listPresets();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('one');
    expect(list[0].config.cellSize).toBe(17);
  });

  it('replaces a preset with the same name instead of duplicating it', () => {
    let list = upsertPreset([], preset('one', 17));
    list = upsertPreset(list, preset('one', 25));
    expect(list).toHaveLength(1);
    expect(list[0].config.cellSize).toBe(25);
  });

  it('deletes a preset by name and persists the rest', () => {
    const list = upsertPreset(upsertPreset([], preset('one')), preset('two'));
    const after = removePreset(list, 'one');
    writePresets(after);
    expect(listPresets().map((p) => p.name)).toEqual(['two']);
  });

  it('reads corrupted storage as an empty list instead of throwing', () => {
    globalThis.localStorage.setItem(PRESETS_STORAGE_KEY, '{not json');
    expect(listPresets()).toEqual([]);
  });

  it('reads a non-list payload as an empty list', () => {
    globalThis.localStorage.setItem(PRESETS_STORAGE_KEY, '{"name":"x"}');
    expect(listPresets()).toEqual([]);
  });

  it('reports a full storage with a message the panel can show', () => {
    const full = fakeStorage();
    full.setItem = () => {
      throw new Error('The quota has been exceeded.');
    };
    globalThis.localStorage = full;
    expect(() => writePresets([preset('one')])).toThrow(
      'local storage is full — delete a preset first',
    );
  });
});
