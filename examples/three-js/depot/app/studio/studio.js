// Two three.js builds, one page, one scene definition.
//
// The scene below is written once and run twice. Nothing in it knows which
// library it got — both halves receive a `THREE` namespace from a dynamic
// `import()` of an exact-version deck URL, and the browser treats them as two
// unrelated modules because they are: two trees, two hashes, no collision.
//
// So every visible difference between the two canvases comes from one file.

import { installPillStyles, legend, pill } from 'ui/pills';

const build = await (await fetch('./build.json')).json();
installPillStyles();

const repoId = (url) =>
  (url ?? '').replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') || null;
const {
  depot,
  entry,
  changed,
  modules,
  publishedFiles,
  probes,
  store,
  upstream,
  fork,
  provenance,
} = build;

const urlFor = (side) => `/${depot}/${side.deck}@${side.version}/${entry}`;

let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
  <header>
    <div class="crumb">deck · teach · three.js fork</div>
    <h1>374 files — edit one, keep the rest.</h1>
    <p class="lede">Two canvases. One <code>MeshPhongMaterial</code> torus knot
      each, and <strong>one GLSL chunk</strong> different between them.</p>
  </header>

  <section class="canvases">
    ${[
      { side: upstream, kind: 'upstream', title: 'upstream (unmodified)', sub: 'vendored from npm source, unmodified' },
      {
        side: fork,
        kind: 'fork',
        title: 'my fork — hologram',
        sub: `changed ${changed.split('/').pop()}`,
      },
    ]
      .map(
        ({ side, kind, title, sub }) => `
      <article class="card ${kind}">
        <div class="strip"><span class="dot"></span>${pill('deck', `${side.deck}@${side.version}`, { wrap: true })}</div>
        <h2>${title}</h2>
        <p class="sub"><code>${sub}</code></p>
        <div class="stage"><canvas id="c-${kind}"></canvas></div>
        <p class="hash" title="tree-hash-v1">${side.hash.slice(0, 32)}…</p>
        <p class="timing" id="t-${kind}">loading ${modules} modules…</p>
      </article>`,
      )
      .join('')}
  </section>

  <p class="note" id="page-cost">measuring…</p>

  <section class="what">
    <h3>What npm published</h3>
    <table>
      <tr><th>entry</th><th>modules</th><th>size</th><th></th></tr>
      ${probes
        .map(
          (probe) => `<tr class="${probe.modules === 1 ? 'bundle' : 'tree'}">
            <td><code>${probe.entry}</code></td>
            <td>${probe.modules}</td>
            <td>${probe.kb} KB</td>
            <td>${probe.modules === 1 ? 'a bundle — the boundary was lost at publish time' : 'a tree — every file is its own address'}</td>
          </tr>`,
        )
        .join('')}
    </table>
    <p class="note">
      ${publishedFiles} files in the tarball. The bundle is ${
        probes.length > 1
          ? Math.round((1 - probes.find((p) => p.modules === 1).kb / probes.find((p) => p.modules > 1).kb) * 100)
          : 0
      }% smaller and cannot be edited; the tree is ${modules} modules and can.
    </p>
  </section>

  <section class="diff">
    <h3>The whole change</h3>
    <p class="note"><code>${changed}</code></p>
    <pre class="before"><code>gl_FragColor = vec4( outgoingLight, diffuseColor.a );</code></pre>
    <pre class="after"><code>vec3  viewDir = normalize( vViewPosition );
