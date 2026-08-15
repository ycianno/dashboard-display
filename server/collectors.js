'use strict';

const { request, requestJson } = require('./http-client');

// ═══════════════════════════════════════════════════════════════════════════
// Proxmox VE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `/cluster/resources` returns nodes, guests and storage in a single call,
 * which is all the dashboard needs for the headline numbers. We then fan out
 * to `/nodes/{node}/status` for the per-node detail (load average, kernel,
 * CPU model) that the cluster endpoint omits.
 */
async function collectProxmox(cfg) {
  const base = String(cfg.host || '').replace(/\/+$/, '');
  const headers = {
    Authorization: `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`
  };
  const opts = { headers, verifyTls: cfg.verifyTls !== false, timeout: 6000 };
  const ignore = new Set((cfg.ignoreVmids || []).map(Number));

  const payload = await requestJson(`${base}/api2/json/cluster/resources`, opts);
  const resources = payload.data || [];

  const nodes = resources
    .filter((r) => r.type === 'node')
    .map((r) => ({
      id: r.id,
      name: r.node,
      status: r.status,
      cpu: r.cpu ?? 0,
      cores: r.maxcpu ?? 0,
      mem: r.mem ?? 0,
      maxmem: r.maxmem ?? 0,
      disk: r.disk ?? 0,
      maxdisk: r.maxdisk ?? 0,
      uptime: r.uptime ?? 0,
      loadavg: null,
      kernel: null,
      cpuModel: null,
      pveVersion: null,
      temperature: null
    }));

  const guests = resources
    .filter((r) => r.type === 'qemu' || r.type === 'lxc')
    .filter((r) => !ignore.has(Number(r.vmid)))
    .map((r) => ({
      id: r.id,
      vmid: r.vmid,
      name: r.name || `#${r.vmid}`,
      kind: r.type === 'qemu' ? 'vm' : 'lxc',
      status: r.status,
      node: r.node,
      cpu: r.cpu ?? 0,
      cores: r.maxcpu ?? 0,
      mem: r.mem ?? 0,
      maxmem: r.maxmem ?? 0,
      disk: r.disk ?? 0,
      maxdisk: r.maxdisk ?? 0,
      uptime: r.uptime ?? 0,
      tags: r.tags || ''
    }))
    .sort((a, b) => {
      // Running guests first, then by VMID — stable ordering matters on a
      // display you glance at, so rows don't jump between polls.
      if (a.status !== b.status) return a.status === 'running' ? -1 : 1;
      return a.vmid - b.vmid;
    });

  const storage = resources
    .filter((r) => r.type === 'storage')
    .map((r) => ({
      id: r.id,
      name: r.storage,
      node: r.node,
      status: r.status,
      used: r.disk ?? 0,
      total: r.maxdisk ?? 0,
      shared: Boolean(r.shared)
    }))
    // A shared storage shows up once per node; keep one entry each.
    .filter((s, i, arr) => !s.shared || arr.findIndex((o) => o.name === s.name) === i);

  // Per-node detail. Failures here are non-fatal: the cluster-level numbers
  // are already in hand and a node that just went down shouldn't blank the view.
  await Promise.all(
    nodes.map(async (node) => {
      if (node.status !== 'online') return;
      try {
        const detail = await requestJson(
          `${base}/api2/json/nodes/${encodeURIComponent(node.name)}/status`,
          opts
        );
        const d = detail.data || {};
        node.loadavg = (d.loadavg || []).map(Number);
        node.kernel = d.kversion || null;
        node.cpuModel = d.cpuinfo ? d.cpuinfo.model : null;
        node.pveVersion = d.pveversion || null;
        if (d.uptime) node.uptime = d.uptime;
        if (d.memory) {
          node.mem = d.memory.used ?? node.mem;
          node.maxmem = d.memory.total ?? node.maxmem;
        }
        if (d.rootfs) {
          node.disk = d.rootfs.used ?? node.disk;
          node.maxdisk = d.rootfs.total ?? node.maxdisk;
        }
      } catch (err) {
        /* leave the cluster-level values in place */
      }
    })
  );

  return { nodes, guests, storage };
}

// ═══════════════════════════════════════════════════════════════════════════
// Netdata
// ═══════════════════════════════════════════════════════════════════════════

function sumDimensions(chart) {
  if (!chart || !chart.dimensions) return null;
  return Object.values(chart.dimensions).reduce(
    (total, dim) => total + (Number(dim.value) || 0),
    0
  );
}

