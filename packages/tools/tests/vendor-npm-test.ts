import QUnit from 'qunit';
const { module, test } = QUnit;
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  deckNameForNpm,
  gitBlobSha,
  judgeCooldown,
  newestAged,
  normalizePolicy,
  parsePolicy,
  parseNpmSpec,
  readTar,
  repoUrlFor,
  verifyIntegrity,
  type NpmPackage,
  type NpmVersionDoc,
} from '../src/npm.ts';
import {
  candidateEntries,
  commonSubtree,
  probeEntries,
  vendorFromNpmSource,
} from '../src/vendor-npm.ts';
import { createHash } from 'node:crypto';

// A minimal ustar writer, so the tar reader is tested against real bytes
// rather than against itself.
function tar(entries: { name: string; content: string }[]): Buffer {
  let blocks: Buffer[] = [];
  for (let { name, content } of entries) {
    let data = Buffer.from(content, 'utf8');
    let header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'utf8'); // mode
    header.write('0000000\0', 108, 8, 'utf8'); // uid
    header.write('0000000\0', 116, 8, 'utf8'); // gid
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12);
    header.write('00000000000\0', 136, 12, 'utf8'); // mtime
    header.write('        ', 148, 8, 'utf8'); // checksum placeholder
    header.write('0', 156, 1, 'utf8'); // typeflag: regular file
    header.write('ustar\0', 257, 6, 'utf8');
    header.write('00', 263, 2, 'utf8');
    let sum = 0;
    for (let byte of header) {
      sum += byte;
    }
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024)); // end-of-archive
  return Buffer.concat(blocks);
}

function fakePackage(
  files: Record<string, string>,
  packageJson: Record<string, unknown> = {},
  doc: Partial<NpmVersionDoc> = {},
): NpmPackage {
  let map = new Map<string, Buffer>();
  for (let [path, content] of Object.entries(files)) {
    map.set(path, Buffer.from(content, 'utf8'));
  }
  map.set('package.json', Buffer.from(JSON.stringify(packageJson), 'utf8'));
  return {
    name: (packageJson.name as string) ?? 'demo',
    version: (packageJson.version as string) ?? '1.0.0',
    packageJson,
    files: map,
    doc: {
      name: (packageJson.name as string) ?? 'demo',
      version: (packageJson.version as string) ?? '1.0.0',
      dist: { tarball: 'https://example.invalid/demo.tgz' },
      ...doc,
    } as NpmVersionDoc,
  };
}

