#!/usr/bin/env node
// Codelist — two people amend the same shared table at the same time, and
// both land.
//
// Workload W2 from docs/deck-use-cases.md, and the case where the git model
// is actively wrong: a codelist is a *set of keys*, so two people adding
// different keys are not in conflict however close together the lines sit.
// Line-merging invents a conflict; key-merging sees there was never one.
//
// Everything here is AT REST. No write endpoint, no login, no merge button:
// every state below is a sealed version at its own immutable URL, and the
// merge already happened when it was sealed. You are looking at the before
// and the after, both addressable, forever.
//
//   pnpm --filter @cardstack/deck-example-codelist demo
//   open https://localhost:8790/
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeTrees } from '@cardstack/deck/merge';
import { pack } from '@cardstack/deck/pack';
import { publishToStore } from '@cardstack/deck/store';
import { storeDirFor } from '@cardstack/deck-server/depot';
import { createDemoServer, demoOrigin } from '../shared/depot.mjs';
import { demoBuildMode } from '../shared/reset.mjs';
import { lockAndWrite, publishShared } from '../shared/publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8790);
const DEPOT = 'site';
const depotDir = join(here, 'depot');
const storeDir = storeDirFor(depotDir);

// A real ISO-4217 slice, small enough to read on one screen. The shape is
// the point, not the size — the live lists run to a few hundred keys.
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

const ANA = { XCD: { name: 'East Caribbean Dollar', minor: 2 }, SRD: { name: 'Surinam Dollar', minor: 2 } };
const KIM = { ZWG: { name: 'Zimbabwe Gold', minor: 2 } };
const INTERNAL = {
  XAC: { name: 'Acme Credits (internal)', minor: 0 },
  XPT: { name: 'Acme Points (internal)', minor: 0 },
  XVC: { name: 'Acme Vouchers (internal)', minor: 2 },
};

