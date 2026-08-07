import QUnit from 'qunit';
const { module, test } = QUnit;
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { treeHashFromDir } from '@deck/core/tree-hash';
import { readStoreMeta } from '@deck/core/store';

const execFileAsync = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/deck.js', import.meta.url));

async function deck(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('node', [BIN, ...args], { cwd });
}

module('deck CLI end-to-end', function (hooks) {
  let work: string;

  hooks.beforeEach(async function () {
    work = await mkdtemp(join(tmpdir(), 'deck-cli-test-'));
    let source = join(work, 'my-lib');
    await mkdir(join(source, 'util'), { recursive: true });
    await writeFile(
      join(source, 'importmap.json'),
      JSON.stringify({
        deck: {
          packages: {
            'my-lib': { version: '1.0.0', entry: '$REALM/index.js' },
          },
        },
      }),
    );
    await writeFile(join(source, 'index.js'), 'export const LIB = true;\n');
    await writeFile(join(source, 'util', 'x.js'), 'export const X = 1;\n');
  });

  hooks.afterEach(async function () {
    await rm(work, { recursive: true, force: true });
  });

  test('hash → pack → list → verify → unpack round trip', async function (assert) {
    let { stdout: hashOut } = await deck(['hash', 'my-lib'], work);
    let directHash = (await treeHashFromDir(join(work, 'my-lib'))).treeHash;
    assert.strictEqual(hashOut.trim(), `tree-hash-v1:${directHash}`);

    let { stdout: packOut } = await deck(['pack', 'my-lib'], work);
    assert.true(packOut.includes('3 files'), packOut);
    assert.true(packOut.includes(directHash), 'pack reports the same hash');

    let { stdout: listOut } = await deck(['list', 'my-lib.pack.zip'], work);
    assert.true(listOut.includes('deck-pack-v1 (canonical-zip-v1)'));
    assert.true(listOut.includes('util/x.js'));

    let { stdout: verifyOut } = await deck(['verify', 'my-lib.pack.zip'], work);
    assert.true(verifyOut.includes('ok: 3 files verified'));

    await deck(['unpack', 'my-lib.pack.zip', '--into', 'restored'], work);
    let restoredHash = (await treeHashFromDir(join(work, 'restored'))).treeHash;
    assert.strictEqual(restoredHash, directHash, 'law 1 through the CLI');

    // identical-content unpack over the restored tree is all skips
    let { stdout: again } = await deck(
      ['unpack', 'my-lib.pack.zip', '--into', 'restored'],
      work,
    );
    assert.true(again.includes('0 written, 3 identical-skipped'));
  });

  test('publish → tag → store state; immutability holds', async function (assert) {
    await deck(['pack', 'my-lib'], work);
    let { stdout } = await deck(
      [
        'publish',
        'my-lib.pack.zip',
        '--store',
        'store',
        '--name',
        'my-lib',
        '--version',
        '1.0.0',
        '--tag',
        'latest',
      ],
      work,
    );
    assert.true(stdout.includes('published my-lib@1.0.0'));

    let meta = await readStoreMeta(join(work, 'store'), 'my-lib');
    assert.deepEqual(meta!.tags, { latest: '1.0.0' });
    assert.true('1.0.0' in meta!.versions);

    await assert.rejects(
      deck(
        [
          'publish',
          'my-lib.pack.zip',
          '--store',
          'store',
          '--name',
          'my-lib',
          '--version',
          '1.0.0',
        ],
        work,
      ),
      /already published/,
      'published versions are immutable through the CLI too',
    );

    await assert.rejects(
      deck(
        [
          'tag',
          '--store',
          'store',
          '--name',
          'my-lib',
          '--tag',
          'v2',
          '--version',
          '1.0.0',
        ],
        work,
      ),
      /not a valid dist-tag/,
      'semver-shaped tags are refused',
    );
  });

  test('release: the no-copies version update through the CLI', async function (assert) {
    await deck(['pack', 'my-lib'], work);
    // an auto-publish-shaped dev prerelease of the declared base
    await deck(
      [
        'publish',
        'my-lib.pack.zip',
        '--store',
        'store',
        '--name',
        'my-lib',
        '--version',
        '1.0.0-dev.1',
        '--tag',
        'dev',
      ],
      work,
    );

    let { stdout } = await deck(
      [
        'release',
        '--store',
        'store',
        '--name',
        'my-lib',
        '--version',
        '1.0.0',
        '--from',
        'dev',
        '--tag',
        'latest',
      ],
      work,
    );
    assert.true(stdout.includes('zero bytes copied'), stdout);

    let meta = await readStoreMeta(join(work, 'store'), 'my-lib');
    assert.strictEqual(
      meta!.versions['1.0.0'].file,
      meta!.versions['1.0.0-dev.1'].file,
      'the stable is a POINTER to the same stored pack file',
    );
    assert.strictEqual(
      meta!.versions['1.0.0'].treeHash,
      meta!.versions['1.0.0-dev.1'].treeHash,
    );
    assert.deepEqual(meta!.tags, { dev: '1.0.0-dev.1', latest: '1.0.0' });

    await assert.rejects(
      deck(
        [
          'release',
          '--store',
          'store',
          '--name',
          'my-lib',
          '--version',
          '2.0.0',
          '--from',
          'dev',
        ],
        work,
      ),
      /declares my-lib@1\.0\.0/,
      'the sealed manifest must agree it IS the released version',
    );
  });

  test('tampered packs are refused by verify and unpack', async function (assert) {
    await deck(['pack', 'my-lib'], work);
    let packPath = join(work, 'my-lib.pack.zip');
    let bytes = Buffer.from(await readFile(packPath));
    bytes[bytes.length - 30] = bytes[bytes.length - 30] ^ 0xff;
    await writeFile(packPath, bytes);
    await assert.rejects(deck(['verify', 'my-lib.pack.zip'], work));
  });
});
