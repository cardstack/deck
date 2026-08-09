#!/usr/bin/env node
// three.js — 374 files, and you may edit any of them.
//
// three.js is the strongest case for vendoring at the module boundary,
// because it is the case where everyone else's answer is worst. It publishes
// `src/` as real per-file ESM: 374 modules from `src/Three.js`, nothing
// pointing outside the package. It ALSO publishes `build/three.module.js`,
// which is the same library as one 1.2 MB module — and that is what almost
// every CDN hands you.
//
//   tree    src/Three.js           374 module(s), 1324 KB
//   bundle  build/three.module.js    1 module(s), 1243 KB
//
// The bundle is 6% smaller and infinitely worse to own: to change one line of
// one shader you either patch a megabyte of generated code or you set up
// three.js's build. Vendored from source, it is a text edit.
//
// So this demo edits ONE FILE — a GLSL chunk — and runs the result beside
// upstream. What changes is the shader every lit material compiles, which is
// the kind of thing there is no option for. `MeshPhongMaterial` has fifty
// settings and none of them is "glow at grazing angles and scan the screen".
//
//   pnpm --filter @deck/example-three-js demo
//   open https://localhost:8797/
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack, unpack } from '@deck/core/pack';
import { hashBytes } from '@deck/core/tree-hash';
import { inspectStore, publishToStore } from '@deck/core/store';
import { probeEntries, vendorFromNpmSource } from '@deck/core/vendor-npm';
import { fetchNpmPackage } from '@deck/core/npm';
import {
  createDemoServer,
  demoOrigin,
  liveNotes,
  openDemoDepot,
  serveLive,
} from '../shared/depot.mjs';
import { storeDirFor } from '@deck/server/depot';
import { lockAndWrite, publishShared } from '../shared/publish.mjs';
import { demoBuildMode, resetDemoDepot } from '../shared/reset.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8797);
const DEPOT = 'site';
const depotDir = join(here, 'depot');
const SPEC = 'three@0.160.0';
const VERSION = '0.160.0';

// The one file. `opaque_fragment` is where a lit material's computed light
// becomes the fragment's colour, in every shader three.js assembles — so an
// edit here is a different renderer, not a different material.
//
// The replacement is a hologram filter, and it is made of two things a
// material option could not reach:
//
//   a FRESNEL rim    `normal` and `vViewPosition` are in scope here, so the
//                    shader can ask how edge-on the surface is and glow where
//                    it is. On a torus knot that traces every twist.
//   IRIDESCENCE      the same view angle drives a hue wheel, so the colour
//                    turns as the knot does — the thing that makes a hologram
//                    read as a hologram rather than as a cyan object.
//   a CHROMATIC      `gl_FragCoord` is the pixel, so this one is
//   SCANLINE         screen-space, and each channel scans at its own
//                    frequency so the bands fringe. The stripes stay put
//                    while the knot turns through them, which is the tell
//                    that it is a filter over the image and not a texture on
//                    the object.
//
// All three are a few lines of GLSL, and there is no setting for any of them.
const TARGET = 'src/renderers/shaders/ShaderChunk/opaque_fragment.glsl.js';
const PATCH = (text) =>
  text.replace(
    'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
    `// Hologram. A view-angle rim term plus a screen-space scanline, both
// computed per fragment, applied to every lit material this renderer
// compiles. No material option reaches either one: they are the shader, and
// the shader is a file.
vec3 viewDir = normalize( vViewPosition );
float rim = pow( 1.0 - abs( dot( viewDir, normal ) ), 2.5 );
// Iridescence: the hue turns with the view angle, so the surface changes
// colour as it rotates the way a real hologram does. cos() offset by a third
// of a turn per channel is a hue wheel in three instructions.
float phase = dot( viewDir, normal ) * 6.0 + gl_FragCoord.y * 0.02;
vec3 iris = 0.5 + 0.5 * cos( phase + vec3( 0.0, 2.094, 4.188 ) );
// Chromatic scanline: each channel scans at a slightly different frequency,
// so the bands separate into colour fringes instead of grey stripes.
vec3 scan = 0.70 + 0.30 * sin( gl_FragCoord.y * vec3( 1.50, 1.54, 1.58 ) );
vec3 holo = outgoingLight * scan * mix( vec3( 1.0 ), iris, 0.6 ) + iris * rim * 2.0;
gl_FragColor = vec4( holo, diffuseColor.a );`,
  );


