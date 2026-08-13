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
// L5 says a deck has three kinds of address. A depot with a Timeline has
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
import { installNavStyles, onLiveChange, wrapTables } from 'ui/nav';
import { resumeHubTour } from 'ui/tour';
import {
  activityCell,
  activityScale,
  installActivityStyles,
  loadActivity,
  onActivityChange,
  scoreOf,
} from 'ui/activity';
import {
  attachScrub,
  foldBursts,
  installTimelineStyles,
  stepBy,
  stepsFor,
  timelineHtml,
} from 'ui/timeline';
import { diffLines, diffWordsWithSpace, structuredPatch } from 'diff';
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
installActivityStyles();
installTimelineStyles();

const app = document.getElementById('app');
const keys = document.querySelector('deck-keys');
const subject = document.querySelector('deck-subject');

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
    // A `<` that is neither `<span` nor `</span>` would leave `next === index`
    // and `chunk` empty, and the loop would never advance — a hang, in a
    // function that runs on every file you open. hljs escapes its text so
    // this should not arise; "should not" is not a reason to be able to lock
    // the tab. Consume the character and carry on.
    if (next === index) {
      current += '<';
      index += 1;
      continue;
    }
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
// The Timeline, in the reading lens
//
// /run has the same scrubber and scopes it differently, and the difference is
// the whole reason both exist.
//
//   run     Steps that touched anything in the page's CLOSURE. You are
//           watching a running thing, and it breaks when a module it imports
//           three levels down changes — the change that matters is often not
//           in a file you have open.
//
//   browse  Steps that touched THIS PATH. You are reading bytes. A change to
//           a module this file imports does not change these bytes, and a
//           tape that jumped on it would offer you fifty notches that all
//           render the same text.
//
// Same component, same gesture, one predicate apart. Getting that predicate
// wrong is not a cosmetic difference: it decides whether stepping back shows
// you something different.
// ---------------------------------------------------------------------------

/**
 * The depot-relative prefix the current address is about, or '' for the whole
 * depot. `filesSummary` speaks depot-relative paths — the mount name is the
 * server's business and never appears in a seal — so a scope built from the
 * URL has to drop it too.
 */
function scopeOf(parsed) {
  if (parsed.seal) return parsed.path ?? '';
  return [parsed.publisher, parsed.pkg, parsed.path].filter(Boolean).join('/');
}

/**
 * The same thing, at another Step. `''` means live.
 *
 * A live address and a Step address are different SHAPES, not the same shape
 * with a field swapped: live is `/<depot>/<pub>/<pkg>/<path>` and a Step is
 * `/<depot>/_history/<id>/<pub>/<pkg>/<path>`. Stepping has to rebuild the
 * address rather than edit it, and stepping back to live has to know which
 * publisher and package the path belonged to — which is why the live address
 * is remembered rather than re-derived from a path that no longer carries it.
 */
function atStep(parsed, changeId) {
  let within = scopeOf(parsed);
  if (!changeId) {
    // Back to live. A path under `_history` is depot-relative, so its first
    // two segments are the publisher and package it lives in.
    if (!parsed.seal) return addressOf({ ...parsed, spec: undefined });
    let [publisher, pkg, ...rest] = within.split('/').filter(Boolean);
    return addressOf({
      depot: parsed.depot,
      publisher,
      pkg,
      path: rest.length ? rest.join('/') : undefined,
    });
  }
  return `/${[parsed.depot, HISTORY, changeId, within].filter(Boolean).join('/')}`;
}

/** The Timeline the last render drew, so the keys agree with what is on screen. */
let lastTimeline = [];

/**
 * The scrubber, or nothing at all.
 *
 * Nothing when the depot has no history backend (Versions ARE the
 * history, and a tape with no steps on it is furniture), and nothing on the
 * depot list, which is not an address in time.
 */
async function timelineBar(parsed) {
  if (!parsed.depot) return '';
  let scope = scopeOf(parsed);
  let steps = foldBursts(stepsFor(await sealsOf(parsed.depot), scope ? [scope] : []));
  lastTimeline = steps;
  if (!steps.length) return '';
  return timelineHtml({
    steps,
    current: parsed.seal && parsed.seal !== true ? String(parsed.seal) : '',
    // Not "undo". /run frames a running app, where stepping back IS the undo
    // preview. Here you are reading, and the honest word for moving a file
    // back through its saves is the file's own history.
    label: scope ? 'this path' : 'this depot',
  });
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
  // The trail goes to the shared subject bar, not into a prompt line of this
  // app's own. `~` is gone with it: it was a link labelled with a character
  // that meant "clear the subject" to nobody who had not been told, and the
  // bar now says `esc clear` in words.
  //
  // What the app still owns is the TYPING — only /browse knows that this
  // segment is a publisher and that one is a package, and the colours are
  // half of how an address is read here.
  subject.trail = trail
    .slice(1)
    .map(([label, at, cls], index, all) =>
      index === all.length - 1
        ? `<b class="${cls ?? ''}">${esc(label)}</b>`
        : `<a class="${cls ?? ''}" href="?at=${esc(at)}" data-at="${esc(at)}">${esc(label)}</a>`,
    )
    .join('<span class="sep">/</span>');
  return '';
}

