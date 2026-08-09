import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { DeckServer } from '../src/server.ts';
import { peekPacklist } from '@deck/core/pack';
import { readStoreMeta, readStoredPack } from '@deck/core/store';
import type {
  HistoryBackend,
  HistoryEntry,
  RestorePlan,
} from '@deck/history/backend';
import { JjCliHistory, jjVersion } from '@deck/history/jj-cli';
import { createDeckServer } from '../src/server.ts';
import {
  storeDirFor,
  watchDepot,
  type DepotMount,
  type DepotWatchController,
} from '../src/depot.ts';
import type { WatchPublishEvent } from '../src/watcher.ts';

// A backend with no daemon and no subprocess: the routes are the subject
// here, so history is a fixture. The jj-backed module below covers the real
// integration.
const SEALS: Record<string, Record<string, string>> = {
  vvvvvvvv: { 'app.js': 'export const v = 1;\n' },
  wwwwwwww: { 'app.js': 'export const v = 2;\n', 'extra.js': 'more\n' },
};

class StubHistory implements HistoryBackend {
  readonly kind = 'jj' as const;
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
    assert.deepEqual(body.meta, { backend: 'jj', tier: 2, depot: 'demo' });
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
      jj: true,
      historyd: false,
      depots: ['demo'],
      note: 'Every save is sealed. GET /<depot>/_history lists seals; /<depot>/_history/<changeId>/<path> serves any of them, published or not.',
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

  test('a depot with no Timeline says so plainly rather than pretending to have one', async function (assert) {
    let response = await fetch(`${origin}/demo/_history`);
    assert.strictEqual(response.status, 404);
    let error = (await response.json()).errors[0];
    assert.strictEqual(error.code, 'no-history');
    // The wording is the vocabulary ruling's: a depot has a Timeline, or it
    // has Versions only. Never "tier".
    assert.true(/no Timeline/.test(error.detail), error.detail);
    assert.false(/tier/i.test(error.detail), error.detail);

    let body = await (await fetch(`${origin}/_packages`)).json();
    assert.strictEqual(body.meta.history.tier, 1);
    assert.false(body.meta.history.jj);
    assert.false(body.meta.history.historyd);
  });
});

// The real integration: watcher + jj + server. Skipped without a jj, exactly
// as the Timeline itself degrades.
let version = await jjVersion();

