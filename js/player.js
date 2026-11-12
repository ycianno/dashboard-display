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

// Liked-ness per track id, so a track seen before shows its heart at once
// instead of blinking empty while the check is in flight.
const likedCache = new Map();
// Taps per track id. A check that started before a tap on THAT song must not
// land after it and flip the heart (or the cache) back. Keyed per song so a
// tap on one doesn't throw away a check in flight for another.
const likeTaps = new Map();
let lastLikedCheck = 0;
// Heart taps made while the Liked list is loading, replayed onto the response
// when it lands — the response was read before the taps and doesn't have them.
let likedLoad = null; // { promise, edits: Map<id, { track, liked, wasLiked }> }

const LIKED_PAGE = 50;

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
    uri: item.uri || null,
    // 'track' | 'episode' | 'local'. Only Spotify tracks can be liked: a local
    // file has type 'track' but no catalogue entry to save.
    type: item.is_local ? 'local' : item.type || 'track',
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

async function checkLiked(track) {
  if (!track || track.type !== 'track' || !track.uri) return;
  const taps = likeTaps.get(track.id) || 0;
  lastLikedCheck = Date.now();
  const result = await spotify.libraryContains([track.uri]);
  if (!result.ok || !Array.isArray(result.data)) return;
  // Someone tapped this song's heart while we were asking: the tap wins.
  if ((likeTaps.get(track.id) || 0) !== taps) return;
  const liked = Boolean(result.data[0]);
  likedCache.set(track.id, liked);
  if (playerStore.get().track?.id === track.id) playerStore.set({ liked });
}

function likedFrom(track) {
  if (!track || track.type !== 'track') return null;
  return likedCache.has(track.id) ? likedCache.get(track.id) : null;
}

