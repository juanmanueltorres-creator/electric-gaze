/**
 * AI reproduction prompt.
 *
 * The panel's JSON export hands a machine the raw params; this hands a model
 * a spec it can follow: the user's subject, the measured facts about the
 * loaded source image, the view the configuration was captured in, the
 * current effect translated into the grouping the render pipeline consumes,
 * and the same values as exact JSON for anything the prose leaves open — with
 * the one field a model cannot use, the megabyte-scale painted mask bitmap,
 * stripped out.
 *
 * The string itself is deterministic (identical params, subject, source and
 * view yield an identical string) so prompts can be saved, diffed and replayed
 * without churn. What it describes is not promised to be byte-identical: see
 * the Reproducibility section, which states the ±1 RGB tolerance Canvas2D
 * rasterisation earns on partially transparent edges, and the Loop notes,
 * which only call a clip seamless when its length is a whole number of cycles.
 */

import { ANIM_CYCLE_MS } from '../engine/anim';
import { CHAR_RAMPS, PFX_KEYS, type AnimBand, type Params } from '../types';
import { describeImage } from './analysis';
import { OUTPUT_KEY, toContract, type OutputState } from './contract';
import {
  OPAQUE_BG_COLOR,
  REEL_DURATION_MS,
  REEL_FPS,
  REEL_HEIGHT,
  REEL_WIDTH,
} from './export';
import { GIF_DURATION_MS, GIF_FPS, GIF_MAX_DIM } from './gif';

/**
 * Number rendering shared by every value: integers stay integral (`7`, never
 * `7.000`) and floats keep the shortest round-trip form JavaScript already
 * produces, so no `toFixed` noise leaks into the prompt.
 */
function num(value: number): string {
  return String(value);
}

function bool(value: boolean): string {
  return String(value);
}

/** The `enabled`/`intensity` pair the panel exposes for a motion band. */
function band(bandParams: AnimBand): string {
  return `${bool(bandParams.enabled)}, intensity ${num(bandParams.intensity)}`;
}

/**
 * A tone curve that maps every input luminance to itself changes nothing, so
 * it is left out of the prose (the JSON block still carries it verbatim).
 */
function isIdentityCurve(points: Params['toneCurve']): boolean {
  return points.length > 0 && points.every((point) => point.x === point.y);
}