if (!version) {
  module('history + auto-publish (jj)', function () {
    test('skipped — jj is not installed', function (assert) {
      assert.ok(true, 'the tier-1 loop is covered by live-autopublish-test');
    });
  });
} else {
  module('history + auto-publish (jj)', function (hooks) {
    let workDir: string;
    let depotDir: string;
    let deckDir: string;
    let storeDir: string;
    let server: DeckServer;
    let origin: string;
    let history: JjCliHistory;
    let controller: DepotWatchController;
    let published: WatchPublishEvent[] = [];

    hooks.before(async function () {
      workDir = await mkdtemp(join(tmpdir(), 'deck-history-e2e-'));
      depotDir = join(workDir, 'demo');
      deckDir = join(depotDir, 'me', 'mylib');
      storeDir = storeDirFor(depotDir);
      await (await import('node:fs/promises')).mkdir(deckDir, {
        recursive: true,
      });
      await writeFile(
        join(deckDir, 'importmap.json'),
        JSON.stringify({
          imports: {},
          deck: {
            packages: { mylib: { version: '0.1.0', entry: '$DECK/app.js' } },
          },
        }),
      );
      await writeFile(join(deckDir, 'app.js'), 'export const v = 1;\n');

      // The depot seals as ONE tree — the same unit a realm server seals —
      // even though each deck under it publishes its own versions.
      history = new JjCliHistory({ debounceMs: 50 });
      let depot: DepotMount = {
        name: 'demo',
        dir: depotDir,
        storeDir,
        history,
      };
      controller = watchDepot({
        depot,
        // A publish window well clear of the seal window, so the state
        // between them is observable rather than a race.
        debounceMs: 600,
        onPublish: (event) => published.push(event),
        onError: (error) => {
          throw error;
        },
      });
      await controller.rescan();
      // Mounting publishes the tree as it stands; count edits from there.
      await controller.settled();
      published = [];
      server = createDeckServer({ depots: [depot] });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    hooks.after(async function () {
      controller.close();
      history.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(workDir, { recursive: true, force: true });
    });

    test('a published version names the seal it was cut from', async function (assert) {
      await writeFile(join(deckDir, 'app.js'), 'export const v = 2;\n');
      await controller.settled();
      assert.strictEqual(published.length, 1);
      let event = published[0];
      assert.strictEqual(event.version, '0.1.0-dev.2');
      assert.strictEqual(event.name, 'me/mylib');
      assert.true(
        typeof event.sealChangeId === 'string' && event.sealChangeId.length > 0,
        'the publish event carries the seal',
      );

      // The seal travels INSIDE the pack, so it survives copying, serving,
      // and unpacking — it is not server-side bookkeeping.
      let packBytes = (await readStoredPack(
        storeDir,
        'me/mylib',
        event.version,
      ))!;
      assert.strictEqual(
        peekPacklist(packBytes).provenance?.sealChangeId,
        event.sealChangeId,
      );

      let meta = await (
        await fetch(`${origin}/demo/me/mylib@${event.version}?meta`)
      ).json();
      assert.strictEqual(
        meta.data.attributes.sealChangeId,
        event.sealChangeId,
        'and a client can follow a version back to its seal',
      );

      // The seal is the DEPOT's, so its paths are depot-relative — the same
      // path the URL uses.
      let sealed = await fetch(
        `${origin}/demo/_history/${event.sealChangeId}/me/mylib/app.js`,
      );
      assert.strictEqual(await sealed.text(), 'export const v = 2;\n');
    });

    test('states BETWEEN publishes are sealed and servable', async function (assert) {
      let publishesBefore = published.length;
      let before = await history.head(depotDir);
      await writeFile(join(deckDir, 'app.js'), 'export const v = 3;\n');
      // The seal debounce (50ms) fires long before the publish debounce
      // (600ms): this is the tier-2 guarantee — the save is already safe
      // before any version exists for it. Poll rather than sleep a fixed
      // amount: filesystem event latency is the platform's business.
      let intermediate = before;
      for (let attempt = 0; attempt < 50 && intermediate === before; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        intermediate = await history.head(depotDir);
      }
      assert.notStrictEqual(intermediate, before, 'the save was sealed');
      assert.strictEqual(
        published.length,
        publishesBefore,
        'and nothing has been published for it yet',
      );
      let response = await fetch(
        `${origin}/demo/_history/${intermediate}/me/mylib/app.js`,
      );
      assert.strictEqual(
        await response.text(),
        'export const v = 3;\n',
        'a state with no version is still addressable, forever',
      );
      await controller.settled();
    });

    test('the seal log outgrows the version list, and nothing runs away', async function (assert) {
      // Two saves inside ONE publish window: both are sealed, only the last
      // is published. The first is the state tier 1 cannot give back.
      let head = await history.head(depotDir);
      await writeFile(join(deckDir, 'app.js'), 'export const v = 4;\n');
      let intermediate = head;
      for (let attempt = 0; attempt < 50 && intermediate === head; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        intermediate = await history.head(depotDir);
      }
      await writeFile(join(deckDir, 'app.js'), 'export const v = 5;\n');
      await controller.settled();

      let seals = await (await fetch(`${origin}/demo/_history`)).json();
      let versions = await (
        await fetch(`${origin}/_packages/demo/me/mylib`)
      ).json();
      let versionCount = Object.keys(versions.data.attributes.versions).length;
      assert.true(
        seals.data.length > versionCount,
        `seals ${seals.data.length} > versions ${versionCount}`,
      );
      assert.true(versions.data.attributes.history);
      let skipped = await fetch(
        `${origin}/demo/_history/${intermediate}/me/mylib/app.js`,
      );
      assert.strictEqual(
        await skipped.text(),
        'export const v = 4;\n',
        'a save that never became a version is still there — that IS tier 2',
      );

      // jj writes into .jj on every operation, inside the watched depot. If
      // those writes were treated as edits, sealing would feed itself: this
      // asserts the loop is closed.
      let before = published.length;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.strictEqual(
        published.length,
        before,
        'a quiet tree publishes nothing, even with a repo inside it',
      );
    });

    test('restore is an ordinary edit: the tree moves, history only grows', async function (assert) {
      let { applyRestore } = await import('@deck/history/backend');
      let seals = await history.list(depotDir);
      let first = seals.at(-1)!.changeId;
      let firstBytes = (await history.fileAt(
        depotDir,
        first,
        'me/mylib/app.js',
      ))!;

      let publishesBefore = published.length;
      let versionsBefore = Object.keys(
        (await readStoreMeta(storeDir, 'me/mylib'))!.versions,
      );
      let result = await applyRestore(history, depotDir, first);
      assert.true(result.written.includes('me/mylib/app.js'));
      assert.strictEqual(
        (await readFile(join(deckDir, 'app.js'))).toString(),
        firstBytes.toString(),
        'the tree is back at the first seal',
      );

      await controller.settled();
      assert.strictEqual(
        published.length,
        publishesBefore + 1,
        'the restored state is reported…',
      );
      let event = published.at(-1)!;
      assert.true(
        event.reused,
        'no new version is minted: this exact content is already published',
      );
      assert.deepEqual(
        Object.keys((await readStoreMeta(storeDir, 'me/mylib'))!.versions),
        versionsBefore,
        'the version list did not grow — content-addressing, taken seriously',
      );
      let served = await fetch(
        `${origin}/demo/me/mylib@${event.version}/app.js`,
      );
      assert.strictEqual(await served.text(), firstBytes.toString());
      let dev = await fetch(`${origin}/demo/me/mylib@dev/app.js`, {
        redirect: 'manual',
      });
      assert.strictEqual(
        dev.headers.get('location'),
        `/demo/me/mylib@${event.version}/app.js`,
        'and the dev tag follows the live tree back',
      );
    });
  });
}
