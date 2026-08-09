// /track — what changed, and where.
//
//   ?at=/three-js/lib          scope: only changes under this address
//   &kind=seal,version         facets: which kinds of change to show
//   &sort=when:desc            column and direction
//
// VERBS, NOT OBJECT TYPES.
// ════════════════════════
// This listed `seal / version / proposal` for a while, and those are the
// names of RECORDS, not of anything anybody did. Reading it told you what
// kind of row you were looking at and not what happened, which is the one
// thing a change list owes you.
//
// So every row is an action, in the past tense:
//
//   saved       a settled edit was sealed — the tier-2 history
//   auto-saved  the watcher published that save as `-dev.N`, unasked
//   published   somebody cut an immutable version on purpose
//   released    a dist-tag moved onto one. No bytes copied; a name changed.
//   proposed    a fork was put forward against upstream
//   rebased     the daemon re-merged a proposal onto newer upstream
//   conflicted  a merge stopped and wrote NOTHING
//
// The distinction that matters most is `auto-saved` against `published`:
// one is a keystroke that stopped moving, the other is a decision. They are
// both immutable versions and they are not the same event.
//
// Two more verbs — `vendored` and `forked` — are missing, and honestly so:
// telling them apart needs `vendoredFrom` / `forkedFrom`, which live inside
// each deck's importmap and would cost one request per deck to read. They
// belong in `/_packages`; until they are there, this does not guess.
//
// SCOPE IS THE POINT. Not everything that happened: everything that happened
// under THIS address, plus the forks related to it. An unscoped change river
// is a feed, and nobody reads a feed of their own repository.
//
// Every row deep-links into /browse with `?at=` and `?vs=` already set, so
// "what changed" hands off to "show me" without the two apps sharing a line
// of code. They compose through the URL, which is the same joint everything
// else here uses.
import 'ui/nav';
import { installNavStyles } from 'ui/nav';
import { QueryClient } from '@tanstack/query-core';
import {
  constructTable,
  createCoreRowModel,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/dist/store-reactivity-bindings.js';

installNavStyles();

const app = document.getElementById('app');
const keys = document.querySelector('deck-keys');

const esc = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

// ---------------------------------------------------------------------------
// Fetching
//
// /track asks every mounted depot for its seal log, its version list and its
// offers queue, and several facets ask for the same thing at once. That is
// what a query cache is for. `staleTime` is short rather than zero because
// the live badge already reports when something changed — the cache exists to
// stop one render fanning out ten identical requests, not to hide staleness.
// ---------------------------------------------------------------------------

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: false, gcTime: 60_000 } },
});

const fetchJson = async (url) => {
  let response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    let body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body?.errors?.[0]?.detail ?? response.statusText), {
      code: body?.errors?.[0]?.code ?? String(response.status),
    });
  }
  return response.json();
};

const query = (key, url) =>
  client.fetchQuery({ queryKey: key, queryFn: () => fetchJson(url) });

// ---------------------------------------------------------------------------
// Collecting the three kinds
// ---------------------------------------------------------------------------

const HISTORY = '_history';

/** `/depot/publisher/package` → the parts, for scoping. */
function parseAddress(at) {
  let clean = (at ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean) return {};
  let [depot, publisher, pkg] = clean.split('/');
  return { depot, publisher, pkg: pkg?.split('@')[0] };
}

