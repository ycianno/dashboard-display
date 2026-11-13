// ══════════════════════════════════════════════════════════════════════════
// Today — The Forge
//
// This page is a second face for a game, so it is dressed like one. The Forge
// itself is amber and ember on warm black, and a panel that renders the same
// data in the dashboard's cool grey reads as a report about the game rather
// than a part of it. The palette here is scoped to this view: the rest of the
// dashboard keeps taking its accent from the album art.
//
// The character sheet sits in the top half, where this panel's glass is dead:
// level, rank, attributes and the week's boss are all read, never pressed.
// Today's quests live in the bottom half, where touch still works, because
// they are the only thing on this page you actually do.
// ══════════════════════════════════════════════════════════════════════════

import { $, esc, icon } from '../util.js';
import { forgeStore } from '../store.js';
import { setQuestDone } from '../forge-client.js';

function minutes(total) {
  if (!total) return '';
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** "6:30 AM" from the "06:30" The Forge stores. */
function clockLabel(value) {
  if (!value) return '';
  const [h, m] = String(value).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

function minutesSinceMidnight(value) {
  if (!value) return null;
  const [h, m] = String(value).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

/** The attribute tag The Forge puts on every row, in that attribute's colour. */
function attrTag(attr, color) {
  return `
    <span class="fg-attr-tag" style="--tag:${esc(color)}">
      <i></i>${esc(String(attr).toUpperCase())}
    </span>`;
}

function bar(pct, className = '') {
  return `<span class="fg-bar ${className}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span>`;
}


/**
 * The shape — a wedge per attribute, ported from The Forge's own radar so the
 * panel draws the same figure the app does. Presentation only: it reads the
 * levels the engine already worked out and never computes one.
 *
 * Level 0 still has to be visible or the shape collapses to a dot, so 0.2 is
 * the floor of the normalised radius — a floor, not a score.
 */
function shapeSvg(attrs) {
  const W = 272;
  const H = 232;
  const cx = 136;
  const cy = 118;
  const R = 82;
  const gap = 18;
  const n = attrs.length;
  const maxLevel = Math.max(1, ...attrs.map((a) => a.level));

  const ang = (i) => ((-90 + (360 / n) * i) * Math.PI) / 180;
  const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
  const f1 = (v) => v.toFixed(1);

  const grid = [0.34, 0.67, 1]
    .map((f) => {
      const pts = attrs.map((_, i) => pt(i, R * f).map(f1).join(',')).join(' ');
      return `<polygon points="${pts}" fill="none" />`;
    })
    .join('');

  const spokes = attrs
    .map((_, i) => {
      const [x, y] = pt(i, R);
      return `<line x1="${cx}" y1="${cy}" x2="${f1(x)}" y2="${f1(y)}" />`;
    })
    .join('');

  const norm = (a) => 0.2 + 0.8 * (a.level / maxLevel);
  const dp = attrs.map((a, i) => pt(i, R * norm(a)));
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  let wedges = '';
  let dots = '';
  let labels = '';

  attrs.forEach((a, i) => {
    // Centre → midpoint of the edge behind → this vertex → midpoint ahead.
    // That is genuinely this attribute's share of the shape.
    const prev = mid(dp[(i - 1 + n) % n], dp[i]);
    const next = mid(dp[i], dp[(i + 1) % n]);
    wedges += `<path d="M${cx},${cy} L${f1(prev[0])},${f1(prev[1])} L${f1(dp[i][0])},${f1(dp[i][1])} L${f1(next[0])},${f1(next[1])} Z" fill="${esc(a.color)}" opacity="0.45" />`;
    dots += `<circle cx="${f1(dp[i][0])}" cy="${f1(dp[i][1])}" r="4" fill="${esc(a.color)}" />`;

    const [lx, ly] = pt(i, R + gap);
    const anchor = lx < cx - 3 ? 'end' : lx > cx + 3 ? 'start' : 'middle';
    const dy = ly < cy - 3 ? '-2' : ly > cy + 3 ? '11' : '4';
    labels += `<text x="${f1(lx)}" y="${f1(ly)}" dy="${dy}" text-anchor="${anchor}" fill="${esc(a.color)}">${esc(a.key.toUpperCase())} ${a.level}</text>`;
  });

  const outline = dp.map((p) => p.map(f1).join(',')).join(' ');

  return `
    <svg viewBox="0 0 ${W} ${H}" class="fg-shape-svg" role="img" aria-label="Attribute shape">
      <g class="grid">${grid}${spokes}</g>
      ${wedges}
      <polygon class="outline" points="${outline}" />
      ${dots}
      <g class="labels">${labels}</g>
    </svg>`;
}

// The engine's category -> attribute mapping, needed only to name and colour
// the boss's weak spot. Mirrors ATTR_OF_CAT / ATTR_COLOR in modules.js.
const WEAK_ATTR = {
  discipline: 'Discipline',
  training: 'Body',
  study: 'Mind',
  protein: 'Vitality',
  project: 'Craft'
};

const WEAK_COLOR = {
  discipline: '#38bdf8',
  training: '#fb7185',
  study: '#a78bfa',
  protein: '#34d399',
  project: '#fbbf24'
};

const GRADES = [
  { key: 'platinum', label: 'Platinum', color: '#7fe3e0' },
  { key: 'gold', label: 'Gold', color: '#f2c14e' },
  { key: 'silver', label: 'Silver', color: '#c8d0dc' },
  { key: 'bronze', label: 'Bronze', color: '#c07a44' }
];

function renderSheet(summary) {
  const p = summary.profile;
  const boss = summary.boss;
  const t = summary.trophies;
  const next = p.rank.next;

  const pips = Array.from({ length: p.rank.of || 6 }, (_, i) =>
    `<i class="${i < p.rank.pips ? 'on' : ''}"></i>`
  ).join('');

  return `
    <div class="fg-char card">
      <!-- The orb's ring is the XP bar, so there is no second bar under it. -->
      <div class="fg-char-top">
        <div class="fg-orb" style="--pct:${Math.max(0, Math.min(100, p.pct))}">
          <span class="lvl tnum">${p.level}</span>
          <span class="cap">Level</span>
        </div>
        <div class="fg-char-id">
          <div class="fg-rank">
            ${esc(p.rank.name)} <span class="tier">${esc(p.rank.tier)}</span>
          </div>
          <div class="fg-pips">${pips}</div>
          <span class="fg-xp-to tnum">${Math.max(0, p.xpForNext - p.xpIntoLevel)} XP to level ${p.level + 1}</span>
        </div>
      </div>

      <div class="fg-char-foot">
        ${
          next
            ? `<div class="fg-rung">
                 <span class="eyebrow">Next rung</span>
                 <span class="name">${esc(next.name)}</span>
                 <span class="away">${next.levelsAway} level${next.levelsAway === 1 ? '' : 's'} away · Lv ${next.level}</span>
               </div>`
            : ''
        }
        <div class="fg-chips">
          <span class="fg-chip">${icon('flame', 'ic ic-sm')}<b class="tnum">${summary.streak.day}</b> day${summary.streak.day === 1 ? '' : 's'}</span>
          <span class="fg-chip">${icon('check', 'ic ic-sm')}<b class="tnum">${summary.week.score}%</b> week</span>
          <span class="fg-chip">${icon('forge', 'ic ic-sm')}<b class="tnum">${p.lifetimeXp}</b> XP</span>
        </div>
      </div>
    </div>

    <div class="fg-shape card">
      <span class="eyebrow">The shape</span>
      ${shapeSvg(p.attrs)}
    </div>

    <div class="fg-boss card ${boss.defeated ? 'down' : ''}">
      <div class="fg-boss-head">
        <span class="eyebrow">Week's boss</span>
        ${
          boss.defeated
            ? ''
            : `<span class="fg-weak">
                 <span class="eyebrow">Weak to</span>
                 ${attrTag(WEAK_ATTR[boss.weak] || boss.weak, WEAK_COLOR[boss.weak] || 'var(--fire-2)')}
               </span>`
        }
      </div>
      <div class="fg-boss-name">${esc(boss.name)}</div>
      <div class="fg-boss-hp">
        <span class="n tnum">${boss.defeated ? '0' : boss.hp}<small>%</small></span>
        <span class="k">${boss.defeated ? 'Defeated' : 'HP left'}</span>
      </div>
      <span class="fg-bar hp"><i style="width:${boss.hp}%"></i></span>
      <div class="fg-boss-note">
        ${
          boss.defeated
            ? 'Put down for the week.'
            : boss.weakLeft
              ? `<b>${boss.weakLeft}</b> ${esc(boss.weak)} quest${boss.weakLeft === 1 ? '' : 's'} left — worth <b>${boss.weakLeftWorth}%</b> more damage.`
              : esc(boss.taunt)
        }
      </div>

      ${boss.taunt && !boss.defeated && boss.weakLeft ? `<div class="fg-taunt">“${esc(boss.taunt)}”</div>` : ''}
    </div>

    <div class="fg-cabinet card">
      <div class="fg-cab-head">
        <span class="eyebrow">Cabinet</span>
        <span class="total tnum">${t.total}</span>
      </div>

      <div class="fg-grades">
        ${GRADES.map(
          (g) => `
          <div class="fg-grade ${t[g.key] ? 'has' : ''}" style="--g:${g.color}">
            <span class="n tnum">${t[g.key] || 0}</span>
            <span class="k">${g.label}</span>
          </div>`
        ).join('')}
      </div>

      <div class="fg-insignias">
        ${icon('trophy', 'ic ic-sm')}
        <b class="tnum">${t.insignias}</b> insignia${t.insignias === 1 ? '' : 's'}
      </div>

      ${
        summary.records && summary.records.length
          ? `<div class="fg-records">
               ${summary.records
                 .slice(0, 3)
                 .map((r) => `<div class="fg-record truncate">${esc(r.title)}</div>`)
                 .join('')}
             </div>`
          : ''
      }
    </div>`;
}

function renderAgenda(summary, pending) {
  const today = summary.today;

  if (!today.total) {
    return `
      <div class="fg-empty">
        ${icon('forge')}
        <h3>Nothing scheduled today</h3>
        <p>Quests added in The Forge appear here the moment they're due.</p>
      </div>`;
  }

  const left = today.total - today.done;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // The list runs in two columns so a nine-quest day fits without scrolling,
  // which means a full-width "now" divider would land mid-row and read as
  // nonsense. The cue moves onto the quest itself instead: the next one still
  // ahead of you is ringed, and anything past its hour is flagged.
  const nextIndex = today.quests.findIndex((q) => {
    const at = minutesSinceMidnight(q.at);
    return !q.done && (at === null || at >= nowMinutes);
  });

  const rows = today.quests
    .map((quest, index) => {
      const at = minutesSinceMidnight(quest.at);
      const overdue = !quest.done && at !== null && at < nowMinutes;
      const isNext = index === nextIndex;

      return `
        <button class="fg-quest pressable ${quest.done ? 'done' : ''} ${isNext ? 'next' : ''} ${pending.has(quest.checkId) ? 'busy' : ''}"
                data-check="${esc(quest.checkId)}"
                style="--tag:${esc(quest.color)}"
                aria-pressed="${quest.done}">
          <span class="fg-when ${overdue ? 'late' : ''}">
            ${quest.at ? esc(clockLabel(quest.at)) : '—'}${overdue ? '<b>!</b>' : ''}
          </span>
          <span class="fg-tick">${icon('check', 'ic ic-sm')}</span>
          <span class="fg-quest-main">
            <span class="t truncate">${esc(quest.title)}</span>
            <span class="m">
              ${attrTag(quest.attr, quest.color)}
              ${quest.minutes ? `<span class="mins">${minutes(quest.minutes)}</span>` : ''}
            </span>
          </span>
          ${quest.xp ? `<span class="fg-xp-gain tnum">+${quest.xp}</span>` : ''}
          ${isNext ? '<span class="fg-next-flag">Next</span>' : ''}
        </button>`;
    })
    .join('');

  return `
    <div class="fg-agenda-head">
      <div class="fg-agenda-count">
        <span class="n tnum">${left}</span>
        <span class="cap">left${today.minutesLeft ? ` · ${minutes(today.minutesLeft)}` : ''}</span>
      </div>
      ${bar(today.pct, 'fire wide')}
      <span class="fg-agenda-pct tnum">${today.pct}%</span>
    </div>

    <div class="fg-quests" data-noswipe>${rows}</div>`;
}

export function initForge() {
  const sheet = $('#fg-sheet');
  const agenda = $('#fg-agenda');

  // The agenda is re-rendered wholesale on every store change, so the handler
  // is delegated once here rather than rebound to each row.
  agenda.addEventListener('click', (event) => {
    const row = event.target.closest('.fg-quest');
    if (!row || row.classList.contains('busy')) return;
    setQuestDone(row.dataset.check, !row.classList.contains('done'));
  });

  forgeStore.subscribe((state) => {
    // An empty card in the touch half is an invitation to press nothing.
    const showAgenda = state.status === 'ready' && !!state.summary;
    agenda.hidden = !showAgenda;
    sheet.classList.toggle('solo', !showAgenda);

    if (state.status === 'unconfigured') {
      sheet.innerHTML = `
        <div class="fg-setup card">
          ${icon('forge')}
          <h2>Connect The Forge</h2>
          <p>Add a <code>forge</code> block to <code>server.config.js</code> with your
             instance URL and a sync token, then restart the server.</p>
          <p class="dim">The token is generated in The Forge under Settings → Sync. It stays
             on this machine and is never sent to the browser.</p>
        </div>`;
      return;
    }

    if (state.status === 'loading') {
      sheet.innerHTML = `<div class="fg-setup card">${icon('forge')}<h2>Reaching The Forge…</h2></div>`;
      return;
    }

    if (!state.summary) {
      const outdated = state.reason === 'outdated';
      sheet.innerHTML = `
        <div class="fg-setup card">
          ${icon(outdated ? 'forge' : 'alert')}
          <h2>${outdated ? 'The Forge needs updating' : 'The Forge is unreachable'}</h2>
          <p>${esc(state.error || 'No response.')}</p>
          ${
            outdated
              ? `<p class="dim">The running build has no <code>/api/dashboard</code>. Publish a Forge
                 image from a branch that has it, then pull it on the host.</p>`
              : ''
          }
        </div>`;
      return;
    }

    sheet.innerHTML = renderSheet(state.summary);
    sheet.classList.toggle('stale', !!state.stale);
    agenda.innerHTML = renderAgenda(state.summary, state.pending);
  });
}
