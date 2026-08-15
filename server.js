'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { getSnapshot } = require('./server/infra');
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

  return false;
}

function serveStatic(req, res, url) {
  const decoded = decodeURIComponent(url.pathname);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relative);

  // Refuse anything that resolves outside the project directory. The previous
  // version joined the raw request path, so `/../../etc/passwd` escaped root.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Never hand the browser the server-side config — it holds API tokens.
  if (path.basename(filePath) === 'server.config.js' || filePath.startsWith(path.join(ROOT, 'server') + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
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

  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard running at http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/`);
  const sources = [];
  if (config.proxmox && config.proxmox.enabled) sources.push('Proxmox');
  if (config.netdata && config.netdata.enabled) sources.push(`Netdata (${(config.netdata.hosts || []).length})`);
  if (config.services && config.services.enabled) sources.push(`Checks (${(config.services.checks || []).length})`);
  console.log(sources.length ? `Monitoring: ${sources.join(', ')}` : 'Monitoring: none configured');
});
