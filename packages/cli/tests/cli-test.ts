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
import { storeDirFor } from '@deck/server/realm';
import { jjVersion } from '@deck/history/jj-cli';

const execFileAsync = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/deck.js', import.meta.url));

async function deck(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('node', [BIN, ...args], {
    cwd,
    env: { ...process.env, ...env },
  });
}

module('deck CLI end-to-end', function (hooks) {
  let work: string;
  // The realm layout, on disk exactly as it is addressed:
  //   <work>/demo/acme/my-lib/…   →  /demo/acme/my-lib@<version>/…
  let realm: string;
  let store: string;
  const DECK = 'demo/acme/my-lib';

  hooks.beforeEach(async function () {
    work = await mkdtemp(join(tmpdir(), 'deck-cli-test-'));
    realm = join(work, 'demo');
    store = storeDirFor(realm);
    let source = join(work, DECK);
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
    let { stdout: hashOut } = await deck(['hash', DECK], work);
    let directHash = (await treeHashFromDir(join(work, DECK))).treeHash;
    assert.strictEqual(hashOut.trim(), `tree-hash-v1:${directHash}`);

    let { stdout: packOut } = await deck(['pack', DECK], work);
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
    await deck(['pack', DECK], work);
    let { stdout } = await deck(
      [
        'publish',
        'my-lib.pack.zip',
        '--realm',
        'demo',
        '--publisher',
        'acme',
        '--name',
        'my-lib',
        '--version',
        '1.0.0',
        '--tag',
        'latest',
      ],
      work,
    );
    assert.true(stdout.includes('published acme/my-lib@1.0.0'));

    let meta = await readStoreMeta(store, 'acme/my-lib');
    assert.deepEqual(meta!.tags, { latest: '1.0.0' });
    assert.true('1.0.0' in meta!.versions);

    await assert.rejects(
      deck(
        [
          'publish',
          'my-lib.pack.zip',
          '--realm',
          'demo',
          '--publisher',
          'acme',
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
          '--realm',
          'demo',
          '--publisher',
          'acme',
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
    await deck(['pack', DECK], work);
    // an auto-publish-shaped dev prerelease of the declared base
    await deck(
      [
        'publish',
        'my-lib.pack.zip',
        '--realm',
        'demo',
        '--publisher',
        'acme',
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
        '--realm',
        'demo',
        '--publisher',
        'acme',
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

    let meta = await readStoreMeta(store, 'acme/my-lib');
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
          '--realm',
          'demo',
          '--publisher',
          'acme',
          '--name',
          'my-lib',
          '--version',
          '2.0.0',
          '--from',
          'dev',
        ],
        work,
      ),
      /declares acme\/my-lib@1\.0\.0/,
      'the sealed manifest must agree it IS the released version',
    );
  });

  test('prune drops old dev prereleases but keeps what is still pointed at', async function (assert) {
    await deck(['pack', DECK], work);
    for (let n of [1, 2]) {
      await deck(
        [
          'publish',
          'my-lib.pack.zip',
          '--realm',
          'demo',
          '--publisher',
          'acme',
          '--name',
          'my-lib',
          '--version',
          `1.0.0-dev.${n}`,
          '--tag',
          'dev',
        ],
        work,
      );
    }
    await deck(
      [
        'release',
        '--realm',
        'demo',
        '--publisher',
        'acme',
        '--name',
        'my-lib',
        '--version',
        '1.0.0',
        '--from',
        '1.0.0-dev.1',
        '--tag',
        'latest',
      ],
      work,
    );

    let { stdout } = await deck(
      [
        'prune',
        '--realm',
        'demo',
        '--publisher',
        'acme',
        '--name',
        'my-lib',
        '--keep',
        '0',
      ],
      work,
    );
    assert.true(stdout.includes('pruned 1 dev prerelease'), stdout);

    let meta = await readStoreMeta(store, 'acme/my-lib');
    assert.deepEqual(
      Object.keys(meta!.versions).sort(),
      ['1.0.0', '1.0.0-dev.2'],
      'the stable and the tagged dev survive; dev.1 is gone',
    );
    assert.true(
      (
        await readFile(
          join(store, 'acme', 'my-lib', meta!.versions['1.0.0'].file),
        )
      ).length > 0,
      'the released stable still has its bytes',
    );
  });

  test('lock: ranges in the tree, pins in the map', async function (assert) {
    // A second deck in the same realm, published, to depend on.
    let lib = join(work, 'demo', 'acme', 'lib');
    await mkdir(lib, { recursive: true });
    await writeFile(
      join(lib, 'importmap.json'),
      JSON.stringify({
        deck: { packages: { lib: { version: '1.0.0', entry: '$REALM/lib.js' } } },
      }),
    );
    await writeFile(join(lib, 'lib.js'), 'export const LIB = 1;\n');
    await deck(['pack', 'demo/acme/lib'], work);
    await deck(
      [
        'publish',
        'lib.pack.zip',
        '--realm',
        'demo',
        '--publisher',
        'acme',
        '--name',
        'lib',
        '--version',
        '1.0.0',
        '--tag',
        'latest',
      ],
      work,
    );

    // The app declares a RANGE.
    let appMap = join(work, DECK, 'importmap.json');
    let map = JSON.parse(await readFile(appMap, 'utf8'));
    map.deck.dependencies = { 'acme/lib': '^1.0.0' };
    await writeFile(appMap, JSON.stringify(map, null, 2));

    await assert.rejects(
      deck(
        [
          'lock',
          '--realm',
          'demo',
          '--publisher',
          'acme',
          '--name',
          'my-lib',
          '--check',
        ],
        work,
      ),
      /lock is out of date/,
      '--check is the CI shape: report, never write',
    );

    let { stdout } = await deck(
      ['lock', '--realm', 'demo', '--publisher', 'acme', '--name', 'my-lib'],
      work,
    );
    assert.true(stdout.includes('acme/lib  ^1.0.0 → /demo/acme/lib@1.0.0/lib.js'), stdout);
    let locked = JSON.parse(await readFile(appMap, 'utf8'));
    assert.strictEqual(
      locked.imports['acme/lib'],
      '/demo/acme/lib@1.0.0/lib.js',
      'the pin is what a consumer gets',
    );
    assert.strictEqual(
      locked.deck.dependencies['acme/lib'],
      '^1.0.0',
      'the range is what the author meant — both are kept',
    );

    let { stdout: again } = await deck(
      ['lock', '--realm', 'demo', '--publisher', 'acme', '--name', 'my-lib'],
      work,
    );
    assert.true(again.includes('already locked'), again);
  });

  test('history + restore: the mulligan, through the CLI', async function (assert) {
    let source = join(work, DECK);
    if (!(await jjVersion())) {
      assert.ok(true, 'skipped — jj is not installed; tier 2 is optional');
      return;
    }
    await writeFile(join(source, 'index.js'), 'export const LIB = 1;\n');
    await deck(['history', 'demo'], work); // listing seals the realm
    await writeFile(join(source, 'index.js'), 'export const LIB = 2;\n');

    let { stdout: log } = await deck(['history', 'demo'], work);
    let seals = log
      .split('\n')
      .filter((line) => /^[0-9a-z]{12}\s/.test(line))
      .map((line) => line.slice(0, 12));
    assert.strictEqual(seals.length, 2, log);

    let { stdout: restored } = await deck(
      ['restore', 'demo', seals[1]],
      work,
    );
    assert.true(restored.includes('1 file(s) written'), restored);
    assert.true(
      restored.includes('the state you left is sealed'),
      'a restore is itself undoable',
    );
    assert.strictEqual(
      (await readFile(join(source, 'index.js'))).toString(),
      'export const LIB = 1;\n',
    );

    let { stdout: json } = await deck(['history', 'demo', '--json'], work);
    assert.strictEqual(
      JSON.parse(json).length,
      3,
      'restoring adds to history rather than rewriting it',
    );
  });

  test('history without a backend explains itself instead of failing obscurely', async function (assert) {
    await assert.rejects(
      // Port 1 answers nothing — an explicitly requested backend that is not
      // there degrades to tier 1 rather than silently becoming another one.
      deck(['history', 'demo', '--history', 'historyd'], work, {
        DECK_HISTORYD_URL: 'http://127.0.0.1:1',
      }),
      /no daemon at http:\/\/127\.0\.0\.1:1/,
      'the message names what was missing',
    );
  });

  test('tampered packs are refused by verify and unpack', async function (assert) {
    await deck(['pack', DECK], work);
    let packPath = join(work, 'my-lib.pack.zip');
    let bytes = Buffer.from(await readFile(packPath));
    bytes[bytes.length - 30] = bytes[bytes.length - 30] ^ 0xff;
    await writeFile(packPath, bytes);
    await assert.rejects(deck(['verify', 'my-lib.pack.zip'], work));
  });
});
