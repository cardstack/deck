import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { pack, unpack } from '@deck/core/pack';
import { publishToStore, readStoreMeta } from '@deck/core/store';
import { createDeckServer } from '../src/server.ts';
import { storeDirFor, type DepotMount } from '../src/depot.ts';

let root: string;
let depotDir: string;
let storeDir: string;
let server: Server;
let origin: string;

const CONFETTI_JS_10 = `import { COLORS } from './util/colors.js';\nexport function confetti() { return COLORS; }\n`;
const CONFETTI_JS_11 = `import { COLORS } from './util/colors.js';\nexport function confetti() { return [...COLORS, 'gold']; }\n`;

function confettiFiles(version: string, source: string) {
  return [
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify({
          imports: {},
          deck: {
            packages: {
              confetti: {
                version,
                entry: '$DECK/confetti.js',
                exports: { './main': '$DECK/confetti.js' },
                baseApi: '^1.0.0',
              },
            },
          },
        }),
      ),
    },
    { path: 'confetti.js', bytes: Buffer.from(source) },
    {
      path: 'util/colors.js',
      bytes: Buffer.from(`export const COLORS = ['red', 'teal'];\n`),
    },
    { path: 'README.md', bytes: Buffer.from('# confetti\n') },
  ];
}

module('deck server: depots on disk', function (hooks) {
  hooks.before(async function () {
    root = await mkdtemp(join(tmpdir(), 'deck-server-test-'));
    depotDir = join(root, 'demo');
    storeDir = storeDirFor(depotDir);
    // The live tree — the same paths the URL uses.
    await mkdir(join(depotDir, 'acme', 'confetti'), { recursive: true });
    await writeFile(
      join(depotDir, 'acme', 'confetti', 'importmap.json'),
      JSON.stringify({
        deck: {
          packages: {
            confetti: { version: '1.1.0', entry: '$DECK/confetti.js' },
          },
        },
      }),
    );
    await writeFile(
      join(depotDir, 'acme', 'confetti', 'confetti.js'),
      CONFETTI_JS_11,
    );

    let confetti10 = pack(confettiFiles('1.0.0', CONFETTI_JS_10));
    await publishToStore(storeDir, 'acme/confetti', '1.0.0', confetti10, {
      tag: 'latest',
    });
    await publishToStore(
      storeDir,
      'acme/confetti',
      '1.1.0',
      pack(confettiFiles('1.1.0', CONFETTI_JS_11)),
    );
    // the app VENDORS the confetti 1.0.0 pack inside its own tree
    let appPack = pack([
      {
        path: 'importmap.json',
        bytes: Buffer.from(
          JSON.stringify({
            imports: { 'confetti/': '$DECK/vendor/confetti.pack.zip!/' },
            deck: {
              packages: {
                app: { version: '1.0.0', entry: '$DECK/app.js' },
              },
            },
          }),
        ),
      },
      {
        path: 'app.js',
        bytes: Buffer.from(
          `import { confetti } from 'confetti/confetti.js';\nexport const boom = confetti;\n`,
        ),
      },
      { path: 'vendor/confetti.pack.zip', bytes: confetti10 },
    ]);
    await publishToStore(storeDir, 'acme/app', '1.0.0', appPack, {
      tag: 'latest',
    });

    // A page written the way nearly every page is written: a relative script
    // src and no hand-written import map. It exists to hold the closure walk
    // honest end to end — see the test below.
    await publishToStore(
      storeDir,
      'acme/page',
      '1.0.0',
      pack([
        {
          path: 'importmap.json',
          bytes: Buffer.from(
            JSON.stringify({
              imports: { 'confetti/': '/demo/acme/confetti@1.0.0/' },
              deck: {
                packages: {
                  page: { version: '1.0.0', entry: '$DECK/boot.js' },
                },
              },
            }),
          ),
        },
        {
          path: 'index.html',
          bytes: Buffer.from(
            `<!doctype html><body><script type="module" src="./boot.js"></script></body>`,
          ),
        },
        {
          path: 'boot.js',
          bytes: Buffer.from(
            `import { confetti } from 'confetti/confetti.js';\nexport const boom = confetti;\n`,
          ),
        },
      ]),
      { tag: 'latest' },
    );

    let depot: DepotMount = { name: 'demo', dir: depotDir, storeDir };
    server = createDeckServer({ depots: [depot] });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.after(async function () {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  });

  test('store refuses re-publishing an existing version', async function (assert) {
    await assert.rejects(
      publishToStore(
        storeDir,
        'acme/confetti',
        '1.0.0',
        pack(confettiFiles('1.0.0', CONFETTI_JS_10)),
      ),
      /already published/,
      'published versions are immutable',
    );
  });

  test('the store path mirrors the URL path', async function (assert) {
    let meta = await readStoreMeta(storeDir, 'acme/confetti');
    assert.strictEqual(meta!.name, 'acme/confetti');
    assert.strictEqual(
      storeDir,
      join(depotDir, '.deck', 'store'),
      'a depot carries its own versions, inside itself',
    );
    let body = await (await fetch(`${origin}/_packages/demo/acme/confetti`)).json();
    let attrs = body.data.attributes;
    assert.strictEqual(attrs.storePath, '.deck/store/acme/confetti/');
    assert.deepEqual(Object.keys(attrs.versions).sort(), ['1.0.0', '1.1.0']);
    assert.true(/^[0-9a-f]{64}$/.test(attrs.versions['1.0.0'].treeHash));
    assert.deepEqual(attrs.distTags, { latest: '1.0.0' });
    assert.true(attrs.live, 'the deck is also on disk, live');
  });

  test('a version-less path is the working tree, exactly as a depot serves it', async function (assert) {
    let response = await fetch(`${origin}/demo/acme/confetti/confetti.js`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), CONFETTI_JS_11);
    assert.strictEqual(
      response.headers.get('cache-control'),
      'no-store',
      'the live tree is never cached',
    );
    assert.strictEqual(response.headers.get('x-deck-depot'), 'demo');

    // …and the same path with a version reads the seal instead.
    let sealed = await fetch(`${origin}/demo/acme/confetti@1.0.0/confetti.js`);
    assert.strictEqual(await sealed.text(), CONFETTI_JS_10);
  });

  test('a bare deck path redirects to its declared entry module', async function (assert) {
    let response = await fetch(`${origin}/demo/acme/confetti`, {
      redirect: 'manual',
    });
    assert.strictEqual(response.status, 302);
    assert.strictEqual(
      response.headers.get('location'),
      '/demo/acme/confetti/confetti.js',
    );
    assert.strictEqual(response.headers.get('cache-control'), 'no-store');
  });

  test("a depot's own machinery is not servable", async function (assert) {
    for (let path of [
      '/demo/.deck/store/acme/confetti/meta.json',
      '/demo/.jj/repo',
      '/demo/acme/../.deck/store',
    ]) {
      let response = await fetch(`${origin}${path}`);
      assert.strictEqual(response.status, 404, path);
    }
    let unknownDepot = await fetch(`${origin}/nope/acme/confetti/confetti.js`);
    assert.strictEqual(unknownDepot.status, 404);
  });

  test('exact-version raw bytes: immutable + Content-Digest', async function (assert) {
    let response = await fetch(`${origin}/demo/acme/confetti@1.0.0/confetti.js`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), CONFETTI_JS_10);
    assert.strictEqual(
      response.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );
    assert.true(
      /^sha-256=:[A-Za-z0-9+/]+=*:$/.test(
        response.headers.get('content-digest') ?? '',
      ),
      'RFC 9530 Content-Digest present',
    );
    assert.strictEqual(
      response.headers.get('x-deck-package'),
      'acme/confetti@1.0.0',
    );
    assert.true(
      response.headers.get('content-type')!.startsWith('text/javascript'),
    );
  });

  test('extensionless specifiers probe .js', async function (assert) {
    let sealed = await fetch(`${origin}/demo/acme/confetti@1.0.0/confetti`, {
      redirect: 'manual',
    });
    assert.strictEqual(sealed.status, 200);
    assert.strictEqual(await sealed.text(), CONFETTI_JS_10);

    let live = await fetch(`${origin}/demo/acme/confetti/confetti`, {
      redirect: 'manual',
    });
    assert.strictEqual(live.status, 200, 'the live tree probes too');
    assert.strictEqual(await live.text(), CONFETTI_JS_11);
  });

  test('tag and range resolve in ONE short-TTL hop', async function (assert) {
    let tagged = await fetch(`${origin}/demo/acme/confetti@latest/confetti.js`, {
      redirect: 'manual',
    });
    assert.strictEqual(tagged.status, 302);
    assert.strictEqual(
      tagged.headers.get('location'),
      '/demo/acme/confetti@1.0.0/confetti.js',
    );
    assert.strictEqual(
      tagged.headers.get('cache-control'),
      'public, max-age=60, s-maxage=300',
    );

    let bareTag = await fetch(`${origin}/demo/acme/confetti@latest`, {
      redirect: 'manual',
    });
    assert.strictEqual(bareTag.status, 302);
    assert.strictEqual(
      bareTag.headers.get('location'),
      '/demo/acme/confetti@1.0.0/confetti.js',
      'bare tag → exact entry path, one hop',
    );

    let range = await fetch(
      `${origin}/demo/acme/confetti@%5E1.0.0/confetti.js`,
      { redirect: 'manual' },
    );
    assert.strictEqual(range.status, 302);
    assert.strictEqual(
      range.headers.get('location'),
      '/demo/acme/confetti@1.1.0/confetti.js',
      '^1.0.0 resolves to the highest satisfying version',
    );
  });

  test('exact-version FORM redirects are permanent', async function (assert) {
    let bare = await fetch(`${origin}/demo/acme/confetti@1.0.0`, {
      redirect: 'manual',
    });
    assert.strictEqual(bare.status, 301);
    assert.strictEqual(
      bare.headers.get('location'),
      '/demo/acme/confetti@1.0.0/confetti.js',
    );
    assert.strictEqual(
      bare.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );

    let alias = await fetch(`${origin}/demo/acme/confetti@1.0.0/main`, {
      redirect: 'manual',
    });
    assert.strictEqual(alias.status, 301);
    assert.strictEqual(
      alias.headers.get('location'),
      '/demo/acme/confetti@1.0.0/confetti.js',
    );
  });

  test('?meta is the machine-readable listing; query survives redirects', async function (assert) {
    let redirected = await fetch(`${origin}/demo/acme/confetti@latest?meta`, {
      redirect: 'manual',
    });
    assert.strictEqual(redirected.status, 302);
    assert.strictEqual(
      redirected.headers.get('location'),
      '/demo/acme/confetti@1.0.0?meta',
      'the query string survives the redirect',
    );

    let response = await fetch(`${origin}/demo/acme/confetti@1.0.0?meta`);
    assert.strictEqual(response.status, 200);
    let attrs = (await response.json()).data.attributes;
    assert.strictEqual(attrs.depot, 'demo');
    assert.strictEqual(attrs.publisher, 'acme');
    assert.strictEqual(attrs.name, 'confetti');
    assert.strictEqual(attrs.entry, 'confetti.js');
    assert.deepEqual(attrs.exports, { './main': 'confetti.js' });
    assert.strictEqual(attrs.baseApi, '^1.0.0');
    assert.deepEqual(attrs.files.sort(), [
      'README.md',
      'confetti.js',
      'importmap.json',
      'util/colors.js',
    ]);
    let storeMeta = await readStoreMeta(storeDir, 'acme/confetti');
    assert.strictEqual(
      attrs.treeHash,
      storeMeta!.versions['1.0.0'].treeHash,
      'meta treeHash equals the stored identity',
    );
  });

  test('?format=pack serves the faithful sealed bytes', async function (assert) {
    let response = await fetch(
      `${origin}/demo/acme/confetti@1.0.0?format=pack`,
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'application/zip');
    let bytes = Buffer.from(await response.arrayBuffer());
    let opened = unpack(bytes);
    let storeMeta = await readStoreMeta(storeDir, 'acme/confetti');
    assert.strictEqual(
      opened.treeHash,
      storeMeta!.versions['1.0.0'].treeHash,
      'the served pack IS the published version',
    );
    assert.strictEqual(
      response.headers.get('x-deck-tree-hash'),
      opened.treeHash,
    );
    assert.true(opened.files.get('confetti.js')!.toString() === CONFETTI_JS_10);
  });

  test('!/ mounts serve files from a pack vendored inside a deck', async function (assert) {
    let inner = await fetch(
      `${origin}/demo/acme/app@1.0.0/vendor/confetti.pack.zip!/confetti.js`,
    );
    assert.strictEqual(inner.status, 200);
    assert.strictEqual(await inner.text(), CONFETTI_JS_10);
    assert.strictEqual(
      inner.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );

    let nestedFromMap = await fetch(
      `${origin}/demo/acme/app@1.0.0/vendor/confetti.pack.zip!/util/colors.js`,
    );
    assert.strictEqual(nestedFromMap.status, 200);
    assert.true((await nestedFromMap.text()).includes('COLORS'));

    let missing = await fetch(
      `${origin}/demo/acme/app@1.0.0/vendor/confetti.pack.zip!/nope.js`,
    );
    assert.strictEqual(missing.status, 404);
    assert.strictEqual((await missing.json()).errors[0].code, 'file-not-found');
  });

  test('negative caching tiers by permanence', async function (assert) {
    let invalid = await fetch(`${origin}/demo/acme/confetti@_bogus_/x.js`);
    assert.strictEqual(invalid.status, 404);
    assert.strictEqual(
      (await invalid.json()).errors[0].code,
      'invalid-version-spec',
    );
    assert.strictEqual(
      invalid.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
      'grammar-invalid specs are refused permanently',
    );

    let unknownTag = await fetch(`${origin}/demo/acme/confetti@canary/x.js`);
    assert.strictEqual(unknownTag.status, 404);
    assert.strictEqual(
      (await unknownTag.json()).errors[0].code,
      'version-not-found',
    );
    assert.strictEqual(
      unknownTag.headers.get('cache-control'),
      'public, max-age=60, s-maxage=300',
      'a legal tag shape is publishable tomorrow — transient',
    );

    let unknownPackage = await fetch(`${origin}/_packages/demo/acme/nope`);
    assert.strictEqual(unknownPackage.status, 404);
    assert.strictEqual(
      (await unknownPackage.json()).errors[0].code,
      'package-not-found',
    );
  });

  test('HEAD rides the GET path with no body', async function (assert) {
    let response = await fetch(
      `${origin}/demo/acme/confetti@1.0.0/confetti.js`,
      { method: 'HEAD' },
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get('x-deck-package'),
      'acme/confetti@1.0.0',
    );
    assert.strictEqual(await response.text(), '');
  });

  // Two bugs met here and hid each other. `documentEntries` only accepted an
  // absolute script src, and the sealed route built the document URL by
  // pasting a slash-less tree path on — `…@1.0.0index.html`. Either one alone
  // empties the closure, and an empty closure is invisible: the page still
  // works, the header simply does not appear. So the assertion has to be that
  // the walk actually CROSSED a deck boundary, not merely that it ran.
  test('a sealed page with a relative src advertises its real closure', async function (assert) {
    let response = await fetch(`${origin}/demo/acme/page@1.0.0/index.html`);
    let html = await response.text();
    assert.strictEqual(
      response.headers.get('x-deck-preload'),
      '3/3',
      'boot.js, the confetti module it imports, and that module’s own import',
    );
    assert.ok(
      html.includes(
        '<link rel="modulepreload" href="/demo/acme/page@1.0.0/boot.js" crossorigin>',
      ),
      'the relative src is the graph root',
    );
    assert.ok(
      html.includes('/demo/acme/confetti@1.0.0/util/colors.js'),
      'and the walk reached two hops into another deck',
    );
  });

  // `/` is the store browser by default. An embedder that passes a fallback
  // has an app to put at the root, and taking `/` from it made the option
  // silently do nothing — which is exactly what every demo in examples/ hit.
  test('a fallback owns the root; /_browser is still the browser', async function (assert) {
    let other = createDeckServer({
      depots: [{ name: 'demo', dir: depotDir, storeDir }],
      fallback: (_req, res) => {
        res.writeHead(302, { location: '/demo/acme/app@1.0.0/app.js' });
        res.end();
      },
    });
    await new Promise<void>((resolve) => other.listen(0, resolve));
    let base = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    try {
      let root = await fetch(base, { redirect: 'manual' });
      assert.strictEqual(root.status, 302, 'the root belongs to the app');
      assert.strictEqual(
        root.headers.get('location'),
        '/demo/acme/app@1.0.0/app.js',
      );
      let browser = await fetch(`${base}/_browser`);
      assert.ok(
        (await browser.text()).includes('Deck store browser'),
        'and the browser is still one path away',
      );
      // Without a fallback the root is unchanged.
      assert.ok(
        (await (await fetch(origin)).text()).includes('Deck store browser'),
        'the default root is still the store browser',
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        other.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  test('writes are refused — the server is read-only at-rest serving', async function (assert) {
    let response = await fetch(
      `${origin}/demo/acme/confetti@1.0.0/confetti.js`,
      { method: 'POST' },
    );
    assert.strictEqual(response.status, 405);
  });
});
