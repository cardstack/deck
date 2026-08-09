#!/usr/bin/env node
// A, B or C — three variations, one choice, and the two you didn't pick.
//
// Ask an agent to make something denser and you get three answers at three
// different layers: change the tokens, change the card, change the gallery.
// They are not drafts of one edit. They have different blast radii, so a
// person has to choose — and the two rejected answers have to stay readable,
// because in a month one of them will turn out to have been right.
//
// Everywhere else that is a mess. Two branches nobody will rebase, or two
// stashes, or (most often) two answers the agent threw away when you replied
// "let's go with B".
//
// Here it is the ordinary machinery:
//
//   each variation      → an immutable prerelease, published, at its own URL
//   review              → `?with=` renders one sealed page three ways
//   choosing            → `deck release --from try-b` moves a tag, copies nothing
//   the two you rejected → still published, still addressable, just not `latest`
//
// "Not latest" needs no other mechanism: a dist-tag points somewhere else, and
// a `^1.0.0` range never matched a prerelease in the first place, so nothing
// downstream moved when they were created and nothing moved when they lost.
//
//   pnpm --filter @deck/example-variations demo
//   CHOOSE=c pnpm --filter @deck/example-variations demo   # pick another
//   open http://localhost:8796/
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPORT_MAP_PATH } from '@deck/core/import-map';
import { lockDeck } from '@deck/core/lock';
import { pack } from '@deck/core/pack';
import {
  publishToStore,
  readStoreMeta,
  readStoredPack,
  releaseVersion,
} from '@deck/core/store';
import { readTreeFromDir } from '@deck/core/tree';
import {
  createDemoServer,
  demoOrigin,
  liveNotes,
  openDemoDepot,
  serveLive,
} from '../shared/depot.mjs';
import { publishShared } from '../shared/publish.mjs';
import { resetDemoDepot } from '../shared/reset.mjs';
import { BRIEF, VARIATIONS } from './agent.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8796);
const DEPOT = 'site';
const depotDir = join(here, 'depot');
const NEXT = '1.1.0';

// Which variation wins. Default B — the middle blast radius — but the whole
// point is that this is a choice, so it is a knob.
const CHOSEN = (process.env.CHOOSE ?? 'b').toLowerCase();
if (!VARIATIONS.some((v) => v.id === CHOSEN)) {
  throw new Error(`CHOOSE must be one of ${VARIATIONS.map((v) => v.id).join(', ')}`);
}

const fail = (message) => {
  throw new Error(message);
};
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const deckDirOf = (deck) => join(depotDir, ...deck.split('/'));

// The variations themselves are built in memory and published; nothing writes
// them to the working tree. The one thing that IS written is each deck's lock,
// because the live pages need real pins to resolve their bare specifiers — so
// the reset blanks every `imports` block back to empty and lets the run
// rebuild it. That keeps run N+1 identical to run 1 whichever variation the
// last run promoted.
const DECKS = ['std/tokens', 'ui/card', 'app/gallery', 'app/preview', 'app/chooser'];
// The three the variations touch — the ones a preview has to pin.
const LAYERED = new Set(['std/tokens', 'ui/card', 'app/gallery']);
const unlocked = Object.fromEntries(
  await Promise.all(
    DECKS.map(async (deck) => {
      let relative = join(...deck.split('/'), IMPORT_MAP_PATH);
      let map = JSON.parse(await readFile(join(depotDir, relative), 'utf8'));
      return [relative, json({ ...map, imports: {} })];
    }),
  ),
);
await resetDemoDepot({ depotDir, pristine: unlocked });

console.log('\n  A, B OR C — three variations, one choice\n');
const depot = await openDemoDepot({ name: DEPOT, dir: depotDir });
const storeDir = depot.storeDir;

// ---------------------------------------------------------------------------
// 1. The starting point: three decks, one per layer, all at 1.0.0.
// ---------------------------------------------------------------------------
let [pills] = await publishShared(storeDir);

async function publishFromDisk(deck, version, { tag } = {}) {
  let dir = deckDirOf(deck);
  let locked = await lockDeck({ depotDir, depotName: DEPOT, storeDir, deckDir: dir });
  if (locked.changed) {
    await writeFile(join(dir, IMPORT_MAP_PATH), locked.text);
  }
  let files = await readTreeFromDir(dir);
  files.set(IMPORT_MAP_PATH, Buffer.from(locked.text, 'utf8'));
  return {
    record: await publishToStore(
      storeDir,
      deck,
      version,
      pack([...files.entries()].map(([path, bytes]) => ({ path, bytes }))),
      { tag },
    ),
    files,
  };
}

