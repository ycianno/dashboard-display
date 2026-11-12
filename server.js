'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { getSnapshot } = require('./server/infra');
const { getForge, setCheck } = require('./server/forge');
const { buildDemoSnapshot } = require('./server/demo');

const ROOT = __dirname;

// server.config.js is optional — without it the dashboard still runs, and the
// Infrastructure view shows setup instructions instead of metrics.
let config = {};
try {
  config = require('./server.config.js');
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') {
    console.error('server.config.js failed to load:', err.message);
  } else {
    console.log('No server.config.js found — infrastructure monitoring disabled.');
    console.log('Copy server.config.example.js to server.config.js to enable it.');
  }
}

const PORT = config.port || 8080;
const HOST = config.host || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// Request bodies are small by design — every POST this server accepts is one
// object naming one thing to do. The cap is what stops a stuck client from
// growing a buffer here forever.
const MAX_BODY_BYTES = 8 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('Request body must be a JSON object.'));
          return;
        }
        resolve(parsed);
      } catch (err) {
        reject(new Error('Request body was not valid JSON.'));
      }
    });
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, uptime: process.uptime() });
    return true;
  }

  if (url.pathname === '/api/infra') {
    if (url.searchParams.get('demo') === '1') {
      sendJson(res, 200, buildDemoSnapshot());
      return true;
    }

    const anyEnabled =
      (config.proxmox && config.proxmox.enabled) ||
      (config.netdata && config.netdata.enabled && (config.netdata.hosts || []).length) ||
      (config.services && config.services.enabled && (config.services.checks || []).length);

    if (!anyEnabled) {
      sendJson(res, 200, {
        configured: false,
        updatedAt: Date.now(),
        proxmox: { enabled: false, nodes: [], guests: [], storage: [] },
        netdata: { enabled: false, hosts: [] },
        services: { enabled: false, checks: [] },
        summary: { alerts: [], level: 'unknown' }
      });
      return true;
    }

    try {
      const snapshot = await getSnapshot(config, {
        force: url.searchParams.get('force') === '1'
      });
      sendJson(res, 200, snapshot);
    } catch (err) {
      sendJson(res, 500, { configured: true, error: err.message, summary: { alerts: [], level: 'crit' } });
    }
    return true;
  }

  // ── The Forge ─────────────────────────────────────────────────────────
  if (url.pathname === '/api/forge') {
    const snapshot = await getForge(config, { force: url.searchParams.get('force') === '1' });
    sendJson(res, 200, snapshot);
    return true;
  }

  // Ticking a quest off from the wall. The week key and check id are echoed
  // back from a summary the display was already showing, so this endpoint
  // never has to know how The Forge builds an id.
  if (url.pathname === '/api/forge/check') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'POST only' });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      await setCheck(config, {
        weekKey: body.weekKey,
        checkId: body.checkId,
        done: body.done
      });
      // Hand back the freshly-recomputed summary so the view can settle on
      // real numbers instead of holding its optimistic guess until the next
      // poll comes round.
      sendJson(res, 200, await getForge(config, { force: true }));
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return true;
  }

  return false;
}

// What the browser is allowed to load, and nothing else. This used to be a
// list of things to refuse, compared case-sensitively — so on a
// case-insensitive disk (Windows, macOS) `/Server.Config.js` served the API
// tokens, and the Spotify grant in state/ would have gone the same way. Every
// other casing, 8.3 short name or trailing-dot spelling of a secret is just
// one more thing a refuse-list has to know about; an allowlist doesn't.
const PUBLIC_FILES = new Set(['index.html', 'config.js']);
const PUBLIC_DIRS = new Set(['css', 'js']);

function isPublic(relative) {
  const segments = relative.split(path.sep);
  // No dotfiles, and nothing Windows would quietly normalise ("js." → "js").
  if (segments.some((s) => !s || s.startsWith('.') || /[. ]$/.test(s))) return false;
  if (segments.length === 1) return PUBLIC_FILES.has(segments[0].toLowerCase());
  return PUBLIC_DIRS.has(segments[0].toLowerCase());
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(text);
}

function serveStatic(req, res, url) {
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch (err) {
    sendText(res, 400, 'Bad request');
    return;
  }
  // A NUL byte makes fs throw synchronously, which used to take the whole
  // server down from a single request.
  if (decoded.includes('\0')) {
    sendText(res, 400, 'Bad request');
    return;
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relative);

  // Refuse anything that resolves outside the project directory. The previous
  // version joined the raw request path, so `/../../etc/passwd` escaped root.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  if (!isPublic(path.relative(ROOT, filePath))) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      // The display reloads rarely and is edited often over SSH; no-cache keeps
      // a redeploy from serving stale assets behind a kiosk with no devtools.
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url)
      .then((handled) => {
        if (!handled) sendJson(res, 404, { error: 'Unknown endpoint' });
      })
      .catch((err) => sendJson(res, 500, { error: err.message }));
    return;
  }

  // Last line of defence: one malformed request must never stop the display.
  try {
    serveStatic(req, res, url);
  } catch (err) {
    console.error('Static request failed:', err.message);
    if (!res.headersSent) sendText(res, 500, 'Server error');
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard running at http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/`);
  const sources = [];
  if (config.proxmox && config.proxmox.enabled) sources.push('Proxmox');
  if (config.netdata && config.netdata.enabled) sources.push(`Netdata (${(config.netdata.hosts || []).length})`);
  if (config.services && config.services.enabled) sources.push(`Checks (${(config.services.checks || []).length})`);
  if (config.forge && config.forge.enabled) sources.push('The Forge');
  console.log(sources.length ? `Monitoring: ${sources.join(', ')}` : 'Monitoring: none configured');
});
