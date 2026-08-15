// ══════════════════════════════════════════════════════════════════════════
// Lyrics from LRCLIB (free, no key, CORS-open)
//
// The old build dropped `plainLyrics` into a <pre>-ish block. LRCLIB also
// returns LRC-timestamped lyrics for most tracks, which is what makes a
// wall display worth looking at, so synced lyrics are parsed and preferred.
// ══════════════════════════════════════════════════════════════════════════

import { playerStore } from './store.js';

const LRC_LINE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/** "[00:12.34] text" → [{ timeMs, text }] sorted by time. */
export function parseLrc(text) {
  const lines = [];

  text.split('\n').forEach((raw) => {
    LRC_LINE.lastIndex = 0;
    const stamps = [];
    let match;
    while ((match = LRC_LINE.exec(raw)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(match[3].padEnd(3, '0')) : 0;
      stamps.push(minutes * 60000 + seconds * 1000 + fraction);
    }
    if (!stamps.length) return;

    const content = raw.replace(LRC_LINE, '').trim();
    // Keep empty lines: they're the instrumental gaps, and dropping them makes
    // the highlight jump ahead of the music.
    stamps.forEach((timeMs) => lines.push({ timeMs, text: content }));
  });

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

let inflightController = null;

export async function loadLyrics(track) {
  if (!track) return;

  if (inflightController) inflightController.abort();
  inflightController = new AbortController();
  const { signal } = inflightController;

  playerStore.set((state) => ({
    ...state,
    lyrics: { state: 'loading', synced: null, plain: null, trackId: track.id }
  }));

  const params = new URLSearchParams({
    track_name: track.name,
    artist_name: track.artists[0] || '',
    album_name: track.album || '',
    duration: Math.round(track.durationMs / 1000)
  });

  try {
    let response = await fetch(`https://lrclib.net/api/get?${params}`, { signal });

    // The exact-match endpoint is strict about duration and album; fall back
    // to search, which is far more forgiving of metadata differences.
    if (!response.ok) {
      const searchParams = new URLSearchParams({
        track_name: track.name,
        artist_name: track.artists[0] || ''
      });
      const results = await fetch(`https://lrclib.net/api/search?${searchParams}`, { signal });
      if (!results.ok) throw new Error('Not found');
      const list = await results.json();
      if (!Array.isArray(list) || !list.length) throw new Error('Not found');

      // Prefer a hit that actually has timestamps and a similar duration.
      const target = Math.round(track.durationMs / 1000);
      const best =
        list
          .filter((item) => item.syncedLyrics)
          .sort(
            (a, b) => Math.abs(a.duration - target) - Math.abs(b.duration - target)
          )[0] || list[0];
      response = { ok: true, json: async () => best };
    }

    const data = await response.json();
    const synced = data.syncedLyrics ? parseLrc(data.syncedLyrics) : null;
    const plain = data.plainLyrics || null;

    if (!synced?.length && !plain) throw new Error('Empty');

    playerStore.set((state) => ({
      ...state,
      lyrics: {
        state: 'ready',
        synced: synced?.length ? synced : null,
        plain,
        trackId: track.id
      }
    }));
  } catch (err) {
    if (err.name === 'AbortError') return;
    playerStore.set((state) => ({
      ...state,
      lyrics: { state: 'missing', synced: null, plain: null, trackId: track.id }
    }));
  }
}

/** Index of the line that should be highlighted at `positionMs`. */
export function activeLineIndex(lines, positionMs) {
  if (!lines || !lines.length) return -1;
  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].timeMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
