// ══════════════════════════════════════════════════════════════════════════
// Spotify Web API client (PKCE — no client secret, no backend)
// ══════════════════════════════════════════════════════════════════════════

const API = 'https://api.spotify.com/v1';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';

const KEY = {
  token: 'spotify_access_token',
  refresh: 'spotify_refresh_token',
  refreshBackup: 'spotify_refresh_token_prev',
  verifier: 'spotify_code_verifier',
  expiry: 'spotify_token_expiry',
  scopes: 'spotify_scopes'
};

/**
 * Scopes are compared as an unordered set: reordering or respacing the string
 * in config.js used to read as a changed grant and sign the display out.
 */
function normalizeScopes(scopes) {
  return String(scopes || '').trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

export class SpotifyClient {
  constructor(config) {
    this.clientId = config.clientId;
    this.redirectUri = config.redirectUri;
    this.scopes = config.scopes;

    this._refreshing = null;

    // Set when Spotify rate-limits us; every call short-circuits until it passes.
    this._retryAfter = 0;
  }

  // ── PKCE ────────────────────────────────────────────────────────────────

  _randomString(length) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values, (byte) => alphabet[byte % alphabet.length]).join('');
  }

  async _challenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async initiateLogin() {
    this.logout(false);

    const verifier = this._randomString(64);
    localStorage.setItem(KEY.verifier, verifier);

    const url = new URL(AUTH_ENDPOINT);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: this.scopes,
      code_challenge_method: 'S256',
      code_challenge: await this._challenge(verifier),
      redirect_uri: this.redirectUri
    }).toString();

    window.location.href = url.toString();
  }

  async handleCallback() {
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) return false;

    const verifier = localStorage.getItem(KEY.verifier);
    if (!verifier) return false;

    try {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirectUri,
          client_id: this.clientId,
          code_verifier: verifier
        })
      });

      if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);

      this._saveTokens(await response.json());
      localStorage.setItem(KEY.scopes, normalizeScopes(this.scopes));
      localStorage.removeItem(KEY.verifier);
      window.history.replaceState({}, document.title, window.location.pathname);
      return true;
    } catch (err) {
      console.error('Spotify callback failed:', err);
      return false;
    }
  }

  _saveTokens(data) {
    const previous = localStorage.getItem(KEY.refresh);
    localStorage.setItem(KEY.token, data.access_token);
    if (data.refresh_token && data.refresh_token !== previous) {
      // Keep the generation we're replacing. Spotify hands back a new refresh
      // token on most exchanges without always retiring the old one, so when a
      // refresh goes wrong we can't tell from here which generation is live.
      if (previous) localStorage.setItem(KEY.refreshBackup, previous);
      localStorage.setItem(KEY.refresh, data.refresh_token);
    }
    localStorage.setItem(KEY.expiry, String(Date.now() + data.expires_in * 1000));
  }

  logout(reload = true) {
    Object.values(KEY).forEach((key) => localStorage.removeItem(key));
    if (reload) window.location.reload();
  }

  /**
   * Exchanges one refresh token.
   * Resolves 'ok' | 'invalid' (that grant is dead) | 'transient' (try later).
   */
  async _exchangeRefresh(refreshToken) {
    let response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId
        })
      });
    } catch (err) {
      console.warn('Token refresh failed:', err.message);
      return 'transient';
    }

    if (response.ok) {
      const data = await response.json();
      if (!data.refresh_token) data.refresh_token = refreshToken;
      this._saveTokens(data);
      return 'ok';
    }

    // Only invalid_grant means the grant itself is gone. Spotify also answers
    // 400 for malformed or misconfigured requests, and those must not wipe a
    // working token on a display nobody is standing in front of.
    if (response.status === 400) {
      const body = await response.text().catch(() => '');
      if (body.includes('invalid_grant')) return 'invalid';
      console.warn('Token refresh rejected:', body || response.status);
    }
    return 'transient';
  }

  async _runRefresh() {
    const current = localStorage.getItem(KEY.refresh);
    const backup = localStorage.getItem(KEY.refreshBackup);
    if (!current && !backup) return 'revoked';

    if (current) {
      const outcome = await this._exchangeRefresh(current);
      if (outcome === 'ok') return 'ok';
      if (outcome === 'transient') return 'transient';
    }

    // The stored token was rejected outright. If a rotation's response was
    // lost in flight — the display slept, Wi-Fi dropped mid-request — the
    // live grant may be the generation on either side of that write, so try
    // the other one before giving up and making someone sign in again.
    if (backup && backup !== current) {
      const outcome = await this._exchangeRefresh(backup);
      if (outcome === 'ok') return 'ok';
      if (outcome === 'transient') return 'transient';
    }

    this.logout(false);
    return 'revoked';
  }

  _refresh() {
    // Concurrent 401s used to each kick off their own refresh, racing to
    // overwrite the token. All callers now await the same promise.
    if (this._refreshing) return this._refreshing;

    this._refreshing = this._runRefresh().finally(() => {
      this._refreshing = null;
    });
    return this._refreshing;
  }

  /**
   * Resolves { token } or { reason: 'unauthenticated' | 'transient' }. The
   * distinction matters: a network blip must not put the sign-in screen up,
   * because tapping it throws away a token that was never actually bad.
   */
  async _ensureToken() {
    const token = localStorage.getItem(KEY.token);
    const expiry = Number(localStorage.getItem(KEY.expiry) || 0);
    const hasGrant =
      localStorage.getItem(KEY.refresh) || localStorage.getItem(KEY.refreshBackup);

    if (!token && !hasGrant) return { reason: 'unauthenticated' };
    if (token && Date.now() < expiry - 60000) return { token };

    const outcome = await this._refresh();
    if (outcome === 'ok') return { token: localStorage.getItem(KEY.token) };
    return { reason: outcome === 'revoked' ? 'unauthenticated' : 'transient' };
  }

  async getToken() {
    const { token } = await this._ensureToken();
    return token || null;
  }

  isAuthenticated() {
    const hasToken = Boolean(
      localStorage.getItem(KEY.refresh) || localStorage.getItem(KEY.refreshBackup)
    );
    if (!hasToken) return false;

    // A scope change means the stored grant can't do what the app now needs.
    if (normalizeScopes(localStorage.getItem(KEY.scopes)) !== normalizeScopes(this.scopes)) {
      this.logout(false);
      return false;
    }
    return true;
  }

  // ── Request plumbing ────────────────────────────────────────────────────

  async _call(path, { method = 'GET', retry = true } = {}) {
    if (Date.now() < this._retryAfter) return { ok: false, rateLimited: true };

    const auth = await this._ensureToken();
    if (!auth.token) {
      if (auth.reason === 'transient') return { ok: false, offline: true, error: 'token refresh failed' };
      return { ok: false, unauthenticated: true };
    }
    const token = auth.token;

    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      return { ok: false, offline: true, error: err.message };
    }

    if (response.status === 429) {
      const wait = Number(response.headers.get('Retry-After') || 3);
      this._retryAfter = Date.now() + wait * 1000;
      return { ok: false, rateLimited: true };
    }

    if (response.status === 401 && retry) {
      const outcome = await this._refresh();
      if (outcome === 'ok') return this._call(path, { method, retry: false });
      if (outcome === 'transient') return { ok: false, offline: true, error: 'token refresh failed' };
      return { ok: false, unauthenticated: true };
    }

    if (response.status === 204) return { ok: true, empty: true, data: null };
    if (!response.ok) return { ok: false, status: response.status };

    // Some endpoints answer 200 with an empty body.
    const text = await response.text();
    if (!text) return { ok: true, empty: true, data: null };

    try {
      return { ok: true, data: JSON.parse(text) };
    } catch (err) {
      return { ok: true, empty: true, data: null };
    }
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  /**
   * `/me/player` rather than `/me/player/currently-playing`: one request that
   * also carries device, volume, shuffle and repeat state.
   */
  getPlaybackState() {
    return this._call('/me/player?additional_types=track,episode');
  }

  getQueue() {
    return this._call('/me/player/queue');
  }

  getDevices() {
    return this._call('/me/player/devices');
  }

  // ── Writes ──────────────────────────────────────────────────────────────

  play() { return this._call('/me/player/play', { method: 'PUT' }); }
  pause() { return this._call('/me/player/pause', { method: 'PUT' }); }
  next() { return this._call('/me/player/next', { method: 'POST' }); }
  previous() { return this._call('/me/player/previous', { method: 'POST' }); }
  seek(ms) { return this._call(`/me/player/seek?position_ms=${Math.round(ms)}`, { method: 'PUT' }); }
  setVolume(percent) {
    return this._call(`/me/player/volume?volume_percent=${Math.round(percent)}`, { method: 'PUT' });
  }
  setShuffle(state) { return this._call(`/me/player/shuffle?state=${state}`, { method: 'PUT' }); }
  setRepeat(state) { return this._call(`/me/player/repeat?state=${state}`, { method: 'PUT' }); }
  transfer(deviceId) {
    // The REST transfer endpoint takes a body; _call is GET/PUT-without-body,
    // so this one talks to fetch directly.
    return this.getToken().then((token) => {
      if (!token) return { ok: false };
      return fetch(`${API}/me/player`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_ids: [deviceId], play: true })
      })
        .then((response) => ({ ok: response.ok || response.status === 204 }))
        .catch(() => ({ ok: false }));
    });
  }
}
