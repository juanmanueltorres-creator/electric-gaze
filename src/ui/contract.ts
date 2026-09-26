/**
 * The serialization contract shared by the JSON panel and the AI prompt.
 *
 * `Params` holds the render configuration, but two more facts decide what a
 * frame looks like and neither of them lives in `Params`: which region the
 * view frames (the cover-crop the grid samples, and the case where the Reel
 * export scales `cellSize` to the preview) and the pixel dimensions that grid
 * is sampled at. A params-only copy therefore reproduces a different picture —
 * same effect, different frame — so every blob this app serialises carries
 * both as a sibling `output` block.
 *
 * The block is descriptive, not a parameter: applying a contract restores the
 * parameters and leaves the live view alone, because the view owns its own
 * framing (`framing` in main.ts) and derives its size from the window
 * (`resize()`). Writing a captured width/height back would fight the layout
 * the next time the window moved, so it is reported instead of replayed.
 */

import type { Params } from '../types';

/** Top-level key of the view block, in both the panel JSON and the prompt JSON. */
export const OUTPUT_KEY = 'output';

/**
 * Version of the document this build writes. Bumping it is a promise that a
 * reader of the old shape still understands the new one; documents that arrive
 * without the key predate it and are read as the current version.
 */
export const SCHEMA_VERSION = 1;

/** Top-level key carrying `SCHEMA_VERSION`. Not a parameter: always stripped. */
export const SCHEMA_KEY = 'schemaVersion';

export interface OutputState {
  /** `free` shows the whole stage; `vertical` shows the 9:16 Reel crop. */
  framing: 'free' | 'vertical';
  /** Backing-store width of the preview canvas, in pixels. */
  width: number;
  /** Backing-store height of the preview canvas, in pixels. */
  height: number;
}

/**
 * The serialised document: schema version, params, view block.
 *
 * Every emitter (panel box, exported file, prompt, preset) writes this one
 * shape, so every reader can share `readConfig`.
 */
export function toContract(params: Params, output: OutputState): Record<string, unknown> {
  return {
    ...params,
    // Set after the spread so a stray key in `params` can never shadow it.
    [SCHEMA_KEY]: SCHEMA_VERSION,
    [OUTPUT_KEY]: {
      framing: output.framing,
      width: Math.max(1, Math.round(output.width)),
      height: Math.max(1, Math.round(output.height)),
    },
  };
}

/**
 * Split a parsed contract into what `normalizeParams` may consume and the
 * view block. Both document-level keys are removed on purpose: merging them
 * would carry them into `params`, where they would ride along for the rest of
 * the session without ever being read.
 *
 * Tolerant by design — the strict gate for anything that is about to change
 * live state lives in `readConfig`.
 */
export function fromContract(raw: unknown): { params: unknown; output: OutputState | null } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { params: raw, output: null };
  }
  const { [OUTPUT_KEY]: block, [SCHEMA_KEY]: _version, ...rest } = raw as Record<string, unknown>;
  return { params: rest, output: readOutput(block) };
}

/**
 * Strict reader for a config about to be applied, imported or loaded from a
 * preset: reject anything whose shape this build cannot honour rather than
 * applying a partially understood document.
 *
 * Throws with a message meant for the panel, so callers surface it directly.
 */
export function readConfig(raw: unknown): { params: unknown; output: OutputState | null } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('a config must be a JSON object');
  }
  const record = raw as Record<string, unknown>;
  const version = record[SCHEMA_KEY];
  if (version !== undefined && version !== SCHEMA_VERSION) {
    throw new Error(
      `${SCHEMA_KEY} ${JSON.stringify(version)} is not supported (this build writes ${SCHEMA_VERSION})`,
    );
  }
  const { params, output } = fromContract(record);
  // The block is optional, but a present one has to be readable: silently
  // dropping it would apply a config whose view facts the user never saw lost.
  if (OUTPUT_KEY in record && output === null) {
    throw new Error(`the "${OUTPUT_KEY}" block is malformed`);
  }
  return { params, output };
}

/** Tolerant reader: a malformed view block is ignored instead of failing the apply. */
function readOutput(block: unknown): OutputState | null {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return null;
  const b = block as Record<string, unknown>;
  const framing = b.framing === 'vertical' ? 'vertical' : b.framing === 'free' ? 'free' : null;
  const width = Number(b.width);
  const height = Number(b.height);
  if (framing === null || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { framing, width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}
