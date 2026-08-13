import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { DeckServer } from '../src/server.ts';
import { unpack } from '@cardstack/deck/pack';
import { readStoreMeta, releaseVersion } from '@cardstack/deck/store';
import { createDeckServer } from '../src/server.ts';
import {
  storeDirFor,
  watchDepot,
  type DepotMount,
  type DepotWatchController,
} from '../src/depot.ts';
import type { WatchPublishEvent } from '../src/watcher.ts';

let workDir: string;
let depotDir: string;
let storeDir: string;
let deckDir: string;
let server: DeckServer;
let origin: string;
let controller: DepotWatchController;
let published: WatchPublishEvent[] = [];

async function writePackage(version: string): Promise<void> {
  await writeFile(
    join(deckDir, 'package.json'),
    JSON.stringify({
      name: 'mylib',
      version,
      type: 'module',
      exports: { '.': './lib.js' },
    }),
  );
}

async function packFiles(name: string): Promise<string[]> {
  try {
    return (await readdir(join(storeDir, ...name.split('/'), 'packs'))).sort();
  } catch {
    return [];
  }
}

module('live tree + auto-publish + no-copies release', function (hooks) {
  hooks.before(async function () {
    workDir = await mkdtemp(join(tmpdir(), 'deck-live-test-'));
    depotDir = join(workDir, 'demo');
    storeDir = storeDirFor(depotDir);
    deckDir = join(depotDir, 'me', 'mylib');
    await mkdir(deckDir, { recursive: true });
    await writePackage('0.1.0');
    await writeFile(join(deckDir, 'lib.js'), 'export const v = 1;\n');

    let depot: DepotMount = { name: 'demo', dir: depotDir, storeDir };
    controller = watchDepot({
      depot,
      debounceMs: 50,
      onPublish: (event) => published.push(event),
      onError: (error) => {
        throw error;
      },
    });
    await controller.rescan();
    // Mounting publishes what is already on disk; the tests below are about
    // what EDITS do, so let that settle first and start counting from there.
    await controller.settled();
    published = [];

    server = createDeckServer({ depots: [depot] });
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

  test('the store lives inside the depot — a hidden dir, so it never feeds itself', async function (assert) {
    assert.strictEqual(storeDir, join(depotDir, '.deck', 'store'));
    assert.deepEqual(
      controller.decks().map((deck) => deck.name),
      ['me/mylib'],
      'a directory with a package.json IS a deck',
    );
    let meta = await readStoreMeta(storeDir, 'me/mylib');
    assert.strictEqual(
      meta!.tags.dev,
      '0.1.0-dev.1',
      'mounting published what was already on disk — the scaffold is not lost',
    );
  });

  test('a settled edit auto-publishes a dev prerelease', async function (assert) {
    await writeFile(join(deckDir, 'lib.js'), 'export const v = 2;\n');
    await controller.settled();
    assert.strictEqual(published.length, 1, 'one publish for the burst');
    assert.strictEqual(published[0].version, '0.1.0-dev.2');
    assert.strictEqual(published[0].name, 'me/mylib');
    let meta = await readStoreMeta(storeDir, 'me/mylib');
    assert.deepEqual(meta!.tags, { dev: '0.1.0-dev.2' });
    assert.strictEqual(
      meta!.versions['0.1.0-dev.2'].treeHash,
      published[0].treeHash,
    );
  });

  test('identical settled state publishes nothing (treeHash dedup)', async function (assert) {
    let before = published.length;
    // touch the file with the SAME content
    await writeFile(join(deckDir, 'lib.js'), 'export const v = 2;\n');
    await controller.settled();
    assert.strictEqual(published.length, before, 'no-op save, no publish');
  });

  test('a real change publishes the next dev number; ranges cannot see it', async function (assert) {
    await writeFile(join(deckDir, 'lib.js'), 'export const v = 3;\n');
    await controller.settled();
    assert.strictEqual(published.at(-1)!.version, '0.1.0-dev.3');

    let range = await fetch(`${origin}/demo/me/mylib@%5E0.1.0/lib.js`, {
      redirect: 'manual',
    });
    assert.strictEqual(
      range.status,
      404,
      'no stable exists; the ^0.1.0 range never matches dev prereleases',
    );
    let dev = await fetch(`${origin}/demo/me/mylib@dev/lib.js`, {
      redirect: 'manual',
    });
    assert.strictEqual(dev.status, 302, 'the dev tag opts in explicitly');
    assert.strictEqual(
      dev.headers.get('location'),
      '/demo/me/mylib@0.1.0-dev.3/lib.js',
    );
  });

  test('the version-less path serves every save immediately, no-store', async function (assert) {
    let first = await fetch(`${origin}/demo/me/mylib/lib.js`);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(await first.text(), 'export const v = 3;\n');
    assert.strictEqual(first.headers.get('cache-control'), 'no-store');

    await writeFile(join(deckDir, 'lib.js'), 'export const v = 4;\n');
    let second = await fetch(`${origin}/demo/me/mylib/lib.js`);
    assert.strictEqual(
      await second.text(),
      'export const v = 4;\n',
      'no debounce, no publish wait — the live tree IS the response',
    );
    await controller.settled(); // let the auto-publish of v=4 finish

    let bare = await fetch(`${origin}/demo/me/mylib`, { redirect: 'manual' });
    assert.strictEqual(bare.status, 302);
    assert.strictEqual(bare.headers.get('location'), '/demo/me/mylib/lib.js');
    assert.strictEqual(bare.headers.get('cache-control'), 'no-store');

    let traversal = await fetch(`${origin}/demo/me/mylib/../escape.js`);
    assert.strictEqual(traversal.status, 404, 'tree-path rules hold');
  });

  test('bumping the package.json version starts the next dev line — one edit, part of the seal', async function (assert) {
    await writePackage('1.0.0');
    await controller.settled();
    assert.strictEqual(published.at(-1)!.version, '1.0.0-dev.1');
  });

  test('release: a new version is a POINTER to a sealed state — zero copies', async function (assert) {
    let filesBefore = await packFiles('me/mylib');
    let meta = await readStoreMeta(storeDir, 'me/mylib');
    let devVersion = meta!.tags.dev;
    let devRecord = meta!.versions[devVersion];

    let released = await releaseVersion(
      storeDir,
      'me/mylib',
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
    let filesAfter = await packFiles('me/mylib');
    assert.deepEqual(
      filesAfter,
      filesBefore,
      'releasing wrote NO new pack bytes',
    );

    let after = await readStoreMeta(storeDir, 'me/mylib');
    assert.strictEqual(after!.tags.latest, '1.0.0');

    // and it serves like any stable version
    let response = await fetch(`${origin}/demo/me/mylib@1.0.0/lib.js`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), 'export const v = 4;\n');
    let range = await fetch(`${origin}/demo/me/mylib@%5E1.0.0/lib.js`, {
      redirect: 'manual',
    });
    assert.strictEqual(range.status, 302);
    assert.strictEqual(
      range.headers.get('location'),
      '/demo/me/mylib@1.0.0/lib.js',
      'ranges now see the released stable',
    );
  });

  test('the released pack is byte-identical to its dev source (faithful pointer)', async function (assert) {
    let stable = await fetch(`${origin}/demo/me/mylib@1.0.0?format=pack`);
    let meta = await readStoreMeta(storeDir, 'me/mylib');
    let dev = await fetch(
      `${origin}/demo/me/mylib@${meta!.tags.dev}?format=pack`,
    );
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
      releaseVersion(storeDir, 'me/mylib', '9.9.9', { tag: 'dev' }),
      /declares me\/mylib@1\.0\.0/,
      'package.json must agree it IS this version',
    );
    await assert.rejects(
      releaseVersion(storeDir, 'me/mylib', '1.0.0', { tag: 'dev' }),
      /already published/,
      'released versions are immutable too',
    );
    await assert.rejects(
      releaseVersion(storeDir, 'me/mylib', '1.0.1', { tag: 'nope' }),
      /no dist-tag/,
    );
  });

  test('a new deck appearing on disk starts publishing itself', async function (assert) {
    let second = join(depotDir, 'me', 'other');
    await mkdir(second, { recursive: true });
    await writeFile(
      join(second, 'package.json'),
      JSON.stringify({
        name: 'other',
        version: '0.0.1',
        type: 'module',
        exports: { '.': './other.js' },
      }),
    );
    await writeFile(join(second, 'other.js'), 'export const other = true;\n');
    await controller.rescan();
    await controller.settled();

    assert.true(
      controller.decks().some((deck) => deck.name === 'me/other'),
      'creating a directory with a package.json is the whole ceremony',
    );
    let meta = await readStoreMeta(storeDir, 'me/other');
    assert.strictEqual(meta!.tags.dev, '0.0.1-dev.1');
    let served = await fetch(`${origin}/demo/me/other@0.0.1-dev.1/other.js`);
    assert.strictEqual(await served.text(), 'export const other = true;\n');
  });
});
