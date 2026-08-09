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
import { installNavStyles } from 'ui/nav';
import {
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

const esc = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

const params = () => new URLSearchParams(location.search);
const currentAt = () => params().get('at') ?? '';
const currentWith = () => params().getAll('with');

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

async function viewOne(at) {
  let withs = currentWith();
  let { url, why } = runTarget(at, withs);
  let head =
    `<div class="prompt"><span class="prompt-mark">deck run</span> ` +
    `<a href="?" data-at="">~</a><span class="sep">/</span>` +
    `<b>${esc(at.replace(/^\//, ''))}</b></div>` +
    `<main>`;

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
    // The way out of the frame sits ABOVE it, right-aligned. Overlapping the
    // stage would cover the running page — the one thing on screen this app
    // exists to show — and an iframe is already a compromise without the
    // chrome eating a corner of it.
    `<div class="stagebar"><a class="popout" href="${esc(url)}" ` +
    `target="_blank" rel="noopener">Pop Out ↗</a></div>` +
    `<iframe class="stage" src="${esc(url)}" title="${esc(at)}"></iframe>` +
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
    `</main>`
  );
}

// ---------------------------------------------------------------------------

async function render() {
  let at = currentAt();
  try {
    app.innerHTML = at ? await viewOne(at) : await viewIndex();
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
    default:
  }
});

app.addEventListener('click', (event) => {
  if (event.target.closest('[data-role="clear-with"]')) return go({ with: [] });
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
new EventSource('/_live/events').addEventListener('change', () => loadHeat());

render();
