#!/usr/bin/env node
// Contribute to a codelist — the write side of W2.
//
// The `codelist` example shows the merge as a finished fact: four sealed
// states, at rest, at immutable URLs. This one shows how a proposal gets
// made, kept mergeable, and reviewed — with no branch, no patch queue, and
// nothing checked out.
//
// A contribution here is not a diff. It is a TREE THAT EXISTS, in the
// contributor's own publisher scope, whose import map records the exact tree
// it forked:
//
//     "forkedFrom": { "package": "std/currencies",
//                     "version": "1.4.0",
//                     "treeHash": "9f3c…" }
//
// That one recorded hash is the third input a three-way merge needs. Because
// it is exact — not inferred from a commit graph — a machine can re-merge
// every open proposal against upstream continuously. Contributors never
// rebase; maintainers only look at the ones that stopped merging. That is
// what turns 200 open proposals into a queue instead of a backlog.
//
// The sequence below is the whole lifecycle:
//
//     1  upstream publishes 1.4.0
//     2  the app is locked and sealed against it
//     3  two people fork and amend, concurrently, neither aware of the other
//     4  the queue reports: nothing to do — upstream has not moved
//     5  upstream publishes 1.5.0, which collides with exactly one of them
//     6  the queue reports one clean and one conflicted
//     7  the daemon rebases the clean one and touches nothing else
//     8  a reviewer runs the app against any of it with `?with=`
//
//   pnpm --filter @cardstack/deck-example-contribute-to-codelist demo
//   open http://localhost:8794/
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forkDeck } from '@cardstack/deck/fork';
import { pack } from '@cardstack/deck/pack';
import { discoverOffers } from '@cardstack/deck/offer';
import { publishToStore } from '@cardstack/deck/store';
import { readTreeFromDir } from '@cardstack/deck/tree';
import { rebasePass } from '@cardstack/deck-tools/rebase-daemon';
import { storeDirFor } from '@cardstack/deck-server/depot';
import { createDemoServer, demoOrigin } from '../shared/depot.mjs';
import { demoBuildMode, rmKeepingNotes } from '../shared/reset.mjs';
import { publishShared, lockAndWrite } from '../shared/publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8794);
const DEPOT = 'site';
const depotDir = join(here, 'depot');
const storeDir = storeDirFor(depotDir);
const UPSTREAM = 'std/currencies';
const APP = 'app/picker';
// Declared out here, not inside the build branch: the server needs it in
// serve mode too, and a binding that only exists on one path is a crash
// waiting for the second run.
const depot = { name: DEPOT, dir: depotDir, storeDir };

// A real ISO-4217 slice, small enough to read on one screen.
const BASE_CODES = {
  AUD: { name: 'Australian Dollar', minor: 2 },
  BRL: { name: 'Brazilian Real', minor: 2 },
  CHF: { name: 'Swiss Franc', minor: 2 },
  EUR: { name: 'Euro', minor: 2 },
  GBP: { name: 'Pound Sterling', minor: 2 },
  INR: { name: 'Indian Rupee', minor: 2 },
  JPY: { name: 'Yen', minor: 0 },
  KRW: { name: 'Won', minor: 0 },
  USD: { name: 'US Dollar', minor: 2 },
  ZAR: { name: 'Rand', minor: 2 },
};

// Ana adds two codes nobody else touches.
const ANA = {
  XCD: { name: 'East Caribbean Dollar', minor: 2 },
  SRD: { name: 'Surinam Dollar', minor: 2 },
};
// Kim adds one code AND corrects an existing entry: ISO 4217 spells JPY
// "Yen", which is the code's official name but reads badly in a picker.
const KIM_ADD = { ZWG: { name: 'Zimbabwe Gold', minor: 2 } };
const KIM_FIX = { JPY: { name: 'Japanese Yen', minor: 0 } };

// What upstream ships as 1.5.0. It adds ZWG — the SAME entry Kim added,
// which is agreement, not conflict — and it renames JPY too, differently.
// That single key is the only real disagreement in the whole depot, and it
// is the one the queue has to find.
const RELEASE_ADD = { ZWG: { name: 'Zimbabwe Gold', minor: 2 } };
const RELEASE_FIX = { JPY: { name: 'Yen (Japan)', minor: 0 } };

const sortKeys = (codes) =>
  Object.fromEntries(Object.entries(codes).sort(([a], [b]) => (a < b ? -1 : 1)));

const INDEX_JS = `// The shared currency list.
//
// \`source\` is exported because a consumer showing a list ought to be able to
// say WHERE the list came from — and under \`?with=\` that is the only honest
// label there is: not what the query string asked for, but what the import
// map resolved to.
export const source = import.meta.url;

export async function currencies() {
  return (await fetch(new URL('./currencies.json', import.meta.url))).json();
}
`;

