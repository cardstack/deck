import QUnit from 'qunit';
const { module, test } = QUnit;
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { pack } from '@cardstack/deck/pack';
import { publishToStore } from '@cardstack/deck/store';
import { createDeckServer, type DeckServer } from '../src/server.ts';
import { storeDirFor, type DepotMount } from '../src/depot.ts';

// Phase 3: live HTML injects workspace:* and dist-tag edges from
// package.json even when the depot lock has no pin for them.

let root: string;
let depotDir: string;
let storeDir: string;
let server: DeckServer;
let origin: string;

function injectedMap(html: string): {
  imports: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
} {
  let match = html.match(
    /<script type="importmap">\s*(\{[\s\S]*?\})\s*<\/script>/,
  );
  if (!match) {
    throw new Error(`no import map injected into: ${html.slice(0, 200)}`);
  }
  return JSON.parse(match[1]);
}

module('live serve: unfrozen edges without a lock pin', function (hooks) {
  hooks.before(async function () {
    root = await mkdtemp(join(tmpdir(), 'deck-unfrozen-serve-'));
    depotDir = join(root, 'demo');
    storeDir = storeDirFor(depotDir);
    await mkdir(join(depotDir, 'me', 'app'), { recursive: true });
    await mkdir(join(depotDir, 'acme', 'palette'), { recursive: true });
    await writeFile(
      join(depotDir, 'acme', 'palette', 'package.json'),
      JSON.stringify({
        name: 'palette',
        version: '1.0.0',
        type: 'module',
        exports: { '.': './palette.js' },
      }) + '\n',
    );
    await writeFile(
      join(depotDir, 'acme', 'palette', 'palette.js'),
      'export const hue = "live";\n',
    );
    await writeFile(
      join(depotDir, 'me', 'app', 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '0.1.0',
        type: 'module',
        exports: { '.': './app.js' },
        dependencies: {
          'acme/palette': 'workspace:*',
          confetti: 'latest',
        },
      }) + '\n',
    );
    await writeFile(
      join(depotDir, 'me', 'app', 'index.html'),
      '<!doctype html><script type="module" src="./app.js"></script>\n',
    );
    await writeFile(
      join(depotDir, 'me', 'app', 'app.js'),
      "import 'acme/palette';\nimport 'confetti';\n",
    );
    await publishToStore(
      storeDir,
      'acme/confetti',
      '1.2.0',
      pack([
        {
          path: 'package.json',
          bytes: Buffer.from(
            JSON.stringify({
              name: 'confetti',
              version: '1.2.0',
              type: 'module',
              exports: { '.': './confetti.js' },
            }),
          ),
        },
        {
          path: 'confetti.js',
          bytes: Buffer.from(`export const V = '1.2.0';\n`),
        },
      ]),
      { tag: 'latest' },
    );

    let depot: DepotMount = {
      name: 'demo',
      dir: depotDir,
      storeDir,
    };
    server = createDeckServer({ depots: [depot] });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    let address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  hooks.after(async function () {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  });

  test('workspace:* and latest appear without a depot lock', async function (assert) {
    let response = await fetch(`${origin}/demo/me/app/index.html`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-deck-importmap'), 'injected');
    let map = injectedMap(await response.text());
    assert.strictEqual(
      map.imports['acme/palette'],
      '/demo/acme/palette/palette.js',
      'sibling working tree — no lock required',
    );
    assert.strictEqual(
      map.imports.confetti,
      '/demo/acme/confetti@latest/confetti.js',
      'dist-tag floats; browser will 302',
    );
  });

  test('a compiled depot lock skips needing live unfrozen resolve', async function (assert) {
    await writeFile(
      join(depotDir, 'importmap.json'),
      JSON.stringify({
        imports: {
          'acme/palette': '/demo/acme/palette/palette.js',
          'acme/palette/': '/demo/acme/palette/',
          confetti: '/demo/acme/confetti@latest/confetti.js',
          'confetti/': '/demo/acme/confetti@latest/',
        },
      }) + '\n',
    );
    await writeFile(
      join(depotDir, 'me', 'app', 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '0.1.0',
        type: 'module',
        exports: { '.': './app.js' },
        dependencies: {
          'acme/palette': 'workspace:*',
          confetti: 'latest',
        },
      }) + '\n',
    );
    let response = await fetch(`${origin}/demo/me/app/index.html`);
    assert.strictEqual(response.status, 200);
    let map = injectedMap(await response.text());
    assert.strictEqual(
      map.imports['acme/palette'],
      '/demo/acme/palette/palette.js',
    );
    assert.strictEqual(
      map.imports.confetti,
      '/demo/acme/confetti@latest/confetti.js',
    );
  });

  test('a range alone does not inject without a lock pin', async function (assert) {
    await rm(join(depotDir, 'importmap.json'), { force: true });
    await writeFile(
      join(depotDir, 'me', 'app', 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '0.1.0',
        type: 'module',
        exports: { '.': './app.js' },
        dependencies: { confetti: '^1.0.0' },
      }) + '\n',
    );
    let response = await fetch(`${origin}/demo/me/app/index.html`);
    assert.strictEqual(response.status, 200);
    let html = await response.text();
    // No unfrozen edges and no lock → nothing to inject.
    assert.strictEqual(
      response.headers.get('x-deck-importmap'),
      null,
      'ranges stay frozen; without a lock there is no map',
    );
    assert.false(/importmap/.test(html));
  });

  test('live integrity is rehashed from disk, not the stale lock', async function (assert) {
    let livePath = '/demo/acme/palette/palette.js';
    let stale =
      'sha256-' + createHash('sha256').update('not-the-bytes').digest('base64');
    await writeFile(
      join(depotDir, 'importmap.json'),
      JSON.stringify({
        imports: {
          'acme/palette': livePath,
          'acme/palette/': '/demo/acme/palette/',
        },
        integrity: { [livePath]: stale },
      }) + '\n',
    );
    // Bust the liveImports cache (lock fingerprint changed via rewrite above).
    let response = await fetch(`${origin}/demo/me/app/index.html`);
    assert.strictEqual(response.status, 200);
    let map = injectedMap(await response.text()) as {
      imports: Record<string, string>;
      integrity?: Record<string, string>;
    };
    let fresh =
      'sha256-' +
      createHash('sha256')
        .update('export const hue = "live";\n')
        .digest('base64');
    assert.strictEqual(
      map.integrity?.[livePath],
      fresh,
      'serve-time hash matches working-tree bytes so an edit cannot SRI-block the Hub',
    );
    assert.notStrictEqual(map.integrity?.[livePath], stale);
  });
});
