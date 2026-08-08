// Two Leaflets, one page.
//
// The only Deck-specific thing here is the URL. Both halves do a plain
// dynamic `import()` of a module served at an exact version, and the browser
// treats them as two unrelated modules — because they are. Two decks, two
// treeHashes, no collision.

const build = await (await fetch('./build.json')).json();
const { realm, entry, changed, modules, store, upstream, fork, provenance } = build;

const urlFor = (side) => `/${realm}/${side.deck}@${side.version}/${entry}`;
const cssFor = (side) => `/${realm}/${side.deck}@${side.version}/dist/leaflet.css`;

// Leaflet's stylesheet comes from the deck too. If it came from a CDN the
// page would not be hermetic, and the demo's whole claim would be false.
for (let side of [upstream, fork]) {
  let link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = cssFor(side);
  document.head.append(link);
}

let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
  <header>
    <h1>Take all of it. Change the one thing you disagree with.</h1>
    <p class="lede">
      Leaflet publishes real per-file ESM, so vendoring it keeps the module
      boundary intact — and “change one file” means changing one file, not
      patching a bundle or maintaining a downstream build. Below is
      <strong>upstream</strong> and <strong>a fork that differs by exactly
      one file</strong>, running side by side in one document.
      <br />
      Look at the zoom controls.
    </p>
  </header>

  <section class="maps">
    ${[
      { side: upstream, kind: 'upstream', title: 'as published', sub: 'vendored from npm, unmodified' },
      { side: fork, kind: 'fork', title: 'my fork', sub: `changed ${changed}` },
    ]
      .map(
        ({ side, kind, title, sub }) => `
      <article class="map-card ${kind}">
        <div class="strip">
          <span class="dot"></span>
          <code class="deck">${side.deck}</code>
          <code class="version">${side.version}</code>
        </div>
        <h2>${title}</h2>
        <p class="sub"><code>${sub}</code></p>
        <div class="map" id="map-${kind}"></div>
        <p class="hash" title="tree-hash-v1">${side.hash.slice(0, 32)}…</p>
      </article>`,
      )
      .join('')}
  </section>

  <section class="facts">
    <div class="fact">
      <b>${store.objects}</b>
      <span>objects in the store for two ${modules}-module packages.
      Two full copies would be ${store.wouldBe}. The fork cost
      <strong>${store.objects - modules}</strong> —
      the other ${modules - 1} are the same bytes, so they are stored once.</span>
    </div>
    <div class="fact">
      <b>0</b>
      <span>requests to the live web. No tile server: both maps draw vector
      layers, and even the stylesheet is served from the deck. A deck that
      would need a CDN at runtime is not sealed, and Deck refuses to seal
      it (L6).</span>
    </div>
    <div class="fact prov">
      <b>✓</b>
      <span>
        provenance survives the fork — it is still Leaflet and still says so:<br />
        <code>${provenance.registry} · ${provenance.name}@${provenance.version}</code><br />
        <code>${provenance.integrity ?? 'no integrity published'}</code>
        ${provenance.repo ? `<br /><code>${provenance.repo}${provenance.commit ? ` @ ${provenance.commit.slice(0, 12)}` : ''}</code>` : ''}
      </span>
    </div>
  </section>

  <section class="reading">
    <h3>What just happened</h3>
    <ol>
      <li><strong>Vendored from source, not from a CDN.</strong> ${modules}
      modules, nothing pointing outside the package. The tree npm published
      is the tree being served.</li>
      <li><strong>The fork is one file different.</strong> Same
      <code>${entry}</code>, same everything else. Because the boundary
      survived vendoring, the edit is an ordinary edit.</li>
      <li><strong>It copied almost nothing.</strong> Content addressing is
      per file and store-wide, so an undiverged file is one object however
      many decks point at it.</li>
      <li><strong>Both are addressable forever.</strong> Different trees,
      different hashes, neither able to be mistaken for the other — and
      upstream did not have to agree to any of it.</li>
    </ol>
  </section>