function upstreamTree(version, codes) {
  return [
    {
      path: 'package.json',
      bytes: Buffer.from(
        JSON.stringify(
          {
            name: 'currencies',
            version,
            type: 'module',
            exports: { '.': './index.js' },
          },
          null,
          2,
        ) + '\n',
        'utf8',
      ),
    },
    {
      path: 'currencies.json',
      bytes: Buffer.from(JSON.stringify(sortKeys(codes), null, 2) + '\n', 'utf8'),
    },
    { path: 'index.js', bytes: Buffer.from(INDEX_JS, 'utf8') },
  ];
}

async function amend(deckDir, change) {
  let path = join(deckDir, 'currencies.json');
  let codes = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify(sortKeys({ ...codes, ...change }), null, 2) + '\n');
}

const codesIn = async (deckDir) =>
  JSON.parse(await readFile(join(deckDir, 'currencies.json'), 'utf8'));

const buildMode = await demoBuildMode({
  storeDir,
  probe: { name: 'std/currencies', version: '1.4.0' },
  label: 'CONTRIBUTE TO A CODELIST',
});
if (buildMode === 'rebuild') {
  await rm(storeDir, { recursive: true, force: true });
  for (let publisher of ['ana', 'kim']) {
    await rmKeepingNotes(join(depotDir, publisher));
  }
  console.log('   RESET=1 — wiped store + fork scopes; Notes kept');
}
await mkdir(storeDir, { recursive: true });