function loadLikedTracks({ force = false } = {}) {
  if (likedLoad) return likedLoad.promise;
  const { likedTracks } = playerStore.get();
  if (!force && likedTracks.status === 'ready' && Date.now() - likedTracks.loadedAt < 60000) return Promise.resolve();

  // A list already on screen stays up while it refreshes; only an empty one
  // shows the loading skeleton.
  if (!likedTracks.items.length) {
    playerStore.set({ likedTracks: { ...likedTracks, status: 'loading', notice: null } });
  }

  const edits = new Map();
  const promise = (async () => {
    const result = await spotify.getLikedTracks({ limit: LIKED_PAGE });
    if (!result.ok || !result.data) {
      const current = playerStore.get().likedTracks;
      playerStore.set({ likedTracks: { ...current, status: current.items.length ? 'ready' : 'error' } });
      return;
    }
    const items = (result.data.items || []).map((entry) => normalizeTrack(entry.track)).filter(Boolean);
    items.forEach((track) => {
      if (!edits.has(track.id)) likedCache.set(track.id, true);
    });
    let list = { status: 'ready', items, total: result.data.total || items.length, loadedAt: Date.now(), notice: null };
    edits.forEach(({ track, liked, wasLiked }) => {
      list = withLikeApplied(list, track, liked, wasLiked);
    });
    playerStore.set({ likedTracks: list });
  })().finally(() => {
    likedLoad = null;
  });

  likedLoad = { promise, edits };
  return promise;
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
    // Only on the transition: this branch now runs on every poll while signed
    // out, and re-setting the same state would re-render for nothing.
    if (playerStore.get().status !== 'unauthenticated') {
      playerStore.set({ status: 'unauthenticated', track: null, isPlaying: false });
    }
    return;
  }

  if (spotify.grantedAt !== playerStore.get().grantedAt) {
    playerStore.set({ grantedAt: spotify.grantedAt });
  }

  if (result.offline) {
    // Deliberately does not touch `status`: whatever was on screen stays on
    // screen and goes visibly stale. Dropping to 'unauthenticated' here is
    // what used to put the Connect Spotify screen up over a working session,
    // and tapping it throws away a grant that was never bad.
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
      liked: null,
      error: null
    });
    return;
  }

  const data = result.data;
  const track = normalizeTrack(data.item);
  const respectOptimistic = Date.now() < optimisticUntil;

  const trackChanged = track.id !== lastTrackId;

  playerStore.set((state) => ({
    ...state,
    status: data.is_playing ? 'playing' : 'paused',
    track,
    liked: trackChanged ? likedFrom(track) : state.liked,
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
    checkLiked(track);
  } else if (now - lastQueueFetch > 30000) {
    // The queue changes without the track changing (user adds something).
    lastQueueFetch = now;
    refreshQueue();
  }

  // A like from the phone should reach the wall too.
  if (now - lastLikedCheck > 30000) checkLiked(track);

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

  async toggleLike() {
    const { track, liked } = playerStore.get();
    if (!track || track.type !== 'track' || !track.uri) return;
    const wasLiked = liked === true;
    const next = !wasLiked;
    apply(next, wasLiked);
    if (FLAGS.demo) return;

    const result = await (next ? spotify.saveToLibrary(track.uri) : spotify.removeFromLibrary(track.uri));
    if (!result.ok) apply(wasLiked, next);

    // Heart, cache and list move together — including on a revert that lands
    // after the song has changed, when only the heart is left alone.
    function apply(value, previous) {
      likeTaps.set(track.id, (likeTaps.get(track.id) || 0) + 1);
      likedCache.set(track.id, value);
      // Several taps during one load collapse to one edit measured from the
      // state before the first, so like-then-unlike nets to nothing.
      const first = likedLoad?.edits.get(track.id);
      likedLoad?.edits.set(track.id, { track, liked: value, wasLiked: first ? first.wasLiked : previous });
      playerStore.set((state) => ({
        ...state,
        liked: state.track?.id === track.id ? value : state.liked,
        likedTracks: withLikeApplied(state.likedTracks, track, value, previous)
      }));
    }
  },

  loadLikedTracks,

  /** Plays the liked list from the tapped song onwards. */
  async playLiked(index) {
    const state = playerStore.get();
    const uris = state.likedTracks.items.slice(index).map((t) => t.uri).filter(Boolean);
    if (!uris.length || FLAGS.demo) return;
    // With nothing active, Spotify answers 404; aim at a known device instead.
    const deviceId = state.device ? null : state.devices[0]?.id || null;
    const result = await spotify.playUris(uris, deviceId);
    if (!result.ok) {
      playerStore.set({
        likedTracks: {
          ...playerStore.get().likedTracks,
          notice: result.status === 404
            ? 'Open Spotify on a phone, speaker or computer first, then tap the song again.'
            : 'Spotify did not start that song. Try again in a moment.'
        }
      });
      return;
    }
    poller?.kick(500);
  },

  login() {
    spotify.initiateLogin();
  },

  refreshDevices
};

/**
 * The liked list with one song added to the top or taken out.
 *
 * `total` moves by what actually changed in the library, not by what changed
 * in the 50 loaded rows: unliking a song older than the first page still
 * makes the library one smaller, and re-liking a song that was already liked
 * doesn't make it bigger.
 */
function withLikeApplied(list, track, liked, wasLiked) {
  if (list.status !== 'ready') return list;
  const rest = list.items.filter((t) => t.id !== track.id);
  const items = liked ? [track, ...rest].slice(0, LIKED_PAGE) : rest;
  const delta = liked === wasLiked ? 0 : liked ? 1 : -1;
  return { ...list, items, total: Math.max(items.length, list.total + delta) };
}

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
    uri: 'spotify:track:demo-track',
    type: 'track',
    name: 'Midnight Cartography',
    artists: ['Halcyon Field'],
    album: 'Slow Transit',
    artUrl: demoArt(268),
    thumbUrl: demoArt(268),
    durationMs: 254000
  };

  const likedItems = [
    track,
    { id: 'l2', uri: 'spotify:track:l2', type: 'track', name: 'Paper Antenna', artists: ['Halcyon Field'], album: 'Slow Transit', thumbUrl: demoArt(320), durationMs: 241000 },
    { id: 'l3', uri: 'spotify:track:l3', type: 'track', name: 'Glasshouse', artists: ['Mira Vex'], album: 'Night Garden', thumbUrl: demoArt(12), durationMs: 199000 },
    { id: 'l4', uri: 'spotify:track:l4', type: 'track', name: 'Low Tide Radio', artists: ['Sable Room', 'Cassette Ghost'], album: 'Shoreline', thumbUrl: demoArt(205), durationMs: 233000 },
    { id: 'l5', uri: 'spotify:track:l5', type: 'track', name: 'Northbound', artists: ['Sable Room'], album: 'Shoreline', thumbUrl: demoArt(140), durationMs: 226000 }
  ];

  playerStore.set({
    status: 'playing',
    track,
    likedTracks: { status: 'ready', items: likedItems, total: 312, loadedAt: Date.now(), notice: null },
    progressMs: 74000,
    durationMs: track.durationMs,
    isPlaying: true,
    shuffle: true,
    repeat: 'context',
    volume: 62,
    liked: true,
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

  const session = await spotify.checkSession();
  playerStore.set({ grantedAt: spotify.grantedAt });
  if (session === 'unauthenticated') playerStore.set({ status: 'unauthenticated' });

  // The poller runs even while signed out. Every poll asks our own server for
  // a token, so a sign-in finished somewhere else — a laptop coming in over an
  // SSH tunnel — brings the music page up on the wall by itself, without
  // anyone touching the panel.
  //
  // Backoff is capped low here on purpose. A dead network should not cost a
  // minute of "offline" after it comes back — 30s is long enough to stop
  // hammering Spotify and short enough that the display self-heals before
  // anyone walks over to it.
  poller = createPoller(poll, {
    interval: CONFIG.dashboard.spotifyPollInterval,
    maxInterval: 30000
  });
  poller.start();
  startTicker();

  // ...and when the browser tells us the network is back, don't wait for the
  // backoff at all. This is the difference between recovering in a second and
  // recovering whenever the timer happens to come round.
  window.addEventListener('online', () => {
    playerStore.set({ error: null });
    poller.kick(0);
  });

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
