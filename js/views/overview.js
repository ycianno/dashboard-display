// ══════════════════════════════════════════════════════════════════════════
// Overview — the page the display sits on, and the index to the other four
//
// The top half is the glance: clock, daylight, forecast. It is read from
// across the room and, on this panel, from dead glass — so nothing up there
// is pressable.
//
// The bottom half is a jump tile per page. Each one carries enough of its
// page to answer the question you would have swiped over to ask — how many
// quests are left, what is playing, whether anything is on fire — and a tap
// takes you there. That is the difference between a home page and a poster.
// ══════════════════════════════════════════════════════════════════════════

import { $, esc, icon, clamp } from '../util.js';
import { CONFIG } from '../config.js';
import { weatherStore, infraStore, playerStore, forgeStore } from '../store.js';

function wxIcon(name, className = 'wx-icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="#wx-${name}"></use></svg>`;
}

function clockTime(iso) {
  const date = new Date(iso);
  let hours = date.getHours();
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(date.getMinutes()).padStart(2, '0')} ${suffix}`;
}

/**
 * The hourly temperatures as a line, one point per column, so the shape of
 * the day is seen rather than read off eight numbers.
 */
function tempCurve(hours) {
  if (hours.length < 2) return '';
  const temps = hours.map((h) => h.temp);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const span = hi - lo || 1;
  const W = 100;
  const H = 30;
  const pts = temps.map((t, i) => [((i + 0.5) / temps.length) * W, 4 + (1 - (t - lo) / span) * (H - 8)]);
  // A Catmull-Rom pass turned into cubic Béziers: smooth, and it passes
  // through every reading.
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1.map((v) => v.toFixed(2)).join(',')} ${c2.map((v) => v.toFixed(2)).join(',')} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  const area = `${d} L${pts[pts.length - 1][0].toFixed(2)},${H} L${pts[0][0].toFixed(2)},${H} Z`;
  return `
    <svg class="wx-curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="wx-curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fbbf24" stop-opacity="0.28" />
          <stop offset="1" stop-color="#fbbf24" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path class="area" d="${area}" />
      <path class="line" d="${d}" vector-effect="non-scaling-stroke" />
    </svg>`;
}

export function initOverview(context = {}) {
  const el = {
    time: $('#ov-time'),
    period: $('#ov-period'),
    date: $('#ov-date'),
    sub: $('#ov-sub'),
    sunrise: $('#ov-sunrise'),
    sunset: $('#ov-sunset'),

    daylightFill: $('#ov-daylight-fill'),
    daylightMarker: $('#ov-daylight-marker'),

    wx: $('#ov-wx'),
    next: $('#ov-next'),
    jump: $('#ov-jump')
  };

  function paintDaylight(sunrise, sunset) {
    const start = new Date(sunrise).getTime();
    const end = new Date(sunset).getTime();
    const ratio = clamp((Date.now() - start) / (end - start), 0, 1) * 100;
    el.daylightFill.style.width = `${ratio}%`;
    el.daylightMarker.style.left = `${ratio}%`;
  }

  // ── Weather ─────────────────────────────────────────────────────────────
  weatherStore.subscribe((state) => {
    if (state.status === 'loading') {
      el.wx.innerHTML = `<div class="placeholder">${icon('cloud')}<p>Loading forecast…</p></div>`;
      return;
    }
    if (state.status === 'error' || !state.current) {
      el.wx.innerHTML = `<div class="placeholder">${icon('cloud-off')}<h3>Weather unavailable</h3><p>Could not reach Open-Meteo.</p></div>`;
      return;
    }

    const c = state.current;
    // Eight hours fit the card at a readable size; the old strip scrolled
    // sideways on a panel nobody can scroll, so the last columns were cut off.
    const hours = state.hourly.slice(0, 8);

    el.sunrise.textContent = clockTime(c.sunrise);
    el.sunset.textContent = clockTime(c.sunset);
    paintDaylight(c.sunrise, c.sunset);
    // The marker crawls across the day; the weather poll alone is too coarse.
    clearInterval(paintDaylight.timer);
    paintDaylight.timer = setInterval(() => paintDaylight(c.sunrise, c.sunset), 60000);

    // Shared min/max across the week so each day's bar is comparable.
    const weekLow = Math.min(...state.daily.map((d) => d.low));
    const weekHigh = Math.max(...state.daily.map((d) => d.high));
    const span = weekHigh - weekLow || 1;

    el.wx.innerHTML = `
      <div class="wx-now">
        ${wxIcon(c.icon)}
        <div class="wx-now-main">
          <div class="wx-now-temp">
            <span class="t tnum">${c.temp}°</span>
            <span class="hl tnum">H ${c.high}° · L ${c.low}°</span>
          </div>
          <div class="wx-now-desc">${esc(c.condition)}</div>
          <div class="wx-now-place">${esc(state.place)}</div>
        </div>
      </div>

      <div class="wx-facts">
        <span class="wx-fact">${icon('thermometer', 'ic ic-sm')} Feels ${c.feelsLike}°</span>
        <span class="wx-fact">${icon('droplet', 'ic ic-sm')} ${c.humidity}%</span>
        <span class="wx-fact">${icon('wind', 'ic ic-sm')} ${c.wind}</span>
        <span class="wx-fact">${icon('sun', 'ic ic-sm')} UV ${c.uv}</span>
      </div>

      <div class="wx-hours" style="--cols:${hours.length}">
        ${hours
          .map(
            (hour, i) => `
          <div class="wx-hour ${i === 0 ? 'now' : ''}" title="${esc(hour.condition)}">
            <span class="h">${esc(hour.label)}</span>
            ${wxIcon(hour.icon)}
            <span class="t tnum">${hour.temp}°</span>
            <span class="p">${hour.precip >= 15 ? `${hour.precip}%` : ''}</span>
          </div>`
          )
          .join('')}
        ${tempCurve(hours)}
      </div>

      <div class="wx-days">
        ${state.daily
          .slice(0, 4)
          .map((day) => {
            const left = ((day.low - weekLow) / span) * 100;
            const width = clamp(((day.high - day.low) / span) * 100, 6, 100 - left);
            return `
              <div class="wx-day">
                <span class="d">${esc(day.label)}</span>
                ${wxIcon(day.icon)}
                <span class="wx-range"><i style="left:${left}%;width:${width}%"></i></span>
                <span class="mm tnum">${day.low}° <b>${day.high}°</b></span>
              </div>`;
          })
          .join('')}
      </div>`;
  });

  // ── What's next ─────────────────────────────────────────────────────────
  function renderNext() {
    const state = forgeStore.get();
    const summary = state.summary;

    if (!summary || !summary.today.total) {
      el.next.innerHTML = '';
      return;
    }

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const parse = (value) => {
      if (!value) return null;
      const [h, m] = String(value).split(':').map(Number);
      return Number.isFinite(h) ? h * 60 + (m || 0) : null;
    };

    const open = summary.today.quests.filter((q) => !q.done);
    if (!open.length) {
      el.next.innerHTML = `
        <span class="eyebrow">Today</span>
        <div class="hero-next-body cleared">${icon('check')}<span>Day cleared</span></div>`;
      return;
    }

    // The next thing still ahead; if everything left is already overdue, the
    // most overdue one is what you should be looking at.
    const ahead = open.find((q) => {
      const at = parse(q.at);
      return at === null || at >= nowMinutes;
    });
    const quest = ahead || open[0];
    const late = !ahead;

    el.next.innerHTML = `
      <span class="eyebrow">${late ? 'Overdue' : 'Next up'}</span>
      <div class="hero-next-body ${late ? 'late' : ''}" style="--tag:${esc(quest.color)}">
        <span class="t truncate">${esc(quest.title)}</span>
        <span class="m">
          ${quest.at ? `<b>${esc(clockLabel(quest.at))}</b> · ` : ''}${esc(quest.attr)}
          · ${open.length} left today
        </span>
      </div>`;
  }

  function clockLabel(value) {
    const [h, m] = String(value).split(':').map(Number);
    if (!Number.isFinite(h)) return '';
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(m || 0).padStart(2, '0')} ${suffix}`;
  }

  // ── Jump tiles ──────────────────────────────────────────────────────────
  // One tile per other page, each summarising it. They are re-rendered from
  // whichever store changed, so the tile is never more than a poll behind the
  // page it points at.

  // Only offer a page the config actually turned on — a tile that navigates
  // nowhere is worse than no tile.
  const enabled = new Set(CONFIG.dashboard.views || []);

  function tile(id, body, { level = '', art = '' } = {}) {
    return `
      <button class="ov-tile pressable ${level}" data-view="${id}">
        ${art ? `<span class="ov-tile-art" style="background-image:url('${esc(art)}')"></span>` : ''}
        ${icon('chevron', 'ic ov-tile-go')}
        ${body}
      </button>`;
  }

  function forgeTile() {
    const state = forgeStore.get();

    if (state.status === 'unconfigured') {
      return tile('forge', `
        <span class="eyebrow">Today</span>
        <div class="ov-tile-quiet">${icon('forge')}<span>Connect The Forge</span></div>`);
    }

    if (!state.summary) {
      const message = {
        outdated: 'The Forge needs updating',
        auth: 'Sync token rejected'
      }[state.reason] || (state.status === 'loading' ? 'Reaching The Forge…' : 'Unreachable');

      return tile('forge', `
        <span class="eyebrow">Today</span>
        <div class="ov-tile-quiet">${icon('forge')}<span>${esc(message)}</span></div>`,
        { level: state.status === 'loading' ? '' : 'crit' });
    }

    const { today, profile, streak } = state.summary;
    const left = today.total - today.done;

    const upcoming = today.quests.filter((q) => !q.done).slice(0, 3);

    return tile('forge', `
      <span class="eyebrow">Today</span>
      <div class="ov-tile-figure">
        <span class="n tnum">${today.total ? left : '—'}</span>
        <span class="k">${
          !today.total
            ? 'nothing scheduled'
            : left
              ? `of ${today.total} left`
              : 'all clear'
        }</span>
      </div>
      <div class="ov-tile-bar"><i style="width:${today.pct}%"></i></div>
      <div class="ov-tile-list">
        ${
          upcoming.length
            ? upcoming
                .map(
                  (q) => `
            <span class="row" style="--tag:${esc(q.color)}">
              <i></i>
              <span class="when tnum">${q.at ? esc(clockLabel(q.at)) : '—'}</span>
              <span class="what truncate">${esc(q.title)}</span>
            </span>`
                )
                .join('')
            : '<span class="row done">Everything ticked.</span>'
        }
      </div>
      <div class="ov-tile-foot">
        <span>${icon('forge', 'ic ic-sm')} Level ${profile.level} · ${esc(profile.rank.name)}</span>
        <span>${icon('flame', 'ic ic-sm')} ${streak.day}d</span>
      </div>`);
  }

  function musicTile() {
    const state = playerStore.get();

    if (state.status === 'unauthenticated') {
      return tile('now-playing', `
        <span class="eyebrow">Music</span>
        <div class="ov-tile-quiet">${icon('spotify')}<span>Spotify not connected</span></div>`);
    }

    if (!state.track) {
      return tile('now-playing', `
        <span class="eyebrow">Music</span>
        <div class="ov-tile-quiet">${icon('note')}<span>Nothing playing</span></div>`);
    }

    return tile('now-playing', `
      <span class="eyebrow">Music</span>
      <div class="ov-tile-np">
        ${state.track.artUrl ? `<img src="${esc(state.track.artUrl)}" alt="">` : ''}
        <span class="meta">
          <span class="t truncate">${esc(state.track.name)}</span>
          <span class="a truncate">${esc(state.track.artists.join(', '))}</span>
        </span>
      </div>
      <div class="ov-tile-bar"><i id="ov-np-fill" style="width:0%"></i></div>
      <div class="ov-tile-foot">
        <span>${
          state.isPlaying
            ? '<span class="eq"><i></i><i></i><i></i></span> Playing'
            : `${icon('pause', 'ic ic-sm')} Paused`
        }</span>
        ${state.device ? `<span class="truncate">${esc(state.device.name)}</span>` : ''}
      </div>`, { art: state.track.artUrl || '' });
  }

  function serversTile() {
    const state = infraStore.get();

    if (state.status === 'unconfigured') {
      return tile('infra', `
        <span class="eyebrow">Servers</span>
        <div class="ov-tile-quiet">${icon('server')}<span>No servers configured</span></div>`);
    }

    if (!state.snapshot) {
      return tile('infra', `
        <span class="eyebrow">Servers</span>
        <div class="ov-tile-quiet">${icon('server')}<span>Checking…</span></div>`);
    }

    const { summary } = state.snapshot;
    const failing = summary.alerts.filter((a) => a.level === 'crit').length;
    const level = summary.level === 'unknown' ? '' : summary.level;

    return tile('infra', `
      <span class="eyebrow">Servers</span>
      <div class="ov-tile-figure">
        <span class="n tnum">${summary.servicesUp}<span class="of">/${summary.servicesTotal}</span></span>
        <span class="k">services up</span>
      </div>
      <div class="ov-tile-list">
        ${
          summary.alerts.length
            ? summary.alerts
                .slice(0, 3)
                .map(
                  (alert) => `
            <span class="row alert ${esc(alert.level)}">
              <i></i>
              <span class="what truncate">${esc(alert.source)} · ${esc(alert.message)}</span>
            </span>`
                )
                .join('')
            : `<span class="row ok"><span class="dot ok"></span> All systems go</span>`
        }
      </div>
      <div class="ov-tile-foot">
        <span><span class="dot ${level || 'ok'}"></span> ${
          failing
            ? `${failing} issue${failing > 1 ? 's' : ''}`
            : summary.alerts.length
              ? `${summary.alerts.length} warning${summary.alerts.length > 1 ? 's' : ''}`
              : 'Healthy'
        }</span>
        <span>${summary.hostsUp}/${summary.hostsTotal} hosts · ${summary.guestsRunning}/${summary.guestsTotal} guests</span>
      </div>`, { level });
  }

  const BUILDERS = {
    forge: forgeTile,
    'now-playing': musicTile,
    infra: serversTile
  };

  function renderJump() {
    el.jump.innerHTML = Object.keys(BUILDERS)
      .filter((id) => enabled.has(id))
      .map((id) => BUILDERS[id]())
      .join('');
  }

  el.jump.addEventListener('click', (event) => {
    const button = event.target.closest('.ov-tile');
    if (button && context.goToView) context.goToView(button.dataset.view);
  });

  // playerStore ticks four times a second for lyric timing, so the tiles are
  // only rebuilt when something structural changes; the progress bar is
  // moved in place.
  let lastNpKey = '';

  playerStore.subscribe((state) => {
    const key = [
      state.status,
      state.track?.id || '',
      state.isPlaying,
      state.device?.name || ''
    ].join('|');

    if (key !== lastNpKey) {
      lastNpKey = key;
      renderJump();
    }

    const fill = document.getElementById('ov-np-fill');
    if (fill && state.durationMs) {
      fill.style.width = `${clamp((state.progressMs / state.durationMs) * 100, 0, 100)}%`;
    }
  });

  infraStore.subscribe(renderJump, { immediate: false });
  forgeStore.subscribe(() => {
    renderJump();
    renderNext();
  }, { immediate: false });

  renderJump();
  renderNext();
}
