// ══════════════════════════════════════════════════════════════════════════
// Spotify Web API client
//
// Sign-in still starts here (PKCE: no client secret), but the grant itself is
// held by the dashboard's own server — see server/spotify-auth.js for why.
// This client only ever holds a short-lived access token, in memory.
// ══════════════════════════════════════════════════════════════════════════

const API = 'https://api.spotify.com/v1';
const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';

const VERIFIER_KEY = 'spotify_code_verifier';

// Where earlier builds kept the grant. Read once, handed to the server, then
// cleared — see _handOverLegacyGrant.
const LEGACY_KEY = {
  token: 'spotify_access_token',
  refresh: 'spotify_refresh_token',
  refreshBackup: 'spotify_refresh_token_prev',
  expiry: 'spotify_token_expiry',
  scopes: 'spotify_scopes'
};

function scopeSet(scopes) {
  return new Set(String(scopes || '').trim().split(/\s+/).filter(Boolean));
}

/**
 * True only when the grant is missing something the app now needs. Removing a
 * scope from config.js leaves a grant that can still do everything asked of
 * it, so that must not cost a sign-in.
 */
function grantIsInsufficient(grantedScopes, requiredScopes) {
  const granted = scopeSet(grantedScopes);
  return [...scopeSet(requiredScopes)].some((scope) => !granted.has(scope));
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

export class SpotifyClient {
  constructor(config) {
    this.clientId = config.clientId;
    this.redirectUri = config.redirectUri;
    this.scopes = config.scopes;

    this._access = null; // { token, expiresAt }
    this._pending = null;

    // When the grant was made, so the display can warn before Spotify's
    // six-month limit signs it out. null when unknown.
    this.grantedAt = null;

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
    const verifier = this._randomString(64);
    localStorage.setItem(VERIFIER_KEY, verifier);

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

  /** Hands the code from Spotify's redirect to the server, which keeps the grant. */
  async handleCallback() {
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) return false;

    const verifier = localStorage.getItem(VERIFIER_KEY);
    // Strip ?code= either way: a reload must not replay a spent code.
    window.history.replaceState({}, document.title, window.location.pathname);
    if (!verifier) {
      console.error('Spotify callback without a verifier — was sign-in started on another address?');
      return false;
    }

    try {
      const result = await postJson('/api/spotify/session', {
        code,
        verifier,
        redirectUri: this.redirectUri,
        clientId: this.clientId
      });
      localStorage.removeItem(VERIFIER_KEY);
      if (!result.ok) throw new Error(result.error || result.reason);

      // A fresh sign-in supersedes anything an older build left behind.
      Object.values(LEGACY_KEY).forEach((key) => localStorage.removeItem(key));
      this._accept(result);
      return true;
    } catch (err) {
      console.error('Spotify callback failed:', err);
      return false;
    }
  }

  /**
   * Earlier builds kept the grant in this browser. Hand it to the server once
   * so upgrading doesn't cost a sign-in, then forget it. Kept when the server
   * couldn't reach Spotify, so the next load can try again.
   */
  async _handOverLegacyGrant() {
    const refreshTokens = [
      localStorage.getItem(LEGACY_KEY.refresh),
      localStorage.getItem(LEGACY_KEY.refreshBackup)
    ].filter(Boolean);
    if (!refreshTokens.length) return;

    let result;
    try {
      result = await postJson('/api/spotify/adopt', {
        refreshTokens,
        clientId: this.clientId,
        scopes: localStorage.getItem(LEGACY_KEY.scopes) || ''
      });
    } catch (err) {
      console.warn('Could not hand the Spotify grant to the server yet:', err.message);
      return;
    }
    if (result.reason === 'transient') return;
    Object.values(LEGACY_KEY).forEach((key) => localStorage.removeItem(key));
  }

  _accept(view) {
    this._access = { token: view.accessToken, expiresAt: view.expiresAt };
    this.grantedAt = view.grantedAt ?? null;
  }

  /**
   * Resolves { token } or { reason: 'unauthenticated' | 'transient' }. The
   * distinction matters: a network blip must not put the sign-in screen up.
   *
   * `stale` is a token Spotify just rejected; the server refreshes only if it
   * still holds that one.
   */
  async _ensureToken({ stale = null } = {}) {
    if (!stale && this._access && Date.now() < this._access.expiresAt - 60000) {
      return { token: this._access.token };
    }
    // One request to our server at a time; concurrent callers share it.
    if (this._pending) return this._pending;
    this._pending = this._fetchToken(stale).finally(() => {
      this._pending = null;
    });
    return this._pending;
  }

  async _fetchToken(stale) {
    let view;
    try {
      const query = stale ? `?stale=${encodeURIComponent(stale)}` : '';
      const response = await fetch(`/api/spotify/token${query}`, { cache: 'no-store' });
      view = await response.json();
    } catch (err) {
      return { reason: 'transient' };
    }

    if (!view.ok) {
      this._access = null;
      return { reason: view.reason === 'transient' ? 'transient' : 'unauthenticated' };
    }

    // A grant for another app, or one missing a scope this build needs, can't
    // do the job. Show sign-in — but leave the server's grant alone: signing
    // in replaces it, and until then it hurts nothing.
    if (view.clientId !== this.clientId) {
      console.warn('The stored Spotify grant belongs to a different client id; sign-in needed.');
      return { reason: 'unauthenticated' };
    }
    if (grantIsInsufficient(view.scopes, this.scopes)) {
      console.warn('The stored Spotify grant is missing a required scope; sign-in needed.');
      return { reason: 'unauthenticated' };
    }

    this._accept(view);
    return { token: view.accessToken };
  }

  async getToken() {
    const { token } = await this._ensureToken();
    return token || null;
  }

  /** Resolves 'ok' | 'unauthenticated' | 'transient'. Runs the legacy handover first. */
  async checkSession() {
    await this._handOverLegacyGrant();
    const { token, reason } = await this._ensureToken();
    return token ? 'ok' : reason;
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
      const again = await this._ensureToken({ stale: token });
      if (again.token) return this._call(path, { method, retry: false });
      if (again.reason === 'transient') return { ok: false, offline: true, error: 'token refresh failed' };
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
