/**
 * Last-config autosave.
 *
 * The panel already serialises every editable state through `toContract` and
 * validates it through `readConfig`; this module only adds the two operations
 * that turn that same document into an autosave: a best-effort write and a
 * read that falls back to the defaults.
 *
 * There is deliberately no second format here. The stored value is exactly the
 * contract document (schema version + params + view block), so a corrupt,
 * unsupported or hand-edited entry fails the same strict gate the JSON panel
 * uses and is ignored as a whole instead of being partially applied.
 *
 * The view block is written for uniformity but never replayed: framing and
 * pixel dimensions are viewport facts owned by the layout (see contract.ts),
 * so `loadAutosave` keeps only the params. Neither this module nor its read
 * path may block boot: every failure returns `null`, and the caller starts
 * from `normalizeParams(DEFAULT_PARAMS)`.
 */

import { readConfig, toContract, type OutputState } from './contract';
import { normalizeParams } from './controls';
import type { Params } from '../types';

/** Storage key. Carries its own `v1` because the entry is a single document. */
export const AUTOSAVE_KEY = 'electric-gaze.autosave.v1';

/** Same private-mode probe as presets.ts, kept local to avoid coupling the two. */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// An automatic write must not spam the console: storage being full is reported
// once, and the presets dialog keeps owning the user-facing quota message.
let saveWarned = false;

/**
 * Persist the current config. Never throws: a full or unavailable storage
 * degrades to "nothing was saved", which is what an autosave is allowed to do.
 */
export function saveAutosave(params: Params, output: OutputState): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(AUTOSAVE_KEY, JSON.stringify(toContract(params, output)));
  } catch (e) {
    if (!saveWarned) {
      saveWarned = true;
      console.warn('Electric Gaze: last config was not saved (storage full or unavailable)', e);
    }
  }
}

/**
 * Read the last config back. Returns `null` — the caller uses the defaults —
 * for every unreadable state: no entry, storage that cannot be read, invalid
 * JSON, a non-object document, an unsupported `schemaVersion` or a malformed
 * view block. Boot never fails because of this key.
 */
export function loadAutosave(): Params | null {
  const s = store();
  if (!s) return null;
  let raw: string | null;
  try {
    raw = s.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const { params } = readConfig(JSON.parse(raw) as unknown);
    return normalizeParams(params);
  } catch (e) {
    console.warn('Electric Gaze: saved config was ignored, starting from defaults', e);
    return null;
  }
}
