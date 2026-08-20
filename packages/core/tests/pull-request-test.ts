import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack } from '../src/pack.ts';
import { storePack } from '../src/object-store.ts';
import { pullRequestEvent } from '../src/pull-request.ts';
import {
  allocateConditionalPullRequestNumber,
  appendConditionalPullRequestEvent,
  appendPullRequestEvent,
  createConditionalPullRequest,
  createPullRequest,
  mergePullRequest,
  previewPullRequest,
  readPullRequest,
} from '../src/pull-request-store.ts';
import { repositoryState, revision } from '../src/repository.ts';
import {
  ConditionalWriteConflictError,
  readBranchRef,
  readRepository,
  readRevision,
  storeRepository,
  storeRepositoryLock,
  storeRevision,
  updateBranchRef,
  type ConditionalObjectStore,
} from '../src/repository-store.ts';

module('Repository pull requests', function (hooks) {
  let storeDir: string;

  hooks.beforeEach(async function () {
    storeDir = await mkdtemp(join(tmpdir(), 'deck-pull-request-'));
  });

  hooks.afterEach(async function () {
    await rm(storeDir, { recursive: true, force: true });
  });

  async function tree(files: Record<string, string>): Promise<string> {
    return (
      await storePack(
        storeDir,
        pack(
          Object.entries(files).map(([path, text]) => ({
            path,
            bytes: Buffer.from(text),
          })),
        ),
      )
    ).treeHash;
  }

  async function repositoryRevision(options: {
    members: Record<string, string>;
    message: string;
    parent?: string;
    lock?: object;
  }): Promise<string> {
    let lockHash = await storeRepositoryLock(
      storeDir,
      (options.lock ?? { imports: {} }) as never,
    );
    let repositoryHash = await storeRepository(
      storeDir,
      repositoryState({
        roots: ['app/dashboard'],
        members: options.members,
        lockHash,
      }),
    );
    return storeRevision(
      storeDir,
      revision({
        repositoryHash,
        parents: options.parent ? [options.parent] : [],
        author: { id: '@fixture:deck.test' },
        message: options.message,
        createdAt: options.parent
          ? '2026-08-20T00:01:00.000Z'
          : '2026-08-20T00:00:00.000Z',
      }),
    );
  }

  async function setBranch(branch: string, revisionHash: string) {
    await updateBranchRef({
      storeDir,
      owner: 'acme',
      repository: 'dashboard',
      branch,
      expectedRevision: null,
      nextRevision: revisionHash,
    });
  }

  test('a pull request previews and atomically lands a two-package change', async function (assert) {
    let dashboard = await tree({
      'index.js': 'export const dashboard = true;\n',
    });
    let editor1 = await tree({
      'index.js': "export const density = 'comfortable';\n",
    });
    let theme1 = await tree({
      'index.js': "export const spacing = 'normal';\n",
    });
    let base = await repositoryRevision({
      members: {
        'app/dashboard': dashboard,
        'acme/editor': editor1,
        'acme/theme': theme1,
      },
      message: 'Initial repository',
    });
    let editor2 = await tree({
      'index.js': "export const density = 'compact';\n",
    });
    let theme2 = await tree({
      'index.js': "export const spacing = 'tight';\n",
    });
    let source = await repositoryRevision({
      members: {
        'app/dashboard': dashboard,
        'acme/editor': editor2,
        'acme/theme': theme2,
      },
      message: 'Compact editor',
      parent: base,
    });
    await setBranch('main', base);
    await setBranch('compact-editor', source);

    let opened = await createPullRequest({
      storeDir,
      target: { owner: 'acme', repository: 'dashboard', branch: 'main' },
      source: {
        owner: 'acme',
        repository: 'dashboard',
        branch: 'compact-editor',
      },
      title: 'Add compact editor density',
      author: { id: '@chris:deck.test' },
      createdAt: '2026-08-20T00:02:00.000Z',
    });
    assert.strictEqual(opened.ref.number, 1);
    let preview = await previewPullRequest(storeDir, 'acme', 'dashboard', 1);
    assert.strictEqual(preview.state, 'ready');
    if (preview.state === 'ready') {
      assert.deepEqual(preview.changedMembers, ['acme/editor', 'acme/theme']);
    }

    let merged = await mergePullRequest({
      storeDir,
      owner: 'acme',
      repository: 'dashboard',
      number: 1,
      actor: { id: '@maintainer:deck.test' },
      createdAt: '2026-08-20T00:03:00.000Z',
    });
    assert.strictEqual(merged.state, 'ready');
    if (merged.state !== 'ready') return;
    let main = await readBranchRef(storeDir, 'acme', 'dashboard', 'main');
    assert.strictEqual(main?.revisionHash, merged.mergeRevisionHash);
    let mergeRevision = await readRevision(storeDir, merged.mergeRevisionHash);
    assert.deepEqual(mergeRevision?.parents, [base, source]);
    let repository = await readRepository(
      storeDir,
      mergeRevision!.repositoryHash,
    );
    assert.strictEqual(repository?.members['app/dashboard'], dashboard);
    assert.strictEqual(repository?.members['acme/editor'], editor2);
    assert.strictEqual(repository?.members['acme/theme'], theme2);
    let closed = await readPullRequest(storeDir, 'acme', 'dashboard', 1);
    assert.strictEqual(closed?.ref.state, 'merged');
    assert.deepEqual(
      closed?.events.map((event) => event.type),
      ['merge-started', 'merged'],
    );
    assert.strictEqual(
      closed?.events[1].revisionHash,
      merged.mergeRevisionHash,
    );
  });

  test('a real package conflict leaves the target branch and request open', async function (assert) {
    let dashboard = await tree({
      'index.js': 'export const dashboard = true;\n',
    });
    let baseEditor = await tree({
      'index.js': "export const density = 'normal';\n",
    });
    let base = await repositoryRevision({
      members: { 'app/dashboard': dashboard, 'acme/editor': baseEditor },
      message: 'Initial repository',
    });
    let targetEditor = await tree({
      'index.js': "export const density = 'roomy';\n",
    });
    let sourceEditor = await tree({
      'index.js': "export const density = 'compact';\n",
    });
    let target = await repositoryRevision({
      members: { 'app/dashboard': dashboard, 'acme/editor': targetEditor },
      message: 'Roomy editor',
      parent: base,
    });
    let source = await repositoryRevision({
      members: { 'app/dashboard': dashboard, 'acme/editor': sourceEditor },
      message: 'Compact editor',
      parent: base,
    });
    await setBranch('main', base);
    await setBranch('compact-editor', source);
    await createPullRequest({
      storeDir,
      target: { owner: 'acme', repository: 'dashboard', branch: 'main' },
      source: {
        owner: 'acme',
        repository: 'dashboard',
        branch: 'compact-editor',
      },
      title: 'Compact editor',
      author: { id: '@chris:deck.test' },
      createdAt: '2026-08-20T00:02:00.000Z',
    });
    await updateBranchRef({
      storeDir,
      owner: 'acme',
      repository: 'dashboard',
      branch: 'main',
      expectedRevision: base,
      nextRevision: target,
    });
    let result = await mergePullRequest({
      storeDir,
      owner: 'acme',
      repository: 'dashboard',
      number: 1,
      actor: { id: '@maintainer:deck.test' },
      createdAt: '2026-08-20T00:04:00.000Z',
    });
    assert.strictEqual(result.state, 'conflicted');
    if (result.state === 'conflicted') {
      assert.deepEqual(result.conflicts, ['acme/editor/index.js']);
    }
    assert.strictEqual(
      (await readBranchRef(storeDir, 'acme', 'dashboard', 'main'))
        ?.revisionHash,
      target,
    );
    assert.strictEqual(
      (await readPullRequest(storeDir, 'acme', 'dashboard', 1))?.ref.state,
      'open',
    );
  });

  test('an interrupted merge resumes the prepared Revision instead of creating another', async function (assert) {
    let dashboard = await tree({
      'index.js': 'export const dashboard = true;\n',
    });
    let editor1 = await tree({
      'index.js': "export const density = 'normal';\n",
    });
    let base = await repositoryRevision({
      members: { 'app/dashboard': dashboard, 'acme/editor': editor1 },
      message: 'Initial repository',
    });
    let editor2 = await tree({
      'index.js': "export const density = 'compact';\n",
    });
    let source = await repositoryRevision({
      members: { 'app/dashboard': dashboard, 'acme/editor': editor2 },
      message: 'Compact editor',
      parent: base,
    });
    await setBranch('main', base);
    await setBranch('compact-editor', source);
    let opened = await createPullRequest({
      storeDir,
      target: { owner: 'acme', repository: 'dashboard', branch: 'main' },
      source: {
        owner: 'acme',
        repository: 'dashboard',
        branch: 'compact-editor',
      },
      title: 'Compact editor',
      author: { id: '@chris:deck.test' },
      createdAt: '2026-08-20T00:02:00.000Z',
    });
    let preview = await previewPullRequest(storeDir, 'acme', 'dashboard', 1);
    if (preview.state !== 'ready') throw new Error('fixture must merge');
    let prepared = await storeRevision(
      storeDir,
      revision({
        repositoryHash: preview.repositoryHash,
        parents: [base, source],
        author: { id: '@maintainer:deck.test' },
        message: 'Merge pull request #1: Compact editor',
        createdAt: '2026-08-20T00:03:00.000Z',
      }),
    );
    await appendPullRequestEvent({
      storeDir,
      owner: 'acme',
      repository: 'dashboard',
      number: opened.ref.number,
      type: 'merge-started',
      actor: { id: '@maintainer:deck.test' },
      createdAt: '2026-08-20T00:03:00.000Z',
      revisionHash: prepared,
    });

    let recovered = await mergePullRequest({
      storeDir,
      owner: 'acme',
      repository: 'dashboard',
      number: 1,
      actor: { id: '@maintainer:deck.test' },
      createdAt: '2026-08-20T00:04:00.000Z',
    });
    assert.strictEqual(recovered.state, 'ready');
    if (recovered.state !== 'ready') return;
    assert.true('recovered' in recovered && recovered.recovered === true);
    assert.strictEqual(recovered.mergeRevisionHash, prepared);
    assert.strictEqual(
      (await readBranchRef(storeDir, 'acme', 'dashboard', 'main'))
        ?.revisionHash,
      prepared,
    );
    assert.deepEqual(
      (
        await readPullRequest(storeDir, 'acme', 'dashboard', opened.ref.number)
      )?.events.map((event) => event.type),
      ['merge-started', 'merged'],
    );
  });

  test('S3-style pull request numbering and creation use conditional writes', async function (assert) {
    let values = new Map<string, { bytes: Buffer; etag: string }>();
    let etag = 0;
    let objects: ConditionalObjectStore = {
      async get(key) {
        return values.get(key);
      },
      async put(key, bytes, condition) {
        let current = values.get(key);
        if (
          (condition.ifNoneMatch === '*' && current) ||
          (condition.ifMatch !== undefined &&
            current?.etag !== condition.ifMatch)
        ) {
          throw new ConditionalWriteConflictError('precondition failed');
        }
        let next = { bytes, etag: `etag-${++etag}` };
        values.set(key, next);
        return { etag: next.etag };
      },
    };
    assert.strictEqual(
      await allocateConditionalPullRequestNumber({
        objects,
        key: 'deck/_pulls/acme/dashboard/_counter.json',
      }),
      1,
    );
    let created = await createConditionalPullRequest({
      objects,
      prefix: 'deck',
      target: {
        owner: 'acme',
        repository: 'dashboard',
        branch: 'main',
        revisionHash: 'a'.repeat(64),
      },
      source: {
        owner: 'chris',
        repository: 'dashboard',
        branch: 'compact-editor',
        revisionHash: 'b'.repeat(64),
      },
      title: 'Compact editor',
      author: { id: '@chris:deck.test' },
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    assert.strictEqual(created.ref.number, 2);
    assert.true(values.has('deck/_pulls/acme/dashboard/2.json'));
    assert.true(
      [...values.keys()].some((key) => key.startsWith('deck/_pull_requests/')),
    );
    let reviewed = await appendConditionalPullRequestEvent({
      objects,
      prefix: 'deck',
      owner: 'acme',
      repository: 'dashboard',
      number: created.ref.number,
      type: 'reviewed',
      verdict: 'approved',
      revisionHash: 'b'.repeat(64),
      actor: { id: '@maintainer:deck.test' },
      createdAt: '2026-08-20T00:01:00.000Z',
    });
    assert.strictEqual(reviewed.ref.generation, 2);
    assert.strictEqual(reviewed.ref.state, 'open');
    assert.strictEqual(reviewed.event.revisionHash, 'b'.repeat(64));
    assert.strictEqual(reviewed.event.previousEventHash, undefined);
    let closed = await appendConditionalPullRequestEvent({
      objects,
      prefix: 'deck',
      owner: 'acme',
      repository: 'dashboard',
      number: created.ref.number,
      type: 'closed',
      actor: { id: '@maintainer:deck.test' },
      createdAt: '2026-08-20T00:02:00.000Z',
    });
    assert.strictEqual(closed.ref.generation, 3);
    assert.strictEqual(closed.ref.state, 'closed');
    assert.strictEqual(closed.event.previousEventHash, reviewed.ref.eventHash);
    assert.true(
      [...values.keys()].filter((key) =>
        key.startsWith('deck/_pull_request_events/'),
      ).length === 2,
    );
    assert.throws(
      () =>
        pullRequestEvent({
          pullRequestHash: created.ref.pullRequestHash,
          type: 'reviewed',
          verdict: 'approved',
          actor: { id: '@maintainer:deck.test' },
          createdAt: '2026-08-20T00:03:00.000Z',
        }),
      /reviewed requires a Revision hash/,
    );
  });
});