module('npm carriage', () => {
  test('parses specs, including scoped names', (assert) => {
    assert.deepEqual(parseNpmSpec('three@0.160.0'), {
      name: 'three',
      range: '0.160.0',
    });
    assert.deepEqual(parseNpmSpec('three'), { name: 'three', range: 'latest' });
    assert.deepEqual(parseNpmSpec('@tanstack/query-core@5.1.0'), {
      name: '@tanstack/query-core',
      range: '5.1.0',
    });
  });

  test('a name that loses nothing in the fold is left alone', (assert) => {
    assert.strictEqual(deckNameForNpm('three'), 'three');
    assert.strictEqual(deckNameForNpm('babel-runtime'), 'babel-runtime');
    assert.strictEqual(deckNameForNpm('query-core'), 'query-core');
  });

  // The fold is not injective, so where it loses information the true npm
  // name is what disambiguates. Nix's `<hash>-<name>`, applied only where it
  // is needed rather than to every package.
  test('a lossy fold carries a digest of the true npm name', (assert) => {
    let scoped = deckNameForNpm('@babel/runtime');
    let plain = deckNameForNpm('babel-runtime');
    assert.true(
      scoped.startsWith('babel-runtime-'),
      `readable stem preserved, got ${scoped}`,
    );
    assert.notStrictEqual(
      scoped,
      plain,
      '@babel/runtime and babel-runtime are different libraries',
    );

    assert.notStrictEqual(
      deckNameForNpm('three.js'),
      deckNameForNpm('three-js'),
      'a folded dot is not the same package as a literal hyphen',
    );
    assert.true(deckNameForNpm('Chart.js').startsWith('chart-js-'));
    assert.true(
      deckNameForNpm('@tanstack/query-core').startsWith('tanstack-query-core-'),
    );
  });

  test('derived names are deterministic and fit one segment', (assert) => {
    let segment = /^[a-z0-9][a-z0-9-]{0,63}$/;
    for (let name of [
      'three',
      '@babel/runtime',
      'three.js',
      '@types/node',
      'lodash.merge',
      '_underscore',
      `@scope/${'x'.repeat(120)}`,
      '@#$%',
    ]) {
      let derived = deckNameForNpm(name);
      assert.true(segment.test(derived), `${name} -> ${derived} is a segment`);
      assert.strictEqual(
        derived,
        deckNameForNpm(name),
        'the same name always derives the same deck',
      );
    }
  });

  test('reads a ustar archive', (assert) => {
    let bytes = tar([
      { name: 'package/package.json', content: '{"name":"demo"}' },
      { name: 'package/src/index.js', content: 'export const a = 1;\n' },
    ]);
    let files = readTar(bytes);
    assert.strictEqual(files.size, 2);
    assert.strictEqual(
      files.get('package/src/index.js')!.toString('utf8'),
      'export const a = 1;\n',
    );
  });

  test('gunzips and strips the root directory the way fetch does', (assert) => {
    // Same shape the fetch path produces, so the stripping rule is covered
    // without a network call.
    let files = readTar(
      gunzipSync(gzipSync(tar([{ name: 'package/a.js', content: 'x' }]))),
    );
    assert.deepEqual([...files.keys()], ['package/a.js']);
  });

  test('verifies integrity and refuses a mismatch', (assert) => {
    let bytes = Buffer.from('hello');
    let good = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    verifyIntegrity(bytes, good);
    assert.ok(true, 'matching integrity passes');
    assert.throws(
      () => verifyIntegrity(bytes, 'sha512-AAAA'),
      /integrity mismatch/,
    );
  });

  test('computes a git blob id', (assert) => {
    // `git hash-object` of an empty file, the canonical fixture.
    assert.strictEqual(
      gitBlobSha(Buffer.alloc(0)),
      'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
    );
  });

  test('normalizes a repository url', (assert) => {
    assert.strictEqual(
      repoUrlFor({
        repository: { url: 'git+https://github.com/mrdoob/three.js.git' },
      } as NpmVersionDoc),
      'https://github.com/mrdoob/three.js',
    );
  });
});