/** A motion band's effective 0..1 contribution, including its on/off switch. */
function bandRate(bandParams: AnimBand): number {
  if (!bandParams.enabled) return 0;
  const value = bandParams.intensity / 100;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Honest loop notes for the animation pass.
 *
 * A clip closes without a visible jump only when its length is a whole number
 * of cycles at the configured speed, so each export duration is reported as
 * the fraction it actually is rather than as "seamless". Layers that advance
 * on their own clock are named separately: their join has nothing to do with
 * the animation period, and claiming otherwise would be the same over-promise
 * this section exists to remove.
 */
function loopLines(params: Params): string[] {
  if (!params.animated) return [];

  const speed = bandRate(params.animSpeed);
  if (bandRate(params.animIntensity) <= 0.002) {
    return [
      '- Loop: animIntensity is off or 0, so the animation pass is skipped and every clip length holds the same frame.',
    ];
  }
  if (speed === 0) {
    return [
      '- Loop: animSpeed is off or 0, so time does not advance and every clip length repeats the same frame.',
    ];
  }

  const cycle = ANIM_CYCLE_MS[params.animStyle];
  if (cycle === null) {
    return [
      `- Loop: ${params.animStyle} steps a pseudo-random hash and has no period, so no clip ` +
        'length closes it without a visible change at the join.',
    ];
  }

  const speedLabel = num(params.animSpeed.intensity);
  const out = (
    [
      ['Reel MP4', REEL_DURATION_MS],
      ['GIF', GIF_DURATION_MS],
    ] as Array<[string, number]>
  ).map(([label, ms]) => {
    const cycles = (ms * speed) / cycle;
    const whole = Math.abs(cycles - Math.round(cycles)) < 1e-9;
    const ratio = Number.isInteger(cycles) ? num(cycles) : cycles.toFixed(2);
    const suffix = whole
      ? 'the join is invisible'
      : 'the join is visible — this is not a seamless loop';
    return (
      `- Loop: ${label} is ${num(ms)} ms = ${ratio} x the ${num(cycle)} ms period at Speed ` +
      `${speedLabel}% → ${suffix}.`
    );
  });

  const independent: string[] = [];
  if (params.renderMode === 'matrix' || params.renderMode === 'disco') {
    independent.push(params.renderMode);
  }
  for (const key of ['filmGrain', 'glitch', 'filmDust'] as const) {
    if (params.pfx[key].enabled) independent.push(key);
  }
  if (independent.length > 0) {
    out.push(
      `- Loop: the notes above cover the animation pass only. ${independent.join(', ')} ` +
        'advance on their own clock, unrelated to that period, so those layers also change ' +
        'at the join.',
    );
  }
  return out;
}

/**
 * Build the clipboard prompt that asks an AI to reproduce the app's
 * configured look over the user's subject, as a single self-contained HTML
 * file.
 *
 * @param params The configured effect: described as prose first, then
 *   reproduced as the exact JSON block a machine can copy verbatim.
 * @param options The user-typed subject, the loaded source image the
 *   automatic facts (size, palette, brightness) are measured from, and the
 *   view (framing plus pixel dimensions) the configuration was captured in —
 *   the two facts outside `params` that still decide what a frame looks like.
 */
export function buildAiPrompt(
  params: Params,
  options: { subject: string; source: CanvasImageSource; output: OutputState },
): string {
  const subject = options.subject.trim();
  const image = describeImage(options.source);
  const view = options.output;

  const lines: string[] = [];

  // A blank line before every heading keeps the markdown well-formed whether
  // or not the previous section emitted items.
  const heading = (title: string): void => {
    if (lines.length > 0) lines.push('');
    lines.push(`## ${title}`);
  };
  const item = (label: string, value: string): void => {
    lines.push(`- ${label}: ${value}`);
  };

  lines.push('# Recreate this subject as a web asset');
  lines.push('');
  lines.push(
    'Recreate the subject below using the visual treatment specified here, delivered as a ' +
      'single self-contained web page. The subject, the source-image facts and the effect ' +
      'values that follow are the specification to follow, not suggestions; what this ' +
      'specification can and cannot guarantee is stated under Reproducibility.',
  );

  /* subject --------------------------------------------------------------- */
  heading('Subject');
  lines.push(subject || 'the loaded source image (characterised below)');

  /* source ---------------------------------------------------------------- */
  // The whole section disappears when nothing could be measured: a zero-size
  // description with no colours would only add noise to the prompt.
  const measured = !(image.width === 0 && image.height === 0 && image.palette.length === 0);
  if (measured) {
    heading('Source image reference');
    item(
      'Dimensions',
      `${num(image.width)} x ${num(image.height)} px, aspect ${image.aspect}, ${image.orientation}`,
    );
    item(
      'Dominant colours',
      image.palette.length > 0 ? image.palette.join(', ') : 'none detectable',
    );
    item('Overall brightness', image.brightness);
  }

  /* view ------------------------------------------------------------------ */
  // Framing and dimensions live outside `params` but decide which region is
  // sampled and at what resolution, so a spec without them describes the right
  // effect on the wrong frame.
  heading('View (dimensions change the look)');
  item(
    'Framing',
    view.framing === 'vertical'
      ? 'vertical — the 9:16 crop the Reel export renders'
      : 'free — the whole stage, cropped to the canvas',
  );
  item('Pixel dimensions', `${num(view.width)} x ${num(view.height)} px`);
  lines.push(
    '- cellSize is in pixels, the grid is sampled at these dimensions and the source is ' +
      'cover-cropped to them: render at another size and the cell count changes, which ' +
      'changes the look.',
  );

  /* effect ---------------------------------------------------------------- */
  heading('Visual effect (specification)');

  // customChars is free-form text the user typed, so it is JSON-quoted (a
  // newline or quote would otherwise break the line); the built-in ramps are
  // quoted the same way to keep the rendering uniform.
  const characters =
    params.charSet === 'custom'
      ? `charSet: ${params.charSet}, customChars: ${JSON.stringify(params.customChars)}`
      : `charSet: ${params.charSet}, ramp: ${JSON.stringify(CHAR_RAMPS[params.charSet])}`;

  item(
    'Render',
    [
      `renderMode: ${params.renderMode}`,
      `cellSize: ${num(params.cellSize)}`,
      `coverage: ${num(params.coverage)}`,
      `density: ${num(params.density)}`,
      `edgeEmphasis: ${num(params.edgeEmphasis)}${params.edgeEmphasis === 0 ? ' (disabled)' : ''}`,
      `invert: ${bool(params.invert)}`,
      // The default blend is called out so a reader knows there is nothing
      // special to reproduce beyond plain compositing.
      `styleBlend: ${params.styleBlend}${params.styleBlend === 'source-over' ? ' (the default)' : ''}`,
      characters,
    ].join(', '),
  );

  item(
    'Backdrop',
    [
      `bgMode: ${params.bgMode}`,
      `bgOpacity: ${num(params.bgOpacity)}`,
      `bgColor: ${params.bgColor}`,
      `bgBlur: ${num(params.bgBlur)}`,
    ].join(', '),
  );

  const tone = [
    `brightness: ${num(params.brightness)}`,
    `contrast: ${num(params.contrast)}`,
    `saturation: ${num(params.saturation)}`,
    `grayscale: ${num(params.grayscale)}`,
  ];
  if (params.tintOpacity > 0) {
    tone.push(
      `tint: ${params.tint}`,
      `tintOpacity: ${num(params.tintOpacity)}`,
      `overlayBlend: ${params.overlayBlend}`,
    );
  }
  // Last on purpose: the point list carries its own commas, so nothing may
  // follow it in the same comma-joined bullet.
  if (!isIdentityCurve(params.toneCurve)) {
    tone.push(
      `toneCurve: ${params.toneCurve.map((point) => `${num(point.x)} -> ${num(point.y)}`).join(', ')}`,
    );
  }
  item('Tone and colour', tone.join(', '));

  // Only the fields the active blurType actually reads are listed: the panel
  // exposes every blur control at once, but the renderer switches on blurType.
  if (params.blurType === 'off') {
    item('Blur', 'blurType: off (no blur is applied)');
  } else {
    const blur = [`blurType: ${params.blurType}`, `blurAmount: ${num(params.blurAmount)}`];
    if (params.blurType === 'motion') {
      blur.push(
        `blurAngle: ${num(params.blurAngle)}`,
        `directionalBothSides: ${bool(params.directionalBothSides)}`,
      );
    } else if (params.blurType === 'tiltshift') {
      blur.push(
        `tiltFocus: ${num(params.tiltFocus)}`,
        `tiltPosition: ${num(params.tiltPosition)}`,
        `tiltFeather: ${num(params.tiltFeather)}`,
      );
    } else if (params.blurType === 'lens') {
      blur.push(
        `lensFocus: ${num(params.lensFocus)}`,
        `blurCenterX: ${num(params.blurCenterX)}`,
        `blurCenterY: ${num(params.blurCenterY)}`,
      );
    } else if (params.blurType === 'progressive') {
      blur.push(
        `progressivePosition: ${num(params.progressivePosition)}`,
        `progressiveReverse: ${bool(params.progressiveReverse)}`,
      );
    }
    item('Blur', blur.join(', '));
  }

  /* post ------------------------------------------------------------------ */
  const enabledPfx = PFX_KEYS.filter((key) => params.pfx[key].enabled);
  item(
    'Post-processing (apply in this exact order)',
    enabledPfx.length === 0
      ? 'None.'
      : enabledPfx.map((key) => `${key}: intensity ${num(params.pfx[key].intensity)}`).join(', '),
  );

  /* animation ------------------------------------------------------------- */
  item(
    'Animation',
    params.animated
      ? [
          `animStyle: ${params.animStyle}`,
          `animSpeed: ${band(params.animSpeed)}`,
          `animIntensity: ${band(params.animIntensity)}`,
        ].join(', ')
      : 'Static — single frame.',
  );
  // State the loop as arithmetic, never as a promise: only a clip length that
  // is a whole number of cycles at the configured speed closes invisibly.
  for (const line of loopLines(params)) lines.push(line);
  const pointCount = params.lights.points.length;
  item('lights', `${bool(params.lights.enabled)}, ${pointCount} point${pointCount === 1 ? '' : 's'}`);
  for (const point of params.lights.points) {
    lines.push(
      `- light point: ${num(point.x)},${num(point.y)},${num(point.radius)},${num(point.intensity)}`,
    );
  }

  /* mask ------------------------------------------------------------------ */
  // One brief line: mask.dataUrl is a full-canvas base64 PNG that can run to
  // megabytes, and the painted bitmap tells a model nothing about the look.
  item(
    'Mask',
    `enabled: ${bool(params.mask.enabled)}, tool: ${params.mask.tool}, invert: ${bool(
      params.mask.invert,
    )}`,
  );

  /* json ------------------------------------------------------------------ */
  heading('Parameters and view (JSON)');
  lines.push(
    'The painted mask bitmap (mask.dataUrl) is omitted on purpose, and the source image ' +
      'itself is not embedded — supply the same image.',
  );
  lines.push(
    `The "${OUTPUT_KEY}" block records the view this configuration was captured in ` +
      '(framing and pixel dimensions). It describes the frame rather than the effect: ' +
      'applying this JSON keeps the live view’s own framing and size.',
  );
  lines.push('');
  lines.push('```json');
  const jsonParams: Params = { ...params, mask: { ...params.mask, dataUrl: null } };
  lines.push(JSON.stringify(toContract(jsonParams, view), null, 2));
  lines.push('```');

  /* output ---------------------------------------------------------------- */
  heading('Output requirements');
  lines.push('- A single self-contained HTML file, with no build step, embeddable in a web page.');
  lines.push('- Rendering with Canvas2D or WebGL, with no framework and no bundler.');
  lines.push('- The described subject rendered with the effect specified above.');
  lines.push(
    '- A static source image as the only input; animated output is a function of that image ' +
      'plus the time/frame, never of unseeded randomness.',
  );
  lines.push('');
  lines.push('For reference, what this app itself exports from the view above:');
  lines.push(
    `- PNG: ${num(view.width)} x ${num(view.height)} px, one frame` +
      (params.animated ? ' at the animation phase on screen when you export.' : '.'),
  );
  lines.push(
    params.animated
      ? `- GIF: same aspect, long edge capped at ${num(GIF_MAX_DIM)} px, ${num(GIF_DURATION_MS)} ms at ${num(GIF_FPS)} fps (${num(
          Math.round((GIF_DURATION_MS / 1000) * GIF_FPS),
        )} frames).`
      : `- GIF: same aspect, long edge capped at ${num(GIF_MAX_DIM)} px, a single frame.`,
  );
  lines.push(
    `- Reel MP4: ${num(REEL_WIDTH)} x ${num(REEL_HEIGHT)}, ${num(REEL_DURATION_MS)} ms at ` +
      `${num(REEL_FPS)} fps (${num(
        Math.round((REEL_DURATION_MS / 1000) * REEL_FPS),
      )} frames). H.264 and GIF have no usable alpha here, so a transparent backdrop is ` +
      `replaced by ${OPAQUE_BG_COLOR} in both instead of decoding as black.`,
  );

  /* reproducibility ------------------------------------------------------- */
  heading('Reproducibility');
  lines.push(
    '- Same source image, same parameters, same dimensions and same time/frame → the same ' +
      'visual result within one environment (same browser build, same machine).',
  );
  lines.push(
    '- Canvas2D rasterisation may differ by ±1 in RGB on partially transparent edges ' +
      '(antialiased cells, glow, blur over a transparent backdrop). That tolerance is ' +
      'expected, not a deviation.',
  );
  lines.push('- Results are not guaranteed across browsers, GPU backends or versions.');
  lines.push(
    '- A PNG of an animated setup captures the phase on screen at export time; Animate off ' +
      'is the only repeatable still.',
  );

  /* acceptance ------------------------------------------------------------ */
  heading('Acceptance criteria');
  lines.push('- The subject is recognisable as described.');
  lines.push('- Every value above is carried over as given; nothing is dropped.');
  lines.push(
    '- Rendering at the dimensions and time/frame above reproduces the described look in the ' +
      'same environment, within the ±1 RGB tolerance stated under Reproducibility.',
  );
  lines.push('- It runs in a single HTML file with no build step.');
  lines.push(
    '- Animation matches animStyle, animSpeed and animIntensity, and a loop is seamless only ' +
      'where the Loop notes say the clip length is a whole number of cycles.',
  );

  return `${lines.join('\n')}\n`;
}
