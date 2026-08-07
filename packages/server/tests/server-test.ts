import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { pack, unpack } from '@deck/core/pack';
import { publishToStore, readStoreMeta } from '@deck/core/store';
import { createDeckServer } from '../src/server.ts';

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
                entry: '$REALM/confetti.js',
                exports: { './main': '$REALM/confetti.js' },
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

module('deck server', function (hooks) {
  hooks.before(async function () {
    storeDir = await mkdtemp(join(tmpdir(), 'deck-server-test-'));
    let confetti10 = pack(confettiFiles('1.0.0', CONFETTI_JS_10));
    await publishToStore(storeDir, 'confetti', '1.0.0', confetti10, {
      tag: 'latest',
    });
    await publishToStore(
      storeDir,
      'confetti',
      '1.1.0',
      pack(confettiFiles('1.1.0', CONFETTI_JS_11)),
    );
    // the app VENDORS the confetti 1.0.0 pack inside its own tree
    let appPack = pack([
      {
        path: 'importmap.json',
        bytes: Buffer.from(
          JSON.stringify({
            imports: { 'confetti/': '$REALM/vendor/confetti.pack.zip!/' },
            deck: {
              packages: {
                app: { version: '1.0.0', entry: '$REALM/app.js' },
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
    await publishToStore(storeDir, 'app', '1.0.0', appPack, { tag: 'latest' });

    server = createDeckServer({ storeDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.after(async function () {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(storeDir, { recursive: true, force: true });
  });

  test('store refuses re-publishing an existing version', async function (assert) {
    await assert.rejects(
      publishToStore(
        storeDir,
        'confetti',
        '1.0.0',
        pack(confettiFiles('1.0.0', CONFETTI_JS_10)),
      ),
      /already published/,
      'published versions are immutable',
    );
  });

  test('_packages lists versions with treeHash and dist-tags', async function (assert) {
    let response = await fetch(`${origin}/_packages/confetti`);
    assert.strictEqual(response.status, 200);
    let body = await response.json();
    let attrs = body.data.attributes;
    assert.deepEqual(Object.keys(attrs.versions).sort(), ['1.0.0', '1.1.0']);
    assert.true(/^[0-9a-f]{64}$/.test(attrs.versions['1.0.0'].treeHash));
    assert.deepEqual(attrs.distTags, { latest: '1.0.0' });
  });

  test('exact-version raw bytes: immutable + Content-Digest', async function (assert) {
    let response = await fetch(`${origin}/@confetti@1.0.0/confetti.js`);
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
      'confetti@1.0.0',
    );
    assert.true(
      response.headers.get('content-type')!.startsWith('text/javascript'),
    );
  });

  test('extensionless specifiers probe .js', async function (assert) {
    let response = await fetch(`${origin}/@confetti@1.0.0/confetti`, {
      redirect: 'manual',
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), CONFETTI_JS_10);
  });

  test('tag and range resolve in ONE short-TTL hop', async function (assert) {
    let tagged = await fetch(`${origin}/@confetti@latest/confetti.js`, {
      redirect: 'manual',
    });
    assert.strictEqual(tagged.status, 302);
    assert.strictEqual(
      tagged.headers.get('location'),
      '/@confetti@1.0.0/confetti.js',
    );
    assert.strictEqual(
      tagged.headers.get('cache-control'),
      'public, max-age=60, s-maxage=300',
    );

    let bareTag = await fetch(`${origin}/@confetti@latest`, {
      redirect: 'manual',
    });
    assert.strictEqual(bareTag.status, 302);
    assert.strictEqual(
      bareTag.headers.get('location'),
      '/@confetti@1.0.0/confetti.js',
      'bare tag → exact entry path, one hop',
    );

    let range = await fetch(`${origin}/@confetti@%5E1.0.0/confetti.js`, {
      redirect: 'manual',
    });
    assert.strictEqual(range.status, 302);
    assert.strictEqual(
      range.headers.get('location'),
      '/@confetti@1.1.0/confetti.js',
      '^1.0.0 resolves to the highest satisfying version',
    );
  });

  test('exact-version FORM redirects are permanent', async function (assert) {
    let bare = await fetch(`${origin}/@confetti@1.0.0`, {
      redirect: 'manual',
    });
    assert.strictEqual(bare.status, 301);
    assert.strictEqual(
      bare.headers.get('location'),
      '/@confetti@1.0.0/confetti.js',
    );
    assert.strictEqual(
      bare.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );

    let alias = await fetch(`${origin}/@confetti@1.0.0/main`, {
      redirect: 'manual',
    });
    assert.strictEqual(alias.status, 301);
    assert.strictEqual(
      alias.headers.get('location'),
      '/@confetti@1.0.0/confetti.js',
    );
  });

  test('?meta is the machine-readable listing; query survives redirects', async function (assert) {
    let redirected = await fetch(`${origin}/@confetti@latest?meta`, {
      redirect: 'manual',
    });
    assert.strictEqual(redirected.status, 302);
    assert.strictEqual(
      redirected.headers.get('location'),
      '/@confetti@1.0.0?meta',
      'the query string survives the redirect',
    );

    let response = await fetch(`${origin}/@confetti@1.0.0?meta`);
    assert.strictEqual(response.status, 200);
    let attrs = (await response.json()).data.attributes;
    assert.strictEqual(attrs.entry, 'confetti.js');
    assert.deepEqual(attrs.exports, { './main': 'confetti.js' });
    assert.strictEqual(attrs.baseApi, '^1.0.0');
    assert.deepEqual(attrs.files.sort(), [
      'README.md',
      'confetti.js',
      'importmap.json',
      'util/colors.js',
    ]);
    let storeMeta = await readStoreMeta(storeDir, 'confetti');
    assert.strictEqual(
      attrs.treeHash,
      storeMeta!.versions['1.0.0'].treeHash,
      'meta treeHash equals the stored identity',
    );
  });

  test('?format=pack serves the faithful sealed bytes', async function (assert) {
    let response = await fetch(`${origin}/@confetti@1.0.0?format=pack`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'application/zip');
    let bytes = Buffer.from(await response.arrayBuffer());
    let opened = unpack(bytes);
    let storeMeta = await readStoreMeta(storeDir, 'confetti');
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
      `${origin}/@app@1.0.0/vendor/confetti.pack.zip!/confetti.js`,
    );
    assert.strictEqual(inner.status, 200);
    assert.strictEqual(await inner.text(), CONFETTI_JS_10);
    assert.strictEqual(
      inner.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );

    let nestedFromMap = await fetch(
      `${origin}/@app@1.0.0/vendor/confetti.pack.zip!/util/colors.js`,
    );
    assert.strictEqual(nestedFromMap.status, 200);
    assert.true((await nestedFromMap.text()).includes('COLORS'));

    let missing = await fetch(
      `${origin}/@app@1.0.0/vendor/confetti.pack.zip!/nope.js`,
    );
    assert.strictEqual(missing.status, 404);
    assert.strictEqual((await missing.json()).errors[0].code, 'file-not-found');
  });

  test('negative caching tiers by permanence', async function (assert) {
    let invalid = await fetch(`${origin}/@confetti@_bogus_/x.js`);
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

    let unknownTag = await fetch(`${origin}/@confetti@canary/x.js`);
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

    let unknownPackage = await fetch(`${origin}/_packages/nope`);
    assert.strictEqual(unknownPackage.status, 404);
    assert.strictEqual(
      (await unknownPackage.json()).errors[0].code,
      'package-not-found',
    );
  });

  test('HEAD rides the GET path with no body', async function (assert) {
    let response = await fetch(`${origin}/@confetti@1.0.0/confetti.js`, {
      method: 'HEAD',
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get('x-deck-package'),
      'confetti@1.0.0',
    );
    assert.strictEqual(await response.text(), '');
  });

  test('writes are refused — the server is read-only at-rest serving', async function (assert) {
    let response = await fetch(`${origin}/@confetti@1.0.0/confetti.js`, {
      method: 'POST',
    });
    assert.strictEqual(response.status, 405);
  });
});