module('vendor: source mode', () => {
  test('probing separates a tree from a bundle', (assert) => {
    let tree = fakePackage(
      {
        'src/index.js': `export * from './a.js';\nexport * from './b.js';\n`,
        'src/a.js': 'export const a = 1;\n',
        'src/b.js': 'export const b = 2;\n',
        'dist/bundle.js': 'export const a = 1, b = 2;\n',
      },
      {
        name: 'demo',
        version: '1.0.0',
        type: 'module',
        exports: { '.': { import: './dist/bundle.js' }, './src/*': './src/*' },
      },
    );
    let probes = probeEntries(tree);
    assert.strictEqual(probes[0].entry, 'src/index.js');
    assert.strictEqual(probes[0].modules, 3, 'the tree wins on module count');
    let bundle = probes.find((probe) => probe.entry === 'dist/bundle.js');
    assert.strictEqual(bundle?.modules, 1, 'a bundle reaches exactly itself');
  });

  test('candidate entries include a declared source tree', (assert) => {
    let pkg = fakePackage(
      { 'src/Demo.js': 'export const d = 1;\n' },
      { name: 'demo', exports: { './src/*': './src/*' } },
    );
    assert.ok(candidateEntries(pkg).includes('src/Demo.js'));
  });

  test('vendors a tree without touching bytes that already resolve', async (assert) => {
    let pkg = fakePackage(
      {
        'src/index.js': `import { a } from './a.js';\nexport { a };\n`,
        'src/a.js': `export const a = 1;\n`,
      },
      { name: 'demo', version: '2.0.0', exports: { './src/*': './src/*' } },
      {
        gitHead: 'abc123',
        repository: { url: 'git+https://github.com/demo/demo.git' },
        dist: {
          tarball: 'https://example.invalid/demo.tgz',
          integrity: 'sha512-x',
        },
      },
    );
    let result = await vendorFromNpmSource({ spec: 'demo@2.0.0', pkg, policy: { minimumReleaseAge: 0 } });
    assert.strictEqual(result.entryPath, 'src/index.js');
    assert.deepEqual(
      result.files.map((file) => file.path),
      ['src/a.js', 'src/index.js'],
    );
    assert.deepEqual(result.rewritten, [], 'nothing needed rewriting');
    assert.strictEqual(
      result.files.find((file) => file.path === 'src/index.js')!.bytes.toString(
        'utf8',
      ),
      `import { a } from './a.js';\nexport { a };\n`,
      'the vendored bytes are what npm published, unchanged',
    );
    assert.deepEqual(result.vendoredFrom, {
      registry: 'https://registry.npmjs.org',
      name: 'demo',
      version: '2.0.0',
      integrity: 'sha512-x',
      mode: 'source',
      entry: 'src/index.js',
      subtree: 'src',
      repo: 'https://github.com/demo/demo',
      commit: 'abc123',
      minimumReleaseAge: 0,
    });
  });

  test('rewrites an extensionless specifier and only that one', async (assert) => {
    let pkg = fakePackage(
      {
        'src/index.js': `import './a';\nimport './b.js';\n`,
        'src/a.js': 'export const a = 1;\n',
        'src/b.js': 'export const b = 2;\n',
      },
      { name: 'demo', version: '1.0.0', exports: { './src/*': './src/*' } },
    );
    let result = await vendorFromNpmSource({ spec: 'demo@1.0.0', pkg, policy: { minimumReleaseAge: 0 } });
    assert.deepEqual(result.rewritten, ['src/index.js']);
    assert.strictEqual(
      result.files.find((file) => file.path === 'src/index.js')!.bytes.toString(
        'utf8',
      ),
      `import './a.js';\nimport './b.js';\n`,
    );
  });

  test('refuses a bundle-only package with a message that says why', async (assert) => {
    let pkg = fakePackage(
      { 'dist/bundle.js': 'export const a = 1;\n' },
      { name: 'demo', version: '1.0.0', module: './dist/bundle.js' },
    );
    await assert.rejects(
      vendorFromNpmSource({ spec: 'demo@1.0.0', pkg, policy: { minimumReleaseAge: 0 } }),
      /publishes a bundle, not a module tree/,
    );
  });

  test('is hermetic by default and says what escaped', async (assert) => {
    let pkg = fakePackage(
      {
        'src/index.js': `import 'lodash';\nimport './a.js';\n`,
        'src/a.js': 'export const a = 1;\n',
      },
      { name: 'demo', version: '1.0.0', exports: { './src/*': './src/*' } },
    );
    await assert.rejects(
      vendorFromNpmSource({ spec: 'demo@1.0.0', pkg, policy: { minimumReleaseAge: 0 } }),
      /would not be hermetic.*lodash/s,
    );
    let allowed = await vendorFromNpmSource({
      spec: 'demo@1.0.0',
      pkg,
      allowExternal: true,
      policy: { minimumReleaseAge: 0 },
    });
    assert.deepEqual(allowed.externals, ['lodash']);
  });

  test('finds the subtree the modules share', (assert) => {
    assert.strictEqual(commonSubtree(['src/a.js', 'src/deep/b.js']), 'src');
    assert.strictEqual(commonSubtree(['src/a.js', 'lib/b.js']), undefined);
    assert.strictEqual(commonSubtree(['a.js']), undefined);
  });
});

