#!/usr/bin/env node
// Two agents, one depot — and the two kinds of "at the same time".
//
// The first kind is not a merge problem at all. Agent A owns `ui/table`,
// agent B owns `charts/spark`. They edit simultaneously, the watcher publishes
// and seals each save under its own name, and there is nothing to reconcile
// because they never wrote to the same thing. One deck per component is what
// makes eight agents on one tree an ordinary Tuesday.
//
// The second kind is real. They share `std/tokens`, and eventually both change
// the same key. Deck's generic merge refuses that — correctly, because it does
// not know what the key means. So this demo adds the layer above it:
//
//     merge-policy.json, published by upstream, says HOW each key merges.
//     resolve.mjs reads those rules and resolves what they cover.
//     A key with no rule is not guessed: nothing is written at all.
//
// The result is a resolution that is a pure function of three values and a
// published rule. Same inputs, same output, on any machine — which is what
// makes it something a daemon may run unattended.
//
//   pnpm --filter @cardstack/deck-example-two-agents demo
//   open http://localhost:8795/
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forkDeck } from '@cardstack/deck/fork';
import { discoverOffers, planRebase } from '@cardstack/deck/offer';
import { pack } from '@cardstack/deck/pack';
import { publishToStore } from '@cardstack/deck/store';
import { readTreeFromDir } from '@cardstack/deck/tree';
import { treeHashFromDir } from '@cardstack/deck/tree-hash';
import { storeDirFor, watchDepot } from '@cardstack/deck-server/depot';
import { rebasePass } from '@cardstack/deck-tools/rebase-daemon';
import {
  createDemoServer,
  demoOrigin,
  liveNotes,
  openDemoDepot,
  serveLive,
} from '../shared/depot.mjs';
import { publishShared, lockAndWrite } from '../shared/publish.mjs';
import { demoBuildMode, resetDemoDepot, ensurePristine, wantDemoReset } from '../shared/reset.mjs';
import { RULES, mergeWithPolicy, resolveByPolicy } from './resolve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8795);
const DEPOT = 'site';
const depotDir = join(here, 'depot');
const storeDir = storeDirFor(depotDir);
const UPSTREAM = 'std/tokens';

const fail = (message) => {
  throw new Error(message);
};
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const tokensOf = (publisher) =>
  readJson(join(depotDir, publisher, 'tokens', 'tokens.json'));

// ---------------------------------------------------------------------------
// The shared deck. `scale` is a SET — two people extending it are agreeing.
// `radius` is a scalar with a house rule. `name` has no rule at all, and that
// is deliberate: it is how the demo shows what refusing looks like.
// ---------------------------------------------------------------------------
const TOKENS = {
  '1.0.0': {
    name: 'Base',
    radius: 4,
    scale: [4, 8, 16, 24],
    color: { ink: '#272330', surface: '#ffffff' },
  },
};
const POLICY = {
  $comment:
    'How to resolve a key both sides changed. Upstream owns these rules, so a proposal cannot grant itself the right to win. A key absent here is a key a person decides.',
  rules: { scale: 'union', radius: 'max' },
};

function upstreamTree(version, tokens) {
  return [
    {
      path: 'package.json',
      bytes: Buffer.from(
        json({
          name: 'tokens',
          version,
          type: 'module',
          exports: { '.': './index.js' },
        }),
        'utf8',
      ),
    },
    { path: 'tokens.json', bytes: Buffer.from(json(tokens), 'utf8') },
    { path: 'merge-policy.json', bytes: Buffer.from(json(POLICY), 'utf8') },
    {
      path: 'index.js',
      bytes: Buffer.from(
        `export const source = import.meta.url;\nexport const tokens = async () =>\n  (await fetch(new URL('./tokens.json', import.meta.url))).json();\n`,
        'utf8',
      ),
    },
  ];
}

async function publishUpstream(version, tokens) {
  let record = await publishToStore(
    storeDir,
    UPSTREAM,
    version,
    pack(upstreamTree(version, tokens)),
    { tag: 'latest' },
  );
  return record;
}

