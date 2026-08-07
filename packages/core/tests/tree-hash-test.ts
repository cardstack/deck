import QUnit from 'qunit';
const { module, test } = QUnit;
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_IGNORE,
  formatTreeHash,
  hashBytes,
  isValidTreePath,
  treeHashFromDir,
  treeHashFromEntries,
  TREE_HASH_SPEC,
} from '../src/tree-hash.ts';

// An independent naive re-derivation, so the tests don't just re-run the
// implementation against itself.
function naive(files: Record<string, string>): string {
  let lines = Object.entries(files)
    .map(([path, content]) => ({
      path,
      line: `${createHash('sha256').update(content).digest('hex')}  ${path}\n`,
    }))
    .sort((a, b) =>
      Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')),
    )
    .map((e) => e.line)
    .join('');
  return createHash('sha256').update(lines).digest('hex');
}

module('tree-hash-v1', function () {
  test('known vectors: empty tree and a single file', function (assert) {
    let empty = treeHashFromEntries([]);
    assert.strictEqual(empty.manifestText, '', 'empty tree, empty manifest');
    assert.strictEqual(
      empty.treeHash,
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'the well-known sha256 of the empty string',
    );

    let one = treeHashFromEntries([
      { path: 'a.txt', sha256: hashBytes('hello\n') },
    ]);
    assert.strictEqual(one.treeHash, naive({ 'a.txt': 'hello\n' }));
    assert.true(
      one.manifestText.endsWith('  a.txt\n'),
      'shasum -a 256 compatible line format',
    );
  });

  test('entry order does not matter; path bytes decide', function (assert) {
    let files = {
      'z/deep.txt': 'z',
      'a.txt': 'a',
      'Z-upper.txt': 'upper',
    };
    let entries = Object.entries(files).map(([path, content]) => ({
      path,
      sha256: hashBytes(content),
    }));
    let forward = treeHashFromEntries(entries);
    let reversed = treeHashFromEntries([...entries].reverse());
    assert.strictEqual(forward.treeHash, reversed.treeHash);
    assert.strictEqual(forward.treeHash, naive(files));
    assert.deepEqual(
      forward.entries.map((e) => e.path),
      ['Z-upper.txt', 'a.txt', 'z/deep.txt'],
      'UTF-8 byte order: uppercase sorts before lowercase',
    );
  });

  test('unicode paths sort by UTF-8 bytes, not code units', function (assert) {
    // U+FF41 (fullwidth a) encodes as three UTF-8 bytes starting 0xEF;
    // 'z' is the single byte 0x7A — byte order puts 'z.txt' first even
    // though a codepoint comparison would not.
    let wide = 'ａ.txt';
    let files: Record<string, string> = { [wide]: 'wide', 'z.txt': 'ascii' };
    let result = treeHashFromEntries(
      Object.entries(files).map(([path, content]) => ({
        path,
        sha256: hashBytes(content),
      })),
    );
    assert.deepEqual(
      result.entries.map((e) => e.path),
      ['z.txt', wide],
      'single-byte paths precede multi-byte paths',
    );
    assert.strictEqual(result.treeHash, naive(files));
  });

  test('content changes and path changes both change the hash', function (assert) {
    let base = treeHashFromEntries([
      { path: 'x.ts', sha256: hashBytes('one') },
    ]);
    let contentChanged = treeHashFromEntries([
      { path: 'x.ts', sha256: hashBytes('two') },
    ]);
    let pathChanged = treeHashFromEntries([
      { path: 'y.ts', sha256: hashBytes('one') },
    ]);
    assert.notStrictEqual(base.treeHash, contentChanged.treeHash);
    assert.notStrictEqual(base.treeHash, pathChanged.treeHash);
  });

  test('invalid inputs are refused', function (assert) {
    let good = hashBytes('x');
    assert.throws(
      () =>
        treeHashFromEntries([
          { path: 'a', sha256: good },
          { path: 'a', sha256: good },
        ]),
      /duplicate tree path/,
    );
    assert.throws(
      () => treeHashFromEntries([{ path: 'a', sha256: 'ABC' }]),
      /invalid sha256/,
    );
    for (let bad of [
      '/rooted',
      'trailing/',
      'a//b',
      '../escape',
      'a/./b',
      'a\\b',
      'with!bang',
      'pack.zip!/inner',
      '',
    ]) {
      assert.false(isValidTreePath(bad), `${JSON.stringify(bad)} is invalid`);
      assert.throws(
        () => treeHashFromEntries([{ path: bad, sha256: good }]),
        /invalid tree path/,
      );
    }
    for (let good_ of ['a', 'a/b/c.gts', 'importmap.json', '.realm.json']) {
      assert.true(isValidTreePath(good_), `${good_} is valid`);
    }
  });

  test('formatTreeHash carries the spec name', function (assert) {
    let r = treeHashFromEntries([]);
    assert.strictEqual(r.spec, TREE_HASH_SPEC);
    assert.strictEqual(formatTreeHash(r), `${TREE_HASH_SPEC}:${r.treeHash}`);
  });

  test('directory walk matches entry-list hashing and applies ignores', async function (assert) {
    let dir = await mkdtemp(join(tmpdir(), 'tree-hash-test-'));
    try {
      await mkdir(join(dir, 'accounting'), { recursive: true });
      await mkdir(join(dir, '.git'), { recursive: true });
      await mkdir(join(dir, 'node_modules', 'x'), { recursive: true });
      await writeFile(join(dir, 'importmap.json'), '{"boxel":{}}');
      await writeFile(join(dir, 'accounting', 'account.gts'), 'export {};');
      await writeFile(join(dir, '.git', 'config'), 'ignored');
      await writeFile(join(dir, 'node_modules', 'x', 'y.js'), 'ignored');
      await writeFile(join(dir, '.DS_Store'), 'ignored');
      await symlink(join(dir, 'importmap.json'), join(dir, 'link.json'));

      let walked = await treeHashFromDir(dir);
      let expected = treeHashFromEntries([
        { path: 'importmap.json', sha256: hashBytes('{"boxel":{}}') },
        {
          path: 'accounting/account.gts',
          sha256: hashBytes('export {};'),
        },
      ]);
      assert.strictEqual(
        walked.treeHash,
        expected.treeHash,
        'walk == entries; ignores and symlinks excluded',
      );
      assert.deepEqual(
        walked.entries.map((e) => e.path),
        ['accounting/account.gts', 'importmap.json'],
      );
      assert.true(DEFAULT_IGNORE.has('.jj'), 'sidecar dir reserved');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