async function collect(scope) {
  let { data: depots } = await query(['packages'], '/_packages');
  let wanted = depots.filter((depot) => !scope.depot || depot.name === scope.depot);
  let rows = [];

  await Promise.all(
    wanted.map(async (depot) => {
      // ── versions ──────────────────────────────────────────────────────
      for (let deck of depot.packages) {
        for (let [version, record] of Object.entries(deck.versions ?? {})) {
          rows.push({
            kind: isDev(version)
              ? 'auto-saved'
              : Object.values(deck.distTags ?? {}).includes(version)
                ? 'released'
                : 'published',
            depot: depot.name,
            publisher: deck.publisher,
            pkg: deck.name,
            id: version,
            what: version,
            when: '',
            treeHash: record.treeHash,
            at: `/${depot.name}/${deck.publisher}/${deck.name}@${version}`,
            // A version's natural comparison is the one before it.
            vs: previousVersion(deck, version),
          });
        }
      }

      // ── seals ─────────────────────────────────────────────────────────
      if (depot.history) {
        let seals = await query([depot.name, 'history'], `/${depot.name}/${HISTORY}`)
          .then((body) => body.data)
          .catch(() => []);
        seals.forEach((seal, index) => {
          let attrs = seal.attributes;
          let touched = (attrs.filesSummary ?? []).map((line) =>
            line.replace(/^[A-Z]\s+/, ''),
          );
          // The subject of a save is the DECK it landed in, not the list of
          // files — that list is the second line's job, and printing it
          // twice made the first line unreadable and the second redundant.
          let decks = [
            ...new Set(touched.map((path) => path.split('/').slice(0, 2).join('/'))),
          ];
          rows.push({
            kind: 'saved',
            depot: depot.name,
            publisher: touched[0]?.split('/')[0] ?? '',
            pkg: touched[0]?.split('/')[1] ?? '',
            id: attrs.changeId,
            what:
              decks.length === 1
                ? decks[0]
                : `${touched.length} files across ${decks.length} decks`,
            when: attrs.timestamp ?? '',
            files: touched,
            at: `/${depot.name}/${HISTORY}/${attrs.changeId}`,
            // The seal before this one: what this save changed.
            vs: seals[index + 1]
              ? `/${depot.name}/${HISTORY}/${seals[index + 1].attributes.changeId}`
              : '',
          });
        });
      }

      // ── proposals ─────────────────────────────────────────────────────
      let offers = await query([depot.name, 'offers'], `/${depot.name}/_offers`)
        .then((body) => body.data)
        .catch(() => []);
      for (let offer of offers) {
        let attrs = offer.attributes;
        let [publisher, pkg] = String(attrs.offer ?? '').split('/');
        rows.push({
          kind:
            attrs.state === 'conflicted'
              ? 'conflicted'
              : attrs.state === 'rebased'
                ? 'rebased'
                : 'proposed',
          depot: depot.name,
          publisher: publisher ?? '',
          pkg: pkg?.split('@')[0] ?? '',
          id: attrs.offer,
          what: `${attrs.state ?? 'open'} · against ${attrs.upstream ?? ''}`,
          state: attrs.state,
          when: '',
          at: `/${depot.name}/${attrs.offer}`,
          vs: attrs.upstream ? `/${depot.name}/${attrs.upstream}` : '',
          tryWith: attrs.tryWith,
        });
      }
    }),
  );

  return rows.filter((row) => inScope(row, scope));
}

function previousVersion(deck, version) {
  let all = Object.keys(deck.versions ?? {}).sort();
  let index = all.indexOf(version);
  return index > 0
    ? `/${deck.id.split('/')[0]}/${deck.publisher}/${deck.name}@${all[index - 1]}`
    : '';
}

/**
 * In scope when the change touches this address — or when it is a RELATED
 * FORK of it. Same package name under another publisher is the fork boundary,
 * so scoping to `lib/three` and seeing nothing from `me/three` would hide the
 * exact thing you scoped in order to watch.
 */
function inScope(row, scope) {
  if (scope.depot && row.depot !== scope.depot) return false;
  if (scope.pkg) return row.pkg === scope.pkg;
  if (scope.publisher) return row.publisher === scope.publisher;
  return true;
}

// ---------------------------------------------------------------------------
// Facets and sorting
// ---------------------------------------------------------------------------

