import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { DeckServer } from '../src/server.ts';
import type {
  HistoryBackend,
  HistoryEntry,
  RestorePlan,
} from '@cardstack/deck-history/backend';
import { createDeckServer } from '../src/server.ts';

// A backend with no daemon: the routes are the subject here, so history is
// a fixture. Live History integration is covered by deckd / historyd tests.
const SEALS: Record<string, Record<string, string>> = {
  vvvvvvvv: { 'app.js': 'export const v = 1;\n' },
  wwwwwwww: { 'app.js': 'export const v = 2;\n', 'extra.js': 'more\n' },
};

class StubHistory implements HistoryBackend {
  readonly kind = 'deckd' as const;
  noteMutation(): void {}
  async flush(): Promise<string | undefined> {
    return undefined;
  }
  async seal(): Promise<string | undefined> {
    return undefined;
  }
  async head(): Promise<string | undefined> {
    return 'wwwwwwww';
  }
  async list(): Promise<HistoryEntry[]> {
    return [
      {
        changeId: 'wwwwwwww',
        commitId: 'ab12',
        timestamp: '2026-08-07T10:00:00+0000',
        description: 'save: app.js',
        filesSummary: ['M app.js'],
      },
      {
        changeId: 'vvvvvvvv',
        commitId: 'cd34',
        timestamp: '2026-08-07T09:00:00+0000',
        description: 'first',
        filesSummary: ['A app.js'],
      },
    ];
  }
  async fileAt(
    _dir: string,
    revisionId: string,
    path: string,
  ): Promise<Buffer | undefined> {
    let content = SEALS[revisionId]?.[path];
    return content === undefined ? undefined : Buffer.from(content);
  }
  async fileListAt(
    _dir: string,
    revisionId: string,
  ): Promise<string[] | undefined> {
    let seal = SEALS[revisionId];
    return seal ? Object.keys(seal).sort() : undefined;
  }
  async restorePlan(): Promise<RestorePlan> {
    return { writes: [], deletes: [] };
  }
  close(): void {}
}

module('history routes: serving states that were never published', function (
  hooks,
) {
  let server: DeckServer;
  let origin: string;
  let storeDir: string;

  hooks.before(async function () {
    storeDir = await mkdtemp(join(tmpdir(), 'deck-history-routes-'));
    server = createDeckServer({
      depots: [
        {
          name: 'demo',
          dir: join(storeDir, 'depot'),
          storeDir,
          history: new StubHistory(),
        },
      ],
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.after(async function () {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(storeDir, { recursive: true, force: true });
  });

  test('the seal log lists every state, newest first, uncached', async function (assert) {
    let response = await fetch(`${origin}/demo/_history`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get('cache-control'),
      'no-store',
      'the log grows with every save',
    );
    let body = await response.json();
    assert.deepEqual(body.meta, { backend: 'deckd', tier: 2, depot: 'demo' });
    assert.deepEqual(
      body.data.map((seal: { id: string }) => seal.id),
      ['wwwwwwww', 'vvvvvvvv'],
    );
    assert.strictEqual(
      body.data[0].attributes.filesUrl,
      '/demo/_history/wwwwwwww',
    );
  });

  test('a sealed file is served immutable — the same promise an exact version gets', async function (assert) {
    let response = await fetch(`${origin}/demo/_history/vvvvvvvv/app.js`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );
    assert.strictEqual(response.headers.get('x-deck-seal'), 'vvvvvvvv');
    assert.strictEqual(
      response.headers.get('content-type'),
      'text/javascript; charset=utf-8',
    );
    assert.true(
      response.headers.get('content-digest')?.startsWith('sha-256=:'),
      'sealed bytes carry their digest like any other immutable response',
    );
    assert.strictEqual(await response.text(), 'export const v = 1;\n');

    let head = await fetch(`${origin}/demo/_history/vvvvvvvv/app.js`, {
      method: 'HEAD',
    });
    assert.strictEqual(head.status, 200, 'HEAD rides the GET path');
    assert.strictEqual(await head.text(), '');
  });

  test('a seal lists its own tree', async function (assert) {
    let response = await fetch(`${origin}/demo/_history/wwwwwwww`);
    let body = await response.json();
    assert.deepEqual(body.data.attributes.files, ['app.js', 'extra.js']);
    assert.true(body.data.attributes.filesAvailable);
    assert.strictEqual(
      response.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
      'a seal never changes, and neither does its file list',
    );
  });

  test('misses are tiered by permanence, and paths are validated', async function (assert) {
    let unknown = await fetch(`${origin}/demo/_history/zzzzzzzz`);
    assert.strictEqual(unknown.status, 404);
    assert.strictEqual(
      (await unknown.json()).errors[0].code,
      'revision-not-found',
    );
    assert.strictEqual(
      unknown.headers.get('cache-control'),
      'public, max-age=60, s-maxage=300',
      'a seal that does not exist YET is only briefly negative-cached',
    );

    let malformed = await fetch(`${origin}/demo/_history/not%20an%20id`);
    assert.strictEqual(malformed.status, 404);
    assert.strictEqual(
      (await malformed.json()).errors[0].code,
      'invalid-revision',
    );
    assert.strictEqual(
      malformed.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
      'no future seal can ever carry a malformed id — cache the refusal',
    );

    let traversal = await fetch(`${origin}/demo/_history/vvvvvvvv/../escape`);
    assert.strictEqual(traversal.status, 404, 'tree-path rules hold here too');

    let missing = await fetch(`${origin}/demo/_history/vvvvvvvv/nope.js`);
    assert.strictEqual(missing.status, 404);
    assert.strictEqual((await missing.json()).errors[0].code, 'file-not-found');

    let unmounted = await fetch(`${origin}/other/_history`);
    assert.strictEqual(unmounted.status, 404);
    assert.strictEqual(
      (await unmounted.json()).errors[0].code,
      'depot-not-found',
    );
  });

  test('the capability block tells a client what history it is talking to', async function (assert) {
    let body = await (await fetch(`${origin}/_packages`)).json();
    assert.deepEqual(body.meta.history, {
      tier: 2,
      kind: 'sealed-tree',
      deckd: true,
      depots: ['demo'],
      note: 'Every settled save is captured by deckd. GET /<depot>/_history lists Steps; /<depot>/_history/<changeId>/<path> serves any of them, published or not.',
    });
  });
});

module('history routes: a server without a backend', function (hooks) {
  let server: DeckServer;
  let origin: string;
  let storeDir: string;

  hooks.before(async function () {
    storeDir = await mkdtemp(join(tmpdir(), 'deck-history-none-'));
    server = createDeckServer({
      depots: [{ name: 'demo', dir: join(storeDir, 'depot'), storeDir }],
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.after(async function () {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(storeDir, { recursive: true, force: true });
  });

  test('a depot with Version history only says so plainly', async function (assert) {
    let response = await fetch(`${origin}/demo/_history`);
    assert.strictEqual(response.status, 404);
    let error = (await response.json()).errors[0];
    assert.strictEqual(error.code, 'no-history');
    // The wording is the vocabulary ruling's: a depot has every-save History,
    // or it has Version history only. Never "tier".
    assert.true(/Version history only/.test(error.detail), error.detail);
    assert.false(/tier/i.test(error.detail), error.detail);

    let body = await (await fetch(`${origin}/_packages`)).json();
    assert.strictEqual(body.meta.history.tier, 1);
    assert.false(body.meta.history.deckd);
  });
});
