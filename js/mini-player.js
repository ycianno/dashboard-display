// ══════════════════════════════════════════════════════════════════════════
// Dock mini player — transport controls that follow you onto other pages
// ══════════════════════════════════════════════════════════════════════════

import { $, paintHeart } from './util.js';
import { playerStore } from './store.js';
import { actions } from './player.js';

export function initMiniPlayer({ onOpen }) {
  const el = {
    root: $('#mini-player'),
    art: $('#mini-art'),
    title: $('#mini-title'),
    artist: $('#mini-artist'),
    play: $('#mini-play'),
    playIcon: $('#mini-play-icon'),
    next: $('#mini-next')
  };

  let onMusicPage = false;
  let hasTrack = false;
  let lastArt = null;

  el.play.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.toggle();
  });

  const like = $('#mini-like');
  like.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.toggleLike();
  });

  el.next.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.next();
  });

  // Tapping the artwork or title jumps to the full Now Playing page.
  el.art.addEventListener('click', onOpen);
  $('#mini-meta').addEventListener('click', onOpen);

  function sync() {
    el.root.classList.toggle('visible', hasTrack && !onMusicPage);
  }

  playerStore.subscribe((state) => {
    hasTrack = Boolean(state.track);
    sync();
    if (!state.track) return;

    if (state.track.thumbUrl && state.track.thumbUrl !== lastArt) {
      lastArt = state.track.thumbUrl;
      el.art.src = state.track.thumbUrl;
    }
    el.art.classList.toggle('spinning', state.isPlaying);

    if (el.title.textContent !== state.track.name) el.title.textContent = state.track.name;
    const artists = state.track.artists.join(', ');
    if (el.artist.textContent !== artists) el.artist.textContent = artists;

    el.playIcon.setAttribute('href', state.isPlaying ? '#i-pause' : '#i-play');
    paintHeart(like, state);
  });

  return {
    setActiveView(viewId) {
      onMusicPage = viewId === 'now-playing';
      sync();
    }
  };
}
