'use strict';

const { collectProxmox, collectNetdataHost, checkService } = require('./collectors');

const HISTORY_LENGTH = 60; // ~5 minutes of samples at the default 5s cache TTL

const DEFAULT_THRESHOLDS = {
  cpuWarn: 75,
  cpuCrit: 90,
  memWarn: 80,
  memCrit: 92,
  diskWarn: 80,
  diskCrit: 90
};

/**
 * Sparkline history lives here rather than in the browser so that it survives
 * a page reload and stays consistent across every device pointed at this
 * dashboard.
 */
const history = new Map();

function pushHistory(key, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  const series = history.get(key) || [];
  series.push(Math.round(value * 10) / 10);
  if (series.length > HISTORY_LENGTH) series.splice(0, series.length - HISTORY_LENGTH);
  history.set(key, series);
}

function readHistory(key) {
  return history.get(key) || [];
}

function levelFor(percent, warn, crit) {
  if (percent === null || percent === undefined) return 'unknown';
  if (percent >= crit) return 'crit';
  if (percent >= warn) return 'warn';
  return 'ok';
}

function pct(used, total) {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

let cache = { at: 0, data: null };
let inflight = null;

async function buildSnapshot(config) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(config.thresholds || {}) };
  const snapshot = {
    configured: false,
    updatedAt: Date.now(),
    thresholds,
    proxmox: { enabled: false, ok: false, error: null, nodes: [], guests: [], storage: [] },
    netdata: { enabled: false, hosts: [] },
    services: { enabled: false, checks: [] },
    summary: { alerts: [] }
  };

  const work = [];

  // ── Proxmox ──────────────────────────────────────────────────────────────
  if (config.proxmox && config.proxmox.enabled) {
    snapshot.configured = true;
    snapshot.proxmox.enabled = true;
    work.push(
      collectProxmox(config.proxmox)
        .then((result) => {
          snapshot.proxmox.ok = true;
          snapshot.proxmox.nodes = result.nodes.map((node) => {
            const cpuPct = node.cpu === null ? null : node.cpu * 100;
            const memPct = pct(node.mem, node.maxmem);
            const diskPct = pct(node.disk, node.maxdisk);

            pushHistory(`pve:${node.name}:cpu`, cpuPct);
            pushHistory(`pve:${node.name}:mem`, memPct);

            return {
              ...node,
              cpuPct,
              memPct,
              diskPct,
              level: worst([
                node.status === 'online' ? 'ok' : 'crit',
                levelFor(cpuPct, thresholds.cpuWarn, thresholds.cpuCrit),
                levelFor(memPct, thresholds.memWarn, thresholds.memCrit),
                levelFor(diskPct, thresholds.diskWarn, thresholds.diskCrit)
              ]),
              history: {
                cpu: readHistory(`pve:${node.name}:cpu`),
                mem: readHistory(`pve:${node.name}:mem`)
              }
            };
          });
          snapshot.proxmox.guests = result.guests.map((guest) => ({
            ...guest,
            cpuPct: guest.cpu === null ? null : guest.cpu * 100,
            memPct: pct(guest.mem, guest.maxmem),
            diskPct: pct(guest.disk, guest.maxdisk)
          }));
          snapshot.proxmox.storage = result.storage.map((store) => ({
            ...store,
            usedPct: pct(store.used, store.total),
            level: levelFor(
              pct(store.used, store.total),
              thresholds.diskWarn,
              thresholds.diskCrit
            )
          }));
        })
        .catch((err) => {
          snapshot.proxmox.ok = false;
          snapshot.proxmox.error = err.message;
        })
    );
  }

  // ── Netdata ──────────────────────────────────────────────────────────────
  const netdataHosts = (config.netdata && config.netdata.enabled && config.netdata.hosts) || [];
  if (netdataHosts.length) {
    snapshot.configured = true;
    snapshot.netdata.enabled = true;
    work.push(
      Promise.all(
        netdataHosts.map(async (host) => {
          try {
            const metrics = await collectNetdataHost(host);
            pushHistory(`nd:${host.name}:cpu`, metrics.cpu);
            pushHistory(`nd:${host.name}:ram`, metrics.ram);
            return {
              name: host.name,
              url: host.url,
              ok: true,
              error: null,
              ...metrics,
              level: worst([
                levelFor(metrics.cpu, thresholds.cpuWarn, thresholds.cpuCrit),
                levelFor(metrics.ram, thresholds.memWarn, thresholds.memCrit),
                levelFor(metrics.disk, thresholds.diskWarn, thresholds.diskCrit)
              ]),
              history: {
                cpu: readHistory(`nd:${host.name}:cpu`),
                ram: readHistory(`nd:${host.name}:ram`)
              }
            };
          } catch (err) {
            return {
              name: host.name,
              url: host.url,
              ok: false,
              error: err.message,
              level: 'crit',
              history: {
                cpu: readHistory(`nd:${host.name}:cpu`),
                ram: readHistory(`nd:${host.name}:ram`)
              }
            };
          }
        })
      ).then((hosts) => {
        snapshot.netdata.hosts = hosts;
      })
    );
  }

  // ── Service checks ───────────────────────────────────────────────────────
  const checks = (config.services && config.services.enabled && config.services.checks) || [];
  if (checks.length) {
    snapshot.configured = true;
    snapshot.services.enabled = true;
    work.push(
      Promise.all(checks.map(checkService)).then((results) => {
        snapshot.services.checks = results.map((result) => {
          pushHistory(`svc:${result.name}:latency`, result.ok ? result.latencyMs : null);
          return { ...result, history: readHistory(`svc:${result.name}:latency`) };
        });
      })
    );
  }

  await Promise.all(work);

  snapshot.summary = summarize(snapshot, thresholds);
  snapshot.updatedAt = Date.now();
  return snapshot;
}

