import QUnit from 'qunit';
const { module, test } = QUnit;
import { runConformance } from '../src/run.ts';
import { LAWS, type LawId } from '../src/laws.ts';
import { FIXTURE_TREE_HASH, fixtureFiles } from '../src/fixture.ts';
import { hashBytes, treeHashFromEntries } from '@deck/core/tree-hash';

// The suite that measures implementations is itself measured here: if this
// package can pass while the reference implementation is broken, it is not
// worth running against anything else.
module('conformance: the reference implementation obeys its own laws', () => {
  test('every check passes, and no law fails', async function (assert) {
    let report = await runConformance();
    let failures = report.results
      .filter((result) => !result.ok && !result.skipped)
      .map((result) => `${result.law} ${result.name}: ${result.detail}`);
    assert.deepEqual(failures, [], 'failing checks');
    assert.deepEqual(report.lawsBroken, [], 'broken laws');
    assert.true(report.passed > 25, `only ${report.passed} checks ran`);
  });

  test('the golden fixture hash is what the fixture actually hashes to', function (assert) {
    // Guards against the hash being quietly regenerated to make a failing
    // implementation pass — the one edit that would make this whole package
    // worthless.
    assert.strictEqual(
      treeHashFromEntries(
        fixtureFiles().map((file) => ({
          path: file.path,
          sha256: hashBytes(file.bytes),
        })),
      ).treeHash,
      FIXTURE_TREE_HASH,
    );
  });

  test('every law is either checked or explicitly skipped', async function (assert) {
    let report = await runConformance();
    let seen = new Set(report.results.map((result) => result.law));
    let missing = (Object.keys(LAWS) as LawId[]).filter((id) => !seen.has(id));
    assert.deepEqual(missing, [], 'laws with no check at all');
  });

  test('a broken implementation is caught', async function (assert) {
    // Point the HTTP half at a server that answers everything with 200 and
    // no headers. It must not pass.
    let liar = (async () =>
      new Response('nope', { status: 200 })) as unknown as typeof fetch;
    let report = await runConformance({
      atRest: false,
      target: {
        baseUrl: 'http://example.invalid',
        depot: 'conformance',
        fetchImpl: liar,
      },
    });
    assert.true(report.failed > 0, 'a lying server passed conformance');
    assert.true(
      report.lawsBroken.includes('L12'),
      'serving law not reported as broken',
    );
  });
});