function dimensionValue(chart, key) {
  if (!chart || !chart.dimensions || !chart.dimensions[key]) return null;
  const value = Number(chart.dimensions[key].value);
  return Number.isFinite(value) ? value : null;
}

/**
 * Root filesystem usage. The chart is keyed by the real mount point
 * (`disk_space./`), not the underscore-escaped form used in some chart IDs,
 * so check both and fall back to the shallowest real mount.
 */
function rootDiskChart(metrics) {
  if (metrics['disk_space./']) return metrics['disk_space./'];
  if (metrics['disk_space._']) return metrics['disk_space._'];

  const candidates = Object.keys(metrics)
    .filter((key) => key.startsWith('disk_space.'))
    .filter((key) => !/^disk_space\.\/(run|dev|sys|proc|snap|boot)/.test(key))
    .sort((a, b) => a.length - b.length);

  return candidates.length ? metrics[candidates[0]] : null;
}

/**
 * `/api/v1/allmetrics?format=json` hands back every chart's latest value in
 * one request and is supported by both v1 and v2 agents, which makes it a
 * far steadier target than the versioned /data endpoints.
 */
async function collectNetdataHost(host) {
  const base = String(host.url || '').replace(/\/+$/, '');
  const metrics = await requestJson(`${base}/api/v1/allmetrics?format=json`, {
    timeout: 5000,
    verifyTls: host.verifyTls !== false
  });

  // Unlike the /data endpoint, allmetrics DOES expose an `idle` dimension, so
  // summing every dimension yields a constant 100%. Utilisation is the
  // non-idle remainder.
  const cpuChart = metrics['system.cpu'];
  const idle = dimensionValue(cpuChart, 'idle');
  let cpu = null;
  if (cpuChart) {
    if (idle !== null) {
      cpu = 100 - idle;
    } else {
      cpu = sumDimensions(cpuChart);
    }
  }

  const ramChart = metrics['system.ram'];
  let ram = null;
  let ramUsedMb = null;
  let ramTotalMb = null;
  if (ramChart) {
    const used = dimensionValue(ramChart, 'used') || 0;
    const total = sumDimensions(ramChart) || 0;
    if (total > 0) {
      ram = (used / total) * 100;
      ramUsedMb = used;
      ramTotalMb = total;
    }
  }

  const rootFs = rootDiskChart(metrics);
  let disk = null;
  if (rootFs) {
    const used = dimensionValue(rootFs, 'used') || 0;
    const avail = dimensionValue(rootFs, 'avail') || 0;
    const total = used + avail;
    if (total > 0) disk = (used / total) * 100;
  }

  return {
    cpu: cpu === null ? null : Math.min(100, Math.max(0, cpu)),
    ram: ram === null ? null : Math.min(100, Math.max(0, ram)),
    ramUsedMb,
    ramTotalMb,
    disk: disk === null ? null : Math.min(100, Math.max(0, disk)),
    load1: dimensionValue(metrics['system.load'], 'load1'),
    load5: dimensionValue(metrics['system.load'], 'load5'),
    load15: dimensionValue(metrics['system.load'], 'load15'),
    uptime: dimensionValue(metrics['system.uptime'], 'uptime'),
    netIn: dimensionValue(metrics['system.net'], 'received'),
    netOut: dimensionValue(metrics['system.net'], 'sent')
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Plain HTTP up/down checks
// ═══════════════════════════════════════════════════════════════════════════

async function checkService(check) {
  // Many self-hosted apps answer 401/403 at the root while being perfectly
  // healthy, so the accepted set is configurable per check.
  const expect = check.expectStatus || null;
  const started = Date.now();

  try {
    const res = await request(check.url, {
      method: check.method || 'GET',
      timeout: check.timeout || 5000,
      verifyTls: check.verifyTls !== false,
      headers: { 'User-Agent': 'dashboard-display/1.0' }
    });
    const latencyMs = Date.now() - started;
    const ok = expect
      ? expect.includes(res.status)
      : res.status >= 200 && res.status < 400;

    return {
      name: check.name,
      url: check.url,
      ok,
      status: res.status,
      latencyMs,
      error: ok ? null : `Unexpected status ${res.status}`
    };
  } catch (err) {
    return {
      name: check.name,
      url: check.url,
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      error: err.message
    };
  }
}

module.exports = { collectProxmox, collectNetdataHost, checkService };
