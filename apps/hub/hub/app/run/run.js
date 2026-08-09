// /run — the assembled, executing thing.
//
//   ?at=/three-js/app/studio/index.html   what to run
//   &lens=read                            run it, or read what it resolved to
//   &with=lib/three=me/three@0.160.0-holo…  swap a part, without a checkout
//
// THE TOGGLE IS THE PRODUCT.
// ══════════════════════════
// Every package site can show you source. A few can show you a demo. None can
// show you that the source and the demo are the same bytes, because on every
// other system they are not: what runs came out of a build, and what you read
// went in. Here the address the browser executed IS the address you can open,
// so `run` and `read` are two renderings of one fact rather than two artifacts
// that ought to agree.
//
// `read` is therefore not "view source". It is the resolved import map — the
// exact table the server injected into the page that is running — with every
// node a link into /browse at the address that answered. On any other site
// "what am I actually running" is an inference. Here it is a readout.
import 'ui/nav';
import { installNavStyles } from 'ui/nav';

installNavStyles();

const app = document.getElementById('app');
const keys = document.querySelector('deck-keys');

const esc = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

const params = () => new URLSearchParams(location.search);
const currentAt = () => params().get('at') ?? '';
const currentLens = () => (params().get('lens') === 'read' ? 'read' : 'run');
const currentWith = () => params().getAll('with');

function go(next = {}) {
  let query = new URLSearchParams();
  let at = 'at' in next ? next.at : currentAt();
  let lens = 'lens' in next ? next.lens : currentLens();
  let withs = 'with' in next ? next.with : currentWith();
  if (at) query.set('at', at);
  if (lens === 'read') query.set('lens', 'read');
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

/** The URL the iframe loads: the page, plus any trials. */
function runUrl(at, withs = currentWith()) {
  let query = withs.map((value) => `with=${value}`).join('&');
  return query ? `${at}?${query}` : at;
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
  let rows = items
    .map(
      (item) =>
        `<tr data-name="${esc(item.at.toLowerCase())}">` +
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
    `<table><thead><tr><th>deck</th><th>page</th><th>where</th></tr></thead>` +
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
  let lens = currentLens();
  let withs = currentWith();
  let url = runUrl(at, withs);
  let head =
    `<div class="prompt"><span class="prompt-mark">deck run</span> ` +
    `<a href="?" data-at="">~</a><span class="sep">/</span>` +
    `<b>${esc(at.replace(/^\//, ''))}</b></div>` +
    `<main>` +
    // The toggle. One control, two positions, same place on every page.
    `<div class="lens" data-lens="${lens}">` +
    `<button data-role="lens" value="run"${lens === 'run' ? ' aria-current="true"' : ''}>run</button>` +
    `<button data-role="lens" value="read"${lens === 'read' ? ' aria-current="true"' : ''}>read</button>` +
    `</div>`;

  if (withs.length) {
    // C5: a trial is not the sealed representation and must never be mistaken
    // for one. It says so, and one control leaves.
    head +=
      `<div class="trial"><b>trial</b> ` +
      withs.map((value) => `<code>${esc(value)}</code>`).join(' ') +
      ` <button data-role="clear-with">exit</button></div>`;
  }

  if (lens === 'run') {
    return (
      head +
      `<iframe class="stage" src="${esc(url)}" title="${esc(at)}"></iframe>` +
      `<p class="raw"><a href="${esc(url)}">open standalone</a></p></main>`
    );
  }

  let map = await resolvedMap(url);
  let scopes = Object.entries(map.scopes ?? {});
  return (
    head +
    `<div class="facts">` +
    `<div><b>imports</b> ${Object.keys(map.imports ?? {}).filter((k) => !k.endsWith('/')).length}</div>` +
    `<div><b>scopes</b> ${scopes.length}</div>` +
    (map.trial ? `<div><b>x-deck-with</b> ${esc(map.trial)}</div>` : '') +
    `</div>` +
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
  if (currentAt()) list.push(['t', 'run / read'], ['u', 'up']);
  if (app.querySelector('[data-role="filter"]')) list.push(['/', 'filter']);
  list.push([['g', 'G'], 'ends'], ['y', 'copy address'], [['1', '4'], 'apps']);
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
    case 't':
      return go({ lens: currentLens() === 'run' ? 'read' : 'run' });
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
  let lens = event.target.closest('[data-role="lens"]');
  if (lens) return go({ lens: lens.value });
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

render();
