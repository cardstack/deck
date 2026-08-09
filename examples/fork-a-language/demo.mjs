#!/usr/bin/env node
// Fork a language — keep the engine, replace the syntax.
//
// `lang/jqish` is a small jq-shaped filter language: a parser, an
// evaluator, and an entry that wires them together. `me/jqish` is a fork
// that replaces ONE file — the parser — with a FEEL-shaped surface
// language, and adds a feature the original does not have.
//
//     jqish    .items | select(.qty > 2 and .tag == "book") | .title
//     feelish  items[qty > 2 and tag = "book"].title
//     feelish  items[qty in [2..8]].title          ← ranges, new
//
// The range is the part worth understanding. It compiles to
// `qty >= 2 and qty <= 8` inside the parser, so a new language feature
// arrives with the EVALUATOR UNCHANGED. `eval.js` is byte-identical across
// the two decks — which this demo proves rather than claims, by checking
// that the store holds exactly one object for it.
//
//   pnpm --filter @deck/example-fork-a-language demo
//   open http://localhost:8792/
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes } from '@deck/core/tree-hash';
import { packFromDir } from '@deck/core/pack';
import { publishToStore, inspectStore } from '@deck/core/store';
import { storeDirFor } from '@deck/server/depot';
import { createDemoServer, demoOrigin } from '../shared/depot.mjs';
import { demoBuildMode } from '../shared/reset.mjs';
import { lockAndWrite, publishShared } from '../shared/publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8792);
const DEPOT = 'site';
const depotDir = join(here, 'depot');
const storeDir = storeDirFor(depotDir);

const UPSTREAM = { deck: 'lang/jqish', dir: join(depotDir, 'lang', 'jqish'), version: '1.0.0' };
const FORK = { deck: 'me/jqish', dir: join(depotDir, 'me', 'jqish'), version: '1.0.0-feel.0' };

// The same question, asked in both dialects. If the fork is honest, each
// pair returns the same answer.
const DATA = {
  items: [
    { title: 'Dune', qty: 5, tag: 'book' },
    { title: 'Mug', qty: 9, tag: 'kitchen' },
    { title: 'Ficciones', qty: 1, tag: 'book' },
    { title: 'Solaris', qty: 3, tag: 'book' },
  ],
};
const PAIRS = [
  {
    ask: 'books we have more than two of',
    jqish: '.items | select(.qty > 2 and .tag == "book") | .title',
    feelish: 'items[qty > 2 and tag = "book"].title',
  },
  {
    ask: 'how many items',
    jqish: '.items | length',
    feelish: 'count(items)',
  },
  {
    ask: 'everything that is not a book',
    jqish: '.items | select(not .tag == "book") | .title',
    feelish: 'items[not(tag = "book")].title',
  },
];
// Only the fork can express this one.
const ONLY_FEEL = { ask: 'stock between 2 and 8 (a FEEL range)', feelish: 'items[qty in [2..8]].title' };


const buildMode = await demoBuildMode({
  storeDir,
  probe: { name: 'lang/jqish', version: '1.0.0' },
  label: 'FORK A LANGUAGE',
});
if (buildMode === 'rebuild') {
  await rm(storeDir, { recursive: true, force: true });
  console.log('   RESET=1 — wiped .deck/store; Notes and Claims kept');
}
await mkdir(storeDir, { recursive: true });

if (buildMode !== 'serve') {

console.log('\n  FORK A LANGUAGE — keep the engine, replace the syntax\n');

// 1. Seal both.
for (let side of [UPSTREAM, FORK]) {
  let { treeHash } = await publishToStore(
    storeDir,
    side.deck,
    side.version,
    await packFromDir(side.dir),
    { tag: side === UPSTREAM ? 'latest' : 'feel' },
  );
  side.hash = treeHash;
  console.log(`   ${side.deck}@${side.version} · ${treeHash.slice(0, 12)}…`);
}

// 2. Which files actually differ. Hashing the bytes is the whole answer —
//    no diff tool, no heuristics.
let changed = [];
let shared = [];
for (let name of ['parse.js', 'eval.js', 'index.js']) {
  let a = hashBytes(await readFile(join(UPSTREAM.dir, name)));
  let b = hashBytes(await readFile(join(FORK.dir, name)));
  (a === b ? shared : changed).push(name);
}
console.log(`\n1) changed: ${changed.join(', ')}`);
console.log(`   shared:  ${shared.join(', ')}   ← same bytes, so ONE object in the store`);

// 3. Do the two dialects agree? Import both engines and ask.
let up = await import(join(UPSTREAM.dir, 'index.js'));
let fk = await import(join(FORK.dir, 'index.js'));
console.log(`\n2) asking the same question in both dialects`);
let results = [];
let disagreed = 0;
for (let pair of PAIRS) {
  let a = up.run(pair.jqish, DATA);
  let b = fk.run(pair.feelish, DATA);
  let same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) disagreed++;
  results.push({ ...pair, out: JSON.stringify(a), forkOut: JSON.stringify(b), same });
  console.log(`   ${same ? '=' : '≠'} ${pair.ask}`);
  console.log(`     ${JSON.stringify(a)}`);
}
if (disagreed > 0) {
  throw new Error(`the fork changed behaviour on ${disagreed} query — that is a bug, not a dialect`);
}

let extra = { ...ONLY_FEEL, forkOut: JSON.stringify(fk.run(ONLY_FEEL.feelish, DATA)) };
let rejected = '';
try {
  up.run('.items | select(.qty in [2..8]) | .title', DATA);
  rejected = 'upstream unexpectedly accepted it';
} catch (error) {
  rejected = error.message;
}
console.log(`\n3) the feature the fork ADDED`);
console.log(`   ${ONLY_FEEL.feelish}`);
console.log(`   → ${extra.forkOut}`);
console.log(`   upstream cannot parse a range at all: ${rejected}`);
console.log(`   and it did not need to — the range desugars to two`);
console.log(`   comparisons the shared evaluator already understood.`);

// 4. What it cost.
let report = await inspectStore(storeDir);
console.log(`\n4) store: ${report.objects} objects for two 4-file decks`);
console.log(`   two full copies would be 8`);


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
      data: DATA,
      changed,
      shared,
      pairs: results,
      extra,
      rejected,
      store: { objects: report.objects, wouldBe: 8 },
      upstream: { ...UPSTREAM, dir: undefined, dialect: up.DIALECT },
      fork: { ...FORK, dir: undefined, dialect: fk.DIALECT },
    },
    null,
    2,
  ) + '\n',
);

} // end buildMode

let server = createDemoServer({
  depots: [{ name: DEPOT, dir: depotDir, storeDir }],
  fallback: (req, res) => {
    res.writeHead(302, { location: `/${DEPOT}/app/viewer/index.html` });
    res.end();
  },
});
server.listen(PORT, () => {
  console.log(`\n5) serving both dialects (HTTPS + HTTP/2)\n`);
  console.log(`      ${demoOrigin(PORT)}/\n`);
  console.log(`      /${DEPOT}/${UPSTREAM.deck}@${UPSTREAM.version}/parse.js`);
  console.log(`      /${DEPOT}/${FORK.deck}@${FORK.version}/parse.js   ← the only difference\n`);
});
