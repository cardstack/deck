// Two Leaflets, one page.
//
// The only Deck-specific thing here is the URL. Both halves do a plain
// dynamic `import()` of a module served at an exact version, and the browser
// treats them as two unrelated modules — because they are. Two decks, two
// treeHashes, no collision.

import { installPillStyles, legend, pill } from 'ui/pills';

const build = await (await fetch('./build.json')).json();

installPillStyles();

// `provenance.repo` is whatever npm recorded, which is usually a git URL.
// Reduce it to the thing a person recognises: org/repo.
const repoId = (url) =>
  (url ?? '').replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') || null;
const { depot, entry, changed, modules, store, upstream, fork, provenance, topojson, atlas } =
  build;

const urlFor = (side) => `/${depot}/${side.deck}@${side.version}/${entry}`;
const cssFor = (side) => `/${depot}/${side.deck}@${side.version}/dist/leaflet.css`;

// Leaflet's stylesheet comes from the deck too. If it came from a CDN the
// page would not be hermetic, and the demo's whole claim would be false.
for (let side of [upstream, fork]) {
  let link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = cssFor(side);
  document.head.append(link);
}

// The data and the converter, from this depot. `feature()` turns TopoJSON
// into the GeoJSON Leaflet understands; the atlas deck's own loader fetches
// the bytes. Both are exact-version URLs, so both are immutable.
const { feature } = await import(
  `/${depot}/${topojson.deck}@${topojson.version}/src/index.js`
);
const { countries } = await import(
  `/${depot}/${atlas.deck}@${atlas.version}/index.js`
);
const topology = await countries();
const all = feature(topology, topology.objects.countries);

// Web Mercator has a seam at ±180°, and a polygon whose ring crosses it is
// drawn as a slab spanning the whole map. Splitting rings at the antimeridian
// is real cartography and none of Deck's business, so the handful of features
// that wrap are dropped and the page says so. `filter` is not a style — the
// claim that upstream and the fork differ only by Path.js survives it.
const spans = (coords, seen = []) => {
  if (typeof coords[0] === 'number') {
    seen.push(coords[0]);
  } else {
    for (let part of coords) spans(part, seen);
  }
  return seen;
};
const wraps = (f) => {
  let lons = spans(f.geometry.coordinates);
  return Math.max(...lons) - Math.min(...lons) > 180;
};
const dropped = all.features.filter(wraps).map((f) => f.properties?.name ?? '?');
const world = { ...all, features: all.features.filter((f) => !wraps(f)) };

