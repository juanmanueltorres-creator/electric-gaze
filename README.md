# Electric Gaze — F1 Visual Lab

A browser-based visual effects editor. Load an image (or use the built-in demo), sample it into a grid, render that grid in one of 25 cell modes, then layer colour, post effects, lights, masks and animation on top. Export the result as PNG, GIF or a 1080x1920 MP4 Reel.

## Features

- **25 render modes** — characters, mosaic, pixel, dots, braille, matrix, hexdump, lego, contour, halfblocks and more.
- **Source handling** — file picker and drag & drop anywhere on the page, plus a deterministic demo image.
- **Look controls** — backdrop, colour grading, post FX, motion/animation styles, and additive glow light points.
- **Masks** — radial parametric points (primary) and a painted bitmap layer (freehand / rectangle / circle), combined per pixel. Two polarities: *Protect area* and *Effect inside*.
- **Presets** — built-in presets plus your own, stored locally, with rendered thumbnails.
- **Autosave** — the last configuration is restored on the next visit.
- **Import / export** — the whole configuration as a JSON document.
- **Share links** — parameters only, encoded in the URL fragment. The image and the mask bitmap never travel with the link.
- **Before / After** — toggle between the original source and the effect.
- **Exports** — PNG (with optional transparency), GIF, and a 5-second 1080x1920 MP4 Reel.
- **Copy prompt** — a text description of the current setup, ready to paste elsewhere.

## Stack

- TypeScript (strict) + [Vite](https://vite.dev)
- [Vitest](https://vitest.dev) for tests
- Canvas 2D for the render pipeline
- [gifenc](https://github.com/mattdesl/gifenc) for GIF encoding
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) + WebCodecs for MP4, with a MediaRecorder fallback

## Installation

```bash
npm install
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run the test suite once |
| `npm run typecheck` | Type-check `src` and `tests` |
| `npm run build` | Type-check `src` and produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |

## Client-side only

Everything runs in the browser. There is no backend, no API key and no network request at runtime — the app works from a plain static file server. Configuration lives in `localStorage`; share links carry their parameters in the URL fragment, which browsers never send to a server.
