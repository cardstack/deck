// /browse — the depot at rest.
//
// The whole of the app's state is two query parameters:
//
//   ?at=/three-js/lib/three@0.160.0/src/Three.js   what you are looking at
//   &vs=/three-js/me/three@0.160.0-holo.bb60a402   what to compare it against
//
// `at` is not a shortcut. A browse URL is the viewer plus the address it is
// viewing, one prefix apart from the bytes themselves — strip `?at=` and you
// have the file. The page says so next to every blob.
//
// FOUR KINDS OF ADDRESS, one control.
// ═══════════════════════════════════
// L5 says a deck has three kinds of address. A depot with tier-2 history has
// a fourth, and it is the one that matters most:
//
//   live      /<depot>/<pub>/<pkg>/<path>                every save, no-store
//   tag       /<depot>/<pub>/<pkg>@latest/<path>         one short-TTL hop
//   exact     /<depot>/<pub>/<pkg>@1.2.0/<path>          immutable, forever
//   seal      /<depot>/_history/<changeId>/<pub>/<pkg>/<path>
//
// A seal is every state the depot has been in, INCLUDING the ones nobody
// published. That is what makes going back cheap, and going back cheaply is
// what lets people move fast. So seals are not a separate screen reached by a
// link — they are entries in the same volatility control as everything else,
// because choosing between them is the same act.
import 'ui/nav';
import { installNavStyles } from 'ui/nav';
import { diffLines } from 'diff';
import hljs from 'highlight-js';
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
// Syntax highlighting: 192 languages, none loaded until needed.
//
// `highlight-js` is a fork of highlight.js — one line of lib/core.js, because
// what npm publishes is CommonJS behind an ESM shim and a browser cannot
// import it (see apps/hub/setup.mjs). The language definitions needed no
// patch: every one is self-contained ESM with zero imports.
//
// That per-file shape is what makes "universal" affordable. The full set is
// 2.6 MB; a page showing one GLSL file fetches a 12 KB core and a 10 KB
// language module. A bundle would have to choose in advance which languages
// the Hub is allowed to understand.
// ---------------------------------------------------------------------------

const LANGUAGE = {
  mjs: 'javascript', cjs: 'javascript', js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  htm: 'xml', html: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', markdown: 'markdown',
  yml: 'yaml', toml: 'ini', cfg: 'ini',
  sh: 'bash', zsh: 'bash', bash: 'bash',
  py: 'python', rb: 'ruby', rs: 'rust', kt: 'kotlin', gradle: 'groovy',
  h: 'c', hpp: 'cpp', cc: 'cpp', mm: 'objectivec',
  frag: 'glsl', vert: 'glsl', glsl: 'glsl',
  gts: 'typescript', gjs: 'javascript', hbs: 'handlebars',
};

const loaded = new Map();

async function language(path) {
  let extension = (path.split('.').pop() ?? '').toLowerCase();
  let name = LANGUAGE[extension] ?? extension;
  if (!name || !/^[a-z0-9-]+$/.test(name)) return undefined;
  if (loaded.has(name)) return loaded.get(name);
  let pending = import(`highlight-js/es/languages/${name}.js`)
    .then((module) => {
      hljs.registerLanguage(name, module.default);
      return name;
    })
    // A 404 is the ordinary answer for "we do not highlight this", not a
    // failure: 192 languages is a lot and still not all of them.
    .catch(() => undefined);
  loaded.set(name, pending);
  return pending;
}

