/**
 * Browser configuration — copy to `config.js` and edit.
 *
 * This file IS served to the browser, so it holds no secrets. The Spotify
 * client ID is public by design (PKCE flow). Anything sensitive — Proxmox
 * tokens and the like — belongs in server.config.js instead.
 */
window.CONFIG = {
  spotify: {
    // Spotify Developer Dashboard -> your app -> Client ID
    clientId: 'YOUR_SPOTIFY_CLIENT_ID',
    // Must match the redirect URI registered on the Spotify app exactly,
    // trailing slash included.
    redirectUri: 'http://127.0.0.1:8080/',
    scopes: 'user-read-currently-playing user-read-playback-state user-modify-playback-state'
  },

  // Weather location. `label` is what the dashboard displays.
  location: {
    label: 'Santo Domingo, DR',
    latitude: 18.4861,
    longitude: -69.9312,
    timezone: 'auto'
  },

  weather: {
    temperatureUnit: 'fahrenheit', // 'celsius' or 'fahrenheit'
    windSpeedUnit: 'mph',          // 'kmh', 'ms', 'mph', or 'kn'
    refreshInterval: 600000
  },

  dashboard: {
    // Page order, left to right. Drop any you don't want.
    views: ['overview', 'now-playing', 'infra'],
    // Which part of the panel still registers touch. Every control the UI
    // draws is kept inside this band; the rest of the screen stays display
    // only. 'full' | 'top' | 'bottom' | 'left' | 'right'.
    // Add ?touchzone=1 to the URL to see the boundary drawn on screen.
    touchZone: 'bottom',

    // The page the display settles on.
    defaultView: 'now-playing',
    // Return to that page after this long without a touch. 0 disables.
    returnToDefaultAfterMs: 180000,

    spotifyPollInterval: 5000,
    infraPollInterval: 10000,

    // Hide the mouse pointer (set false when developing on a desktop).
    kiosk: true,
    // Nudge the UI a few pixels every 90s to protect an always-on panel.
    burnInProtection: true,

    // Dim the screen overnight. Wraps past midnight.
    night: {
      enabled: true,
      startHour: 23,
      endHour: 7,
      brightness: 0.55
    }
  }
};
