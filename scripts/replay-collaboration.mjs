#!/usr/bin/env node

// Rebuild the collaboration depot by replaying public Deck operations.
//
// This is intentionally closer to a database seed/DML script than a checked-in
// snapshot. The source scenarios are inputs; .store, .deck, History, branches,
// Checkpoints, Reviews, and merge facts are all outputs of the real APIs.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRestore } from '../packages/history/src/backend.ts';
import { HistorydHistory } from '../packages/history/src/historyd.ts';
import {
  canonicalJson,
  hashProtocolObject,
} from '../packages/core/src/repository.ts';
import {
  readBranchHead,
  readCheckpoint,
  readRepository,
  readRepositoryLock,
} from '../packages/core/src/repository-store.ts';
import {
  appendReviewEvent,
  previewReview,
  readReview,
} from '../packages/core/src/review-store.ts';
import { readStoreMeta } from '../packages/core/src/store.ts';
import { createRepositoryService } from '../apps/hub/repository-service.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exampleDir = join(root, 'examples', 'collaboration');
const scenarioDir = join(exampleDir, 'scenario');
const depotDir = join(exampleDir, 'depot');
const baseDir = join(scenarioDir, 'base');
const anaCustomerImpact = join(
  scenarioDir,
  'changes',
  'ana',
  'customer-impact',
);
const anaSlaPresentation = join(
  scenarioDir,
  'changes',
  'ana',
  'sla-presentation',
);
const kimCarrierRouting = join(
  scenarioDir,
  'changes',
  'kim',
  'carrier-routing',
);
const vendorSourceDir = join(scenarioDir, 'vendor', 'impact-score');
const cli = join(root, 'packages', 'cli', 'bin', 'deck.js');
const deckdUrl = (process.env.DECKD_URL ?? 'http://127.0.0.1:8787').replace(
  /\/$/,
  '',
);
const vendorPort = 8793;
const repository = 'acme/dashboard';
const repositoryRRI = '@acme/dashboard/';
const startedAt = performance.now();

function check(condition, message) {
  if (!condition) throw new Error(`replay assertion failed: ${message}`);
}

function say(message) {
  process.stdout.write(`${message}\n`);
}

async function copyTree(source, destination = depotDir) {
  await cp(source, destination, { recursive: true, force: true });
}

async function copyScenarioFile(path) {
  let source = join(kimCarrierRouting, path);
  let destination = join(depotDir, path);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
}

async function runDeck(actor, ...args) {
  say(`  deck ${args.join(' ')}`);
  await new Promise((resolvePromise, reject) => {
    let child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, DECKD_URL: deckdUrl, DECK_ACTOR: actor },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`deck ${args[0]} exited ${signal ?? code}`));
    });
  });
}

async function assertDeckd() {
  let response = await fetch(`${deckdUrl}/health`);
  if (!response.ok) throw new Error(`deckd is not healthy at ${deckdUrl}`);
}

