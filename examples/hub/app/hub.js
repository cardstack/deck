// The hub console.
//
// It renders three kinds of page from one small state object: the overview,
// the deckbook, and one page per demo. A demo page is an explanation, the
// live app in a frame, and the transcript the demo actually printed while it
// built its store — which is the honest version of "what is going on here".

import { installPillStyles, legend, pill } from '/pills.js';

installPillStyles();

const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

let state = { demos: [], laws: [] };
let tab = 'app';

async function refresh() {
  try {
    state = await (await fetch('/api/demos')).json();
  } catch {
    return;
  }
  renderRail();
  let ready = state.demos.filter((d) => d.status === 'ready').length;
  let health = document.querySelector('#health');
  health.textContent =
    ready === state.demos.length ? `${ready}/${state.demos.length} running` : `${ready}/${state.demos.length} starting…`;
  health.classList.toggle('ready', ready === state.demos.length);
  // The stage only needs redrawing while something is still coming up.
  if (ready < state.demos.length || document.querySelector('.viewport.pending')) {
    render();
  }
}

function route() {
  let hash = location.hash.replace(/^#\/?/, '');
  if (!hash) return { page: 'overview' };
  if (hash === 'deckbook') return { page: 'deckbook' };
  return { page: 'demo', name: hash };
}

function renderRail() {
  let { page, name } = route();
  document.querySelector('#rail').innerHTML = `
    <div class="rail-label">Start here</div>
    <a class="rail-row ${page === 'overview' ? 'selected' : ''}" href="#/">
      <span class="dot ready"></span><span class="rail-name">What Deck is</span>
    </a>
    <a class="rail-row ${page === 'deckbook' ? 'selected' : ''}" href="#/deckbook">
      <span class="dot ready"></span><span class="rail-name">The Deckbook</span>
    </a>
    <div class="rail-label">Demos</div>
    ${state.demos
      .map(
        (demo) => `<a class="rail-row ${page === 'demo' && name === demo.name ? 'selected' : ''}" href="#/${demo.name}">
          <span class="dot ${demo.status}"></span><span class="rail-name">${esc(demo.title)}</span>
        </a>`,
      )
      .join('')}
  `;
}

function overview() {
  return `
  <div class="sheet">
    <div class="kicker">The Deck protocol</div>
    <h1>Five demos, one store model</h1>
    <p class="lede">
      Deck gives a package one identity — the hash of its file tree — and
      serves it at rest. Everything else in these demos falls out of that:
      a fork of 85 files costs two objects, two versions of one library run
      in one document, a proposal is a tree that exists rather than a branch,
      and a merge is a pure function of three content addresses.
    </p>
    <p class="body">
      Each demo below is its own process, its own depot directory, and its own
      content-addressed store. They are not sharing anything, which is why the
      numbers each one prints are its own.
    </p>

    <h2>Three kinds of name</h2>
    <p class="body">
      Nearly every confusing sentence about a vendored package is confusing
      because three different names for &ldquo;the same thing&rdquo; are
      spelled the same way, in the same font, in the same paragraph. They are
      not the same thing, and which one you mean changes what a claim means.
      So nothing here prints a bare name.
    </p>
    <div class="card">${legend()}</div>
    <table class="names">
      <tbody>
        <tr><td>${pill('npm', 'leaflet@1.9.4')}</td><td>85 modules</td><td class="quiet">a fact about the published artifact</td></tr>
        <tr><td>${pill('github', 'Leaflet/Leaflet')}</td><td>fixed in 1.9.5</td><td class="quiet">a fact about the source</td></tr>
        <tr><td>${pill('deck', '/site/lib/leaflet@1.9.4/…')}</td><td>the fork cost 2 objects</td><td class="quiet">a fact about this store</td></tr>
      </tbody>
    </table>
    <p class="body small">
      The same module draws these in all five demos and in this page. The
      depots publish it as a deck, <code>ui/pills@1.0.0</code>; the hub is not
      a depot, so it serves the identical file at <code>/pills.js</code>. Same
      bytes, different carriage.
    </p>

    <h2>The demos</h2>
    <div class="grid">
      ${state.demos
        .map(
          (demo) => `<a class="tile" href="#/${demo.name}">
        <div class="kicker">${esc(demo.workload)}</div>
        <h3>${esc(demo.title)}</h3>
        <p>${esc(demo.lede.slice(0, 150))}${demo.lede.length > 150 ? '…' : ''}</p>
        <div class="foot"><span class="dot ${demo.status}"></span>${esc(demo.status)} · localhost:${demo.port}</div>
      </a>`,
        )
        .join('')}
    </div>

    <h2>The laws</h2>
    <p class="body">
      The contract, in twelve lines. An implementation implements Deck by
      passing <code>deck conform</code>, not by reading them — they exist so a
      person can tell what the suite is protecting.
    </p>
    <div class="laws">
      ${state.laws
        .map(
          ([id, name, text]) => `<div class="law">
        <b>${esc(id)}</b><span>${esc(name)}</span>
        <p>${text}</p>
      </div>`,
        )
        .join('')}
    </div>
  </div>`;
}

function deckbook() {
  return `
  <div class="sheet">
    <div class="kicker">Reference</div>
    <h1>The Deckbook</h1>
    <p class="lede">
      The protocol taught from the running code: vocabulary, the address
      space, volatility, the store, vendoring, forks and offers, the HTTP
      surface, and an honest status table of what is built versus specified.
    </p>
    <div class="viewport">
      <div class="bar">
        <span>/deckbook</span>
        <a href="/deckbook" target="_blank" rel="noreferrer">open on its own →</a>
      </div>
      <iframe src="/deckbook" title="The Deckbook" style="height: 78vh"></iframe>
    </div>
  </div>`;
}

function demoPage(demo) {
  let pending = demo.status !== 'ready';
  let body =
    tab === 'transcript'
      ? `<div class="viewport ${pending ? 'pending' : ''}">
           <div class="bar"><span>node demo.mjs · what it printed</span></div>
           <pre class="transcript" id="transcript">loading…</pre>
         </div>`
      : tab === 'tries'
        ? `<div class="viewport">
             <table>
               <thead><tr><th>what</th><th>url</th></tr></thead>
               <tbody>
                 ${demo.tries
                   .map(
                     (t) => `<tr>
                   <td><a href="${esc(demo.origin + t.path)}" target="_blank" rel="noreferrer">${esc(t.label)} →</a></td>
                   <td>${pill('deck', t.path, { wrap: true })}</td>
                 </tr>`,
                   )
                   .join('')}
                 <tr>
                   <td><a href="${esc(demo.origin)}/_browser" target="_blank" rel="noreferrer">browse the store →</a></td>
                   <td class="path">/_browser</td>
                 </tr>
               </tbody>
             </table>
           </div>
           <p class="body" style="margin-top:12px;font-size:13px">
             Every one of these is a plain HTTP GET against
             <code>${esc(demo.origin)}</code>. Nothing in this hub is a special
             endpoint — it is the same read-only server the demo starts.
           </p>`
        : pending
          ? `<div class="viewport pending"><pre class="transcript" id="transcript">starting…</pre></div>`
          : `<div class="viewport">
               <div class="bar">
                 <span>${esc(demo.origin)}</span>
                 <a href="${esc(demo.origin)}" target="_blank" rel="noreferrer">open in a tab →</a>
               </div>
               <iframe src="${esc(demo.origin)}" title="${esc(demo.title)}"></iframe>
             </div>`;

  return `
  <div class="sheet">
    <div class="kicker">${esc(demo.workload)}</div>
    <h1>${esc(demo.title)}</h1>
    <p class="lede">${esc(demo.lede)}</p>

    <div class="card">
      <div class="kicker" style="margin-bottom:8px">What to look at</div>
      <ul class="look">${demo.look.map((point) => `<li>${point}</li>`).join('')}</ul>
    </div>

    ${
      demo.status === 'failed'
        ? '<p class="notice" style="margin-top:14px">This demo exited. The transcript below is what it printed on the way out.</p>'
        : ''
    }

    <div class="tabs">
      <button class="tab ${tab === 'app' ? 'active' : ''}" data-tab="app">The app</button>
      <button class="tab ${tab === 'transcript' ? 'active' : ''}" data-tab="transcript">Transcript</button>
      <button class="tab ${tab === 'tries' ? 'active' : ''}" data-tab="tries">Try it yourself</button>
    </div>
    ${body}
  </div>`;
}

async function loadTranscript(name) {
  let node = document.querySelector('#transcript');
  if (!node) return;
  try {
    node.textContent = await (await fetch(`/api/log/${name}`)).text();
  } catch {
    node.textContent = '(no transcript)';
  }
}

function render() {
  let { page, name } = route();
  let stage = document.querySelector('#stage');
  if (page === 'overview') {
    stage.innerHTML = overview();
  } else if (page === 'deckbook') {
    stage.innerHTML = deckbook();
  } else {
    let demo = state.demos.find((d) => d.name === name);
    if (!demo) {
      stage.innerHTML = '<div class="sheet"><h1>No such demo</h1></div>';
      return;
    }
    stage.innerHTML = demoPage(demo);
    for (let button of stage.querySelectorAll('.tab')) {
      button.addEventListener('click', () => {
        tab = button.dataset.tab;
        render();
      });
    }
    if (document.querySelector('#transcript')) {
      loadTranscript(name);
    }
  }
  renderRail();
}

addEventListener('hashchange', () => {
  tab = 'app';
  document.querySelector('#stage').scrollTop = 0;
  render();
});

await refresh();
render();
setInterval(refresh, 1500);
