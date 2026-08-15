'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Minimal promise-based HTTP(S) client.
 *
 * Written against node:http rather than global fetch because homelab gear
 * (Proxmox especially) ships self-signed certificates, and per-request
 * `rejectUnauthorized` control is far simpler here than wiring an undici
 * dispatcher.
 */
function request(urlStr, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeout = 6000,
    verifyTls = true
  } = options;

  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (err) {
      reject(new Error(`Invalid URL: ${urlStr}`));
      return;
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        rejectUnauthorized: isHttps ? verifyTls : undefined,
        timeout
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          // Guard against a misbehaving endpoint streaming forever.
          if (bytes > 8 * 1024 * 1024) {
            req.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error(`Timed out after ${timeout}ms`)));
    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

async function requestJson(urlStr, options = {}) {
  const res = await request(urlStr, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) }
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}`);
  }

  try {
    return JSON.parse(res.body);
  } catch (err) {
    throw new Error('Response was not valid JSON');
  }
}

module.exports = { request, requestJson };
