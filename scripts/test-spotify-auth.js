#!/usr/bin/env node
'use strict';

/*
 * Exercises server/spotify-auth.js against a fake Spotify token endpoint.
 *
 * The grant is the one piece of this project that, when it breaks, costs a
 * walk to the wall with a keyboard. These cases are the ways it used to break:
 * rotation, a refresh racing another, a network blip mistaken for a dead
 * grant, a restart losing the newest token.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createSpotifyAuth } = require('../server/spotify-auth');

const quiet = { log() {}, warn() {} };

// ── Fake Spotify ─────────────────────────────────────────────────────────
// Rotates refresh tokens on every use and retires the old one, the way PKCE
// grants behave now.
function fakeSpotify() {
  const state = {
    live: new Set(),
    generation: 0,
    refreshCalls: 0,
    failNext: null, // 'network' | 500 | null
    delayMs: 0
  };

  const issue = (scope) => {
    state.generation += 1;
    const refresh = `refresh-${state.generation}`;
    state.live.add(refresh);
    return {
      access_token: `access-${state.generation}`,
      refresh_token: refresh,
      expires_in: 3600,
      scope
    };
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = new URLSearchParams(raw);
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));

      if (state.failNext === 'network') {
        state.failNext = null;
        req.socket.destroy();
        return;
      }
      if (state.failNext === 500) {
        state.failNext = null;
        res.writeHead(500);
        res.end('boom');
        return;
      }

      const send = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (body.get('grant_type') === 'authorization_code') {
        if (body.get('code') !== 'good-code' || body.get('code_verifier') !== 'good-verifier') {
          return send(400, { error: 'invalid_grant' });
        }
        return send(200, issue('user-read-playback-state user-modify-playback-state'));
      }

      if (body.get('grant_type') === 'refresh_token') {
        state.refreshCalls += 1;
        const token = body.get('refresh_token');
        if (!state.live.has(token)) return send(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' });
        state.live.delete(token);
        return send(200, issue('user-read-playback-state user-modify-playback-state'));
      }

      send(400, { error: 'unsupported_grant_type' });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ state, server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-auth-test-'));
  return path.join(dir, 'state', 'spotify-session.json');
}

function expire(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.expiresAt = Date.now() - 1000;
  fs.writeFileSync(file, JSON.stringify(data));
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// ── Cases ────────────────────────────────────────────────────────────────

test('no grant: signed out, nothing written', async ({ url }) => {
  const file = tempFile();
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  assert.deepStrictEqual(await auth.getToken(), { ok: false, reason: 'unauthenticated' });
  assert.ok(!fs.existsSync(file));
});

test('sign-in stores the grant on disk, private to the owner', async ({ url }) => {
  const file = tempFile();
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  const view = await auth.startSession({ code: 'good-code', verifier: 'good-verifier', redirectUri: 'http://127.0.0.1:8080/', clientId: 'cid' });
  assert.strictEqual(view.ok, true);
  assert.ok(view.accessToken.startsWith('access-'));
  assert.ok(!('refreshToken' in view), 'the refresh token must never leave the server');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(saved.refreshToken && saved.grantedAt);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('a bad code is refused and leaves no grant', async ({ url }) => {
  const file = tempFile();
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  const view = await auth.startSession({ code: 'nope', verifier: 'good-verifier', redirectUri: 'x', clientId: 'cid' });
  assert.strictEqual(view.ok, false);
  assert.strictEqual(view.reason, 'rejected');
  assert.strictEqual(auth.hasSession(), false);
});

test('rotation: the newest refresh token is saved and survives a restart', async ({ url, state }) => {
  const file = tempFile();
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  await auth.startSession({ code: 'good-code', verifier: 'good-verifier', redirectUri: 'x', clientId: 'cid' });
  expire(file);

  // A "restart": a new instance reads the file the old one wrote.
  const restarted = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  const view = await restarted.getToken();
  assert.strictEqual(view.ok, true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(state.live.has(saved.refreshToken), 'the saved token must be the live one');

  expire(file);
  const again = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  assert.strictEqual((await again.getToken()).ok, true, 'a second restart still works');
});

test('ten concurrent requests on an expired token cost one refresh', async ({ url, state }) => {
  const file = tempFile();
  const auth0 = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  await auth0.startSession({ code: 'good-code', verifier: 'good-verifier', redirectUri: 'x', clientId: 'cid' });
  expire(file);
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });

  state.refreshCalls = 0;
  state.delayMs = 50;
  const views = await Promise.all(Array.from({ length: 10 }, () => auth.getToken()));
  state.delayMs = 0;
  assert.ok(views.every((v) => v.ok), 'every caller gets a token');
  assert.strictEqual(new Set(views.map((v) => v.accessToken)).size, 1);
  assert.strictEqual(state.refreshCalls, 1);
});

test('a 401 forces one refresh; a token already replaced does not', async ({ url, state }) => {
  const file = tempFile();
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  const first = await auth.startSession({ code: 'good-code', verifier: 'good-verifier', redirectUri: 'x', clientId: 'cid' });

  state.refreshCalls = 0;
  const [a, b] = await Promise.all([
    auth.getToken({ stale: first.accessToken }),
    auth.getToken({ stale: first.accessToken })
  ]);
  assert.strictEqual(state.refreshCalls, 1, 'two windows reporting the same 401 cost one refresh');
  assert.strictEqual(a.accessToken, b.accessToken);
  assert.notStrictEqual(a.accessToken, first.accessToken);

  const c = await auth.getToken({ stale: 'some-older-token' });
  assert.strictEqual(state.refreshCalls, 1);
  assert.strictEqual(c.accessToken, a.accessToken);
});

test('network failure and 5xx keep the grant', async ({ url, state }) => {
  const file = tempFile();
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  await auth.startSession({ code: 'good-code', verifier: 'good-verifier', redirectUri: 'x', clientId: 'cid' });

  for (const failure of ['network', 500]) {
    expire(file);
    const fresh = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
    state.failNext = failure;
    assert.deepStrictEqual(await fresh.getToken(), { ok: false, reason: 'transient' }, `after ${failure}`);
    assert.ok(fs.existsSync(file), `grant kept after ${failure}`);
    assert.strictEqual((await fresh.getToken()).ok, true, `recovers after ${failure}`);
  }
});

test('invalid_grant retires the grant and keeps the file for diagnosis', async ({ url, state }) => {
  const file = tempFile();
  const auth0 = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  await auth0.startSession({ code: 'good-code', verifier: 'good-verifier', redirectUri: 'x', clientId: 'cid' });
  state.live.clear(); // revoked on Spotify's side
  expire(file);
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  assert.deepStrictEqual(await auth.getToken(), { ok: false, reason: 'unauthenticated' });
  assert.ok(!fs.existsSync(file));
  assert.ok(fs.existsSync(file.replace(/\.json$/, '.revoked.json')));
});

test('handover from the browser: tries the backup when the current one is dead', async ({ url, state }) => {
  const file = tempFile();
  // Two live-looking tokens from the browser; only the backup is live.
  state.live.add('browser-backup');
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  const view = await auth.adopt({ refreshTokens: ['browser-dead', 'browser-backup'], clientId: 'cid', scopes: 'a b' });
  assert.strictEqual(view.ok, true);
  assert.strictEqual(view.adopted, true);
  assert.strictEqual(view.grantedAt, null, 'unknown sign-in date is not invented');

  const second = await auth.adopt({ refreshTokens: ['anything'], clientId: 'cid' });
  assert.deepStrictEqual(second, { ok: true, adopted: false }, 'an existing grant is never replaced by a handover');
});

test('handover of only dead tokens says so; a blip says try later', async ({ url, state }) => {
  const auth = createSpotifyAuth({ file: tempFile(), accountsUrl: url, log: quiet });
  assert.deepStrictEqual(await auth.adopt({ refreshTokens: ['dead'], clientId: 'cid' }), { ok: false, reason: 'unauthenticated' });
  state.live.add('alive');
  state.failNext = 500;
  assert.deepStrictEqual(await auth.adopt({ refreshTokens: ['alive'], clientId: 'cid' }), { ok: false, reason: 'transient' });
});

test('an unwritable disk keeps the rotated grant in memory', async ({ url, state }) => {
  const file = tempFile();
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  const first = await auth.startSession({ code: 'good-code', verifier: 'good-verifier', redirectUri: 'x', clientId: 'cid' });
  // Make the state directory a file's worth of trouble: replace it with a file.
  fs.rmSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.dirname(file), 'not a directory');

  const view = await auth.getToken({ stale: first.accessToken });
  assert.strictEqual(view.ok, true, 'refresh still succeeds');
  const again = await auth.getToken({ stale: view.accessToken });
  assert.strictEqual(again.ok, true, 'and the in-memory token is the live one');
  assert.ok(state.live.size >= 1);
});

test('a corrupt file reads as signed out instead of crashing', async ({ url }) => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{not json');
  const auth = createSpotifyAuth({ file, accountsUrl: url, log: quiet });
  assert.deepStrictEqual(await auth.getToken(), { ok: false, reason: 'unauthenticated' });
});

// ── Runner ───────────────────────────────────────────────────────────────

(async () => {
  let failed = 0;
  for (const { name, fn } of cases) {
    const fake = await fakeSpotify();
    try {
      await fn(fake);
      console.log(`  ok    ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAIL  ${name}\n        ${err.stack.split('\n').slice(0, 3).join('\n        ')}`);
    } finally {
      fake.server.close();
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
})();
