// The reviewer's console.
//
// It is an ordinary consumer of `std/currencies` — one import, no knowledge
// of forks or proposals. Everything that makes it a review tool comes from
// the server:
//
//   `?with=` rebinds that one import for one request, so the page runs
//   against a proposal without anything being checked out.
//
//   `/_offers` is the queue: every deck in the realm that records what it
//   forked, re-merged against upstream on read, with the ones that stopped
//   merging named.
import * as upstream from 'std/currencies';
import { installPillStyles, legend, pill } from 'ui/pills';

installPillStyles();

// The reviewer's fixed point: the RELEASED list, fetched directly at its
// immutable address. `?with=` cannot move this — that is the whole reason
// the diff below means something.
const BASELINE = '/site/std/currencies@1.4.0/currencies.json';

const [current, baseline, offers] = await Promise.all([
  upstream.currencies(),
  fetch(BASELINE).then((r) => r.json()),
  fetch('/site/_offers')
    .then((r) => r.json())
    .catch(() => ({ meta: {}, data: [] })),
]);

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What this view holds that the released list does not, and vice versa.
let rows = [...new Set([...Object.keys(baseline), ...Object.keys(current)])]
  .sort()
  .map((code) => {
    let was = baseline[code];
    let now = current[code];
    let state = !was ? 'added' : !now ? 'removed' : same(was, now) ? 'same' : 'changed';
    return { code, was, now, state };
  });
const counts = {
  added: rows.filter((r) => r.state === 'added').length,
  changed: rows.filter((r) => r.state === 'changed').length,
  removed: rows.filter((r) => r.state === 'removed').length,
};

