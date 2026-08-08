import QUnit from 'qunit';
const { module, test } = QUnit;
import { gunzipSync } from 'node:zlib';
import {
  isCompressibleType,
  negotiateBody,
  negotiateEncoding,
} from '../src/compression.ts';
import {
  formatDeckUrl,
  injectModulePreload,
  moduleClosure,
  parseDeckUrl,
  resolveSpecifier,
} from '../src/preload.ts';

const BIG = Buffer.from('export const x = 1;\n'.repeat(300)); // ~6 KB

module('B: wire compression', () => {
  // Origin is gzip-only on purpose: Cloudflare terminates h2/h3 and does
  // brotli at the edge, so burning origin CPU on bytes the edge re-encodes
  // would be paying twice for one thing.
  test('gzip is offered; brotli is the edge\'s job', (assert) => {
    assert.strictEqual(negotiateEncoding('gzip, deflate, br'), 'gzip');
    assert.strictEqual(negotiateEncoding('gzip, deflate'), 'gzip');
    assert.strictEqual(negotiateEncoding('br'), undefined, 'not offered here');
    assert.strictEqual(negotiateEncoding('deflate'), undefined);
    assert.strictEqual(negotiateEncoding(undefined), undefined);
  });

  // q=0 is a refusal, not a low preference — the detail naive parsers miss.
  test('q=0 is a refusal', (assert) => {
    assert.strictEqual(negotiateEncoding('br;q=0, gzip'), 'gzip');
    assert.strictEqual(negotiateEncoding('gzip;q=0'), undefined);
    assert.strictEqual(negotiateEncoding('gzip;q=0, *;q=1'), undefined);
    assert.strictEqual(negotiateEncoding('*'), 'gzip', 'a wildcard permits it');
  });

  test('only text types compress', (assert) => {
    for (let type of [
      'application/javascript',
      'text/html; charset=utf-8',
      'application/json',
      'image/svg+xml',
    ]) {
      assert.true(isCompressibleType(type), type);
    }
    for (let type of ['application/zip', 'image/png', 'application/wasm', undefined]) {
      assert.false(isCompressibleType(type), String(type));
    }
  });

  test('a compressed body round-trips', (assert) => {
    let gz = negotiateBody({
      body: BIG,
      contentType: 'application/javascript',
      acceptEncoding: 'gzip',
    });
    assert.strictEqual(gz.encoding, 'gzip');
    assert.true(gz.body.length < BIG.length / 2, 'meaningfully smaller');
    assert.true(gunzipSync(gz.body).equals(BIG));
  });

  // Without Vary a shared cache hands brotli to a gzip-only client.
  test('Vary is set whenever negotiation was considered', (assert) => {
    assert.true(
      negotiateBody({
        body: BIG,
        contentType: 'application/javascript',
        acceptEncoding: 'identity',
      }).vary,
      'even when nothing was applied',
    );
    assert.false(
      negotiateBody({
        body: BIG,
        contentType: 'application/zip',
        acceptEncoding: 'gzip',
      }).vary,
      'not for a type that never compresses',
    );
  });

  test('tiny bodies and already-encoded bodies are left alone', (assert) => {
    let tiny = negotiateBody({
      body: Buffer.from('export const a = 1;\n'),
      contentType: 'application/javascript',
      acceptEncoding: 'gzip',
    });
    assert.strictEqual(tiny.encoding, undefined, 'framing would cost more');
    assert.strictEqual(
      negotiateBody({
        body: BIG,
        contentType: 'application/javascript',
        acceptEncoding: 'gzip',
        alreadyEncoded: true,
      }).encoding,
      undefined,
    );
  });

  test('a precompressed sibling is served instead of recompressing', (assert) => {
    let stored = Buffer.from('pretend-precompressed');
    let result = negotiateBody({
      body: BIG,
      contentType: 'application/javascript',
      acceptEncoding: 'gzip',
      precompressed: { gzip: stored },
    });
    assert.strictEqual(result.encoding, 'gzip');
    assert.true(result.body.equals(stored));
  });
});