// Leaflet reads the container's size once, at `L.map()`, and sizes its SVG
// viewBox from it. Two things here can make that size wrong: the page's own
// stylesheet is injected below (so `.map { height: 19rem }` may not have
// applied yet), and this page is embedded in a resizable frame by the demo
// hub. Getting it wrong is silent — the map builds, the controls render, and
// the vector layers land in a 0×0 viewBox. So each map watches its own box
// and re-measures.
let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
  <header>
    <h1>Take all of it. Change the one thing you disagree with.</h1>
    <p class="lede">
      Leaflet publishes real per-file ESM, so vendoring it keeps the module
      boundary intact — and “change one file” means changing one file, not
      patching a bundle or maintaining a downstream build. Below is
      <strong>upstream</strong> and <strong>a fork that differs by two
      files</strong> — same world, same data, same converter, different
      <em>projection</em>, running side by side in one document.
      <br />
      Look at Greenland, then at Africa.
    </p>
    <div class="namekey">
      ${legend()}
      <p class="namenote">
        This page names the same library three ways, and they mean different
        things. ${pill('npm', `${provenance.name}@${provenance.version}`)} is the
        artifact that was fetched and hashed;
        ${repoId(provenance.repo) ? `${pill('github', repoId(provenance.repo))} is where the code is written;` : ''}
        ${pill('deck', `lib/leaflet@${upstream.version}`)} is where this depot
        serves it from. “85 modules” is a fact about the first; “3 objects” is
        a fact about the third.
      </p>
    </div>
  </header>

  <section class="maps">
    ${[
      {
        side: upstream,
        kind: 'upstream',
        title: 'as published — Web Mercator',
        sub: 'vendored from npm, unmodified',
      },
      {
        side: fork,
        kind: 'fork',
        title: 'my fork — Gall–Peters',
        sub: `changed ${changed.length} files — projection, palette, chrome`,
      },
    ]
      .map(
        ({ side, kind, title, sub }) => `
      <article class="map-card ${kind}">
        <div class="strip">
          <span class="dot"></span>
          ${pill('deck', `${side.deck}@${side.version}`)}
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
      <b>${store.forkCost}</b>
      <span>objects is what the fork cost. Two ${modules}-module copies of
      Leaflet, and <strong>${store.shared}</strong> of those files are
      byte-identical, so they are stored once — the fork added only the
      ${changed.length} files it edited plus the manifest recording its
      lineage. The whole store is ${store.objects} objects for four decks.</span>
    </div>
    <div class="fact">
      <b>0</b>
      <span>requests to the live web. Every country is an SVG path drawn from
      ${(atlas.bytes / 1024).toFixed(0)} KB of TopoJSON in
      ${pill('deck', `${atlas.deck}@${atlas.version}`)}, converted by
      ${pill('deck', `${topojson.deck}@${topojson.version}`)} — no tile server,
      and even the stylesheet is served from the deck. A deck that would need
      a CDN at runtime is not sealed, and Deck refuses to seal it (L6).
      <br /><small>${dropped.length} feature${dropped.length === 1 ? '' : 's'} that
      cross the antimeridian are filtered out (${dropped.join(', ')}) — a
      Mercator seam, not a Deck one.</small></span>
    </div>
    <div class="fact prov">
      <b>✓</b>
      <span>
        provenance survives the fork — it is still Leaflet and still says so:<br />
        ${pill('npm', `${provenance.name}@${provenance.version}`)}
        ${repoId(provenance.repo) ? pill('github', provenance.commit ? `${repoId(provenance.repo)}@${provenance.commit}` : repoId(provenance.repo)) : ''}
        <br /><code class="integrity">${provenance.integrity ?? 'no integrity published'}</code>
      </span>
    </div>
  </section>

  <section class="reading">
    <h3>What just happened</h3>
    <ol>
      <li><strong>Vendored from source, not from a CDN.</strong> ${modules}
      modules, nothing pointing outside the package. The tree npm published
      is the tree being served.</li>
      <li><strong>The fork is ${changed.length} files different, and one of
      them is maths.</strong> The right-hand map is drawn in
      <strong>Gall–Peters</strong> — cylindrical equal-area — because
      <code>Projection.SphericalMercator.js</code> was rewritten to project
      it: <code>y</code> goes as <code>sin(φ)</code> instead of
      <code>log(tan(…))</code>, so Greenland collapses to its true size and
      the tropics stretch. Leaflet ships EPSG:3857, EPSG:4326, EPSG:3395 and
      Simple; Gall–Peters is not among them, so there is no option, no plugin
      hook and no config file that produces this map.
      <br />
      The amber is the counter-example, kept deliberately: it is
      <code>Path.js</code>'s default style, which you <em>could</em> have
      passed as an argument. Both are one-file edits here, which is the
      point — the useful question is never “is it configurable” but “is the
      module boundary still there”.</li>
      <li><strong>It copied almost nothing.</strong> Content addressing is
      per file and store-wide, so an undiverged file is one object however
      many decks point at it — ${store.shared} of ${modules} here.</li>
      <li><strong>Both are addressable forever.</strong> Different trees,
      different hashes, neither able to be mistaken for the other — and
      upstream did not have to agree to any of it.</li>
    </ol>
  </section>
`;

const VIEW = [20, 0];
const ZOOM = 1;

function mount(kind, side, L) {
  let container = document.getElementById(`map-${kind}`);
  let map = L.map(container, {
    center: VIEW,
    zoom: ZOOM,
    attributionControl: false,
    worldCopyJump: false,
  });
  // NO STYLE ARGUMENT. That is the whole point of this page: every country
  // is drawn with whatever `src/layer/vector/Path.js` says the defaults are,
  // so upstream and the fork differ by a file rather than by an argument.
  L.geoJSON(world).addTo(map).bindPopup(`${side.deck}@${side.version}`);
  new ResizeObserver(() => {
    map.invalidateSize({ animate: false });
    map.setView(VIEW, ZOOM, { animate: false });
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

  .namekey { margin:0 0 2rem; padding:.85rem 1rem; background:var(--panel); border:1px solid var(--line); border-radius:10px; }
  .namenote { margin:.6rem 0 0; font-size:.85rem; color:var(--dim); max-width:52rem; line-height:1.7; }
  .integrity { color:var(--dim); word-break:break-all; }

  .maps { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(20rem,1fr)); }
  .map-card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem 1.2rem; }
  .strip { display:flex; align-items:center; gap:.5rem; margin-bottom:.6rem; }
  .dot { width:.6rem; height:.6rem; border-radius:50%; flex:none; border:2px solid var(--dim); }
  .upstream .dot { border-color:var(--up); }
  .fork .dot { border-color:var(--fork); }
  .map-card h2 { font-size:1rem; margin:0 0 .2rem; }
  .sub { color:var(--dim); margin:0 0 .8rem; font-size:.85rem; }
  .map { height:22rem; border-radius:7px; overflow:hidden; background:#eef1f5; border:1px solid var(--line); }
  .leaflet-container { background:#eef1f5; }
  .hash { color:#b7b7bd; font:.7rem ui-monospace, monospace; margin:.5rem 0 0; }

  /* Make the forked glyphs unmissable. */
  .leaflet-control-zoom a { font-size:1.05rem; }

  .facts { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(16rem,1fr)); margin-top:1.25rem; }
  .fact { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem; display:flex; gap:.9rem; }
  /* Direct child only. The pills put their own <b> around a version, and a
     descendant selector here rendered those at 1.7rem inside every fact. */
  .fact > b { font-size:1.7rem; line-height:1.1; color:var(--up); flex:none; }
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
