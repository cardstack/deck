#!/usr/bin/env node
// A field library — many decks, one shelf.
//
// Six card fields, each in its own deck, each declaring the npm libraries it
// wants by the bare specifier its source already writes: `date-fns`, `zod`,
// `luxon`, `nanoid`, `chroma-js`. None of those is a deck name. The decks are
// `lib/date-fns`, `lib/zod`, and so on, and the decklist in each field's
// importmap.json is what connects the two:
//
//     "zod": "lib/zod@^3.25.0"
//      ^ import specifier   ^ the deck that answers to it
//
// That is ALIASING, and it is what lets vendored npm source stay unmodified
// while the depot names things its own way.
//
// The other two things this exercises are what happens when six decks want
// overlapping libraries:
//
//   SCOPES  every deck's dependencies resolve inside its own URL prefix, so
//           `fields/swatch` and `fields/brand-swatch` can both import
//           `chroma-js` and get different versions — in one document.
//   DEDUPE  where the ranges agree, they resolve to one URL. One URL is one
//           object in the store, one fetch, and one module instance in the
//           browser — which is why a schema built by one deck's zod validates
//           under another deck's zod. Nothing computes that; it falls out of
//           content addressing.
//
//   pnpm --filter @cardstack/deck-example-field-library demo
//   open http://localhost:8793/
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPORT_MAP_PATH, parseDependencies } from '@cardstack/deck/import-map';
import { lockDeck } from '@cardstack/deck/lock';
import { pack } from '@cardstack/deck/pack';
import { inspectStore, publishToStore, readStoredPack } from '@cardstack/deck/store';
import { peekPacklist } from '@cardstack/deck/pack';
import { readTreeFromDir } from '@cardstack/deck/tree';
import { vendorFromNpmSource } from '@cardstack/deck/vendor-npm';
import { storeDirFor } from '@cardstack/deck-server/depot';
import { localFetch } from '@cardstack/deck-server/tls';
import {
  createDemoServer,
  demoOrigin,
  liveNotes,
  openDemoDepot,
  serveLive,
} from '../shared/depot.mjs';
import {
  readEditable,
  seedEditable,
  startEditorBridge,
} from '../shared/editor-bridge.mjs';
import { demoBuildMode } from '../shared/reset.mjs';
import { publishShared } from '../shared/publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8793);
const DEPOT = 'site';
const depotDir = join(here, 'depot');
const storeDir = storeDirFor(depotDir);
// The write path runs on its own port, and that is not tidiness. The deck
// server answers GET and HEAD and nothing else (L12), so a page cannot ask it
// to save a file. See examples/shared/editor-bridge.mjs.
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? PORT + 1);

// The shelf. Exact versions, because a demo that resolves differently on
// different days cannot make a claim about bytes.
const LIBRARIES = [
  { deck: 'lib/date-fns', npm: 'date-fns@4.1.0', version: '4.1.0', tag: 'latest' },
  { deck: 'lib/chroma-js', npm: 'chroma-js@3.1.2', version: '3.1.2', tag: 'latest' },
  // The same deck, an older version, still published. `fields/brand-swatch`
  // pins it; nothing else has to care.
  { deck: 'lib/chroma-js', npm: 'chroma-js@2.6.0', version: '2.6.0' },
  { deck: 'lib/luxon', npm: 'luxon@3.5.0', version: '3.5.0', tag: 'latest' },
  // zod ships v3 and v4 side by side in one tarball; the automatic entry pick
  // lands in the v4 tree, so this one is chosen rather than guessed.
  { deck: 'lib/zod', npm: 'zod@3.25.76', version: '3.25.76', entry: 'v3/index.js', tag: 'latest' },
  { deck: 'lib/nanoid', npm: 'nanoid@5.0.9', version: '5.0.9', tag: 'latest' },
];

const FIELDS = [
  'fields/due-date',
  'fields/swatch',
  'fields/brand-swatch',
  'fields/meeting-slot',
  'fields/handle',
  'fields/audit-stamp',
];
// The seventh field belongs to the reader. It is seeded from `starter/` into
// a gitignored part of the depot, so an edit made in the browser never dirties
// the repository and a re-run keeps whatever was left behind.
const EDITABLE = 'you/ship-by';
const APP = 'app/library';
const VERSION = '1.0.0';