module('C: closure preload', () => {
  test('deck URLs parse and format', (assert) => {
    assert.deepEqual(parseDeckUrl('/site/lib/three@0.160.0/src/Three.js'), {
      realm: 'site',
      publisher: 'lib',
      pkg: 'three',
      version: '0.160.0',
      path: 'src/Three.js',
    });
    assert.strictEqual(
      formatDeckUrl(parseDeckUrl('/site/lib/three@0.160.0/src/a.js')!),
      '/site/lib/three@0.160.0/src/a.js',
    );
    assert.strictEqual(parseDeckUrl('not-a-deck-url'), undefined);
  });

  test('resolution follows the import-map algorithm', (assert) => {
    let imports = {
      three: '/site/lib/three@1/src/Three.js',
      'three/': '/site/lib/three@1/',
    };
    assert.strictEqual(
      resolveSpecifier({ specifier: 'three', fromUrl: '/a', imports, scopes: {} }),
      '/site/lib/three@1/src/Three.js',
      'exact key wins',
    );
    assert.strictEqual(
      resolveSpecifier({
        specifier: 'three/extras/x.js',
        fromUrl: '/a',
        imports,
        scopes: {},
      }),
      '/site/lib/three@1/extras/x.js',
      'longest trailing-slash prefix, remainder appended',
    );
  });

  // The reason scopes exist: a vendored dependency's bare specifiers resolve
  // through ITS records, not the app's. Getting this wrong preloads URLs
  // nobody requests.
  test('a scope beats the global map for modules inside it', (assert) => {
    let resolved = resolveSpecifier({
      specifier: 'three',
      fromUrl: '/site/lib/three-bvh-csg@1/src/index.js',
      imports: { three: '/site/other/three@9/src/Three.js' },
      scopes: {
        '/site/lib/three-bvh-csg@1/': { three: '/site/lib/three@1/src/Three.js' },
      },
    });
    assert.strictEqual(resolved, '/site/lib/three@1/src/Three.js');
  });

  function reader(files: Record<string, string>) {
    return async (url: { realm: string; publisher: string; pkg: string; version?: string; path: string }) => {
      let key = formatDeckUrl(url);
      return files[key] ? Buffer.from(files[key]) : undefined;
    };
  }

  test('the closure crosses decks and is breadth-first', async (assert) => {
    let files = {
      '/site/me/app@1/app.js': "import 'lib';\nimport './local.js';\n",
      '/site/me/app@1/local.js': "import './deep.js';\n",
      '/site/me/app@1/deep.js': 'export const d = 1;\n',
      '/site/lib/thing@1/index.js': "import './helper.js';\n",
      '/site/lib/thing@1/helper.js': 'export const h = 1;\n',
    };
    let closure = await moduleClosure({
      entries: ['/site/me/app@1/app.js'],
      imports: { lib: '/site/lib/thing@1/index.js' },
      read: reader(files),
    });
    assert.deepEqual(closure.urls, [
      '/site/me/app@1/app.js',
      '/site/lib/thing@1/index.js',
      '/site/me/app@1/local.js',
      '/site/lib/thing@1/helper.js',
      '/site/me/app@1/deep.js',
    ]);
    assert.strictEqual(closure.total, 5);
    assert.false(closure.truncated);
  });

  test('a cycle terminates', async (assert) => {
    let files = {
      '/site/me/app@1/a.js': "import './b.js';\n",
      '/site/me/app@1/b.js': "import './a.js';\n",
    };
    let closure = await moduleClosure({
      entries: ['/site/me/app@1/a.js'],
      imports: {},
      read: reader(files),
    });
    assert.strictEqual(closure.total, 2);
  });

  // A cap nobody can see reads as "we covered it".
  test('the byte budget clips the DEEPEST modules and says so', async (assert) => {
    let files: Record<string, string> = {
      '/site/me/app@1/a.js': "import './b.js';\n",
      '/site/me/app@1/b.js': "import './c.js';\n",
      '/site/me/app@1/c.js': 'export const c = 1;\n',
    };
    let closure = await moduleClosure({
      entries: ['/site/me/app@1/a.js'],
      imports: {},
      read: reader(files),
      byteBudget: 40,
    });
    assert.true(closure.truncated);
    assert.strictEqual(closure.total, 3);
    assert.deepEqual(
      closure.urls,
      ['/site/me/app@1/a.js', '/site/me/app@1/b.js'],
      'the shallowest survive — their round trip is the one worth buying',
    );
  });

  test('preloads land after the import map, with crossorigin', (assert) => {
    let html = Buffer.from(
      '<head><script type="importmap">{}</script></head><body></body>',
    );
    let { bytes, injected } = injectModulePreload(html, ['/site/a@1/x.js']);
    let text = bytes.toString('utf8');
    assert.strictEqual(injected, 1);
    assert.true(
      text.includes(
        '</script><link rel="modulepreload" href="/site/a@1/x.js" crossorigin>',
      ),
      'after the map that resolves it',
    );
  });

  test('injecting nothing changes nothing', (assert) => {
    let html = Buffer.from('<head></head>');
    let result = injectModulePreload(html, []);
    assert.strictEqual(result.injected, 0);
    assert.true(result.bytes.equals(html));
  });
});
