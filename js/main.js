// ══════════════════════════════════════════════════════════════════════════
// Boot
// ══════════════════════════════════════════════════════════════════════════

import { CONFIG, FLAGS } from './config.js';
import { $, esc } from './util.js';
import { weatherStore, infraStore, playerStore } from './store.js';
import { createRouter, createIdleReturn } from './router.js';
import { startTouchZone } from './touch-zone.js';
import { startDisplayCare } from './display.js';
import { startClock } from './clock.js';
import { startWeather } from './weather.js';
import { startInfra } from './infra-client.js';
import { startPlayer } from './player.js';
import { startForge } from './forge-client.js';
import { resolveViews } from './views/registry.js';
import { initMiniPlayer } from './mini-player.js';
import { resetPalette } from './palette.js';

function bootViews() {
  const track = $('#deck-track');
  const views = resolveViews(CONFIG.dashboard.views);

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

  // Spotify ends every grant six months after sign-in, and refreshing doesn't
  // reset that clock. Say so two weeks ahead, while it's still a convenient
  // moment to sign in again, rather than letting the panel go dark one morning.
  const GRANT_LIFETIME_DAYS = 182;
  const WARN_DAYS_AHEAD = 14;
  playerStore.subscribe((state) => {
    if (!state.grantedAt || state.status === 'unauthenticated') {
      hide('toast-spotify-grant');
      return;
    }
    const ageDays = (Date.now() - state.grantedAt) / 86400000;
    const daysLeft = Math.max(0, Math.ceil(GRANT_LIFETIME_DAYS - ageDays));
    if (daysLeft > WARN_DAYS_AHEAD) {
      hide('toast-spotify-grant');
      return;
    }
    show(
      'toast-spotify-grant',
      'warn',
      `Spotify sign-in expires in about ${daysLeft} day${daysLeft === 1 ? '' : 's'} — sign in again to keep the music page`
    );
  });

  const showOffline = () => show('toast-offline', 'crit', 'No network connection');

  window.addEventListener('offline', showOffline);
  window.addEventListener('online', () => hide('toast-offline'));

  if (!navigator.onLine) showOffline();
}

/**
 * localhost and 127.0.0.1 are different origins to the browser. Spotify only
 * redirects back to the address registered on the app (127.0.0.1), so a
 * sign-in started on localhost saved its PKCE verifier where the callback
 * can't read it, and silently failed. Move to the redirect's origin first.
 */
function moveToRedirectOrigin() {
  let target;
  try {
    target = new URL(CONFIG.spotify.redirectUri);
  } catch (err) {
    return false;
  }
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
  const here = window.location;
  if (
    here.origin === target.origin ||
    here.port !== target.port ||
    !loopback.has(here.hostname) ||
    !loopback.has(target.hostname)
  ) {
    return false;
  }
  here.replace(`${target.origin}${here.pathname}${here.search}${here.hash}`);
  return true;
}

function main() {
  if (moveToRedirectOrigin()) return;

  const app = $('#app');

  startDisplayCare();
  startTouchZone(app);
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
  // Each view gets the same context; most ignore most of it.
  const context = {
    goToView: (id) => router.goToId(id),
    onToggleImmersive: () => setImmersive(!immersive)
  };
  views.forEach((view) => view.init(context));
  bindTopbar();
  bindToasts();

  // ── Data sources ────────────────────────────────────────────────────────
  startClock();
  startWeather();
  startInfra();
  startPlayer();
  startForge();

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
      default: {
        // 1..9 jump straight to a page, however many pages are configured.
        if (/^[1-9]$/.test(event.key)) {
          const index = Number(event.key) - 1;
          if (index < views.length) router.go(index);
        }
        break;
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
