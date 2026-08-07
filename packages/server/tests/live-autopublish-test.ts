import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { unpack } from '@deck/core/pack';
import { readStoreMeta, releaseVersion } from '@deck/core/store';
import { createDeckServer } from '../src/server.ts';
import {
  watchAndPublish,
  type WatchController,
  type WatchPublishEvent,
} from '../src/watcher.ts';

let workDir: string;
let storeDir: string;
let liveDir: string;
let server: Server;
let origin: string;
let controller: WatchController;
let published: WatchPublishEvent[] = [];

async function writeImportMap(version: string): Promise<void> {
  await writeFile(
    join(liveDir, 'importmap.json'),
    JSON.stringify({
      imports: {},
      deck: {
        packages: {
          mylib: { version, entry: '$REALM/lib.js' },
        },
      },
    }),
  );
}

async function packFiles(name: string): Promise<string[]> {
  try {
    return (await readdir(join(storeDir, name, 'packs'))).sort();
  } catch {
    return [];
  }
}

module('live tree + auto-publish + no-copies release', function (hooks) {
  hooks.before(async function () {
    workDir = await mkdtemp(join(tmpdir(), 'deck-live-test-'));
    storeDir = join(workDir, 'store');
    liveDir = join(workDir, 'mylib');
    await rm(liveDir, { recursive: true, force: true });
    await writeFile(join(workDir, '.keep'), '');
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(liveDir, { recursive: true }),
    );
    await writeImportMap('0.1.0');
    await writeFile(join(liveDir, 'lib.js'), 'export const v = 1;\n');

    controller = watchAndPublish({
      dir: liveDir,
      name: 'mylib',
      storeDir,
      debounceMs: 50,
      onPublish: (event) => published.push(event),
      onError: (error) => {
        throw error;
      },
    });

    server = createDeckServer({ storeDir, live: { mylib: liveDir } });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.after(async function () {
    controller.close();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(workDir, { recursive: true, force: true });
  });

  test('a store inside the watched directory is refused', function (assert) {
    assert.throws(
      () =>
        watchAndPublish({
          dir: liveDir,
          name: 'mylib',
          storeDir: join(liveDir, 'store'),
        }),
      /inside the watched directory/,
      'otherwise each publish would change the tree and publish again, forever',
    );
  });

  test('a settled edit auto-publishes a dev prerelease', async function (assert) {
    await writeFile(join(liveDir, 'lib.js'), 'export const v = 2;\n');
    await controller.settled();
    assert.strictEqual(published.length, 1, 'one publish for the burst');
    assert.strictEqual(published[0].version, '0.1.0-dev.1');
    let meta = await readStoreMeta(storeDir, 'mylib');
    assert.deepEqual(meta!.tags, { dev: '0.1.0-dev.1' });
    assert.strictEqual(
      meta!.versions['0.1.0-dev.1'].treeHash,
      published[0].treeHash,
    );
  });

  test('identical settled state publishes nothing (treeHash dedup)', async function (assert) {
    let before = published.length;
    // touch the file with the SAME content
    await writeFile(join(liveDir, 'lib.js'), 'export const v = 2;\n');
    await controller.settled();
    assert.strictEqual(published.length, before, 'no-op save, no publish');
  });

  test('a real change publishes the next dev number; ranges cannot see it', async function (assert) {
    await writeFile(join(liveDir, 'lib.js'), 'export const v = 3;\n');
    await controller.settled();
    assert.strictEqual(published.at(-1)!.version, '0.1.0-dev.2');

    let range = await fetch(`${origin}/@mylib@%5E0.1.0/lib.js`, {
      redirect: 'manual',
    });
    assert.strictEqual(
      range.status,
      404,
      'no stable exists; the ^0.1.0 range never matches dev prereleases',
    );
    let dev = await fetch(`${origin}/@mylib@dev/lib.js`, {
      redirect: 'manual',
    });
    assert.strictEqual(dev.status, 302, 'the dev tag opts in explicitly');
    assert.strictEqual(
      dev.headers.get('location'),
      '/@mylib@0.1.0-dev.2/lib.js',
    );
  });

  test('the live route serves every save immediately, no-store', async function (assert) {
    let first = await fetch(`${origin}/live/mylib/lib.js`);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(await first.text(), 'export const v = 3;\n');
    assert.strictEqual(first.headers.get('cache-control'), 'no-store');

    await writeFile(join(liveDir, 'lib.js'), 'export const v = 4;\n');
    let second = await fetch(`${origin}/live/mylib/lib.js`);
    assert.strictEqual(
      await second.text(),
      'export const v = 4;\n',
      'no debounce, no publish wait — the live tree IS the response',
    );
    await controller.settled(); // let the auto-publish of v=4 finish

    let bare = await fetch(`${origin}/live/mylib`, { redirect: 'manual' });
    assert.strictEqual(bare.status, 302);
    assert.strictEqual(bare.headers.get('location'), '/live/mylib/lib.js');
    assert.strictEqual(bare.headers.get('cache-control'), 'no-store');

    let traversal = await fetch(`${origin}/live/mylib/../escape.js`);
    assert.strictEqual(traversal.status, 404, 'tree-path rules hold');
  });

  test('bumping the map version starts the next dev line — one edit, part of the seal', async function (assert) {
    await writeImportMap('1.0.0');
    await controller.settled();
    assert.strictEqual(published.at(-1)!.version, '1.0.0-dev.1');
  });

  test('release: a new version is a POINTER to a sealed state — zero copies', async function (assert) {
    let filesBefore = await packFiles('mylib');
    let meta = await readStoreMeta(storeDir, 'mylib');
    let devVersion = meta!.tags.dev;
    let devRecord = meta!.versions[devVersion];

    let released = await releaseVersion(
      storeDir,
      'mylib',
      '1.0.0',
      { tag: 'dev' },
      { tag: 'latest' },
    );
    assert.strictEqual(
      released.treeHash,
      devRecord.treeHash,
      'the stable IS the sealed dev state',
    );
    assert.strictEqual(
      released.file,
      devRecord.file,
      'same stored file — a pointer, not a copy',
    );
    let filesAfter = await packFiles('mylib');
    assert.deepEqual(
      filesAfter,
      filesBefore,
      'releasing wrote NO new pack bytes',
    );

    let after = await readStoreMeta(storeDir, 'mylib');
    assert.strictEqual(after!.tags.latest, '1.0.0');

    // and it serves like any stable version
    let response = await fetch(`${origin}/@mylib@1.0.0/lib.js`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), 'export const v = 4;\n');
    let range = await fetch(`${origin}/@mylib@%5E1.0.0/lib.js`, {
      redirect: 'manual',
    });
    assert.strictEqual(range.status, 302);
    assert.strictEqual(
      range.headers.get('location'),
      '/@mylib@1.0.0/lib.js',
      'ranges now see the released stable',
    );
  });

  test('the released pack is byte-identical to its dev source (faithful pointer)', async function (assert) {
    let stable = await fetch(`${origin}/@mylib@1.0.0?format=pack`);
    let meta = await readStoreMeta(storeDir, 'mylib');
    let dev = await fetch(`${origin}/@mylib@${meta!.tags.dev}?format=pack`);
    let stableBytes = Buffer.from(await stable.arrayBuffer());
    let devBytes = Buffer.from(await dev.arrayBuffer());
    assert.true(stableBytes.equals(devBytes), 'same bytes, two names');
    assert.strictEqual(
      unpack(stableBytes).treeHash,
      meta!.versions['1.0.0'].treeHash,
    );
  });

  test('manifest agreement gates releases and stable publishes', async function (assert) {
    await assert.rejects(
      releaseVersion(storeDir, 'mylib', '9.9.9', { tag: 'dev' }),
      /declares mylib@1\.0\.0/,
      'the sealed map must agree it IS this version',
    );
    await assert.rejects(
      releaseVersion(storeDir, 'mylib', '1.0.0', { tag: 'dev' }),
      /already published/,
      'released versions are immutable too',
    );
    await assert.rejects(
      releaseVersion(storeDir, 'mylib', '1.0.1', { tag: 'nope' }),
      /no dist-tag/,
    );
  });
});