async function amend(publisher, change) {
  let path = join(depotDir, publisher, 'tokens', 'tokens.json');
  await writeFile(path, json({ ...JSON.parse(await readFile(path, 'utf8')), ...change }));
}

async function queue(label, { dryRun = true } = {}) {
  let result = await rebasePass({ depot, dryRun });
  console.log(`\n   ${label}`);
  for (let outcome of result.outcomes.sort((a, b) => a.offer.localeCompare(b.offer))) {
    let extra = outcome.conflicts.length > 0 ? `  ← ${outcome.conflicts.join(', ')}` : '';
    console.log(
      `     ${outcome.offer.padEnd(16)} ${outcome.state.padEnd(12)} ${outcome.upstreamVersion ?? ''}${extra}${outcome.applied ? '  (written)' : ''}`,
    );
  }
  return result;
}

// Run N+1 has to print what run 1 printed, so the demo starts from a fixed
// state rather than from wherever the last run left off. Two kinds of thing
// need putting back: the fork scopes `deck fork` WRITES (deleted whole, and
// gitignored), and the two component files the agents EDIT in place.
//
// Those two are checked in holding the state the demo ENDS at, and the reset
// rewinds them to the state it starts at. That way a finished run leaves the
// working tree clean, which is the only version of "re-runnable" that does
// not slowly fill somebody's `git status` with demo output.
//
// See ../shared/reset.mjs for why a reset is a demo-only idea.
const AGENT_A_BEFORE = `// Agent A's deck. Nobody else edits this file, so nobody else can collide
// with it — which is the whole point of one deck per component.
export function table(rows) {
  return \`<table>\${rows
    .map((row) => \`<tr><td>\${row.label}</td><td>\${row.value}</td></tr>\`)
    .join('')}</table>\`;
}
`;
const AGENT_A_AFTER = AGENT_A_BEFORE.replace(
  '<td>${row.value}</td>',
  '<td class="v">${row.value}</td>',
);
const AGENT_B_BEFORE = `// Agent B's deck. Same instant, same depot, same server — different files.
export function spark(values, stroke = '#0c9d7c') {
  let max = Math.max(...values, 1);
  let points = values
    .map((v, i) => \`\${(i / (values.length - 1)) * 100},\${30 - (v / max) * 28}\`)
    .join(' ');
  return \`<svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="\${points}" fill="none" stroke="\${stroke}" stroke-width="2" /></svg>\`;
}
`;
const AGENT_B_AFTER = AGENT_B_BEFORE.replace(
  'stroke-width="2"',
  'stroke-width="2" stroke-linecap="round"',
);

const buildMode = await demoBuildMode({
  storeDir,
  probe: { name: 'std/tokens', version: '1.0.0' },
  label: 'TWO AGENTS',
});
if (buildMode === 'rebuild') {
  await resetDemoDepot({
    depotDir,
    output: ['agent-a', 'agent-b'],
    pristine: {
      'ui/table/table.js': AGENT_A_BEFORE,
      'charts/spark/spark.js': AGENT_B_BEFORE,
    },
  });
} else if (buildMode === 'seed') {
  await ensurePristine(depotDir, {
    'ui/table/table.js': AGENT_A_BEFORE,
    'charts/spark/spark.js': AGENT_B_BEFORE,
  });
}

let decisionsBody = Buffer.from('[]', 'utf8');
let depot;

if (buildMode === 'serve') {
  depot = await openDemoDepot({ name: DEPOT, dir: depotDir });
} else {

console.log('\n  TWO AGENTS — separate decks never collide; the shared one does\n');

// Tier 2, for real. Two people are editing at once, so "what did the tree
// look like when it published that" has to have an answer — and the answer
// is a seal per save, not per publish. Without jj or historyd on the machine
// this degrades to Versions only and says so; nothing else in the demo changes.
depot = await openDemoDepot({ name: DEPOT, dir: depotDir });

let base = await publishUpstream('1.0.0', TOKENS['1.0.0']);
console.log(`0) ${UPSTREAM}@1.0.0 · ${base.treeHash.slice(0, 12)}…`);
console.log(`   merge-policy.json declares: ${JSON.stringify(POLICY.rules)}`);
let [pills] = await publishShared(storeDir);
console.log(`   shared: ${pills.name}@${pills.version} · ${pills.treeHash.slice(0, 12)}…`);

// ---------------------------------------------------------------------------
// 1. Two agents editing at the same instant, on decks that are not shared.
//    The watcher is running, so nothing here is published by hand.
// ---------------------------------------------------------------------------
console.log('\n1) both agents edit, simultaneously, on their OWN decks');
let published = [];
let watcher = watchDepot({
  depot,
  onPublish: (event) => published.push(event),
  onError: (error) => console.error(`   watch: ${error}`),
});
await watcher.rescan();

const settle = async (predicate, what) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`timed out waiting for ${what}`);
};