/**
 * Every address this thing answers to, in one ordered list: live, tags,
 * versions, seals. The order is the order `[` and `]` step through, which is
 * roughly newest-to-oldest — the direction people actually travel when they
 * are looking for the moment something broke.
 */
/**
 * Newest version first, comparing numerically segment by segment.
 *
 * `String.sort()` is lexical, which orders `0.1.0-dev.10` before
 * `0.1.0-dev.2`. For a picker whose main job is "the one before this one",
 * that is not a rearrangement — it is the wrong answer.
 */
function byVersionDesc(a, b) {
  let parts = (value) => value.split(/[.\-+]/).map((bit) => (/^\d+$/.test(bit) ? Number(bit) : bit));
  let left = parts(a);
  let right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    let x = left[index];
    let y = right[index];
    if (x === y) continue;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    // A prerelease sorts BELOW the release it extends: 1.1.0 beats
    // 1.1.0-try.a, which is the rule ranges already follow (C3).
    if (typeof x === typeof y) return x < y ? 1 : -1;
    return typeof x === 'number' ? -1 : 1;
  }
  return 0;
}

/** `4m ago` · `2h ago` · `3d ago`, for labelling a moment. */
function relative(timestamp) {
  let then = Date.parse(timestamp ?? '');
  if (!Number.isFinite(then)) return 'unknown';
  let seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/**
 * WHICH CLOCK. A vendored version has two times and they are years apart.
 *
 * `upstreamPublishedAt` is when npm published three.js r150. `publishedAt` is
 * when this depot took it. Showing only the second makes a 2021 library look
 * like today's news because someone ran `deck vendor` this morning; showing
 * only the first hides the fact that we adopted it this morning, which is the
 * part with a decision behind it.
 *
 * So: upstream leads when it exists, because it is what the version IS, and
 * the local time follows as "vendored". A version nobody vendored has one
 * clock and says one thing. A version with neither says nothing at all —
 * records written before these fields existed have no honest time, and
 * "unknown" in a dropdown is noise where an empty space is not.
 */
function whenPublished(meta, version) {
  let record = meta?.versions?.[version];
  let upstream = record?.upstreamPublishedAt;
  let local = record?.publishedAt;
  if (upstream && local) {
    return `${relative(upstream)} upstream · vendored ${relative(local)} · `;
  }
  return upstream || local ? `${relative(upstream ?? local)} · ` : '';
}

/**
 * The instant a version should SORT by, as a number, newest largest.
 *
 * Upstream first for the same reason it is shown first — an ordering by when
 * we happened to run the vendor command is an ordering of our own typing, not
 * of the software. Unknown sorts last rather than first: absent is not new.
 */
export function publishedOrder(record) {
  let when = Date.parse(record?.upstreamPublishedAt ?? record?.publishedAt ?? '');
  return Number.isFinite(when) ? when : -Infinity;
}

function addressOptions(parsed, meta, seals) {
  let options = [];
  if (meta?.live) {
    options.push({ value: '', label: 'live', note: 'bytes on disk · no-store', kind: 'live' });
  }
  for (let [tag, version] of Object.entries(meta?.distTags ?? {})) {
    options.push({ value: tag, label: tag, note: `→ ${version} · one hop`, kind: 'tag' });
  }
  // NEWEST FIRST, AND BY NUMBER. A lexical sort puts dev.10 between dev.1 and
  // dev.2, so the list read `dev.2, dev.10, dev.1` — which is not an ordering
  // anybody can use to find "the one before this one", the single most common
  // reason to open this control.
  for (let version of Object.keys(meta?.versions ?? {}).sort(byVersionDesc)) {
    options.push({
      value: version,
      label: version,
      note: `${whenPublished(meta, version)}immutable · forever`,
      kind: 'exact',
    });
  }
  // Seals only make sense for something with a live tree: a seal captures the
  // working tree, so a deck that exists only in the store was never in one.
  if (meta?.live && parsed.publisher && parsed.pkg) {
    for (let seal of seals ?? []) {
      options.push({
        // A twelve-character change id is not a thing anyone recognises, so
        // the LABEL is the time and the id is the note. You pick a step by
        // when it happened; the id is what you copy afterwards.
        value: `seal:${seal.changeId}`,
        // Time AND a short id: three saves in the same minute all read "15m
        // ago", and a picker whose entries are indistinguishable is a picker
        // you cannot use. The clock says which era, the id says which one.
        label: `${relative(seal.timestamp)} · ${seal.changeId.slice(0, 8)}`,
        note: `${(seal.timestamp ?? '').slice(0, 16).replace('T', ' ')} · ${
          seal.changeId.slice(0, 12)
        } · ${seal.description?.replace(/^save:\s*/, '') ?? 'step'}`.slice(0, 78),
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
    `<span class="vol" data-tour="vol" data-kind="${kind}"><label>version</label> ` +
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
    `</div>`
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
function sortableHead(columns, sorting, extraClass = '', gutter = false) {
  let active = sorting[0];
  return (
    `<thead><tr>` +
    // The heat gutter is not sortable and has no label: it is read at a
    // glance, and a column heading over a 3px bar is more furniture than fact.
    (gutter ? `<th class="heat-cell"></th>` : '') +
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
  let ordered = [...dirs, ...files];
  // Heat is keyed on the LIVE address — `/hub/app/run/run.js` — because that
  // is the path the depot's history records. A sealed view of the same file
  // carries the same heat, which is correct: the heat is a fact about the
  // work, not about which representation you happen to be reading.
  let heats = ordered.map((entry) =>
    scoreOf(`/${parsed.depot}/${parsed.publisher}/${parsed.pkg}/${entry.path}`),
  );
  let scale = activityScale(heats.map((entry) => entry.score));
  let body = ordered
    .map((entry, index) => {
      let at = addressOf({ ...parsed, path: entry.path });
      return (
        `<tr data-name="${esc(entry.name.toLowerCase())}">` +
        activityCell(scale(heats[index].score), { last: heats[index].last, claims: heats[index].claims }) +
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
    `<table data-sort-key="${esc(key)}">${sortableHead(FILE_COLUMNS, sorting, '', true)}` +
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

/**
 * A package's digest inventory — sealed Version or live working tree.
 *
 * Exact `@version?meta` reads the packlist; live `publisher/pkg?meta` walks
 * the working tree with tree-hash-v1. Same `tree[]` shape either way, so
 * compare can do "this -dev.N vs live" without pretending live is latest.
 */
const metaOf = (target) => {
  if (!target?.publisher || !target?.pkg || target.seal) {
    return Promise.resolve(undefined);
  }
  return getJson(`${addressOf({ ...target, path: undefined })}?meta`)
    .then((body) => body.data?.attributes)
    .catch(() => undefined);
};

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
        ''
      : `<p class="dim">no differences</p>`)
  );
}

/** File level: which lines differ. */
// ── Review: many files, cropped to what changed ────────────────────────────
//
// Printing whole files was honest and unusable. A save that touches three
// lines in a 900-line module produced 900 lines of evidence, and the reader
// had to find the point themselves — so `diff →` was technically answering
// the question and practically refusing to.
//
// This is the arrangement every code review tool converged on, for the reason
// they all converged on it: show the changed lines with a few lines of
// context, replace every other run with a control that says how much is being
// withheld and reveals it in place.
//
// NO EDITOR, AND NO NEW DEPENDENCY. It is tempting to reach for CodeMirror
// here, and it would be a category error — an editor exists to support typing
// and this surface is read-only, so you would ship a document model,
// selection, input handling and undo to render text you cannot edit, and
// still write the hunk logic yourself. `structuredPatch` was already inside
// the `diff` deck this app vendored for line diffs; so was
// `diffWordsWithSpace`. Both went unused until now.
const CONTEXT = 3;

/**
 * Word-level marking within a changed line.
 *
 * A one-character change in a long line is invisible when the whole line is
 * red and the whole replacement is green — you are told a line changed and
 * left to spot the difference. Only for runs where the removals and additions
 * pair up one-to-one; anything else is a rewrite, and inventing a
 * correspondence for it produces confetti.
 */
function pairWords(removed, added) {
  if (removed.length !== added.length || !removed.length) return undefined;
  return removed.map((before, index) => {
    let parts = diffWordsWithSpace(before, added[index]);
    let left = '';
    let right = '';
    for (let part of parts) {
      let text = esc(part.value);
      if (part.added) right += `<u class="w-add">${text}</u>`;
      else if (part.removed) left += `<u class="w-del">${text}</u>`;
      else {
        left += text;
        right += text;
      }
    }
    return [left, right];
  });
}

function diffLine(mark, oldNumber, newNumber, html) {
  return (
    `<span class="ln" data-mark="${mark === ' ' ? '' : mark}">` +
    `<i class="gut">${oldNumber || ''}</i><i class="gut">${newNumber || ''}</i>` +
    `<b class="mk">${mark}</b>${html || '&#8203;'}</span>`
  );
}

/** A run of unchanged lines nobody asked to see, and the way to see it. */
function gapRow(id, from, to) {
  let count = to - from;
  if (count <= 0) return '';
  return (
    `<span class="ln gap" data-gap="${id}" data-from="${from}" data-to="${to}" ` +
    `tabindex="0" role="button">` +
    `<i class="gut"></i><i class="gut"></i><b class="mk">⋯</b>` +
    `${count} unchanged line${count === 1 ? '' : 's'}</span>`
  );
}

/**
 * One file's worth of review.
 *
 * `id` namespaces the gap controls so several files can sit on one page
 * without their expanders colliding — which is the whole point of the
 * multi-file view, and the thing that breaks first if the ids are positional.
 */
/**
 * `href`/`vs` make the heading a way through to the file itself.
 *
 * A review page shows twelve files cropped to their changed lines, which is
 * the right default and is not always enough — the next question after "what
 * changed here" is "what does the rest of this file look like", and the path
 * printed at the top of each section is exactly where a reader points to ask
 * it. It was inert text, so the answer was: retype the address.
 *
 * The link carries the SAME PAIR the review is showing, not just the file. A
 * heading that dropped `vs` would land you on the file with no comparison
 * selected, which is a different page than the one the click promised.
 */
function reviewFile({ id, path, before, after, open = true, href, vs }) {
  let beforeLines = before.split('\n');
  let afterLines = after.split('\n');
  if (beforeLines.at(-1) === '') beforeLines.pop();
  if (afterLines.at(-1) === '') afterLines.pop();

  let patch = structuredPatch('a', 'b', before, after, '', '', { context: CONTEXT });
  let added = 0;
  let removed = 0;
  let body = '';
  let cursor = 1; // next unshown line, in NEW-file numbering

  for (let [index, hunk] of patch.hunks.entries()) {
    body += gapRow(`${id}:${index}`, cursor, hunk.newStart);
    let oldNumber = hunk.oldStart;
    let newNumber = hunk.newStart;
    // Buffer consecutive removals so the additions that follow can be paired
    // against them for word-level marking.
    let pendingRemoved = [];
    let flush = (addedLines) => {
      let paired = pairWords(pendingRemoved, addedLines);
      pendingRemoved.forEach((line, position) => {
        body += diffLine('-', oldNumber - pendingRemoved.length + position, '',
          paired ? paired[position][0] : esc(line));
      });
      addedLines.forEach((line, position) => {
        body += diffLine('+', '', newNumber - addedLines.length + position,
          paired ? paired[position][1] : esc(line));
      });
      pendingRemoved = [];
    };
    let pendingAdded = [];
    for (let raw of hunk.lines) {
      let mark = raw[0];
      let text = raw.slice(1);
      if (mark === '-') {
        if (pendingAdded.length) {
          flush(pendingAdded);
          pendingAdded = [];
        }
        pendingRemoved.push(text);
        oldNumber += 1;
        removed += 1;
      } else if (mark === '+') {
        pendingAdded.push(text);
        newNumber += 1;
        added += 1;
      } else {
        flush(pendingAdded);
        pendingAdded = [];
        body += diffLine(' ', oldNumber, newNumber, esc(text));
        oldNumber += 1;
        newNumber += 1;
      }
    }
    flush(pendingAdded);
    cursor = newNumber;
  }
  body += gapRow(`${id}:end`, cursor, afterLines.length + 1);

  return (
    `<section class="review" data-file="${esc(id)}" data-open="${open ? 1 : 0}">` +
    `<header class="review-head" data-role="fold" tabindex="0" role="button">` +
    `<b class="fold-mark">${open ? '▾' : '▸'}</b>` +
    (href
      ? `<a class="review-path" href="?at=${esc(href)}${vs ? `&vs=${esc(vs)}` : ''}" ` +
        `data-at="${esc(href)}"${vs ? ` data-vs="${esc(vs)}"` : ''} ` +
        `title="open this file at this version">${esc(path)}</a>`
      : `<span class="review-path">${esc(path)}</span>`) +
    `<span class="review-count">` +
    (added ? `<b class="ok">+${added}</b>` : '') +
    (removed ? ` <b class="bad">−${removed}</b>` : '') +
    (!added && !removed ? `<span class="dim">byte-identical</span>` : '') +
    `</span></header>` +
    `<pre class="blob diff" data-lines="${afterLines.length}">${body}</pre>` +
    `</section>`
  );
}

// The texts stay in memory so expanding a gap is a slice rather than another
// pair of requests. A review page has already fetched both sides of every
// file it is showing; going back to the network to reveal lines it is
// holding would be the kind of thing that makes a UI feel slow for no reason.
const reviewTexts = new Map();

function fileDiffView(leftText, rightText, leftLabel, rightLabel) {
  reviewTexts.set('one', { before: leftText, after: rightText });
  return (
    `<div class="diffhead"><span class="dim">base</span> ` +
    `<b class="s-base">${esc(leftLabel)}</b> <span class="dim">→ viewing</span> ` +
    `<b class="s-head">${esc(rightLabel)}</b></div>` +
    reviewFile({
      id: 'one',
      path: rightLabel,
      before: leftText,
      after: rightText,
    })
  );
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function viewDepots() {
  let { data } = await getJson('/_packages');
  // Heat first, so the list arrives already sorted by where the work is
  // rather than alphabetically by an accident of naming.
  let scored = data.map((depot) => ({ depot, ...scoreOf(`/${depot.name}`) }));
  let scale = activityScale(scored.map((row) => row.score));
  return (
    `<h1>depots on this server</h1>` +
    `<table><thead><tr><th class="heat-cell"></th><th>depot</th>` +
    `<th class="num">decks</th>` +
    `<th>history</th><th>on disk</th></tr></thead><tbody>` +
    scored
      .map(
        ({ depot, score, last, claims }) =>
          `<tr data-name="${esc(depot.name)}">` +
          activityCell(scale(score), { last, claims }) +
          `<td><a class="s-depot" href="?at=/${esc(depot.name)}" ` +
          `data-at="/${esc(depot.name)}">${esc(depot.name)}</a></td>` +
          `<td class="num">${depot.packages.length}</td>` +
          `<td>${
            depot.history
              ? `<a class="s-seal" href="?at=/${esc(depot.name)}/${HISTORY}" ` +
                `data-at="/${esc(depot.name)}/${HISTORY}">Timeline</a>`
              : '<span class="dim">Versions</span>'
          }</td>` +
          `<td class="dim">${esc(depot.dir)}</td></tr>`,
      )
      .join('') +
    `</tbody></table>`
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
  let heats = decks.map((deck) =>
    scoreOf(`/${depot.name}/${deck.publisher}/${deck.name}`),
  );
  let scale = activityScale(heats.map((entry) => entry.score));
  let rows = decks
    .map((deck, index) => {
      let at = `/${depot.name}/${deck.publisher}/${deck.name}`;
      let versions = Object.keys(deck.versions ?? {});
      let newest = deck.distTags?.latest ?? versions.at(-1);
      return (
        `<tr data-name="${esc(`${deck.publisher}/${deck.name}`.toLowerCase())}">` +
        activityCell(scale(heats[index].score), { last: heats[index].last, claims: heats[index].claims }) +
        `<td><a href="?at=${esc(at)}" data-at="${esc(at)}">` +
        `${parsed.publisher ? '' : `<span class="s-publisher">${esc(deck.publisher)}</span><span class="sep">/</span>`}` +
        `<span class="s-package">${esc(deck.name)}</span></a></td>` +
        `<td class="num dim">${versions.length}</td>` +
        `<td class="s-version">${newest ? esc(newest) : '<span class="dim">—</span>'}</td>` +
        `<td>${
          deck.live
            ? '<span class="s-version" data-live>live</span> <span class="dim">+ Versions</span>'
            : '<span class="dim">Versions only</span>'
        }</td></tr>`
      );
    })
    .join('');
  return (
    crumbs(parsed) +
    `<main><div class="facts" data-tour="facts">` +
    `<div><b>decks</b> ${decks.length}</div>` +
    `<div><b>live</b> ${decks.filter((deck) => deck.live).length}</div>` +
    `<div><b>history</b> ${
      depot.history
        ? `<a class="s-seal" href="?at=/${esc(depot.name)}/${HISTORY}" data-at="/${esc(depot.name)}/${HISTORY}">${esc(depot.history)}</a>`
        : 'Versions only'
    }</div></div>` +
    filterBox(decks.length, 'decks') +
    `<table><thead><tr><th class="heat-cell"></th><th>deck</th>` +
    `<th class="num">versions</th>` +
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
      `<main><p class="dim">History: Versions — no Timeline</p></main>`
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
    `<main><div class="facts" data-tour="facts"><div><b>steps</b> ${seals.length}</div>` +
    `<div><b>newest</b> <span class="s-seal">${esc(seals[0].changeId.slice(0, 12))}</span></div></div>` +
    filterBox(seals.length, 'steps') +
    `<table><thead><tr><th>step id</th><th>when</th><th class="num">files</th>` +
    `<th>what changed</th></tr></thead><tbody>${rows}</tbody></table>` +
    `</main>`
  );
}

/** One seal: the whole depot tree as it was at that moment. */
async function viewSeal(parsed, vs) {
  let { data } = await getJson(`/${parsed.depot}/${HISTORY}/${parsed.seal}`);
  let attrs = data.attributes;
  if (!attrs.filesAvailable) {
    return (
      crumbs(parsed) +
      `<main><p class="dim">Timeline cannot list files for this step</p></main>`
    );
  }
  let files = attrs.files ?? [];

  // Two seals: what this save did to the depot. A save that touched several
  // decks arrives here rather than at a single file, and each row descends
  // into the per-file diff carrying both revisions with it.
  if (vs) {
    let other = await getJson(vs.replace(/^\/([^/]+)\/_history\//, '/$1/_history/'))
      .then((body) => body.data.attributes)
      .catch(() => undefined);
    if (!other?.filesAvailable) {
      throw Object.assign(new Error(`cannot read ${vs} to compare against`), {
        code: 'no-manifest',
      });
    }
    let beforePaths = new Set(other.files ?? []);
    let afterPaths = new Set(files);

    // WHAT THIS SAVE TOUCHED COMES FROM THE SEAL LOG, NOT THE SEAL.
    //
    // `GET /<depot>/_history/<changeId>` answers with the whole tree as it
    // was — 21 paths — and no statement about which of them this save
    // changed. Only the LIST endpoint carries `filesSummary`. Reading it off
    // the single-seal response therefore found nothing, fell through to
    // "paths present on one side only", and rendered an empty diff for every
    // save that merely modified files. Which is almost all of them.
    //
    // The list is already fetched and memoised for the volatility control, so
    // this costs nothing. A manifest lists paths and not hashes, so without
    // that summary there is no way to know which shared path differs short of
    // fetching every file on both sides — and listing the entire tree as
    // changed would be worse than useless.
    let seals = await sealsOf(parsed.depot);
    let record = seals.find((seal) => seal.changeId === parsed.seal);
    let touched = new Set(
      (record?.filesSummary ?? []).map((line) => line.replace(/^[A-Z]\s+/, '').trim()),
    );
    let rows = touched.size
      ? [...touched].sort()
      : [...new Set([...beforePaths, ...afterPaths])]
          .filter((path) => !beforePaths.has(path) || !afterPaths.has(path))
          .sort();
    // EVERY FILE, ON ONE PAGE. This is the `3 files edited` row's landing
    // site, and sending it to a LIST of three files would be answering "what
    // changed" with "here are three places you could go and find out".
    //
    // Both sides of every touched file, fetched together, rendered cropped.
    // The cost is bounded by what the save touched rather than by the size of
    // the depot, which is why this is affordable at all: a save is small even
    // when the tree is not.
    reviewTexts.clear();
    let sides = await Promise.all(
      rows.map(async (path) => {
        let at = `/${parsed.depot}/${HISTORY}/${parsed.seal}/${path}`;
        let against = `${vs}/${path}`;
        // A miss on either side is not a failure: it is `added` or `removed`,
        // and the empty string is the correct text for a file that was not
        // there.
        let [after, before] = await Promise.all([
          fetch(at).then((response) => (response.ok ? response.text() : '')),
          fetch(against).then((response) => (response.ok ? response.text() : '')),
        ]);
        return { path, at, against, before, after };
      }),
    );
    let addedTotal = 0;
    let removedTotal = 0;
    let body = sides
      .map((file, index) => {
        let id = `f${index}`;
        reviewTexts.set(id, { before: file.before, after: file.after });
        let patch = structuredPatch('a', 'b', file.before, file.after, '', '', {
          context: CONTEXT,
        });
        for (let hunk of patch.hunks) {
          for (let line of hunk.lines) {
            if (line[0] === '+') addedTotal += 1;
            else if (line[0] === '-') removedTotal += 1;
          }
        }
        return reviewFile({
          id,
          path: file.path,
          before: file.before,
          after: file.after,
          // Both sides, already computed above: `at` is this file at the
          // viewed step, `against` is the same file at the base.
          href: file.at,
          vs: file.against,
          // Everything open by default: a save touches a handful of files and
          // collapsing them by default would add a click per file to reach
          // the thing the page exists to show. Big diffs fold themselves —
          // see below.
          open: sides.length <= 12,
        });
      })
      .join('');
    return (
      crumbs(parsed) +
      `<main><div class="diffhead">` +
      `<span class="dim">base</span> <b class="s-base">${esc(shortSeal(vs))}</b> ` +
      `<span class="dim">→ viewing</span> ` +
      `<b class="s-head">${esc(String(parsed.seal).slice(0, 12))}…</b> · ` +
      `<b>${rows.length}</b> file${rows.length === 1 ? '' : 's'} · ` +
      `<b class="ok">+${addedTotal}</b> <b class="bad">−${removedTotal}</b>` +
      `</div>` +
      (rows.length ? body : `<p class="dim">no differences</p>`) +
      `</main>`
    );
  }
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
    `<main><div class="facts" data-tour="facts">` +
    `<div><b>step</b> <span class="s-seal">${esc(parsed.seal)}</span></div>` +
    `<div><b>backend</b> ${esc(attrs.backend)}</div>` +
    `<div><b>files</b> ${files.length}</div></div>` +
    filterBox(files.length, 'files') +
    `<table><thead><tr><th>path</th></tr></thead><tbody>${rows}</tbody></table>` +
    `</main>`
  );
}

/**
 * A file inside a seal — and, with `vs`, the diff that a /track row means.
 *
 * This is the landing site for "what did that save actually change". A row in
 * /track knows two seals and one path, which is exactly a diff; before this
 * it could only hand over the after-state, so the answer to "what changed"
 * was a whole file and an invitation to read it.
 *
 * `vs` is a full seal address, so it may name a different path as well as a
 * different revision. That is what makes a rename representable rather than
 * an add next to an unrelated delete.
 */
async function viewSealFile(parsed, vs) {
  let url = addressOf(parsed);
  let response = await fetch(url);
  if (!response.ok) {
    throw Object.assign(new Error(`${parsed.path} is not in this seal`), {
      code: 'file-not-found',
    });
  }
  let text = await response.text();

  if (vs) {
    // Absent on the other side means this save CREATED the file, which is a
    // real and common answer — every line is an addition. Treating a 404 as
    // an error here would make "added" look like a broken link.
    let before = await fetch(vs).then((other) => (other.ok ? other.text() : ''));
    // A STRING, not `{html}`. The object form is the contract for "there is a
    // blob to stream in after paint", and render() will go looking for the
    // `#blob` element it implies. A diff has already rendered its own body.
    return (
      crumbs(parsed) +
      `<main>` +
      fileDiffView(before, text, shortSeal(vs), shortSeal(url)) +
      `</main>`
    );
  }

  return {
    html:
      crumbs(parsed) +
      `<main><div class="facts" data-tour="facts">` +
      `<div><b>kind</b> step</div>` +
      `<div><b>step</b> <span class="s-seal">${esc(String(parsed.seal).slice(0, 12))}</span></div>` +
      `<div><b>size</b> ${esc(bytes(text.length))}</div></div>` +
      `<p class="raw"><a href="${esc(url)}">raw</a></p>` +
      `<div id="blob"></div></main>`,
    text,
    path: parsed.path,
  };
}

/** `pzpsvyqoysw… /app/run/run.js` — enough of a seal address to tell two apart. */
function shortSeal(address) {
  let match = String(address).match(/\/_history\/([^/]+)(\/.*)?$/);
  return match ? `${match[1].slice(0, 12)}…${match[2] ?? ''}` : String(address);
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
    `<main><div class="facts" data-tour="facts">` +
    (meta ? volatility(parsed, meta, seals) + compare(parsed, meta, seals, vs) : '') +
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
        `<p class="dim">added — not in ${esc(addressOf(target))}</p></main>`
      );
    }
    if (attrs.binary || other.binary) {
      return (
        head +
        `<p class="dim">binary · digests ` +
        `${attrs.sha256 && attrs.sha256 === other.sha256 ? 'agree' : 'differ'}</p></main>`
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
    head += `<p class="raw"><a href="${esc(raw)}">raw</a></p>`;
    if (attrs.binary) {
      return (
        head +
        `<p class="dim">binary</p>` +
        `<p><a href="${esc(raw)}" download>download</a></p></main>`
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
    // Keep live as live. Substituting `latest` here used to hide unpublished
    // edits and, when there was no `latest`, produced the bogus "no manifest
    // for @live" note even though the digests were one ?meta away.
    let here = { ...parsed };
    let [left, right] = await Promise.all([metaOf(target), metaOf(here)]);
    if (!left || !right) {
      let missing = [!right && labelOf(here), !left && labelOf(target)].filter(Boolean);
      return (
        head +
        `<p class="note">no digest inventory for ${missing.map(esc).join(' or ')}. ` +
        `Compare needs two package roots (live or a Version).</p></main>`
      );
    }
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
    `<b>${esc(error.code ?? 'error')}</b> — ${esc(error.message)}` +
    `<p class="dim">${
      permanence === 'permanent'
        ? 'permanent — this address can never resolve'
        : 'transient — not published yet'
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
    else if (parsed.seal && !parsed.path) out = await viewSeal(parsed, vs);
    else if (parsed.seal) out = await viewSealFile(parsed, vs);
    else if (parsed.pkg) out = await viewAddress(parsed, vs);
    else out = await viewCatalog(parsed);

    // The tape goes ABOVE the view, outside whatever that view builds, so it
    // is in the same place on every page rather than something each view has
    // to remember to include.
    let tape = await timelineBar(parsed);
    if (typeof out === 'string') {
      app.innerHTML = tape + out;
    } else {
      app.innerHTML = tape + out.html;
      document.getElementById('blob').append(blob(out.text, out.path));
      if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
    }
  } catch (error) {
    app.innerHTML = errorView(parsed, error);
  }
  cursor = -1;
  wrapTables(app);
  keys.keys = bindings();

  // SCRUB PREVIEWS NOTHING HERE; RELEASE COMMITS.
  //
  // /run previews during the drag, because swapping an iframe's src is one
  // assignment against an already-cached closure. Reading is not that: a
  // preview would be a fetch and a re-highlight per animation frame, and
  // sixty of those across one drag is how you make the fastest thing in the
  // app the slowest.
  //
  // Nothing is lost, because the popover under the pointer already reports
  // what each Step was — when, who, which files, and anything they said —
  // which is the question you are asking WHILE dragging. The bytes are the
  // answer to the question you ask by letting go.
  attachScrub(app, {
    onCommit: (step) => {
      let now = parseAddress(currentAt());
      let target = atStep(now, step);
      if (target !== currentAt()) go(target);
    },
  });

  // A DIFF OPENS ON THE CHANGE — ONCE.
  //
  // Landing at line 1 of a 900-line file to report that 23 lines differ makes
  // the reader hunt for the point, and a /track row that said `diff →`
  // promised the change, not the file it is in.
  //
  // But only on ARRIVAL. This used to run on every render, and /browse
  // re-renders whenever the depot changes — so while an agent was working,
  // the page yanked itself back to the first hunk every few seconds. The
  // reader scrolls, it snaps back, and the app looks stuck. It was the same
  // bug as a scroll-restoring loop: the fix is to notice that re-rendering
  // the same address is not arriving at it.
  if (arrived !== `${currentAt()}|${currentVs()}`) {
    arrived = `${currentAt()}|${currentVs()}`;
    hunk = -1;
    if (currentVs() && app.querySelector('pre.diff')) stepChange(1);
  }
  maybeResumeTour();
}

let arrived = '';
let tourResumed = false;
function maybeResumeTour() {
  if (tourResumed) return;
  tourResumed = true;
  resumeHubTour({ waitMs: 80 });
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
 * `[` and `]` move back and forward through time.
 *
 * THE TAPE FIRST, when there is one. It is scoped to this path, so every
 * keystroke lands on a Step where these bytes actually changed — holding `]`
 * walks the file's own edits and nothing else. That is the loop for finding
 * the save that broke something, and it is the same keys as /run so the
 * gesture survives switching lens.
 *
 * The volatility list is the fallback and stays the right answer where there
 * is no tape: a store-only deck has versions and tags and no Steps at all,
 * and `live → tags → versions` is still an ordering through time.
 */
function stepTime(delta) {
  if (lastTimeline.length) {
    let parsed = parseAddress(currentAt());
    let here = parsed.seal && parsed.seal !== true ? String(parsed.seal) : '';
    return go(atStep(parsed, stepBy(lastTimeline, here, delta)));
  }
  return stepVolatility(delta);
}

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
  // The legend is derived from the view, so it has to name what the keys
  // will ACTUALLY do here — the tape when there is one, the volatility list
  // when there is not. Two different moves through time, one pair of keys.
  if (lastTimeline.length) list.push([['[', ']'], 'step']);
  else if (select('vol')) list.push([['[', ']'], 'time travel']);
  if (select('vs')) list.push(['d', 'compare']);
  if (app.querySelector('pre.diff')) list.push([['n', 'p'], 'change']);
  if (app.querySelector('.note a[href^="/"]')) list.push(['o', 'raw bytes']);
  list.push([['g', 'G'], 'ends'], ['y', 'copy address']);
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
      return stepTime(-1);
    case ']':
      return stepTime(1);
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

/**
 * Reveal a withheld run, in place.
 *
 * Both texts are already in memory — the page fetched them to compute the
 * diff — so this is a slice and an insertion, not a request. The control
 * replaces itself with the lines it was hiding, which means there is nothing
 * to collapse again and nothing to keep in sync: the DOM is the state.
 *
 * Numbering comes from the NEW side, which is the side these lines are
 * unchanged in. They are unchanged, so the old numbers would be a different
 * arithmetic for the same rows, and printing both invites the reader to
 * check a subtraction that is never interesting.
 */
function expandGap(control) {
  let [id] = control.dataset.gap.split(':');
  let texts = reviewTexts.get(id);
  if (!texts) return;
  let lines = texts.after.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let from = Number(control.dataset.from);
  let to = Number(control.dataset.to);
  let html = '';
  for (let number = from; number < to; number += 1) {
    html += diffLine(' ', number, number, esc(lines[number - 1] ?? ''));
  }
  control.outerHTML = html;
}

app.addEventListener('click', (event) => {
  let gap = event.target.closest('.gap[data-gap]');
  if (gap) return expandGap(gap);

  // The tape: a notch is a position, the jump buttons are relative moves.
  // Both resolve to an address and go there — same as clicking a file.
  let notch = event.target.closest('[data-role="step"]');
  if (notch) return go(atStep(parseAddress(currentAt()), notch.dataset.step));

  let by = event.target.closest('[data-role="step-by"]');
  if (by) {
    let parsed = parseAddress(currentAt());
    let here = parsed.seal && parsed.seal !== true ? String(parsed.seal) : '';
    return go(atStep(parsed, stepBy(lastTimeline, here, Number(by.dataset.by))));
  }

  // The fold header now contains a link to the file itself, and the header is
  // the larger target — so the specific thing has to be tested first or the
  // link can never be clicked, only folded.
  let fold = event.target.closest('a[data-at]')
    ? undefined
    : event.target.closest('[data-role="fold"]');
  if (fold) {
    let section = fold.closest('.review');
    let open = section.dataset.open === '1';
    section.dataset.open = open ? '0' : '1';
    fold.querySelector('.fold-mark').textContent = open ? '▸' : '▾';
    return;
  }

  let link = event.target.closest('a[data-at]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  go(link.dataset.at, link.dataset.vs ?? currentVs());
});

// Both controls are reachable from the keyboard, because both are buttons in
// everything but element name — and a review you can only operate with a
// pointer is a review this app's own legend would be lying about.
app.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  let gap = event.target.closest?.('.gap[data-gap]');
  if (gap) {
    event.preventDefault();
    return expandGap(gap);
  }
  let fold = event.target.closest?.('[data-role="fold"]');
  if (fold) {
    event.preventDefault();
    fold.click();
  }
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

// List first, heat later. Waiting on `/_activity` gated the file catalog
// behind a multi-depot seal walk — the bytes were ready in milliseconds and
// the page sat on loading… anyway. Paint undecorated; decorate when ready.
//
// LISTS ONLY. Heat decorates rows; it does not appear in a blob or a diff, so
// re-rendering one on every save buys nothing and costs everything — it
// discards scroll position, any gap the reader had expanded, and any file
// they had folded, several times a minute while an agent is running. Reading
// code in a live depot has to be possible.
onActivityChange(() => {
  if (app.querySelector('pre.blob')) return;
  render();
});
onLiveChange(() => loadActivity());

render();
loadActivity();
