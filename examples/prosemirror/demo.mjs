#!/usr/bin/env node
// ProseMirror — where per-file vendoring runs out, and what is left.
//
// The other demos here vendor libraries that publish their module tree.
// Leaflet does (85 files). three.js does (374). This one does not, and it is
// not an oddity: ProseMirror, CodeMirror and a large slice of the modern
// registry publish a rollup of their source and nothing you can address.
//
// Deck has three carriages for foreign code, and ProseMirror falls off two:
//
//   source mode   vendor the module tree npm published.
//                 REFUSED — every declared entry probes as ONE module.
//   map mode      recover the pre-bundle tree from the bundle's source map.
//                 REFUSED — there are no source maps. Not one, in eleven
//                 packages. This is the case docs/deck-rebuild-sibling-
//                 proposal.md exists for.
//   URL mode      seal the bundle and serve it yourself.
//                 WORKS — and that is what runs the editor on this page.
//
// So the demo does three things, in order of how much they are worth:
//
//   1. It measures the refusal, per package, instead of asserting it.
//   2. It seals `src/` anyway — ProseMirror ships TypeScript sources in the
//      tarball, so the author's code is right there, readable, diffable and
//      verifiable against the GitHub commit. It just cannot RUN, so the deck
//      declares no entry and the server refuses to import it (L11 as a shape,
//      not as a warning).
//   3. It vendors the bundles, wires them to each other by alias, and runs a
//      real editor with nothing reaching the network.
//
// What is missing between (2) and (3) is a build: `rebuild-v1`, still a
// proposal. This demo is the honest measurement of the gap.
//
//   pnpm --filter @deck/example-prosemirror demo
//   open http://localhost:8798/
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack, unpack } from '@deck/core/pack';
import { hashBytes } from '@deck/core/tree-hash';
import { publishToStore, inspectStore, readStoredPack } from '@deck/core/store';
import {
  deckNameForNpm,
  probeEntries,
  vendorFromNpmSource,
} from '@deck/core/vendor-npm';
import { fetchNpmPackage } from '@deck/core/npm';
import { locateSourceMap } from '@deck/core/vendor-map';
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
const PORT = Number(process.env.PORT ?? 8798);
const DEPOT = 'site';
const depotDir = join(here, 'depot');

// Everything a working editor needs. The three at the end are ProseMirror's
// own small dependencies, and they are in the same shape.
const PACKAGES = [
  { spec: 'prosemirror-model', entry: 'dist/index.js' },
  { spec: 'prosemirror-transform', entry: 'dist/index.js' },
  { spec: 'prosemirror-state', entry: 'dist/index.js' },
  { spec: 'prosemirror-view', entry: 'dist/index.js' },
  { spec: 'prosemirror-keymap', entry: 'dist/index.js' },
  { spec: 'prosemirror-commands', entry: 'dist/index.js' },
  { spec: 'prosemirror-history', entry: 'dist/index.js' },
  { spec: 'prosemirror-schema-basic', entry: 'dist/index.js' },
  { spec: 'orderedmap', entry: 'dist/index.js' },
  // Publishes at the package root rather than under dist/.
  { spec: 'w3c-keyname', entry: 'index.js' },
  { spec: 'rope-sequence', entry: 'dist/index.js' },
];


const storeDir = storeDirFor(depotDir);
const buildMode = await demoBuildMode({
  storeDir,
  probe: { name: 'lib/prosemirror-model', version: '1.25.11' },
  label: 'PROSEMIRROR',
});
if (buildMode === 'rebuild') {
  await resetDemoDepot({ depotDir });
}

console.log('\n  PROSEMIRROR — where per-file vendoring runs out\n');
const depot = await openDemoDepot({ name: DEPOT, dir: depotDir });

