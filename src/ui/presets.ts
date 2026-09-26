/**
 * Presets: named effect configurations persisted in `localStorage`.
 *
 * A preset stores a whole config document — exactly the shape the JSON panel
 * emits and reads (schema version + params + view block, built by
 * `toContract`) — so loading one runs through the same validation as
 * "Apply JSON" instead of a second, laxer path.
 *
 * The storage key carries its own version (`v1`) because the stored value is a
 * list of entries, a different shape from the document each entry holds.
 * Nothing here reads or writes `Params`: validation happens in the panel
 * through the shared `readConfig` path, only when a preset is actually loaded.
 */

export const PRESETS_STORAGE_KEY = 'electric-gaze.presets.v1';

export interface Preset {
  /** Display name, unique within the list; used as the select's value. */
  name: string;
  /** ISO 8601 timestamp of the last save, for the record only. */
  savedAt: string;
  /** The config document, carrying its own `schemaVersion`. */
  config: Record<string, unknown>;
}

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Storage access itself can throw (disabled cookies, private mode).
    return null;
  }
}

/**
 * Read the stored list. Corrupted or absent storage reads as empty rather than
 * throwing: a broken key must not stop the app booting, and the next save
 * rewrites it anyway.
 */
export function listPresets(): Preset[] {
  const s = store();
  if (!s) return [];
  let raw: string | null;
  try {
    raw = s.getItem(PRESETS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('expected a list');
    // Only well-formed entries survive a read: a partial list beats no list.
    return parsed.filter(isPreset);
  } catch (e) {
    console.warn('Electric Gaze: presets could not be read, starting empty', e);
    return [];
  }
}

function isPreset(value: unknown): value is Preset {
  if (value === null || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.name === 'string' && p.name.length > 0 && isDocument(p.config)
  );
}

function isDocument(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Throws with a user-facing message when storage is full or unavailable. */
export function writePresets(list: Preset[]): void {
  const s = store();
  if (!s) throw new Error('local storage is unavailable in this browser');
  try {
    s.setItem(PRESETS_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    const quota = e instanceof Error && /quota/i.test(e.message);
    throw new Error(quota ? 'local storage is full — delete a preset first' : String(e));
  }
}

/** Insert or replace by name. Mutates and returns `list`. */
export function upsertPreset(list: Preset[], preset: Preset): Preset[] {
  const index = list.findIndex((p) => p.name === preset.name);
  if (index >= 0) list[index] = preset;
  else list.push(preset);
  return list;
}

export function removePreset(list: Preset[], name: string): Preset[] {
  return list.filter((p) => p.name !== name);
}
