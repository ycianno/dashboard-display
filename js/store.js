// ══════════════════════════════════════════════════════════════════════════
// Minimal observable stores
//
// Each source feeds more than one view, so they publish here instead of the
// views reaching for each other.
// ══════════════════════════════════════════════════════════════════════════

function createStore(initial) {
  let state = initial;
  const listeners = new Set();

  return {
    get() {
      return state;
    },
    set(patch) {
      state = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
      listeners.forEach((fn) => {
        try {
          fn(state);
        } catch (err) {
          console.error('Store listener failed:', err);
        }
      });
    },
    subscribe(fn, { immediate = true } = {}) {
      listeners.add(fn);
      if (immediate) fn(state);
      return () => listeners.delete(fn);
    }
  };
}

export const playerStore = createStore({
  status: 'loading', // loading | unauthenticated | idle | playing | paused | error
  track: null, // { id, name, artists, album, artUrl, durationMs }
  progressMs: 0,
  durationMs: 0,
  isPlaying: false,
  shuffle: false,
  repeat: 'off',
  volume: null,
  device: null,
  devices: [],
  queue: [],
  lyrics: { state: 'idle', synced: null, plain: null, trackId: null },
  // When the Spotify grant was made (ms), or null if unknown. Spotify ends
  // every grant six months on; main.js warns as that approaches.
  grantedAt: null,
  error: null
});

export const weatherStore = createStore({
  status: 'loading', // loading | ready | error
  place: '',
  current: null,
  hourly: [],
  daily: [],
  updatedAt: 0
});

export const infraStore = createStore({
  status: 'loading', // loading | ready | unconfigured | error
  snapshot: null,
  error: null,
  updatedAt: 0
});

export const forgeStore = createStore({
  status: 'loading', // loading | ready | unconfigured | error
  summary: null,
  // Check ids with a write in flight. The view keeps showing its optimistic
  // state for these instead of flickering back on the next poll.
  pending: new Set(),
  stale: false,
  error: null,
  // 'outdated' | 'auth' | 'unreachable' — set by the server so the views can
  // say which of the three went wrong without parsing the message.
  reason: null,
  updatedAt: 0
});