const storeDir = storeDirFor(depotDir);
const buildMode = await demoBuildMode({
  storeDir,
  probe: { name: 'lib/three', version: VERSION },
  label: 'THREE.JS',
});
if (buildMode === 'rebuild') {
  await resetDemoDepot({ depotDir });
}

console.log('\n  THREE.JS — 374 files, and you may edit any of them\n');
const depot = await openDemoDepot({ name: DEPOT, dir: depotDir });

if (buildMode !== 'serve') {
// ---------------------------------------------------------------------------
// 1. What npm actually published. This is the number the whole demo rests on.
// ---------------------------------------------------------------------------
let pkg = await fetchNpmPackage({ spec: SPEC });
let probes = probeEntries(pkg);
console.log(`1) what ${SPEC} publishes — ${pkg.files.size} files`);
for (let probe of probes) {
  console.log(
    `   ${probe.modules === 1 ? 'bundle ' : 'tree   '} ${probe.entry.padEnd(24)} ${String(probe.modules).padStart(4)} module(s), ${(probe.bytes / 1024).toFixed(0)} KB`,
  );
}
let tree = probes.find((probe) => probe.modules > 1);
if (!tree) {
  throw new Error('three.js no longer publishes a module tree — the demo is out of date');
}
console.log(`   the bundle is one module: whatever it was made of, npm did not ship it.`);

// ---------------------------------------------------------------------------
// 2. Vendor the TREE, not the bundle.
// ---------------------------------------------------------------------------
let vendored = await vendorFromNpmSource({
  spec: SPEC,
  entry: tree.entry,
  policy: { minimumReleaseAge: 0 },
});
let manifest = (version, extra = {}) =>
  Buffer.from(
    JSON.stringify(
      {
        deck: {
          packages: {
            three: {
              version,
              entry: `$DECK/${vendored.entryPath}`,
              vendoredFrom: vendored.vendoredFrom,
              ...extra,
            },
          },
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

let upstream = pack([
  { path: 'importmap.json', bytes: manifest(VERSION) },
  ...vendored.files,
]);
let upstreamHash = (
  await publishToStore(storeDir, 'lib/three', VERSION, upstream, { tag: 'latest' })
).treeHash;
console.log(`\n2) vendored ${vendored.modules.length} modules from npm source`);
console.log(`   entry   ${vendored.entryPath}`);
console.log(`   rewritten ${vendored.rewritten.length} — ${vendored.rewritten.length === 0 ? 'byte-identical to what npm published' : 'references adjusted to stay inside the pack'}`);
console.log(`   from    ${vendored.vendoredFrom.registry} · ${vendored.vendoredFrom.integrity?.slice(0, 24)}…`);
if (vendored.vendoredFrom.repo) {
  console.log(
    `   repo    ${vendored.vendoredFrom.repo}${vendored.vendoredFrom.commit ? ` @ ${vendored.vendoredFrom.commit.slice(0, 12)}` : ''}`,
  );
}
console.log(`   sealed  lib/three@${VERSION} · ${upstreamHash.slice(0, 12)}…`);

// ---------------------------------------------------------------------------
// 3. Change one file.
// ---------------------------------------------------------------------------
let opened = unpack(upstream);
let original = opened.files.get(TARGET);
if (!original) {
  throw new Error(`the demo expected ${TARGET} in the vendored tree`);
}
let patched = PATCH(original.toString('utf8'));
if (patched === original.toString('utf8')) {
  throw new Error(`the demo failed to patch ${TARGET} — upstream shape changed`);
}
// The version names the edit, so re-running with a different patch cannot
// serve different bytes at a URL a browser cached as immutable. See the long
// note in examples/fork-an-app/demo.mjs.
const FORK_VERSION = `${VERSION}-holo.${hashBytes(Buffer.from(patched, 'utf8')).slice(0, 8)}`;

let forkFiles = [...opened.files.entries()].map(([path, bytes]) =>
  path === TARGET
    ? { path, bytes: Buffer.from(patched, 'utf8') }
    : path === 'importmap.json'
      ? {
          path,
          bytes: manifest(FORK_VERSION, {
            forkedFrom: { deck: 'lib/three', version: VERSION, treeHash: upstreamHash },
            changed: [TARGET],
          }),
        }
      : { path, bytes },
);
let forkPack = pack(forkFiles);
let forkHash = (
  await publishToStore(storeDir, 'me/three', FORK_VERSION, forkPack, { tag: 'holo' })
).treeHash;
console.log(`\n3) forked → me/three@${FORK_VERSION} · ${forkHash.slice(0, 12)}…`);
console.log(`   changed ${TARGET}`);
console.log(`   ${(original.length / 1024).toFixed(1)} KB file, ${(patched.length - original.length)} bytes added.`);
console.log(`   The same edit against build/three.module.js would be a patch`);
console.log(`   against 1.2 MB of generated code that no upstream release survives.`);

// ---------------------------------------------------------------------------
// 4. What it cost.
// ---------------------------------------------------------------------------
let forkOpened = unpack(forkPack);
let shared = 0;
for (let [path, bytes] of forkOpened.files) {
  if (opened.files.get(path)?.equals(bytes)) {
    shared++;
  }
}
let files = opened.files.size;
let cost = files - shared;
let report = await inspectStore(storeDir);
console.log(`\n4) two ${files}-file copies of three.js`);
console.log(`   ${shared} files byte-identical → the fork cost ${cost} object${cost === 1 ? '' : 's'}`);
console.log(`   store: ${report.objects} objects, ${(report.bytes / 1024).toFixed(0)} KB`);
console.log(`   (two independent copies would be ${files * 2} objects)`);

// ---------------------------------------------------------------------------
// 5. Serve.
// ---------------------------------------------------------------------------
let [pills] = await publishShared(storeDir);
console.log(`\n   shared: ${pills.name}@${pills.version} · ${pills.treeHash.slice(0, 12)}…`);

await writeFile(
  join(depotDir, 'app', 'studio', 'build.json'),
  JSON.stringify(
    {
      depot: DEPOT,
      entry: vendored.entryPath,
      changed: TARGET,
      modules: vendored.modules.length,
      publishedFiles: pkg.files.size,
      probes: probes.map((probe) => ({
        entry: probe.entry,
        modules: probe.modules,
        kb: Math.round(probe.bytes / 1024),
      })),
      store: { objects: report.objects, bytes: report.bytes, forkCost: cost, shared },
      upstream: { deck: 'lib/three', version: VERSION, hash: upstreamHash },
      fork: { deck: 'me/three', version: FORK_VERSION, hash: forkHash },
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
await lockAndWrite({
  depotDir,
  depotName: DEPOT,
  storeDir,
  deckDir: join(depotDir, 'app', 'studio'),
});

} // end buildMode

// Read back from the build record on disk rather than from the build block
// above: those bindings are block-scoped, and in serve mode the block never
// runs. Reading them back also proves the file the page will fetch says what
// this transcript says.
let built = JSON.parse(
  await readFile(join(depotDir, 'app', 'studio', 'build.json'), 'utf8'),
);
let server = createDemoServer({
  depots: [depot],
  fallback: (request, response) => {
    response.writeHead(302, { location: `/${DEPOT}/app/studio/index.html` });
    response.end();
  },
});
serveLive({ depot, server });
let origin = demoOrigin(PORT);
server.listen(PORT, () => {
  console.log(`\n5) serving both renderers side by side (HTTPS + HTTP/2)\n`);
  console.log(`      ${origin}/`);
  console.log(`      /${DEPOT}/${built.upstream.deck}@${built.upstream.version}/${built.changed}`);
  console.log(`      /${DEPOT}/${built.fork.deck}@${built.fork.version}/${built.changed}`);
  console.log(`\n${liveNotes({ depot, port: PORT, origin })}`);
  console.log(`\n   The page loads ${built.modules} modules twice, one request each,`);
  console.log(`   and times it. That number is the honest cost of per-file`);
  console.log(`   delivery — and what docs/deck-efficient-delivery-spec.md is about.\n`);
});
