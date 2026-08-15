// ══════════════════════════════════════════════════════════════════════════
// Always-on display care: burn-in drift and night dimming
//
// The README always claimed burn-in mitigation; this is the part that
// actually does it.
// ══════════════════════════════════════════════════════════════════════════

import { CONFIG, FLAGS } from './config.js';

const DRIFT_PX = 6;
const DRIFT_INTERVAL_MS = 90000;

export function startDisplayCare() {
  const app = document.getElementById('app');
  const root = document.documentElement.style;

  if (FLAGS.kiosk) document.body.classList.add('kiosk');

  // ── Burn-in drift ───────────────────────────────────────────────────────
  if (CONFIG.dashboard.burnInProtection) {
    let step = 0;
    // Walks a small diamond so no element sits on one pixel for long, while
    // staying subtle enough that nobody notices it move.
    const path = [
      [0, 0],
      [DRIFT_PX, DRIFT_PX / 2],
      [0, DRIFT_PX],
      [-DRIFT_PX, DRIFT_PX / 2],
      [-DRIFT_PX, -DRIFT_PX / 2],
      [0, -DRIFT_PX],
      [DRIFT_PX, -DRIFT_PX / 2]
    ];

    setInterval(() => {
      step = (step + 1) % path.length;
      root.setProperty('--drift-x', `${path[step][0]}px`);
      root.setProperty('--drift-y', `${path[step][1]}px`);
    }, DRIFT_INTERVAL_MS);
  }

  // ── Night dimming ───────────────────────────────────────────────────────
  const night = CONFIG.dashboard.night;

  function applyBrightness() {
    if (!night.enabled) return;

    const hour = new Date().getHours();
    // A window like 23 → 7 wraps past midnight.
    const isNight =
      night.startHour > night.endHour
        ? hour >= night.startHour || hour < night.endHour
        : hour >= night.startHour && hour < night.endHour;

    root.setProperty('--screen-dim', isNight ? String(night.brightness) : '1');
    app.classList.toggle('night', isNight);
  }

  applyBrightness();
  setInterval(applyBrightness, 60000);

  return { applyBrightness };
}
