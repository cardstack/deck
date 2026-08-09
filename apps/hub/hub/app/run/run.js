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
import { installNavStyles, onLiveChange } from 'ui/nav';
import {
  ago,
  heatCell,
  heatScale,
  installHeatStyles,
  loadHeat,
  onHeatChange,
  scoreOf,
} from 'ui/heat';

installNavStyles();
installHeatStyles();

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
const currentWith = () => params().getAll('with');

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
  if (at) query.set('at', at);
  for (let value of withs) query.append('with', value);
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
 * The Hub mounts every demo depot under its example name so nine of them can
 * coexist, but each was sealed under the name `site`, and a pin names a
 * depot. Read from `/codelist/...` the bytes are right and the pins point at
 * an address this origin does not answer. So the Hub serves each demo depot a
 * second time, as `site`, on its own port — and this is where /run points the
 * frame. Same directory, same store, correct pins.
 */
let ORIGINS = {};
let ORIGIN_ERRORS = {};
let ORIGINS_REACHABLE = false;

async function loadOrigins() {
  try {
    let response = await fetch('/_hub/origins');
    if (!response.ok) throw new Error(`/_hub/origins answered ${response.status}`);
    let body = await response.json();
    ORIGINS = body.origins ?? {};
    ORIGIN_ERRORS = body.errors ?? {};
    ORIGINS_REACHABLE = true;
  } catch {
    ORIGINS_REACHABLE = false;
  }
}

/**
 * Where a deck runs, or WHY IT CANNOT — never a quiet substitute.
 *
 * The Hub's own decks run at the Hub's origin, because that is the depot they
 * were sealed for. A demo runs at its second mount and nowhere else. When the
 * origin for a demo is unknown there is no fallback worth having: framing it
 * here would load an HTML page whose every import 404s, which renders as an
 * empty white box with nothing in the console the reader can see. Silence is
 * the one answer this must never give, so a missing origin returns a reason.
 */
