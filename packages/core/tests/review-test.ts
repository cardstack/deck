import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { review, reviewEvent, reviewHash } from '../src/review.ts';
import {
  allocateConditionalReviewNumber,
  appendReviewEvent,
  createConditionalReview,
  createReview,
  readReview,
  reviewRefPath,
} from '../src/review-store.ts';
import {
  ConditionalWriteConflictError,
  type ConditionalObjectStore,
} from '../src/repository-store.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

module('Repository Reviews', function (hooks) {
  let realmDir: string;

  hooks.beforeEach(async function () {
    realmDir = await mkdtemp(join(tmpdir(), 'deck-review-'));
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  test('Review binds exact base, target, and source Checkpoints', function (assert) {
    let value = review({
      base: { repository: '@acme/dashboard/', branch: 'main', checkpointHash: A },
      target: { repository: '@acme/dashboard/', branch: 'main', checkpointHash: B },
      source: { repository: '@acme/dashboard/', branch: 'compact-editor', checkpointHash: C },
      title: 'Compact editor density',
      body: 'Changes editor and theme together.',
      author: { id: '@ana:example.test' },
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    assert.strictEqual(value.schema, 'deck-review-v2');
    assert.ok(reviewHash(value));
    assert.throws(
      () => review({ ...value, source: { ...value.source, repository: 'https://example.test/fork/' } }),
      /URL-form identity/,
    );
  });

  test('Review and event chain round-trip below the realm .deck', async function (assert) {
    let opened = await createReview({
      realmDir,
      base: { repository: '@acme/dashboard/', branch: 'main', checkpointHash: A },
      target: { repository: '@acme/dashboard/', branch: 'main', checkpointHash: B },
      source: { repository: '@acme/dashboard/', branch: 'compact-editor', checkpointHash: C },
      title: 'Compact editor density',
      author: { id: '@ana:example.test' },
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    await appendReviewEvent({
      realmDir,
      number: opened.ref.number,
      type: 'reviewed',
      actor: { id: '@kim:example.test' },
      createdAt: '2026-08-20T00:01:00.000Z',
      checkpointHash: C,
      verdict: 'approved',
    });
    let stored = await readReview(realmDir, opened.ref.number);
    assert.strictEqual(stored?.review.title, 'Compact editor density');
    assert.strictEqual(stored?.events[0].verdict, 'approved');
    assert.strictEqual(
      reviewRefPath(realmDir, opened.ref.number),
      join(realmDir, '.deck', 'reviews', 'numbers', '1.json'),
    );
  });

  test('event validation speaks only Review and Checkpoint', function (assert) {
    assert.throws(
      () =>
        reviewEvent({
          reviewHash: A,
          type: 'reviewed',
          actor: { id: '@kim:example.test' },
          createdAt: '2026-08-20T00:01:00.000Z',
        }),
      /Checkpoint hash/,
    );
  });

  test('conditional Review creation uses immutable objects and conditional refs', async function (assert) {
    let values = new Map<string, { bytes: Buffer; etag: string }>();
    let writes: Array<{ key: string; condition: { ifMatch?: string; ifNoneMatch?: '*' } }> = [];
    let counter = 0;
    let objects: ConditionalObjectStore = {
      async get(key) {
        return values.get(key);
      },
      async put(key, bytes, condition) {
        writes.push({ key, condition });
        if (condition.ifNoneMatch === '*' && values.has(key)) {
          throw new ConditionalWriteConflictError();
        }
        let value = { bytes, etag: `etag-${++counter}` };
        values.set(key, value);
        return { etag: value.etag };
      },
    };
    assert.strictEqual(
      await allocateConditionalReviewNumber({ objects, key: '.deck/reviews/counter.json' }),
      1,
    );
    let created = await createConditionalReview({
      objects,
      prefix: '.deck',
      base: { repository: '@acme/dashboard/', branch: 'main', checkpointHash: A },
      target: { repository: '@acme/dashboard/', branch: 'main', checkpointHash: B },
      source: { repository: '@acme/dashboard/', branch: 'feature', checkpointHash: C },
      title: 'Feature',
      author: { id: '@ana:example.test' },
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    assert.strictEqual(created.ref.number, 2);
    assert.true(writes.some(({ key }) => key.includes('/reviews/objects/')));
    assert.true(writes.some(({ key }) => key.endsWith('/reviews/numbers/2.json')));
  });
});
