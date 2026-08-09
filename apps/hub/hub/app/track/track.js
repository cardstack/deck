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
//   saved       a settled edit was sealed as a Step on the Timeline
//   auto-saved  the watcher published that save as `-dev.N`, unasked
//   published   somebody cut an immutable version on purpose
//   released    a dist-tag moved onto one. No bytes copied; a name changed.
//   vendored    a version was taken from an upstream registry
//   proposed    a fork was put forward against upstream
//   rebased     the daemon re-merged a proposal onto newer upstream
//   conflicted  a merge stopped and wrote NOTHING
//
// The distinction that matters most is `auto-saved` against `published`:
// one is a keystroke that stopped moving, the other is a decision. They are
// both immutable versions and they are not the same event.
//
// `forked` is still missing, and honestly so: telling a fork apart needs
// `forkedFrom`, which lives inside each deck's importmap and would cost one
// request per deck to read. It belongs in `/_packages`; until it is there,
// this does not guess. `vendored` used to be missing for the same reason and
// no longer is — the store records the upstream coordinate and the upstream
// publish time, so the row can say it without opening anything.
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
import { installNavStyles, onLiveChange, wrapTables } from 'ui/nav';
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
const subject = document.querySelector('deck-subject');

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

/**
 * `/depot/publisher/package/some/dir/file.js` → the parts, for scoping.
 *
 * The tail used to be dropped, so deep-linking a FILE quietly widened to its
 * whole deck: `?at=/hub/app/run/run.js` and `?at=/hub/app/run` produced
 * identical feeds. A link that silently answers a broader question than the
 * one asked is worse than one that fails, because nothing on screen says so
 * — and "what happened to this file" is the most common thing anyone wants
 * from a change feed.
 */