`;

// Mount the maps. Same code for both sides; only the URL differs.
const SHAPE = [
  [51.53, -0.14],
  [51.52, -0.08],
  [51.5, -0.07],
  [51.49, -0.13],
];

// Leaflet reads the container's size once, at `L.map()`, and sizes its SVG
// viewBox from it. Two things here can make that size wrong: the page's own
// stylesheet is injected below (so `.map { height: 19rem }` may not have
// applied yet), and this page is embedded in a resizable frame by the demo
// hub. Getting it wrong is silent — the map builds, the controls render, and
// the vector layers land in a 0×0 viewBox. So each map watches its own box
// and re-measures.
function mount(kind, side, L) {
  let container = document.getElementById(`map-${kind}`);
  let map = L.map(container, {
    center: [51.51, -0.105],
    zoom: 12,
    attributionControl: false,
  });
  // Vector layers only — the map never asks the network for a tile.
  L.polygon(SHAPE, { color: kind === 'fork' ? '#b45309' : '#0c9d7c', weight: 2 }).addTo(map);
  L.circleMarker([51.51, -0.105], { radius: 7, color: '#0069f9' })
    .addTo(map)
    .bindPopup(`${side.deck}@${side.version}`);
  new ResizeObserver(() => {
    map.invalidateSize({ animate: false });
    map.setView([51.51, -0.105], 12, { animate: false });
  }).observe(container);
  return map;
}

let style = document.createElement('style');
style.textContent = `
  /* Boxel light surface tier. Light only — see the note in codelist. */
  :root {
    --bg:#f7f8fa; --panel:#fff; --line:#e2e8f0; --ink:#272330; --dim:#5a586a;
    --up:#0c9d7c; --fork:#b45309;
  }
  * { box-sizing: border-box; }
  body {
    margin:0; padding:3rem 1.5rem 5rem; background:var(--bg); color:var(--ink);
    font:15px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  #app { max-width:76rem; margin:0 auto; }
  #app.loading { color:var(--dim); }
  h1 { font-size:1.6rem; margin:0 0 .5rem; letter-spacing:-.01em; }
  .lede { color:var(--dim); max-width:48rem; margin:0 0 2rem; }
  .lede strong { color:var(--ink); }
  code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.85em; }

  .maps { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(20rem,1fr)); }
  .map-card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem 1.2rem; }
  .strip { display:flex; align-items:center; gap:.5rem; margin-bottom:.6rem; }
  .dot { width:.6rem; height:.6rem; border-radius:50%; flex:none; border:2px solid var(--dim); }
  .upstream .dot { border-color:var(--up); }
  .fork .dot { border-color:var(--fork); }
  .deck { color:var(--dim); }
  .version { margin-left:auto; padding:.1rem .45rem; border-radius:4px; background:var(--line); }
  .map-card h2 { font-size:1rem; margin:0 0 .2rem; }
  .sub { color:var(--dim); margin:0 0 .8rem; font-size:.85rem; }
  .map { height:19rem; border-radius:7px; overflow:hidden; background:#eef1f5; border:1px solid var(--line); }
  .hash { color:#b7b7bd; font:.7rem ui-monospace, monospace; margin:.5rem 0 0; }

  /* Make the forked glyphs unmissable. */
  .leaflet-control-zoom a { font-size:1.05rem; }

  .facts { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(16rem,1fr)); margin-top:1.25rem; }
  .fact { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem; display:flex; gap:.9rem; }
  .fact b { font-size:1.7rem; line-height:1.1; color:var(--up); flex:none; }
  .fact span { color:var(--dim); font-size:.85rem; }
  .fact strong { color:var(--ink); }
  .fact.prov code { display:inline-block; color:var(--dim); word-break:break-all; }

  .reading { margin-top:2.5rem; border-top:1px solid var(--line); padding-top:1.5rem; }
  .reading h3 { font-size:1rem; margin:0 0 .75rem; }
  .reading ol { margin:0; padding-left:1.2rem; color:var(--dim); max-width:52rem; }
  .reading li { margin-bottom:.5rem; }
  .reading strong { color:var(--ink); font-weight:600; }
`;
document.head.append(style);

// Only now, with the layout settled, are the containers their real size.
for (let [kind, side] of [
  ['upstream', upstream],
  ['fork', fork],
]) {
  mount(kind, side, await import(urlFor(side)));
}