// Interleaved on purpose: A writes, B writes before A's debounce has expired.
await writeFile(join(depotDir, 'ui', 'table', 'table.js'), AGENT_A_AFTER);
await writeFile(join(depotDir, 'charts', 'spark', 'spark.js'), AGENT_B_AFTER);
await settle(
  () =>
    published.some((event) => event.name === 'ui/table') &&
    published.some((event) => event.name === 'charts/spark'),
  'both component decks to auto-publish',
);
watcher.close();
for (let event of published.filter((e) => e.name !== 'app/board')) {
  console.log(
    `   auto-published ${event.name}@${event.version} (${event.treeHash.slice(0, 12)})${event.sealChangeId ? ` sealed ${event.sealChangeId.slice(0, 12)}` : ''}`,
  );
}
console.log('   two saves, two version lines, zero merges — different decks.');

// ---------------------------------------------------------------------------
// 2. The thing they share. Both fork it and amend, concurrently.
// ---------------------------------------------------------------------------
console.log(`\n2) both fork ${UPSTREAM}@1.0.0 and amend it, unaware of each other`);
for (let [publisher, change] of [
  ['agent-a', { color: { ...TOKENS['1.0.0'].color, accent: '#0c9d7c' } }],
  ['agent-b', { color: { ...TOKENS['1.0.0'].color, warning: '#d97706' } }],
]) {
  let fork = await forkDeck({
    depotDir,
    storeDir,
    from: { publisher: 'std', package: 'tokens', spec: '1.0.0' },
    to: { publisher, package: 'tokens' },
    actor: publisher,
  });
  await amend(publisher, change);
  console.log(`   ${fork.to.padEnd(16)} + color.${Object.keys(change.color).at(-1)}`);
}
console.log(`   both record forkedFrom.treeHash ${base.treeHash.slice(0, 12)}… — the exact merge base`);
console.log(`   offers discovered: ${(await discoverOffers(depotDir)).map((o) => o.name).join(', ')}`);

// ---------------------------------------------------------------------------
// 3. Round one: upstream moves, and neither collides with it.
// ---------------------------------------------------------------------------
let v11 = await publishUpstream('1.1.0', {
  ...TOKENS['1.0.0'],
  color: { ...TOKENS['1.0.0'].color, muted: '#8b8b93' },
});
console.log(`\n3) ${UPSTREAM}@1.1.0 · ${v11.treeHash.slice(0, 12)}…  + color.muted`);
let round1 = await queue('three different keys under one object — no conflict:', {
  dryRun: false,
});
if (round1.conflicted !== 0) {
  fail(`round one should be clean, got ${round1.conflicted} conflicted`);
}
let a1 = await tokensOf('agent-a');
let b1 = await tokensOf('agent-b');
if (!a1.color.muted || !a1.color.accent || !b1.color.muted || !b1.color.warning) {
  fail(`each fork should hold upstream's key and its own: ${json({ a1, b1 })}`);
}
console.log(`   agent-a: ${Object.keys(a1.color).join(', ')}`);
console.log(`   agent-b: ${Object.keys(b1.color).join(', ')}`);
console.log('   both kept their own key AND absorbed upstream\'s. Nobody reviewed anything.');