// `auto-saved` is OFF by default. The watcher emits one per settled save —
// hundreds in an afternoon — and they bury every deliberate act under a wall
// of `0.1.0-dev.147`. Nothing is hidden: it is one keypress, and the count is
// always on the facet.
const KINDS = ['saved', 'auto-saved', 'published', 'released', 'proposed'];
const DEFAULT_KINDS = ['saved', 'published', 'released', 'proposed'];

const isDev = (version) => /-dev\.\d+$/.test(version);

/** Relative time, in the smallest unit that still reads as a number. */
function ago(timestamp) {
  if (!timestamp) return '';
  let then = Date.parse(timestamp);
  if (Number.isNaN(then)) return '';
  let seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.round(seconds / 86400)}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/**
 * How recent, from 1 (this minute) to 0 (a day or more).
 *
 * Recency is rendered as brightness rather than as a badge: the feed fades
 * from the present into the past, so "something just happened" is legible
 * from across the room without reading a single timestamp, and stops being
 * legible on its own schedule instead of when somebody dismisses it.
 */
function freshness(timestamp) {
  let then = Date.parse(timestamp ?? '');
  if (Number.isNaN(then)) return 0;
  let hours = (Date.now() - then) / 3_600_000;
  if (hours <= 0.0833) return 1;      // last five minutes
  if (hours >= 24) return 0;
  return Math.max(0, 1 - Math.log10(1 + hours * 9) / Math.log10(1 + 24 * 9));
}

const params = () => new URLSearchParams(location.search);
const currentAt = () => params().get('at') ?? '';
const currentKinds = () => {
  let raw = params().get('kind');
  return raw ? raw.split(',').filter((kind) => KINDS.includes(kind)) : DEFAULT_KINDS;
};
const currentSort = () => params().get('sort') ?? '';

function go(next = {}) {
  let query$ = new URLSearchParams();
  let at = 'at' in next ? next.at : currentAt();
  let kinds = 'kind' in next ? next.kind : currentKinds();
  let sort = 'sort' in next ? next.sort : currentSort();
  if (at) query$.set('at', at);
  if (kinds.join(',') !== DEFAULT_KINDS.join(',')) query$.set('kind', kinds.join(','));
  if (sort) query$.set('sort', sort);
  let text = query$.toString();
  history.pushState({}, '', text ? `?${decodeURIComponent(text)}` : location.pathname);
  render();
}

const COLUMNS = [
  { id: 'kind', label: 'kind', accessorKey: 'kind' },
  { id: 'when', label: 'when', accessorKey: 'when' },
  { id: 'where', label: 'where', accessorKey: 'pkg' },
  { id: 'what', label: 'what', accessorKey: 'what' },
];

