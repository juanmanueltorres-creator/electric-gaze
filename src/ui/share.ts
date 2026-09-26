/**
 * Share links: the editor parameters as a URL fragment.
 *
 * The payload rides in the fragment (`#s1.<base64url>`), which browsers never
 * send to a server, so a shared link carries nothing but the effect
 * parameters themselves — no source image, no mask bitmap, no view facts
 * (framing and pixel size belong to the viewport, exactly as in the
 * autosave). The `s1.` prefix versions the *link format* independently of the
 * config schema: an unknown prefix is ignored, so a future format can coexist
 * with this build without this build ever trying to read it.
 *
 * Nothing here evaluates the payload. It goes base64 -> UTF-8 -> JSON.parse
 * -> the same `readConfig` + `normalizeParams` gate every other entry point
 * uses, and every failure path — absent, oversized, malformed, unsupported —
 * returns null instead of throwing, so boot degrades to the autosave and
 * then to the defaults.
 */

import type { Params } from '../types';
import { normalizeParams } from './controls';
import { readConfig } from './contract';

/** Current link-format version. Bump when the encoding changes shape. */
export const SHARE_PREFIX = 's1.';

/**
 * Cap on the encoded payload. A full default config encodes to roughly
 * 2.5 KB, so this leaves generous headroom for large light lists while
 * rejecting megabyte junk before a single byte is decoded.
 */
export const MAX_SHARE_PAYLOAD = 8192;

/** Encode parameters as the fragment body (no leading `#`). */
export function encodeShareParams(params: Params): string | null {
  // The mask bitmap can be megabytes and is tied to one user's image: it is
  // the one parameter deliberately left behind.
  const { mask, ...rest } = params;
  const payload = { ...rest, mask: { ...mask, dataUrl: null } };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return encoded.length > MAX_SHARE_PAYLOAD ? null : SHARE_PREFIX + encoded;
}

/**
 * Full share URL for the current parameters, or null when the payload
 * exceeds the size cap (a link nobody could open is worse than no link).
 */
export function buildShareLink(params: Params, currentHref: string): string | null {
  const fragment = encodeShareParams(params);
  if (fragment === null) return null;
  return `${currentHref.split('#')[0]}#${fragment}`;
}

/**
 * Read a share fragment from a location hash. Returns validated, normalised
 * parameters, or null when there is nothing usable — never throws.
 */
export function decodeShareHash(hash: string): Params | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith(SHARE_PREFIX)) return null;
  const payload = raw.slice(SHARE_PREFIX.length);
  if (payload.length === 0 || payload.length > MAX_SHARE_PAYLOAD) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    // The shared gate: a config object this build cannot honour (unsupported
    // schema, malformed shape) is rejected here; everything else is clamped
    // into the live domains by normalizeParams.
    return normalizeParams(readConfig(parsed).params);
  } catch {
    return null;
  }
}
