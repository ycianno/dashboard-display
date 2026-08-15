/**
 * Server-side configuration — copy to `server.config.js` and edit.
 *
 * This file is git-ignored and is read ONLY by server.js (Node). It never
 * reaches the browser, which is why API tokens belong here and not in
 * config.js. The dashboard talks to your infrastructure through
 * `GET /api/infra` on this same server, which sidesteps CORS and self-signed
 * certificate problems entirely.
 *
 * Every section is optional. Leave a section out (or set `enabled: false`)
 * and the dashboard simply won't render that part.
 */
module.exports = {
  // Where the static server listens.
  // '127.0.0.1' = this machine only. '0.0.0.0' = reachable from your LAN,
  // which also exposes /api/infra to your LAN. Pick deliberately.
  host: '0.0.0.0',
  port: 8080,

  // How long a collected snapshot is reused before re-polling your servers.
  // The browser polls more often than this; the cache absorbs it.
  cacheTtlMs: 5000,

  proxmox: {
    enabled: false,

    // Base URL of any node in the cluster, including the port.
    host: 'https://192.168.1.10:8006',

    // Create under: Datacenter -> Permissions -> API Tokens.
    // Uncheck "Privilege Separation" or grant the token PVEAuditor on `/`.
    tokenId: 'dashboard@pve!display',
    tokenSecret: '00000000-0000-0000-0000-000000000000',

    // Proxmox ships a self-signed certificate by default, so this is `false`
    // out of the box. Set to true if you've installed a trusted cert.
    verifyTls: false,

    // Hide specific guests from the list by VMID.
    ignoreVmids: []
  },

  // Netdata agents. Works with the stock install — no token needed unless
  // you've put the agent behind auth.
  netdata: {
    enabled: false,
    hosts: [
      // { name: 'nas',   url: 'http://192.168.1.20:19999' },
      // { name: 'docker', url: 'http://192.168.1.21:19999' }
    ]
  },

  // Plain HTTP up/down checks for anything else worth watching.
  services: {
    enabled: false,
    checks: [
      // { name: 'Home Assistant', url: 'http://192.168.1.30:8123', method: 'GET' },
      // { name: 'Plex',           url: 'http://192.168.1.31:32400/identity' },
      // { name: 'Router',         url: 'http://192.168.1.1', expectStatus: [200, 401, 403] }
    ]
  },

  // Thresholds that turn a metric amber/red and raise a dashboard alert.
  thresholds: {
    cpuWarn: 75,
    cpuCrit: 90,
    memWarn: 80,
    memCrit: 92,
    diskWarn: 80,
    diskCrit: 90
  }
};