// ---------------------------------------------------------------------------
// 4. Round two: a real disagreement — the same two keys, two answers.
// ---------------------------------------------------------------------------
console.log('\n4) now a real collision');
await amend('agent-a', { radius: 12, scale: [4, 8, 16, 24, 48] });
let v12 = await publishUpstream('1.2.0', {
  ...TOKENS['1.0.0'],
  radius: 8,
  scale: [4, 8, 16, 24, 40],
  color: { ...TOKENS['1.0.0'].color, muted: '#8b8b93' },
});
console.log(`   agent-a  radius 4 → 12,  scale + 48`);
console.log(`   upstream radius 4 → 8,   scale + 40      (${UPSTREAM}@1.2.0 · ${v12.treeHash.slice(0, 12)}…)`);

let beforeHash = (await treeHashFromDir(join(depotDir, 'agent-a', 'tokens'))).treeHash;
let round2 = await queue('the generic merge refuses, and writes nothing:', { dryRun: false });
let conflicted = round2.outcomes.filter((o) => o.state === 'conflicted');
if (conflicted.length !== 1 || conflicted[0].offer !== 'agent-a/tokens') {
  fail(`expected exactly agent-a/tokens to conflict, got ${json(round2.outcomes.map((o) => [o.offer, o.state]))}`);
}
let afterHash = (await treeHashFromDir(join(depotDir, 'agent-a', 'tokens'))).treeHash;
if (afterHash !== beforeHash) {
  fail('a conflicted pass modified the fork — it must write nothing');
}
console.log(`   agent-a's tree: ${beforeHash.slice(0, 12)}… before, ${afterHash.slice(0, 12)}… after — byte for byte`);

// ---------------------------------------------------------------------------
// 5. The policy layer. Deterministic, auditable, and fail-closed.
// ---------------------------------------------------------------------------
console.log('\n5) resolve it by published policy');
let offer = (await discoverOffers(depotDir)).find((o) => o.name === 'agent-a/tokens');
let plan = await planRebase({ depotDir, storeDir, offer });

// Run it dry, twice, and require identical decisions. A resolver whose
// output depends on when you ran it is not a resolver.
let dryA = await resolveByPolicy({ storeDir, plan, dryRun: true });
let dryB = await resolveByPolicy({ storeDir, plan, dryRun: true });
if (JSON.stringify(dryA.decisions) !== JSON.stringify(dryB.decisions)) {
  fail('two dry runs disagreed — the resolver is not deterministic');
}
// And require the commutative rules to actually commute: swapping which side
// is called "upstream" must not change the answer.
for (let [rule, x, y] of [
  ['union', [4, 48], [4, 40]],
  ['max', 12, 8],
  ['min', 12, 8],
]) {
  if (JSON.stringify(RULES[rule](null, x, y)) !== JSON.stringify(RULES[rule](null, y, x))) {
    fail(`rule "${rule}" is order-dependent`);
  }
}

let resolution = await resolveByPolicy({ storeDir, plan });
if (resolution.state !== 'resolved') {
  fail(`expected a resolution, got ${resolution.state}: ${json(resolution.unresolved)}`);
}
for (let decision of resolution.decisions) {
  console.log(
    `   ${decision.key.padEnd(8)} base ${JSON.stringify(decision.base)}  upstream ${JSON.stringify(decision.upstream)}  fork ${JSON.stringify(decision.fork)}` +
      `\n            → rule "${decision.rule}" → ${JSON.stringify(decision.resolved)}`,
  );
}
let resolved = await tokensOf('agent-a');
if (resolved.radius !== 12) fail(`radius should be max(8,12)=12, got ${resolved.radius}`);
if (JSON.stringify(resolved.scale) !== JSON.stringify([4, 8, 16, 24, 40, 48])) {
  fail(`scale should be the sorted union, got ${json(resolved.scale)}`);
}
console.log('   both intentions survived: 48 is agent-a\'s, 40 is upstream\'s, and radius went to the rule.');

let settled = await queue('and the queue is quiet again:', { dryRun: false });
if (settled.outcomes.some((o) => o.state !== 'current')) {
  fail(`the queue should be current after resolution: ${json(settled.outcomes.map((o) => [o.offer, o.state]))}`);
}

