/**
 * Ambient types for `gifenc`, which ships no declarations of its own.
 *
 * Every signature is transcribed from `node_modules/gifenc/src` (index.js,
 * pnnquant2.js, palettize.js) rather than sketched from the README, because a
 * declaration that lies only fails at runtime — and `skipLibCheck` would hide
 * mistakes made inside this very file.
 *
 * `bytes()` is spelled `Uint8Array<ArrayBuffer>` instead of the bare
 * `Uint8Array`: TypeScript 5.7+ made typed arrays generic over their backing
 * buffer, `BlobPart` only accepts `ArrayBufferView<ArrayBuffer>`, and the
 * encoder stream is built from `new Uint8Array(n)` — so the narrower type is
 * both accurate and the only one `new Blob([bytes])` accepts.
 */
declare module 'gifenc' {
  export interface GifEncoderOptions {
    /** Write the header with the first frame instead of requiring writeHeader(). */
    auto?: boolean;
    /** Initial byte capacity of the internal buffer; it grows as needed. */
    initialCapacity?: number;
  }

  export interface GifFrameOptions {
    /** Color table for this frame; required on the first frame written. */
    palette?: number[][];
    /** Frame delay in milliseconds. */
    delay?: number;
    /** Loop count: `0` forever, `-1` once, any positive integer repeats that many times. */
    repeat?: number;
    /** Enable 1-bit transparency for this frame. */
    transparent?: boolean;
    /** Palette index treated as transparent when `transparent` is set. */
    transparentIndex?: number;
    /** Manual (`auto: false`) mode only: this frame carries the screen descriptor. */
    first?: boolean;
    /** Dispose flag override; `-1` keeps the encoder default. */
    dispose?: number;
  }

  export interface GifEncoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
    reset(): void;
  }

  export function GIFEncoder(opts?: GifEncoderOptions): GifEncoder;
  export default GIFEncoder;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      format?: 'rgb565' | 'rgb444' | 'rgba4444';
      oneBitAlpha?: boolean | number;
      clearAlpha?: boolean;
      clearAlphaThreshold?: number;
      clearAlphaColor?: number;
    },
  ): number[][];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array;
}
