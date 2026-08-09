// /track — what changed, and where.
//
//   ?at=/three-js/lib          scope: only changes under this address
//   &kind=seal,version         facets: which kinds of change to show
//   &sort=when:desc            column and direction
//
// THREE KINDS OF CHANGE, ONE LIST.
// ════════════════════════════════
// A depot records change in three places and they are usually three screens:
//
//   seal      every save, published or not — the tier-2 history
//   version   a published, immutable state — a decision, not a save
//   proposal  a fork that records what it forked, waiting on somebody
//
// They are the same question asked at three velocities, so they belong in one
// list with a facet rather than in three tabs. A seal is what happened, a
// version is what was decided, and a proposal is what somebody else wants —
// and "what changed here lately" spans all three or answers nothing.
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
            kind: isDev(version) ? 'dev' : 'version',
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
          rows.push({
            kind: 'seal',
            depot: depot.name,
            publisher: touched[0]?.split('/')[0] ?? '',
            pkg: touched[0]?.split('/')[1] ?? '',
            id: attrs.changeId,
            what: (attrs.description ?? '').replace(/^save:\s*/, ''),
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
          kind: 'proposal',
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

// Four facets, and `dev` is OFF by default.
//
// Auto-published `-dev.N` prereleases are the watcher doing its job: one per
// settled save, hundreds within an afternoon. They are real and worth keeping
// — that is the point of tier-2 — but as list rows they bury every release
// and every proposal under a wall of `0.1.0-dev.147`. A release is a
// decision; a dev prerelease is a keystroke that stopped moving.
//
// So they are their own facet rather than filtered out: nothing is hidden,
// and the default view is the one where every row earned its place.
const KINDS = ['seal', 'version', 'dev', 'proposal'];
const DEFAULT_KINDS = ['seal', 'version', 'proposal'];

const isDev = (version) => /-dev\.\d+$/.test(version);

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
  let [id, direction] = currentSort().split(':');
  let sorting = id ? [{ id, desc: direction === 'desc' }] : [];
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

const MARK = { seal: '·', version: '▲', dev: '△', proposal: '◆' };

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

function head(sorting) {
  let active = sorting[0];
  return (
    `<thead><tr>` +
    COLUMNS.map(
      (column) =>
        `<th data-role="sort" data-column="${column.id}" tabindex="0">${esc(column.label)}` +
        `<i class="sortmark">${
          active?.id === column.id ? (active.desc ? '↓' : '↑') : '⇅'
        }</i></th>`,
    ).join('') +
    `<th>compare</th></tr></thead>`
  );
}

function body(rows) {
  return rows
    .map((row) => {
      let browse = row.vs
        ? `/browse?at=${row.at}&vs=${row.vs}`
        : `/browse?at=${row.at}`;
      return (
        `<tr data-kind="${row.kind}" data-name="${esc(
          `${row.kind} ${row.depot} ${row.publisher} ${row.pkg} ${row.what}`.toLowerCase(),
        )}">` +
        `<td class="mark"><i>${MARK[row.kind]}</i> ${row.kind}</td>` +
        `<td class="dim">${esc((row.when ?? '').slice(0, 16).replace('T', ' '))}</td>` +
        `<td><span class="s-depot">${esc(row.depot)}</span>` +
        (row.publisher
          ? `<span class="sep">/</span><span class="s-publisher">${esc(row.publisher)}</span>`
          : '') +
        (row.pkg
          ? `<span class="sep">/</span><span class="s-package">${esc(row.pkg)}</span>`
          : '') +
        `</td>` +
        `<td>${esc(row.what)}${
          row.files?.length > 1 ? ` <span class="dim">+${row.files.length - 1}</span>` : ''
        }</td>` +
        // The handoff: /track says what changed, /browse shows it.
        `<td><a href="${esc(browse)}">${row.vs ? 'diff' : 'open'} →</a></td></tr>`
      );
    })
    .join('');
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
      facets(all, kinds) +
      (rows.length >= 25
        ? `<div class="filter"><b>filter</b> <input type="search" data-role="filter" ` +
          `size="24" placeholder="${rows.length} changes" autocomplete="off" /> ` +
          `<span class="dim" data-role="filter-count"></span></div>`
        : '') +
      (rows.length
        ? `<table class="track">${head(sorting)}<tbody>${body(rows)}</tbody></table>`
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
const rows$ = () => [...app.querySelectorAll('tbody tr:not([hidden])')];

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
      let link = rows$()[cursor]?.querySelector('td:last-child a');
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
  let sort = event.target.closest('th[data-role="sort"]');
  if (sort) {
    let [id, direction] = currentSort().split(':');
    let column = sort.dataset.column;
    return go({
      sort:
        id !== column ? `${column}:asc` : direction === 'asc' ? `${column}:desc` : '',
    });
  }
  let link = event.target.closest('a[data-at]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  go({ at: link.dataset.at });
});

app.addEventListener('input', (event) => {
  if (event.target.dataset.role !== 'filter') return;
  let needle = event.target.value.trim().toLowerCase();
  let shown = 0;
  for (let row of app.querySelectorAll('tbody tr[data-name]')) {
    let hit = !needle || row.dataset.name.includes(needle);
    row.hidden = !hit;
    if (hit) shown += 1;
  }
  let readout = app.querySelector('[data-role="filter-count"]');
  if (readout) readout.textContent = needle ? `${shown} shown` : '';
});

render();