async function assertHubStopped() {
  try {
    let response = await fetch('http://127.0.0.1:8788/', {
      signal: AbortSignal.timeout(150),
    });
    if (response.ok || response.status) {
      throw new Error(
        'stop Deck Hub before replaying collaboration state (port 8788 is active)',
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('stop Deck Hub'))
      throw error;
  }
}

async function writeIndexGeneration(historyHead, label) {
  let manifest = {
    schema: 'deck-file-index-generation-v1',
    repository: repositoryRRI,
    historyHead,
    label,
  };
  let hash = hashProtocolObject(manifest);
  let path = join(
    depotDir,
    '.deck',
    'indexes',
    hash.slice(0, 2),
    hash,
    'manifest.json',
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalJson(manifest));
  return hash;
}

async function settle(history, message, actor) {
  let historyHead =
    (await history.seal(depotDir, message, { name: actor })) ??
    (await history.head(depotDir));
  if (!historyHead)
    throw new Error(`deckd produced no History revision for ${message}`);
  return {
    historyHead,
    indexGenerationHash: await writeIndexGeneration(historyHead, message),
  };
}

async function startVendorOrigin() {
  let server = createServer(async (request, response) => {
    let name = new URL(
      request.url ?? '/',
      `http://${request.headers.host}`,
    ).pathname.slice(1);
    if (!['impact-score.js', 'weights.js'].includes(name)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.setHeader('content-type', 'text/javascript; charset=utf-8');
    response.end(await readFile(join(vendorSourceDir, name)));
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(vendorPort, '127.0.0.1', resolvePromise);
  });
  return server;
}

async function stopServer(server) {
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
}

async function approve(number, branch, actor) {
  let head = await readBranchHead(depotDir, branch);
  check(
    head?.latestCheckpointHash,
    `${branch} must have a Checkpoint before approval`,
  );
  await appendReviewEvent({
    realmDir: depotDir,
    number,
    type: 'reviewed',
    actor: { id: `@${actor.toLowerCase()}:acme.test`, name: actor },
    createdAt: new Date().toISOString(),
    checkpointHash: head.latestCheckpointHash,
    verdict: 'approved',
  });
}

async function readHubState(service) {
  let status;
  let bytes;
  let response = {
    writeHead(nextStatus) {
      status = nextStatus;
    },
    end(value) {
      bytes = Buffer.from(value);
    },
  };
  let handled = await service.handle(
    { method: 'GET' },
    response,
    '/_hub/repositories/collaboration/acme/dashboard',
  );
  check(handled, 'Hub service handles the Repository state route');
  check(status === 200, `Hub Repository state answers 200, not ${status}`);
  return JSON.parse(bytes.toString('utf8'));
}

async function main() {
  check(
    depotDir.endsWith('/examples/collaboration/depot'),
    'refusing to reset an unexpected path',
  );
  await assertDeckd();
  await assertHubStopped();

  say('replay collaboration — reset generated realm');
  await rm(depotDir, { recursive: true, force: true });
  await mkdir(depotDir, { recursive: true });
  await copyTree(baseDir);

  let history = new HistorydHistory({ baseUrl: deckdUrl, debounceMs: 0 });
  try {
    say('01  initialize the canonical multi-package Repository');
    let baseline = await settle(
      history,
      'Start fulfillment control',
      'Release Bot',
    );
    await runDeck(
      'Release Bot',
      'repo-init',
      '--depot',
      depotDir,
      '--owner',
      'acme',
      '--name',
      'dashboard',
      '--root',
      'app/dashboard',
      '--member',
      'app/dashboard',
      '--member',
      'acme/editor',
      '--member',
      'acme/theme',
      '--history',
      baseline.historyHead,
      '--index',
      baseline.indexGenerationHash,
      '--message',
      'Initialize fulfillment control',
    );

    say('02  Ana branches, vendors an approved module graph, and saves twice');
    await runDeck(
      'Ana',
      'branch',
      '--depot',
      depotDir,
      '--repo',
      repository,
      '--name',
      'ana/customer-impact',
      '--from',
      'main',
    );
    let vendorOrigin = await startVendorOrigin();
    try {
      await runDeck(
        'Supply Chain Bot',
        'vendor',
        `http://127.0.0.1:${vendorPort}/impact-score.js`,
        '--name',
        'impact-score',
        '--version',
        '1.0.0',
        '--depot',
        depotDir,
        '--publisher',
        'vendor',
        '--tag',
        'approved',
      );
    } finally {
      await stopServer(vendorOrigin);
    }
    await copyTree(anaCustomerImpact);
    await settle(history, 'Add customer value and impact scoring', 'Ana');
    await copyTree(anaSlaPresentation);
    let ana = await settle(
      history,
      'Present SLA state across editor and theme',
      'Ana',
    );
    await runDeck(
      'Ana',
      'checkpoint',
      '--depot',
      depotDir,
      '--repo',
      repository,
      '--branch',
      'ana/customer-impact',
      '--message',
      'Rank exceptions by recoverable customer value',
      '--history',
      ana.historyHead,
      '--index',
      ana.indexGenerationHash,
    );
    await runDeck(
      'Ana',
      'review',
      '--depot',
      depotDir,
      '--repo',
      repository,
      '--source',
      'ana/customer-impact',
      '--target',
      'main',
      '--title',
      'Prioritize exceptions by customer impact',
      '--body',
      'Vendors approved impact scoring and adds customer value, SLA state, and ranked recovery work across dashboard, editor, and theme.',
    );
    await approve(1, 'ana/customer-impact', 'Kim');

    say('03  replay main, then merge Ana as one attributed History step');
    await applyRestore(history, depotDir, baseline.historyHead);
    await settle(
      history,
      'Switch authoring view back to main',
      'Deck Workspace',
    );
    await copyTree(anaCustomerImpact);
    await copyTree(anaSlaPresentation);
    let merge = await settle(
      history,
      'Merge Review #1: customer impact',
      'Merge Bot',
    );
    await runDeck(
      'Merge Bot',
      'merge',
      '--depot',
      depotDir,
      '--repo',
      repository,
      '--number',
      '1',
      '--history',
      merge.historyHead,
      '--index',
      merge.indexGenerationHash,
    );

    say('04  Kim branches from the merge, saves twice, and opens Review #2');
    await runDeck(
      'Kim',
      'branch',
      '--depot',
      depotDir,
      '--repo',
      repository,
      '--name',
      'kim/carrier-routing',
      '--from',
      'main',
    );
    await copyScenarioFile('app/dashboard/index.js');
    await settle(history, 'Attach carrier desks to delivery exceptions', 'Kim');
    await copyScenarioFile('acme/editor/index.js');
    await copyScenarioFile('acme/theme/index.js');
    await copyScenarioFile('app/dashboard/index.html');
    let kim = await settle(
      history,
      'Present carrier escalation ownership',
      'Kim',
    );
    await runDeck(
      'Kim',
      'checkpoint',
      '--depot',
      depotDir,
      '--repo',
      repository,
      '--branch',
      'kim/carrier-routing',
      '--message',
      'Route high-value exceptions to carrier owners',
      '--history',
      kim.historyHead,
      '--index',
      kim.indexGenerationHash,
    );
    await runDeck(
      'Kim',
      'review',
      '--depot',
      depotDir,
      '--repo',
      repository,
      '--source',
      'kim/carrier-routing',
      '--target',
      'main',
      '--title',
      'Route recovery work to carrier desks',
      '--body',
      'Adds carrier ownership and escalation playbooks without changing the approved vendored scoring dependency.',
    );
    await approve(2, 'kim/carrier-routing', 'Mina');

    say(
      '05  assert vendoring, revisions, Checkpoints, Review events, and merge topology',
    );
    let [
      mainHead,
      anaHead,
      kimHead,
      review1,
      review2,
      historyEntries,
      vendorMeta,
    ] = await Promise.all([
      readBranchHead(depotDir, 'main'),
      readBranchHead(depotDir, 'ana/customer-impact'),
      readBranchHead(depotDir, 'kim/carrier-routing'),
      readReview(depotDir, 1),
      readReview(depotDir, 2),
      history.list(depotDir, { flush: false }),
      readStoreMeta(join(depotDir, '.deck', 'store'), 'vendor/impact-score'),
    ]);
    check(mainHead?.latestCheckpointHash, 'main Checkpoint exists');
    check(anaHead?.latestCheckpointHash, 'Ana Checkpoint exists');
    check(kimHead?.latestCheckpointHash, 'Kim Checkpoint exists');
    check(review1?.ref.state === 'merged', 'Review #1 is merged');
    check(
      review1.events.some(
        (event) => event.type === 'reviewed' && event.verdict === 'approved',
      ),
      'Review #1 records Kim approval',
    );
    check(
      review1.events.some((event) => event.type === 'merged'),
      'Review #1 records merged event',
    );
    check(review2?.ref.state === 'open', 'Review #2 remains open');
    check(
      review2.events.some(
        (event) => event.type === 'reviewed' && event.verdict === 'approved',
      ),
      'Review #2 records Mina approval',
    );
    check(
      vendorMeta?.versions['1.0.0'],
      'vendored impact-score Version exists',
    );
    check(
      vendorMeta?.tags.approved === '1.0.0',
      'approved tag names the vendored Version',
    );
    check(
      historyEntries.length >= 7,
      'every-save History contains the replayed work',
    );

    let mergeCheckpoint = await readCheckpoint(
      depotDir,
      mainHead.latestCheckpointHash,
    );
    check(
      mergeCheckpoint?.parents.length === 2,
      'main points at a two-parent merge Checkpoint',
    );
    let mainRepository = await readRepository(
      depotDir,
      mainHead.repositoryHash,
    );
    check(mainRepository, 'main Repository object exists');
    let lock = await readRepositoryLock(depotDir, mainRepository.lockHash);
    check(
      lock?.imports?.['impact-score'] ===
        '@vendor/impact-score@1.0.0/127.0.0.1:8793/impact-score.js',
      'the Repository lock stores the vendored dependency as an exact RRI',
    );

    let baselineSource = await history.fileAt(
      depotDir,
      baseline.historyHead,
      'app/dashboard/index.js',
    );
    let kimSource = await history.fileAt(
      depotDir,
      kim.historyHead,
      'app/dashboard/index.js',
    );
    check(
      baselineSource && !baselineSource.includes('impactScore'),
      'baseline History revision is addressable',
    );
    check(
      kimSource?.includes('carrier playbooks'),
      'Kim History revision is addressable',
    );
    let openPreview = await previewReview(depotDir, 2);
    check(
      openPreview.state === 'ready',
      'Review #2 has a clean three-way preview',
    );
    check(
      openPreview.changedMembers.length === 3,
      'Review #2 changes three independently addressed packages',
    );

    let hubService = await createRepositoryService({
      depots: [
        {
          name: 'collaboration',
          dir: depotDir,
          storeDir: join(depotDir, '.deck', 'store'),
          history,
        },
      ],
      log: () => {},
    });
    let projected = await Promise.all([
      readHubState(hubService),
      readHubState(hubService),
      readHubState(hubService),
    ]);
    check(
      projected.every(
        (state) =>
          state.main?.checkpointHash === mainHead.latestCheckpointHash &&
          state.review?.number === 2 &&
          state.preview?.changedMembers?.length === 3,
      ),
      'concurrent Hub projections reuse identical immutable Versions',
    );

    await writeFile(
      join(depotDir, '.deck', 'scenario-replay-v1.json'),
      canonicalJson({
        schema: 'deck-scenario-replay-v1',
        scenario: 'collaboration',
        mergedReview: 1,
        openReview: 2,
      }),
    );

    say('');
    say(`ready in ${Math.round(performance.now() - startedAt)}ms`);
    say(
      `  main                    ${mainHead.latestCheckpointHash.slice(0, 12)}  merged Review #1`,
    );
    say(
      `  ana/customer-impact     ${anaHead.latestCheckpointHash.slice(0, 12)}  historical branch`,
    );
    say(
      `  kim/carrier-routing     ${kimHead.latestCheckpointHash.slice(0, 12)}  open Review #2`,
    );
    say(`  History revisions       ${historyEntries.length}`);
    say(
      '  vendored                 vendor/impact-score@1.0.0 (approved, 2 modules)',
    );
    say(`  generated realm         ${relative(root, depotDir)}`);
  } finally {
    history.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
