// ══════════════════════════════════════════════════════════════════════════
// The Forge client
//
// Talks only to this dashboard's own server, which holds the sync token. The
// summary arrives pre-computed by The Forge's own engine — nothing here works
// out a level, a streak or which quests are due, because a wall panel that
// disagrees with the real app is worse than one that shows nothing.
// ══════════════════════════════════════════════════════════════════════════

import { CONFIG } from './config.js';
import { forgeStore } from './store.js';
import { createPoller } from './util.js';

let poller = null;

function applySnapshot(snapshot) {
  if (snapshot.configured === false) {
    forgeStore.set({ status: 'unconfigured', summary: null, error: null, updatedAt: Date.now() });
    return;
  }

  forgeStore.set({
    status: snapshot.summary ? 'ready' : 'error',
    summary: snapshot.summary || forgeStore.get().summary,
    stale: !!snapshot.stale,
    error: snapshot.error || null,
    reason: snapshot.reason || null,
    updatedAt: Date.now()
  });
}

async function fetchSummary() {
  const response = await fetch('/api/forge', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Forge API ${response.status}`);
  applySnapshot(await response.json());
}

/**
 * Tick a quest off, or back on.
 *
 * The view paints the new state immediately and this reconciles: the server
 * answers with a freshly recomputed summary, so XP, the streak and the boss
 * all settle within the same tap rather than on the next poll. A failure puts
 * the quest back where it was — a check that silently didn't save is the one
 * bug that would make the whole page untrustworthy.
 */
export async function setQuestDone(checkId, done) {
  const state = forgeStore.get();
  if (!state.summary) return;

  const weekKey = state.summary.weekKey;
  const pending = new Set(state.pending);
  pending.add(checkId);

  // Optimistic: the tap has to feel instant on a panel this slow.
  forgeStore.set({
    pending,
    summary: withQuestDone(state.summary, checkId, done)
  });

  try {
    const response = await fetch('/api/forge/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekKey, checkId, done })
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || `Forge API ${response.status}`);
    }
    applySnapshot(await response.json());
  } catch (err) {
    forgeStore.set({
      summary: withQuestDone(forgeStore.get().summary, checkId, !done),
      error: err.message
    });
  } finally {
    const next = new Set(forgeStore.get().pending);
    next.delete(checkId);
    forgeStore.set({ pending: next });
  }
}

/**
 * The same summary with one quest flipped, and the counts that depend on it
 * brought along. Only what the eye checks first is recomputed — XP, level and
 * boss HP come back from the server a moment later.
 */
function withQuestDone(summary, checkId, done) {
  if (!summary) return summary;

  const quests = summary.today.quests.map((quest) =>
    quest.checkId === checkId ? { ...quest, done } : quest
  );
  const completed = quests.filter((quest) => quest.done).length;

  return {
    ...summary,
    today: {
      ...summary.today,
      quests,
      done: completed,
      total: quests.length,
      pct: quests.length ? Math.round((completed / quests.length) * 100) : 0,
      minutesLeft: quests.filter((q) => !q.done).reduce((n, q) => n + q.minutes, 0)
    }
  };
}

export function startForge() {
  poller = createPoller(
    async () => {
      try {
        await fetchSummary();
      } catch (err) {
        // Whatever is on screen stays on screen and goes visibly stale; only
        // a cold start shows the error state.
        if (forgeStore.get().status === 'loading') {
          forgeStore.set({ status: 'error', error: err.message });
        } else {
          forgeStore.set({ error: err.message, stale: true });
        }
        throw err;
      }
    },
    { interval: CONFIG.dashboard.forgePollInterval }
  );

  poller.start();
  return poller;
}
