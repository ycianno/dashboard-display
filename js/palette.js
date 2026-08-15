// ══════════════════════════════════════════════════════════════════════════
// Album artwork → accent palette
//
// The previous approach averaged every pixel, which reliably produced mud:
// a red sleeve and a green sleeve both average toward grey-brown. This bins
// pixels by hue and picks the most *present and colourful* bin instead, which
// is what the eye reads as "the colour of that cover".
// ══════════════════════════════════════════════════════════════════════════

const SAMPLE = 44;
const HUE_BINS = 24;

let canvas = null;
let ctx = null;

function scratch() {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  return ctx;
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** WCAG relative luminance, used to decide black vs white on the accent. */
function luminance(r, g, b) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255));
}

const FALLBACK = { h: 145, s: 63, l: 42 };

export function extractPalette(image) {
  let dominant = FALLBACK;

  try {
    const context = scratch();
    context.clearRect(0, 0, SAMPLE, SAMPLE);
    context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
    const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);

    const bins = Array.from({ length: HUE_BINS }, () => ({ score: 0, h: 0, s: 0, l: 0, n: 0 }));
    let greyScore = 0;
    let grey = { h: 0, s: 0, l: 0, n: 0 };

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const hsl = rgbToHsl(data[i], data[i + 1], data[i + 2]);

      // Ignore near-black and near-white; they dominate covers without
      // carrying any of the colour identity.
      if (hsl.l < 12 || hsl.l > 92) continue;

      if (hsl.s < 14) {
        grey.h += hsl.h;
        grey.s += hsl.s;
        grey.l += hsl.l;
        grey.n += 1;
        greyScore += 0.25;
        continue;
      }

      const bin = bins[Math.min(HUE_BINS - 1, Math.floor((hsl.h / 360) * HUE_BINS))];
      // Weight by saturation and by how mid-toned the pixel is: a vivid mid
      // tone is a better accent than a vivid near-black.
      const midness = 1 - Math.abs(hsl.l - 55) / 55;
      bin.score += (0.35 + hsl.s / 100) * (0.4 + midness);
      bin.h += hsl.h;
      bin.s += hsl.s;
      bin.l += hsl.l;
      bin.n += 1;
    }

    const best = bins.reduce((acc, bin) => (bin.score > acc.score ? bin : acc), { score: 0, n: 0 });

    if (best.n > 0 && best.score >= greyScore) {
      dominant = { h: best.h / best.n, s: best.s / best.n, l: best.l / best.n };
    } else if (grey.n > 0) {
      // Monochrome artwork: keep the neutral tone but give it enough life to
      // read as an accent rather than as another shade of the background.
      dominant = { h: grey.h / grey.n, s: 22, l: grey.l / grey.n };
    }
  } catch (err) {
    // Tainted canvas (artwork served without CORS headers) — keep the default.
    console.warn('Palette extraction failed, using default accent:', err.message);
  }

  const h = Math.round(dominant.h);
  const s = Math.round(Math.min(dominant.s * 1.35 + 8, 92));
  const l = Math.round(Math.min(Math.max(dominant.l, 42), 62));

  const [r, g, b] = hslToRgb(h, s, l);
  const ink = luminance(r, g, b) > 0.42 ? '#06090f' : '#ffffff';

  return {
    hue: h,
    accent: `hsl(${h}, ${s}%, ${l}%)`,
    soft: `hsl(${h}, ${Math.min(s + 8, 96)}%, ${Math.min(l + 16, 78)}%)`,
    glow: `hsla(${h}, ${s}%, ${l}%, 0.34)`,
    dim: `hsla(${h}, ${s}%, ${l}%, 0.45)`,
    companion: `hsl(${(h + 48) % 360}, ${s}%, ${l}%)`,
    ink
  };
}

export function applyPalette(palette) {
  const root = document.documentElement.style;
  root.setProperty('--accent', palette.accent);
  root.setProperty('--accent-soft', palette.soft);
  root.setProperty('--accent-glow', palette.glow);
  root.setProperty('--accent-dim', palette.dim);
  root.setProperty('--accent-ink', palette.ink);

  const orbB = document.getElementById('orb-b');
  if (orbB) orbB.style.background = palette.companion;
}

export function resetPalette() {
  applyPalette({
    accent: 'hsl(145, 63%, 42%)',
    soft: 'hsl(145, 71%, 58%)',
    glow: 'hsla(145, 63%, 42%, 0.34)',
    dim: 'hsla(145, 63%, 42%, 0.45)',
    companion: 'hsl(217, 63%, 52%)',
    ink: '#06090f'
  });
}