console.log('1) the starting point — one deck per layer');
let baseline = new Map();
for (let deck of DECKS) {
  let { record, files } = await publishFromDisk(deck, '1.0.0', { tag: 'latest' });
  baseline.set(deck, files);
  console.log(`   ${deck.padEnd(14)} 1.0.0  ${record.treeHash.slice(0, 12)}…`);
}
console.log(`   shared: ${pills.name}@${pills.version} · ${pills.treeHash.slice(0, 12)}…`);

// ---------------------------------------------------------------------------
// 2. The agent. Deterministic, so run ten prints what run one printed.
// ---------------------------------------------------------------------------
console.log(`\n2) the agent, asked to "${BRIEF}"`);
let produced = [];
for (let variation of VARIATIONS) {
  // A variation is the baseline tree with ONE file replaced and the manifest
  // bumped to the version it wants to become. The bump matters: the store
  // requires a prerelease to extend the version its own manifest declares, so
  // `1.1.0-try.a` may only be published by a tree that says it is 1.1.0.
  let files = new Map(baseline.get(variation.deck));
  let before = files.get(variation.file).toString('utf8');
  let after =
    variation.file.endsWith('.json')
      ? json(variation.edit(JSON.parse(before)))
      : variation.edit(before);
  if (after === before) {
    fail(`variation ${variation.id} changed nothing in ${variation.file}`);
  }
  files.set(variation.file, Buffer.from(after, 'utf8'));

  let map = JSON.parse(files.get(IMPORT_MAP_PATH).toString('utf8'));
  map.deck.packages[variation.deck.split('/')[1]].version = NEXT;
  files.set(IMPORT_MAP_PATH, Buffer.from(json(map), 'utf8'));

  let version = `${NEXT}-try.${variation.id}`;
  let record = await publishToStore(
    storeDir,
    variation.deck,
    version,
    pack([...files.entries()].map(([path, bytes]) => ({ path, bytes }))),
    { tag: `try-${variation.id}` },
  );
  produced.push({ ...variation, version, treeHash: record.treeHash });
  console.log(
    `   ${variation.id.toUpperCase()}  ${variation.layer.padEnd(12)} ${variation.deck}@${version}  ${record.treeHash.slice(0, 12)}…`,
  );
  console.log(`      ${variation.title} — changes ${variation.blastRadius}`);
}

// Nothing downstream moved. That is the claim, so it is checked: the app's
// range still resolves to 1.0.0 with three prereleases sitting in the store.
for (let variation of produced) {
  let meta = await readStoreMeta(storeDir, variation.deck);
  if (meta.tags.latest !== '1.0.0') {
    fail(`${variation.deck} latest moved to ${meta.tags.latest} — a prerelease must not`);
  }
}
console.log('   latest still points at 1.0.0 for all three. Ranges never match prereleases.');

// ---------------------------------------------------------------------------
// 3. Choosing. A release names a sealed state; it does not make one.
// ---------------------------------------------------------------------------
let winner = produced.find((v) => v.id === CHOSEN);
let command = `deck release --depot ./depot --publisher ${winner.deck.split('/')[0]} --name ${winner.deck.split('/')[1]} \\\n  --version ${NEXT} --from try-${winner.id} --tag latest`;
console.log(`\n3) choosing ${CHOSEN.toUpperCase()} — "${winner.title}"`);
let released = await releaseVersion(
  storeDir,
  winner.deck,
  NEXT,
  { tag: `try-${winner.id}` },
  { tag: 'latest' },
);
if (released.treeHash !== winner.treeHash) {
  fail('the release named a different tree than the variation held');
}
let meta = await readStoreMeta(storeDir, winner.deck);
if (meta.versions[NEXT].file !== meta.versions[winner.version].file) {
  fail('the release copied bytes — it must be a pointer');
}
console.log(`   ${winner.deck}@${NEXT} ← ${winner.version}`);
console.log(`   same tree ${released.treeHash.slice(0, 12)}…, same stored object, zero bytes copied`);

// The app follows because its RANGE now resolves somewhere else. Nothing in
// the app changed to make that happen.
let relocked = await lockDeck({
  depotDir,
  depotName: DEPOT,
  storeDir,
  deckDir: deckDirOf('app/gallery'),
});
console.log(
  `   app/gallery re-locks: ${relocked.resolutions.map((r) => `${r.key} → ${r.imports[r.key] ?? r.imports[`${r.key}/`]}`).join(', ')}`,
);

