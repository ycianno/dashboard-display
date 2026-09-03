// ══════════════════════════════════════════════════════════════════════════
// Clock — drives both the top bar and the Overview hero
// ══════════════════════════════════════════════════════════════════════════

import { $ } from './util.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function greeting(hour) {
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

export function startClock() {
  const nodes = {
    barTime: $('#bar-time'),
    barPeriod: $('#bar-period'),
    barDay: $('#bar-day'),
    barDate: $('#bar-date'),
    ovTime: $('#ov-time'),
    ovPeriod: $('#ov-period'),
    ovDate: $('#ov-date'),
    ovSub: $('#ov-sub')
  };

  function tick() {
    const now = new Date();
    const hour24 = now.getHours();
    const period = hour24 >= 12 ? 'PM' : 'AM';
    const hour = hour24 % 12 || 12;
    const minutes = String(now.getMinutes()).padStart(2, '0');

    const time = `${hour}:${minutes}`;
    const day = DAYS[now.getDay()];
    const date = `${MONTHS[now.getMonth()]} ${now.getDate()}`;

    if (nodes.barTime.textContent !== time) nodes.barTime.textContent = time;
    if (nodes.barPeriod.textContent !== period) nodes.barPeriod.textContent = period;
    if (nodes.barDay.textContent !== day) nodes.barDay.textContent = day;
    if (nodes.barDate.textContent !== date) nodes.barDate.textContent = date;

    // The Overview hero is only present when that page is configured; the
    // top bar is always there.
    if (!nodes.ovTime) return;

    if (nodes.ovTime.textContent !== time) nodes.ovTime.textContent = time;
    if (nodes.ovPeriod.textContent !== period) nodes.ovPeriod.textContent = period;

    const longDate = `${day}, ${date}`;
    if (nodes.ovDate.textContent !== longDate) nodes.ovDate.textContent = longDate;

    const sub = greeting(hour24);
    if (nodes.ovSub.textContent !== sub) nodes.ovSub.textContent = sub;
  }

  tick();
  // Align to the top of the minute rather than free-running every second, so
  // the displayed minute never lags behind the real one.
  const align = () => {
    tick();
    setTimeout(align, 60000 - (Date.now() % 60000) + 50);
  };
  setTimeout(align, 60000 - (Date.now() % 60000) + 50);

  return { tick };
}
