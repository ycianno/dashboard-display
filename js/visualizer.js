// ══════════════════════════════════════════════════════════════════════════
// Procedural spectrum bars
//
// Spotify's Web API exposes no audio stream, so there is nothing real to
// analyse. This is a decorative simulation — but it is shaped like a spectrum
// (loud in the low-mids, quieter at the edges) so it reads as plausible
// rather than as random noise, and it settles flat when playback pauses.
// ══════════════════════════════════════════════════════════════════════════

const BAR_COUNT = 48;

export function createVisualizer(canvas) {
  if (!canvas) {
    return { setPlaying() {}, setRunning() {}, setAccent() {} };
  }

  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let frame = null;
  let playing = false;
  let running = false;
  let accent = '#1db954';
  let accentSoft = '#4ade80';

  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    // A gentle bell across the spectrum keeps the shape musical.
    const centred = 1 - Math.abs(i - BAR_COUNT / 2) / (BAR_COUNT / 2);
    return {
      value: 0.08,
      target: 0.08,
      weight: 0.45 + centred * 0.55,
      speed: 0.1 + Math.random() * 0.14
    };
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!width || !height) resize();

    ctx.clearRect(0, 0, width, height);

    const gap = Math.max(1.5, width / BAR_COUNT / 4);
    const barWidth = Math.max(1.5, width / BAR_COUNT - gap);
    const mid = height / 2;

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, accent);
    gradient.addColorStop(0.5, accentSoft);
    gradient.addColorStop(1, accent);
    ctx.fillStyle = gradient;

    bars.forEach((bar, i) => {
      if (playing) {
        bar.value += (bar.target - bar.value) * bar.speed;
        if (Math.abs(bar.target - bar.value) < 0.04) {
          bar.target = (0.2 + Math.random() ** 1.3 * 0.8) * bar.weight;
        }
      } else {
        // Settle to a flat resting line instead of freezing mid-bounce.
        bar.value += (0.035 - bar.value) * 0.08;
      }

      const barHeight = Math.max(2, bar.value * height);
      const x = i * (barWidth + gap);
      const y = mid - barHeight / 2;

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    });

    frame = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);

  return {
    setPlaying(value) {
      playing = value;
    },
    setRunning(value) {
      if (value === running) return;
      running = value;
      if (running) {
        resize();
        if (!frame) draw();
      } else if (frame) {
        cancelAnimationFrame(frame);
        frame = null;
        ctx.clearRect(0, 0, width, height);
      }
    },
    setAccent(color, soft) {
      accent = color;
      accentSoft = soft || color;
    }
  };
}
