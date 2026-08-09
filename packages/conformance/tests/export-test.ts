import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treeHashFromDir } from '@deck/core/tree-hash';
import { exportFixture, goldenFixture, GOLDEN_PATH } from '../src/export.ts';
import { FIXTURE_TREE_HASH } from '../src/fixture.ts';

module('conformance: handing the fixture to someone else', function (hooks) {
  let root: string;

  hooks.beforeEach(async function () {
    root = await mkdtemp(join(tmpdir(), 'deck-export-'));
  });
  hooks.afterEach(async function () {
    await rm(root, { recursive: true, force: true });
  });

  // The point of exporting at all: an implementation in another language
  // cannot call writeFixtureDepot, so it needs the bytes on disk.
  test('the exported tree hashes to the golden value', async function (assert) {
    let depotDir = await exportFixture(root);
    let { install } = goldenFixture();
    let hashed = await treeHashFromDir(
      join(depotDir, install.publisher, install.package),
    );
    assert.strictEqual(hashed.treeHash, FIXTURE_TREE_HASH);
  });

  // Without the golden values a foreign implementation could hash the
  // fixture its own way, serve it consistently, and pass — having agreed
  // only with itself.
  test('golden.json states what a correct implementation must produce', async function (assert) {
    await exportFixture(root);
    let golden = JSON.parse(await readFile(join(root, GOLDEN_PATH), 'utf8'));
    assert.strictEqual(golden.format, 'deck-conformance-fixture-v1');
    assert.strictEqual(golden.expect.treeHash, FIXTURE_TREE_HASH);
    assert.true(golden.expect.files.length > 0, 'per-file digests are listed');
    for (let file of golden.expect.files) {
      assert.strictEqual(typeof file.path, 'string');
      assert.strictEqual(typeof file.sha256, 'string');
      assert.strictEqual(typeof file.size, 'number');
    }
  });

  test('it says where to publish the tree and how to check the result', async function (assert) {
    let golden = goldenFixture();
    assert.deepEqual(golden.install, {
      depot: 'conformance',
      publisher: 'deck',
      package: 'fixture',
      version: '1.0.0',
      tag: 'latest',
    });
    // The graph must be sealed too: the preload closure is advertised only
    // for a sealed document, so an unsealed graph makes that check vacuous.
    assert.strictEqual(golden.graph.length, 3);
    assert.true(golden.verify.includes('--url'));
  });
});