// hljs returns one HTML string for the whole file; this view needs one element
// per line so it can number and anchor them. Splitting on newlines would cut
// spans in half wherever a comment block or template literal crosses a line,
// so open tags are tracked and reopened. hljs only ever emits
// `<span class="…">`, which is what makes this tractable.
function splitHighlighted(html) {
  let lines = [];
  let open = [];
  let current = '';
  let index = 0;
  while (index < html.length) {
    if (html.startsWith('</span>', index)) {
      open.pop();
      current += '</span>';
      index += 7;
      continue;
    }
    if (html.startsWith('<span', index)) {
      let end = html.indexOf('>', index) + 1;
      let tag = html.slice(index, end);
      open.push(tag);
      current += tag;
      index = end;
      continue;
    }
    let next = html.indexOf('<', index);
    let chunk = html.slice(index, next === -1 ? html.length : next);
    index = next === -1 ? html.length : next;
    let parts = chunk.split('\n');
    for (let part = 0; part < parts.length; part += 1) {
      if (part > 0) {
        lines.push(current + '</span>'.repeat(open.length));
        current = open.join('');
      }
      current += parts[part];
    }
  }
  lines.push(current + '</span>'.repeat(open.length));
  return lines;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const HISTORY = '_history';

/** A Deck address, split into the parts the endpoints take. */
function parseAddress(at) {
  let clean = (at ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean) return {};
  let [depot, second, ...rest] = clean.split('/');
  if (second === HISTORY) {
    let [rev, ...tail] = rest;
    return { depot, seal: rev || true, path: tail.join('/') || undefined };
  }
  let [pkgAndSpec, ...tail] = rest;
  let out = { depot, publisher: second };
  if (pkgAndSpec) {
    let marker = pkgAndSpec.indexOf('@');
    out.pkg = marker > 0 ? pkgAndSpec.slice(0, marker) : pkgAndSpec;
    if (marker > 0) out.spec = pkgAndSpec.slice(marker + 1);
  }
  if (tail.length) out.path = tail.join('/');
  return out;
}

function addressOf({ depot, publisher, pkg, spec, path, seal }) {
  if (seal) {
    return `/${[depot, HISTORY, seal === true ? '' : seal, path]
      .filter(Boolean)
      .join('/')}`;
  }
  return `/${[depot, publisher, pkg && (spec ? `${pkg}@${spec}` : pkg), path]
    .filter(Boolean)
    .join('/')}`;
}

/**
 * The address, coloured by segment.
 *
 * Five parts, five hues, everywhere the address appears. Colour here is the
 * URL grammar taught by repetition — the publisher gets the loudest one
 * because it is the fork boundary, the segment people most often fail to
 * notice is doing work.
 */
function addressHtml(parsed) {
  let out = [];
  if (parsed.depot) out.push(`<span class="s-depot">${esc(parsed.depot)}</span>`);
  if (parsed.seal) {
    out.push(`<span class="s-seal">${HISTORY}</span>`);
    if (parsed.seal !== true) {
      out.push(`<span class="s-seal">${esc(String(parsed.seal).slice(0, 12))}</span>`);
    }
  } else {
    if (parsed.publisher)
      out.push(`<span class="s-publisher">${esc(parsed.publisher)}</span>`);
    if (parsed.pkg) {
      out.push(
        `<span class="s-package">${esc(parsed.pkg)}</span>` +
          (parsed.spec
            ? `<span class="s-version">@${esc(parsed.spec)}</span>`
            : `<span class="s-version" data-live>·live</span>`),
      );
    }
  }
  if (parsed.path)
    out.push(`<span class="s-path">${esc(parsed.path)}</span>`);
  return out.join('<span class="sep">/</span>');
}

const params = () => new URLSearchParams(location.search);
const currentAt = () => params().get('at') ?? '';
const currentVs = () => params().get('vs') ?? '';

function go(at, vs = currentVs(), replace = false) {
  let next = new URLSearchParams();
  if (at) next.set('at', at);
  if (vs) next.set('vs', vs);
  let query = next.toString();
  history[replace ? 'replaceState' : 'pushState'](
    {},
    '',
    query ? `?${decodeURIComponent(query)}` : location.pathname,
  );
  render();
}

// Deck's errors are coded and carry a permanence, and the two flavours of miss
// must not look alike (UI spec §12). An invalid spec can never resolve — no
// future publish can rescue it — while a legal tag nobody has published yet is
// a question of time.
const PERMANENT = new Set(['invalid-version-spec', 'invalid-revision', 'not-found']);

async function getJson(url) {
  let response = await fetch(url, { headers: { accept: 'application/json' } });
  let body = await response.json().catch(() => ({}));
  if (!response.ok) {
    let error = body?.errors?.[0] ?? {};
    throw Object.assign(new Error(error.detail ?? response.statusText), {
      code: error.code ?? String(response.status),
      status: response.status,
    });
  }
  return body;
}

// The seal log per depot. Fetched once per view and cached: it changes only
// when something is saved, and the live badge already says when that happens.
const sealCache = new Map();

async function sealsOf(depot) {
  if (!sealCache.has(depot)) {
    sealCache.set(
      depot,
      getJson(`/${depot}/${HISTORY}`)
        .then((body) => body.data.map((seal) => seal.attributes))
        // Tier 1: versions ARE the history. Not an error, just fewer
        // addresses.
        .catch(() => []),
    );
  }
  return sealCache.get(depot);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function crumbs(parsed) {
  let trail = [['~', '']];
  if (parsed.depot) trail.push([parsed.depot, `/${parsed.depot}`, 's-depot']);
  if (parsed.seal) {
    trail.push([HISTORY, `/${parsed.depot}/${HISTORY}`, 's-seal']);
    if (parsed.seal !== true) {
      trail.push([
        String(parsed.seal).slice(0, 12),
        `/${parsed.depot}/${HISTORY}/${parsed.seal}`,
        's-seal',
      ]);
    }
  } else {
    if (parsed.publisher)
      trail.push([
        parsed.publisher,
        `/${parsed.depot}/${parsed.publisher}`,
        's-publisher',
      ]);
    if (parsed.pkg) {
      trail.push([
        parsed.spec ? `${parsed.pkg}@${parsed.spec}` : parsed.pkg,
        addressOf({ ...parsed, path: undefined }),
        's-package',
      ]);
    }
  }
  if (parsed.path) {
    let sofar = [];
    for (let segment of parsed.path.split('/')) {
      sofar.push(segment);
      trail.push([segment, addressOf({ ...parsed, path: sofar.join('/') })]);
    }
  }
  return (
    `<div class="prompt"><span class="prompt-mark">deck browse</span> ` +
    trail
      .map(([label, at, cls], index) =>
        index === trail.length - 1
          ? `<b class="${cls ?? ''}">${esc(label)}</b>`
          : `<a class="${cls ?? ''}" href="?at=${esc(at)}" data-at="${esc(at)}">${esc(label)}</a>`,
      )
      .join('<span class="sep">/</span>') +
    `</div>`
  );
}

/**
 * Every address this thing answers to, in one ordered list: live, tags,
 * versions, seals. The order is the order `[` and `]` step through, which is
 * roughly newest-to-oldest — the direction people actually travel when they
 * are looking for the moment something broke.
 */
function addressOptions(parsed, meta, seals) {
  let options = [];
  if (meta?.live) {
    options.push({ value: '', label: 'live', note: 'bytes on disk · no-store', kind: 'live' });
  }
  for (let [tag, version] of Object.entries(meta?.distTags ?? {})) {
    options.push({ value: tag, label: tag, note: `→ ${version} · one hop`, kind: 'tag' });
  }
  for (let version of Object.keys(meta?.versions ?? {}).sort().reverse()) {
    options.push({ value: version, label: version, note: 'immutable · forever', kind: 'exact' });
  }
  // Seals only make sense for something with a live tree: a seal captures the
  // working tree, so a deck that exists only in the store was never in one.
  if (meta?.live && parsed.publisher && parsed.pkg) {
    for (let seal of seals ?? []) {
      options.push({
        value: `seal:${seal.changeId}`,
        label: seal.changeId.slice(0, 12),
        note: `${(seal.timestamp ?? '').slice(0, 16).replace('T', ' ')} · ${
          seal.description?.replace(/^save:\s*/, '') ?? 'seal'
        }`.slice(0, 78),
        kind: 'seal',
      });
    }
  }
  return options;
}

/** Where an option in that list actually points. */
function addressFor(parsed, value) {
  if (value.startsWith('seal:')) {
    let rev = value.slice(5);
    let path = [parsed.publisher, parsed.pkg, parsed.path].filter(Boolean).join('/');
    return `/${parsed.depot}/${HISTORY}/${rev}${path ? `/${path}` : ''}`;
  }
  return addressOf({ ...parsed, seal: undefined, spec: value || undefined });
}

function volatility(parsed, meta, seals) {
  let options = addressOptions(parsed, meta, seals);
  if (!options.length) return '';
  let selected = parsed.seal ? `seal:${parsed.seal}` : (parsed.spec ?? '');
  let kind = parsed.seal ? 'seal' : selected === '' ? 'live' : 'sealed';
  let sealCount = options.filter((option) => option.kind === 'seal').length;
  return (
    `<span class="vol" data-kind="${kind}"><label>version</label> ` +
    `<select data-role="vol">` +
    options
      .map(
        (option) =>
          `<option value="${esc(option.value)}"${option.value === selected ? ' selected' : ''}>` +
          `${esc(option.label)} — ${esc(option.note)}</option>`,
      )
      .join('') +
    `</select>` +
    (sealCount ? ` <span class="dim">${sealCount} seals</span>` : '') +
    `</span>`
  );
}

/**
 * The other side of a comparison. Absent by default; never guessed at.
 *
 * `vs` takes three forms, because there are three comparisons worth making:
 *
 *   1.4.0                          another version of THIS deck
 *   /three-js/me/three@0.160.…     another deck entirely — a FORK
 *   seal:<changeId>                this deck as it was at a moment
 *
 * The second is what a fork is: `lib/three` and `me/three` are different decks
 * under different publishers, and the publisher segment IS the fork boundary,
 * so a comparison confined to one deck's version list can never express "what
 * did the fork change". The third is what you want at 2am.
 */
function compare(parsed, meta, seals, vs) {
  let options = addressOptions(parsed, meta, seals).filter(
    (option) => option.value !== '',
  );
  let isAddress = vs.startsWith('/');
  return (
    `<span class="cmp"${vs ? ' data-on="1"' : ''}><label>compare with</label> ` +
    `<select data-role="vs">` +
    `<option value=""${vs ? '' : ' selected'}>— nothing —</option>` +
    options
      .map(
        (option) =>
          `<option value="${esc(option.value)}"${option.value === vs ? ' selected' : ''}>` +
          `${esc(option.label)}</option>`,
      )
      .join('') +
    (isAddress ? `<option value="${esc(vs)}" selected>${esc(vs)}</option>` : '') +
    `</select> <input data-role="vs-address" size="26" placeholder="…or a deck address" ` +
    `value="${esc(isAddress ? vs : '')}" /></span>`
  );
}

/**
 * Siblings — the same package under other publishers, on this server.
 *
 * The publisher segment IS the fork boundary, so `lib/three` and `me/three`
 * are the same package forked, and `lib/prosemirror-view`,
 * `src/prosemirror-view` and `me/prosemirror-view` are one library in three
 * conditions: the runnable bundle, the readable source, and the fork.
 *
 * Nothing in the protocol makes this a link — a fork records what it forked
 * FROM, so following the arrow backwards means asking every deck. This does
 * that the cheap way: `/_packages` is already fetched, so decks sharing a
 * name are free to find and are exactly the set worth offering. The panel
 * says "related", not "forks of", because same-name-different-publisher is
 * strong evidence and not proof.
 */
async function siblings(parsed) {
  let { data } = await getJson('/_packages');
  let depot = data.find((entry) => entry.name === parsed.depot);
  let related = (depot?.packages ?? []).filter(
    (deck) => deck.name === parsed.pkg && deck.publisher !== parsed.publisher,
  );
  if (!related.length) return '';
  return (
    `<div class="siblings"><b>also on this server</b> ` +
    related
      .map((deck) => {
        let at = `/${parsed.depot}/${deck.publisher}/${deck.name}`;
        let vs = addressOf({ ...parsed, path: undefined });
        return (
          `<a href="?at=${esc(at)}&vs=${esc(vs)}" data-at="${esc(at)}" data-vs="${esc(vs)}" ` +
          `title="open, compared against what you are looking at now">` +
          `<span class="s-publisher">${esc(deck.publisher)}</span>` +
          `<span class="sep">/</span><span class="s-package">${esc(deck.name)}</span></a>`
        );
      })
      .join('') +
    `<em class="dim">same package, other publishers — the publisher segment ` +
    `is the fork boundary</em></div>`
  );
}

/** Which address is on the other side of a comparison. */
function otherSide(parsed, vs) {
  if (!vs) return undefined;
  if (vs.startsWith('/')) {
    let target = parseAddress(vs);
    return { ...target, path: parsed.path ?? target.path };
  }
  return parseAddress(addressFor(parsed, vs));
}

const bytes = (n) =>
  n === undefined ? '' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;

/** treeHash: present everywhere, prominent nowhere (brief §2.2). */
function hash(value, label = 'treeHash') {
  if (!value) return '';
  return (
    `<div title="${esc(value)}"><b>${esc(label)}</b> ` +
    `<code class="s-hash">${esc(value.slice(0, 12))}</code></div>`
  );
}

const FILTER_AT = 25;

// ---------------------------------------------------------------------------
// Sortable listings, on @tanstack/table-core.
//
// Headless: it owns the sorting state and the row order and renders nothing,
// so the markup below stays ours and stays on the character grid. That is the
// whole reason to use it here rather than a table component.
//
// v9 rather than v8 because v8 is a bundle at every entry and v9 publishes 79
// real modules — picking the bundled major would have given up the property
// we chose the library for. Two things had to be dealt with to get there, and
// both are recorded in apps/hub/setup.mjs: the reactivity feature lives
// behind subpath exports nothing in the main entry imports, and nine files
// guard dev warnings with `process.env.NODE_ENV`, which a browser does not
// have.
// ---------------------------------------------------------------------------

const SORT_STATE = new Map();

function sortedRows(key, data, columns) {
  let sorting = SORT_STATE.get(key) ?? [];
  let table = constructTable({
    features: tableFeatures({
      coreReactivityFeature: storeReactivityBindings(),
      rowSortingFeature,
      coreRowModel: createCoreRowModel(),
      sortedRowModel: createSortedRowModel(),
    }),
    data,
    columns,
    state: { sorting },
    onStateChange: () => {},
  });
  return { rows: table.getRowModel().rows.map((row) => row.original), sorting };
}

/**
 * A sortable header cell.
 *
 * The arrow is not decoration — an unsorted column and a column sorted
 * ascending must not look the same, and a column you CAN sort must not look
 * like one you cannot. `⇅` is the affordance, `↑`/`↓` the state.
 */
function sortableHead(columns, sorting, extraClass = '') {
  let active = sorting[0];
  return (
    `<thead><tr>` +
    columns
      .map(
        (column) =>
          `<th class="${column.align === 'right' ? 'num' : ''} ${extraClass}" ` +
          `data-role="sort" data-column="${esc(column.id)}" tabindex="0" ` +
          `title="sort by ${esc(column.label)}">${esc(column.label)}` +
          `<i class="sortmark">${
            active?.id === column.id ? (active.desc ? '↓' : '↑') : '⇅'
          }</i></th>`,
      )
      .join('') +
    `</tr></thead>`
  );
}

function filterBox(count, noun) {
  return count >= FILTER_AT
    ? `<div class="filter"><b>filter</b> <input type="search" data-role="filter" ` +
        `size="24" placeholder="${count} ${noun}" autocomplete="off" /> ` +
        `<span class="dim" data-role="filter-count"></span></div>`
    : '';
}

const FILE_COLUMNS = [
  { id: 'name', label: 'name', accessorKey: 'name' },
  { id: 'size', label: 'size', accessorKey: 'size', align: 'right' },
  { id: 'kind', label: 'kind', accessorKey: 'type' },
  { id: 'sha256', label: 'sha256', accessorKey: 'sha256' },
];

function listing(parsed, attrs) {
  // Directories first is the `ls` convention and it survives sorting: it is
  // not a sort order, it is a grouping people rely on to find their way out
  // of a folder. Within each group, table-core decides.
  let data = attrs.entries.map((entry) => ({
    ...entry,
    size: entry.size ?? 0,
  }));
  // The key travels with the table rather than being recomputed from the URL
  // by the click handler: a version-less address resolves to `@latest` before
  // it gets here, so the two would disagree and the sort would be written
  // under one key and read under another.
  let key = `files:${addressOf(parsed)}`;
  let { rows, sorting } = sortedRows(key, data, FILE_COLUMNS);
  let dirs = rows.filter((entry) => entry.type === 'dir');
  let files = rows.filter((entry) => entry.type !== 'dir');
  let body = [...dirs, ...files]
    .map((entry) => {
      let at = addressOf({ ...parsed, path: entry.path });
      return (
        `<tr data-name="${esc(entry.name.toLowerCase())}">` +
        `<td><a href="?at=${esc(at)}" data-at="${esc(at)}" ` +
        `class="${entry.type === 'dir' ? 's-dir' : 's-file'}">` +
        `${esc(entry.name)}${entry.type === 'dir' ? '/' : ''}</a></td>` +
        `<td class="num dim">${entry.type === 'dir' ? '' : esc(bytes(entry.size))}</td>` +
        `<td class="dim">${entry.type === 'dir' ? 'dir' : esc((entry.name.split('.').pop() ?? '').slice(0, 8))}</td>` +
        `<td>${
          entry.sha256
            ? `<code class="s-hash" title="${esc(entry.sha256)}">${esc(entry.sha256.slice(0, 8))}</code>`
            : ''
        }</td></tr>`
      );
    })
    .join('');
  return (
    filterBox(attrs.entries.length, 'entries') +
    `<table data-sort-key="${esc(key)}">${sortableHead(FILE_COLUMNS, sorting)}` +
    `<tbody>${body}</tbody></table>` +
    `<p class="dim">${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'} · ` +
    `${files.length} file${files.length === 1 ? '' : 's'} · ${esc(attrs.kind)}</p>`
  );
}

// One <pre>, one span per line, numbers from a CSS counter. Measured at 53 ms
// for 10,000 lines, so no virtualization — the chunk boundary sits well above
// the common case.
const CHUNK = 2000;

function lineSpans(lines, from = 0) {
  return lines
    .map(
      (line, index) =>
        `<span class="ln" id="L${from + index + 1}">${line || '​'}</span>`,
    )
    .join('');
}

/**
 * The blob, rendered now and highlighted when the language arrives.
 *
 * Escaped text goes up immediately; the language module is one more request,
 * and a file readable 40 ms sooner in grey beats one that is blank until it
 * can be colourful.
 */
function blob(text, path) {
  let element = document.createElement('pre');
  element.className = 'blob';
  let paint = (lines) => {
    element.innerHTML = lineSpans(lines.slice(0, CHUNK));
    if (lines.length > CHUNK) {
      let rest = lines.slice(CHUNK);
      requestIdleCallback(() => {
        element.insertAdjacentHTML('beforeend', lineSpans(rest, CHUNK));
        if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
      });
    }
  };
  paint(text.split('\n').map(esc));
  language(path).then((name) => {
    if (!name || !element.isConnected) return;
    try {
      paint(splitHighlighted(hljs.highlight(text, { language: name }).value));
    } catch {
      // A grammar that throws on this file leaves the plain text standing.
    }
  });
  return element;
}

// ---------------------------------------------------------------------------
// Diff, at both levels
// ---------------------------------------------------------------------------

const metaOf = (target) =>
  getJson(`${addressOf({ ...target, path: undefined })}?meta`).then(
    (body) => body.data.attributes,
  );

const labelOf = (target) =>
  target.seal
    ? `${target.depot}@seal ${String(target.seal).slice(0, 12)}`
    : `${target.publisher}/${target.pkg}@${target.spec ?? 'live'}`;

/**
 * Tree level: which files differ, by digest.
 *
 * The question a fork exists to answer, and one a line differ cannot reach.
 * Two manifests, no file content, exact: identical sha256 means identical
 * bytes, so "373 of 375 files are byte-identical" is arithmetic rather than a
 * claim. Unchanged files are counted, not listed — a list of 373 things that
 * did not happen is not information.
 */
function treeDiff(left, right) {
  let a = new Map((left.tree ?? []).map((entry) => [entry.path, entry]));
  let b = new Map((right.tree ?? []).map((entry) => [entry.path, entry]));
  let rows = [];
  let same = 0;
  for (let [path, entry] of a) {
    let other = b.get(path);
    if (!other) rows.push({ path, status: 'removed', size: entry.size });
    else if (other.sha256 !== entry.sha256)
      rows.push({ path, status: 'changed', size: other.size });
    else same += 1;
  }
  for (let [path, entry] of b) {
    if (!a.has(path)) rows.push({ path, status: 'added', size: entry.size });
  }
  rows.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return { rows, same, total: new Set([...a.keys(), ...b.keys()]).size };
}

const MARK = { added: '+', removed: '-', changed: '~' };

function treeDiffView(parsed, vs, left, right, leftLabel, rightLabel) {
  let { rows, same, total } = treeDiff(left, right);
  let body = rows
    .map((row) => {
      let at = addressOf({ ...parsed, path: row.path });
      return (
        `<tr data-status="${row.status}" data-name="${esc(row.path.toLowerCase())}">` +
        `<td class="mark">${MARK[row.status]}</td>` +
        `<td>${
          row.status === 'removed'
            ? `<span class="dim">${esc(row.path)}</span>`
            : `<a href="?at=${esc(at)}&vs=${esc(vs)}" data-at="${esc(at)}" data-vs="${esc(vs)}">${esc(row.path)}</a>`
        }</td>` +
        `<td class="num dim">${esc(bytes(row.size))}</td></tr>`
      );
    })
    .join('');
  return (
    `<div class="diffhead">` +
    `<span class="dim">base</span> <b class="s-base">${esc(leftLabel)}</b> ` +
    `<span class="dim">→ viewing</span> <b class="s-head">${esc(rightLabel)}</b> · ` +
    `<b>${rows.length}</b> of ${total} files differ · ` +
    `<span class="ok">${same} byte-identical</span></div>` +
    (rows.length
      ? filterBox(rows.length, 'changed files') +
        `<table class="treediff"><tbody>${body}</tbody></table>` +
        `<p class="dim">Computed from two manifests. No file content was read: ` +
        `identical sha256 means identical bytes.</p>`
      : `<p class="dim">Every path in both trees has the same digest.` +
        `${left.treeHash === right.treeHash ? ' The treeHashes agree too.' : ''}</p>`)
  );
}

/** File level: which lines differ. */
function fileDiffView(leftText, rightText, leftLabel, rightLabel) {
  let out = [];
  let a = 0;
  let b = 0;
  let changed = 0;
  for (let part of diffLines(leftText, rightText)) {
    let lines = part.value.split('\n');
    if (lines.at(-1) === '') lines.pop();
    for (let line of lines) {
      if (part.added) {
        b += 1;
        changed += 1;
        out.push(['+', '', b, line]);
      } else if (part.removed) {
        a += 1;
        changed += 1;
        out.push(['-', a, '', line]);
      } else {
        a += 1;
        b += 1;
        out.push([' ', a, b, line]);
      }
    }
  }
  return (
    `<div class="diffhead"><span class="dim">base</span> ` +
    `<b class="s-base">${esc(leftLabel)}</b> <span class="dim">→ viewing</span> ` +
    `<b class="s-head">${esc(rightLabel)}</b> · ` +
    (changed ? `<b>${changed}</b> lines differ` : `<span class="ok">byte-identical</span>`) +
    `</div><pre class="blob diff">` +
    out
      .map(
        ([mark, an, bn, line]) =>
          `<span class="ln" data-mark="${mark === ' ' ? '' : mark}">` +
          `<i class="gut">${an || ''}</i><i class="gut">${bn || ''}</i>` +
          `<b class="mk">${mark}</b>${esc(line) || '​'}</span>`,
      )
      .join('') +
    `</pre>`
  );
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function viewDepots() {
  let { data } = await getJson('/_packages');
  return (
    `<h1>depots on this server</h1>` +
    `<table><thead><tr><th>depot</th><th class="num">decks</th>` +
    `<th>history</th><th>on disk</th></tr></thead><tbody>` +
    data
      .map(
        (depot) =>
          `<tr data-name="${esc(depot.name)}"><td><a class="s-depot" href="?at=/${esc(depot.name)}" ` +
          `data-at="/${esc(depot.name)}">${esc(depot.name)}</a></td>` +
          `<td class="num">${depot.packages.length}</td>` +
          `<td>${
            depot.history
              ? `<a class="s-seal" href="?at=/${esc(depot.name)}/${HISTORY}" ` +
                `data-at="/${esc(depot.name)}/${HISTORY}">${esc(depot.history)} · seals</a>`
              : '<span class="dim">tier 1 — versions are the history</span>'
          }</td>` +
          `<td class="dim">${esc(depot.dir)}</td></tr>`,
      )
      .join('') +
    `</tbody></table>` +
    `<p class="note">The demo depots are mounted read-only for density. Their ` +
    `sealed import maps say <code>/site/</code>, so their decks read correctly ` +
    `and their dependencies do not resolve — a real degraded state, shown ` +
    `rather than hidden.</p>`
  );
}

/**
 * A depot's decks, or one publisher's.
 *
 * NOT from `/_browse/<depot>`, which enumerates the working tree and so lists
 * only decks that exist on disk. Most of a real depot is vendored: the
 * ProseMirror depot has 22 decks and one is live, so the filesystem view shows
 * 1/22 and looks like an almost-empty depot. `_packages` is the union of store
 * and tree, which is what "what is in here" means.
 */
async function viewCatalog(parsed) {
  let { data } = await getJson('/_packages');
  let depot = data.find((entry) => entry.name === parsed.depot);
  if (!depot) {
    throw Object.assign(new Error(`no depot ${parsed.depot}`), {
      code: 'depot-not-found',
    });
  }
  let decks = depot.packages.filter(
    (deck) => !parsed.publisher || deck.publisher === parsed.publisher,
  );
  let rows = decks
    .map((deck) => {
      let at = `/${depot.name}/${deck.publisher}/${deck.name}`;
      let versions = Object.keys(deck.versions ?? {});
      let newest = deck.distTags?.latest ?? versions.at(-1);
      return (
        `<tr data-name="${esc(`${deck.publisher}/${deck.name}`.toLowerCase())}">` +
        `<td><a href="?at=${esc(at)}" data-at="${esc(at)}">` +
        `${parsed.publisher ? '' : `<span class="s-publisher">${esc(deck.publisher)}</span><span class="sep">/</span>`}` +
        `<span class="s-package">${esc(deck.name)}</span></a></td>` +
        `<td class="num dim">${versions.length}</td>` +
        `<td class="s-version">${newest ? esc(newest) : '<span class="dim">—</span>'}</td>` +
        `<td>${
          deck.live
            ? '<span class="s-version" data-live>live</span> <span class="dim">+ sealed</span>'
            : '<span class="dim">sealed only</span>'
        }</td></tr>`
      );
    })
    .join('');
  return (
    crumbs(parsed) +
    `<main><div class="facts">` +
    `<div><b>decks</b> ${decks.length}</div>` +
    `<div><b>live</b> ${decks.filter((deck) => deck.live).length}</div>` +
    `<div><b>history</b> ${
      depot.history
        ? `<a class="s-seal" href="?at=/${esc(depot.name)}/${HISTORY}" data-at="/${esc(depot.name)}/${HISTORY}">${esc(depot.history)}</a>`
        : 'tier 1'
    }</div></div>` +
    filterBox(decks.length, 'decks') +
    `<table><thead><tr><th>deck</th><th class="num">versions</th>` +
    `<th>latest</th><th>where</th></tr></thead><tbody>${rows}</tbody></table>` +
    `</main>`
  );
}

/**
 * The seal log — every state the depot has been in, published or not.
 *
 * This is the list that makes "go back" possible, and it is longer than the
 * version list by design: a version is a decision, a seal is a save. Most of
 * these were never published and never will be, and that is exactly why they
 * are worth keeping.
 */
async function viewSealLog(parsed) {
  let seals = await sealsOf(parsed.depot);
  if (!seals.length) {
    return (
      crumbs(parsed) +
      `<main><p class="note">This depot has no history backend attached — ` +
      `tier 1, where the published versions are the history. Nothing is ` +
      `missing; there is simply less to offer.</p></main>`
    );
  }
  let rows = seals
    .map((seal) => {
      let at = `/${parsed.depot}/${HISTORY}/${seal.changeId}`;
      let files = seal.filesSummary ?? [];
      return (
        `<tr data-name="${esc((seal.description ?? '').toLowerCase())}">` +
        `<td><a class="s-seal" href="?at=${esc(at)}" data-at="${esc(at)}">` +
        `${esc(seal.changeId.slice(0, 12))}</a></td>` +
        `<td class="dim">${esc((seal.timestamp ?? '').slice(0, 19).replace('T', ' '))}</td>` +
        `<td class="num dim">${files.length || ''}</td>` +
        `<td>${esc((seal.description ?? '').replace(/^save:\s*/, ''))}</td></tr>`
      );
    })
    .join('');
  return (
    crumbs(parsed) +
    `<main><div class="facts"><div><b>seals</b> ${seals.length}</div>` +
    `<div><b>newest</b> <span class="s-seal">${esc(seals[0].changeId.slice(0, 12))}</span></div></div>` +
    filterBox(seals.length, 'seals') +
    `<table><thead><tr><th>changeId</th><th>when</th><th class="num">files</th>` +
    `<th>what changed</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<p class="note">Every save, whether or not it was ever published. ` +
    `Going back is <code>deck restore</code>, which writes new history ` +
    `forward — it does not erase any of this.</p></main>`
  );
}

/** One seal: the whole depot tree as it was at that moment. */
async function viewSeal(parsed) {
  let { data } = await getJson(`/${parsed.depot}/${HISTORY}/${parsed.seal}`);
  let attrs = data.attributes;
  if (!attrs.filesAvailable) {
    return (
      crumbs(parsed) +
      `<main><p class="note">The <code>${esc(attrs.backend)}</code> backend ` +
      `cannot enumerate this seal's tree. Individual files are still ` +
      `readable at their paths; the listing is not available.</p></main>`
    );
  }
  let files = attrs.files ?? [];
  let rows = files
    .map((path) => {
      let at = `/${parsed.depot}/${HISTORY}/${parsed.seal}/${path}`;
      return (
        `<tr data-name="${esc(path.toLowerCase())}">` +
        `<td><a href="?at=${esc(at)}" data-at="${esc(at)}">${esc(path)}</a></td></tr>`
      );
    })
    .join('');
  return (
    crumbs(parsed) +
    `<main><div class="facts">` +
    `<div><b>seal</b> <span class="s-seal">${esc(parsed.seal)}</span></div>` +
    `<div><b>backend</b> ${esc(attrs.backend)}</div>` +
    `<div><b>files</b> ${files.length}</div></div>` +
    filterBox(files.length, 'files') +
    `<table><thead><tr><th>path</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<p class="note">A sealed state never changes, so every one of these is ` +
    `<code>immutable</code> — the same caching promise an exact version gets, ` +
    `for a state that was never published at all.</p></main>`
  );
}

/** A file inside a seal. Raw bytes, not JSON: the history route serves them. */
async function viewSealFile(parsed) {
  let url = addressOf(parsed);
  let response = await fetch(url);
  if (!response.ok) {
    throw Object.assign(new Error(`${parsed.path} is not in this seal`), {
      code: 'file-not-found',
    });
  }
  let text = await response.text();
  return {
    html:
      crumbs(parsed) +
      `<main><div class="facts">` +
      `<div><b>kind</b> seal</div>` +
      `<div><b>seal</b> <span class="s-seal">${esc(String(parsed.seal).slice(0, 12))}</span></div>` +
      `<div><b>size</b> ${esc(bytes(text.length))}</div></div>` +
      `<p class="note">this page <code>?at=${esc(url)}</code> · ` +
      `the bytes <a href="${esc(url)}">${esc(url)}</a></p>` +
      `<div id="blob"></div></main>`,
    text,
    path: parsed.path,
  };
}

async function viewAddress(input, vs) {
  let [meta, seals] = await Promise.all([
    getJson(`/_packages/${input.depot}/${input.publisher}/${input.pkg}`)
      .then((body) => body.data.attributes)
      .catch(() => undefined),
    sealsOf(input.depot),
  ]);

  // A version-less address means LIVE, and most decks in a real depot have no
  // live tree — they were vendored straight into the store. Asking for the
  // working copy of something that never had one is not a miss worth showing
  // as one, so it resolves to `latest` instead. The address bar then says
  // `@1.42.2` rather than lying by omission about which bytes are on screen.
  let parsed = input;
  if (!input.spec && meta && !meta.live) {
    let fallback =
      meta.distTags?.latest ?? Object.keys(meta.versions ?? {}).sort().at(-1);
    if (fallback) parsed = { ...input, spec: fallback };
  }
  let at = addressOf(parsed);
  let { data } = await getJson(`/_browse${at}`);
  let attrs = data.attributes;

  let head =
    crumbs(parsed) +
    (await siblings(parsed)) +
    `<main><div class="facts">` +
    (meta ? volatility(parsed, meta, seals) + compare(parsed, meta, seals, vs) : '') +
    `<div><b>kind</b> ${esc(attrs.kind)}</div>` +
    (attrs.version && attrs.version !== 'live'
      ? `<div><b>version</b> <span class="s-version">${esc(attrs.version)}</span></div>`
      : '') +
    hash(attrs.treeHash) +
    (attrs.size !== undefined ? `<div><b>size</b> ${esc(bytes(attrs.size))}</div>` : '') +
    (attrs.sha256 ? hash(attrs.sha256, 'sha256') : '') +
    `</div>`;

  // ── file, compared ──────────────────────────────────────────────────────
  if (data.type === 'file' && vs) {
    let target = otherSide(parsed, vs);
    let other = target.seal
      ? await fetch(addressOf(target))
          .then((response) =>
            response.ok ? response.text().then((text) => ({ text })) : { missing: true },
          )
          .catch(() => ({ missing: true }))
      : await getJson(`/_browse${addressOf(target)}`)
          .then((body) => body.data.attributes)
          .catch((error) => ({ missing: true, code: error.code }));
    if (other.missing) {
      return (
        head +
        `<p class="note">Not present at <code>${esc(addressOf(target))}</code>. ` +
        `On this side the file exists, so relative to that address it is an ` +
        `addition.</p></main>`
      );
    }
    if (attrs.binary || other.binary) {
      return (
        head +
        `<p class="note">Binary on at least one side, so there is nothing ` +
        `honest to show line by line. The digests ` +
        `${attrs.sha256 && attrs.sha256 === other.sha256 ? 'agree' : 'differ'}, ` +
        `which is the whole of what can be said.</p></main>`
      );
    }
    return (
      head +
      fileDiffView(
        other.text ?? '',
        attrs.text ?? '',
        labelOf(target),
        labelOf({ ...parsed, spec: attrs.version }),
      ) +
      `</main>`
    );
  }

  // ── file ────────────────────────────────────────────────────────────────
  if (data.type === 'file') {
    let raw = attrs.rawUrl;
    head +=
      `<p class="note">this page <code>?at=${esc(at)}</code> · ` +
      `the bytes <a href="${esc(raw)}">${esc(raw)}</a></p>`;
    if (attrs.binary) {
      return (
        head +
        `<p>Binary. No preview — size, digest and download are the whole of ` +
        `what can honestly be shown.</p>` +
        `<p><a href="${esc(raw)}" download>download ${esc(attrs.path)}</a></p></main>`
      );
    }
    return {
      html: head + `<div id="blob"></div></main>`,
      text: attrs.text ?? '',
      path: attrs.path ?? '',
    };
  }

  // ── deck, compared ──────────────────────────────────────────────────────
  if (vs && parsed.pkg && !parsed.path) {
    let target = otherSide(parsed, vs);
    let here = { ...parsed, spec: parsed.spec ?? meta?.distTags?.latest };
    let [left, right] = await Promise.all([metaOf(target), metaOf(here)]);
    return (
      head +
      treeDiffView(parsed, vs, left, right, labelOf(target), labelOf(here)) +
      `</main>`
    );
  }

  // ── directory ───────────────────────────────────────────────────────────
  if (meta && !parsed.path) {
    let count = Object.keys(meta.versions ?? {}).length;
    head +=
      `<p class="dim">${count} published version${count === 1 ? '' : 's'}` +
      (meta.live ? ' · live tree on disk' : ' · no live tree') +
      `</p>`;
  }
  return head + listing(parsed, attrs) + `</main>`;
}

function errorView(parsed, error) {
  let permanence = PERMANENT.has(error.code) ? 'permanent' : 'transient';
  return (
    crumbs(parsed) +
    `<main><div class="err" data-permanence="${permanence}">` +
    `<b>${esc(error.code)}</b> — ${esc(error.message)}` +
    `<p class="dim">${
      permanence === 'permanent'
        ? 'Permanent. No future publish can make this address resolve; the ' +
          'spec itself is not a thing that can exist.'
        : 'Transient. This is a legal address that nobody has published yet — ' +
          'it may resolve later without anything being fixed.'
    }</p></div></main>`
  );
}

async function render() {
  let parsed = parseAddress(currentAt());
  let vs = currentVs();
  try {
    let out;
    if (!parsed.depot) out = `<main>${await viewDepots()}</main>`;
    else if (parsed.seal === true) out = await viewSealLog(parsed);
    else if (parsed.seal && !parsed.path) out = await viewSeal(parsed);
    else if (parsed.seal) out = await viewSealFile(parsed);
    else if (parsed.pkg) out = await viewAddress(parsed, vs);
    else out = await viewCatalog(parsed);

    if (typeof out === 'string') {
      app.innerHTML = out;
    } else {
      app.innerHTML = out.html;
      document.getElementById('blob').append(blob(out.text, out.path));
      if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
    }
  } catch (error) {
    app.innerHTML = errorView(parsed, error);
  }
  cursor = -1;
  keys.keys = bindings();
}

// ---------------------------------------------------------------------------
// Keyboard
//
// A file browser is a list, and lists are what keyboards have always been best
// at. This is the primary way to move, with the pointer as the alternative —
// the arrangement every terminal file manager arrived at independently.
//
// Two rules keep it honest:
//   · every binding appears in the on-screen legend, and nothing appears in
//     the legend that is not bound. The legend is DERIVED from the view, so a
//     page with no filter does not offer `/`.
//   · while a field has focus, letters are text. `/` enters the filter and
//     `Escape` leaves it; in between the alphabet belongs to the user.
// ---------------------------------------------------------------------------

let cursor = -1;

const rows = () => [...app.querySelectorAll('tbody tr:not([hidden])')];
const select = (role) => app.querySelector(`select[data-role="${role}"]`);

function moveCursor(delta, absolute) {
  let all = rows();
  if (!all.length) return;
  for (let row of all) delete row.dataset.here;
  cursor =
    absolute === 'first'
      ? 0
      : absolute === 'last'
        ? all.length - 1
        : Math.max(0, Math.min(all.length - 1, cursor + delta));
  let row = all[cursor];
  row.dataset.here = '1';
  row.scrollIntoView({ block: 'nearest' });
}

function openCursor() {
  let link = rows()[cursor]?.querySelector('a[data-at]');
  if (link) go(link.dataset.at, link.dataset.vs ?? currentVs());
}

/** Up one level: the parent of whatever `at` currently names. */
function parentAddress() {
  let parsed = parseAddress(currentAt());
  if (parsed.path) {
    let segments = parsed.path.split('/');
    segments.pop();
    return addressOf({ ...parsed, path: segments.join('/') || undefined });
  }
  if (parsed.seal && parsed.seal !== true) return `/${parsed.depot}/${HISTORY}`;
  if (parsed.seal) return `/${parsed.depot}`;
  if (parsed.pkg) return `/${parsed.depot}/${parsed.publisher}`;
  if (parsed.publisher) return `/${parsed.depot}`;
  return '';
}

/**
 * `[` and `]` walk the volatility list without opening it.
 *
 * This is the time-travel control. The list is ordered live → tags → versions
 * → seals, so holding `]` walks backwards through every state the thing has
 * been in, one keystroke per state, and the page follows. Finding the save
 * that broke something is that loop and nothing else.
 */
function stepVolatility(delta) {
  let control = select('vol');
  if (!control) return;
  let next = control.selectedIndex + delta;
  if (next < 0 || next >= control.options.length) return;
  control.selectedIndex = next;
  let parsed = parseAddress(currentAt());
  go(addressFor(parsed, control.value));
}

/** `n` / `p` — the next and previous change in whatever diff is on screen. */
function stepChange(delta) {
  let marks = [...app.querySelectorAll('pre.diff .ln[data-mark]')].filter(
    (line) => line.dataset.mark,
  );
  let hunks = marks.filter(
    (line, index) => index === 0 || line.previousElementSibling !== marks[index - 1],
  );
  if (!hunks.length) return;
  hunk = Math.max(0, Math.min(hunks.length - 1, hunk + delta));
  hunks[hunk].scrollIntoView({ block: 'center' });
}
let hunk = -1;

/** The legend, derived from what this view actually offers right now. */
function bindings() {
  let list = [[['j', 'k'], 'move'], ['↵', 'open'], ['u', 'up']];
  if (app.querySelector('[data-role="filter"]')) list.push(['/', 'filter']);
  if (select('vol')) list.push([['[', ']'], 'time travel']);
  if (select('vs')) list.push(['d', 'compare']);
  if (app.querySelector('pre.diff')) list.push([['n', 'p'], 'change']);
  if (app.querySelector('.note a[href^="/"]')) list.push(['o', 'raw bytes']);
  list.push([['g', 'G'], 'ends'], ['y', 'copy address'], [['1', '4'], 'apps']);
  return list;
}

addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  let tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    if (event.key === 'Escape') document.activeElement.blur();
    return;
  }
  let parsed = parseAddress(currentAt());
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
    case 'Enter':
    case 'ArrowRight':
      return openCursor();
    case 'u':
    case 'Backspace':
    case 'ArrowLeft':
      event.preventDefault();
      return go(parentAddress());
    case '[':
      return stepVolatility(-1);
    case ']':
      return stepVolatility(1);
    case 'n':
      return stepChange(1);
    case 'p':
      return stepChange(-1);
    case '/': {
      let filter = app.querySelector('[data-role="filter"]');
      if (filter) {
        event.preventDefault();
        filter.focus();
      }
      return;
    }
    case 'v':
      return select('vol')?.focus();
    case 'd':
      return select('vs')?.focus();
    case 'o': {
      // The bytes themselves — the other end of the one-prefix relationship
      // this whole app is built on.
      let raw = app.querySelector('.note a[href^="/"]');
      if (raw) location.href = raw.getAttribute('href');
      return;
    }
    case 'y':
      // The ADDRESS, not the page URL: what you would paste into a terminal
      // or another Hub, which is the thing worth copying.
      return navigator.clipboard?.writeText(currentAt());
    case 's':
      return parsed.depot ? go(`/${parsed.depot}/${HISTORY}`) : undefined;
    case 'Escape': {
      let filter = app.querySelector('[data-role="filter"]');
      if (filter?.value) {
        filter.value = '';
        filter.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    default:
  }
});

// Routing, in full. `popstate` plus one delegated click, because between four
// documents the browser already routes, and inside one the only things that
// must survive are scroll and selection.
addEventListener('popstate', render);

app.addEventListener('click', (event) => {
  let link = event.target.closest('a[data-at]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  go(link.dataset.at, link.dataset.vs ?? currentVs());
});

// Filtering is a DOM operation, not a re-render: hiding rows keeps scroll
// position, the sticky header, and whatever was selected. Re-rendering on
// every keystroke would lose all three.
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

// Click a header to sort: none → ascending → descending → none. The third
// state matters here because the default order is not "unsorted", it is the
// order the pack recorded, and getting back to it should not need a reload.
function toggleSort(key, column) {
  let sorting = SORT_STATE.get(key) ?? [];
  let active = sorting[0];
  if (!active || active.id !== column) SORT_STATE.set(key, [{ id: column, desc: false }]);
  else if (!active.desc) SORT_STATE.set(key, [{ id: column, desc: true }]);
  else SORT_STATE.delete(key);
  render();
}

const sortKeyOf = (head) =>
  head.closest('table')?.dataset.sortKey ?? `files:${currentAt()}`;

app.addEventListener('click', (event) => {
  let head = event.target.closest('th[data-role="sort"]');
  if (!head) return;
  toggleSort(sortKeyOf(head), head.dataset.column);
});

app.addEventListener('keydown', (event) => {
  let head = event.target.closest?.('th[data-role="sort"]');
  if (!head || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  toggleSort(sortKeyOf(head), head.dataset.column);
});

app.addEventListener('change', (event) => {
  let role = event.target.dataset.role;
  let parsed = parseAddress(currentAt());
  if (role === 'vol') {
    go(addressFor(parsed, event.target.value));
  } else if (role === 'vs' || role === 'vs-address') {
    go(currentAt(), event.target.value.trim());
  }
});

render();
