// ══════════════════════════════════════════════════════════════════════════
// Infrastructure snapshot client
//
// Talks only to this dashboard's own server. Proxmox tokens, self-signed
// certs and CORS all stay on the Node side.
// ══════════════════════════════════════════════════════════════════════════

import { CONFIG, FLAGS } from './config.js';
import { infraStore } from './store.js';
import { createPoller } from './util.js';

async function fetchSnapshot() {
  const url = FLAGS.demo ? '/api/infra?demo=1' : '/api/infra';
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) throw new Error(`Infra API ${response.status}`);
  const snapshot = await response.json();

  if (snapshot.configured === false) {
    infraStore.set({ status: 'unconfigured', snapshot, error: null, updatedAt: Date.now() });
    return;
  }

  infraStore.set({
    status: 'ready',
    snapshot,
    error: snapshot.error || null,
    updatedAt: Date.now()
  });
}

export function startInfra() {
  const poller = createPoller(
    async () => {
      try {
        await fetchSnapshot();
      } catch (err) {
        const { status } = infraStore.get();
        // A snapshot already on screen stays there and goes stale visibly;
        // only a cold start shows the error state.
        if (status === 'loading') {
          infraStore.set({ status: 'error', error: err.message });
        } else {
          infraStore.set({ error: err.message });
        }
        throw err;
      }
    },
    { interval: CONFIG.dashboard.infraPollInterval }
  );

  poller.start();
  return poller;
}
