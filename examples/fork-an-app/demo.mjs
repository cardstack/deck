#!/usr/bin/env node
// Fork an app — take almost all of somebody else's library, change the two
// things you disagree with, and run YOUR version.
//
// The library is Leaflet, which publishes real per-file ESM: 85 modules,
// nothing pointing outside the package. Vendoring it gives you the module
// boundary intact, so "change one file" means changing one file — not
// patching a 140 KB bundle or maintaining a downstream build.
//
// The map is real. Country borders come from world-atlas, converted from
// TopoJSON to GeoJSON by topojson-client — a second npm package, also
// vendored from source — and drawn as SVG vectors. There is no tile server,
// so a demo that claims to reach nothing at runtime is drawing something
// worth looking at rather than a rectangle.
//
// What this demonstrates, end to end:
//
//   L6  hermetic     nothing on the page reaches the live web at runtime.
//                    Not "no tiles because there is nothing to draw" — a
//                    whole world map, from bytes you sealed.
//   L8  provenance   every vendored deck records registry, integrity, and
//                    the repo+commit npm declared, checkable blob by blob.
//                    The DATA deck records where the data came from too.
//   L3  no copies    the fork changes TWO files out of 85. The store holds
//                    one copy of the other 83 — printed below, measured,
//                    not asserted.
//   L1  identity     a different tree is a different treeHash, so the two
//                    versions can be served side by side and neither can
//                    be mistaken for the other.
//
//   pnpm --filter @deck/example-fork-an-app demo
//   open http://localhost:8791/
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack, unpack } from '@deck/core/pack';
import { hashBytes } from '@deck/core/tree-hash';
import { publishToStore, inspectStore } from '@deck/core/store';
import { vendorFromNpmSource } from '@deck/core/vendor-npm';
import { fetchNpmPackage } from '@deck/core/npm';
import { storeDirFor } from '@deck/server/depot';
import { createDemoServer, demoOrigin } from '../shared/depot.mjs';
import { lockAndWrite, publishShared } from '../shared/publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8791);
const DEPOT = 'site';
const depotDir = join(here, 'depot');
const storeDir = storeDirFor(depotDir);
const SPEC = 'leaflet@1.9.4';
const VERSION = '1.9.4';
// Filled in once the fork's tree is known — see the note where it is set.
const TOPOJSON = 'topojson-client@3.1.0';
const ATLAS = 'world-atlas@2.0.2';
// 110m is the coarsest of the three world-atlas resolutions: 105 KB for every
// country on earth. 50m is 739 KB and 10m is 3.5 MB, and neither tells you
// anything more at this zoom.
const ATLAS_FILE = 'countries-110m.json';

await rm(storeDir, { recursive: true, force: true });
await mkdir(storeDir, { recursive: true });

console.log('\n  FORK AN APP — take all of it, change the part you disagree with\n');

// ---------------------------------------------------------------------------
// 1. Vendor from npm SOURCE. Not a CDN bundle: the module tree npm published.
// ---------------------------------------------------------------------------
console.log(`1) vendoring ${SPEC} from npm source…`);
let vendored = await vendorFromNpmSource({
  spec: SPEC,
  // The cooldown gate is off here only because a demo should not fail on the
  // day someone runs it. A depot sets a real minimumReleaseAge; see L11.
  policy: { minimumReleaseAge: 0 },
});
console.log(`   ${vendored.modules.length} modules, ${vendored.externals.length} externals`);
console.log(`   entry ${vendored.entryPath}`);
console.log(`   from  ${vendored.vendoredFrom.registry} · ${vendored.vendoredFrom.integrity?.slice(0, 24)}…`);
if (vendored.vendoredFrom.repo) {
  console.log(`   repo  ${vendored.vendoredFrom.repo}${vendored.vendoredFrom.commit ? ` @ ${vendored.vendoredFrom.commit.slice(0, 12)}` : ''}`);
}

