import QUnit from 'qunit';
const { module, test } = QUnit;
import { pack, unpack } from '@cardstack/deck/pack';
import { packagesFromPack } from '@cardstack/deck/import-map-pack';
import {
  canonicalOptions,
  derivationFromMap,
  deriveMinified,
  derivedPack,
  isMinifiable,
  minifiedVersion,
  terserVersion,
  verifyDerivation,
} from '../src/derive.ts';

function sourcePack(version = '1.2.3') {
  return pack([
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify(
          {
            imports: {},
            deck: { packages: { ink: { version, entry: '$DECK/ink.js' } } },
          },
          null,
          2,
        ) + '\n',
      ),
    },
    {
      path: 'ink.js',
      // Big enough that minifying actually beats what the map gains in
      // provenance. On a two-line module it does not: the derivation record
      // costs a few hundred bytes and there is nothing to win them back
      // with, so the derived TREE is larger even though the JS is smaller.
      // Worth knowing, and the reason the byte tally counts the rewritten
      // map rather than the map it replaced.
      bytes: Buffer.from(
        `// a comment worth removing\nexport function add(first, second) {\n  const total = first + second;\n  return total;\n}\nexport const answer = 40 + 2;\n` +
          Array.from(
            { length: 40 },
            (_ignored, index) =>
              `export function helper${index}(someArgument) {\n  const intermediateValue = someArgument * ${index};\n  return intermediateValue + ${index};\n}\n`,
          ).join(''),
      ),
    },
    { path: 'data.json', bytes: Buffer.from('{"keep": true}\n') },
    { path: 'logo.svg', bytes: Buffer.from('<svg/>\n') },
  ]);
}

module('A: minify as a derived sealed tree', () => {
  test('only JS is minified', (assert) => {
    assert.true(isMinifiable('src/a.js'));
    assert.true(isMinifiable('src/a.mjs'));
    assert.false(isMinifiable('a.min.js'), 'already minified');
    assert.false(isMinifiable('index.html'), 'the injection target');
    assert.false(isMinifiable('data.json'));
    assert.false(isMinifiable('a.js.map'));
  });

  // [A5] Build metadata is stripped by semver.valid and compares equal to
  // the source version; a prerelease is distinct and ranges never match it.
  test('the derived version is a prerelease', (assert) => {
    assert.strictEqual(minifiedVersion('1.2.3'), '1.2.3-min.0');
    assert.strictEqual(minifiedVersion('1.2.3', 2), '1.2.3-min.2');
  });

  test('a derived tree is smaller, and keeps what it cannot shrink', async (assert) => {
    let derived = await deriveMinified({
      packBytes: sourcePack(),
      sourceVersion: '1.2.3',
      packageName: 'acme/ink',
      terserVersion: await terserVersion(),
    });
    assert.deepEqual(derived.minifiedPaths, ['ink.js']);
    assert.true(derived.derivedBytes < derived.sourceBytes);
    let files = new Map(derived.files.map((file) => [file.path, file.bytes]));
    assert.strictEqual(
      files.get('data.json')!.toString('utf8'),
      '{"keep": true}\n',
      'non-JS is carried through untouched',
    );
    assert.false(
      files.get('ink.js')!.toString('utf8').includes('a comment worth removing'),
    );
    assert.true(
      files.get('ink.js')!.toString('utf8').includes('42'),
      'constants folded',
    );
  });

  test('the derived tree declares its own version and lineage, inside the seal', async (assert) => {
    let source = sourcePack();
    let derived = await deriveMinified({
      packBytes: source,
      sourceVersion: '1.2.3',
      packageName: 'acme/ink',
      terserVersion: await terserVersion(),
    });
    let bytes = derivedPack(derived);
    let entry = packagesFromPack(bytes)!.ink as Record<string, unknown>;
    assert.strictEqual(entry.version, '1.2.3-min.0', 'manifest agreement');
    assert.strictEqual(entry.derivedFrom, unpack(source).treeHash);
    assert.strictEqual(
      (entry.derivation as { kind: string }).kind,
      'minify-v1',
    );
    // Sealed, not bolted on beside: the lineage is inside the hashed tree.
    assert.notStrictEqual(unpack(bytes).treeHash, unpack(source).treeHash);
  });

  test('deriving twice produces the same tree', async (assert) => {
    let tool = await terserVersion();
    let first = derivedPack(
      await deriveMinified({
        packBytes: sourcePack(),
        sourceVersion: '1.2.3',
        packageName: 'acme/ink',
        terserVersion: tool,
      }),
    );
    let second = derivedPack(
      await deriveMinified({
        packBytes: sourcePack(),
        sourceVersion: '1.2.3',
        packageName: 'acme/ink',
        terserVersion: tool,
      }),
    );
    assert.true(first.equals(second), 'byte-identical');
  });

  test('options are canonically ordered so records compare', (assert) => {
    assert.deepEqual(
      Object.keys(canonicalOptions({ zeta: 1, alpha: 2, mid: 3 })),
      ['alpha', 'mid', 'zeta'],
    );
  });

  // [A4] L11 applied to derived trees: a derivation nobody can re-run is
  // decoration.
  test('verify-derivation reproduces the tree', async (assert) => {
    let source = sourcePack();
    let tool = await terserVersion();
    let derived = await deriveMinified({
      packBytes: source,
      sourceVersion: '1.2.3',
      packageName: 'acme/ink',
      terserVersion: tool,
    });
    let verdict = await verifyDerivation({
      sourcePack: source,
      derivedTreeHash: unpack(derivedPack(derived)).treeHash,
      derivation: derived.derivation,
      sourceVersion: '1.2.3',
      packageName: 'acme/ink',
      version: derived.version,
      terserVersion: tool,
    });
    assert.true(verdict.ok, verdict.detail);
    assert.strictEqual(verdict.actual, verdict.expected);
  });

  test('a derivation claiming a different tool is refused', async (assert) => {
    let source = sourcePack();
    let derived = await deriveMinified({
      packBytes: source,
      sourceVersion: '1.2.3',
      packageName: 'acme/ink',
      terserVersion: await terserVersion(),
    });
    let verdict = await verifyDerivation({
      sourcePack: source,
      derivedTreeHash: unpack(derivedPack(derived)).treeHash,
      derivation: { ...derived.derivation, tool: 'terser@0.0.1' },
      sourceVersion: '1.2.3',
      packageName: 'acme/ink',
      version: derived.version,
      terserVersion: await terserVersion(),
    });
    assert.false(verdict.ok);
    assert.true(verdict.detail!.includes('install the recorded version'));
  });

  test('a tampered derived tree does not reproduce', async (assert) => {
    let source = sourcePack();
    let tool = await terserVersion();
    let derived = await deriveMinified({
      packBytes: source,
      sourceVersion: '1.2.3',
      packageName: 'acme/ink',
      terserVersion: tool,
    });
    let verdict = await verifyDerivation({
      sourcePack: source,
      derivedTreeHash: 'f'.repeat(64),
      derivation: derived.derivation,
      sourceVersion: '1.2.3',
      packageName: 'acme/ink',
      version: derived.version,
      terserVersion: tool,
    });
    assert.false(verdict.ok);
    assert.true(verdict.detail!.includes('different tree'));
  });

  test('a source tree records no derivation', (assert) => {
    let map = unpack(sourcePack()).files.get('importmap.json')!.toString('utf8');
    assert.deepEqual(derivationFromMap(map, 'acme/ink'), {});
  });
});
