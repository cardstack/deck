import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  locateSourceMap,
  mapVendorImportMap,
  sourceMappingUrl,
  sourceToTreePath,
  vendorFromSourceMap,
} from '../src/vendor-map.ts';
import type { NpmPackage, NpmVersionDoc } from '../src/npm.ts';

function pkgWith(
  files: Record<string, string>,
  packageJson: Record<string, unknown> = { name: 'demo', version: '1.0.0' },
): NpmPackage {
  let map = new Map<string, Buffer>();
  for (let [path, content] of Object.entries(files)) {
    map.set(path, Buffer.from(content, 'utf8'));
  }
  map.set('package.json', Buffer.from(JSON.stringify(packageJson), 'utf8'));
  return {
    name: packageJson.name as string,
    version: packageJson.version as string,
    packageJson,
    files: map,
    doc: {
      name: packageJson.name,
      version: packageJson.version,
      dist: { tarball: 'https://example.invalid/x.tgz' },
    } as NpmVersionDoc,
  };
}

function mapJson(sources: string[], contents: (string | null)[]) {
  return JSON.stringify({
    version: 3,
    file: 'bundle.js',
    sources,
    sourcesContent: contents,
  });
}

const OFF = { minimumReleaseAge: 0 };

module('map mode: recovering a tree from a bundle', () => {
  test('the sourceMappingURL comment is found', (assert) => {
    assert.strictEqual(
      sourceMappingUrl('code();\n//# sourceMappingURL=bundle.js.map\n'),
      'bundle.js.map',
    );
    assert.strictEqual(sourceMappingUrl('code();\n'), undefined);
  });

  test('sources resolve to repository-relative paths', (assert) => {
    // The common case: the map sits in dist/, the sources are ../src/…
    assert.deepEqual(sourceToTreePath('dist', undefined, '../src/core/x.js'), {
      path: 'src/core/x.js',
      escaped: false,
    });
    assert.deepEqual(sourceToTreePath('dist', undefined, './local.js'), {
      path: 'dist/local.js',
      escaped: false,
    });
    assert.deepEqual(
      sourceToTreePath('dist', undefined, 'webpack://pkg/./src/x.js'),
      { path: 'src/x.js', escaped: false },
    );
    assert.deepEqual(sourceToTreePath('dist', 'src', 'x.js'), {
      path: 'dist/src/x.js',
      escaped: false,
    });
  });

  // Dropping these silently would make the reconstructed tree a lie about
  // what the bundle was built from.
  test('a source outside the package is kept and flagged', (assert) => {
    let result = sourceToTreePath('dist', undefined, '../../shared/util.js');
    assert.true(result.escaped);
    assert.strictEqual(result.path, '_outside/shared/util.js');
  });

  test('a sibling .map is found without a comment', (assert) => {
    let pkg = pkgWith({
      'dist/bundle.js': 'code();\n',
      'dist/bundle.js.map': mapJson(['../src/a.js'], ['export const a = 1;\n']),
    });
    assert.strictEqual(locateSourceMap(pkg, 'dist/bundle.js')?.from, 'dist/bundle.js.map');
  });

  test('an inline base64 map is read', (assert) => {
    let inline = Buffer.from(
      mapJson(['../src/a.js'], ['export const a = 1;\n']),
      'utf8',
    ).toString('base64');
    let pkg = pkgWith({
      'dist/bundle.js': `code();\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${inline}\n`,
    });
    let located = locateSourceMap(pkg, 'dist/bundle.js');
    assert.strictEqual(located?.map.sources[0], '../src/a.js');
    assert.strictEqual(located?.dir, 'dist');
  });

  test('a tree is recovered with its original paths and text', async (assert) => {
    let pkg = pkgWith(
      {
        'dist/bundle.js': 'code();\n//# sourceMappingURL=bundle.js.map\n',
        'dist/bundle.js.map': mapJson(
          ['../src/a.js', '../src/deep/b.js'],
          ['export const a = 1;\n', 'export const b = 2;\n'],
        ),
      },
      { name: 'demo', version: '1.0.0', module: './dist/bundle.js' },
    );
    let result = await vendorFromSourceMap({
      spec: 'demo@1.0.0',
      pkg,
      policy: OFF,
    });
    assert.deepEqual(
      result.files.map((file) => file.path),
      ['src/a.js', 'src/deep/b.js'],
    );
    assert.strictEqual(
      result.files[0].bytes.toString('utf8'),
      'export const a = 1;\n',
    );
    assert.strictEqual(result.vendoredFrom.mode, 'map');
    assert.strictEqual(result.bundleEntry, 'dist/bundle.js');
  });

  // The promise map mode keeps: readable, not runnable. Enforced by the
  // absence of an entry rather than by a warning nobody reads.
  test('the import map declares NO entry, so nothing can import it', async (assert) => {
    let pkg = pkgWith(
      {
        'dist/bundle.js': 'code();\n',
        'dist/bundle.js.map': mapJson(['../src/a.ts'], ['export const a: number = 1;\n']),
      },
      { name: 'demo', version: '1.0.0', module: './dist/bundle.js' },
    );
    let result = await vendorFromSourceMap({
      spec: 'demo@1.0.0',
      pkg,
      policy: OFF,
    });
    let map = JSON.parse(
      mapVendorImportMap('demo', '1.0.0', result).toString('utf8'),
    );
    assert.strictEqual(map.deck.packages.demo.entry, undefined, 'no entry');
    assert.true(map.deck.packages.demo.sourceOnly);
    assert.strictEqual(
      map.deck.packages.demo.recoveredFrom.bundle,
      'dist/bundle.js',
    );
    assert.strictEqual(
      result.files[0].path,
      'src/a.ts',
      'TypeScript sources come back as TypeScript — which is why it cannot run',
    );
  });

  test('a source with no inlined content is reported, not invented', async (assert) => {
    let pkg = pkgWith(
      {
        'dist/bundle.js': 'code();\n',
        'dist/bundle.js.map': mapJson(
          ['../src/a.js', '../src/absent.js'],
          ['export const a = 1;\n', null],
        ),
      },
      { name: 'demo', version: '1.0.0', module: './dist/bundle.js' },
    );
    let result = await vendorFromSourceMap({
      spec: 'demo@1.0.0',
      pkg,
      policy: OFF,
    });
    assert.strictEqual(result.modules, 1);
    assert.deepEqual(result.missingContent, ['../src/absent.js']);
  });

  test('a map with paths but no contents is refused', async (assert) => {
    let pkg = pkgWith(
      {
        'dist/bundle.js': 'code();\n',
        'dist/bundle.js.map': JSON.stringify({
          version: 3,
          sources: ['../src/a.js'],
        }),
      },
      { name: 'demo', version: '1.0.0', module: './dist/bundle.js' },
    );
    await assert.rejects(
      vendorFromSourceMap({ spec: 'demo@1.0.0', pkg, policy: OFF }),
      /no sourcesContent/,
    );
  });

  test('a package with no map is refused, naming the alternative', async (assert) => {
    let pkg = pkgWith(
      { 'dist/bundle.js': 'code();\n' },
      { name: 'demo', version: '1.0.0', module: './dist/bundle.js' },
    );
    await assert.rejects(
      vendorFromSourceMap({ spec: 'demo@1.0.0', pkg, policy: OFF }),
      /ships no source map.*bundle mode/s,
    );
  });

  test('an ESM bundle is preferred over cjs, and minified is avoided', async (assert) => {
    let pkg = pkgWith(
      {
        'dist/bundle.cjs': 'x\n',
        'dist/bundle.cjs.map': mapJson(['../src/cjs.js'], ['//cjs\n']),
        'dist/bundle.min.js': 'x\n',
        'dist/bundle.min.js.map': mapJson(['../src/min.js'], ['//min\n']),
        'dist/bundle.esm.js': 'x\n',
        'dist/bundle.esm.js.map': mapJson(['../src/esm.js'], ['//esm\n']),
      },
      { name: 'demo', version: '1.0.0' },
    );
    let result = await vendorFromSourceMap({
      spec: 'demo@1.0.0',
      pkg,
      policy: OFF,
    });
    assert.strictEqual(result.bundleEntry, 'dist/bundle.esm.js');
  });

  test('the cooldown gate applies to map mode too', async (assert) => {
    let pkg = pkgWith(
      {
        'dist/bundle.js': 'x\n',
        'dist/bundle.js.map': mapJson(['../src/a.js'], ['//a\n']),
      },
      { name: 'demo', version: '1.0.0', module: './dist/bundle.js' },
    );
    await assert.rejects(
      vendorFromSourceMap({
        spec: 'demo@1.0.0',
        pkg,
        policy: { minimumReleaseAge: 1440 },
        publishedAt: new Date(Date.parse('2026-08-08') - 3600_000).toISOString(),
        now: Date.parse('2026-08-08'),
      }),
      /cooldown refused/,
    );
  });
});
