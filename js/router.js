// ══════════════════════════════════════════════════════════════════════════
// Paged view router with touch/pointer swiping
//
// The deck is a flex row of full-width pages translated on the X axis. Drags
// are axis-locked on first movement so vertical scrolling inside a panel
// (queue, lyrics, guest list) still belongs to the browser.
// ══════════════════════════════════════════════════════════════════════════

import { clamp, icon } from './util.js';

const SWIPE_DISTANCE_RATIO = 0.14; // fraction of the page that commits a turn
const SWIPE_VELOCITY = 0.4; // px/ms — a flick commits regardless of distance
const AXIS_LOCK_PX = 10;

export function createRouter({ deck, track, pager, views, initialId, onChange }) {
  let index = Math.max(0, views.findIndex((v) => v.id === initialId));
  let width = deck.clientWidth;

  let dragging = false;
  let axis = null; // null | 'x' | 'y'
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let delta = 0;
  let pointerId = null;

  // ── Pager dots ──────────────────────────────────────────────────────────
  pager.innerHTML = views
    .map(
      (view, i) => `
        <button class="pager-dot pressable" role="tab" data-index="${i}"
                aria-selected="${i === index}" aria-label="${view.label}">
          ${icon(view.icon)}
          <span class="label">${view.label}</span>
        </button>`
    )
    .join('');

  pager.addEventListener('click', (event) => {
    const dot = event.target.closest('.pager-dot');
    if (dot) go(Number(dot.dataset.index));
  });

  // ── Positioning ─────────────────────────────────────────────────────────

  // While the deck is moving, the pages behind the glass cards are moving
  // too, so every backdrop-filter has to re-blur a fresh backdrop on every
  // frame — nothing can be cached. On the Surface's integrated GPU that is
  // the whole cost of a page turn. `moving` lets the stylesheet drop the
  // blur for the duration; see css/shell.css.
  let settleTimer = null;

  function setMoving(value) {
    clearTimeout(settleTimer);
    deck.classList.toggle('moving', value);
  }

  function paint(animate) {
    track.classList.toggle('animate', animate);
    track.style.transform = `translate3d(${-index * width + delta}px, 0, 0)`;

    if (animate) {
      // transitionend is not guaranteed to fire — an interrupted or
      // zero-length transition swallows it — so the timer is the authority
      // and the event only ever arrives early.
      setMoving(true);
      settleTimer = setTimeout(() => deck.classList.remove('moving'), 460);
    }
  }

  track.addEventListener('transitionend', (event) => {
    if (event.target === track && event.propertyName === 'transform') setMoving(false);
  });

  // Only the page you're on and the ones you could reach with the next drag
  // need to be rendered. The rest keep their box but skip layout and paint.
  function markNeighbours() {
    Array.from(track.children).forEach((node, i) => {
      node.classList.toggle('far', Math.abs(i - index) > 1);
    });
  }

  function syncPager() {
    Array.from(pager.children).forEach((dot, i) => {
      dot.setAttribute('aria-selected', String(i === index));
    });
  }

  function go(next, { animate = true } = {}) {
    const target = clamp(next, 0, views.length - 1);
    const changed = target !== index;
    index = target;
    delta = 0;
    markNeighbours();
    paint(animate);
    syncPager();
    if (changed && onChange) onChange(views[index], index);
    return changed;
  }

  // ── Pointer handling ────────────────────────────────────────────────────
  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target.closest('[data-noswipe]')) return;

    dragging = true;
    axis = null;
    setMoving(true);
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startTime = performance.now();
    delta = 0;
    width = deck.clientWidth;
  }

  function onPointerMove(event) {
    if (!dragging || event.pointerId !== pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (axis === null) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'x') {
        // Take ownership so the page under the finger stops receiving clicks.
        deck.setPointerCapture(pointerId);
      } else {
        // This gesture belongs to the browser now. `dragging` goes false here,
        // which means the pointerup that follows returns at its own guard
        // without ever reaching setMoving — so the deck has to be let go of
        // right here, or the blur stays suspended until the next page turn.
        dragging = false;
        setMoving(false);
        return;
      }
    }

    // Rubber-band at the ends instead of hard-stopping.
    const atStart = index === 0 && dx > 0;
    const atEnd = index === views.length - 1 && dx < 0;
    delta = atStart || atEnd ? dx * 0.32 : dx;
    paint(false);
  }

  function onPointerUp(event) {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;

    if (axis !== 'x') {
      delta = 0;
      setMoving(false);
      return;
    }

    if (deck.hasPointerCapture(pointerId)) deck.releasePointerCapture(pointerId);

    const elapsed = Math.max(performance.now() - startTime, 1);
    const velocity = delta / elapsed;
    const committed =
      Math.abs(delta) > width * SWIPE_DISTANCE_RATIO || Math.abs(velocity) > SWIPE_VELOCITY;

    const direction = delta < 0 ? 1 : -1;
    delta = 0;
    go(committed ? index + direction : index);
  }

  deck.addEventListener('pointerdown', onPointerDown);
  deck.addEventListener('pointermove', onPointerMove);
  deck.addEventListener('pointerup', onPointerUp);
  deck.addEventListener('pointercancel', onPointerUp);

  // A committed horizontal swipe shouldn't also fire the button under the
  // finger where it lifted.
  deck.addEventListener(
    'click',
    (event) => {
      if (axis === 'x') {
        event.stopPropagation();
        event.preventDefault();
        axis = null;
      }
    },
    true
  );

  window.addEventListener('resize', () => {
    width = deck.clientWidth;
    paint(false);
  });

  markNeighbours();
  paint(false);
  syncPager();

  return {
    go,
    next: () => go(index + 1),
    prev: () => go(index - 1),
    get index() {
      return index;
    },
    get current() {
      return views[index];
    },
    goToId: (id, opts) => {
      const target = views.findIndex((v) => v.id === id);
      if (target >= 0) go(target, opts);
    }
  };
}

/**
 * Returns the display to its default page after a period without touches, so
 * whoever walked away leaves it on music rather than on a guest list.
 */
export function createIdleReturn({ afterMs, onIdle }) {
  if (!afterMs) return { poke() {}, stop() {} };

  let timer = null;

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(onIdle, afterMs);
  };

  ['pointerdown', 'keydown', 'wheel'].forEach((type) => {
    window.addEventListener(type, arm, { passive: true });
  });

  arm();

  return {
    poke: arm,
    stop: () => clearTimeout(timer)
  };
}
