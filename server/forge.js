'use strict';

// ══════════════════════════════════════════════════════════════════════════
// The Forge collector
//
// The Forge is a separate self-hosted app. It exposes `GET /api/dashboard`,
// a read-only roll-up computed by its own engine — level, rank, attributes,
// streaks, this week's boss, trophy counts and today's agenda, with each
// quest carrying the check id needed to tick it off.
//
// Deliberately, none of the game's rules live here. This file fetches, caches
// and forwards. If the display ever starts computing a level of its own, the
// wall panel and the real app will disagree, and the wall panel will be the
// one nobody trusts.
//
// The sync token is a full-access credential for The Forge, which is why it
// lives in server.config.js and is used from Node — it never reaches the
// browser.
// ══════════════════════════════════════════════════════════════════════════

const { request } = require('./http-client');

let cache = { at: 0, snapshot: null };
let inFlight = null;

function forgeConfig(config) {
  const forge = config.forge || {};
  if (!forge.enabled) return null;
  if (!forge.url || !forge.token) return null;
  return {
    url: String(forge.url).replace(/\/+$/, ''),
    token: forge.token,
    verifyTls: forge.verifyTls !== false,
    timeout: forge.timeout || 6000
  };
}

/** An Error carrying a machine-readable reason alongside its message. */
function fail(reason, message) {
  const err = new Error(message);
  err.reason = reason;
  return err;
}

function authHeaders(forge) {
  return {
    Authorization: `Bearer ${forge.token}`,
    'Content-Type': 'application/json'
  };
}

/**
 * The current summary, cached for `cacheTtlMs`. Concurrent callers share one
 * request rather than each opening their own — the display polls this on a
 * timer and a swipe can land mid-poll.
 */
async function getForge(config, { force = false } = {}) {
  const forge = forgeConfig(config);
  if (!forge) return { configured: false, updatedAt: Date.now() };

  const ttl = config.forge.cacheTtlMs != null ? config.forge.cacheTtlMs : 5000;
  if (!force && cache.snapshot && Date.now() - cache.at < ttl) return cache.snapshot;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await request(`${forge.url}/api/dashboard`, {
        headers: authHeaders(forge),
        verifyTls: forge.verifyTls,
        timeout: forge.timeout
      });

      // These two are worth telling apart by hand, because they are the two
      // things that actually go wrong when someone first wires this up and
      // "HTTP 404" tells them nothing about which. The reason travels to the
      // browser as a code so the views can react without matching on prose.
      if (res.status === 404) {
        throw fail('outdated', 'This Forge has no /api/dashboard — it predates the endpoint. Deploy a newer build.');
      }
      if (res.status === 401 || res.status === 403) {
        throw fail('auth', 'The Forge rejected the sync token.');
      }
      if (res.status < 200 || res.status >= 300) {
        throw fail('unreachable', `The Forge answered HTTP ${res.status}`);
      }

      const summary = JSON.parse(res.body);
      const snapshot = { configured: true, updatedAt: Date.now(), summary };
      cache = { at: Date.now(), snapshot };
      return snapshot;
    } catch (err) {
      // Keep serving the last good summary rather than blanking the page: a
      // panel that shows this morning's quests is more use than one that
      // shows an error because a reverse proxy hiccuped.
      const snapshot = {
        configured: true,
        updatedAt: Date.now(),
        error: err.message,
        reason: err.reason || 'unreachable',
        summary: cache.snapshot ? cache.snapshot.summary : null,
        stale: !!cache.snapshot
      };
      return snapshot;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Tick a quest off (or back on). `weekKey` and `checkId` both come straight
 * from a summary the display was already showing, so nothing here has to know
 * how an id is built.
 *
 * The write is a PATCH, which merges: ticking a quest on the wall cannot
 * discard something completed in the browser since this snapshot was taken.
 */
async function setCheck(config, { weekKey, checkId, done }) {
  const forge = forgeConfig(config);
  if (!forge) throw new Error('The Forge is not configured.');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekKey || ''))) {
    throw new Error('Invalid week key.');
  }
  // Check ids are opaque to us, but they still have a shape — refusing
  // anything else keeps this endpoint from being a general write proxy into
  // The Forge's settings.
  if (!/^[a-z0-9-]{1,120}$/.test(String(checkId || ''))) {
    throw new Error('Invalid check id.');
  }

  const res = await request(`${forge.url}/api/week/${weekKey}`, {
    method: 'PATCH',
    headers: authHeaders(forge),
    body: JSON.stringify({ checks: { [checkId]: !!done } }),
    verifyTls: forge.verifyTls,
    timeout: forge.timeout
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`The Forge rejected the write (HTTP ${res.status})`);
  }

  // The summary just changed, so the next poll must not serve the old one.
  cache = { at: 0, snapshot: null };
  return { ok: true };
}

module.exports = { getForge, setCheck };
