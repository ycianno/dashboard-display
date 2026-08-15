// ══════════════════════════════════════════════════════════════════════════
// Now Playing view
// ══════════════════════════════════════════════════════════════════════════

import { $, esc, formatDuration, clamp, icon } from '../util.js';
import { playerStore } from '../store.js';
import { actions } from '../player.js';
import { activeLineIndex } from '../lyrics.js';
import { extractPalette, applyPalette } from '../palette.js';
import { createVisualizer } from '../visualizer.js';

export function initNowPlaying({ onToggleImmersive }) {
  const el = {
    stage: $('#np-stage'),
    unauth: $('#np-unauth'),
    idle: $('#np-idle'),
    player: $('#np-player'),
    loginBtn: $('#btn-login'),

    artFrame: $('#art-frame'),
    art: $('#album-art'),
    backdropArt: $('#backdrop-art'),

    title: $('#track-title'),
    artist: $('#track-artist'),
    album: $('#track-album'),
    lyricCue: $('#lyric-cue'),

    progressHit: $('#progress-hit'),
    progressFill: $('#progress-fill'),
    timeNow: $('#time-now'),
    timeTotal: $('#time-total'),

    btnShuffle: $('#btn-shuffle'),
    btnPrev: $('#btn-prev'),
    btnPlay: $('#btn-play'),
    btnNext: $('#btn-next'),
    btnRepeat: $('#btn-repeat'),
    playIcon: $('#play-icon'),

    volHit: $('#vol-hit'),
    volFill: $('#vol-fill'),
    volIcon: $('#vol-icon'),
    deviceBtn: $('#btn-device'),
    deviceName: $('#device-name'),

    tabs: Array.from(document.querySelectorAll('.panel-tab')),
    queue: $('#pane-queue'),
    lyrics: $('#pane-lyrics'),
    devices: $('#pane-devices')
  };

  const visualizer = createVisualizer($('#viz'));

  // Cached signatures so we only rebuild DOM when the underlying data really
  // changed — this runs at 4 Hz.
  // null rather than '' — an empty queue and an empty device list both hash to
  // '', so seeding with '' skipped the very first render and left the panel blank.
  let lastArtUrl = null;
  let lastQueueKey = null;
  let lastLyricsKey = null;
  let lastDevicesKey = null;
  let lastLyricIndex = -1;
  let lastStatus = null;
  let seeking = false;
  let seekPreview = 0;

  // ── Album art → palette ─────────────────────────────────────────────────
  el.art.addEventListener('load', () => {
    const palette = extractPalette(el.art);
    applyPalette(palette);
    visualizer.setAccent(palette.accent, palette.soft);
  });

  // ── Transport ───────────────────────────────────────────────────────────
  el.loginBtn.addEventListener('click', () => actions.login());
  el.btnPlay.addEventListener('click', () => actions.toggle());
  el.btnNext.addEventListener('click', () => actions.next());
  el.btnPrev.addEventListener('click', () => actions.previous());
  el.btnShuffle.addEventListener('click', () => actions.toggleShuffle());
  el.btnRepeat.addEventListener('click', () => actions.cycleRepeat());
  el.artFrame.addEventListener('click', () => onToggleImmersive());

  // ── Scrub bar ───────────────────────────────────────────────────────────
  function ratioFromEvent(event, node) {
    const rect = node.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / rect.width, 0, 1);
  }

  el.progressHit.addEventListener('pointerdown', (event) => {
    const { durationMs } = playerStore.get();
    if (!durationMs) return;
    seeking = true;
    el.progressFill.classList.add('seeking');
    el.progressHit.setPointerCapture(event.pointerId);
    seekPreview = ratioFromEvent(event, el.progressHit) * durationMs;
    paintProgress(seekPreview, durationMs);
  });

  el.progressHit.addEventListener('pointermove', (event) => {
    if (!seeking) return;
    const { durationMs } = playerStore.get();
    seekPreview = ratioFromEvent(event, el.progressHit) * durationMs;
    paintProgress(seekPreview, durationMs);
  });

  const endSeek = (event) => {
    if (!seeking) return;
    seeking = false;
    el.progressFill.classList.remove('seeking');
    if (el.progressHit.hasPointerCapture(event.pointerId)) {
      el.progressHit.releasePointerCapture(event.pointerId);
    }
    actions.seek(seekPreview);
  };

  el.progressHit.addEventListener('pointerup', endSeek);
  el.progressHit.addEventListener('pointercancel', endSeek);

  // ── Volume ──────────────────────────────────────────────────────────────
  let adjustingVolume = false;

  const applyVolumeFromEvent = (event) => {
    const percent = ratioFromEvent(event, el.volHit) * 100;
    el.volFill.style.width = `${percent}%`;
    return percent;
  };

  el.volHit.addEventListener('pointerdown', (event) => {
    adjustingVolume = true;
    el.volHit.setPointerCapture(event.pointerId);
    applyVolumeFromEvent(event);
  });

  el.volHit.addEventListener('pointermove', (event) => {
    if (adjustingVolume) applyVolumeFromEvent(event);
  });

  const endVolume = (event) => {
    if (!adjustingVolume) return;
    adjustingVolume = false;
    if (el.volHit.hasPointerCapture(event.pointerId)) {
      el.volHit.releasePointerCapture(event.pointerId);
    }
    actions.setVolume(applyVolumeFromEvent(event));
  };

  el.volHit.addEventListener('pointerup', endVolume);
  el.volHit.addEventListener('pointercancel', endVolume);

  // ── Panel tabs ──────────────────────────────────────────────────────────
  el.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      el.tabs.forEach((other) => other.setAttribute('aria-selected', String(other === tab)));
      document.querySelectorAll('.panel-pane').forEach((pane) => {
        pane.classList.toggle('active', pane.id === `pane-${tab.dataset.pane}`);
      });
      if (tab.dataset.pane === 'devices') actions.refreshDevices();
      if (tab.dataset.pane === 'lyrics') lastLyricIndex = -1; // force a re-scroll
    });
  });

  el.deviceBtn.addEventListener('click', () => {
    const devicesTab = el.tabs.find((tab) => tab.dataset.pane === 'devices');
    if (devicesTab) devicesTab.click();
  });

  el.devices.addEventListener('click', (event) => {
    const row = event.target.closest('.device-row');
    if (row && row.dataset.id) actions.transferTo(row.dataset.id);
  });

  // ── Painting ────────────────────────────────────────────────────────────
  function paintProgress(progressMs, durationMs) {
    const ratio = durationMs ? clamp(progressMs / durationMs, 0, 1) : 0;
    el.progressFill.style.width = `${ratio * 100}%`;
    el.timeNow.textContent = formatDuration(progressMs);
  }

  function renderQueue(state) {
    const key = state.queue.map((t) => t.id).join('|') + (state.track?.id || '');
    if (key === lastQueueKey) return;
    lastQueueKey = key;

    if (!state.track) {
      el.queue.innerHTML = placeholder('queue', 'Nothing queued', 'Start playing on Spotify to see what is coming up.');
      return;
    }

    // The currently playing track is shown as row zero, then the queue proper.
    // The old build labelled queue[0] as "now playing", which was always the
    // *next* track.
    const rows = [
      row(state.track, { now: true, playing: state.isPlaying }),
      ...state.queue.map((track, i) => row(track, { index: i + 1 }))
    ];

    el.queue.innerHTML = `<div class="queue scroll">${rows.join('')}</div>`;
  }

  function row(track, { now = false, playing = false, index = 0 } = {}) {
    const art = track.thumbUrl || track.artUrl;
    return `
      <div class="queue-row ${now ? 'now' : ''}">
        ${
          now
            ? `<span class="queue-idx"><span class="eq ${playing ? '' : 'paused'}"><i></i><i></i><i></i></span></span>`
            : `<span class="queue-idx">${index}</span>`
        }
        ${art ? `<img src="${esc(art)}" alt="">` : ''}
        <div class="queue-meta">
          <span class="t truncate">${esc(track.name)}</span>
          <span class="a truncate">${esc(track.artists.join(', '))}</span>
        </div>
        <span class="queue-dur tnum">${formatDuration(track.durationMs)}</span>
      </div>`;
  }

  function renderLyrics(state) {
    const { lyrics } = state;
    const key = `${lyrics.trackId}:${lyrics.state}:${lyrics.synced ? 'synced' : 'plain'}`;
    if (key === lastLyricsKey) return;
    lastLyricsKey = key;
    lastLyricIndex = -1;

    if (lyrics.state === 'loading') {
      el.lyrics.innerHTML = `
        <div class="lyrics scroll">
          ${Array.from({ length: 7 }, (_, i) => `<div class="skeleton" style="height:1.4rem;margin:0.7rem 0;width:${60 + ((i * 13) % 35)}%"></div>`).join('')}
        </div>`;
      return;
    }

    if (lyrics.state === 'idle') {
      el.lyrics.innerHTML = placeholder('lyrics', 'Lyrics', 'They appear here once a track is playing.');
      return;
    }

    if (lyrics.state === 'missing' || (!lyrics.synced && !lyrics.plain)) {
      el.lyrics.innerHTML = placeholder('lyrics', 'No lyrics found', 'LRCLIB has nothing for this track yet.');
      return;
    }

    if (lyrics.synced) {
      el.lyrics.innerHTML = `<div class="lyrics scroll" id="lyrics-scroll">${lyrics.synced
        .map(
          (line, i) =>
            `<div class="lyrics-line" data-i="${i}">${line.text ? esc(line.text) : '&nbsp;'}</div>`
        )
        .join('')}</div>`;
    } else {
      el.lyrics.innerHTML = `<div class="lyrics plain scroll" id="lyrics-scroll">${lyrics.plain
        .split('\n')
        .map((line) => `<div class="lyrics-line">${line ? esc(line) : '&nbsp;'}</div>`)
        .join('')}</div>`;
    }
  }

  function syncLyrics(state) {
    const { lyrics, progressMs } = state;
    if (!lyrics.synced) {
      el.lyricCue.classList.remove('visible');
      return;
    }

    const index = activeLineIndex(lyrics.synced, progressMs);
    if (index === lastLyricIndex) return;
    lastLyricIndex = index;

    const container = document.getElementById('lyrics-scroll');
    if (container) {
      container.querySelectorAll('.lyrics-line').forEach((node, i) => {
        node.classList.toggle('current', i === index);
        node.classList.toggle('past', i < index);
      });

      const active = container.querySelector('.lyrics-line.current');
      if (active) {
        // Centre the active line without scrolling the page itself.
        container.scrollTo({
          top: active.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2,
          behavior: 'smooth'
        });
      }
    }

    const text = index >= 0 ? lyrics.synced[index].text : '';
    el.lyricCue.textContent = text;
    el.lyricCue.classList.toggle('visible', Boolean(text));
  }

  function renderDevices(state) {
    const key = state.devices.map((d) => `${d.id}:${d.active}`).join('|');
    if (key === lastDevicesKey) return;
    lastDevicesKey = key;

    if (!state.devices.length) {
      el.devices.innerHTML = placeholder(
        'speaker',
        'No devices',
        'Open Spotify on a phone, speaker or computer and it will appear here.'
      );
      return;
    }

    el.devices.innerHTML = `<div class="device-list scroll">${state.devices
      .map(
        (device) => `
        <button class="device-row pressable ${device.active ? 'active' : ''}" data-id="${esc(device.id)}">
          ${icon(deviceIcon(device.type))}
          <span class="device-meta">
            <span class="t truncate">${esc(device.name)}</span>
            <span class="a truncate">${esc(device.type)}${device.active ? ' · Playing here' : ''}</span>
          </span>
          ${device.active ? '<span class="dot ok"></span>' : ''}
        </button>`
      )
      .join('')}</div>`;
  }

  function deviceIcon(type) {
    const key = String(type || '').toLowerCase();
    if (key.includes('phone')) return 'phone';
    if (key.includes('computer')) return 'laptop';
    if (key.includes('tv') || key.includes('cast')) return 'tv';
    return 'speaker';
  }

  function placeholder(iconName, title, body) {
    return `
      <div class="placeholder">
        ${icon(iconName)}
        <h3>${esc(title)}</h3>
        <p>${esc(body)}</p>
      </div>`;
  }

  // ── Store subscription ──────────────────────────────────────────────────
  playerStore.subscribe((state) => {
    // Top-level state switching
    if (state.status !== lastStatus) {
      lastStatus = state.status;
      const showPlayer = state.status === 'playing' || state.status === 'paused';
      el.unauth.hidden = state.status !== 'unauthenticated';
      el.idle.hidden = state.status !== 'idle' && state.status !== 'loading';
      el.player.hidden = !showPlayer;
      visualizer.setRunning(showPlayer);
    }

    // The side panel renders in every state — bailing out here left it blank
    // whenever nothing was playing.
    if (!state.track) {
      el.backdropArt.classList.remove('visible');
      lastArtUrl = null;
      renderQueue(state);
      renderLyrics(state);
      renderDevices(state);
      return;
    }

    // Artwork
    if (state.track.artUrl && state.track.artUrl !== lastArtUrl) {
      lastArtUrl = state.track.artUrl;
      el.art.src = state.track.artUrl;
      el.backdropArt.style.backgroundImage = `url("${state.track.artUrl}")`;
      el.backdropArt.classList.add('visible');
    }

    // Metadata
    if (el.title.textContent !== state.track.name) el.title.textContent = state.track.name;
    const artistLine = state.track.artists.join(', ');
    if (el.artist.textContent !== artistLine) el.artist.textContent = artistLine;
    if (el.album.textContent !== state.track.album) el.album.textContent = state.track.album;

    // Progress
    if (!seeking) paintProgress(state.progressMs, state.durationMs);
    const total = formatDuration(state.durationMs);
    if (el.timeTotal.textContent !== total) el.timeTotal.textContent = total;

    // Transport state
    el.playIcon.setAttribute('href', state.isPlaying ? '#i-pause' : '#i-play');
    el.btnShuffle.classList.toggle('on', state.shuffle);
    el.btnRepeat.classList.toggle('on', state.repeat !== 'off');
    el.btnRepeat.querySelector('use').setAttribute(
      'href',
      state.repeat === 'track' ? '#i-repeat-one' : '#i-repeat'
    );

    visualizer.setPlaying(state.isPlaying);

    // Volume + device
    if (state.volume !== null && !adjustingVolume) {
      el.volFill.style.width = `${state.volume}%`;
      el.volIcon.setAttribute(
        'href',
        state.volume === 0 ? '#i-volume-off' : state.volume < 50 ? '#i-volume-low' : '#i-volume'
      );
    }
    const deviceLabel = state.device ? state.device.name : 'No device';
    if (el.deviceName.textContent !== deviceLabel) el.deviceName.textContent = deviceLabel;

    renderQueue(state);
    renderLyrics(state);
    syncLyrics(state);
    renderDevices(state);
  });

  return { visualizer };
}