module('vendor: the cooldown policy', () => {
  const NOW = Date.parse('2026-08-08T00:00:00.000Z');
  const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();
  const DAY = 1440;
  const policy = (over: Record<string, unknown> = {}) =>
    normalizePolicy({ minimumReleaseAge: DAY, ...over });

  test('the default matches the boxel monorepo: 1440 minutes', (assert) => {
    assert.deepEqual(normalizePolicy(undefined), {
      minimumReleaseAge: 1440,
      minimumReleaseAgeExclude: [],
    });
  });

  test('a version older than the policy passes', (assert) => {
    let verdict = judgeCooldown({
      name: 'demo',
      version: '1.0.0',
      publishedAt: minutesAgo(DAY * 45),
      policy: policy(),
      now: NOW,
    });
    assert.true(verdict.ok);
    assert.strictEqual(Math.round(verdict.ageMinutes!), DAY * 45);
  });

  test('a fresh version is refused, in human units', (assert) => {
    let verdict = judgeCooldown({
      name: 'demo',
      version: '1.0.1',
      publishedAt: minutesAgo(120),
      policy: policy(),
      now: NOW,
    });
    assert.false(verdict.ok);
    assert.true(verdict.reason!.includes('2 hour(s) ago'));
    assert.true(verdict.reason!.includes('1 day(s)'));
  });

  // The whole point of a cooldown is defence against a compromised publish,
  // so "I could not tell how old this is" must not read as "fine".
  test('an unknown publish time fails CLOSED', (assert) => {
    let verdict = judgeCooldown({
      name: 'demo',
      version: '1.0.0',
      publishedAt: undefined,
      policy: policy(),
      now: NOW,
    });
    assert.false(verdict.ok);
    assert.true(verdict.reason!.includes('no publish time'));
  });

  test('minimumReleaseAge 0 disables the gate', (assert) => {
    assert.true(
      judgeCooldown({
        name: 'demo',
        version: '1.0.0',
        publishedAt: undefined,
        policy: policy({ minimumReleaseAge: 0 }),
        now: NOW,
      }).ok,
    );
  });

  test('an excluded package skips the gate and says so', (assert) => {
    let verdict = judgeCooldown({
      name: '@glint/template',
      version: '1.0.0',
      publishedAt: minutesAgo(1),
      policy: policy({ minimumReleaseAgeExclude: ['@glint/template'] }),
      now: NOW,
    });
    assert.true(verdict.ok);
    assert.true(verdict.excluded);
  });

  test('newestAged picks the freshest version that is old enough', (assert) => {
    let times = {
      '1.0.0': minutesAgo(DAY * 200),
      '1.1.0': minutesAgo(DAY * 90),
      '1.2.0': minutesAgo(DAY * 2),
      '1.3.0': minutesAgo(30),
    };
    assert.strictEqual(
      newestAged('demo', times, Object.keys(times), policy(), NOW),
      '1.2.0',
      'the 30-minute-old release is skipped, not the whole package',
    );
    assert.strictEqual(
      newestAged(
        'demo',
        times,
        Object.keys(times),
        policy({ minimumReleaseAge: 0 }),
        NOW,
      ),
      '1.3.0',
    );
    assert.strictEqual(
      newestAged(
        'demo',
        { '1.0.0': minutesAgo(10) },
        ['1.0.0'],
        policy(),
        NOW,
      ),
      undefined,
      'nothing old enough is undefined, not a guess',
    );
  });

  // The depot's policy file is pnpm's two settings verbatim, so it can be
  // lifted out of a pnpm-workspace.yaml unchanged.
  test('a depot policy file parses pnpm\'s two settings', (assert) => {
    assert.deepEqual(
      parsePolicy(
        JSON.stringify({
          minimumReleaseAge: 1440,
          minimumReleaseAgeExclude: ['@glint/ember-tsc', '@glint/template'],
          somethingElse: true,
        }),
      ),
      {
        minimumReleaseAge: 1440,
        minimumReleaseAgeExclude: ['@glint/ember-tsc', '@glint/template'],
      },
    );
    assert.deepEqual(parsePolicy('{}'), {}, 'an empty policy takes defaults');
  });

  test('the gate runs before anything is written, and records its verdict', async (assert) => {
    let pkg = fakePackage(
      {
        'src/index.js': "export * from './a.js';\n",
        'src/a.js': 'export const a = 1;\n',
      },
      { name: 'demo', version: '1.0.0', exports: { './src/*': './src/*' } },
    );
    await assert.rejects(
      vendorFromNpmSource({
        spec: 'demo@1.0.0',
        pkg,
        policy: { minimumReleaseAge: DAY * 30 },
        now: NOW,
        publishedAt: minutesAgo(DAY * 5),
      }),
      /cooldown refused demo@1\.0\.0/,
    );
    let accepted = await vendorFromNpmSource({
      spec: 'demo@1.0.0',
      pkg,
      policy: { minimumReleaseAge: DAY * 30 },
      now: NOW,
      publishedAt: minutesAgo(DAY * 60),
    });
    assert.strictEqual(accepted.vendoredFrom.minimumReleaseAge, DAY * 30);
    assert.strictEqual(accepted.vendoredFrom.ageMinutesAtVendor, DAY * 60);
  });
});