// Which files a reader may edit is declared in editable.json, so this demo
// and the Hub start the same bridge over the same allow-list.
const EDITABLE_FILES = await readEditable(here);


const buildMode = await demoBuildMode({
  storeDir,
  probe: { name: 'fields/swatch', version: '1.0.0' },
  label: 'FIELD LIBRARY',
});
if (buildMode === 'rebuild') {
  await rm(storeDir, { recursive: true, force: true });
  console.log('   RESET=1 — wiped .deck/store; Notes and Claims kept');
}
await mkdir(storeDir, { recursive: true });

let seedState = await seedEditable(here, EDITABLE_FILES);

if (buildMode !== 'serve') {

console.log('\n  FIELD LIBRARY — aliasing, scopes, and dedupe across many decks\n');

// The shared `ui/pills` deck, published into this depot's store from
// examples/shared. Same source tree in every demo, so the same treeHash.
let [pills] = await publishShared(storeDir);
console.log(`   shared: ${pills.name}@${pills.version} · ${pills.treeHash.slice(0, 12)}… (same tree in every demo)\n`);

// ---------------------------------------------------------------------------
// 1. The shelf. Vendored from npm SOURCE — the module tree npm published, not
//    a CDN bundle — and sealed into this depot.
// ---------------------------------------------------------------------------
console.log('1) vendoring the shelf from npm source');
let shelfInfo = [];
for (let library of LIBRARIES) {
  let vendored = await vendorFromNpmSource({
    spec: library.npm,
    ...(library.entry ? { entry: library.entry } : {}),
    // A demo must not fail on the day someone runs it; a depot sets a real
    // minimumReleaseAge (L11).
    policy: { minimumReleaseAge: 0 },
  });
  if (vendored.externals.length > 0) {
    throw new Error(
      `${library.npm} reaches outside itself (${vendored.externals.join(', ')}) — it cannot be sealed alone`,
    );
  }
  let name = library.deck.split('/')[1];
  let mapBytes = Buffer.from(
    JSON.stringify(
      {
        deck: {
          packages: {
            [name]: {
              version: library.version,
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
  let { treeHash } = await publishToStore(
    storeDir,
    library.deck,
    library.version,
    pack([{ path: IMPORT_MAP_PATH, bytes: mapBytes }, ...vendored.files]),
    library.tag ? { tag: library.tag } : {},
  );
  shelfInfo.push({
    deck: library.deck,
    version: library.version,
    npm: library.npm,
    modules: vendored.modules.length,
    entry: vendored.entryPath,
    treeHash,
    consumers: [],
  });
  console.log(
    `   ${`${library.deck}@${library.version}`.padEnd(28)} ${String(vendored.modules.length).padStart(4)} modules · ${treeHash.slice(0, 12)}…`,
  );
}

// ---------------------------------------------------------------------------
// 2. Lock and seal each field deck.
//
//    `deck lock` turns the ranges the author wrote into exact pins and writes
//    them INTO the tree — so the lock is a file you can read, and moving a
//    dependency is an ordinary save. The pins are checked in here, which means
//    a clean run must produce no change; if it does, the demo says so instead
//    of quietly relocking.
// ---------------------------------------------------------------------------
console.log('\n2) locking and sealing the six field decks');
let drifted = [];
async function lockAndSeal(deckName) {
  let deckDir = join(depotDir, ...deckName.split('/'));
  let { text, changed, resolutions } = await lockDeck({
    depotDir,
    depotName: DEPOT,
    storeDir,
    deckDir,
  });
  if (changed) {
    // The reader's field is seeded WITHOUT a lock, so locking it on the first
    // run is the expected outcome rather than drift in a checked-in file.
    if (deckName !== EDITABLE) drifted.push(deckName);
    await writeFile(join(deckDir, IMPORT_MAP_PATH), text);
  }
  let files = await readTreeFromDir(deckDir);
  files.set(IMPORT_MAP_PATH, Buffer.from(text, 'utf8'));
  let { treeHash } = await publishToStore(
    storeDir,
    deckName,
    VERSION,
    pack([...files.entries()].map(([path, bytes]) => ({ path, bytes }))),
    { tag: 'latest' },
  );
  return { treeHash, resolutions, files: files.size, text };
}

let fieldInfo = [];
for (let deckName of [...FIELDS, EDITABLE]) {
  let { treeHash, resolutions } = await lockAndSeal(deckName);
  let pins = resolutions
    .map((r) => `${r.key}→${r.publisher}/${r.package}@${r.version}`)
    .sort();
  for (let resolution of resolutions) {
    let library = shelfInfo.find(
      (l) =>
        l.deck === `${resolution.publisher}/${resolution.package}` &&
        l.version === resolution.version,
    );
    library?.consumers.push(deckName);
  }
  fieldInfo.push({ deck: deckName, treeHash, pins });
  console.log(
    `   ${deckName.padEnd(22)} ${treeHash.slice(0, 12)}…  ${pins.join('  ')}` +
      (deckName === EDITABLE ? `   ← yours (${seedState})` : ''),
  );
}

// What the six decks asked for, and what it collapsed to.
let edges = 0;
let urls = new Map();
for (let deckName of [...FIELDS, EDITABLE]) {
  let deckDir = join(depotDir, ...deckName.split('/'));
  let files = await readTreeFromDir(deckDir);
  let declared = parseDependencies(files.get(IMPORT_MAP_PATH).toString('utf8')) ?? {};
  edges += Object.keys(declared).length;
}
for (let library of shelfInfo) {
  if (library.consumers.length > 0) {
    urls.set(`${library.deck}@${library.version}`, library.consumers.length);
  }
}
console.log(`\n   ${edges} dependency edges → ${urls.size} distinct library URLs`);
for (let [url, count] of [...urls].sort()) {
  console.log(`     ${url.padEnd(26)} ${count} consumer${count === 1 ? '' : 's'}`);
}
console.log(`   chroma-js appears twice because two decks pinned different`);
console.log(`   versions on purpose. That is what scopes are for.`);

// ---------------------------------------------------------------------------
// 3. What the store actually holds.
//
//    Two measured numbers: how many file slots the sealed versions contain in
//    total, and how many distinct objects back them. The gap is the dedupe,
//    and nothing computed it — identical bytes have identical names.
// ---------------------------------------------------------------------------
let entries = 0;
for (let library of [...shelfInfo]) {
  let bytes = await readStoredPack(storeDir, library.deck, library.version);
  entries += peekPacklist(bytes).entries.length;
}
for (let field of fieldInfo) {
  let bytes = await readStoredPack(storeDir, field.deck, VERSION);
  entries += peekPacklist(bytes).entries.length;
}
let report = await inspectStore(storeDir);
console.log(`\n3) the store, after ${report.versions} sealed versions`);
console.log(`   file slots across every pack: ${entries}`);
console.log(`   distinct objects:             ${report.objects}`);
console.log(`   bytes:                        ${report.bytes.toLocaleString()}`);

// The alternative this replaces: each field carrying its own copy of every
// library it uses, the way a bundler-per-package world produces.
let ownCopies = 0;
for (let field of fieldInfo) {
  let bytes = await readStoredPack(storeDir, field.deck, VERSION);
  ownCopies += peekPacklist(bytes).entries.length;
  for (let library of shelfInfo) {
    if (library.consumers.includes(field.deck)) {
      ownCopies += library.modules + 1;
    }
  }
}
console.log(`   if each field carried its own copies: ${ownCopies} files`);

// ---------------------------------------------------------------------------
// 4. The app. Locked last, because its scopes are derived from what the field
//    decks were sealed depending on.
// ---------------------------------------------------------------------------
await writeFile(
  join(depotDir, 'app', 'library', 'shelf.json'),
  JSON.stringify(
    {
      depot: DEPOT,
      decks: LIBRARIES.length - 1 + FIELDS.length + 2,
      editable: EDITABLE,
      bridgePort: BRIDGE_PORT,
      libraries: shelfInfo.filter((l) => l.consumers.length > 0),
      fields: fieldInfo,
      chroma: { current: '3.1.2', pinned: '2.6.0' },
      store: {
        versions: report.versions,
        entries,
        objects: report.objects,
        bytes: report.bytes,
        wouldBe: ownCopies,
      },
    },
    null,
    2,
  ) + '\n',
);

let app = await lockAndSeal(APP);
let appMap = JSON.parse(app.text);
let scopeCount = Object.keys(appMap.scopes ?? {}).length;
console.log(`\n4) ${APP}@${VERSION} · ${app.treeHash.slice(0, 12)}…`);
console.log(`   ${Object.keys(appMap.imports).length} top-level pins, ${scopeCount} scopes`);
console.log(`   The page imports seven field decks and not one library.`);

if (drifted.length > 0) {
  console.log(`\n   NOTE: the checked-in lock was out of date and has been`);
  console.log(`   rewritten for: ${drifted.join(', ')}`);
  console.log(`   Commit the importmap.json changes, or pin the libraries back.`);
}

// ---------------------------------------------------------------------------
// 5. Serve. Everything is at rest: no write endpoint, no login.
// ---------------------------------------------------------------------------
} // end buildMode

// ---------------------------------------------------------------------------
// 5. Serve, with the live loop on.
//
//    The deck server is read-only. The editor bridge beside it is not part of
//    Deck: it writes one file and stops, the way your editor would. Everything
//    after the write — hash, dedup, publish, dist-tag — is the watcher doing
//    what it does for any save.
// ---------------------------------------------------------------------------
let depot = await openDemoDepot({ name: DEPOT, dir: depotDir });
let server = createDemoServer({
  depots: [depot],
  fallback: (req, res) => {
    // Where the editor bridge is listening, answered by the origin the page
    // was loaded from. A GET, so it passes the read-only gate; the page can
    // then find the bridge whatever port it landed on — which matters,
    // because the Hub gives it an ephemeral one.
    if (req.url?.startsWith('/_demo/editor')) {
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({ origin: bridge.origin, files: EDITABLE_FILES.files }));
      return;
    }
    res.writeHead(302, { location: `/${DEPOT}/${APP}@${VERSION}/index.html` });
    res.end();
  },
});

let bridge = await startEditorBridge({
  depotDir,
  files: EDITABLE_FILES.files,
  port: BRIDGE_PORT,
});

let origin = demoOrigin(PORT);
server.listen(PORT, async () => {
  // What the sealed page advertises up front. A cold browser learns every URL
  // from the document instead of discovering them one graph level at a time —
  // and the walk has to run the same import-map algorithm, scopes included, or
  // it stops at the first scoped edge and reports full coverage of a graph it
  // only half-walked.
  let head = await localFetch(
    `${demoOrigin(PORT, '127.0.0.1')}/${DEPOT}/${APP}@${VERSION}/index.html`,
    { method: 'HEAD' },
  );
  let closure = head.headers.get('x-deck-preload');

  serveLive({
    depot,
    server,
    onPublish: (event) =>
      console.log(
        event.reused
          ? `   saved → ${event.name} is already published as ${event.version} — dev points back at it`
          : `   saved → ${event.name}@${event.version}${event.sealChangeId ? ` · Step ${event.sealChangeId.slice(0, 12)}` : ''}`,
      ),
  });

  console.log(`\n5) serving (HTTPS + HTTP/2)\n`);
  console.log(`   modulepreload closure advertised: ${closure ?? 'none'}`);
  console.log(`   (links emitted / modules reachable — the rest is over budget)\n`);
  console.log(liveNotes({ depot, port: PORT }));
  console.log(`   editor bridge: ${bridge.origin} — writes ${EDITABLE}/index.js, nothing else\n`);
  console.log(`      ${origin}/\n`);
  console.log(`      /${DEPOT}/${APP}@${VERSION}/index.html`);
  console.log(`      /${DEPOT}/${APP}@${VERSION}/index.html?with=${EDITABLE}   ← the working tree`);
  console.log(`      /${DEPOT}/fields/swatch@${VERSION}/importmap.json        ← the lock, readable`);
  console.log(`      /${DEPOT}/lib/chroma-js@3.1.2/index.js`);
  console.log(`      /${DEPOT}/lib/chroma-js@2.6.0/index.js   ← both, at once\n`);
});
