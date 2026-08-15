// ══════════════════════════════════════════════════════════════════════════
// Playback controller: polls Spotify, interpolates progress, exposes actions
// ══════════════════════════════════════════════════════════════════════════

import { CONFIG, FLAGS } from './config.js';
import { SpotifyClient } from './spotify-api.js';
import { playerStore } from './store.js';
import { loadLyrics } from './lyrics.js';
import { createPoller, clamp } from './util.js';

const TICK_MS = 250; // fine-grained enough for synced lyrics to land on time

export const spotify = new SpotifyClient(CONFIG.spotify);

let poller = null;
let ticker = null;
let lastTrackId = null;
let lastQueueFetch = 0;
let lastDeviceFetch = 0;
// Set while a control press is in flight so an in-flight poll can't overwrite
// the optimistic state and make the button flicker back.
let optimisticUntil = 0;

function normalizeTrack(item) {
  if (!item) return null;

  // Tracks carry `album.images` and `artists`; podcast episodes carry
  // `images` and a `show` instead.
  const images = item.album?.images || item.images || [];
  let artists = [];
  if (Array.isArray(item.artists) && item.artists.length) {
    artists = item.artists.map((artist) => artist.name);
  } else if (item.show?.name) {
    artists = [item.show.name];
  }

  return {
    id: item.id,
    name: item.name,
    artists,
    album: item.album?.name || item.show?.name || '',
    artUrl: images.length ? images[0].url : null,
    thumbUrl: images.length ? images[images.length - 1].url : null,
    durationMs: item.duration_ms || 0
  };
}

async function refreshQueue() {
  const result = await spotify.getQueue();
  if (!result.ok || !result.data) return;
  playerStore.set({
    queue: (result.data.queue || []).slice(0, 12).map(normalizeTrack).filter(Boolean)
  });
}

async function refreshDevices() {
  const result = await spotify.getDevices();
  if (!result.ok || !result.data) return;
  playerStore.set({
    devices: (result.data.devices || []).map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      active: d.is_active,
      volume: d.volume_percent
    }))
  });
}

async function poll() {
  const result = await spotify.getPlaybackState();

  if (result.unauthenticated) {
    playerStore.set({ status: 'unauthenticated', track: null, isPlaying: false });
    return;
  }

  if (result.offline) {
    playerStore.set({ error: 'offline' });
    throw new Error('Spotify unreachable');
  }

  if (result.rateLimited) return;

  if (!result.ok) {
    playerStore.set({ error: `Spotify API error ${result.status || ''}`.trim() });
    return;
  }

  // 204 / empty body means no active device at all.
  if (result.empty || !result.data || !result.data.item) {
    lastTrackId = null;
    playerStore.set({
      status: 'idle',
      track: null,
      isPlaying: false,
      progressMs: 0,
      durationMs: 0,
      queue: [],
      error: null
    });
    return;
  }

  const data = result.data;
  const track = normalizeTrack(data.item);
  const respectOptimistic = Date.now() < optimisticUntil;

  playerStore.set((state) => ({
    ...state,
    status: data.is_playing ? 'playing' : 'paused',
    track,
    progressMs: data.progress_ms ?? 0,
    durationMs: track.durationMs,
    isPlaying: respectOptimistic ? state.isPlaying : Boolean(data.is_playing),
    shuffle: Boolean(data.shuffle_state),
    repeat: data.repeat_state || 'off',
    volume: data.device ? data.device.volume_percent : state.volume,
    device: data.device ? { id: data.device.id, name: data.device.name, type: data.device.type } : null,
    error: null
  }));

  const now = Date.now();

  if (track.id !== lastTrackId) {
    lastTrackId = track.id;
    lastQueueFetch = now;
    refreshQueue();
    loadLyrics(track);
  } else if (now - lastQueueFetch > 30000) {
    // The queue changes without the track changing (user adds something).
    lastQueueFetch = now;
    refreshQueue();
  }

  if (now - lastDeviceFetch > 30000) {
    lastDeviceFetch = now;
    refreshDevices();
  }
}

/** Advances progress between polls so the bar and lyrics move smoothly. */
function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    const state = playerStore.get();
    if (!state.isPlaying || !state.durationMs) return;
    if (state.progressMs >= state.durationMs) return;
    playerStore.set({ progressMs: Math.min(state.progressMs + TICK_MS, state.durationMs) });
  }, TICK_MS);
}

// ── Actions ────────────────────────────────────────────────────────────────

function optimistic(patch, holdMs = 1500) {
  optimisticUntil = Date.now() + holdMs;
  playerStore.set(patch);
}