float rim   = pow( 1.0 - abs( dot( viewDir, normal ) ), 2.5 );
float phase = dot( viewDir, normal ) * 6.0 + gl_FragCoord.y * 0.02;
vec3  iris  = 0.5 + 0.5 * cos( phase + vec3( 0.0, 2.094, 4.188 ) );
vec3  scan  = 0.70 + 0.30 * sin( gl_FragCoord.y * vec3( 1.50, 1.54, 1.58 ) );
vec3  holo  = outgoingLight * scan * mix( vec3( 1.0 ), iris, 0.6 ) + iris * rim * 2.0;
gl_FragColor = vec4( holo, diffuseColor.a );</code></pre>
    <p>
      Three effects, none reachable from a material. The <strong>rim</strong>
      asks how edge-on the surface is — <code>normal</code> and
      <code>vViewPosition</code> are in scope in this chunk — so it glows
      along every silhouette, which on a torus knot means every twist. The
      <strong>iridescence</strong> runs that same angle through a hue wheel —
      <code>cos()</code> offset by a third of a turn per channel — so the
      colour shifts as the knot rotates, which is what makes a hologram read
      as one. The <strong>chromatic scanline</strong> is screen-space: it
      comes from <code>gl_FragCoord</code>, the pixel, and each channel scans
      at its own frequency, so the bands fringe and stay still while the knot
      turns through them. That is the tell that it is a filter over the image
      and not a texture on the object.
      <br />
      This chunk is pasted into every shader three.js assembles for a lit
      material, so editing it is a different renderer rather than a different
      material. <code>MeshPhongMaterial</code> has around fifty options and
      none of them is either of these. There is no plugin interface for it.
      You edit the file, or you do not get it.
    </p>
  </section>

  <section class="namekey">
    ${legend()}
    <p class="namenote">
      ${pill('npm', `${provenance.name}@${provenance.version}`)} is the artifact
      that was fetched and hashed;
      ${repoId(provenance.repo) ? `${pill('github', repoId(provenance.repo))} is where the code is written;` : ''}
      ${pill('deck', `lib/three@${upstream.version}`)} is where this depot
      serves it from.
    </p>
  </section>

  <section class="facts">
    <div class="fact">
      <b>${store.forkCost}</b>
      <span>objects is what the fork cost. Two ${modules}-module copies, and
      <strong>${store.shared}</strong> files are byte-identical, so they are
      stored once. Two independent copies would be ${modules * 2}
      objects; the store holds ${store.objects}.</span>
    </div>
    <div class="fact">
      <b>1</b>
      <span>file changed, ${(1).toFixed(0)} of ${modules}. Against
      <code>build/three.module.js</code> the same edit is a patch into
      generated code that no upstream release survives.</span>
    </div>
    <div class="fact prov">
      <b>✓</b>
      <span>
        provenance survives the fork — still three.js, still says so:<br />
        ${pill('npm', `${provenance.name}@${provenance.version}`)}
        ${repoId(provenance.repo) ? pill('github', provenance.commit ? `${repoId(provenance.repo)}@${provenance.commit}` : repoId(provenance.repo)) : ''}
        <br /><code class="integrity">${provenance.integrity ?? 'no integrity published'}</code>
      </span>
    </div>
  </section>