function sortRows(rows) {
  let [id, direction] = (currentSort() || 'when:desc').split(':');
  let sorting = [{ id, desc: direction === 'desc' }];
  let table = constructTable({
    features: tableFeatures({
      coreReactivityFeature: storeReactivityBindings(),
      rowSortingFeature,
      coreRowModel: createCoreRowModel(),
      sortedRowModel: createSortedRowModel(),
    }),
    data: rows,
    columns: COLUMNS,
    state: { sorting },
    onStateChange: () => {},
  });
  return { rows: table.getRowModel().rows.map((row) => row.original), sorting };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const MARK = {
  saved: '·',
  'auto-saved': '·',
  published: '▲',
  released: '★',
  proposed: '◆',
  rebased: '◆',
  conflicted: '✕',
};

function facets(rows, kinds) {
  let counts = Object.fromEntries(
    KINDS.map((kind) => [kind, rows.filter((row) => row.kind === kind).length]),
  );
  return (
    `<div class="facets">` +
    KINDS.map(
      (kind) =>
        `<button class="facet" data-role="facet" value="${kind}"` +
        `${kinds.includes(kind) ? ' aria-pressed="true"' : ''} data-kind="${kind}">` +
        `<i>${MARK[kind]}</i>${kind}<b>${counts[kind]}</b></button>`,
    ).join('') +
    `</div>`
  );
}

function scopeBar(scope, at) {
  let trail = [['everything', '']];
  if (scope.depot) trail.push([scope.depot, `/${scope.depot}`]);
  if (scope.publisher)
    trail.push([scope.publisher, `/${scope.depot}/${scope.publisher}`]);
  if (scope.pkg) trail.push([scope.pkg, at]);
  return (
    `<div class="prompt"><span class="prompt-mark">deck track</span> ` +
    trail
      .map(([label, value], index) =>
        index === trail.length - 1
          ? `<b>${esc(label)}</b>`
          : `<a href="?at=${esc(value)}" data-at="${esc(value)}">${esc(label)}</a>`,
      )
      .join('<span class="sep">/</span>') +
    `</div>`
  );
}

/**
 * A feed entry, two lines.
 *
 * One line per row could not carry this: the act, the thing it happened to,
 * when, how big it was, and the way through to seeing it. Cramming those into
 * columns made every one of them abbreviated and none of them scannable.
 *
 *   line 1   WHEN · VERB · the subject                    → the handoff
 *   line 2   where it lives · what it touched
 *
 * The first line answers "what happened", the second "to what", and the eye
 * only descends to the second when the first is interesting.
 */
function entry(row) {
  let fresh = freshness(row.when);
  let browse = row.vs ? `/browse?at=${row.at}&vs=${row.vs}` : `/browse?at=${row.at}`;
  let detail =
    row.files?.length
      ? row.files
          .slice(0, 3)
          .map((path) => path.split('/').slice(2).join('/') || path)
          .join(' · ') +
        (row.files.length > 3 ? ` <span class="dim">+${row.files.length - 3}</span>` : '')
      : row.detail ?? '';
  return (
    `<li class="entry" data-kind="${esc(row.kind)}" style="--fresh:${fresh.toFixed(3)}" ` +
    `data-name="${esc(
      `${row.kind} ${row.depot} ${row.publisher} ${row.pkg} ${row.what}`.toLowerCase(),
    )}">` +
    `<div class="entry-when">${esc(ago(row.when)) || '<span class="dim">—</span>'}</div>` +
    `<div class="entry-main">` +
    `<div class="entry-head">` +
    `<span class="verb"><i>${MARK[row.kind] ?? '·'}</i>${esc(row.kind)}</span> ` +
    `<span class="s-package">${esc(row.what)}</span>` +
    `</div>` +
    `<div class="entry-sub">` +
    `<span class="s-depot">${esc(row.depot)}</span>` +
    (row.publisher
      ? `<span class="sep">/</span><span class="s-publisher">${esc(row.publisher)}</span>`
      : '') +
    (row.pkg
      ? `<span class="sep">/</span><span class="s-package">${esc(row.pkg)}</span>`
      : '') +
    (detail ? ` <span class="dim">${detail}</span>` : '') +
    `</div></div>` +
    `<a class="entry-go" href="${esc(browse)}">${row.vs ? 'diff' : 'open'} →</a>` +
    `</li>`
  );
}

const SORTS = [
  ['when:desc', 'newest'],
  ['when:asc', 'oldest'],
  ['where:asc', 'where'],
  ['kind:asc', 'action'],
];

function sortBar(current) {
  return (
    `<span class="sortbar"><label>sort</label> <select data-role="sort">` +
    SORTS.map(
      ([value, label]) =>
        `<option value="${value}"${value === (current || 'when:desc') ? ' selected' : ''}>` +
        `${label}</option>`,
    ).join('') +
    `</select></span>`
  );
}

async function render() {
  let at = currentAt();
  let scope = parseAddress(at);
  let kinds = currentKinds();
  app.innerHTML = `<main><p class="dim">collecting…</p></main>`;
  try {
    let all = await collect(scope);
    let filtered = all.filter((row) => kinds.includes(row.kind));
    let { rows, sorting } = sortRows(filtered);
    app.innerHTML =
      scopeBar(scope, at) +
      `<main>` +
      `<div class="controls">` + facets(all, kinds) + sortBar(currentSort()) + `</div>` +
      (rows.length >= 25
        ? `<div class="filter"><b>filter</b> <input type="search" data-role="filter" ` +
          `size="24" placeholder="${rows.length} changes" autocomplete="off" /> ` +
          `<span class="dim" data-role="filter-count"></span></div>`
        : '') +
      (rows.length
        ? `<ul class="feed">${rows.map(entry).join('')}</ul>`
        : `<p class="dim">nothing here</p>`) +
      `</main>`;
  } catch (error) {
    app.innerHTML =
      `<main><div class="err"><b>${esc(error.code ?? 'error')}</b> — ` +
      `${esc(error.message)}</div></main>`;
  }
  cursor = -1;
  keys.keys = bindings();
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

let cursor = -1;
const rows$ = () => [...app.querySelectorAll('.entry:not([hidden])')];

function moveCursor(delta, absolute) {
  let all = rows$();
  if (!all.length) return;
  for (let row of all) delete row.dataset.here;
  cursor =
    absolute === 'first'
      ? 0
      : absolute === 'last'
        ? all.length - 1
        : Math.max(0, Math.min(all.length - 1, cursor + delta));
  all[cursor].dataset.here = '1';
  all[cursor].scrollIntoView({ block: 'nearest' });
}

function bindings() {
  let list = [[['j', 'k'], 'move'], ['↵', 'diff']];
  if (app.querySelector('[data-role="filter"]')) list.push(['/', 'filter']);
  list.push(
    [['s', 'v', 'p'], 'facets'],
    [['g', 'G'], 'ends'],
    ['u', 'widen'],
  );
  return list;
}

const FACET_KEY = { s: 'seal', v: 'version', p: 'proposal' };

function toggleFacet(kind) {
  let kinds = currentKinds();
  go({
    kind: kinds.includes(kind)
      ? kinds.filter((value) => value !== kind)
      : [...kinds, kind],
  });
}

addEventListener('popstate', render);

addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  let tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    if (event.key === 'Escape') document.activeElement.blur();
    return;
  }
  if (FACET_KEY[event.key]) return toggleFacet(FACET_KEY[event.key]);
  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      event.preventDefault();
      return moveCursor(1);
    case 'k':
    case 'ArrowUp':
      event.preventDefault();
      return moveCursor(-1);
    case 'g':
      return moveCursor(0, 'first');
    case 'G':
      return moveCursor(0, 'last');
    case 'Enter': {
      let link = rows$()[cursor]?.querySelector('.entry-go');
      if (link) location.href = link.getAttribute('href');
      return;
    }
    case 'u': {
      let scope = parseAddress(currentAt());
      return go({
        at: scope.pkg
          ? `/${scope.depot}/${scope.publisher}`
          : scope.publisher
            ? `/${scope.depot}`
            : '',
      });
    }
    case '/': {
      let filter = app.querySelector('[data-role="filter"]');
      if (filter) {
        event.preventDefault();
        filter.focus();
      }
      return;
    }
    default:
  }
});

app.addEventListener('click', (event) => {
  let facet = event.target.closest('[data-role="facet"]');
  if (facet) return toggleFacet(facet.value);
  let link = event.target.closest('a[data-at]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  go({ at: link.dataset.at });
});

app.addEventListener('change', (event) => {
  if (event.target.dataset.role === 'sort') go({ sort: event.target.value });
});

app.addEventListener('input', (event) => {
  if (event.target.dataset.role !== 'filter') return;
  let needle = event.target.value.trim().toLowerCase();
  let shown = 0;
  for (let row of app.querySelectorAll('.entry[data-name]')) {
    let hit = !needle || row.dataset.name.includes(needle);
    row.hidden = !hit;
    if (hit) shown += 1;
  }
  let readout = app.querySelector('[data-role="filter-count"]');
  if (readout) readout.textContent = needle ? `${shown} shown` : '';
});

render();
