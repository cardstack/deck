import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalJson,
  changedMembers,
  repositoryHash,
  repositoryManifest,
  repositoryState,
  revision,
  revisionHash,
  type JsonValue,
} from '../src/repository.ts';
import {
  RefConflictError,
  readBranchRef,
  readRepository,
  readRepositoryLock,
  readRevision,
  storeRepository,
  storeRepositoryLock,
  storeRevision,
  updateBranchRef,
  updateConditionalBranchRef,
  type ConditionalObjectStore,
} from '../src/repository-store.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

module('multi-package collaboration objects', function (hooks) {
  let storeDir: string;

  hooks.beforeEach(async function () {
    storeDir = await mkdtemp(join(tmpdir(), 'deck-repository-'));
  });

  hooks.afterEach(async function () {
    await rm(storeDir, { recursive: true, force: true });
  });

  test('repository identity is canonical across input ordering', function (assert) {
    let first = repositoryState({
      roots: ['app/dashboard'],
      members: { 'acme/theme': B, 'app/dashboard': A },
      lockHash: C,
    });
    let second = repositoryState({
      roots: ['app/dashboard'],
      members: { 'app/dashboard': A, 'acme/theme': B },
      lockHash: C,
    });
    assert.strictEqual(repositoryHash(first), repositoryHash(second));
    assert.deepEqual(Object.keys(first.members), [
      'acme/theme',
      'app/dashboard',
    ]);
  });

  test('roots must be editable members and every member names a package tree', function (assert) {
    assert.throws(
      () =>
        repositoryState({
          roots: ['app/missing'],
          members: { 'app/dashboard': A },
          lockHash: C,
        }),
      /root is not a member/,
    );
    assert.throws(
      () =>
        repositoryState({ roots: [], members: { dashboard: A }, lockHash: C }),
      /invalid repository member name/,
    );
    assert.throws(
      () =>
        repositoryState({
          roots: [],
          members: { 'app/dashboard': 'not-a-hash' },
          lockHash: C,
        }),
      /invalid treeHash/,
    );
  });

  test('the local repository manifest canonicalizes authored membership', function (assert) {
    assert.deepEqual(
      repositoryManifest({
        roots: ['app/dashboard'],
        members: ['app/dashboard', 'acme/theme', 'acme/editor'],
      }),
      {
        schema: 'deck-repository-manifest-v1',
        roots: ['app/dashboard'],
        members: ['acme/editor', 'acme/theme', 'app/dashboard'],
      },
    );
    assert.throws(
      () =>
        repositoryManifest({
          roots: ['app/dashboard'],
          members: ['app/dashboard', 'app/dashboard'],
        }),
      /duplicates/,
    );
  });

  test('a revision preserves parent order because first-parent history is meaningful', function (assert) {
    let state = repositoryState({
      roots: ['app/dashboard'],
      members: { 'app/dashboard': A },
      lockHash: C,
    });
    let value = revision({
      repositoryHash: repositoryHash(state),
      parents: [A, B],
      author: { id: '@chris:example.test', name: 'Chris' },
      message: 'Merge editor and theme changes',
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    assert.deepEqual(value.parents, [A, B]);
    assert.notStrictEqual(
      revisionHash(value),
      revisionHash({ ...value, parents: [B, A] }),
    );
    assert.throws(
      () =>
        revision({
          repositoryHash: repositoryHash(state),
          author: { id: '@chris:example.test' },
          message: 'Ambiguous time',
          createdAt: '2026-08-20',
        }),
      /canonical UTC/,
    );
  });

  test('lock, repository, and revision round-trip through the local CAS', async function (assert) {
    let lock: JsonValue = {
      imports: {
        'acme/editor': '/site/acme/editor@1.0.0/index.js',
      },
    };
    let lockHash = await storeRepositoryLock(storeDir, lock);
    let state = repositoryState({
      roots: ['app/dashboard'],
      members: { 'app/dashboard': A, 'acme/editor': B },
      lockHash,
    });
    let stateHash = await storeRepository(storeDir, state);
    let commit = revision({
      repositoryHash: stateHash,
      author: { id: '@agent:example.test' },
      message: 'Initial repository',
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    let commitHash = await storeRevision(storeDir, commit);

    assert.deepEqual(await readRepositoryLock(storeDir, lockHash), lock);
    assert.deepEqual(await readRepository(storeDir, stateHash), state);
    assert.deepEqual(await readRevision(storeDir, commitHash), commit);
    assert.strictEqual(
      await readFile(
        join(
          storeDir,
          '_repositories',
          stateHash.slice(0, 2),
          `${stateHash}.json`,
        ),
        'utf8',
      ),
      canonicalJson(state as unknown as JsonValue).toString('utf8'),
    );
  });

  test('one revision can atomically change several members while reusing the rest', function (assert) {
    let before = repositoryState({
      roots: ['app/dashboard'],
      members: { 'app/dashboard': A, 'acme/editor': A, 'acme/theme': A },
      lockHash: C,
    });
    let after = repositoryState({
      roots: ['app/dashboard'],
      members: { 'app/dashboard': B, 'acme/editor': C, 'acme/theme': A },
      lockHash: C,
    });
    assert.deepEqual(changedMembers(before, after), [
      'acme/editor',
      'app/dashboard',
    ]);
  });

  test('local branch updates are compare-and-swap', async function (assert) {
    let created = await updateBranchRef({
      storeDir,
      owner: 'acme',
      repository: 'dashboard',
      branch: 'main',
      expectedRevision: null,
      nextRevision: A,
    });
    assert.strictEqual(created.generation, 1);
    await assert.rejects(
      updateBranchRef({
        storeDir,
        owner: 'acme',
        repository: 'dashboard',
        branch: 'main',
        expectedRevision: null,
        nextRevision: B,
      }),
      RefConflictError,
    );
    let updated = await updateBranchRef({
      storeDir,
      owner: 'acme',
      repository: 'dashboard',
      branch: 'main',
      expectedRevision: A,
      nextRevision: B,
    });
    assert.strictEqual(updated.generation, 2);
    assert.strictEqual(
      (await readBranchRef(storeDir, 'acme', 'dashboard', 'main'))
        ?.revisionHash,
      B,
    );
  });

  test('S3-style branch updates use the object ETag as the write condition', async function (assert) {
    let object: { bytes: Buffer; etag: string } | undefined;
    let condition: { ifMatch?: string; ifNoneMatch?: '*' } | undefined;
    let objects: ConditionalObjectStore = {
      async get() {
        return object;
      },
      async put(_key, bytes, nextCondition) {
        condition = nextCondition;
        object = { bytes, etag: 'etag-2' };
        return { etag: object.etag };
      },
    };
    await updateConditionalBranchRef({
      objects,
      key: '_refs/acme/dashboard/heads/main.json',
      expectedRevision: null,
      nextRevision: A,
    });
    assert.deepEqual(condition, { ifNoneMatch: '*' });
    object!.etag = 'etag-1';
    await updateConditionalBranchRef({
      objects,
      key: '_refs/acme/dashboard/heads/main.json',
      expectedRevision: A,
      nextRevision: B,
    });
    assert.deepEqual(condition, { ifMatch: 'etag-1' });
  });
});