`;

let style = document.createElement('style');
style.textContent = `
  :root {
    --bg:#f7f8fa; --panel:#fff; --line:#e2e8f0; --ink:#272330; --dim:#5a586a;
    --up:#0c9d7c; --fork:#b45309;
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:3rem 1.5rem 5rem; background:var(--bg); color:var(--ink);
         font:15px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  #app { max-width:76rem; margin:0 auto; }
  #app.loading { color:var(--dim); }
  h1 { font-size:1.6rem; margin:0 0 .5rem; letter-spacing:-.01em; }
  h3 { font-size:1rem; margin:0 0 .6rem; }
  .crumb { font:600 11px/1 inherit; letter-spacing:.11em; text-transform:uppercase; color:#8b8b93; }
  .lede { color:var(--dim); max-width:50rem; margin:.35rem 0 1.25rem; }
  .lede strong { color:var(--ink); }
  code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.85em; }
  .note { color:var(--dim); font-size:.85rem; }

  .namekey { margin:0 0 2rem; padding:.85rem 1rem; background:var(--panel);
             border:1px solid var(--line); border-radius:10px; }
  .namenote { margin:.6rem 0 0; font-size:.85rem; color:var(--dim); max-width:52rem; line-height:1.8; }
  .integrity { color:var(--dim); word-break:break-all; }

  .what table { width:100%; border-collapse:collapse; font-size:.85rem;
                background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .what th { text-align:left; font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; color:var(--dim); }
  .what th, .what td { padding:.45rem .7rem; border-bottom:1px solid #eceef1; }
  .what tr.tree td { color:var(--ink); }
  .what tr.bundle td { color:var(--dim); }

  .canvases { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(22rem,1fr)); margin:1.5rem 0; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem 1.2rem; }
  .strip { display:flex; align-items:center; gap:.5rem; margin-bottom:.6rem; }
  .dot { width:.6rem; height:.6rem; border-radius:50%; flex:none; border:2px solid var(--dim); }
  .upstream .dot { border-color:var(--up); }
  .fork .dot { border-color:var(--fork); }
  .card h2 { font-size:1rem; margin:0 0 .2rem; }
  .sub { color:var(--dim); margin:0 0 .8rem; font-size:.85rem; }
  .stage { aspect-ratio:4/3; border-radius:7px; overflow:hidden; background:#0b1021; border:1px solid var(--line); }
  .stage canvas { width:100%; height:100%; display:block; }
  .hash { color:#b7b7bd; font:.7rem ui-monospace, monospace; margin:.5rem 0 0; }
  .timing { color:var(--dim); font-size:.78rem; margin:.2rem 0 0; }

  .diff pre { background:var(--panel); border:1px solid var(--line); border-radius:8px;
              padding:.7rem .9rem; overflow:auto; font-size:.8rem; margin:.4rem 0; }
  .diff .before { border-left:3px solid #cbd5e1; }
  .diff .after { border-left:3px solid var(--fork); }
  .diff p { color:var(--dim); max-width:52rem; }

  .facts { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(16rem,1fr)); margin-top:1.25rem; }
  .fact { background:var(--panel); border:1px solid var(--line); border-radius:10px;
          padding:1rem 1.1rem; display:flex; gap:.9rem; }
  /* Direct child only — the pills carry their own <b> around a version. */
  .fact > b { font-size:1.7rem; line-height:1.1; color:var(--up); flex:none; }
  .fact span { color:var(--dim); font-size:.85rem; }
  .fact strong { color:var(--ink); }
  .fact.prov code { display:inline-block; color:var(--dim); word-break:break-all; }
`;
document.head.append(style);

// One scene, built twice. The only argument that differs is the namespace.
function scene(THREE, canvas) {
  let renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  let world = new THREE.Scene();
  world.background = new THREE.Color(0x0b1021);

  let camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100);
  camera.position.set(0, 0, 7);

  let mesh = new THREE.Mesh(
    new THREE.TorusKnotGeometry(1.5, 0.5, 180, 32),
    // A plain lit material with plain settings. Everything you see that is
    // not smooth comes from the shader chunk, not from here.
    new THREE.MeshPhongMaterial({ color: 0x2f9e8f, shininess: 40, specular: 0x88ffee }),
  );
  world.add(mesh);
  world.add(new THREE.AmbientLight(0xffffff, 0.35));
  let key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 4, 5);
  world.add(key);
  let rim = new THREE.DirectionalLight(0xff9a3c, 1.4);
  rim.position.set(-5, -2, -3);
  world.add(rim);

  let fit = () => {
    let { clientWidth: w, clientHeight: h } = canvas;
    if (w && h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  };
  new ResizeObserver(fit).observe(canvas);
  fit();

  let tick = (t) => {
    mesh.rotation.x = t / 3200;
    mesh.rotation.y = t / 2100;
    renderer.render(world, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Per-file delivery costs requests, and a page that shows it off should
// report the cost honestly. Three things make the naive version a lie:
//
//   1. The two sides load CONCURRENTLY and share the browser's connection
//      pool, so each one's elapsed time includes waiting behind the other.
//      Reporting them as two independent measurements of "374 modules" would
//      make the slower one look like a property of that deck.
//   2. Exact-version URLs are immutable, so a second visit is served from
//      cache. "One request each" would then be false for every module.
//   3. 373 of the 374 files are byte-identical across the two decks — but at
//      different URLs, so the browser really does fetch both copies. That
//      cost is real and belongs in the number rather than out of it.
//
// So the timing is taken from the Resource Timing entries the browser
// actually recorded, `transferSize === 0` is counted as a cache hit, and the
// page says the two loads overlapped.
const pageStarted = performance.now();
let sides = await Promise.all(
  [
    ['upstream', upstream],
    ['fork', fork],
  ].map(async ([kind, side]) => {
    let started = performance.now();
    let THREE = await import(urlFor(side));
    let elapsed = performance.now() - started;
    scene(THREE, document.getElementById(`c-${kind}`));
    return { kind, side, elapsed };
  }),
);
const pageElapsed = performance.now() - pageStarted;

function trafficFor(side) {
  let prefix = `/${depot}/${side.deck}@${side.version}/`;
  let entries = performance
    .getEntriesByType('resource')
    .filter((entry) => new URL(entry.name).pathname.startsWith(prefix));
  let cached = entries.filter((entry) => entry.transferSize === 0).length;
  let bytes = entries.reduce((total, entry) => total + entry.transferSize, 0);
  return { count: entries.length, cached, bytes };
}

let total = { count: 0, cached: 0, bytes: 0 };
for (let { kind, side, elapsed } of sides) {
  let traffic = trafficFor(side);
  total.count += traffic.count;
  total.cached += traffic.cached;
  total.bytes += traffic.bytes;
  let how =
    traffic.cached === traffic.count && traffic.count > 0
      ? 'all from cache — reload with ⇧⌘R for the cold number'
      : traffic.cached > 0
        ? `${traffic.count - traffic.cached} over the network, ${traffic.cached} from cache`
        : `${traffic.count} over the network`;
  document.getElementById(`t-${kind}`).textContent =
    `${traffic.count || modules} module requests · ${how} · ${(traffic.bytes / 1024).toFixed(0)} KB · finished at ${Math.round(elapsed)} ms`;
}
document.getElementById('page-cost').textContent =
  `${total.count} module requests for this page — ${modules} per deck, loaded concurrently and sharing the browser's connection pool, so neither side's finishing time is what it would cost on its own. ${total.cached} were served from cache; ${(total.bytes / 1024).toFixed(0)} KB crossed the wire. Wall clock for both: ${Math.round(pageElapsed)} ms.`;