if (buildMode !== 'serve') {

console.log('\n  CONTRIBUTE TO A CODELIST — fork, amend, offer, review\n');

// ---------------------------------------------------------------------------
// 1. Upstream publishes. Note that `std/currencies` is NOT a directory in this
//    depot: it is somebody else's published deck. A contributor does not check
//    it out — that is the point of step 3.
// ---------------------------------------------------------------------------
let base = await publishToStore(
  storeDir,
  UPSTREAM,
  '1.4.0',
  pack(upstreamTree('1.4.0', BASE_CODES)),
  { tag: 'latest' },
);
console.log(`1) ${UPSTREAM}@1.4.0 — ${Object.keys(BASE_CODES).length} codes · ${base.treeHash.slice(0, 12)}…`);

// The shared `ui/pills` deck, published into this depot's store from
// examples/shared. Same source tree in every demo, so the same treeHash.
let [pills] = await publishShared(storeDir);
console.log(`   shared: ${pills.name}@${pills.version} · ${pills.treeHash.slice(0, 12)}… (same tree in every demo)`);

// ---------------------------------------------------------------------------
// 2. The app that consumes it, locked to the release and sealed.
// ---------------------------------------------------------------------------
let appDir = join(depotDir, ...APP.split('/'));
let locked = await lockAndWrite({ depotDir, depotName: DEPOT, storeDir });
let appFiles = await readTreeFromDir(appDir);
let app = await publishToStore(
  storeDir,
  APP,
  '1.0.0',
  pack([...appFiles.entries()].map(([path, bytes]) => ({ path, bytes }))),
  { tag: 'latest' },
);
console.log(`2) ${APP}@1.0.0 · ${app.treeHash.slice(0, 12)}…`);
console.log(`   pinned to ${JSON.parse(locked.text).imports[UPSTREAM]}`);

// ---------------------------------------------------------------------------
// 3. Two people fork. `deck fork` copies the sealed tree into their own
//    publisher scope and records what it forked. Nothing is branched, nothing
//    is reserved, and upstream is not told.
// ---------------------------------------------------------------------------
console.log(`\n3) two forks of ${UPSTREAM}@1.4.0`);
let forks = [];
for (let [actor, change] of [
  ['ana', ANA],
  ['kim', { ...KIM_ADD, ...KIM_FIX }],
]) {
  let result = await forkDeck({
    depotDir,
    storeDir,
    from: { publisher: 'std', package: 'currencies', spec: '1.4.0' },
    to: { publisher: actor, package: 'currencies' },
    actor,
  });
  await amend(result.dir, change);
  forks.push({ actor, ...result, change });
  console.log(`   ${result.to.padEnd(16)} + ${Object.keys(change).join(', ')}`);
}
console.log(`   both record forkedFrom.treeHash ${base.treeHash.slice(0, 12)}… — the merge base,`);
console.log(`   exact, in the tree, not inferred from anything.`);

let offers = await discoverOffers(depotDir);
console.log(`   discovered as offers: ${offers.map((o) => o.name).join(', ')}`);

// ---------------------------------------------------------------------------
// 4. The queue, before upstream moves.
// ---------------------------------------------------------------------------
async function queue(label, { dryRun = true } = {}) {
  let result = await rebasePass({ depot, dryRun });
  console.log(`\n   ${label}`);
  for (let outcome of result.outcomes.sort((a, b) => a.offer.localeCompare(b.offer))) {
    let extra = outcome.conflicts.length > 0 ? `  ← ${outcome.conflicts.join(', ')}` : '';
    let moved = outcome.applied ? '  (tree rewritten)' : '';
    console.log(`     ${outcome.offer.padEnd(16)} ${outcome.state.padEnd(12)} ${outcome.upstreamVersion ?? ''}${extra}${moved}`);
  }
  return result;
}
console.log(`\n4) the queue`);
await queue('before upstream moves — nothing to absorb:');

// ---------------------------------------------------------------------------
// 5. Upstream ships 1.5.0. It agrees with Kim about ZWG and disagrees with her
//    about JPY.
// ---------------------------------------------------------------------------
let release = await publishToStore(
  storeDir,
  UPSTREAM,
  '1.5.0',
  pack(upstreamTree('1.5.0', { ...BASE_CODES, ...RELEASE_ADD, ...RELEASE_FIX })),
  { tag: 'latest' },
);
console.log(`\n5) ${UPSTREAM}@1.5.0 · ${release.treeHash.slice(0, 12)}…`);
console.log(`   + ZWG            ← Kim added the same entry: agreement, not conflict`);
console.log(`   ~ JPY "${RELEASE_FIX.JPY.name}"  ← Kim wrote "${KIM_FIX.JPY.name}": one key, two answers`);

let before = await queue('now that upstream has moved:');
let conflicted = before.outcomes.filter((o) => o.state === 'conflicted');
if (conflicted.length !== 1 || conflicted[0].offer !== 'kim/currencies') {
  throw new Error(
    `the demo expected exactly kim/currencies to conflict, got ${JSON.stringify(before.outcomes.map((o) => [o.offer, o.state]))}`,
  );
}
if (!conflicted[0].conflicts.includes('currencies.json')) {
  throw new Error(`expected the conflict to be in the DATA, got ${conflicted[0].conflicts.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 6. The daemon runs for real. It writes the clean merge into Ana's own
//    working tree and moves her base pointer forward. Kim's tree is not
//    touched — a conflicted merge writes NOTHING.
// ---------------------------------------------------------------------------
console.log(`\n6) the daemon, for real`);
let anaBefore = Object.keys(await codesIn(join(depotDir, 'ana', 'currencies'))).length;
let kimBefore = await readFile(join(depotDir, 'kim', 'currencies', 'currencies.json'), 'utf8');
let applied = await queue('one pass, writes enabled:', { dryRun: false });
let anaAfter = await codesIn(join(depotDir, 'ana', 'currencies'));
let kimAfter = await readFile(join(depotDir, 'kim', 'currencies', 'currencies.json'), 'utf8');

if (kimAfter !== kimBefore) {
  throw new Error('the daemon modified a CONFLICTED proposal — it must write nothing');
}
console.log(`   ana/currencies  ${anaBefore} → ${Object.keys(anaAfter).length} codes; absorbed ZWG and the JPY rename`);
console.log(`   kim/currencies  untouched, byte for byte — a conflicted merge writes nothing`);
if (anaAfter.JPY.name !== RELEASE_FIX.JPY.name) {
  throw new Error(`ana did not absorb upstream's JPY rename: ${JSON.stringify(anaAfter.JPY)}`);
}

// A second pass must be a no-op, or an unattended daemon publishes itself
// forever.
let settled = await queue('a second pass — the loop has to converge:', { dryRun: false });
if (settled.rebased !== 0) {
  throw new Error(`the daemon did not converge: ${settled.rebased} tree(s) rewritten on the second pass`);
}
console.log(`   ${applied.rebased} rebased on the first pass, ${settled.rebased} on the second.`);

// ---------------------------------------------------------------------------
// 7. Serve. The reviewer's console is the app itself.
// ---------------------------------------------------------------------------
} // end buildMode

let server = createDemoServer({
  depots: [depot],
  fallback: (req, res) => {
    res.writeHead(302, { location: `/${DEPOT}/${APP}@1.0.0/index.html` });
    res.end();
  },
});
server.listen(PORT, () => {
  console.log(`\n7) serving — four views of one sealed page (HTTPS + HTTP/2)\n`);
  console.log(`      ${demoOrigin(PORT)}/`);
  console.log(`      …/index.html                                  the release, 1.4.0`);
  console.log(`      …/index.html?with=std/currencies@1.5.0        the next release`);
  console.log(`      …/index.html?with=std/currencies=ana/currencies   ana's proposal, live`);
  console.log(`      …/index.html?with=std/currencies=kim/currencies   kim's proposal, live`);
  console.log(`\n      /${DEPOT}/_offers                              the queue, re-merged on read\n`);
  console.log(`   Nothing was checked out to review any of it, and the two`);
  console.log(`   proposals are LIVE working trees — edit`);
  console.log(`   depot/kim/currencies/currencies.json and reload.\n`);
});