// Where the module actually came from. This is the honest label: not what
// the query string asked for, but what the import map resolved to.
const sourceUrl = new URL(upstream.source).pathname;
const sourceLabel = sourceUrl.replace(/^\/site\//, '').replace(/\/index\.js$/, '');
const isBaselineView = counts.added + counts.changed + counts.removed === 0;

const VIEWS = [
  { label: 'the released list', query: '', hint: 'std/currencies@1.4.0' },
  { label: 'the next release', query: '?with=std/currencies@1.5.0', hint: 'a version, not a fork' },
  ...offers.data.map((offer) => ({
    label: `${offer.id.split('/')[0]}’s proposal`,
    query: offer.attributes.tryWith,
    hint: `live — every save, no publish`,
  })),
];
const here = location.pathname;
const activeQuery = location.search;

const STATE_NOTE = {
  current: 'nothing to absorb — the base is already what upstream published',
  rebased: 'upstream moved and the merge is clean; the daemon writes it back',
  conflicted: 'both sides changed the same thing — this one needs a person',
  unresolvable: 'the base tree is not in the store, so no three-way merge is possible',
};

let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
<header class="masthead">
  <div class="crumb">deck · example</div>
  <h1>Review a proposal without checking it out</h1>
  <p class="lede">
    This page imports <code>std/currencies</code> once and renders it. Every
    view below is the same sealed page, resolved against something different
    for one request.
  </p>
  <div class="namekey">
    ${legend(['deck'])}
    <p class="namenote">
      Every address here is a <em>Deck</em> address, and that is what makes the
      review possible: the released list, the next release, and both open
      proposals are all just URLs this realm answers. A proposal does not need
      to reach a registry or a repository to be reviewable — it only needs to
      exist at an address.
    </p>
  </div>
</header>

<nav class="views">
  ${VIEWS.map(
    (view) => `<a class="view ${view.query === activeQuery ? 'active' : ''}" href="${esc(here + view.query)}">
      <b>${esc(view.label)}</b><span>${esc(view.hint)}</span>
    </a>`,
  ).join('')}
</nav>

<section class="resolved">
  <div>
    <span class="k">resolved to</span>
    ${pill('deck', sourceLabel)}
  </div>
  <div>
    <span class="k">against the release</span>
    ${
      isBaselineView
        ? '<em>this is the release</em>'
        : `<b class="add">+${counts.added}</b> <b class="chg">~${counts.changed}</b> <b class="rem">−${counts.removed}</b>`
    }
  </div>
  <div><span class="k">codes</span><b>${Object.keys(current).length}</b></div>
</section>

<table>
  <thead><tr><th>code</th><th>name</th><th>minor</th><th></th></tr></thead>
  <tbody>
    ${rows
      .map(
        (row) => `<tr class="${row.state}">
      <td class="code">${esc(row.code)}</td>
      <td>${esc((row.now ?? row.was).name)}${
        row.state === 'changed' && row.was.name !== row.now.name
          ? `<span class="was">was ${esc(row.was.name)}</span>`
          : ''
      }</td>
      <td class="minor">${esc(String((row.now ?? row.was).minor))}${
        row.state === 'changed' && row.was.minor !== row.now.minor
          ? `<span class="was">was ${esc(String(row.was.minor))}</span>`
          : ''
      }</td>
      <td class="mark">${{ added: 'new', changed: 'changed', removed: 'dropped', same: '' }[row.state]}</td>
    </tr>`,
      )
      .join('')}
  </tbody>
</table>

<section class="queue">
  <h2>The queue <span class="quiet">/site/_offers</span></h2>
  <p class="note">
    Every deck in this realm that records what it forked. The server re-merges
    each one against upstream on read, so this is the current answer, not a
    stored status. A maintainer wants the ones that stopped merging — the rest
    do not need looking at.
  </p>
  ${
    offers.data.length === 0
      ? '<p class="note">No open proposals.</p>'
      : `<div class="offers">${offers.data
          .map((offer) => {
            let a = offer.attributes;
            return `<article class="offer ${esc(a.state)}">
        <div class="ohead">
          ${pill('deck', offer.id)}
          <span class="pill ${esc(a.state)}">${esc(a.state)}</span>
        </div>
        <p class="odetail">forked ${pill('deck', a.upstream)}${
          a.upstreamVersion ? ` · upstream is now ${pill('deck', `${a.upstream}@${a.upstreamVersion}`)}` : ''
        }</p>
        <p class="onote">${esc(STATE_NOTE[a.state] ?? a.detail ?? '')}</p>
        ${
          a.conflicts.length > 0
            ? `<p class="conflicts">conflicts: ${a.conflicts.map((c) => `<code>${esc(c)}</code>`).join(', ')}</p>`
            : ''
        }
        <a class="try" href="${esc(here + a.tryWith)}">run the app against it →</a>
      </article>`;
          })
          .join('')}</div>`
  }
</section>

<section class="explain">
  <h2>What just happened</h2>
  <p>
    A contribution here is not a diff and not a branch. It is a
    <strong>tree that exists</strong>, in the contributor's own publisher
    scope, which records the exact tree it forked. That single recorded
    <code>treeHash</code> is the third input a three-way merge needs, so the
    server can answer “does this still merge?” at any moment without a commit
    graph, a patch queue, or anyone rebasing anything.
  </p>
  <p>
    And because the proposal is already a tree at a URL, reviewing it is not a
    checkout — it is a different resolution of one import.
  </p>
</section>
`;

let style = document.createElement('style');
style.textContent = `
:root{
  --ink:#272330;--ink-body:#5a586a;--ink-quiet:#8b8b93;--ink-meta:#a2a2ab;
  --stage:#f7f8fa;--surface:#fff;--track:#eef0f4;--border:#e2e8f0;--hairline:#eceef1;
  --interactive:#0c9d7c;--attention:#d97706;--broken:#ff5050;--remix:#7c3aed;
  --shadow:0 2px 8px rgba(28,28,50,.05);--shadow-hi:0 10px 26px rgba(28,28,50,.11);
  --sans:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--stage);color:var(--ink);font-family:var(--sans);line-height:1.5}
