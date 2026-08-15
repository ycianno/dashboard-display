// ══════════════════════════════════════════════════════════════════════════
// Boot
// ══════════════════════════════════════════════════════════════════════════

import { CONFIG, FLAGS } from './config.js';
import { $, esc } from './util.js';
import { weatherStore, infraStore } from './store.js';
import { createRouter, createIdleReturn } from './router.js';
import { startDisplayCare } from './display.js';
import { startClock } from './clock.js';
import { startWeather } from './weather.js';
import { startInfra } from './infra-client.js';
import { startPlayer } from './player.js';
import { initNowPlaying } from './views/now-playing.js';
import { initOverview } from './views/overview.js';
import { initInfra } from './views/infra.js';
import { initMiniPlayer } from './mini-player.js';
import { resetPalette } from './palette.js';

const VIEW_META = {
  overview: { id: 'overview', label: 'Overview', icon: 'grid', el: 'view-overview' },
  'now-playing': { id: 'now-playing', label: 'Music', icon: 'note', el: 'view-now-playing' },
  infra: { id: 'infra', label: 'Servers', icon: 'server', el: 'view-infra' }
};

function bootViews() {
  const track = $('#deck-track');
  const views = CONFIG.dashboard.views
    .map((id) => VIEW_META[id])
    .filter((meta) => meta && document.getElementById(meta.el));

  // Reorder the DOM to match the configured page order.
  views.forEach((meta) => track.appendChild(document.getElementById(meta.el)));

  // Drop any view the config left out.
  Array.from(track.children).forEach((node) => {
    if (!views.some((meta) => meta.el === node.id)) node.remove();
  });

  return views;
}

function bindTopbar() {
  const wx = {
    icon: $('#bar-wx-icon use'),
    temp: $('#bar-wx-temp'),
    desc: $('#bar-wx-desc'),
    place: $('#bar-wx-place'),
    chip: $('#bar-wx')
  };

  weatherStore.subscribe((state) => {
    if (state.status !== 'ready' || !state.current) {
      wx.chip.style.opacity = '0.45';
      return;
    }
    wx.chip.style.opacity = '1';
    wx.icon.setAttribute('href', `#wx-${state.current.icon}`);
    wx.temp.textContent = `${state.current.temp}°`;
    wx.desc.textContent = state.current.condition;
    wx.place.textContent = state.place;
  });

  const health = {
    root: $('#bar-health'),
    dot: $('#bar-health-dot'),
    text: $('#bar-health-text')
  };

  infraStore.subscribe((state) => {
    if (state.status === 'unconfigured') {
      health.root.hidden = true;
      return;
    }
    health.root.hidden = false;

    if (!state.snapshot) {
      health.root.className = 'health-pill';
      health.text.textContent = 'Checking…';
      return;
    }

    const { summary } = state.snapshot;
    const level = summary.level === 'unknown' ? '' : summary.level;
    health.root.className = `health-pill ${level}`;
    health.dot.className = `dot ${level || 'ok'} live`;

    const failing = summary.alerts.filter((a) => a.level === 'crit').length;
    health.text.textContent = failing
      ? `${failing} issue${failing > 1 ? 's' : ''}`
      : summary.alerts.length
        ? `${summary.alerts.length} warning${summary.alerts.length > 1 ? 's' : ''}`
        : 'All systems go';
  });
}

function bindToasts() {
  const rail = $('#toast-rail');

  function show(id, level, message) {
    if (document.getElementById(id)) return;
    const node = document.createElement('div');
    node.className = `toast ${level}`;
    node.id = id;
    node.innerHTML = `<span class="dot ${level}"></span><span>${esc(message)}</span>`;
    rail.appendChild(node);
  }

  function hide(id) {
    const node = document.getElementById(id);
    if (node) node.remove();
  }

  const showOffline = () => show('toast-offline', 'crit', 'No network connection');

  window.addEventListener('offline', showOffline);
  window.addEventListener('online', () => hide('toast-offline'));

  if (!navigator.onLine) showOffline();
}

function main() {
  const app = $('#app');

  startDisplayCare();
  resetPalette();

  const views = bootViews();
  const initialId = FLAGS.view || CONFIG.dashboard.defaultView;

  // ── Immersive mode ──────────────────────────────────────────────────────
  let immersive = false;
  let peekTimer = null;

  function setImmersive(value) {
    immersive = value;
    app.classList.toggle('immersive', immersive);
    $('#btn-immersive').classList.toggle('on', immersive);
    if (immersive) peekChrome();
  }

  function peekChrome() {
    if (!immersive) return;
    app.classList.add('chrome-peek');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => app.classList.remove('chrome-peek'), 4500);
  }

  // ── Router ──────────────────────────────────────────────────────────────
  const miniPlayer = initMiniPlayer({ onOpen: () => router.goToId('now-playing') });

  const router = createRouter({
    deck: $('#deck'),
    track: $('#deck-track'),
    pager: $('#pager'),
    views,
    initialId,
    onChange: (view) => {
      miniPlayer.setActiveView(view.id);
      // Immersive only makes sense on the music page.
      if (view.id !== 'now-playing' && immersive) setImmersive(false);
    }
  });

  miniPlayer.setActiveView(router.current.id);

  $('#btn-immersive').addEventListener('click', () => {
    if (router.current.id !== 'now-playing') router.goToId('now-playing');
    setImmersive(!immersive);
  });

  // In immersive mode a tap anywhere brings the chrome back for a few seconds.
  document.addEventListener('pointerdown', peekChrome, { passive: true });

  // ── Views ───────────────────────────────────────────────────────────────
  initNowPlaying({ onToggleImmersive: () => setImmersive(!immersive) });
  initOverview();
  initInfra();
  bindTopbar();
  bindToasts();

  // ── Data sources ────────────────────────────────────────────────────────
  startClock();
  startWeather();
  startInfra();
  startPlayer();

  // ── Idle return ─────────────────────────────────────────────────────────
  createIdleReturn({
    afterMs: CONFIG.dashboard.returnToDefaultAfterMs,
    onIdle: () => router.goToId(CONFIG.dashboard.defaultView)
  });

  // ── Keyboard (handy over SSH/RDP, and for a wireless remote) ────────────
  window.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowRight': router.next(); break;
      case 'ArrowLeft': router.prev(); break;
      case 'f': case 'F': setImmersive(!immersive); break;
      case '1': case '2': case '3': {
        const index = Number(event.key) - 1;
        if (index < views.length) router.go(index);
        break;
      }
      default: break;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