function parseAddress(at) {
  let clean = (at ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean) return {};
  let [depot, publisher, pkgAndSpec, ...rest] = clean.split('/');
  return {
    depot,
    publisher,
    pkg: pkgAndSpec?.split('@')[0],
    path: rest.length ? rest.join('/') : undefined,
    // Depot-relative, which is the shape `filesSummary` speaks. The depot's
    // mount name is the server's business and never appears in a seal.
    within: [publisher, pkgAndSpec?.split('@')[0], ...rest]
      .filter(Boolean)
      .join('/'),
  };
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
            // `vendored` is now sayable. It used to be guesswork, because
            // telling a vendored version from a hand-cut one meant reading
            // `vendoredFrom` out of each deck's importmap — one request per
            // deck, to answer a question about a list. The store records the
            // upstream coordinate, `/_packages` reports it, and a version
            // that also carries an upstream publish time is one we took from
            // somewhere rather than one we cut.
            kind: record.upstreamPublishedAt
              ? 'vendored'
              : isDev(version)
                ? 'auto-published'
                : Object.values(deck.distTags ?? {}).includes(version)
                  ? 'released'
                  : 'published',
            depot: depot.name,
            publisher: deck.publisher,
            pkg: deck.name,
            id: version,
            what: version,
            // THE ROW'S OWN CLOCK, not the library's.
            //
            // Every other row here is dated by when the event happened on
            // this machine, and a vendored row is no different: what happened
            // was that we took it. Sorting these by npm's publish date would
            // interleave "we adopted three.js this morning" into 2021, where
            // nobody scanning a change feed would ever look for it.
            //
            // The upstream date is not lost — it is the second line, where it
            // reads as a property of the thing rather than as an event.
            when: record.publishedAt ?? '',
            upstreamWhen: record.upstreamPublishedAt,
            upstream: deck.upstream,
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
          // jj reports `A path` / `M path` / `D path` / `R old => new`, and
          // that letter is the difference between adding a file and editing
          // one. It used to be stripped, which threw away the only thing in
          // the summary that distinguishes two very different acts.
          let changes = (attrs.filesSummary ?? [])
            .map((line) => {
              let match = line.match(/^([AMDR])\s+(.*)$/);
              return match
                ? { how: match[1], path: match[2] }
                : { how: 'M', path: line };
            })
            // `.deck/` IS NOT CONTENT, wherever it turns up.
            //
            // It holds the store and the claim register — machinery with a
            // half-hour lifetime — and `.deck` is in DEFAULT_IGNORE precisely
            // so it never enters a tree. But auto-track only governs files
            // jj has not seen: a depot whose timeline was started outside
            // that config has them tracked already, and jj keeps tracking
            // what it tracks. Claims then churn into the feed as edits,
            // which is the exact opposite of the guarantee.
            //
            // Filtering here is the honest defence: whatever jj happens to
            // carry, a change to machinery is not a change to the work.
            .filter((change) => !change.path.startsWith('.deck/'));
          // A save that touched nothing else was pure machinery.
          if (!changes.length) return;
          let touched = changes.map((change) => change.path);
          let letters = new Set(changes.map((change) => change.how));
          // The subject of a save is the DECK it landed in, not the list of
          // files — that list is the second line's job, and printing it
          // twice made the first line unreadable and the second redundant.
          let decks = [
            ...new Set(touched.map((path) => path.split('/').slice(0, 2).join('/'))),
          ];
          rows.push({
            // One kind of change gets its own verb; a mix is a `saved`.
            kind:
              letters.size !== 1
                ? 'saved'
                : letters.has('A')
                  ? 'added'
                  : letters.has('D')
                    ? 'removed'
                    : letters.has('R')
                      ? 'renamed'
                      : 'edited',
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
            changes,
            // WHERE `diff →` LANDS.
            //
            // The row already knows two seals and a list of paths, and that
            // IS a diff — so it hands over the diff rather than an invitation
            // to go and find one. A save that touched a single file goes
            // straight to that file's before and after; a save that touched
            // several goes to the seal comparison, whose rows descend into
            // the same view one file at a time.
            //
            // Landing on the seal in both cases would throw away the most
            // specific thing the feed knows, which is usually the only thing
            // the reader wanted.
            at:
              touched.length === 1
                ? `/${depot.name}/${HISTORY}/${attrs.changeId}/${touched[0]}`
                : `/${depot.name}/${HISTORY}/${attrs.changeId}`,
            // The seal before this one is the before-state of this save.
            vs: seals[index + 1]
              ? touched.length === 1
                ? `/${depot.name}/${HISTORY}/${seals[index + 1].attributes.changeId}/${touched[0]}`
                : `/${depot.name}/${HISTORY}/${seals[index + 1].attributes.changeId}`
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
  // A path scope is answered by what the change TOUCHED, not by which deck it
  // was filed under. A Step touching six files across three decks is in scope
  // for any of them, and only the file list can say so.
  if (scope.path) {
    let files = row.files ?? (row.changes ?? []).map((change) => change.path);
    if (!files.length) {
      // Versions and offers carry no file list, so a path scope cannot
      // include them without guessing. Falling back to the deck would let a
      // publish of the whole package answer "what happened to this one
      // file", which is exactly the widening this scope exists to stop.
      return false;
    }
    return files.some(
      (path) => path === scope.within || path.startsWith(`${scope.within}/`),
    );
  }
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
// Every verb this feed can emit. `auto-saved` is the only one anybody wants
// to switch OFF, which is the whole argument for the control that replaced
// the five facets — see `controls()`.
const KINDS = [
  'added',
  'edited',
  'removed',
  'renamed',
  'saved',
  'auto-published',
  'published',
  'released',
  'vendored',
  'proposed',
  'rebased',
  'conflicted',
];
const NOISE = ['auto-published'];
const DEFAULT_KINDS = KINDS.filter((kind) => !NOISE.includes(kind));
const ATTENTION = ['conflicted', 'proposed'];

/** Grouping is on unless turned off; the URL carries the choice. */
const grouped = () => new URLSearchParams(location.search).get('group') !== '0';

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
  // Only the non-default is written, so a plain URL stays plain and a shared
  // link carries a choice only when one was actually made.
  let group = 'group' in next ? next.group : grouped() ? undefined : '0';
  if (at) query$.set('at', at);
  if (kinds.join(',') !== DEFAULT_KINDS.join(',')) query$.set('kind', kinds.join(','));
  if (sort) query$.set('sort', sort);
  if (group) query$.set('group', group);
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

const HOW = { A: 'added', M: 'edited', D: 'removed', R: 'renamed' };

const MARK = {
  added: '+',
  edited: '~',
  removed: '−',
  renamed: '→',
  saved: '·',
  'auto-published': '·',
  published: '▲',
  released: '★',
  vendored: '⤓',
  proposed: '◆',
  rebased: '◆',
  conflicted: '✕',
};

/**
 * THE FACETS WERE THE WRONG QUESTION.
 *
 * Five toggles — saved / auto-saved / published / released / proposed — asked
 * "which kind of record", and nobody wants that. In practice four of them
 * were always on and one was always off, so five controls carried one bit,
 * and the counts beside them (`proposed 0`, `published 1`) were furniture.
 *
 * What a reader of a change feed actually asks is two things:
 *
 *   is this noise?          the watcher's auto-saves, hundreds an afternoon
 *   does this need me?      a conflicted merge, an open proposal
 *
 * So: ONE switch for the noise, and the attention cases lifted OUT of the
 * feed into a band above it, where they can be acted on rather than scrolled
 * past. Everything else is reachable by typing in the filter, which handles
 * "just the releases" without spending a control on it.
 */
/**
 * SESSIONS, NOT SAVES — the default, because a save is not a unit of work.
 *
 * Thirty consecutive rows reading `edited vale/sale ~index.html · 17m ago` is
 * a correct feed and an unreadable one. Every row is true and none of them is
 * news; the thing that actually happened — "someone spent four minutes on the
 * sale page" — is not on screen at all, because it is the shape of the run
 * rather than any row in it.
 *
 * So consecutive changes to one deck collapse into one entry carrying the
 * span, the count and the distinct files. Consecutive in FEED order, so this
 * follows whatever sort is applied and never reorders anything to make a
 * group: two runs separated by work elsewhere stay two groups, which is
 * true — the person went away and came back.
 *
 * And a group's `diff →` is the best link in the app: newest state against
 * the state before the run began, which lands in the multi-file review. One
 * click from "someone worked on this for four minutes" to every line of it.
 *
 * Off with `s`, because sometimes you do want the tape.
 */
const GROUP_GAP_MS = 5 * 60 * 1000;

/**
 * ONLY THE HIGH-FREQUENCY KINDS GROUP.
 *
 * Steps arrive by the dozen while somebody is editing — that is the flood
 * this exists for. A Version is the opposite: rare, deliberate, and the
 * result of a decision somebody made on purpose. Folding two publishes into
 * "2 versions" would hide the only rows in the feed that were meant to be
 * individually noticed.
 *
 * `proposed` / `conflicted` never reach here — the attention band lifts them
 * out first — but they are listed anyway, because a set that says what it
 * excludes survives someone changing the band later.
 */
const GROUPABLE = new Set(['added', 'edited', 'removed', 'renamed', 'saved', 'auto-published']);

function groupRuns(rows) {
  let out = [];
  for (let row of rows) {
    let last = out.at(-1);
    let sameDeck =
      last &&
      GROUPABLE.has(row.kind) &&
      GROUPABLE.has(last.kind) &&
      last.depot === row.depot &&
      last.publisher === row.publisher &&
      last.pkg === row.pkg;
    let when = Date.parse(row.when ?? '');
    let lastWhen = last ? Date.parse(last.oldestWhen ?? last.when ?? '') : NaN;
    let close =
      Number.isFinite(when) &&
      Number.isFinite(lastWhen) &&
      Math.abs(lastWhen - when) < GROUP_GAP_MS;

    if (sameDeck && close) {
      last.count += 1;
      last.kinds.add(row.kind);
      for (let file of row.files ?? []) last.paths.add(file);
      // Feed order is newest-first, so each further row is OLDER: the group's
      // `vs` walks back with it, which is what makes the group diff span the
      // whole run rather than only its last save.
      last.oldestWhen = row.when;
      last.vs = row.vs;
      last.members.push(row);
      continue;
    }
    out.push({
      ...row,
      count: 1,
      kinds: new Set([row.kind]),
      paths: new Set(row.files ?? []),
      oldestWhen: row.when,
      members: [row],
    });
  }
  return out;
}

function controls(all, kinds) {
  let noise = all.filter((row) => NOISE.includes(row.kind)).length;
  let showing = kinds.includes('auto-published');
  return (
    `<div class="controls">` +
    (noise
      ? `<button class="switch" data-role="noise"${showing ? ' aria-pressed="true"' : ''}>` +
        `<i></i>auto-publishes <b>${noise}</b></button>`
      : '') +
    `<button class="switch" data-role="grouped"${grouped() ? ' aria-pressed="true"' : ''}>` +
    `<i></i>group runs</button>` +
    sortBar(currentSort()) +
    `</div>`
  );
}

/**
 * The band above the feed: everything that is waiting on a person.
 *
 * A conflicted merge wrote nothing and will stay that way until somebody
 * decides; an open proposal is somebody asking. Both are indistinguishable
 * from history once they are rows in a list sorted by time, which is exactly
 * where they get lost.
 */
function attention(rows) {
  let needs = rows.filter((row) => ATTENTION.includes(row.kind));
  if (!needs.length) return '';
  return (
    `<ul class="feed attention">` + needs.map(entry).join('') + `</ul>`
  );
}

/**
 * The scope, in the shared subject bar.
 *
 * `everything` is dropped from the trail here: with no scope there is no
 * subject and the bar does not draw at all, which says the same thing more
 * plainly than a word claiming to be an address. The classes match /browse's,
 * because the same address must be the same colours in every lens or the
 * colouring stops being a grammar and becomes decoration.
 */
function scopeBar(scope, at) {
  let trail = [];
  if (scope.depot) trail.push([scope.depot, `/${scope.depot}`, 's-depot']);
  if (scope.publisher)
    trail.push([scope.publisher, `/${scope.depot}/${scope.publisher}`, 's-publisher']);
  let deckAt = `/${scope.depot}/${scope.publisher}/${scope.pkg}`;
  if (scope.pkg) trail.push([scope.pkg, deckAt, 's-package']);
  // Path segments, so the bar says exactly what the feed is filtered to. It
  // stopped at the deck while the filter now goes to the file, and a subject
  // line that under-reports the scope is a subject line that lies.
  if (scope.path) {
    let sofar = [];
    for (let segment of scope.path.split('/')) {
      sofar.push(segment);
      trail.push([segment, `${deckAt}/${sofar.join('/')}`, '']);
    }
  }
  subject.trail = trail
    .map(([label, value, cls], index) =>
      index === trail.length - 1
        ? `<b class="${cls}">${esc(label)}</b>`
        : `<a class="${cls}" href="?at=${esc(value)}" data-at="${esc(value)}">${esc(label)}</a>`,
    )
    .join('<span class="sep">/</span>');
  return '';
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
  if (row.count > 1) return groupEntry(row);
  let fresh = freshness(row.when);
  let browse = row.vs ? `/browse?at=${row.at}&vs=${row.vs}` : `/browse?at=${row.at}`;
  let detail =
    row.changes?.length
      ? row.changes
          .slice(0, 3)
          .map(
            (change) =>
              `<span class="how" data-how="${change.how}">${MARK[HOW[change.how]] ?? change.how}</span>` +
              esc(change.path.split('/').slice(2).join('/') || change.path),
          )
          .join(' ') +
        (row.changes.length > 3
          ? ` <span class="dim">+${row.changes.length - 3}</span>`
          : '')
      : esc(row.detail ?? '');
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
    // Provenance sits on the second line because it is a property of the
    // thing, not the event: `npm:three · published 2y ago` answers "what did
    // we take on", while the row's own timestamp answers "when did we".
    (row.upstream
      ? ` <span class="dim upstream">${esc(row.upstream)}` +
        (row.upstreamWhen ? ` · published ${esc(ago(row.upstreamWhen))}` : '') +
        `</span>`
      : '') +
    `</div></div>` +
    `<a class="entry-go" href="${esc(browse)}">${row.vs ? 'diff' : 'open'} →</a>` +
    `</li>`
  );
}

/**
 * A run of work, as one row.
 *
 * The span is the headline — "four minutes" is the thing a person recognises
 * as an episode, and no single save carries it. Then the count, then the
 * distinct files, which is the answer to "what was being worked on" and is
 * usually three or four names rather than thirty repetitions of one.
 *
 * `diff →` spans the whole run: the newest state against the state before it
 * began. That lands in the multi-file review, so one click goes from "someone
 * spent four minutes here" to every line they changed.
 */
function groupEntry(row) {
  let fresh = freshness(row.when);
  let browse = row.vs ? `/browse?at=${row.at}&vs=${row.vs}` : `/browse?at=${row.at}`;
  let files = [...row.paths].map((path) => path.split('/').slice(2).join('/') || path);
  let verbs = [...row.kinds];
  return (
    `<li class="entry" data-kind="${esc(verbs[0])}" data-group="1" ` +
    `style="--fresh:${fresh.toFixed(3)}" ` +
    `data-name="${esc(`${verbs.join(' ')} ${row.depot} ${row.publisher} ${row.pkg}`.toLowerCase())}">` +
    `<div class="entry-when">${esc(ago(row.when)) || '<span class="dim">—</span>'}</div>` +
    `<div class="entry-main">` +
    `<div class="entry-head">` +
    `<span class="verb"><i>${MARK[verbs[0]] ?? '·'}</i>` +
    `${esc(verbs.length === 1 ? verbs[0] : 'changed')}</span> ` +
    `<span class="s-package">${esc(row.publisher)}/${esc(row.pkg)}</span> ` +
    `<span class="dim">${row.count} changes over ${esc(span(row.oldestWhen, row.when))}</span>` +
    `</div>` +
    `<div class="entry-sub">` +
    `<span class="s-depot">${esc(row.depot)}</span>` +
    ` <span class="dim">${files
      .slice(0, 5)
      .map((path) => esc(path))
      .join(' · ')}${files.length > 5 ? ` +${files.length - 5}` : ''}</span>` +
    `</div></div>` +
    `<a class="entry-go" href="${esc(browse)}">diff all →</a>` +
    `</li>`
  );
}

/** `4m` · `1h 20m` — how long the run lasted, not how long ago it was. */
function span(from, to) {
  let a = Date.parse(from ?? '');
  let b = Date.parse(to ?? '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  let minutes = Math.max(1, Math.round(Math.abs(b - a) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
    let filtered = all.filter(
      (row) => kinds.includes(row.kind) && !ATTENTION.includes(row.kind),
    );
    let { rows, sorting } = sortRows(filtered);
    app.innerHTML =
      scopeBar(scope, at) +
      `<main>` +
      controls(all, kinds) +
      attention(all) +
      (rows.length >= 25
        ? `<div class="filter"><b>filter</b> <input type="search" data-role="filter" ` +
          `size="24" placeholder="${rows.length} changes" autocomplete="off" /> ` +
          `<span class="dim" data-role="filter-count"></span></div>`
        : '') +
      (rows.length
        ? `<ul class="feed">${(grouped() ? groupRuns(rows) : rows)
            .map(entry)
            .join('')}</ul>`
        : `<p class="dim">nothing here</p>`) +
      `</main>`;
  } catch (error) {
    app.innerHTML =
      `<main><div class="err"><b>${esc(error.code ?? 'error')}</b> — ` +
      `${esc(error.message)}</div></main>`;
  }
  cursor = -1;
  wrapTables(app);
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
    ['a', 'auto-publishes'],
    [['g', 'G'], 'ends'],
    ['u', 'widen'],
  );
  return list;
}

function toggleNoise() {
  let kinds = currentKinds();
  go({
    kind: kinds.includes('auto-published')
      ? kinds.filter((kind) => !NOISE.includes(kind))
      : [...kinds, ...NOISE],
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
  if (event.key === 'a') return toggleNoise();
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
  if (event.target.closest('[data-role="noise"]')) return toggleNoise();
  if (event.target.closest('[data-role="grouped"]')) {
    return go({ group: grouped() ? '0' : undefined });
  }
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

// A CHANGE FEED THAT NEEDS RELOADING IS NOT A FEED.
//
// This app exists to answer "what just happened", and until now it answered
// "what had happened when you last pressed reload" — which, while an agent is
// working, is wrong within seconds and wrong silently. The depot already
// announces every save on the SSE channel; the query cache just was not
// listening.
//
// Invalidate rather than refetch: query-core then only re-fetches what is
// actually mounted, and the seal log is the one query that grows.
onLiveChange(() => {
  client.invalidateQueries();
  render();
});

// The clock keeps moving even when the depot does not, and every row is
// stamped with a relative time and a recency fade. Left alone, `just now`
// stays on screen for an hour. A minute is finer than the smallest unit the
// feed prints, so nothing ever displays a time that has gone stale.
setInterval(() => {
  if (!document.hidden) render();
}, 60_000);

render();

// touch: verify publishedAt reaches the store
