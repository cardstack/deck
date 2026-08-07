import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack } from '../src/pack.ts';
import {
  pruneDevVersions,
  publishToStore,
  readStoredPack,
  readStoreMeta,
  releaseVersion,
} from '../src/store.ts';

function libFiles(base: string, body: string) {
  return [
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify({
          deck: {
            packages: { lib: { version: base, entry: '$REALM/lib.js' } },
          },
        }),
      ),
    },
    { path: 'lib.js', bytes: Buffer.from(body) },
  ];
}

async function packFileCount(storeDir: string, name: string): Promise<number> {
  try {
    return (await readdir(join(storeDir, name, 'packs'))).length;
  } catch {
    return 0;
  }
}

module('store: content addressing and pruning', function (hooks) {
  let storeDir: string;

  hooks.beforeEach(async function () {
    storeDir = await mkdtemp(join(tmpdir(), 'deck-store-test-'));
  });

  hooks.afterEach(async function () {
    await rm(storeDir, { recursive: true, force: true });
  });

  test('identical content published twice stores ONE pack file', async function (assert) {
    let bytes = pack(libFiles('1.0.0', 'export const v = 1;\n'));
    await publishToStore(storeDir, 'lib', '1.0.0-dev.1', bytes);
    await publishToStore(storeDir, 'lib', '1.0.0-dev.2', bytes);
    assert.strictEqual(
      await packFileCount(storeDir, 'lib'),
      1,
      'content-addressed: same bytes, one file, two pointers',
    );
    let meta = await readStoreMeta(storeDir, 'lib');
    assert.strictEqual(
      meta!.versions['1.0.0-dev.1'].file,
      meta!.versions['1.0.0-dev.2'].file,
    );
  });

  test('pruning keeps the newest dev versions and never touches stables or tags', async function (assert) {
    for (let n of [1, 2, 3, 4]) {
      await publishToStore(
        storeDir,
        'lib',
        `1.0.0-dev.${n}`,
        pack(libFiles('1.0.0', `export const v = ${n};\n`)),
        { tag: 'dev' },
      );
    }
    // dev.4 is the release source; dev tag still points at it
    await releaseVersion(
      storeDir,
      'lib',
      '1.0.0',
      { tag: 'dev' },
      { tag: 'latest' },
    );
    assert.strictEqual(await packFileCount(storeDir, 'lib'), 4);

    let { removedVersions, deletedFiles } = await pruneDevVersions(
      storeDir,
      'lib',
      { keep: 1 },
    );
    // dev.4 is tag-protected, so the prunable set is dev.1..dev.3; keep 1 →
    // dev.1 and dev.2 go.
    assert.deepEqual(removedVersions, ['1.0.0-dev.1', '1.0.0-dev.2']);
    assert.strictEqual(deletedFiles.length, 2);

    let meta = await readStoreMeta(storeDir, 'lib');
    assert.deepEqual(
      Object.keys(meta!.versions).sort(),
      ['1.0.0', '1.0.0-dev.3', '1.0.0-dev.4'],
      'stable + tagged dev + the kept dev survive',
    );
    assert.deepEqual(meta!.tags, { dev: '1.0.0-dev.4', latest: '1.0.0' });
    assert.strictEqual(await packFileCount(storeDir, 'lib'), 2);
  });

  test('a released stable survives pruning of the dev version it was cut from', async function (assert) {
    // The content-addressing hazard: 1.0.0 and 1.0.0-dev.1 SHARE one file.
    await publishToStore(
      storeDir,
      'lib',
      '1.0.0-dev.1',
      pack(libFiles('1.0.0', 'export const v = 1;\n')),
    );
    await releaseVersion(
      storeDir,
      'lib',
      '1.0.0',
      { version: '1.0.0-dev.1' },
      { tag: 'latest' },
    );
    // a newer dev so the older one is prunable
    await publishToStore(
      storeDir,
      'lib',
      '1.0.0-dev.2',
      pack(libFiles('1.0.0', 'export const v = 2;\n')),
      { tag: 'dev' },
    );

    let { removedVersions, deletedFiles } = await pruneDevVersions(
      storeDir,
      'lib',
      { keep: 0 },
    );
    assert.deepEqual(removedVersions, ['1.0.0-dev.1']);
    assert.deepEqual(
      deletedFiles,
      [],
      'its bytes are still referenced by the stable — nothing deleted',
    );
    let served = await readStoredPack(storeDir, 'lib', '1.0.0');
    assert.true(
      served !== undefined && served.length > 0,
      'the released stable still serves after its dev source was pruned',
    );
  });

  test('pruning is a no-op below the keep threshold', async function (assert) {
    await publishToStore(
      storeDir,
      'lib',
      '1.0.0-dev.1',
      pack(libFiles('1.0.0', 'export const v = 1;\n')),
    );
    let result = await pruneDevVersions(storeDir, 'lib', { keep: 10 });
    assert.deepEqual(result.removedVersions, []);
    assert.strictEqual(await packFileCount(storeDir, 'lib'), 1);
  });
});