const LEVEL_ORDER = { unknown: 0, ok: 1, warn: 2, crit: 3 };

function worst(levels) {
  return levels.reduce(
    (acc, level) => (LEVEL_ORDER[level] > LEVEL_ORDER[acc] ? level : acc),
    'ok'
  );
}

function summarize(snapshot, thresholds) {
  const alerts = [];
  const nodes = snapshot.proxmox.nodes;
  const guests = snapshot.proxmox.guests;
  const netdata = snapshot.netdata.hosts;
  const services = snapshot.services.checks;

  if (snapshot.proxmox.enabled && !snapshot.proxmox.ok) {
    alerts.push({ level: 'crit', source: 'Proxmox', message: snapshot.proxmox.error || 'Unreachable' });
  }

  nodes.forEach((node) => {
    if (node.status !== 'online') {
      alerts.push({ level: 'crit', source: node.name, message: 'Node offline' });
      return;
    }
    if (node.cpuPct >= thresholds.cpuCrit) {
      alerts.push({ level: 'crit', source: node.name, message: `CPU ${Math.round(node.cpuPct)}%` });
    }
    if (node.memPct >= thresholds.memCrit) {
      alerts.push({ level: 'crit', source: node.name, message: `Memory ${Math.round(node.memPct)}%` });
    } else if (node.memPct >= thresholds.memWarn) {
      alerts.push({ level: 'warn', source: node.name, message: `Memory ${Math.round(node.memPct)}%` });
    }
    if (node.diskPct >= thresholds.diskWarn) {
      alerts.push({
        level: node.diskPct >= thresholds.diskCrit ? 'crit' : 'warn',
        source: node.name,
        message: `Disk ${Math.round(node.diskPct)}%`
      });
    }
  });

  snapshot.proxmox.storage.forEach((store) => {
    if (store.usedPct >= thresholds.diskWarn) {
      alerts.push({
        level: store.usedPct >= thresholds.diskCrit ? 'crit' : 'warn',
        source: store.name,
        message: `Storage ${Math.round(store.usedPct)}% full`
      });
    }
  });

  netdata.forEach((host) => {
    if (!host.ok) {
      alerts.push({ level: 'crit', source: host.name, message: 'Agent unreachable' });
      return;
    }
    if (host.cpu >= thresholds.cpuCrit) {
      alerts.push({ level: 'crit', source: host.name, message: `CPU ${Math.round(host.cpu)}%` });
    }
    if (host.ram >= thresholds.memWarn) {
      alerts.push({
        level: host.ram >= thresholds.memCrit ? 'crit' : 'warn',
        source: host.name,
        message: `RAM ${Math.round(host.ram)}%`
      });
    }
    if (host.disk >= thresholds.diskWarn) {
      alerts.push({
        level: host.disk >= thresholds.diskCrit ? 'crit' : 'warn',
        source: host.name,
        message: `Disk ${Math.round(host.disk)}%`
      });
    }
  });

  services.forEach((check) => {
    if (!check.ok) {
      alerts.push({ level: 'crit', source: check.name, message: check.error || 'Down' });
    }
  });

  alerts.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]);

  const hostsTotal = nodes.length + netdata.length;
  const hostsUp =
    nodes.filter((n) => n.status === 'online').length + netdata.filter((h) => h.ok).length;

  return {
    hostsUp,
    hostsTotal,
    guestsRunning: guests.filter((g) => g.status === 'running').length,
    guestsTotal: guests.length,
    servicesUp: services.filter((s) => s.ok).length,
    servicesTotal: services.length,
    level: alerts.length ? alerts[0].level : hostsTotal || services.length ? 'ok' : 'unknown',
    alerts: alerts.slice(0, 12)
  };
}

/**
 * Cached read. Concurrent callers share a single in-flight collection so a
 * browser refresh loop can't stampede the Proxmox API.
 */
async function getSnapshot(config, { force = false } = {}) {
  const ttl = config.cacheTtlMs ?? 5000;

  if (!force && cache.data && Date.now() - cache.at < ttl) {
    return cache.data;
  }
  if (inflight) return inflight;

  inflight = buildSnapshot(config)
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

module.exports = { getSnapshot };