// ---------------------------------------------------------------------------
// 4. The two you did not pick.
// ---------------------------------------------------------------------------
console.log('\n4) the rejected two');
let state = [];
for (let variation of produced) {
  let meta = await readStoreMeta(storeDir, variation.deck);
  let tags = Object.entries(meta.tags)
    .filter(([, version]) => version === variation.version)
    .map(([tag]) => tag);
  let bytes = await readStoredPack(storeDir, variation.deck, variation.version);
  if (!bytes) {
    fail(`${variation.deck}@${variation.version} no longer rebuilds — a rejected variation must survive`);
  }
  if (variation.id !== CHOSEN && tags.includes('latest')) {
    fail(`${variation.deck}@${variation.version} is tagged latest but was not chosen`);
  }
  console.log(
    `   ${variation.id.toUpperCase()}  ${variation.deck}@${variation.version}  tags: ${tags.join(', ') || '(none but try-' + variation.id + ')'}  ${bytes.length} bytes, still rebuilds`,
  );
  state.push({
    id: variation.id,
    layer: variation.layer,
    deck: variation.deck,
    title: variation.title,
    rationale: variation.rationale,
    blastRadius: variation.blastRadius,
    version: variation.version,
    tags,
    // A fair comparison pins ALL THREE layers, not just the one that
    // varies: after B was promoted, `ui/card: ^1.0.0` resolves to 1.1.0, so
    // a frame that only overrode A would quietly be showing A *and* B.
    with: DECKS.filter((deck) => LAYERED.has(deck))
      .map((deck) =>
        deck === variation.deck
          ? `${deck}@${variation.version}`
          : `${deck}@1.0.0`,
      )
      .join(','),
    url: `/${DEPOT}/${variation.deck}@${variation.version}/`,
  });
}
console.log('   Nothing was deleted, stashed, or branched. They simply are not what latest names.');
console.log(`   Change your mind later: release ${NEXT === '1.1.0' ? '1.2.0' : NEXT} --from try-a. Still a pointer move.`);

// ---------------------------------------------------------------------------
// 5. Serve. The chooser iframes one sealed page four times.
// ---------------------------------------------------------------------------
// The app's own live tree now points at whatever won: `deck lock` wrote the
// new pin above, and the version-less URL serves the working tree, so the
// chooser page below is already resolving through it. No publish needed —
// the page you are about to open is not a snapshot of a decision, it is the
// decision.
let choiceBody = Buffer.from(
  json({ brief: BRIEF, chosen: CHOSEN, command, variations: state }),
  'utf8',
);

// Also leave it on disk, BESIDE the depot rather than inside it.
//
// The chooser asks the server for this, not the depot, and rightly: it is a
// fact about the demo run — what the agent proposed, what got promoted — not
// a fact about the packages. Putting it in the depot would fold it into a
// tree hash and make the packages claim something they do not contain.
//
// But a fact that lives only in one process's memory can only be served by
// that one process, and that is exactly why this was the single demo the Hub
// could not run: it framed a real page whose data endpoint did not exist
// there. A sidecar costs nothing and makes the demo self-describing to any
// server that mounts this depot. The Hub picks it up generically.
await writeFile(join(here, 'choice.json'), choiceBody);
let server = createDemoServer({
  depots: [depot],
  fallback: (request, response) => {
    if (request.url?.startsWith('/choice.json')) {
      response.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(choiceBody);
      return;
    }
    response.writeHead(302, { location: `/${DEPOT}/app/chooser/index.html` });
    response.end();
  },
});
serveLive({ depot, server });
let origin = demoOrigin(PORT);
server.listen(PORT, () => {
  console.log('\n5) serving (HTTPS + HTTP/2)\n');
  console.log(`      ${origin}/`);
  for (let variation of state) {
    console.log(
      `      /${DEPOT}/app/preview/preview.html?${variation.with
        .split(',')
        .map((pin) => `with=${pin}`)
        .join('&')}`,
    );
    console.log(`         variation ${variation.id.toUpperCase()} — ${variation.title}`);
  }
  console.log(`\n${liveNotes({ depot, port: PORT, origin })}\n`);
  console.log(`   Re-run with CHOOSE=a or CHOOSE=c to promote a different one.\n`);
});
