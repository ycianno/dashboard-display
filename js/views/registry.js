// ══════════════════════════════════════════════════════════════════════════
// View registry
//
// One entry per page. `config.dashboard.views` picks which of them appear and
// in what order, so adding a page means adding a row here and its section to
// index.html — nothing in main.js, the router or the keyboard handler needs
// to learn about it.
//
// `el` is the section id in index.html; a view whose section is missing is
// skipped rather than breaking the deck.
// ══════════════════════════════════════════════════════════════════════════

import { initOverview } from './overview.js';
import { initNowPlaying } from './now-playing.js';
import { initInfra } from './infra.js';

export const VIEWS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: 'grid',
    el: 'view-overview',
    init: initOverview
  },
  {
    id: 'now-playing',
    label: 'Music',
    icon: 'note',
    el: 'view-now-playing',
    init: initNowPlaying
  },
  {
    id: 'infra',
    label: 'Servers',
    icon: 'server',
    el: 'view-infra',
    init: initInfra
  }
];

const BY_ID = new Map(VIEWS.map((view) => [view.id, view]));

/**
 * The configured pages, in configured order, minus any whose markup is
 * absent. Unknown ids in the config are ignored rather than fatal — a config
 * written for a later build still boots this one.
 */
export function resolveViews(ids) {
  return (ids || [])
    .map((id) => BY_ID.get(id))
    .filter((view) => view && document.getElementById(view.el));
}
