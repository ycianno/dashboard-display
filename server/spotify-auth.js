'use strict';

// ══════════════════════════════════════════════════════════════════════════
// Spotify sign-in, held by the server
//
// Spotify's PKCE refresh tokens are single-use: every refresh hands back a
// new one and retires the old. The browser used to keep that chain in
// localStorage, which loses it whenever the newest link doesn't reach disk —
// Edge force-closed by a deploy or a Windows update, or two dashboard windows
// refreshing at once (the loser got invalid_grant and wiped the winner's
// fresh token). Each of those meant carrying a keyboard to the wall.
//
// So the chain lives here instead: one process, one refresher, one file
// written atomically. Any browser on this machine — the kiosk, or a laptop
// coming in through `ssh -L 8080:127.0.0.1:8080` — asks this module for a
// short-lived access token and never sees the refresh token.
// ══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { request } = require('./http-client');

const DEFAULT_ACCOUNTS_URL = 'https://accounts.spotify.com';

// Refresh this long before the access token actually runs out, so a request
// never sets off with a token that dies in flight.
const EARLY_REFRESH_MS = 60 * 1000;

function scopeList(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

function createSpotifyAuth({ file, accountsUrl = DEFAULT_ACCOUNTS_URL, log = console } = {}) {
  if (!file) throw new Error('createSpotifyAuth needs a file path');

  let session = load();

  // Every operation that can change the session runs through this chain, so a
  // refresh, a new sign-in and a handover from the browser can never
  // interleave — that interleaving is what used to throw a good token away.
  let queue = Promise.resolve();
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  function load() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && data.refreshToken && data.clientId) return data;
      log.warn(`Ignoring ${file}: it holds no usable Spotify grant.`);
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn(`Could not read ${file}: ${err.message}`);
    }
    return null;
  }

  /**
   * Write to a temporary file, flush it to disk, then rename it over the real
   * one. A rename is atomic, so a crash or a killed process leaves either the
   * old grant or the new one on disk — never half of one, and never nothing.
   */
  function save(next) {
    // Memory first. Spotify has already retired the previous refresh token,
    // so if the disk write fails this process must still hold the new one —
    // it keeps working, and the next successful write catches the file up.
    session = next;
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const fd = fs.openSync(temp, 'w', 0o600);
      try {
        fs.writeSync(fd, JSON.stringify(next, null, 2));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, file);
    } catch (err) {
      // Not rethrown: the grant in memory is good, and an exception here would
      // reach the browser as a failed token request — read as "signed out".
      log.warn(`Could not write ${file}, holding the Spotify grant in memory: ${err.message}`);
      try {
        fs.rmSync(temp, { force: true });
      } catch (cleanupErr) {
        // nothing more to do
      }
    }
  }

  /** The grant is dead. Keep the file for diagnosis, but stop using it. */
  function retire(why) {
    log.warn(`Spotify grant retired: ${why}`);
    try {
      fs.renameSync(file, file.replace(/\.json$/, '') + '.revoked.json');
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn(`Could not move ${file} aside: ${err.message}`);
    }
    session = null;
  }

  // ── Talking to Spotify ──────────────────────────────────────────────────

  /**
   * One call to the token endpoint.
   * Resolves { outcome: 'ok', data } | { outcome: 'invalid', detail } |
   * { outcome: 'transient', detail }.
   */
  async function tokenRequest(params) {
    let response;
    try {
      response = await request(`${accountsUrl}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        timeout: 10000
      });
    } catch (err) {
      return { outcome: 'transient', detail: err.message };
    }

    if (response.status >= 200 && response.status < 300) {
      try {
        const data = JSON.parse(response.body);
        if (data.access_token) return { outcome: 'ok', data };
      } catch (err) {
        // fall through: a 200 we can't read is not a grant we can use
      }
      return { outcome: 'transient', detail: 'unreadable token response' };
    }

    // Only invalid_grant means the grant itself is gone. Spotify also answers
    // 400 for malformed or misconfigured requests, and those must not throw
    // away a working grant on a display nobody is standing in front of.
    if (response.status === 400 && /invalid_grant/.test(response.body || '')) {
      return { outcome: 'invalid', detail: response.body };
    }
    return { outcome: 'transient', detail: `HTTP ${response.status} ${response.body || ''}`.trim() };
  }

  function sessionFrom(data, base) {
    return {
      clientId: base.clientId,
      // Spotify may or may not rotate; when it doesn't, the old token stays live.
      refreshToken: data.refresh_token || base.refreshToken,
      accessToken: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      // What Spotify says was granted beats what the client asked for.
      scopes: scopeList(data.scope || base.scopes),
      // Spotify now ends every grant six months after sign-in, and refreshing
      // does not reset that clock. Keeping the date lets the display warn
      // ahead of time instead of just going dark one morning.
      grantedAt: base.grantedAt ?? null,
      updatedAt: Date.now()
    };
  }

  // Resolves 'ok' | 'invalid' | 'transient'. Callers hold the queue.
  async function refreshLocked() {
    if (!session) return 'invalid';
    const current = session;
    const result = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: current.clientId
    });

    if (result.outcome === 'ok') {
      save(sessionFrom(result.data, current));
      return 'ok';
    }
    if (result.outcome === 'invalid') {
      retire(result.detail);
      return 'invalid';
    }
    log.warn(`Spotify token refresh failed, will retry: ${result.detail}`);
    return 'transient';
  }

  function publicView() {
    return {
      ok: true,
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      scopes: session.scopes,
      clientId: session.clientId,
      grantedAt: session.grantedAt
    };
  }

  function fresh() {
    return Boolean(session && session.accessToken && Date.now() < session.expiresAt - EARLY_REFRESH_MS);
  }

  // ── Public operations ───────────────────────────────────────────────────

  /**
   * An access token, refreshed if it needs to be.
   *
   * `stale` is the token a browser just had rejected with a 401. It forces a
   * refresh only if it is still the token we hold — if another caller has
   * already replaced it, the new one is simply handed back, so five windows
   * hitting a 401 together cost one refresh, not five.
   */
  function getToken({ stale = null } = {}) {
    return serial(async () => {
      if (!session) return { ok: false, reason: 'unauthenticated' };

      const rejected = stale && stale === session.accessToken;
      if (fresh() && !rejected) return publicView();

      const outcome = await refreshLocked();
      if (outcome === 'ok') return publicView();
      if (outcome === 'invalid') return { ok: false, reason: 'unauthenticated' };
      return { ok: false, reason: 'transient' };
    });
  }

  /** Finishes a sign-in: the browser hands over the code from the redirect. */
  function startSession({ code, verifier, redirectUri, clientId } = {}) {
    return serial(async () => {
      if (!code || !verifier || !redirectUri || !clientId) {
        return { ok: false, reason: 'bad-request', error: 'code, verifier, redirectUri and clientId are required' };
      }

      const result = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier
      });

      if (result.outcome !== 'ok') {
        log.warn(`Spotify sign-in failed: ${result.detail}`);
        return { ok: false, reason: result.outcome === 'invalid' ? 'rejected' : 'transient', error: result.detail };
      }
      if (!result.data.refresh_token) {
        return { ok: false, reason: 'rejected', error: 'Spotify returned no refresh token' };
      }

      // A new sign-in replaces whatever was here, including a grant that was
      // still alive: the person standing there asked for this account.
      save(sessionFrom(result.data, { clientId, grantedAt: Date.now() }));
      log.log('Spotify signed in; the grant is held by the server now.');
      return publicView();
    });
  }

  /**
   * One-time handover from a browser that still holds a grant in
   * localStorage from before the server kept it. Tries each token in order —
   * the browser kept the generation it replaced as a backup, and after a lost
   * write either one could be the live link.
   */
  function adopt({ refreshTokens = [], clientId, scopes } = {}) {
    return serial(async () => {
      // Already holding a grant: the browser's copy is redundant. Not an
      // error — the browser should just drop it.
      if (session) return { ok: true, adopted: false };

      const candidates = [...new Set(refreshTokens.filter((t) => typeof t === 'string' && t))];
      if (!clientId || !candidates.length) {
        return { ok: false, reason: 'bad-request', error: 'clientId and at least one refresh token are required' };
      }

      let sawTransient = false;
      for (const refreshToken of candidates) {
        const result = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId
        });
        if (result.outcome === 'ok') {
          save(sessionFrom(result.data, { clientId, refreshToken, scopes, grantedAt: null }));
          log.log('Spotify grant adopted from the browser.');
          return { ...publicView(), adopted: true };
        }
        if (result.outcome === 'transient') sawTransient = true;
      }

      // Every candidate was refused outright: the browser's copy is dead too.
      // A transient failure on any of them means try again later instead.
      return { ok: false, reason: sawTransient ? 'transient' : 'unauthenticated' };
    });
  }

  return {
    getToken,
    startSession,
    adopt,
    /** For logs and tests — never sent to a browser. */
    hasSession: () => Boolean(session)
  };
}

module.exports = { createSpotifyAuth, scopeList };
