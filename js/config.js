// ══════════════════════════════════════════════════════════════════════════
// Browser configuration
//
// config.js (git-ignored) is loaded as a classic script before the modules and
// sets `window.CONFIG`. Everything is merged over these defaults, so an older
// or partial config.js still boots.
// ══════════════════════════════════════════════════════════════════════════

// Scopes the code itself depends on. They are added to whatever config.js
// lists, because config.js lives only on the panel and is never deployed over:
// a feature that needs a new scope would otherwise ship to a display whose
// config can't grant it, and fail there quietly.
const REQUIRED_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  // The heart button and the Liked tab.
  'user-library-read',
  'user-library-modify'
];

const DEFAULTS = {
  spotify: {
    clientId: '',
    redirectUri: 'http://127.0.0.1:8080/',
    scopes: REQUIRED_SCOPES.join(' ')
  },

  location: {
    label: 'Santo Domingo, DR',
    latitude: 18.4861,
    longitude: -69.9312,
    timezone: 'auto'
  },

  weather: {
    temperatureUnit: 'fahrenheit',
    windSpeedUnit: 'mph',
    refreshInterval: 600000
  },

  dashboard: {
    // Which page the display sits on, and the page order left-to-right.
    views: ['overview', 'now-playing', 'infra'],
    defaultView: 'now-playing',

    // Which band of the panel still registers touch. Controls are laid out
    // inside it; the rest of the screen carries display-only content.
    // 'full' | 'top' | 'bottom' | 'left' | 'right'.
    touchZone: 'full',

    // Drift back to the default view after this long without a touch.
    // 0 disables it.
    returnToDefaultAfterMs: 180000,

    spotifyPollInterval: 5000,
    infraPollInterval: 10000,
    forgePollInterval: 30000,

    // Hides the mouse pointer. Turn off when developing on a desktop.
    kiosk: true,

    // Nudges the whole UI a few pixels on a slow cycle so static elements
    // never sit on the same pixels for hours.
    burnInProtection: true,

    night: {
      enabled: true,
      startHour: 23,
      endHour: 7,
      brightness: 0.55
    }
  }
};

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function merge(base, override) {
  const out = { ...base };
  Object.keys(override || {}).forEach((key) => {
    const value = override[key];
    if (value === undefined) return;
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
  });
  return out;
}

const raw = (typeof window !== 'undefined' && window.CONFIG) || {};

// The original config kept coordinates under `weather`. Lift them so an
// un-migrated config.js keeps pointing at the right place.
const legacyLocation = {};
if (raw.weather) {
  if (raw.weather.latitude !== undefined) legacyLocation.latitude = raw.weather.latitude;
  if (raw.weather.longitude !== undefined) legacyLocation.longitude = raw.weather.longitude;
  if (raw.weather.label !== undefined) legacyLocation.label = raw.weather.label;
}
if (raw.dashboard && raw.dashboard.weatherRefreshInterval !== undefined) {
  raw.weather = { ...(raw.weather || {}), refreshInterval: raw.dashboard.weatherRefreshInterval };
}

export const CONFIG = merge(DEFAULTS, {
  ...raw,
  location: merge(legacyLocation, raw.location || {})
});

CONFIG.spotify.scopes = [
  ...new Set([...String(CONFIG.spotify.scopes || '').split(/\s+/).filter(Boolean), ...REQUIRED_SCOPES])
].join(' ');

// Guard against the exact mismatch this dashboard used to ship with: a place
// name that disagrees with the coordinates being queried. If a config supplies
// its own coordinates but no label, fall back to showing the coordinates
// rather than inheriting the default label.
const labelProvided =
  raw.location?.label !== undefined || raw.weather?.label !== undefined;
const coordsProvided =
  CONFIG.location.latitude !== DEFAULTS.location.latitude ||
  CONFIG.location.longitude !== DEFAULTS.location.longitude;

if (coordsProvided && !labelProvided) {
  CONFIG.location.label = '';
}

// Query-string escape hatches, handy when debugging over SSH on the display:
//   ?demo=1     synthetic infra + Spotify data
//   ?kiosk=0    bring the mouse pointer back
//   ?view=infra open straight onto a page
//   ?touchzone=1 draw the touch-zone boundary over the UI
const params = new URLSearchParams(window.location.search);

const TOUCH_ZONES = new Set(['full', 'top', 'bottom', 'left', 'right']);
if (!TOUCH_ZONES.has(CONFIG.dashboard.touchZone)) {
  CONFIG.dashboard.touchZone = 'full';
}

export const FLAGS = {
  demo: params.get('demo') === '1',
  view: params.get('view'),
  kiosk: params.get('kiosk') === '0' ? false : CONFIG.dashboard.kiosk,
  showTouchZone: params.get('touchzone') === '1',
  touchZone: TOUCH_ZONES.has(params.get('touch')) ? params.get('touch') : CONFIG.dashboard.touchZone
};
