// ══════════════════════════════════════════════════════════════════════════
// Overview view — clock, forecast, infrastructure health, now playing
// ══════════════════════════════════════════════════════════════════════════

import { $, esc, icon, clamp, formatDuration } from '../util.js';
import { weatherStore, infraStore, playerStore } from '../store.js';

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

export function initOverview() {
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
    np: $('#ov-np'),
    health: $('#ov-health')
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

      <div class="wx-hours">
        ${state.hourly
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

  // ── Now playing card ────────────────────────────────────────────────────
  // playerStore ticks four times a second for lyric timing, so the card is
  // only rebuilt when something structural changes; the progress bar is
  // updated in place.
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
      renderNowPlaying(state);
    }

    const fill = document.getElementById('ov-np-fill');
    if (fill && state.durationMs) {
      fill.style.width = `${clamp((state.progressMs / state.durationMs) * 100, 0, 100)}%`;
    }
    const elapsed = document.getElementById('ov-np-elapsed');
    if (elapsed) elapsed.textContent = formatDuration(state.progressMs);
  });

  function renderNowPlaying(state) {
    const head = '<span class="eyebrow">Now Playing</span>';

    if (state.status === 'unauthenticated') {
      el.np.innerHTML = `${head}<div class="placeholder">${icon('spotify')}<p>Spotify not connected</p></div>`;
      return;
    }

    if (!state.track) {
      el.np.innerHTML = `${head}<div class="placeholder">${icon('note')}<p>Nothing playing</p></div>`;
      return;
    }

    el.np.innerHTML = `
      ${head}
      <div class="ov-np-body">
        ${state.track.artUrl ? `<img class="ov-np-art" src="${esc(state.track.artUrl)}" alt="">` : ''}
        <div class="ov-np-meta">
          <span class="t truncate">${esc(state.track.name)}</span>
          <span class="a truncate">${esc(state.track.artists.join(', '))}</span>
          <span class="ov-np-state">
            ${
              state.isPlaying
                ? '<span class="eq"><i></i><i></i><i></i></span> Playing'
                : `${icon('pause', 'ic ic-sm')} Paused`
            }
            ${state.device ? `· ${esc(state.device.name)}` : ''}
          </span>
        </div>
      </div>
      <div class="ov-np-progress">
        <span class="tnum" id="ov-np-elapsed">0:00</span>
        <span class="bar"><i id="ov-np-fill"></i></span>
        <span class="tnum">${formatDuration(state.durationMs)}</span>
      </div>`;
  }

  // ── Infrastructure health card ──────────────────────────────────────────
  infraStore.subscribe((state) => {
    const head = `<span class="eyebrow">Infrastructure</span>`;

    if (state.status === 'unconfigured') {
      el.health.innerHTML = `${head}<div class="placeholder">${icon('server')}<p>No servers configured</p></div>`;
      return;
    }

    if (state.status === 'loading' || !state.snapshot) {
      el.health.innerHTML = `${head}<div class="placeholder">${icon('server')}<p>Checking…</p></div>`;
      return;
    }

    const { summary } = state.snapshot;

    const cards = [
      {
        k: 'Hosts',
        v: `${summary.hostsUp}/${summary.hostsTotal}`,
        level: summary.hostsUp === summary.hostsTotal ? 'ok' : 'crit'
      },
      { k: 'Guests', v: `${summary.guestsRunning}/${summary.guestsTotal}`, level: '' },
      {
        k: 'Services',
        v: `${summary.servicesUp}/${summary.servicesTotal}`,
        level: summary.servicesUp === summary.servicesTotal ? 'ok' : 'crit'
      }
    ];

    el.health.innerHTML = `
      ${head}
      <div class="health-grid">
        ${cards
          .map(
            (card) => `
          <div class="health-stat ${card.level}">
            <span class="v tnum">${card.v}</span>
            <span class="k">${card.k}</span>
          </div>`
          )
          .join('')}
      </div>
      <div class="health-alerts scroll">
        ${
          summary.alerts.length
            ? summary.alerts
                .slice(0, 6)
                .map(
                  (alert) => `
              <div class="health-alert ${alert.level}">
                <span class="dot ${alert.level}"></span>
                <span class="src">${esc(alert.source)}</span>
                <span class="msg truncate">${esc(alert.message)}</span>
              </div>`
                )
                .join('')
            : `<div class="health-clear">${icon('check', 'ic ic-sm')} Everything healthy</div>`
        }
      </div>`;
  });
}
