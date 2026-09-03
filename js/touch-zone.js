// ══════════════════════════════════════════════════════════════════════════
// Touch zone
//
// This panel's digitizer is partly dead: only one band of the glass reports
// a touch. That is a layout constraint, not a styling preference — a control
// drawn outside the live band is not "hard to press", it is unreachable.
//
// So the zone is declared once here and every view lays itself out against
// it. `.tz-split` splits a view into a display half (`.tz-read`) and a
// control half (`.tz-act`); this module decides which end of the split the
// control half lives on and how much room it gets.
//
// ?touchzone=1 paints the dead area so the boundary can be checked on the
// actual hardware rather than guessed at from a desk.
// ══════════════════════════════════════════════════════════════════════════

import { FLAGS } from './config.js';

const LABEL = {
  full: 'Whole screen is live',
  top: 'Touch: top half',
  bottom: 'Touch: bottom half',
  left: 'Touch: left half',
  right: 'Touch: right half'
};

export function startTouchZone(app) {
  const zone = FLAGS.touchZone;
  app.dataset.touchZone = zone;

  if (!FLAGS.showTouchZone || zone === 'full') return { zone };

  // The overlay must not swallow the touches it is drawn to explain.
  const overlay = document.createElement('div');
  overlay.className = 'tz-overlay';
  overlay.dataset.zone = zone;
  overlay.innerHTML = `
    <div class="tz-dead"><span class="tz-tag">No touch here</span></div>
    <div class="tz-live"><span class="tz-tag">${LABEL[zone]}</span></div>`;
  document.body.appendChild(overlay);

  return { zone, overlay };
}
