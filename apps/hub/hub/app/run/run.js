// /run — the assembled, executing thing.
//
//   ?at=/three-js/app/studio/index.html   what to run
//   &with=lib/three=me/three@0.160.0-holo…  swap a part, without a checkout
//
// NO MODE. The page runs, and underneath it is the table of what it resolved
// to. There was a run/read toggle here and it was ceremony: both facts fit on
// one screen, and making them alternatives meant you could only ever see half
// of the thing the app exists to show.
//
// The table is not "view source" — /browse is view source. It is the RESOLVED
// import map, the exact one the server injected into the document that ran,
// with every node linking into /browse at the address that answered. On any
// other package site "what am I actually running" is an inference. Here it is
// a readout, sitting directly below the thing doing the running.
import 'ui/nav';
import { installNavStyles, onLiveChange, wrapTables } from 'ui/nav';
import { resumeHubTour } from 'ui/tour';
import {
  attachScrub,
  foldBursts,
  installHistoryStyles,
  measureFrame,
  stepBy,
  stepsFor,
  historyHtml,
} from 'ui/history';
import {
  ago,
  activityCell,
  activityScale,
  installActivityStyles,
  loadActivity,
  onActivityChange,
  scoreOf,
} from 'ui/activity';

installNavStyles();
installActivityStyles();
installHistoryStyles();

const app = document.getElementById('app');
const keys = document.querySelector('deck-keys');
const subject = document.querySelector('deck-subject');

const esc = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

const params = () => new URLSearchParams(location.search);
const currentAt = () => params().get('at') ?? '';
// Run keeps substitutions as UI-only `sub` params. The framed document gets
// Deck's protocol-level `with` query in `runTarget`; putting `with` on this
// app document would ask the server to substitute app/run itself on reload.
const currentWith = () => [...params().getAll('sub'), ...params().getAll('with')];
/** Which Step the stage is showing. '' is live — a position, not a mode. */
const currentStep = () => params().get('step') ?? '';

const HISTORY = '_history';

/**
 * The Hub's four apps, which are the instrument rather than a specimen.
 * `/hub/ui/*` and `/hub/theme/*` are ordinary decks and frame like anything
 * else — the rule is exactly as narrow as the problem it solves.
 */
function isHubApp(at) {
  let [, depot, publisher] = at.split('/');
  return depot === 'hub' && publisher === 'app';
}

/**
 * The History for a running page: every Step that touched ANYTHING it loads.
 *
 * Not just the page's own file. You are watching the assembled thing, and a
 * palette three decks away changes what you see — so "undo" has to mean "the
 * state before the last change that affected this", or stepping back will
 * appear to do nothing while the screen changes under you.
 *
 * The closure is free: /run already parses the resolved import map to draw
 * the table under the stage, and that map IS the set of pins the page loads.
 * No graph walk, no second request.
 */
