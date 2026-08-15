'use strict';

/**
 * Synthetic infrastructure snapshot, served from `/api/infra?demo=1`.
 *
 * Exists so the Infrastructure view can be designed, previewed and screenshot
 * without pointing at real hardware — and so a fresh clone shows something
 * meaningful before server.config.js is filled in.
 */

const START = Date.now();

function wave(seed, base, amplitude) {
  const t = (Date.now() - START) / 1000;
  const value = base + Math.sin(t / (6 + seed * 2) + seed) * amplitude + Math.sin(t / 1.7 + seed) * (amplitude / 3);
  return Math.min(100, Math.max(1, value));
}

function series(seed, base, amplitude, length = 60) {
  const out = [];
  for (let i = length; i > 0; i -= 1) {
    const t = (Date.now() - START) / 1000 - i * 5;
    out.push(
      Math.round(
        Math.min(100, Math.max(1, base + Math.sin(t / (6 + seed * 2) + seed) * amplitude)) * 10
      ) / 10
    );
  }
  return out;
}

const GB = 1024 ** 3;

function buildDemoSnapshot() {
  const thresholds = { cpuWarn: 75, cpuCrit: 90, memWarn: 80, memCrit: 92, diskWarn: 80, diskCrit: 90 };

  const nodes = [
    {
      id: 'node/pve-01', name: 'pve-01', status: 'online', cores: 12, uptime: 3861234,
      kernel: '6.8.12-4-pve', cpuModel: 'Intel Core i7-12700K', pveVersion: 'pve-manager/8.2.4',
      cpuPct: wave(1, 34, 18), memPct: wave(2, 61, 9), diskPct: 43,
      mem: 39.2 * GB, maxmem: 64 * GB, disk: 205 * GB, maxdisk: 476 * GB,
      loadavg: [1.42, 1.19, 0.98], level: 'ok',
      history: { cpu: series(1, 34, 18), mem: series(2, 61, 9) }
    },
    {
      id: 'node/pve-02', name: 'pve-02', status: 'online', cores: 8, uptime: 1204567,
      kernel: '6.8.12-4-pve', cpuModel: 'AMD Ryzen 7 5700G', pveVersion: 'pve-manager/8.2.4',
      cpuPct: wave(3, 22, 12), memPct: wave(4, 84, 6), diskPct: 71,
      mem: 26.9 * GB, maxmem: 32 * GB, disk: 340 * GB, maxdisk: 476 * GB,
      loadavg: [0.61, 0.74, 0.80], level: 'warn',
      history: { cpu: series(3, 22, 12), mem: series(4, 84, 6) }
    }
  ];

  const guests = [
    { id: 'lxc/101', vmid: 101, name: 'docker-01', kind: 'lxc', status: 'running', node: 'pve-01', cores: 4, cpuPct: wave(5, 28, 20), memPct: 64, mem: 5.1 * GB, maxmem: 8 * GB, uptime: 1203400, tags: 'prod' },
    { id: 'qemu/102', vmid: 102, name: 'truenas', kind: 'vm', status: 'running', node: 'pve-01', cores: 4, cpuPct: wave(6, 12, 8), memPct: 78, mem: 12.5 * GB, maxmem: 16 * GB, uptime: 3860000, tags: 'storage' },
    { id: 'lxc/103', vmid: 103, name: 'home-assistant', kind: 'lxc', status: 'running', node: 'pve-02', cores: 2, cpuPct: wave(7, 9, 6), memPct: 41, mem: 1.6 * GB, maxmem: 4 * GB, uptime: 1200000, tags: 'home' },
    { id: 'lxc/104', vmid: 104, name: 'nginx-proxy', kind: 'lxc', status: 'running', node: 'pve-02', cores: 1, cpuPct: wave(8, 4, 3), memPct: 22, mem: 0.22 * GB, maxmem: 1 * GB, uptime: 1200000, tags: 'net' },
    { id: 'qemu/105', vmid: 105, name: 'win-vm', kind: 'vm', status: 'stopped', node: 'pve-01', cores: 4, cpuPct: 0, memPct: 0, mem: 0, maxmem: 8 * GB, uptime: 0, tags: '' },
    { id: 'lxc/106', vmid: 106, name: 'postgres', kind: 'lxc', status: 'running', node: 'pve-01', cores: 4, cpuPct: wave(9, 18, 14), memPct: 57, mem: 4.6 * GB, maxmem: 8 * GB, uptime: 3400000, tags: 'db' }
  ];

  const storage = [
    { id: 'storage/local', name: 'local', node: 'pve-01', status: 'available', used: 205 * GB, total: 476 * GB, usedPct: 43, level: 'ok' },
    { id: 'storage/tank', name: 'tank', node: 'pve-01', status: 'available', used: 7.4 * 1024 * GB, total: 8.7 * 1024 * GB, usedPct: 85, level: 'warn' },
    { id: 'storage/backups', name: 'backups', node: 'pve-02', status: 'available', used: 1.2 * 1024 * GB, total: 4 * 1024 * GB, usedPct: 30, level: 'ok' }
  ];

  const netdataHosts = [
    {
      name: 'nas', url: 'http://10.0.0.20:19999', ok: true, error: null, level: 'ok',
      cpu: wave(10, 17, 12), ram: wave(11, 48, 10), disk: 62,
      load1: 0.84, load5: 0.71, load15: 0.66, uptime: 5120000,
      netIn: 1240, netOut: 8830,
      history: { cpu: series(10, 17, 12), ram: series(11, 48, 10) }
    }
  ];

  const checks = [
    { name: 'Home Assistant', url: 'http://10.0.0.30:8123', ok: true, status: 200, latencyMs: 24, error: null, history: [21, 25, 22, 28, 24, 23, 26, 24] },
    { name: 'Plex', url: 'http://10.0.0.31:32400', ok: true, status: 200, latencyMs: 61, error: null, history: [58, 66, 61, 59, 72, 61, 63, 61] },
    { name: 'Gitea', url: 'http://10.0.0.32:3000', ok: false, status: null, latencyMs: 5000, error: 'Timed out after 5000ms', history: [40, 44, 41, 39, 42] }
  ];

  const alerts = [
    { level: 'crit', source: 'Gitea', message: 'Timed out after 5000ms' },
    { level: 'warn', source: 'pve-02', message: `Memory ${Math.round(nodes[1].memPct)}%` },
    { level: 'warn', source: 'tank', message: 'Storage 85% full' }
  ];

  return {
    configured: true,
    demo: true,
    updatedAt: Date.now(),
    thresholds,
    proxmox: { enabled: true, ok: true, error: null, nodes, guests, storage },
    netdata: { enabled: true, hosts: netdataHosts },
    services: { enabled: true, checks },
    summary: {
      hostsUp: 3, hostsTotal: 3,
      guestsRunning: guests.filter((g) => g.status === 'running').length,
      guestsTotal: guests.length,
      servicesUp: 2, servicesTotal: 3,
      level: 'crit',
      alerts
    }
  };
}

module.exports = { buildDemoSnapshot };
