// ══════════════════════════════════════════════════════════════════════════
// Small shared helpers
// ══════════════════════════════════════════════════════════════════════════

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Track and artist names come straight from the Spotify API and land in
 * innerHTML when rendering lists. Escape everything that isn't ours.
 */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** ms -> "3:07" */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** seconds -> "44d 17h" / "6h 12m" / "18m" */
export function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes, decimals = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value.toFixed(exp === 0 ? 0 : decimals)} ${BYTE_UNITS[exp]}`;
}

export function pct(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function levelFor(value, warn, crit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  if (value >= crit) return 'crit';
  if (value >= warn) return 'warn';
  return 'ok';
}

/**
 * Builds the `d` attributes for a sparkline drawn in a 100x100 viewBox with
 * `preserveAspectRatio="none"`, so the SVG stretches to whatever box it lands
 * in without any measurement.
 */
export function sparkPaths(values, { max = null } = {}) {
  const data = (values || []).filter((v) => Number.isFinite(v));
  if (data.length < 2) return { line: '', area: '' };

  const hi = max ?? Math.max(...data, 1);
  const lo = 0;
  const span = hi - lo || 1;
  const stepX = 100 / (data.length - 1);

  const points = data.map((value, i) => {
    const x = i * stepX;
    const y = 100 - ((value - lo) / span) * 100;
    return `${x.toFixed(2)},${clamp(y, 0, 100).toFixed(2)}`;
  });

  return {
    line: `M${points.join('L')}`,
    area: `M0,100L${points.join('L')}L100,100Z`
  };
}

/** Ignores overlapping calls — used so a slow poll can't queue up behind itself. */
export function singleFlight(fn) {
  let running = null;
  return (...args) => {
    if (running) return running;
    running = Promise.resolve(fn(...args)).finally(() => {
      running = null;
    });
    return running;
  };
}

/**
 * setInterval with exponential backoff on failure, so a dead Proxmox box
 * doesn't get hammered every 10 seconds forever.
 */
export function createPoller(fn, { interval, maxInterval = interval * 12 } = {}) {
  let timer = null;
  let delay = interval;
  let stopped = false;
  let inFlight = false;

  const run = async () => {
    if (stopped) return;
    // A kick() landing mid-request used to start a second overlapping poll —
    // which is exactly what an `online` event does, since it fires while the
    // failing request from the outage is often still hanging.
    if (inFlight) return;

    inFlight = true;
    try {
      await fn();
      delay = interval;
    } catch (err) {
      delay = Math.min(delay * 2, maxInterval);
      console.warn('Poll failed, backing off to', delay, 'ms', err);
    } finally {
      inFlight = false;
    }
    if (!stopped) timer = setTimeout(run, delay);
  };

  return {
    start() {
      stopped = false;
      run();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    /** Fire immediately — used right after a control press. */
    kick(afterMs = 400) {
      clearTimeout(timer);
      timer = setTimeout(run, afterMs);
    }
  };
}

export function icon(name, className = 'ic') {
  return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}