#app{max-width:58rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
#app.loading{color:var(--ink-quiet)}
code{font-family:var(--mono);font-size:.86em}
.crumb{font:600 11px var(--sans);letter-spacing:.11em;text-transform:uppercase;color:var(--ink-meta)}
h1{margin:.4rem 0 .6rem;font-size:1.9rem;letter-spacing:-.02em}
h2{margin:2.5rem 0 .5rem;font-size:1.05rem}
h2 .quiet{font:400 .78rem var(--mono);color:var(--ink-meta);margin-left:.5rem}
.lede{margin:0 0 1.5rem;max-width:44rem;color:var(--ink-body)}
.note{margin:0 0 .9rem;max-width:46rem;color:var(--ink-body);font-size:.9rem}
.namekey{margin:0 0 1.25rem;padding:.85rem 1rem;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow)}
.namenote{margin:.6rem 0 0;font-size:.85rem;color:var(--ink-body);max-width:50rem;line-height:1.7}
.views{display:grid;gap:.6rem;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));margin-bottom:1.1rem}
.view{display:block;text-decoration:none;color:inherit;background:var(--surface);border:1px solid var(--border);
  border-radius:10px;padding:.7rem .85rem;box-shadow:var(--shadow);transition:box-shadow .18s,border-color .12s}
.view:hover{border-color:#cbd0d8;box-shadow:var(--shadow-hi)}
.view.active{border-color:var(--interactive);box-shadow:inset 3px 0 0 var(--interactive),var(--shadow)}
.view b{display:block;font-size:.92rem;font-weight:600}
.view span{color:var(--ink-quiet);font-size:.76rem;font-family:var(--mono)}
.resolved{display:flex;gap:2rem;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);
  border-radius:10px;padding:.75rem .95rem;margin-bottom:1rem;box-shadow:var(--shadow)}
.resolved .k{display:block;font:600 10.5px var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-meta)}
.resolved b{font-size:1.05rem}
.resolved em{color:var(--ink-quiet);font-style:normal;font-size:.9rem}
.add{color:var(--interactive)}.chg{color:var(--attention)}.rem{color:var(--broken)}
table{width:100%;border-collapse:collapse;font-size:.88rem;background:var(--surface);
  border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow)}
th{text-align:left;font:600 10.5px var(--sans);letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-meta);padding:.55rem .8rem;border-bottom:1px solid var(--hairline)}
td{padding:.5rem .8rem;border-bottom:1px solid var(--hairline)}
tr:last-child td{border-bottom:none}
.code{font-family:var(--mono);font-weight:600}
.minor{font-variant-numeric:tabular-nums;color:var(--ink-body)}
.was{margin-left:.5rem;font-size:.75rem;color:var(--ink-meta);text-decoration:line-through}
.mark{text-align:right;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600;color:var(--ink-meta)}
tr.added{background:#f2fbf7}tr.added .mark{color:var(--interactive)}
tr.changed{background:#fff9f2}tr.changed .mark{color:var(--attention)}
tr.removed{background:#fff1f1}tr.removed .mark{color:var(--broken)}
.offers{display:grid;gap:.7rem;grid-template-columns:repeat(auto-fit,minmax(19rem,1fr))}
.offer{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.85rem .95rem;box-shadow:var(--shadow)}
.offer.conflicted{border-color:#f6d6d6;background:#fffafa}
.ohead{display:flex;align-items:center;gap:.6rem}
.pill{margin-left:auto;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600;
  border-radius:999px;padding:.12rem .55rem;background:var(--track);color:var(--ink-quiet)}
.pill.rebased{background:#e9f8f2;color:#0a6d56}
.pill.current{background:#eef0f4;color:#5a586a}
.pill.conflicted{background:#ffe9e9;color:#9a1c1c}
.odetail{margin:.45rem 0 .2rem;font-size:.84rem;color:var(--ink-body)}
.onote{margin:0;font-size:.82rem;color:var(--ink-quiet)}
.conflicts{margin:.4rem 0 0;font-size:.82rem;color:#9a1c1c}
.try{display:inline-block;margin-top:.6rem;font-size:.84rem;color:var(--interactive);text-decoration:none;font-weight:600}
.try:hover{text-decoration:underline}
.explain p{max-width:46rem;color:var(--ink-body);font-size:.92rem}
.explain strong{color:var(--ink)}
`;
document.head.append(style);
