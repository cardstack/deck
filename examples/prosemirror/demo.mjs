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
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack } from '@deck/core/pack';
import { publishToStore, inspectStore } from '@deck/core/store';
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
import { lockAndWrite, publishShared } from '../shared/publish.mjs';
import { resetDemoDepot } from '../shared/reset.mjs';

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

await resetDemoDepot({ depotDir });

console.log('\n  PROSEMIRROR — where per-file vendoring runs out\n');
const depot = await openDemoDepot({ name: DEPOT, dir: depotDir });
const storeDir = depot.storeDir;

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
// 4. Serve the editor.
// ---------------------------------------------------------------------------
let [pills] = await publishShared(storeDir);
let report = await inspectStore(storeDir);
console.log(`\n4) store: ${report.objects} objects, ${(report.bytes / 1024).toFixed(0)} KB`);
console.log(`   shared: ${pills.name}@${pills.version} · ${pills.treeHash.slice(0, 12)}…`);

await writeFile(
  join(depotDir, 'app', 'editor', 'build.json'),
  JSON.stringify(
    { depot: DEPOT, survey, sourceDecks, vendoredDecks, store: report },
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
  console.log(`\n5) serving a real editor, hermetically (HTTPS + HTTP/2)\n`);
  console.log(`      ${origin}/`);
  console.log(`      /${DEPOT}/src/prosemirror-model@${survey[0].version}/src/schema.ts   readable, not runnable`);
  console.log(`      /${DEPOT}/lib/prosemirror-model@${survey[0].version}/dist/index.js   runnable, not readable`);
  console.log(`\n${liveNotes({ depot, port: PORT, origin })}`);
  console.log(`\n   Both of those are the same library at the same version, and`);
  console.log(`   neither is the thing you want. The thing you want is a build.\n`);
});