// Sorted keys: two people adding different codes must produce the same
// bytes whoever seals first. Key order is not information, and letting it
// vary would manufacture diffs that mean nothing.
function sortKeys(codes) {
  return Object.fromEntries(Object.entries(codes).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function tree(pkg, version, codes, note) {
  return new Map([
    [
      'importmap.json',
      Buffer.from(
        JSON.stringify(
          { deck: { packages: { [pkg]: { version, entry: '$DECK/index.js' } } } },
          null,
          2,
        ) + '\n',
        'utf8',
      ),
    ],
    ['currencies.json', Buffer.from(JSON.stringify(sortKeys(codes), null, 2) + '\n', 'utf8')],
    [
      'index.js',
      Buffer.from(
        `// ${note}\nexport async function currencies(base = import.meta.url) {\n  return (await fetch(new URL('./currencies.json', base))).json();\n}\n`,
        'utf8',
      ),
    ],
  ]);
}

// `latest` may only name a STABLE release (L5) — the store refuses to point
// it at a prerelease, so the fork's `-acme.N` line gets its own dist-tag.
// That refusal is the law working: a range must never drift into a
// prerelease, and `latest` must never be the thing that drags it there.
async function seal(name, version, files, tag) {
  let { treeHash } = await publishToStore(
    storeDir,
    name,
    version,
    pack([...files.entries()].map(([path, bytes]) => ({ path, bytes }))),
    { tag },
  );
  return treeHash;
}

const codesIn = (files) => JSON.parse(files.get('currencies.json').toString('utf8'));
const countIn = (files) => Object.keys(codesIn(files)).length;


const buildMode = await demoBuildMode({
  storeDir,
  probe: { name: 'std/currencies', version: '1.4.0' },
  label: 'CODELIST',
});
if (buildMode === 'rebuild') {
  await rm(storeDir, { recursive: true, force: true });
  console.log('   RESET=1 — wiped .deck/store; Notes and Claims kept');
}
await mkdir(storeDir, { recursive: true });

if (buildMode !== 'serve') {

console.log('\n  CODELIST — the merge that is not a conflict\n');

// 1. The shared list everyone consumes.
let base = tree('currencies', '1.4.0', BASE_CODES, 'the shared list');
let baseHash = await seal('std/currencies', '1.4.0', base, 'latest');
console.log(`1) std/currencies@1.4.0 — ${countIn(base)} keys · ${baseHash.slice(0, 12)}…`);

// 2. Two amendments, made concurrently, neither aware of the other.
let ana = tree('currencies', '1.4.0', { ...BASE_CODES, ...ANA }, 'the shared list');
let kim = tree('currencies', '1.4.0', { ...BASE_CODES, ...KIM }, 'the shared list');
console.log(`\n2) two concurrent amendments against 1.4.0`);
console.log(`     ana  + ${Object.keys(ANA).join(', ')}`);
console.log(`     kim  + ${Object.keys(KIM).join(', ')}`);

// 3. Key-level merge: different keys are a COMBINATION, not a conflict.
let merged = mergeTrees(base, ana, kim);
if (merged.conflicts.length > 0) {
  throw new Error(`demo is wrong — unexpected conflicts: ${merged.conflicts.join(', ')}`);
}
let next = tree('currencies', '1.5.0', codesIn(merged.files), 'the shared list');
let nextHash = await seal('std/currencies', '1.5.0', next, 'latest');
console.log(`\n3) merged → ${countIn(next)} keys, ${merged.conflicts.length} conflicts`);
console.log(`   std/currencies@1.5.0 · ${nextHash.slice(0, 12)}…`);
console.log(`   both amendments landed and nobody resolved anything`);

// 4. A fork carrying three internal codes.
let fork = tree('currencies', '1.4.0-acme.1', { ...BASE_CODES, ...INTERNAL }, 'acme fork of std/currencies');
let forkHash = await seal('acme/currencies', '1.4.0-acme.1', fork, 'acme');
console.log(`\n4) acme/currencies@1.4.0-acme.1 — fork of 1.4.0, +3 internal codes · ${forkHash.slice(0, 12)}…`);

// 5. The rebase. base = what the fork forked from, ours = the fork,
//    theirs = where upstream went.
//
// This one reports a conflict, and it is the interesting part of the demo.
// The DATA merges perfectly — 10 base + 3 upstream + 3 internal, nobody
// touched the same key. What collides is `importmap.json`, because both
// sides edited one key in it: the fork called itself `1.4.0-acme.1` and
// upstream called itself `1.5.0`.
//
// That is the correct answer. A machine can combine two sets of currency
// codes because "both" is well defined. It cannot decide what to NAME the
// combination, because that is a judgement about compatibility — and the
// merge is honest enough to say so instead of picking one.
let rebased = mergeTrees(base, fork, next);
let dataOnly = rebased.conflicts.filter((p) => p !== 'importmap.json');
if (dataOnly.length > 0) {
  throw new Error(`demo is wrong — the DATA conflicted: ${dataOnly.join(', ')}`);
}
let absorbed = tree('currencies', '1.5.0-acme.1', codesIn(rebased.files), 'acme fork of std/currencies');
let absorbedHash = await seal('acme/currencies', '1.5.0-acme.1', absorbed, 'acme');
console.log(`\n5) rebased onto 1.5.0 → ${countIn(absorbed)} keys`);
console.log(`   data conflicts:     ${dataOnly.length}   ← upstream's 3 absorbed, acme's 3 intact`);
console.log(`   manifest conflicts: ${rebased.conflicts.length}   ← ${rebased.conflicts.join(', ') || 'none'}`);
console.log(`   both sides renamed the version, so a person picks 1.5.0-acme.1.`);
console.log(`   The machine merged everything it could actually know.`);
console.log(`   acme/currencies@1.5.0-acme.1 · ${absorbedHash.slice(0, 12)}…`);


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

// 6. Hand the viewer the four addresses. It fetches them like any consumer.
let states = [
  { deck: 'std/currencies', version: '1.4.0', label: 'the shared list', hash: baseHash, note: 'what everyone was consuming' },
  { deck: 'std/currencies', version: '1.5.0', label: 'after both amendments', hash: nextHash, note: `ana added ${Object.keys(ANA).join(' + ')}, kim added ${Object.keys(KIM).join('')} — 0 conflicts` },
  { deck: 'acme/currencies', version: '1.4.0-acme.1', label: 'a fork, before upstream moved', hash: forkHash, note: '3 internal codes on top of 1.4.0' },
  { deck: 'acme/currencies', version: '1.5.0-acme.1', label: 'the fork, rebased', hash: absorbedHash, note: 'absorbed upstream automatically, kept its own — only the version number needed a person' },
];
await writeFile(
  join(depotDir, 'app', 'viewer', 'states.json'),
  JSON.stringify({ depot: DEPOT, states }, null, 2) + '\n',
);

} // end buildMode

let server = createDemoServer({
  depots: [{ name: DEPOT, dir: depotDir, storeDir }],
  fallback: (req, res) => {
    res.writeHead(302, { location: `/${DEPOT}/app/viewer/index.html` });
    res.end();
  },
});
server.listen(PORT, async () => {
  console.log(`\n6) serving — every state above is an immutable URL (HTTPS + HTTP/2)\n`);
  console.log(`      ${demoOrigin(PORT)}/\n`);
  try {
    let saved = JSON.parse(
      await readFile(join(depotDir, 'app', 'viewer', 'states.json'), 'utf8'),
    );
    for (let s of saved.states ?? []) {
      console.log(`      /${DEPOT}/${s.deck}@${s.version}/currencies.json`);
    }
  } catch {
    console.log(`      /${DEPOT}/app/viewer/index.html`);
  }
  console.log(`\n   No login and no write endpoint anywhere in this demo. The`);
  console.log(`   merge happened at seal time; these are the before and after.\n`);
});