function closureOf(at, map) {
  let prefixes = new Set();
  let own = at.replace(/^\//, '').split('/');
  if (own.length >= 3) prefixes.add(`${own[1]}/${own[2].split('@')[0]}`);
  let add = (target) => {
    let parts = String(target).replace(/^\//, '').split('/');
    // /<depot>/<publisher>/<package>[@v]/… — depot-relative for filesSummary.
    if (parts.length >= 3) prefixes.add(`${parts[1]}/${parts[2].split('@')[0]}`);
  };
  for (let target of Object.values(map?.imports ?? {})) add(target);
  for (let table of Object.values(map?.scopes ?? {})) {
    for (let target of Object.values(table)) add(target);
  }
  return [...prefixes];
}

/** The depot's every-save tape. Memoised: it is one request per depot. */
const stepCache = new Map();
function stepsOf(depot) {
  if (!stepCache.has(depot)) {
    stepCache.set(
      depot,
      getJson(`/${depot}/${HISTORY}`)
        .then((body) => body.data.map((step) => step.attributes))
        // Version history only. Not an error — fewer addresses.
        .catch(() => []),
    );
  }
  return stepCache.get(depot);
}

/**
 * The focused address as coloured, clickable segments.
 *
 * /browse can type these properly because it has parsed the address; here the
 * first three segments are depot, publisher and package by position, which is
 * true of every address /run is ever given. Ascending a segment stays in this
 * lens, so `three-js/app` from a running page means "other runnable pages in
 * app" and not "leave".
 */
function addressTrail(at) {
  let parts = at.replace(/^\//, '').split('/');
  let classes = ['s-depot', 's-publisher', 's-package'];
  return parts
    .map((part, index) => {
      let upto = `/${parts.slice(0, index + 1).join('/')}`;
      let cls = classes[index] ?? '';
      return index === parts.length - 1
        ? `<b class="${cls}">${esc(part)}</b>`
        : `<a class="${cls}" href="?at=${esc(upto)}" data-at="${esc(upto)}">${esc(part)}</a>`;
    })
    .join('<span class="sep">/</span>');
}

function go(next = {}) {
  let query = new URLSearchParams();
  let at = 'at' in next ? next.at : currentAt();
  let withs = 'with' in next ? next.with : currentWith();
  let step = 'step' in next ? next.step : currentStep();
  if (at) query.set('at', at);
  if (step) query.set('step', step);
  for (let value of withs) query.append('sub', value);
  let text = query.toString();
  history.pushState({}, '', text ? `?${decodeURIComponent(text)}` : location.pathname);
  render();
}

async function getJson(url) {
  let response = await fetch(url, { headers: { accept: 'application/json' } });
  let body = await response.json().catch(() => ({}));
  if (!response.ok) {
    let error = body?.errors?.[0] ?? {};
    throw Object.assign(new Error(error.detail ?? response.statusText), {
      code: error.code ?? String(response.status),
    });
  }
  return body;
}

/**
 * Where a deck actually RUNS.
 *
 * The Hub mounts every demo depot under its example name so they can coexist,
 * but each was sealed under the name `site`, and a pin names a depot. A
 * virtual host gives each demo that truthful `/site` root while every request
 * still enters through the Hub's one public port.
 */
function demoOrigin(depot) {
  let origin = new URL(location.origin);
  origin.hostname = `${depot}.localhost`;
  return origin.origin;
}

/**
 * Where a deck runs.
 *
 * The Hub's own decks run at the Hub host. A demo runs at
 * `<depot>.localhost` on the same port, where its sealed `/site` pins resolve.
 */
/** Concrete page last framed — scrubbing must not use a depot-only `?at=`. */
let stageAt = '';

/**
 * A seal is a working-tree snapshot. `@1.2.3` is a store Version address —
 * not a directory under `/_history/<id>/`. Browse already rebuilds Step
 * addresses without the version segment; /run has to do the same or the
 * iframe loads `…/app/form@0.1.0-dev.2/index.html` and the history backend
 * correctly answers file-not-found.
 */
function sealPath(inner) {
  return inner
    .split('/')
    .map((segment) => {
      let at = segment.indexOf('@');
      return at === -1 ? segment : segment.slice(0, at);
    })
    .filter(Boolean)
    .join('/');
}

function runTarget(at, withs = currentWith(), step = currentStep()) {
  let [, depot, ...rest] = at.split('/');
  let query = withs.map((value) => `with=${value}`).join('&');
  let suffix = query ? `?${query}` : '';
  let inner = rest.join('/');
  // `/vale-sale` is a depot, not a document. Framing `/site/` or
  // `/site/_history/<step>/` answers `file-not-found: / does not exist`.
  if (!inner) {
    return {
      why:
        `No page in this address — open a concrete document ` +
        `(for example /${depot}/vale/sale/index.html), not the depot root.`,
    };
  }
  // A Step is an address, so running one needs no separate machinery: the
  // same page, at the state it was in. The server injects that step's own
  // import map with its live pins rewritten to resolve inside the step, so
  // what loads is the page AND its dependencies as they actually were.
  if (step) {
    let path = sealPath(inner);
    return {
      url:
        depot === 'hub'
          ? `/hub/${HISTORY}/${step}/${path}${suffix}`
          : `${demoOrigin(depot)}/site/${HISTORY}/${step}/${path}${suffix}`,
    };
  }
  if (depot === 'hub') return { url: `/${depot}/${inner}${suffix}` };
  return { url: `${demoOrigin(depot)}/site/${inner}${suffix}` };
}

// ---------------------------------------------------------------------------
// What is runnable
//
// A deck is runnable when it contains an HTML page. Not "when it declares an
// entry": a deck can declare an entry and still be a library nobody can point
// a browser at, and the eleven ProseMirror `src/` decks declare NO entry at
// all — they are addressable, hashed, diffable, and the server structurally
// refuses to import them. That refusal is a state this app shows rather than
// a case it hides.
// ---------------------------------------------------------------------------

async function inventory(depotName) {
  let { data } = await getJson('/_packages');
  let depots = data.filter((depot) => !depotName || depot.name === depotName);
  let found = [];
  await Promise.all(
    depots.flatMap((depot) =>
      depot.packages.map(async (deck) => {
        let name = `${deck.publisher}/${deck.name}`;
        let version = deck.distTags?.latest ?? Object.keys(deck.versions ?? {}).at(-1);
        let base = deck.live
          ? `/${depot.name}/${name}`
          : version
            ? `/${depot.name}/${name}@${version}`
            : undefined;
        if (!base) return;
        let meta = deck.live
          ? undefined
          : await getJson(`${base}?meta`)
              .then((body) => body.data.attributes)
              .catch(() => undefined);
        let pages = deck.live
          ? await getJson(`/_browse/${depot.name}/${name}`)
              .then((body) =>
                body.data.attributes.entries
                  .filter((entry) => entry.name.endsWith('.html'))
                  .map((entry) => entry.path),
              )
              .catch(() => [])
          : (meta?.files ?? []).filter((path) => path.endsWith('.html'));
        if (!pages.length) return;
        for (let page of pages) {
          found.push({
            depot: depot.name,
            deck: name,
            publisher: deck.publisher,
            live: deck.live,
            at: `${base}/${page}`,
            page,
          });
        }
      }),
    ),
  );
  return found.sort((a, b) => (a.at < b.at ? -1 : 1));
}

async function viewIndex() {
  let items = await inventory();
  // Which of these thirteen is being worked on right now. Same bar, same
  // meaning, same module as /browse and /track — a reader who has learned it
  // once has learned it everywhere.
  let heats = items.map((item) => scoreOf(`/${item.depot}/${item.deck}`));
  let scale = activityScale(heats.map((entry) => entry.score));
  let rows = items
    .map(
      (item, index) =>
        `<tr data-name="${esc(item.at.toLowerCase())}">` +
        activityCell(scale(heats[index].score), { last: heats[index].last, claims: heats[index].claims }) +
        `<td><a href="?at=${esc(item.at)}" data-at="${esc(item.at)}">` +
        `<span class="s-depot">${esc(item.depot)}</span><span class="sep">/</span>` +
        `<span class="s-publisher">${esc(item.publisher)}</span><span class="sep">/</span>` +
        `<span class="s-package">${esc(item.deck.split('/')[1])}</span></a></td>` +
        `<td class="dim">${esc(item.page)}</td>` +
        `<td>${
          item.live
            ? '<span class="s-version" data-live>live</span>'
            : '<span class="s-version">Version</span>'
        }</td></tr>`,
    )
    .join('');
  return (
    `<main><div class="facts"><div><b>runnable</b> ${items.length}</div></div>` +
    (items.length >= 25
      ? `<div class="filter"><b>filter</b> <input type="search" data-role="filter" ` +
        `size="24" placeholder="${items.length} pages" autocomplete="off" /> ` +
        `<span class="dim" data-role="filter-count"></span></div>`
      : '') +
    `<table><thead><tr><th class="heat-cell"></th><th>deck</th>` +
    `<th>page</th><th>where</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></main>`
  );
}

// ---------------------------------------------------------------------------
// The resolved map: what the page ACTUALLY loaded
//
// Read out of the served HTML rather than recomputed. The server injects the
// import map at serve time — including any `?with=` re-resolution — so
// parsing the document that ran is the only way to be sure the table on
// screen is the table the browser used. Recomputing it would be a second
// opinion, and a second opinion is exactly what this page must not be.
// ---------------------------------------------------------------------------

async function resolvedMap(url) {
  let response = await fetch(url);
  let html = await response.text();
  let match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  let trial = response.headers.get('x-deck-with');
  if (!match) return { imports: {}, scopes: {}, trial, missing: true };
  try {
    return { ...JSON.parse(match[1]), trial };
  } catch {
    return { imports: {}, scopes: {}, trial, missing: true };
  }
}

/**
 * Turn a runtime pin back into the address the Hub reads.
 *
 * Demo pages execute from a private origin where their depot is named
 * `site`; the Hub mounts that same depot under its real name. Exposing the
 * runtime path in Browse produced links to a depot that does not exist here.
 */
function hubAddress(url) {
  let target = String(url).replace(/^\//, '').split('/');
  if (target[0] === 'site') {
    target[0] = currentAt().replace(/^\//, '').split('/')[0];
  }
  return `/${target.join('/')}`;
}

/** Every mapped URL becomes a link into /browse at that exact address. */
function mapRows(table, indent = false) {
  return Object.entries(table)
    .filter(([specifier]) => !specifier.endsWith('/'))
    .map(([specifier, url]) => {
      let address = hubAddress(url);
      let target = address.replace(/^\//, '').split('/');
      let [depot, publisher, pkg] = target;
      return (
        `<tr data-name="${esc(specifier.toLowerCase())}">` +
        `<td class="${indent ? 'indent' : ''}">${esc(specifier)}</td>` +
        `<td><a href="/browse?at=${esc(address)}">` +
        `<span class="s-depot">${esc(depot ?? '')}</span><span class="sep">/</span>` +
        `<span class="s-publisher">${esc(publisher ?? '')}</span><span class="sep">/</span>` +
        `<span class="s-package">${esc(pkg ?? '')}</span></a></td>` +
        `<td class="dim">${esc(target.slice(3).join('/'))}</td></tr>`
      );
    })
    .join('');
}

/**
 * NO LENS IS EVER A DEAD END.
 *
 * The tab strip carries one address across three lenses, and the address you
 * were reading in /browse is usually a source file. A source file does not
 * run. If `run` answered that with "not runnable" the strip would be a lie
 * half the time — you would learn that switching lenses sometimes throws your
 * place away, and then you would stop switching.
 *
 * So a non-page focus resolves UP to the deck that contains it and runs that
 * deck's page. The subject does not change, the substitution is stated, and
 * the reader gets the thing they meant: the file they were reading, running.
 *
 * A deck with no page continues across the graph instead: resolved import
 * maps say which pages consume it, and `?with=` can place the selected
 * Version into one of those pages without a checkout. Only a library with no
 * reverse edge stops, and even then Run explains the edge it needs rather
 * than presenting an error.
 */
/**
 * Every page in one deck, by full path.
 *
 * `?meta` and not `/_browse`: `/_browse` lists ONE directory, and a page can
 * be three directories down. A deck whose only page was `demo/pages/index.html`
 * read as "nothing here to run", which is the exact wrong answer.
 */
const pagesCache = new Map();
function pagesOf(deck) {
  if (!pagesCache.has(deck)) {
    pagesCache.set(
      deck,
      getJson(`${deck}?meta`)
        .then((body) =>
          (body.data.attributes.files ?? []).filter((path) => /\.html?$/.test(path)),
        )
        .catch(() => []),
    );
  }
  return pagesCache.get(deck);
}

/**
 * The package coordinate inside any Deck address.
 *
 * Paths and files are deliberately ignored: Run needs the graph node, not
 * the particular source file through which somebody arrived at it.
 */
function packageCoordinate(at) {
  let [depot, publisher, pkgAndSpec] = at.replace(/^\//, '').split('/');
  if (!depot || !publisher || !pkgAndSpec) return;
  let marker = pkgAndSpec.indexOf('@');
  let pkg = marker === -1 ? pkgAndSpec : pkgAndSpec.slice(0, marker);
  let version = marker === -1 ? '' : pkgAndSpec.slice(marker + 1);
  return {
    depot,
    publisher,
    pkg,
    version,
    identity: `${publisher}/${pkg}`,
  };
}

/** The package coordinate named by one resolved import-map target. */
function mappedCoordinate(target) {
  let pathname;
  try {
    pathname = new URL(String(target), location.origin).pathname;
  } catch {
    return;
  }
  // At runtime the first segment is normally `site`, not the Hub's mount
  // name. Publisher and package remain the protocol identity in both forms.
  let [, , publisher, pkgAndSpec] = pathname.split('/');
  if (!publisher || !pkgAndSpec) return;
  let marker = pkgAndSpec.indexOf('@');
  let pkg = marker === -1 ? pkgAndSpec : pkgAndSpec.slice(0, marker);
  return {
    publisher,
    pkg,
    version: marker === -1 ? '' : pkgAndSpec.slice(marker + 1),
    identity: `${publisher}/${pkg}`,
  };
}

async function forkedFromOf(at) {
  let focus = packageCoordinate(at);
  if (!focus) return;
  let address =
    `/${focus.depot}/${focus.identity}` +
    (focus.version ? `@${focus.version}` : '');
  let map = await fetch(`${address}/importmap.json`)
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined);
  let entry = map?.deck?.packages?.[focus.pkg]?.forkedFrom;
  let identity = entry?.package ?? entry?.deck;
  return identity ? { identity, version: entry.version ?? '' } : undefined;
}

function consumerHref(page, focus, alreadyUsing, sourceIdentity) {
  let query = new URLSearchParams({ at: page });
  if (!alreadyUsing) {
    let target = focus.version
      ? `${focus.identity}@${focus.version}`
      : focus.identity;
    query.set(
      'sub',
      sourceIdentity === focus.identity
        ? target
        : `${sourceIdentity}=${target}`,
    );
  }
  return `?${query.toString()}`;
}

/**
 * Runnable pages whose resolved import map reaches this package.
 *
 * This is the missing half of Run. Most packages are libraries by design;
 * asking only whether the package itself contains HTML turns most of the
 * graph into dead ends. The import map already says where a library becomes
 * visible, and `?with=` can put the selected Version into that page for one
 * no-store trial without changing its lock.
 */
async function consumersOf(at) {
  let focus = packageCoordinate(at);
  if (!focus) return [];
  let forkedFrom = await forkedFromOf(at);
  let accepted = new Set([
    focus.identity,
    ...(forkedFrom ? [forkedFrom.identity] : []),
  ]);
  let pages = await inventory(focus.depot);
  let found = await Promise.all(
    pages.map(async (item) => {
      let target = runTarget(item.at, [], '');
      if (!target.url) return;
      let map = await resolvedMap(target.url).catch(() => undefined);
      if (!map) return;
      let bindings = [
        ...Object.entries(map.imports ?? {}),
        ...Object.values(map.scopes ?? {}).flatMap((scope) =>
          Object.entries(scope),
        ),
      ];
      let matches = bindings
        .map(([specifier, value]) => ({
          specifier,
          target: mappedCoordinate(value),
        }))
        .filter(
          (binding) =>
            binding.target && accepted.has(binding.target.identity),
        );
      if (!matches.length) return;
      let alreadyUsing = matches.some(({ target }) => {
        if (target.identity !== focus.identity) return false;
        return focus.version
          ? target.version === focus.version
          : target.version === '';
      });
      let samePackage = matches.find(
        ({ target }) => target.identity === focus.identity,
      );
      let sourceIdentity = samePackage?.target.identity ?? matches[0].target.identity;
      return {
        ...item,
        specifiers: [...new Set(matches.map(({ specifier }) => specifier))],
        current: [
          ...new Set(
            matches.map(({ target }) =>
              `${target.identity}${target.version ? `@${target.version}` : ' live'}`,
            ),
          ),
        ],
        sourceIdentity,
        alreadyUsing,
        href: consumerHref(item.at, focus, alreadyUsing, sourceIdentity),
      };
    }),
  );
  return found.filter(Boolean);
}

function consumerView(input, consumers) {
  let focus = packageCoordinate(input);
  let selected = focus.version || 'live';
  let rows = consumers
    .map((consumer) => {
      let relation = consumer.alreadyUsing
        ? `already uses ${selected}`
        : `currently uses ${consumer.current.join(', ')}`;
      return (
        `<tr data-name="${esc(`${consumer.at} ${consumer.specifiers.join(' ')}`.toLowerCase())}">` +
        `<td><a href="${esc(consumer.href)}">` +
        `<span class="s-publisher">${esc(consumer.publisher)}</span><span class="sep">/</span>` +
        `<span class="s-package">${esc(consumer.deck.split('/')[1])}</span></a></td>` +
        `<td><code>${esc(consumer.specifiers.join(', '))}</code></td>` +
        `<td class="dim">${esc(relation)}</td>` +
        `<td><a class="action run-action" href="${esc(consumer.href)}">` +
        `${consumer.alreadyUsing ? 'Run where used' : `Run with ${esc(selected)}`} →</a></td></tr>`
      );
    })
    .join('');
  return (
    `<main class="use-view">` +
    `<div class="facts"><div><b>library</b> no page of its own</div>` +
    `<div><b>used by</b> ${consumers.length} runnable ${consumers.length === 1 ? 'page' : 'pages'}</div></div>` +
    `<div class="use-explainer"><h1>This package runs inside other pages.</h1>` +
    `<p><code>${esc(focus.identity)}@${esc(selected)}</code> exports code rather than HTML. ` +
    `Choose a consumer below and Deck will assemble that page with this ` +
    `${focus.version ? 'exact Version' : 'live package'} in its import map.</p>` +
    `<div class="use-flow"><span>page</span><i>imports</i>` +
    `<strong>${esc(focus.identity)}@${esc(selected)}</strong><i>from</i><span>CAS</span></div>` +
    `<p class="dim">The trial is <code>no-store</code> and changes no files or locks. ` +
    `It is a runnable question, not a checkout.</p></div>` +
    `<table><thead><tr><th>Run in</th><th>Imported as</th><th>Current pin</th>` +
    `<th></th></tr></thead><tbody>${rows}</tbody></table>` +
    `<p class="dim use-fallback"><a href="/browse?at=${esc(input)}">Browse this package</a> · ` +
    `<a href="/track?at=${esc(input)}">See its History</a></p></main>`
  );
}

function unusedLibraryView(input) {
  let focus = packageCoordinate(input);
  let selected = focus.version || 'live';
  return (
    `<main class="use-view">` +
    `<div class="facts"><div><b>library</b> no page of its own</div>` +
    `<div><b>graph consumers</b> 0</div></div>` +
    `<div class="use-explainer"><h1>No consumer declared in the graph.</h1>` +
    `<p><code>${esc(focus.identity)}@${esc(selected)}</code> is valid code, but no ` +
    `page in <span class="s-depot">${esc(focus.depot)}</span> currently names it ` +
    `in a resolved import map. Run does not guess from source text or computed ` +
    `URLs, so it cannot prove a page in which to show this package.</p>` +
    `<div class="use-flow"><strong>${esc(focus.identity)}</strong><i>add to</i>` +
    `<span>import map</span><i>then load from</i><span>HTML page</span></div>` +
    `<p class="dim">If a page loads this through a computed URL, that edge is ` +
    `invisible to Deck. Add an ESM import and map its specifier to this package. ` +
    `Run will discover the reverse edge automatically—no Run configuration ` +
    `or special entry file is required.</p></div>` +
    `<pre><code>import value from '${esc(focus.identity)}';\n\n` +
    `{"imports":{"${esc(focus.identity)}":"/${esc(focus.depot)}/${esc(focus.identity)}${focus.version ? `@${esc(focus.version)}` : ''}/index.js"}}</code></pre>` +
    `<p class="use-fallback"><a href="/browse?at=${esc(input)}">Browse this package</a> · ` +
    `<a href="/run">Find a runnable page</a> · ` +
    `<a href="/track?at=${esc(input)}">See its History</a></p></main>`
  );
}

async function resolveRunnable(at) {
  if (/\.html?$/.test(at)) return { at };
  let parts = at.replace(/^\//, '').split('/');
  let [depot, publisher, pkgAndSpec, ...rest] = parts;
  if (!depot) return { at };

  // ABOVE A DECK — a depot, or a publisher. Everything runnable underneath is
  // a candidate, and there is usually more than one, so this never picks.
  if (!publisher || !pkgAndSpec) {
    let prefix = `/${parts.join('/')}`;
    let under = (await inventory(depot)).filter(
      (item) => item.at === prefix || item.at.startsWith(`${prefix}/`),
    );
    if (!under.length) {
      return { why: `Nothing under ${prefix} is a page, so there is nothing to run.` };
    }
    if (under.length === 1) return { at: under[0].at, instead: at };
    return {
      why: `${under.length} pages under ${prefix}.`,
      choices: under.map((item) => ({
        at: item.at,
        label: item.at.slice(prefix.length + 1),
        note: item.deck,
      })),
    };
  }

  let deck = `/${depot}/${publisher}/${pkgAndSpec}`;
  let within = rest.join('/');
  let pages = await pagesOf(deck);
  if (!pages.length) {
    return { library: true };
  }

  // DOWN BEFORE UP. The address is the most specific thing the reader has
  // said, so a page inside it answers them better than the deck's front door
  // does. Only when nothing is below does this climb.
  let below = within ? pages.filter((path) => path.startsWith(`${within}/`)) : pages;
  let candidates = below.length ? below : pages;
  let downward = below.length > 0;

  if (candidates.length === 1) return { at: `${deck}/${candidates[0]}`, instead: at };

  // An `index.html` at exactly the level asked for is not one of several
  // choices, it is the answer — that is what a directory index means, and
  // offering it beside its own children asks a question nobody has.
  let index = within ? `${within}/index.html` : 'index.html';
  if (candidates.includes(index)) return { at: `${deck}/${index}`, instead: at };

  return {
    why: downward
      ? `${candidates.length} pages inside this path.`
      : `Nothing at this path is a page. ${pkgAndSpec} has ${candidates.length} elsewhere.`,
    choices: candidates.map((path) => ({
      at: `${deck}/${path}`,
      label: path,
      note: downward ? 'inside this path' : `elsewhere in ${pkgAndSpec}`,
    })),
  };
}

async function viewOne(input) {
  let resolved = await resolveRunnable(input);

  // SEVERAL ANSWERS IS NOT NO ANSWER.
  //
  // Picking one for you is wrong when the pick is not obvious: a demo with
  // four pages has four right answers, and silently loading the first teaches
  // the reader that this lens shows something arbitrary. Listing them costs
  // one click and keeps the address honest.
  if (resolved.choices) {
    subject.trail = addressTrail(input);
    subject.fact = '';
    return (
      `<main><div class="pick">` +
      `<p><b>Choose what to run.</b> ${esc(resolved.why)}</p>` +
      `<ul class="plain">` +
      resolved.choices
        .map(
          (choice) =>
            `<li><a href="?at=${esc(choice.at)}" data-at="${esc(choice.at)}">` +
            `${esc(choice.label)}</a> <span class="dim">${esc(choice.note)}</span></li>`,
        )
        .join('') +
      `</ul>` +
      `<p class="dim"><a href="/browse?at=${esc(input)}">Read this path in /browse</a> ` +
      `instead.</p></div></main>`
    );
  }

  if (!resolved.at) {
    subject.trail = addressTrail(input);
    subject.fact = '';
    if (resolved.library) {
      let consumers = await consumersOf(input);
      return consumers.length
        ? consumerView(input, consumers)
        : unusedLibraryView(input);
    }
    return (
      `<main><div class="err"><b>nothing to run</b> — ${esc(resolved.why)}</div>` +
      `<p class="dim"><a href="/browse?at=${esc(input)}">Read it in /browse</a>, ` +
      `or <a href="/track?at=${esc(input)}">see what changed</a>.</p></main>`
    );
  }
  let at = resolved.at;
  let substituted = resolved.instead;
  // Scrub / LIVE need a document path in the URL. Keeping only `?at=/vale-sale`
  // after resolving to index.html made the live tip frame `/site/` and the
  // stage showed `file-not-found: / does not exist in depot site`.
  if (at && at !== currentAt()) {
    let query = new URLSearchParams(location.search);
    query.set('at', at);
    let text = query.toString();
    history.replaceState({}, '', text ? `?${decodeURIComponent(text)}` : location.pathname);
  }
  stageAt = at;
  let withs = currentWith();
  let { url, why } = runTarget(at, withs);
  // The address goes to the shared subject bar. It is the same address
  // /browse and /track are pointed at, so it is drawn once, in one place, by
  // one component — and it stays put while you move between the three.
  // The subject bar shows what you ASKED for, not what got substituted — the
  // point of the strip is that your place survives the switch, so the bar has
  // to keep saying it. What actually loaded is stated once, below.
  subject.trail = addressTrail(substituted ?? at);
  let heat = scoreOf((substituted ?? at).replace(/\/[^/]*\.\w+$/, ''));
  subject.fact = heat.last ? `edited ${ago(heat.last)}` : '';
  let head = `<main>`;

  if (!url) {
    return (
      head +
      `<div class="err"><b>cannot run</b> — ${esc(why)}</div>` +
      `<p class="dim">The bytes are fine. ` +
      `<a href="/browse?at=${esc(at)}">Read it in /browse</a> while this is out.</p>` +
      `</main>`
    );
  }

  // A HUB APP DOES NOT GO IN THE STAGE. IT GETS ITS OWN WINDOW.
  //
  // The Hub runs itself — that is the self-hosting claim and it is true — but
  // running itself INSIDE itself is a recursion that costs and returns
  // nothing. Two copies of the chrome on one origin, each holding an SSE
  // stream open against a six-connection budget, each polling activity; the
  // inner one sits on `loading…` for ever because its requests are queued
  // behind streams that never close. Starvation does not throw, so there is
  // nothing in the console to find, and the whole tab reads as frozen.
  //
  // There is also nothing to see. These four are the instrument, not a
  // specimen: a browser inside a browser shows you a smaller browser. Any
  // depot's decks still frame — including this depot's non-app decks — so
  // the rule is as narrow as the problem.
  if (isHubApp(at)) {
    return (
      head +
      `<div class="notice"><b>${esc(at.split('/')[3])}</b> is one of the Hub's ` +
      `own apps, so it opens in its own window rather than in the stage.</div>` +
      `<p><a class="popout" href="${esc(url)}" target="_blank" rel="noopener">` +
      `Open ${esc(at.split('/')[3])} ↗</a></p>` +
      `<p class="dim">Its imports are below, resolved exactly as they would be ` +
      `in that window.</p>` +
      `<table><thead><tr><th>Import</th><th>Pin</th><th>Entry</th></tr></thead>` +
      `<tbody>${mapRows((await resolvedMap(url)).imports ?? {})}</tbody></table>` +
      `</main>`
    );
  }

  if (withs.length) {
    // C5: a trial is not the sealed representation and must never be mistaken
    // for one. It says so, and one control leaves.
    head +=
      `<div class="trial"><b>trial</b> ` +
      withs.map((value) => `<code>${esc(value)}</code>`).join(' ') +
      ` <button data-role="clear-with">exit</button></div>`;
  }

  let map = await resolvedMap(url);
  let depotName = at.replace(/^\//, '').split('/')[0];
  let history = foldBursts(
    stepsFor(await stepsOf(depotName), closureOf(at, map)),
  );
  lastHistory = history;
  let scopes = Object.entries(map.scopes ?? {});
  let specifiers = Object.keys(map.imports ?? {}).filter((key) => !key.endsWith('/'));
  let answered = specifiers.map((key) =>
    String(map.imports[key]).split('/').slice(0, 4).join('/'),
  );
  return (
    head +
    // THE STAGE OWNS THE SCREEN, AND YOU DECIDE HOW MUCH.
    //
    // This was a fixed 70vh box with the readout scrolling underneath, which
    // gave a tall demo a short window and gave a table of eight rows the rest
    // of the page. The two now share the viewport through a splitter you can
    // drag, the position is remembered, and `Full` gives the stage all of it.
    //
    // Every control sits ABOVE the frame, never over it: an iframe is already
    // a compromise without the chrome eating a corner of the thing on show.
    // UNDO / REDO, which is what stepping a running page is. Stepping back
    // shows the app as it was one change ago — a PREVIEW of the undo at an
    // immutable address, never a mutation, which is what makes it safe to
    // walk back twenty saves hunting for where it broke. Taking it for real
    // is `deck restore`, forward-only.
    //
    // OUTSIDE the split, not inside it: `.runsplit` declares exactly four
    // grid rows, so a fifth child lands in an implicit row and the whole
    // pane grows a band of dead space. A grid with a fixed track list is a
    // contract about how many children it has.
    historyHtml({
      steps: history,
      current: currentStep(),
      label: 'undo',
    }) +
    `<div class="runsplit" data-role="split">` +
    `<div class="stagebar">` +
    // Width presets, because "does this demo hold up narrow" is a question
    // about the demo, and answering it by resizing the whole window loses
    // the readout underneath.
    WIDTHS.map(
      ([value, label]) =>
        `<button data-role="width" data-width="${value}" ` +
        `aria-pressed="${value === stageWidth() ? 'true' : 'false'}">${label}</button>`,
    ).join('') +
    `<button data-role="reload" title="reload the stage">Reload</button>` +
    `<span class="grow"></span>` +
    `<button data-role="full" aria-pressed="${isFull() ? 'true' : 'false'}">Full</button>` +
    `<a class="popout" href="${esc(url)}" target="_blank" rel="noopener">Pop Out ↗</a>` +
    `</div>` +
    `<div class="stagewrap" data-tour="stage"><iframe class="stage" data-role="stage" ` +
    `src="${esc(url)}" title="${esc(at)}"></iframe></div>` +
    `<div class="grip" data-role="grip" title="drag to resize"></div>` +
    `<div class="runsplit-under" data-tour="graph">` +
    // "imports 1 · scopes 0" is two numbers and no meaning. What a reader
    // wants is the sentence those numbers are evidence for.
    `<p class="dim">${
      specifiers.length === 0
        ? 'this page has no imports'
        : `${specifiers.length} import${specifiers.length === 1 ? '' : 's'} → ` +
          `${new Set(answered).size} pin${new Set(answered).size === 1 ? '' : 's'}. ` +
          (scopes.length
            ? `${scopes.length} scope${scopes.length === 1 ? '' : 's'} add further pins.`
            : 'All leaves — the closure stops here.')
    }</p>` +
    (map.trial ? `<p class="trialnote">standing in: <code>${esc(map.trial)}</code></p>` : '') +
    (map.missing
      ? `<p class="dim">no import map injected — this page resolves nothing</p>`
      : `<table><thead><tr><th>Import</th><th>Pin</th><th>Entry</th></tr></thead>` +
        `<tbody>${mapRows(map.imports ?? {})}</tbody></table>` +
        scopes
          .map(
            ([scope, table]) =>
              `<h2 class="scope">scope <a href="/browse?at=${esc(scope)}">${esc(scope)}</a></h2>` +
              `<table><tbody>${mapRows(table, true)}</tbody></table>`,
          )
          .join('')) +
    `</div></div>` +
    `</main>`
  );
}

// ---------------------------------------------------------------------------
// The splitter
//
// Three pieces of state, all of them the reader's rather than the app's, so
// all three outlive the page: how the stage and the readout divide the
// viewport, how wide the stage is, and whether the readout is hidden. Nothing
// here belongs in the URL — it is how you are looking, not what at — and a
// share link that carried someone else's pane sizes would be worse than one
// that did not.

const SPLIT_KEY = 'deck.run.split';
const WIDTH_KEY = 'deck.run.width';
const FULL_KEY = 'deck.run.full';

// `100%` first because it is the default and the common case. The rest are
// the two widths that actually decide whether a layout holds.
const WIDTHS = [
  ['100%', 'fit'],
  ['768px', '768'],
  ['390px', '390'],
];

const stageWidth = () => localStorage.getItem(WIDTH_KEY) ?? '100%';
const isFull = () => localStorage.getItem(FULL_KEY) === '1';
const splitAt = () => Number(localStorage.getItem(SPLIT_KEY) ?? 62);

/** The History the last render drew, so the keys and buttons agree with it. */
let lastHistory = [];

function applyStage() {
  let split = app.querySelector('[data-role="split"]');
  if (!split) return;
  split.style.setProperty('--split', String(splitAt()));
  split.style.setProperty('--stagew', stageWidth());
  split.dataset.full = isFull() ? '1' : '0';
  // MEASURED, not guessed. The chrome above this is a nav, a subject bar, and
  // sometimes a trial banner; below it a legend that shows and hides on a
  // key. A hard-coded offset is wrong in most of those states and leaves the
  // page scrolling by a few pixels, which on a pane meant to fill the window
  // exactly reads as broken.
  //
  // AND THE MEASUREMENT MUST NOT FEED ITSELF. This ran inside a
  // ResizeObserver on the document, which is a loop with no exit: writing
  // --chrome resizes the pane, resizing the pane resizes the document, and
  // the observer fires again. The page did not error — it froze, which is the
  // worst way for a layout bug to present because there is nothing to read.
  //
  // Two guards, and both are needed. Writing only on a real change breaks the
  // feedback; measuring off `window` rather than the element means the input
  // does not depend on the output at all.
  let legend = document.querySelector('deck-keys')?.offsetHeight ?? 0;
  let above = split.getBoundingClientRect().top + scrollY;
  let next = `${Math.round(above + legend + 8)}px`;
  if (split.style.getPropertyValue('--chrome') !== next) {
    split.style.setProperty('--chrome', next);
  }
}

// Window resize only. The legend toggling and the trial banner appearing both
// go through render(), which calls applyStage() itself — so nothing needs to
// watch the document, and nothing can chase its own tail.
addEventListener('resize', () => applyStage());

function dragSplit(event) {
  let split = app.querySelector('[data-role="split"]');
  if (!split || isFull()) return;
  event.preventDefault();
  let box = split.getBoundingClientRect();
  let move = (moveEvent) => {
    // Clamped so neither pane can be dragged out of existence: a splitter
    // that can hide a pane permanently is a splitter that will, and then the
    // pane looks broken rather than collapsed.
    let fraction = ((moveEvent.clientY - box.top) / box.height) * 100;
    split.style.setProperty('--split', String(Math.max(15, Math.min(88, fraction))));
  };
  let done = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', done);
    delete split.dataset.dragging;
    localStorage.setItem(SPLIT_KEY, split.style.getPropertyValue('--split'));
  };
  split.dataset.dragging = '1';
  addEventListener('pointermove', move);
  addEventListener('pointerup', done);
}

async function render() {
  let at = currentAt();
  try {
    app.innerHTML = at ? await viewOne(at) : await viewIndex();
    applyStage();
    // SCRUB PREVIEWS, RELEASE COMMITS.
    //
    // During a drag only the stage's src changes — pointed at an immutable
    // step address whose whole closure is already cached, so the swap is a
    // few milliseconds and nothing else on the page moves. Pushing history
    // state per sample would re-render forty times across one drag and turn
    // the fastest thing here into the slowest.
    attachScrub(app, {
      onScrub: (step) => {
        let stage = app.querySelector('[data-role="stage"]');
        if (!stage) return;
        let next = runTarget(stageAt || currentAt(), currentWith(), step).url;
        if (next && stage.getAttribute('src') !== next) {
          measureFrame(stage, app.querySelector('[data-role="timing"]'));
          stage.setAttribute('src', next);
        }
      },
      onCommit: (step) => {
        if (step !== currentStep()) go({ step });
      },
    });
    // HOW FAST WAS THAT, measured rather than claimed. Every Step address is
    // immutable, so after the first visit the whole closure is served from
    // cache — scrubbing is near-instant and nothing on screen would say so
    // unless it were printed. On a revisited step the wire cost reads 0 KB,
    // which is the argument for content addressing in one line of chrome.
    measureFrame(
      app.querySelector('[data-role="stage"]'),
      app.querySelector('[data-role="timing"]'),
    );
  } catch (error) {
    app.innerHTML =
      `<main><div class="err"><b>${esc(error.code ?? 'error')}</b> — ` +
      `${esc(error.message)}</div></main>`;
  }
  cursor = -1;
  wrapTables(app);
  keys.keys = bindings();
  maybeResumeTour();
}

let tourResumed = false;
function maybeResumeTour() {
  if (tourResumed) return;
  tourResumed = true;
  resumeHubTour({ waitMs: 80 });
}

let cursor = -1;
const rows = () => [...app.querySelectorAll('tbody tr:not([hidden])')];

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
  all[cursor].dataset.here = '1';
  all[cursor].scrollIntoView({ block: 'nearest' });
}

function bindings() {
  let list = [[['j', 'k'], 'move'], ['↵', 'open']];
  if (currentAt()) list.push(['u', 'up']);
  if (app.querySelector('[data-role="filter"]')) list.push(['/', 'filter']);
  if (app.querySelector('[data-role="split"]')) {
    list.push(['f', 'full'], ['r', 'reload'], [['[', ']'], 'undo / redo']);
  }
  list.push([['g', 'G'], 'ends'], ['y', 'copy address']);
  return list;
}

addEventListener('popstate', render);

addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  let tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    if (event.key === 'Escape') document.activeElement.blur();
    return;
  }
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
      let link = rows()[cursor]?.querySelector('a[data-at]');
      if (link) go({ at: link.dataset.at });
      return;
    }
    case 'u':
      return go({ at: '' });
    case '/': {
      let filter = app.querySelector('[data-role="filter"]');
      if (filter) {
        event.preventDefault();
        filter.focus();
      }
      return;
    }
    case 'y':
      return navigator.clipboard?.writeText(currentAt());
    case 'f':
      return app.querySelector('[data-role="full"]')?.click();
    case '[':
      return go({ step: stepBy(lastHistory, currentStep(), -1) });
    case ']':
      return go({ step: stepBy(lastHistory, currentStep(), 1) });
    case 'r':
      return app.querySelector('[data-role="reload"]')?.click();
    default:
  }
});

app.addEventListener('pointerdown', (event) => {
  if (event.target.closest('[data-role="grip"]')) dragSplit(event);
});

app.addEventListener('click', (event) => {
  if (event.target.closest('[data-role="clear-with"]')) return go({ with: [] });

  let notch = event.target.closest('[data-role="step"]');
  if (notch) return go({ step: notch.dataset.step });

  let by = event.target.closest('[data-role="step-by"]');
  if (by) {
    // NO SIGN FLIP. The tape runs oldest-left to live-right, and `stepBy`
    // walks that same order — so `◀` (-1) is one step older and `▶` (+1) is
    // one newer, which is what the arrows point at. This negated the delta
    // and the buttons ran backwards: pressing "back" went forward.
    return go({ step: stepBy(lastHistory, currentStep(), Number(by.dataset.by)) });
  }

  let width = event.target.closest('[data-role="width"]');
  if (width) {
    localStorage.setItem(WIDTH_KEY, width.dataset.width);
    for (let button of app.querySelectorAll('[data-role="width"]')) {
      button.setAttribute(
        'aria-pressed',
        button.dataset.width === width.dataset.width ? 'true' : 'false',
      );
    }
    return applyStage();
  }

  if (event.target.closest('[data-role="full"]')) {
    localStorage.setItem(FULL_KEY, isFull() ? '0' : '1');
    let button = app.querySelector('[data-role="full"]');
    button?.setAttribute('aria-pressed', isFull() ? 'true' : 'false');
    return applyStage();
  }

  if (event.target.closest('[data-role="reload"]')) {
    // Re-assigning `src` rather than reaching into contentWindow: the demos
    // run at a different origin, so there is nothing here we are allowed to
    // touch, and this is the one reload that works for both.
    let stage = app.querySelector('[data-role="stage"]');
    if (stage) stage.src = stage.src;
    return;
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

onActivityChange(() => {
  // Only the index is decorated, and re-rendering while a demo is framed
  // would tear the iframe down and restart whatever it was doing.
  if (!currentAt()) render();
});
onLiveChange(() => loadActivity());

render();
loadActivity();
