// ══════════════════════════════════════════════════════════════════════════
// Infrastructure view
// ══════════════════════════════════════════════════════════════════════════

import { $, esc, icon, formatBytes, formatUptime, pct, sparkPaths, levelFor } from '../util.js';
import { infraStore } from '../store.js';

export function initInfra() {
  const root = $('#view-infra');
  const summaryEl = $('#infra-summary');
  const bodyEl = $('#infra-body');

  // Re-rendering under a finger kills the scroll gesture, so hold off while
  // the user is actually touching this page.
  let interacting = false;
  let pending = null;

  root.addEventListener('pointerdown', () => {
    interacting = true;
  });

  const release = () => {
    if (!interacting) return;
    interacting = false;
    if (pending) {
      const state = pending;
      pending = null;
      render(state);
    }
  };

  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  function thresholds(snapshot) {
    return snapshot?.thresholds || { cpuWarn: 75, cpuCrit: 90, memWarn: 80, memCrit: 92, diskWarn: 80, diskCrit: 90 };
  }

  // ── Fragments ───────────────────────────────────────────────────────────

  function meter(value, level) {
    const width = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
    return `<div class="meter ${level}"><i style="width:${width}%"></i></div>`;
  }

  function metricRow(label, value, level) {
    return `
      <div class="metric ${level}">
        <span class="k">${label}</span>
        ${meter(value, level)}
        <span class="v tnum">${pct(value)}</span>
      </div>`;
  }

  function sparkline(values) {
    const { line, area } = sparkPaths(values, { max: 100 });
    if (!line) return '';
    return `
      <svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path class="area" d="${area}"></path>
        <path class="line" d="${line}"></path>
      </svg>`;
  }

  function hostCard(host) {
    const t = thresholds(infraStore.get().snapshot);
    const cpuLevel = levelFor(host.cpuPct, t.cpuWarn, t.cpuCrit);
    const memLevel = levelFor(host.memPct, t.memWarn, t.memCrit);
    const diskLevel = levelFor(host.diskPct, t.diskWarn, t.diskCrit);

    const facts = [];
    if (host.cores) facts.push(`${host.cores} cores`);
    if (host.uptime) facts.push(`up ${formatUptime(host.uptime)}`);
    if (host.maxmem) facts.push(`${formatBytes(host.maxmem, 0)} RAM`);

    const load = host.loadavg?.length
      ? `<span>load <b class="tnum">${host.loadavg.map((n) => n.toFixed(2)).join(' ')}</b></span>`
      : host.load1 !== null && host.load1 !== undefined
        ? `<span>load <b class="tnum">${Number(host.load1).toFixed(2)}</b></span>`
        : '';

    const offline = host.status && host.status !== 'online';

    return `
      <div class="host-card ${host.level || ''}">
        <div class="host-top">
          <span class="dot ${offline ? 'crit' : host.level === 'warn' ? 'warn' : 'ok'} ${offline ? '' : 'live'}"></span>
          <span class="host-name truncate">${esc(host.name)}</span>
          <span class="host-kind">${esc(host.kind)}</span>
        </div>
        <div class="host-sub">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
        ${
          offline
            ? `<div class="placeholder" style="min-height:6rem">${icon('alert')}<p>Offline</p></div>`
            : `
        <div class="spark-wrap">
          ${sparkline(host.history?.cpu || host.history?.ram)}
          <div class="spark-label">
            <span class="n tnum">${pct(host.cpuPct)}</span>
            <span class="u">cpu</span>
          </div>
        </div>
        ${metricRow('MEM', host.memPct, memLevel)}
        ${host.diskPct !== null && host.diskPct !== undefined ? metricRow('DISK', host.diskPct, diskLevel) : ''}
        <div class="host-foot">
          ${load}
          ${host.cpuModel ? `<span class="truncate">${esc(host.cpuModel)}</span>` : ''}
        </div>`
        }
      </div>`;
  }

  function guestRow(guest) {
    const running = guest.status === 'running';
    return `
      <div class="guest-row ${running ? '' : 'stopped'}">
        <span class="guest-id">${guest.vmid}</span>
        <span class="guest-name">
          <span class="dot ${running ? 'ok' : ''}"></span>
          <span class="n truncate">${esc(guest.name)}</span>
          <span class="badge ${guest.kind}">${guest.kind}</span>
        </span>
        <span class="guest-metric">
          <span class="v tnum">${running ? pct(guest.cpuPct) : '—'}</span>
          ${meter(running ? guest.cpuPct : 0, '')}
        </span>
        <span class="guest-metric">
          <span class="v tnum">${running ? pct(guest.memPct) : '—'}</span>
          ${meter(running ? guest.memPct : 0, '')}
        </span>
      </div>`;
  }

  function serviceRow(check) {
    return `
      <div class="svc-row ${check.ok ? '' : 'down'}">
        <span class="dot ${check.ok ? 'ok' : 'crit'} ${check.ok ? 'live' : ''}"></span>
        <span class="svc-name">
          <span class="truncate">${esc(check.name)}</span>
          <span class="svc-url truncate">${esc(check.error || check.url)}</span>
        </span>
        <span class="svc-latency tnum">${check.ok ? `${check.latencyMs} ms` : 'DOWN'}</span>
      </div>`;
  }

  function storageRow(store) {
    return `
      <div class="storage-row ${store.level || ''}">
        <span class="storage-name truncate">
          ${esc(store.name)}
          <small>${formatBytes(store.used, 1)} of ${formatBytes(store.total, 1)}${store.node ? ` · ${esc(store.node)}` : ''}</small>
        </span>
        ${meter(store.usedPct, store.level)}
        <span class="storage-pct tnum">${pct(store.usedPct)}</span>
      </div>`;
  }

  function section(title, count, inner) {
    return `
      <div class="section card">
        <div class="section-head">
          <span class="eyebrow">${esc(title)}</span>
          ${count !== null ? `<span class="count">${count}</span>` : ''}
        </div>
        <div class="section-body">${inner}</div>
      </div>`;
  }

  // ── Setup state ─────────────────────────────────────────────────────────

  function renderSetup() {
    summaryEl.hidden = true;
    bodyEl.innerHTML = `
      <div class="card setup" style="grid-column:1/-1">
        ${icon('server', 'ic ic-lg')}
        <h2>Connect your servers</h2>
        <p>
          This page reads Proxmox, Netdata and plain HTTP health checks through the
          dashboard's own Node server, so API tokens never reach the browser and
          self-signed certificates are not a problem.
        </p>
        <pre>cp server.config.example.js <b>server.config.js</b>
# fill in your Proxmox host + API token
node server.js</pre>
        <div class="setup-actions">
          <a class="setup-btn accent" href="?demo=1">${icon('play', 'ic ic-sm')} Preview with sample data</a>
        </div>
      </div>`;
  }

  // ── Main render ─────────────────────────────────────────────────────────

  function render(state) {
    if (interacting) {
      pending = state;
      return;
    }

    if (state.status === 'unconfigured') {
      renderSetup();
      return;
    }

    if (state.status === 'loading') {
      summaryEl.hidden = true;
      bodyEl.innerHTML = `<div class="card placeholder" style="grid-column:1/-1">${icon('server')}<p>Reading infrastructure…</p></div>`;
      return;
    }

    if (state.status === 'error' && !state.snapshot) {
      summaryEl.hidden = true;
      bodyEl.innerHTML = `
        <div class="card placeholder" style="grid-column:1/-1">
          ${icon('alert')}
          <h3>Cannot reach the dashboard server</h3>
          <p>${esc(state.error || 'Unknown error')}</p>
        </div>`;
      return;
    }

    const snapshot = state.snapshot;
    if (!snapshot) return;

    const { proxmox, netdata, services, summary } = snapshot;

    // ── Summary strip ──
    summaryEl.hidden = false;
    const ageSeconds = Math.round((Date.now() - snapshot.updatedAt) / 1000);
    const stale = ageSeconds > 45;

    const stats = [
      {
        k: 'Hosts',
        v: `${summary.hostsUp}<small>/${summary.hostsTotal}</small>`,
        level: summary.hostsUp === summary.hostsTotal ? 'ok' : 'crit'
      }
    ];
    if (summary.guestsTotal) {
      stats.push({
        k: 'Guests',
        v: `${summary.guestsRunning}<small>/${summary.guestsTotal}</small>`,
        level: ''
      });
    }
    if (summary.servicesTotal) {
      stats.push({
        k: 'Services',
        v: `${summary.servicesUp}<small>/${summary.servicesTotal}</small>`,
        level: summary.servicesUp === summary.servicesTotal ? 'ok' : 'crit'
      });
    }

    summaryEl.innerHTML = `
      ${stats
        .map(
          (stat) => `
        <div class="stat ${stat.level}">
          <span class="v tnum">${stat.v}</span>
          <span class="k">${stat.k}</span>
        </div>`
        )
        .join('')}
      <div class="infra-alerts">
        ${
          summary.alerts.length
            ? summary.alerts
                .slice(0, 5)
                .map(
                  (alert) => `
              <span class="alert-chip ${alert.level}">
                <span class="src">${esc(alert.source)}</span>
                <span>${esc(alert.message)}</span>
              </span>`
                )
                .join('')
            : `<span class="chip">${icon('check', 'ic ic-sm')} All clear</span>`
        }
        ${stale ? `<span class="stale-badge">updated ${ageSeconds}s ago</span>` : ''}
      </div>`;

    // ── Body ──
    const hosts = [
      ...proxmox.nodes.map((node) => ({ ...node, kind: 'pve' })),
      ...netdata.hosts.map((host) => ({
        ...host,
        kind: 'netdata',
        cpuPct: host.cpu,
        memPct: host.ram,
        diskPct: host.disk,
        status: host.ok ? 'online' : 'offline',
        maxmem: host.ramTotalMb ? host.ramTotalMb * 1024 * 1024 : null,
        history: { cpu: host.history?.cpu, ram: host.history?.ram }
      }))
    ];

    const left = [];
    const right = [];

    if (proxmox.enabled && !proxmox.ok) {
      left.push(
        section(
          'Proxmox',
          null,
          `<div class="placeholder">${icon('alert')}<h3>Proxmox unreachable</h3><p>${esc(proxmox.error || '')}</p></div>`,
          { scroll: false }
        )
      );
    }

    if (hosts.length) {
      left.push(
        section('Hosts', hosts.length, `<div class="host-grid">${hosts.map(hostCard).join('')}</div>`)
      );
    }

    if (proxmox.storage?.length) {
      left.push(
        section(
          'Storage',
          proxmox.storage.length,
          `<div class="storage-list">${proxmox.storage.map(storageRow).join('')}</div>`
        )
      );
    }

    if (proxmox.guests?.length) {
      right.push(
        section(
          'Virtual machines & containers',
          `${summary.guestsRunning}/${summary.guestsTotal}`,
          `<div class="guest-list">${proxmox.guests.map(guestRow).join('')}</div>`
        )
      );
    }

    if (services.checks?.length) {
      right.push(
        section(
          'Services',
          `${summary.servicesUp}/${summary.servicesTotal}`,
          `<div class="svc-list">${services.checks.map(serviceRow).join('')}</div>`
        )
      );
    }

    // Keep each column's scroll position across the 10-second refresh.
    const offsets = Array.from(bodyEl.querySelectorAll('.infra-col')).map((node) => node.scrollTop);

    bodyEl.innerHTML = `
      <div class="infra-col">${left.join('')}</div>
      <div class="infra-col">${right.join('')}</div>`;

    bodyEl.querySelectorAll('.infra-col').forEach((node, i) => {
      if (offsets[i]) node.scrollTop = offsets[i];
    });
  }

  infraStore.subscribe(render);
}