let mapBytes = Buffer.from(
  JSON.stringify(
    {
      deck: {
        packages: {
          leaflet: {
            version: VERSION,
            entry: `$DECK/${vendored.entryPath}`,
            vendoredFrom: vendored.vendoredFrom,
          },
        },
      },
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
// The module walk follows imports, and a stylesheet is not imported by any
// of them — but a library's CSS is unambiguously part of what you vendored,
// and leaving it behind would mean reaching for a CDN to get it back. So it
// is carried explicitly, from the same verified tarball.
const CSS = 'dist/leaflet.css';
let css = vendored.pkg.files.get(CSS);
if (!css) {
  throw new Error(`the demo expected ${CSS} in the ${SPEC} tarball`);
}
let upstream = pack([
  { path: 'importmap.json', bytes: mapBytes },
  { path: CSS, bytes: css },
  ...vendored.files,
]);
let upstreamHash = (await publishToStore(storeDir, 'lib/leaflet', VERSION, upstream, { tag: 'latest' })).treeHash;
console.log(`   sealed lib/leaflet@${VERSION} · ${upstreamHash.slice(0, 12)}…`);

// ---------------------------------------------------------------------------
// 2. Fork it, and change exactly one file.
//
// Leaflet's zoom control renders its own glyphs and its own title text. It
// is a real file with real behaviour — the point is that after vendoring,
// changing it is an ordinary edit, because the module boundary survived.
// ---------------------------------------------------------------------------
// Two files, and the important one is a CODE change rather than a different
// default.
//
//   Projection.SphericalMercator.js  the map's projection maths, replaced
//                    with Gall–Peters. This is the fork that could not have
//                    been a setting: Leaflet ships EPSG:3857, EPSG:4326,
//                    EPSG:3395 and Simple, and Gall–Peters is not among them,
//                    so there is no option, no plugin hook, and no config
//                    file that produces this map. You change the function or
//                    you do not get it.
//
//   Control.Zoom.js  the chrome, so the difference is legible even before
//                    you notice the continents changed shape.
//
// Gall–Peters is cylindrical EQUAL-AREA with standard parallels at 45°:
// y goes as sin(φ) rather than as log(tan(…)), so Greenland collapses to its
// true size and the tropics stretch vertically. Nobody mistakes one for the
// other. The inverse has to agree exactly or panning drifts — which is the
// honest reason projections live in code and not in options.
const CHANGES = {
  'src/geo/projection/Projection.SphericalMercator.js': (text) =>
    text
      .replace(
        /return new Point\(\s*this\.R \* latlng\.lng \* d,\s*this\.R \* Math\.log\(\(1 \+ sin\) \/ \(1 - sin\)\) \/ 2\);/,
        `// Gall–Peters: cylindrical equal-area, standard parallels 45°.
		// x is longitude scaled by cos45; y is sin(latitude) divided by it.
		var k = Math.SQRT1_2;
		return new Point(
			this.R * latlng.lng * d * k,
			this.R * sin / k);`,
      )
      .replace(
        /\(2 \* Math\.atan\(Math\.exp\(point\.y \/ this\.R\)\) - \(Math\.PI \/ 2\)\) \* d,\s*point\.x \* d \/ this\.R\);/,
        `Math.asin(Math.max(-1, Math.min(1, point.y * Math.SQRT1_2 / this.R))) * d,
			point.x * d / (this.R * Math.SQRT1_2));`,
      )
      // Equal-area poles are finite, so the projected square that Mercator
      // needs becomes a short, wide rectangle. Getting this wrong does not
      // throw — the map just refuses to pan past a latitude nobody thought
      // about.
      .replace(
        /var d = earthRadius \* Math\.PI;\s*return new Bounds\(\[-d, -d\], \[d, d\]\);/,
        `var d = earthRadius * Math.PI * Math.SQRT1_2,
		    y = earthRadius / Math.SQRT1_2;
		return new Bounds([-d, -y], [d, y]);`,
      )
      // Mercator clamps at 85.05° because its poles are infinite. This
      // projection's are not, so the clamp is what would now be wrong.
      .replace(/MAX_LATITUDE:\s*85\.0511287798,/, 'MAX_LATITUDE: 90,'),
  // A default, not maths — and worth having beside the projection precisely
  // because the two are different KINDS of change. This one you could have
  // passed as a style argument; the projection you could not. Forking gets
  // you both, which is why the interesting question is never "is it
  // configurable" but "is the boundary still there".
  'src/layer/vector/Path.js': (text) =>
    text
      .replace(/color:\s*'#3388ff'/, "color: '#b45309'")
      .replace(/weight:\s*3,/, 'weight: 1,')
      .replace(/fillOpacity:\s*0\.2,/, 'fillOpacity: 0.5,'),
  'src/control/Control.Zoom.js': (text) =>
    text
      .replace(/zoomInText:\s*'[^']*'/, "zoomInText: '＋'")
      .replace(/zoomOutText:\s*'[^']*'/, "zoomOutText: '－'")
      .replace(/zoomInTitle:\s*'[^']*'/, "zoomInTitle: 'Closer (my fork)'")
      .replace(/zoomOutTitle:\s*'[^']*'/, "zoomOutTitle: 'Further (my fork)'"),
};
const TARGETS = Object.keys(CHANGES);
const TARGET = TARGETS[0];

// The version carries the edits it names.
//
// An exact version is served `immutable, 1y` (L12) because a published
// version never changes (L4). A demo that edits its patches and re-runs
// breaks exactly that: same `1.9.4-mine.0`, different bytes — and every
// browser that saw the old one keeps showing it, mixing stale modules with
// fresh ones into a page that is neither version. Diagnosing that costs an
// hour and the bug is invisible from the server side, where the bytes are
// right.
//
// The protocol's own answer is that a version is a NAME FOR A TREE, so if
// the tree changes the name must change too. It is derived from the patches
// rather than from the finished pack because the pack contains the manifest
// that states the version, and that is a circle.
let opened = unpack(upstream);
let patchedFiles = new Map();
for (let [path, patch] of Object.entries(CHANGES)) {
  let original = opened.files.get(path);
  if (!original) {
    throw new Error(`the demo expected ${path} in the vendored tree`);
  }
  let next = patch(original.toString('utf8'));
  if (next === original.toString('utf8')) {
    throw new Error(`the demo failed to patch ${path} — upstream shape changed`);
  }
  patchedFiles.set(path, Buffer.from(next, 'utf8'));
}
const FORK_VERSION = `1.9.4-mine.${hashBytes(
  Buffer.concat([...patchedFiles.entries()].flatMap(([path, bytes]) => [Buffer.from(path), bytes])),
).slice(0, 8)}`;

let forkFiles = [...opened.files.entries()].map(([path, bytes]) =>
  patchedFiles.has(path)
    ? { path, bytes: patchedFiles.get(path) }
    : path === 'importmap.json'
      ? {
          path,
          bytes: Buffer.from(
            JSON.stringify(
              {
                deck: {
                  packages: {
                    leaflet: {
                      version: FORK_VERSION,
                      entry: `$DECK/${vendored.entryPath}`,
                      // Provenance survives the fork: this is still Leaflet,
                      // and it still says where it came from. What changed is
                      // recorded beside it, not instead of it.
                      vendoredFrom: vendored.vendoredFrom,
                      forkedFrom: { deck: 'lib/leaflet', version: VERSION, treeHash: upstreamHash },
                      changed: TARGETS,
                    },
                  },
                },
              },
              null,
              2,
            ) + '\n',
            'utf8',
          ),
        }
      : { path, bytes },
);
let forkPack = pack(forkFiles);
let forkHash = (await publishToStore(storeDir, 'me/leaflet', FORK_VERSION, forkPack, { tag: 'mine' })).treeHash;
console.log(`\n2) forked → me/leaflet@${FORK_VERSION} · ${forkHash.slice(0, 12)}…`);
for (let path of TARGETS) {
  console.log(`   changed ${path}`);
}
console.log(`   …and importmap.json, which now records the fork's lineage.`);
console.log(`   That second edit is why the fork inherits no endorsements:`);
console.log(`   it is a different tree because it ANNOUNCES a different`);
console.log(`   lineage, and a signature about upstream's bytes should not`);
console.log(`   travel to something claiming to be someone else (L10).`);

// ---------------------------------------------------------------------------
// 3. The other two decks the map needs: a converter, and the data itself.
//
// topojson-client is CODE, vendored from npm source exactly like Leaflet was
// — 13 modules, its own deck. world-atlas is DATA: a 105 KB TopoJSON of every
// country, which is not a module graph at all and so is sealed as a deck with
// a tiny loader beside it. Both record where they came from, because "what IS
// this" has to be answerable for a shapefile as much as for a library (L8).
// ---------------------------------------------------------------------------
console.log(`\n3) the map's other two decks`);

let topo = await vendorFromNpmSource({
  spec: TOPOJSON,
  entry: 'src/index.js',
  policy: { minimumReleaseAge: 0 },
});
let topoPack = pack([
  {
    path: 'importmap.json',
    bytes: Buffer.from(
      JSON.stringify(
        {
          deck: {
            packages: {
              'topojson-client': {
                version: topo.pkg.version,
                entry: `$DECK/${topo.entryPath}`,
                vendoredFrom: topo.vendoredFrom,
              },
            },
          },
        },
        null,
        2,
      ) + '\n',
      'utf8',
    ),
  },
  ...topo.files,
]);
let topoHash = (
  await publishToStore(storeDir, 'lib/topojson-client', topo.pkg.version, topoPack, {
    tag: 'latest',
  })
).treeHash;
console.log(
  `   lib/topojson-client@${topo.pkg.version}  ${topo.modules.length} modules · ${topoHash.slice(0, 12)}…`,
);
console.log(`   entry ${topo.entryPath} — the declared entry probes as a BUNDLE, so`);
console.log(`   the module tree is asked for by name. It is in the tarball either way.`);

// The data. `fetchNpmPackage` is the same verified path the code took: same
// registry, same integrity check, same tarball reader. A dataset is not a
// special case, it is just a deck whose files are not modules.
let atlas = await fetchNpmPackage({ spec: ATLAS });
let atlasBytes = atlas.files.get(ATLAS_FILE);
if (!atlasBytes) {
  throw new Error(`the demo expected ${ATLAS_FILE} in the ${ATLAS} tarball`);
}
let atlasPack = pack([
  {
    path: 'importmap.json',
    bytes: Buffer.from(
      JSON.stringify(
        {
          deck: {
            packages: {
              'world-atlas': {
                version: atlas.version,
                entry: '$DECK/index.js',
                vendoredFrom: {
                  registry: 'https://registry.npmjs.org',
                  name: atlas.name,
                  version: atlas.version,
                  integrity: atlas.integrity ?? null,
                  file: ATLAS_FILE,
                  // Natural Earth is the source of the shapes themselves, and
                  // it is public domain. A data deck that recorded only the
                  // npm package it arrived in would answer the wrong question.
                  upstream: 'Natural Earth 110m cultural vectors, public domain',
                },
              },
            },
          },
        },
        null,
        2,
      ) + '\n',
      'utf8',
    ),
  },
  { path: ATLAS_FILE, bytes: atlasBytes },
  {
    path: 'index.js',
    bytes: Buffer.from(
      `// The data is JSON, so the module is four lines and a URL. Keeping the
// loader beside the bytes means a consumer imports a deck rather than
// hard-coding a path into somebody else's tree.
export const source = import.meta.url;
export async function countries() {
  return (await fetch(new URL('./${ATLAS_FILE}', import.meta.url))).json();
}
`,
      'utf8',
    ),
  },
]);
let atlasHash = (
  await publishToStore(storeDir, 'data/world-atlas', atlas.version, atlasPack, {
    tag: 'latest',
  })
).treeHash;
console.log(
  `   data/world-atlas@${atlas.version}  ${(atlasBytes.length / 1024).toFixed(0)} KB of TopoJSON · ${atlasHash.slice(0, 12)}…`,
);

// ---------------------------------------------------------------------------
// 4. What the fork cost. This is the number worth reading.
// ---------------------------------------------------------------------------
// Measured by comparing the two trees, not by subtracting store totals:
// the store also holds topojson-client, the atlas, and ui/pills now, and
// attributing those to the fork would be a flattering lie.
let report = await inspectStore(storeDir);
let files = opened.files.size;
let forkOpened = unpack(forkPack);
let shared = 0;
for (let [path, bytes] of forkOpened.files) {
  if (opened.files.get(path)?.equals(bytes)) {
    shared++;
  }
}
let cost = files - shared;
console.log(`\n4) what the fork cost`);
console.log(`   two ${files}-file copies of Leaflet, and ${shared} of those files are`);
console.log(`   byte-identical — so the fork added ${cost} object${cost === 1 ? '' : 's'} to the store:`);
console.log(`   the ${TARGETS.length} files it edited, plus the manifest that records its lineage.`);
console.log(`   store total: ${report.objects} objects, ${report.bytes.toLocaleString()} bytes —`);
console.log(`   for FOUR decks (two Leaflets, topojson-client, the atlas) plus ui/pills.`);

// ---------------------------------------------------------------------------
// 5. Serve both. The page mounts two maps from two different decks.
// ---------------------------------------------------------------------------

// The shared `ui/pills` deck, published into THIS depot's store from
// examples/shared. Five demos, five stores, one source tree — and because
// identity is the hash of the tree, the treeHash below is the same in all
// five. Then the viewer's decklist is locked, so the pins that resolve
// `ui/pills` are in the tree where you can read them.
let [pills] = await publishShared(storeDir);
let viewerLock = await lockAndWrite({
  depotDir,
  depotName: DEPOT,
  storeDir,
  deckDir: join(depotDir, 'app', 'viewer'),
});
console.log(`\n   shared: ${pills.name}@${pills.version} \u00b7 ${pills.treeHash.slice(0, 12)}\u2026 (same tree in every demo)`);
if (viewerLock.changed) {
  console.log(`   note: the checked-in lock was stale and has been rewritten`);
}

await writeFile(
  join(depotDir, 'app', 'viewer', 'build.json'),
  JSON.stringify(
    {
      depot: DEPOT,
      entry: vendored.entryPath,
      changed: TARGETS,
      modules: opened.files.size - 1,
      store: {
        objects: report.objects,
        bytes: report.bytes,
        wouldBe: files * 2,
        forkCost: cost,
        shared,
      },
      upstream: { deck: 'lib/leaflet', version: VERSION, hash: upstreamHash },
      fork: { deck: 'me/leaflet', version: FORK_VERSION, hash: forkHash },
      topojson: {
        deck: 'lib/topojson-client',
        version: topo.pkg.version,
        modules: topo.modules.length,
        hash: topoHash,
      },
      atlas: {
        deck: 'data/world-atlas',
        version: atlas.version,
        file: ATLAS_FILE,
        bytes: atlasBytes.length,
        hash: atlasHash,
      },
      provenance: {
        registry: vendored.vendoredFrom.registry,
        name: vendored.vendoredFrom.name,
        version: vendored.vendoredFrom.version,
        integrity: vendored.vendoredFrom.integrity ?? null,
        repo: vendored.vendoredFrom.repo ?? null,
        commit: vendored.vendoredFrom.commit ?? null,
      },
    },
    null,
    2,
  ) + '\n',
);

let server = createDemoServer({
  depots: [{ name: DEPOT, dir: depotDir, storeDir }],
  fallback: (req, res) => {
    res.writeHead(302, { location: `/${DEPOT}/app/viewer/index.html` });
    res.end();
  },
});
server.listen(PORT, () => {
  console.log(`\n5) serving both versions side by side (HTTPS + HTTP/2)\n`);
  console.log(`      ${demoOrigin(PORT)}/\n`);
  console.log(`      /${DEPOT}/lib/leaflet@${VERSION}/${vendored.entryPath}`);
  console.log(`      /${DEPOT}/me/leaflet@${FORK_VERSION}/${vendored.entryPath}`);
  console.log(`      /${DEPOT}/lib/topojson-client@${topo.pkg.version}/${topo.entryPath}`);
  console.log(`      /${DEPOT}/data/world-atlas@${atlas.version}/${ATLAS_FILE}`);
  console.log(`\n   Every country on both maps is an SVG path drawn from sealed`);
  console.log(`   bytes. There is no tile server and no CDN: nothing on the page`);
  console.log(`   reaches the network at runtime.\n`);
});