if (buildMode !== 'serve') {
// ---------------------------------------------------------------------------
// 1. Measure the refusal. Every declared entry, every source map, every src/.
// ---------------------------------------------------------------------------
console.log('1) what these packages actually publish\n');
console.log('   package                  files  entries          maps  src/  verdict');
let survey = [];
for (let { spec } of PACKAGES) {
  let pkg = await fetchNpmPackage({ spec });
  let probes = probeEntries(pkg);
  let paths = [...pkg.files.keys()];
  let maps = paths.filter((path) => path.endsWith('.map'));
  let sources = paths.filter((path) => path.startsWith('src/'));
  // A source map may also be inlined as a data URI, so this asks the same
  // question map mode asks rather than trusting the file listing.
  let located = probes.some((probe) => locateSourceMap(pkg, probe.entry));
  let tree = probes.find((probe) => probe.modules > 1);
  let verdict = tree
    ? `source mode: ${tree.modules} modules`
    : located
      ? 'map mode available'
      : 'neither — a bundle with no map';
  survey.push({
    name: pkg.name,
    version: pkg.version,
    files: pkg.files.size,
    entries: probes.map((probe) => ({ entry: probe.entry, modules: probe.modules })),
    maps: maps.length,
    sources: sources.length,
    sourceExt: [...new Set(sources.map((path) => path.replace(/^.*\./, '.')))].sort(),
    verdict,
  });
  console.log(
    `   ${pkg.name.padEnd(24)} ${String(pkg.files.size).padStart(5)}  ${probes
      .map((probe) => `${probe.modules}`)
      .join('/')
      .padEnd(16)} ${String(maps.length).padStart(4)}  ${String(sources.length).padStart(4)}  ${verdict}`,
  );
}
let bundledOnly = survey.filter((row) => row.verdict.startsWith('neither'));
if (bundledOnly.length !== survey.length) {
  throw new Error(
    `the demo's premise changed: ${survey.length - bundledOnly.length} package(s) are now recoverable`,
  );
}
console.log(`\n   ${survey.length}/${survey.length} publish only bundles, and ${survey.reduce((n, row) => n + row.maps, 0)} source maps between them.`);
console.log(`   Source mode has no tree to take. Map mode has nothing to recover from.`);

// ---------------------------------------------------------------------------
// 2. Seal src/ anyway. Readable, diffable, verifiable — and NOT executable.
// ---------------------------------------------------------------------------
const WITH_SOURCE = survey.filter((row) => row.sources > 0);
console.log(`\n2) ${WITH_SOURCE.length} of them ship src/ in the tarball anyway`);
let sourceDecks = [];
for (let row of WITH_SOURCE) {
  let pkg = await fetchNpmPackage({ spec: `${row.name}@${row.version}` });
  let files = [...pkg.files.entries()]
    .filter(([path]) => path.startsWith('src/'))
    .map(([path, bytes]) => ({ path, bytes }));
  let deck = `src/${deckNameForNpm(row.name)}`;
  let bytes = pack([
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify(
          {
            deck: {
              packages: {
                [deckNameForNpm(row.name)]: {
                  version: row.version,
                  // NO ENTRY, on purpose. These are TypeScript sources: a
                  // browser cannot run them and no transform here produces
                  // something that can. A deck that declared an entry it
                  // could not honour would be a lie the server would repeat,
                  // so the server answers `no-entry-module` instead.
                  vendoredFrom: {
                    registry: 'https://registry.npmjs.org',
                    name: row.name,
                    version: row.version,
                    integrity: pkg.integrity ?? null,
                    carriage: 'author source, from the published tarball',
                    executable: false,
                    note: 'TypeScript. Readable and diffable against upstream; running it needs a build (rebuild-v1, proposed).',
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
    ...files,
  ]);
  let record = await publishToStore(storeDir, deck, row.version, bytes, { tag: 'latest' });
  sourceDecks.push({ deck, version: row.version, files: files.length, hash: record.treeHash });
  console.log(
    `   ${deck.padEnd(28)} ${String(files.length).padStart(3)} files ${row.sourceExt.join(' ')}  · ${record.treeHash.slice(0, 12)}…`,
  );
}
console.log(`   Addressable, hashed, checkable against the GitHub commit — and no entry,`);
console.log(`   so nothing can import them. That is the L11 shape: refuse, do not warn.`);

// ---------------------------------------------------------------------------
// 3. Vendor the bundles and wire them to each other by ALIAS (L7).
// ---------------------------------------------------------------------------
console.log(`\n3) vendoring the bundles, and wiring them together`);
let vendoredDecks = [];
for (let { spec, entry } of PACKAGES) {
  let vendored = await vendorFromNpmSource({
    spec,
    entry,
    // The externals ARE the wiring: each one is another package in this list,
    // and each becomes an alias to its sibling deck below.
    allowExternal: true,
    policy: { minimumReleaseAge: 0 },
  });
  let name = deckNameForNpm(vendored.pkg.name);
  let dependencies = Object.fromEntries(
    vendored.externals.map((external) => [external, `lib/${deckNameForNpm(external)}@${'^' + versionOf(external)}`]),
  );
  let bytes = pack([
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify(
          {
            deck: {
              packages: {
                [name]: {
                  version: vendored.pkg.version,
                  entry: `$DECK/${vendored.entryPath}`,
                  vendoredFrom: vendored.vendoredFrom,
                },
              },
              ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
            },
          },
          null,
          2,
        ) + '\n',
        'utf8',
      ),
    },
    ...vendored.files,
  ]);
  let record = await publishToStore(storeDir, `lib/${name}`, vendored.pkg.version, bytes, {
    tag: 'latest',
  });
  vendoredDecks.push({
    deck: `lib/${name}`,
    version: vendored.pkg.version,
    kb: Math.round(vendored.files.reduce((n, file) => n + file.bytes.length, 0) / 1024),
    externals: vendored.externals,
    hash: record.treeHash,
  });
  console.log(
    `   lib/${name.padEnd(24)} ${String(vendoredDecks.at(-1).kb).padStart(4)} KB  ${vendored.externals.length ? `→ ${vendored.externals.join(', ')}` : ''}`,
  );
}

function versionOf(npmName) {
  let row = survey.find((candidate) => candidate.name === npmName);
  if (!row) {
    throw new Error(`${npmName} is an external nothing in this demo provides`);
  }
  return row.version;
}

console.log(`   Every arrow is a decklist ALIAS: the key is the bare specifier the`);
console.log(`   bundle imports, the value is the deck that answers to it (L7).`);

// ---------------------------------------------------------------------------
// 4. Change it anyway — and see what changing a rollup costs.
//
// The demo has spent three sections saying you cannot edit these packages at
// the module boundary. You can still edit them; there is just no boundary to
// do it at. So: fork the 242 KB prosemirror-view rollup and change one
// string in it.
//
// `attrs.class = "ProseMirror"` is the class the view puts on its editable
// element, assigned once, mid-bundle, around line 5900 of generated code.
// The patch works. It is also everything wrong with the situation: a string
// match against machine output, with no way to express what was meant, and
// nothing to carry it onto the next release.
// ---------------------------------------------------------------------------
const VIEW = 'lib/prosemirror-view';
const VIEW_ROW = survey.find((row) => row.name === 'prosemirror-view');
let viewPack = await readStoredPack(storeDir, VIEW, VIEW_ROW.version);
let viewTree = unpack(viewPack).files;
const VIEW_FILE = 'dist/index.js';
const NEEDLE = 'attrs.class = "ProseMirror";';
let viewSource = viewTree.get(VIEW_FILE).toString('utf8');
if (!viewSource.includes(NEEDLE)) {
  throw new Error(
    `the demo expected ${NEEDLE} in ${VIEW}@${VIEW_ROW.version}/${VIEW_FILE} — the rollup changed shape, which is the point`,
  );
}
let patchedView = viewSource.replace(NEEDLE, 'attrs.class = "ProseMirror pm-ruled";');
const FORK_VERSION = `${VIEW_ROW.version}-ruled.${hashBytes(Buffer.from(patchedView, 'utf8')).slice(0, 8)}`;

let forkFiles = [...viewTree.entries()].map(([path, bytes]) =>
  path === VIEW_FILE
    ? { path, bytes: Buffer.from(patchedView, 'utf8') }
    : path === 'importmap.json'
      ? {
          path,
          bytes: Buffer.from(
            JSON.stringify(
              {
                deck: {
                  packages: {
                    'prosemirror-view': {
                      ...JSON.parse(bytes.toString('utf8')).deck.packages['prosemirror-view'],
                      version: FORK_VERSION,
                      forkedFrom: {
                        deck: VIEW,
                        version: VIEW_ROW.version,
                        treeHash: vendoredDecks.find((d) => d.deck === VIEW).hash,
                      },
                      changed: [VIEW_FILE],
                    },
                  },
                  // The fork needs the same wiring as upstream, or its own
                  // bare specifiers resolve to nothing.
                  dependencies: JSON.parse(bytes.toString('utf8')).deck.dependencies,
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
let forkRecord = await publishToStore(
  storeDir,
  'me/prosemirror-view',
  FORK_VERSION,
  pack(forkFiles),
  { tag: 'ruled' },
);
console.log(`\n4) forked the rollup → me/prosemirror-view@${FORK_VERSION}`);
console.log(`   one string, ${NEEDLE.length} characters, at offset ${viewSource.indexOf(NEEDLE).toLocaleString()} of ${viewSource.length.toLocaleString()}`);
console.log(`   the file is ${(viewSource.length / 1024).toFixed(0)} KB of generated code with no module boundary in it`);
console.log(`   · ${forkRecord.treeHash.slice(0, 12)}…`);

// ---------------------------------------------------------------------------
// 5. Serve the editor.
// ---------------------------------------------------------------------------
let [pills] = await publishShared(storeDir);
let report = await inspectStore(storeDir);
console.log(`\n   store: ${report.objects} objects, ${(report.bytes / 1024).toFixed(0)} KB`);
console.log(`   shared: ${pills.name}@${pills.version} · ${pills.treeHash.slice(0, 12)}…`);

await writeFile(
  join(depotDir, 'app', 'editor', 'build.json'),
  JSON.stringify(
    {
      depot: DEPOT,
      survey,
      sourceDecks,
      vendoredDecks,
      store: report,
      viewFork: {
        deck: 'me/prosemirror-view',
        version: FORK_VERSION,
        from: { deck: VIEW, version: VIEW_ROW.version },
        file: VIEW_FILE,
        needle: NEEDLE,
        offset: viewSource.indexOf(NEEDLE),
        bytes: viewSource.length,
        hash: forkRecord.treeHash,
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
  deckDir: join(depotDir, 'app', 'editor'),
});

} // end buildMode

// Read back from the build record on disk rather than from the build block
// above: those bindings are block-scoped, and in serve mode the block never
// runs. Reading them back also proves the file the page will fetch says what
// this transcript says.
let built = JSON.parse(
  await readFile(join(depotDir, 'app', 'editor', 'build.json'), 'utf8'),
);
let server = createDemoServer({
  depots: [depot],
  fallback: (request, response) => {
    response.writeHead(302, { location: `/${DEPOT}/app/editor/index.html` });
    response.end();
  },
});
serveLive({ depot, server });
let origin = demoOrigin(PORT);
server.listen(PORT, () => {
  console.log(`\n6) serving two editors, hermetically\n`);
  console.log(`      ${origin}/`);
  console.log(`      /${DEPOT}/src/prosemirror-model@${built.survey[0].version}/src/schema.ts   readable, not runnable`);
  console.log(`      /${DEPOT}/lib/prosemirror-model@${built.survey[0].version}/dist/index.js   runnable, not readable`);
  console.log(`\n${liveNotes({ depot, port: PORT, origin })}`);
  console.log(`\n   Both of those are the same library at the same version, and`);
  console.log(`   neither is the thing you want. The thing you want is a build.\n`);
});