// ---------------------------------------------------------------------------
// 6. The coda: a key no rule covers. This is the important half.
// ---------------------------------------------------------------------------
console.log('\n6) a key nothing covers');
await amend('agent-a', { name: 'Aurora' });
// Built from upstream's OWN 1.2.0, not from the fork's resolved tree — the
// panel comparing the three is only worth looking at if upstream and the
// fork are genuinely different trees.
let v13 = await publishUpstream('1.3.0', {
  ...TOKENS['1.0.0'],
  name: 'Nova',
  radius: 8,
  scale: [4, 8, 16, 24, 40],
  color: { ...TOKENS['1.0.0'].color, muted: '#8b8b93' },
});
console.log(`   agent-a  name → "Aurora"`);
console.log(`   upstream name → "Nova"                    (${UPSTREAM}@1.3.0 · ${v13.treeHash.slice(0, 12)}…)`);
await queue('conflicted, as it should be:', { dryRun: true });

let stuckBefore = (await treeHashFromDir(join(depotDir, 'agent-a', 'tokens'))).treeHash;
let stuck = await resolveByPolicy({
  storeDir,
  plan: await planRebase({
    depotDir,
    storeDir,
    offer: (await discoverOffers(depotDir)).find((o) => o.name === 'agent-a/tokens'),
  }),
});
if (stuck.state !== 'undecidable') {
  fail(`a key with no rule must not be guessed, got ${stuck.state}`);
}
let stuckAfter = (await treeHashFromDir(join(depotDir, 'agent-a', 'tokens'))).treeHash;
if (stuckAfter !== stuckBefore) {
  fail('the resolver wrote something despite refusing — it must be all or nothing');
}
for (let item of stuck.unresolved) {
  console.log(`   REFUSED  ${item.file} ${item.key}: ${item.reason}`);
}
console.log('   nothing written. One person decides one key, instead of three.');

// A sanity check the whole demo rests on: `mergeWithPolicy` is the only place
// a decision is made, and with no rules it decides nothing.
let bare = mergeWithPolicy(1, 2, 3, {});
if (bare.decisions.length !== 0 || bare.unresolved.length !== 1) {
  fail('with no rules, the merge must resolve nothing and say so');
}

// ---------------------------------------------------------------------------
// 7. Serve it.
// ---------------------------------------------------------------------------
let appDir = join(depotDir, 'app', 'board');
let locked = await lockAndWrite({ depotDir, depotName: DEPOT, storeDir });
let appFiles = await readTreeFromDir(appDir);
await publishToStore(
  storeDir,
  'app/board',
  '1.0.0',
  pack([...appFiles.entries()].map(([path, bytes]) => ({ path, bytes }))),
  { tag: 'latest' },
);

decisionsBody = Buffer.from(json(resolution.decisions), 'utf8');
} // end buildMode

let server = createDemoServer({
  depots: [depot],
  fallback: (request, response) => {
    if (request.url?.startsWith('/decisions.json')) {
      response.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(decisionsBody);
      return;
    }
    response.writeHead(302, { location: `/${DEPOT}/app/board/index.html` });
    response.end();
  },
});

// The live loop stays on while the server runs: the two forks are working
// trees, not snapshots, so editing depot/agent-a/tokens/tokens.json is a
// third agent joining — and it publishes and seals like the other two.
serveLive({ depot, server });

let origin = demoOrigin(PORT);
server.listen(PORT, async () => {
  console.log(`\n7) serving (HTTPS + HTTP/2)\n`);
  console.log(`      ${origin}/`);
  console.log(`      /${DEPOT}/_offers                          the queue`);
  console.log(`      /${DEPOT}/agent-a/tokens/tokens.json       agent A, live`);
  console.log(`      /${DEPOT}/agent-b/tokens/tokens.json       agent B, live`);
  console.log(`      /${DEPOT}/${UPSTREAM}@1.3.0/merge-policy.json   the rules, sealed\n`);
  console.log(liveNotes({ depot, port: PORT, origin }));
  console.log(`\n   Edit depot/agent-a/tokens/tokens.json and reload — you are`);
  console.log(`   the third agent, and your save is sealed like theirs.\n`);
});
