import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { pack } from '@deck/core/pack';
import { publishToStore } from '@deck/core/store';
import { createDeckServer } from '../src/server.ts';

let workDir: string;
let storeDir: string;
let liveDir: string;
let server: Server;
let origin: string;

module('deck browser API', function (hooks) {
  hooks.before(async function () {
    workDir = await mkdtemp(join(tmpdir(), 'deck-browse-test-'));
    storeDir = join(workDir, 'store');
    liveDir = join(workDir, 'lib');
    await mkdir(liveDir, { recursive: true });
    await writeFile(
      join(liveDir, 'importmap.json'),
      JSON.stringify({
        imports: {},
        deck: {
          packages: { lib: { version: '1.0.0', entry: '$REALM/index.js' } },
        },
      }),
    );
    await writeFile(join(liveDir, 'index.js'), 'export const n = 1;\n');
    await mkdir(join(liveDir, 'util'), { recursive: true });
    await writeFile(join(liveDir, 'util', 'math.js'), 'export const add = 1;\n');

    let bytes = pack([
      {
        path: 'importmap.json',
        bytes: Buffer.from(
          JSON.stringify({
            imports: {},
            deck: {
              packages: {
                lib: { version: '1.0.0', entry: '$REALM/index.js' },
              },
            },
          }),
        ),
      },
      { path: 'index.js', bytes: Buffer.from('export const n = 1;\n') },
      { path: 'util/math.js', bytes: Buffer.from('export const add = 1;\n') },
    ]);
    await publishToStore(storeDir, 'lib', '1.0.0', bytes, { tag: 'latest' });
    await publishToStore(storeDir, 'lib', '1.0.0-dev.1', bytes, { tag: 'dev' });

    server = createDeckServer({
      storeDir,
      live: { lib: liveDir },
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.after(async function () {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(workDir, { recursive: true, force: true });
  });

  test('GET / serves the deck browser', async function (assert) {
    let res = await fetch(`${origin}/`);
    assert.equal(res.status, 200);
    let html = await res.text();
    assert.true(html.includes('Deck'));
    assert.true(html.includes('/_packages'));
  });

  test('GET /_packages lists store + live packages', async function (assert) {
    let res = await fetch(`${origin}/_packages`);
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].name, 'lib');
    assert.true(body.data[0].live);
    assert.equal(body.data[0].distTags.latest, '1.0.0');
    assert.equal(body.meta.history.tier, 1);
    assert.equal(body.meta.history.jj, false);
    assert.equal(body.meta.history.historyd, false);
    assert.true(body.data[0].versions['1.0.0'].file.startsWith('packs/'));
    assert.true(body.data[0].livePath.includes('lib'));
  });

  test('browse sealed directory and file', async function (assert) {
    let root = await fetch(`${origin}/_browse/lib@1.0.0`);
    assert.equal(root.status, 200);
    let listing = (await root.json()).data.attributes;
    assert.equal(listing.kind, 'sealed');
    assert.deepEqual(
      listing.entries.map((e: { name: string; type: string }) => [
        e.name,
        e.type,
      ]),
      [
        ['util', 'dir'],
        ['importmap.json', 'file'],
        ['index.js', 'file'],
      ],
    );

    let dir = await fetch(`${origin}/_browse/lib@latest/util`);
    assert.equal(dir.status, 200);
    let util = (await dir.json()).data.attributes;
    assert.equal(util.entries.length, 1);
    assert.equal(util.entries[0].name, 'math.js');

    let file = await fetch(`${origin}/_browse/lib@dev/util/math.js`);
    assert.equal(file.status, 200);
    let body = (await file.json()).data;
    assert.equal(body.type, 'file');
    assert.true(body.attributes.text.includes('export const add'));
    assert.true(body.attributes.rawUrl.includes('/@lib@'));
  });

  test('browse live working tree', async function (assert) {
    let res = await fetch(`${origin}/_browse/lib@live`);
    assert.equal(res.status, 200);
    let listing = (await res.json()).data.attributes;
    assert.equal(listing.kind, 'live');
    assert.true(listing.entries.some((e: { name: string }) => e.name === 'util'));

    let file = await fetch(`${origin}/_browse/lib@live/index.js`);
    let body = (await file.json()).data.attributes;
    assert.equal(body.kind, 'live');
    assert.equal(body.rawUrl, '/live/lib/index.js');
    assert.true(body.text.includes('export const n'));
  });
});