function runTarget(at, withs = currentWith()) {
  let [, depot, ...rest] = at.split('/');
  let query = withs.map((value) => `with=${value}`).join('&');
  let suffix = query ? `?${query}` : '';
  if (depot === 'hub') return { url: at + suffix };
  let origin = ORIGINS[depot];
  if (origin) return { url: `${origin}/site/${rest.join('/')}${suffix}` };
  if (!ORIGINS_REACHABLE) {
    return {
      why:
        'This Hub is not reporting where its demos run. That is what a stale ' +
        'server looks like: an older process still holding this port. Stop it ' +
        'and start again — `lsof -ti:8788 | xargs kill`.',
    };
  }
  return {
    why:
      ORIGIN_ERRORS[depot] ??
      `No depot named ${depot} is mounted, so there is no origin to run it at.`,
  };
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

async function inventory() {
  let { data } = await getJson('/_packages');
  let found = [];
  await Promise.all(
    data.flatMap((depot) =>
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
  let scale = heatScale(heats.map((entry) => entry.score));
  let rows = items
    .map(
      (item, index) =>
        `<tr data-name="${esc(item.at.toLowerCase())}">` +
        heatCell(scale(heats[index].score), { last: heats[index].last }) +
        `<td><a href="?at=${esc(item.at)}" data-at="${esc(item.at)}">` +
        `<span class="s-depot">${esc(item.depot)}</span><span class="sep">/</span>` +
        `<span class="s-publisher">${esc(item.publisher)}</span><span class="sep">/</span>` +
        `<span class="s-package">${esc(item.deck.split('/')[1])}</span></a></td>` +
        `<td class="dim">${esc(item.page)}</td>` +
        `<td>${
          item.live
            ? '<span class="s-version" data-live>live</span>'
            : '<span class="s-version">sealed</span>'
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

/** Every mapped URL becomes a link into /browse at that exact address. */
function mapRows(table, indent = false) {
  return Object.entries(table)
    .filter(([specifier]) => !specifier.endsWith('/'))
    .map(([specifier, url]) => {
      let target = url.replace(/^\//, '').split('/');
      let [depot, publisher, pkg] = target;
      return (
        `<tr data-name="${esc(specifier.toLowerCase())}">` +
        `<td class="${indent ? 'indent' : ''}">${esc(specifier)}</td>` +
        `<td><a href="/browse?at=${esc(url)}">` +
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
 * A deck with no page at all is the one honest refusal, and it is a fact
 * about that deck — the eleven ProseMirror `src/` decks publish no entry —
 * rather than a failure of the strip.
 */
async function resolveRunnable(at) {
  if (/\.html?$/.test(at)) return { at };
  let parts = at.replace(/^\//, '').split('/');
  let [depot, publisher, pkgAndSpec] = parts;
  if (!depot || !publisher || !pkgAndSpec) return { at };
  let deck = `/${depot}/${publisher}/${pkgAndSpec}`;
  let pages = await getJson(`/_browse${deck}`)
    .then((body) =>
      (body.data.attributes.entries ?? [])
        .filter((entry) => /\.html?$/.test(entry.name))
        .map((entry) => entry.path),
    )
    .catch(() => []);
  if (!pages.length) {
    return {
      why:
        `Nothing in ${pkgAndSpec} is a page, so there is nothing here to run. ` +
        `That is a fact about the deck, not a missing feature — a deck can be ` +
        `addressable, hashed and diffable and still have no entry a browser ` +
        `can be pointed at.`,
    };
  }
  // index.html when there is one, because that is what a directory means.
  let page = pages.find((path) => /(^|\/)index\.html?$/.test(path)) ?? pages[0];
  return { at: `${deck}/${page}`, instead: at };
}

async function viewOne(input) {
  let resolved = await resolveRunnable(input);
  if (!resolved.at) {
    subject.trail = addressTrail(input);
    subject.fact = '';
    return (
      `<main><div class="err"><b>nothing to run</b> — ${esc(resolved.why)}</div>` +
      `<p class="dim"><a href="/browse?at=${esc(input)}">Read it in /browse</a>, ` +
      `or <a href="/track?at=${esc(input)}">see what changed</a>.</p></main>`
    );
  }
  let at = resolved.at;
  let substituted = resolved.instead;
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
  if (substituted) {
    head +=
      `<p class="dim">${esc(substituted.split('/').pop())} is not a page. ` +
      `Running <b>${esc(at.split('/').pop())}</b>, the page in the same deck.</p>`;
  }

  if (!url) {
    return (
      head +
      `<div class="err"><b>cannot run</b> — ${esc(why)}</div>` +
      `<p class="dim">The bytes are fine. ` +
      `<a href="/browse?at=${esc(at)}">Read it in /browse</a> while this is out.</p>` +
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
    `<button data-role="reload" title="reload the frame">Reload</button>` +
    `<span class="grow"></span>` +
    `<button data-role="full" aria-pressed="${isFull() ? 'true' : 'false'}">Full</button>` +
    `<a class="popout" href="${esc(url)}" target="_blank" rel="noopener">Pop Out ↗</a>` +
    `</div>` +
    `<div class="stagewrap"><iframe class="stage" data-role="stage" ` +
    `src="${esc(url)}" title="${esc(at)}"></iframe></div>` +
    `<div class="grip" data-role="grip" title="drag to resize"></div>` +
    `<div class="runsplit-under">` +
    // "imports 1 · scopes 0" is two numbers and no meaning. What a reader
    // wants is the sentence those numbers are evidence for.
    `<p class="dim">${
      specifiers.length === 0
        ? 'resolves nothing — this page imports no decks'
        : `${specifiers.length} specifier${specifiers.length === 1 ? '' : 's'} ` +
          `answered by ${new Set(answered).size} deck${new Set(answered).size === 1 ? '' : 's'}` +
          (scopes.length
            ? `, and ${scopes.length} of them bring their own dependencies`
            : ', none of which bring dependencies of their own')
    }</p>` +
    (map.trial ? `<p class="trialnote">standing in: <code>${esc(map.trial)}</code></p>` : '') +
    (map.missing
      ? `<p class="dim">no import map injected — this page resolves nothing</p>`
      : `<table><thead><tr><th>specifier</th><th>answered by</th><th>path</th></tr></thead>` +
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
  } catch (error) {
    app.innerHTML =
      `<main><div class="err"><b>${esc(error.code ?? 'error')}</b> — ` +
      `${esc(error.message)}</div></main>`;
  }
  cursor = -1;
  keys.keys = bindings();
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
    list.push(['f', 'full'], ['r', 'reload']);
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

await loadOrigins();
await loadHeat();
onHeatChange(() => {
  // Only the index is decorated, and re-rendering while a demo is framed
  // would tear the iframe down and restart whatever it was doing.
  if (!currentAt()) render();
});
onLiveChange(() => loadHeat());

render();
