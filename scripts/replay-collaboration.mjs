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
import { watchDepot } from '../packages/server/src/depot.ts';

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
const watcherErrors = [];

function check(condition, message) {
  if (!condition) throw new Error(`replay assertion failed: ${message}`);
}

function say(message) {
  process.stdout.write(`${message}\n`);
}

async function copyTree(source, destination = depotDir) {
  await cp(source, destination, { recursive: true, force: true });
}

async function copyScenarioFile(path, sourceTree = kimCarrierRouting) {
  let source = join(sourceTree, path);
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

async function settleAndPublish(history, watcher, message, actor) {
  let result = await settle(history, message, actor);
  await watcher.settled();
  check(
    watcherErrors.length === 0,
    `auto-publisher failed: ${watcherErrors.map(String).join('; ')}`,
  );
  return result;
}

async function releaseLine(version, tag) {
  for (let [publisher, name] of [
    ['app', 'dashboard'],
    ['acme', 'editor'],
    ['acme', 'theme'],
  ]) {
    await runDeck(
      'Release Bot',
      'release',
      '--depot',
      depotDir,
      '--publisher',
      publisher,
      '--name',
      name,
      '--version',
      version,
      '--from',
      'dev',
      '--tag',
      tag,
    );
  }
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
  return reviewVerdict(number, branch, actor, 'approved');
}

async function reviewVerdict(number, branch, actor, verdict) {
  let head = await readBranchHead(depotDir, branch);
  check(
    head?.latestCheckpointHash,
    `${branch} must have a Checkpoint before a verdict`,
  );
  await appendReviewEvent({
    realmDir: depotDir,
    number,
    type: 'reviewed',
    actor: { id: `@${actor.toLowerCase()}:acme.test`, name: actor },
    createdAt: new Date().toISOString(),
    checkpointHash: head.latestCheckpointHash,
    verdict,
  });
}

async function closeReview(number, actor) {
  await appendReviewEvent({
    realmDir: depotDir,
    number,
    type: 'closed',
    actor: { id: `@${actor.toLowerCase()}:acme.test`, name: actor },
    createdAt: new Date().toISOString(),
  });
}

async function seedQueueReview({
  history,
  watcher,
  baseHistory,
  number,
  actor,
  branch,
  files,
  saveMessage,
  checkpointMessage,
  title,
  body,
  verdict,
  reviewer,
  closed,
}) {
  await applyRestore(history, depotDir, baseHistory);
  await settle(history, `Switch authoring view to ${branch}`, 'Deck Workspace');
  await runDeck(
    actor,
    'branch',
    '--depot',
    depotDir,
    '--repo',
    repository,
    '--name',
    branch,
    '--from',
    'main',
  );
  for (let path of files) await copyScenarioFile(path);
  let saved = await settleAndPublish(history, watcher, saveMessage, actor);
  await runDeck(
    actor,
    'checkpoint',
    '--depot',
    depotDir,
    '--repo',
    repository,
    '--branch',
    branch,
    '--message',
    checkpointMessage,
    '--history',
    saved.historyHead,
    '--index',
    saved.indexGenerationHash,
  );
  await runDeck(
    actor,
    'review',
    '--depot',
    depotDir,
    '--repo',
    repository,
    '--source',
    branch,
    '--target',
    'main',
    '--title',
    title,
    '--body',
    body,
  );
  if (verdict) await reviewVerdict(number, branch, reviewer, verdict);
  if (closed) await closeReview(number, actor);
  return saved;
}

async function readHubState(service, reviewNumber) {
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
    '/_hub/repositories/collaboration/acme/dashboard' +
      (reviewNumber ? `/reviews/${reviewNumber}` : ''),
  );
  check(handled, 'Hub service handles the Repository state route');
  check(
    status === 200,
    `Hub Repository state answers 200, not ${status}: ${bytes?.toString('utf8')}`,
  );
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
  let watcher;
  try {
    say('01  initialize the canonical multi-package Repository');
    let baseline = await settle(
      history,
      'Start fulfillment control',
      'Release Bot',
    );
    watcher = watchDepot({
      depot: {
        name: 'collaboration',
        dir: depotDir,
        storeDir: join(depotDir, '.deck', 'store'),
        history,
      },
      debounceMs: 50,
      onError: (error) => watcherErrors.push(error),
    });
    await watcher.settled();
    check(watcherErrors.length === 0, 'initial auto-publish succeeds');
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
    await releaseLine('1.0.0', 'lts');
    await runDeck(
      'Release Bot',
      'tag',
      '--depot',
      depotDir,
      '--publisher',
      'app',
      '--name',
      'dashboard',
      '--tag',
      'latest',
      '--version',
      '1.0.0',
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
    await settleAndPublish(
      history,
      watcher,
      'Add customer value and impact scoring',
      'Ana',
    );
    await copyTree(anaSlaPresentation);
    let ana = await settleAndPublish(
      history,
      watcher,
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
    await watcher.settled();
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
    await releaseLine('1.1.0', 'latest');

    say(
      '04  Kim branches from the merge, saves three times, and opens Review #2',
    );
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
    await copyScenarioFile('app/dashboard/package.json');
    await settleAndPublish(
      history,
      watcher,
      'Attach carrier desks to delivery exceptions',
      'Kim',
    );
    await copyScenarioFile('acme/editor/index.js');
    await copyScenarioFile('acme/editor/package.json');
    await copyScenarioFile('acme/theme/index.js');
    await copyScenarioFile('acme/theme/package.json');
    await settleAndPublish(
      history,
      watcher,
      'Add carrier-routing presentation primitives',
      'Kim',
    );
    await copyScenarioFile('app/dashboard/index.html');
    let kim = await settleAndPublish(
      history,
      watcher,
      'Turn fulfillment control into a carrier command center',
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
      '05  seed a realistic Review queue from four more independent branches',
    );
    await seedQueueReview({
      history,
      watcher,
      baseHistory: merge.historyHead,
      number: 3,
      actor: 'Lee',
      branch: 'lee/night-operations-shell',
      files: ['app/dashboard/index.html'],
      saveMessage: 'Give fulfillment control a night operations shell',
      checkpointMessage: 'Tighten the command surface for overnight dispatch',
      title: 'Give overnight dispatch a denser operations shell',
      body: 'Moves the fulfillment dashboard into a compact dark command surface while retaining the approved recovery workflow.',
    });
    await seedQueueReview({
      history,
      watcher,
      baseHistory: merge.historyHead,
      number: 4,
      actor: 'Noor',
      branch: 'noor/escalation-tokens',
      files: ['acme/theme/index.js', 'acme/theme/package.json'],
      saveMessage: 'Add carrier escalation tokens to the shared theme',
      checkpointMessage: 'Name trade, network, carrier, and local desks',
      title: 'Add carrier escalation tokens to the shared theme',
      body: 'Introduces shared desk colors and escalation names for carrier recovery surfaces.',
      verdict: 'changes-requested',
      reviewer: 'Mina',
    });
    await seedQueueReview({
      history,
      watcher,
      baseHistory: merge.historyHead,
      number: 5,
      actor: 'Priya',
      branch: 'priya/carrier-command-copy',
      files: ['app/dashboard/index.js', 'app/dashboard/package.json'],
      saveMessage: 'Draft carrier command language for the dashboard',
      checkpointMessage: 'Reframe delivery recovery around carrier desks',
      title: 'Reframe delivery recovery around carrier command',
      body: 'Explores carrier-first dashboard language. Closed after the dispatch team chose the narrower ownership-row proposal.',
      closed: true,
    });
    await seedQueueReview({
      history,
      watcher,
      baseHistory: merge.historyHead,
      number: 6,
      actor: 'Jules',
      branch: 'jules/desk-ownership',
      files: [
        'acme/editor/index.js',
        'acme/editor/package.json',
        'acme/theme/index.js',
        'acme/theme/package.json',
      ],
      saveMessage: 'Show carrier desk ownership in exception rows',
      checkpointMessage: 'Route each exception to a carrier recovery desk',
      title: 'Show carrier desk ownership in exception rows',
      body: 'Adds carrier and recovery-desk ownership directly to each ranked exception without replacing the approved dashboard shell.',
      verdict: 'approved',
      reviewer: 'Mina',
    });

    say(
      '06  assert vendoring, revisions, Checkpoints, Review events, and merge topology',
    );
    let [
      mainHead,
      anaHead,
      kimHead,
      review1,
      review2,
      review3,
      review4,
      review5,
      review6,
      historyEntries,
      vendorMeta,
      dashboardMeta,
      editorMeta,
      themeMeta,
    ] = await Promise.all([
      readBranchHead(depotDir, 'main'),
      readBranchHead(depotDir, 'ana/customer-impact'),
      readBranchHead(depotDir, 'kim/carrier-routing'),
      readReview(depotDir, 1),
      readReview(depotDir, 2),
      readReview(depotDir, 3),
      readReview(depotDir, 4),
      readReview(depotDir, 5),
      readReview(depotDir, 6),
      history.list(depotDir, { flush: false }),
      readStoreMeta(join(depotDir, '.deck', 'store'), 'vendor/impact-score'),
      readStoreMeta(join(depotDir, '.deck', 'store'), 'app/dashboard'),
      readStoreMeta(join(depotDir, '.deck', 'store'), 'acme/editor'),
      readStoreMeta(join(depotDir, '.deck', 'store'), 'acme/theme'),
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
      review3?.ref.state === 'open' && review3.events.length === 0,
      'Review #3 is waiting for its first reviewer',
    );
    check(
      review4?.ref.state === 'open' &&
        review4.events.some(
          (event) =>
            event.type === 'reviewed' &&
            event.verdict === 'changes-requested',
        ),
      'Review #4 records requested changes',
    );
    check(review5?.ref.state === 'closed', 'Review #5 is closed');
    check(
      review6?.ref.state === 'open' &&
        review6.events.some(
          (event) => event.type === 'reviewed' && event.verdict === 'approved',
        ),
      'Review #6 is approved and ready to process',
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
      dashboardMeta?.tags.latest === '1.1.0' &&
        dashboardMeta.tags.lts === '1.0.0' &&
        dashboardMeta.tags.dev,
      'dashboard records stable, LTS, and a current development line',
    );
    check(
      Object.keys(dashboardMeta?.versions ?? {}).length >= 7,
      'dashboard has a rich set of Versions across multiple semver lines',
    );
    check(
      editorMeta?.tags.latest === '1.1.0' &&
        editorMeta.tags.dev &&
        themeMeta?.tags.latest === '1.1.0' &&
        themeMeta.tags.dev,
      'editor and theme carry released and in-review Version lines',
    );
    check(
      historyEntries.length >= 16,
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
    let kimHtml = await history.fileAt(
      depotDir,
      kim.historyHead,
      'app/dashboard/index.html',
    );
    check(
      baselineSource && !baselineSource.includes('impactScore'),
      'baseline History revision is addressable',
    );
    check(
      kimSource?.includes('Open incident room'),
      'Kim History revision is addressable',
    );
    check(
      kimHtml?.includes('live-ribbon') &&
        kimHtml.includes('dispatch-layout') &&
        kimSource?.includes('Carrier command center'),
      'open Review renders an unmistakable carrier command center',
    );
    check(
      historyEntries.some(
        (entry) =>
          entry.author === 'Kim' &&
          entry.description === 'save: app/dashboard/index.html',
      ),
      'History retains autosave descriptions and actor attribution for Track',
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
          state.main?.projection?.version?.startsWith('1.1.0-repository.') &&
          state.reviews?.length === 6 &&
          state.review?.number === 6 &&
          state.preview?.changedMembers?.length === 2 &&
          state.preview?.projection?.version?.startsWith('1.1.0-repository.'),
      ),
      'concurrent Hub projections preserve semver lines and reuse immutable Versions',
    );
    let requestedReview = await readHubState(hubService, 4);
    check(
      requestedReview.review?.number === 4 &&
        requestedReview.changes?.length === 1 &&
        requestedReview.changes[0]?.name === '@acme/theme/',
      'Hub selects an exact Review and computes its own package preview',
    );

    await writeFile(
      join(depotDir, '.deck', 'scenario-replay-v1.json'),
      canonicalJson({
        schema: 'deck-scenario-replay-v1',
        scenario: 'collaboration',
        mergedReview: 1,
        openReviews: [2, 3, 4, 6],
        closedReview: 5,
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
    say('  review queue            4 open · 1 merged · 1 closed');
    say(`  History revisions       ${historyEntries.length}`);
    say(
      `  dashboard Versions      1.0.0 lts → 1.1.0 latest → ${dashboardMeta.tags.dev} dev`,
    );
    say(
      '  vendored                 vendor/impact-score@1.0.0 (approved, 2 modules)',
    );
    say(`  generated realm         ${relative(root, depotDir)}`);
  } finally {
    watcher?.close();
    history.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
