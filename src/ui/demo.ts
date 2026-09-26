/**
 * Procedural stand-in source photo.
 *
 * The reference photo referenced by the spec is not present in this repo, so
 * the app ships with a generated image instead: dark base, saturated colour
 * fields, motion streaks, a checkered band, hard geometry and big type.
 * Deliberately wide luminance range so every renderMode has something to
 * bite on — a flat image makes half the modes look broken.
 */

const W = 1600;
const H = 1000;

export function createDemoImage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  /* base ---------------------------------------------------------------- */
  ctx.fillStyle = '#05060b';
  ctx.fillRect(0, 0, W, H);

  /* colour fields -------------------------------------------------------- */
  const fields: Array<[number, number, number, string]> = [
    [W * 0.22, H * 0.3, W * 0.7, '#ff1f3d'],
    [W * 0.78, H * 0.68, W * 0.75, '#12d8fa'],
    [W * 0.5, H * 0.5, W * 0.55, '#7c3aed'],
    [W * 0.86, H * 0.16, W * 0.4, '#ffb703'],
  ];
  for (const [cx, cy, radius, color] of fields) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(5,6,11,0)');
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalAlpha = 1;

  /* diagonal light bands -------------------------------------------------- */
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.32);
  const bands = ['#ff3b30', '#ffd60a', '#30d158', '#64d2ff', '#bf5af2', '#ff9f0a'];
  for (let i = 0; i < 14; i++) {
    const y = -H + i * (H / 7);
    ctx.globalAlpha = 0.1 + (i % 3) * 0.06;
    ctx.fillStyle = bands[i % bands.length];
    ctx.fillRect(-W, y, W * 2, H / 22);
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  /* motion streaks -------------------------------------------------------- */
  for (let i = 0; i < 180; i++) {
    const y = pseudo(i, 3) * H;
    const len = 60 + pseudo(i, 7) * 520;
    const x = pseudo(i, 11) * W;
    const alpha = 0.05 + pseudo(i, 13) * 0.5;
    const bright = pseudo(i, 17);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = bright > 0.72 ? '#ffffff' : bright > 0.4 ? '#9be9ff' : '#ff6b81';
    ctx.fillRect(x, y, len, 1 + pseudo(i, 19) * 3);
  }
  ctx.globalAlpha = 1;

  /* geometry -------------------------------------------------------------- */
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 9; i++) {
    const cx = pseudo(i, 23) * W;
    const cy = pseudo(i, 29) * H;
    const r = 40 + pseudo(i, 31) * 150;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 7; i++) {
    const cx = pseudo(i, 37) * W;
    const cy = pseudo(i, 41) * H;
    const r = 50 + pseudo(i, 43) * 130;
    ctx.fillStyle = i % 2 ? '#0b1220' : '#f5f7ff';
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  /* checkered band -------------------------------------------------------- */
  const cell = 40;
  const bandY = H - cell * 3;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col * cell < W + cell; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#f7f9ff' : '#0a0c14';
      ctx.fillRect(col * cell, bandY + row * cell, cell, cell);
    }
  }
  // A second, skewed checkered strip for diagonal interest.
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.translate(W * 0.68, H * 0.2);
  ctx.rotate(-0.35);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 14; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#111318';
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  ctx.restore();

  /* horizon glow ---------------------------------------------------------- */
  const horizon = ctx.createLinearGradient(0, H * 0.55, 0, H);
  horizon.addColorStop(0, 'rgba(255,255,255,0)');
  horizon.addColorStop(1, 'rgba(255,255,255,0.55)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  /* type ------------------------------------------------------------------ */
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.shadowColor = 'rgba(60,166,255,0.95)';
  ctx.shadowBlur = 48;
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 210px "Arial Black", Impact, Haettenschweiler, sans-serif';
  ctx.fillText('ELECTRIC', W / 2, H * 0.42);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#05060b';
  ctx.font = '900 62px "Arial Black", Impact, sans-serif';
  ctx.fillText('GAZE', W / 2, H * 0.42 + 40);

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '700 44px ui-monospace, Consolas, monospace';
  ctx.fillText('FORMULA ONE // VISUAL LAB', W / 2, H * 0.62);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '500 30px ui-monospace, Consolas, monospace';
  ctx.fillText('0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F', W / 2, H * 0.7);
  ctx.restore();

  return canvas;
}

/** Small deterministic hash → 0..1, so the demo image is byte-stable. */
function pseudo(i: number, salt: number): number {
  let h = Math.imul(i + 1, 374761393) + Math.imul(salt, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