export const actions = {
  async toggle() {
    const { isPlaying } = playerStore.get();
    optimistic({ isPlaying: !isPlaying, status: !isPlaying ? 'playing' : 'paused' });
    await (isPlaying ? spotify.pause() : spotify.play());
    poller?.kick();
  },

  async next() {
    await spotify.next();
    poller?.kick(300);
  },

  async previous() {
    // Matches every other player: restart the track unless you press it early.
    const { progressMs } = playerStore.get();
    if (progressMs > 4000) {
      optimistic({ progressMs: 0 });
      await spotify.seek(0);
    } else {
      await spotify.previous();
    }
    poller?.kick(300);
  },

  async seek(ms) {
    const { durationMs } = playerStore.get();
    const target = clamp(ms, 0, durationMs);
    optimistic({ progressMs: target });
    await spotify.seek(target);
    poller?.kick(600);
  },

  async setVolume(percent) {
    const target = clamp(Math.round(percent), 0, 100);
    optimistic({ volume: target });
    await spotify.setVolume(target);
  },

  async toggleShuffle() {
    const next = !playerStore.get().shuffle;
    optimistic({ shuffle: next });
    const result = await spotify.setShuffle(next);
    if (!result.ok) playerStore.set({ shuffle: !next });
    poller?.kick();
  },

  async cycleRepeat() {
    const order = ['off', 'context', 'track'];
    const current = playerStore.get().repeat;
    const next = order[(order.indexOf(current) + 1) % order.length];
    optimistic({ repeat: next });
    const result = await spotify.setRepeat(next);
    if (!result.ok) playerStore.set({ repeat: current });
    poller?.kick();
  },

  async transferTo(deviceId) {
    await spotify.transfer(deviceId);
    lastDeviceFetch = 0;
    poller?.kick(900);
  },

  login() {
    spotify.initiateLogin();
  },

  refreshDevices
};

// ── Demo mode ──────────────────────────────────────────────────────────────

function demoArt(hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue}, 76%, 56%)"/>
      <stop offset="55%" stop-color="hsl(${(hue + 38) % 360}, 68%, 38%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 300) % 360}, 60%, 18%)"/>
    </linearGradient></defs>
    <rect width="600" height="600" fill="url(#g)"/>
    <circle cx="430" cy="170" r="110" fill="hsl(${(hue + 20) % 360}, 90%, 70%)" opacity="0.55"/>
    <rect x="70" y="380" width="300" height="26" rx="13" fill="rgba(255,255,255,0.42)"/>
    <rect x="70" y="428" width="190" height="26" rx="13" fill="rgba(255,255,255,0.24)"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function startDemo() {
  const track = {
    id: 'demo-track',
    name: 'Midnight Cartography',
    artists: ['Halcyon Field'],
    album: 'Slow Transit',
    artUrl: demoArt(268),
    thumbUrl: demoArt(268),
    durationMs: 254000
  };

  playerStore.set({
    status: 'playing',
    track,
    progressMs: 74000,
    durationMs: track.durationMs,
    isPlaying: true,
    shuffle: true,
    repeat: 'context',
    volume: 62,
    device: { id: 'demo', name: 'Living Room', type: 'Speaker' },
    devices: [
      { id: 'demo', name: 'Living Room', type: 'Speaker', active: true, volume: 62 },
      { id: 'demo2', name: 'Surface Pro', type: 'Computer', active: false, volume: 40 },
      { id: 'demo3', name: 'Pixel 8', type: 'Smartphone', active: false, volume: 80 }
    ],
    queue: [
      { id: 'q1', name: 'Harbour Lights', artists: ['Cassette Ghost'], album: '', thumbUrl: demoArt(190), durationMs: 208000 },
      { id: 'q2', name: 'Paper Antenna', artists: ['Halcyon Field'], album: '', thumbUrl: demoArt(320), durationMs: 241000 },
      { id: 'q3', name: 'Slow Transit', artists: ['Halcyon Field', 'Mira Vex'], album: '', thumbUrl: demoArt(40), durationMs: 187000 },
      { id: 'q4', name: 'Northbound', artists: ['Sable Room'], album: '', thumbUrl: demoArt(140), durationMs: 226000 }
    ],
    lyrics: {
      state: 'ready',
      trackId: 'demo-track',
      plain: null,
      synced: [
        { timeMs: 68000, text: 'Counting the streetlights out of town' },
        { timeMs: 73000, text: 'Every one a little further down' },
        { timeMs: 78500, text: 'I drew the map from memory' },
        { timeMs: 83000, text: 'And every road leads back to me' },
        { timeMs: 89000, text: '' },
        { timeMs: 92000, text: 'Midnight cartography' },
        { timeMs: 97000, text: 'Charting where you used to be' }
      ]
    },
    error: null
  });

  startTicker();
}

// ── Boot ───────────────────────────────────────────────────────────────────

export async function startPlayer() {
  if (FLAGS.demo) {
    startDemo();
    return null;
  }

  if (window.location.search.includes('code=')) {
    await spotify.handleCallback();
  }

  if (!CONFIG.spotify.clientId) {
    playerStore.set({ status: 'unauthenticated', error: 'missing-client-id' });
    return null;
  }

  if (!spotify.isAuthenticated()) {
    playerStore.set({ status: 'unauthenticated' });
    return null;
  }

  poller = createPoller(poll, { interval: CONFIG.dashboard.spotifyPollInterval });
  poller.start();
  startTicker();

  // Polling a paused display is wasted work; the Surface sleeps its browser
  // when the screen is off.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      poller.stop();
    } else {
      poller.start();
    }
  });

  return poller;
}
