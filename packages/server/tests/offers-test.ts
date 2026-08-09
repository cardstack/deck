import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { DeckServer } from '../src/server.ts';
import { forkDeck } from '@cardstack/deck/fork';
import { packFromDir } from '@cardstack/deck/pack';
import { publishToStore } from '@cardstack/deck/store';
import { createDeckServer } from '../src/server.ts';
import { storeDirFor, type DepotMount } from '../src/depot.ts';

let root: string;
let depotDir: string;
let depot: DepotMount;
let server: DeckServer;
let origin: string;

const APP_HTML = `<!doctype html>
<script type="importmap" src="./importmap.json"></script>
<script type="module" src="./app.js"></script>`;

async function writeDeck(
  name: string,
  files: Record<string, string>,
  map: Record<string, unknown>,
): Promise<void> {
  let dir = join(depotDir, ...name.split('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'importmap.json'),
    JSON.stringify(map, null, 2) + '\n',
  );
  for (let [path, text] of Object.entries(files)) {
    await writeFile(join(dir, path), text);
  }
}

async function publish(name: string, version: string, tag = 'latest') {
  await publishToStore(
    depot.storeDir,
    name,
    version,
    await packFromDir(join(depotDir, ...name.split('/'))),
    { tag },
  );
}

module('offers, rebase, and try-by-URL', function (hooks) {
  hooks.beforeEach(async function () {
    root = await mkdtemp(join(tmpdir(), 'deck-offers-'));
    depotDir = join(root, 'site');
    depot = { name: 'site', dir: depotDir, storeDir: storeDirFor(depotDir) };
    await writeDeck(
      'acme/palette',
      {
        'palette.js': "export const colors = ['red', 'teal'];\n",
        'notes.md': 'one\ntwo\nthree\n',
      },
      {
        deck: {
          packages: {
            palette: { version: '1.0.0', entry: '$DECK/palette.js' },
          },
        },
      },
    );
    await publish('acme/palette', '1.0.0');
    await writeDeck(
      'you/app',
      { 'app.js': "import { colors } from 'acme/palette';\n", 'index.html': APP_HTML },
      {
        imports: {
          'acme/palette': '/site/acme/palette@1.0.0/palette.js',
          'acme/palette/': '/site/acme/palette@1.0.0/',
        },
        deck: {
          packages: { app: { version: '0.1.0', entry: '$DECK/app.js' } },
          dependencies: { 'acme/palette': '^1.0.0' },
        },
      },
    );
    server = createDeckServer({ depots: [depot] });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.afterEach(async function () {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  });

  async function forkPalette() {
    await forkDeck({
      depotDir,
      storeDir: depot.storeDir,
      from: { publisher: 'acme', package: 'palette', spec: '1.0.0' },
      to: { publisher: 'you', package: 'palette' },
      actor: '@chris:boxel.ai',
    });
  }

  test('a proposal shows up as an open offer, with one URL to try it', async function (assert) {
    await forkPalette();
    let body = await (await fetch(`${origin}/site/_offers`)).json();
    assert.strictEqual(body.meta.open, 1);
    assert.strictEqual(body.meta.conflicted, 0);
    let offer = body.data[0];
    assert.strictEqual(offer.id, 'you/palette');
    assert.strictEqual(offer.attributes.upstream, 'acme/palette');
    assert.strictEqual(offer.attributes.state, 'current');
    assert.strictEqual(
      offer.attributes.tryWith,
      '?with=acme/palette=you/palette',
    );
  });

  test('try-by-URL swaps ONE specifier for this request only', async function (assert) {
    await forkPalette();
    await writeFile(
      join(depotDir, 'you', 'palette', 'palette.js'),
      "export const colors = ['a', 'b', 'c', 'd'];\n",
    );

    let plain = await fetch(`${origin}/site/you/app/index.html`);
    let plainMap = (await plain.text()).match(/importmap">([^<]*)/)![1];
    assert.deepEqual(JSON.parse(plainMap).imports['acme/palette'], 
      '/site/acme/palette@1.0.0/palette.js');
    assert.strictEqual(plain.headers.get('x-deck-with'), null);

    let trial = await fetch(
      `${origin}/site/you/app/index.html?with=acme/palette=you/palette`,
    );
    let trialMap = JSON.parse((await trial.text()).match(/importmap">([^<]*)/)![1]);
    assert.strictEqual(
      trialMap.imports['acme/palette'],
      '/site/you/palette/palette.js',
      'the fork stands in for what it forked — no checkout, no branch',
    );
    assert.strictEqual(
      trialMap.imports['acme/palette/'],
      '/site/you/palette/',
      'and its subpaths come with it',
    );
    assert.strictEqual(trial.headers.get('x-deck-with'), 'acme/palette, acme/palette/');
    assert.strictEqual(
      trial.headers.get('cache-control'),
      'no-store',
      'a trial is never cached as if it were the real thing',
    );

    // The app's own tree is untouched by any of this.
    let map = JSON.parse(
      await readFile(join(depotDir, 'you', 'app', 'importmap.json'), 'utf8'),
    );
    assert.strictEqual(
      map.imports['acme/palette'],
      '/site/acme/palette@1.0.0/palette.js',
    );
  });

  test('a version override needs no fork at all', async function (assert) {
    await writeFile(
      join(depotDir, 'acme', 'palette', 'palette.js'),
      "export const colors = ['red', 'teal', 'gold'];\n",
    );
    await writeDeck(
      'acme/palette',
      {
        'palette.js': "export const colors = ['red', 'teal', 'gold'];\n",
        'notes.md': 'one\ntwo\nthree\n',
      },
      {
        deck: {
          packages: {
            palette: { version: '1.1.0', entry: '$DECK/palette.js' },
          },
        },
      },
    );
    await publish('acme/palette', '1.1.0');
    let trial = await fetch(
      `${origin}/site/you/app/index.html?with=acme/palette@1.1.0`,
    );
    let map = JSON.parse((await trial.text()).match(/importmap">([^<]*)/)![1]);
    assert.strictEqual(
      map.imports['acme/palette'],
      '/site/acme/palette@1.1.0/palette.js',
    );
  });

  // Two overrides in one trial, where one of them declares a RANGE over the
  // other. Resolving the substitute's own scopes is what makes a trial work
  // at all (the substitute brings its dependencies with it), but a range is a
  // question and the query string already answered it: a version the caller
  // named has to win inside those scopes too, or the page renders the very
  // version the reviewer was trying to avoid and says nothing.
  test('a named override beats a range inside a substitute’s own scope', async function (assert) {
    // palette 1.1.0 exists and is `latest`, so `^1.0.0` resolves to it.
    await writeDeck(
      'acme/palette',
      { 'palette.js': "export const colors = ['NEW'];\n" },
      {
        deck: {
          packages: {
            palette: { version: '1.1.0', entry: '$DECK/palette.js' },
          },
        },
      },
    );
    await publish('acme/palette', '1.1.0');
    // A composition deck that asks for the palette by range, not by pin.
    await writeDeck(
      'acme/gallery',
      { 'gallery.js': "export const gallery = 1;\n" },
      {
        deck: {
          packages: {
            gallery: { version: '1.0.0', entry: '$DECK/gallery.js' },
          },
          dependencies: { 'acme/palette': '^1.0.0' },
        },
        imports: {
          'acme/palette': '/site/acme/palette@1.0.0/palette.js',
          'acme/palette/': '/site/acme/palette@1.0.0/',
        },
      },
    );
    await publish('acme/gallery', '1.0.0');

    let trial = await fetch(
      `${origin}/site/you/app/index.html` +
        '?with=acme/gallery@1.0.0&with=acme/palette@1.0.0',
    );
    let map = JSON.parse((await trial.text()).match(/importmap">([^<]*)/)![1]);
    assert.strictEqual(
      map.scopes['/site/acme/gallery@1.0.0/']['acme/palette'],
      '/site/acme/palette@1.0.0/palette.js',
      'the gallery scope holds the version the caller asked for, not latest',
    );
  });

  // The specifier a page imports a deck under is its own choice — since
  // aliased dependencies, `acme/palette` may answer to the key `palette`.
  // A `?with=` that rebinds the DECK name would rewrite a specifier the
  // page never imports, and silently change nothing.
  test('an override rebinds the specifier in use, not the deck name', async function (assert) {
    await writeDeck(
      'acme/palette',
      { 'palette.js': "export const colors = ['red'];\n" },
      {
        deck: {
          packages: {
            palette: { version: '1.1.0', entry: '$DECK/palette.js' },
          },
        },
      },
    );
    await publish('acme/palette', '1.1.0');
    // The app imports it as `palette`, aliased to the acme/palette deck.
    await writeFile(
      join(depotDir, 'you', 'app', 'importmap.json'),
      JSON.stringify({
        imports: {
          palette: '/site/acme/palette@1.0.0/palette.js',
          'palette/': '/site/acme/palette@1.0.0/',
        },
        deck: {
          packages: { app: { version: '0.1.0', entry: '$DECK/app.js' } },
          dependencies: { palette: 'acme/palette@1.0.0' },
        },
      }),
    );
    let trial = await fetch(
      `${origin}/site/you/app/index.html?with=acme/palette@1.1.0`,
    );
    let map = JSON.parse((await trial.text()).match(/importmap">([^<]*)/)![1]);
    assert.strictEqual(
      map.imports.palette,
      '/site/acme/palette@1.1.0/palette.js',
      'the specifier the page actually imports was rebound',
    );
    assert.strictEqual(
      map.imports['acme/palette'],
      undefined,
      'and no phantom specifier was invented',
    );
  });

  test('trying a sealed page drops its immutability claim', async function (assert) {
    await forkPalette();
    await publish('you/app', '0.1.0');
    let sealed = await fetch(`${origin}/site/you/app@0.1.0/index.html`);
    assert.strictEqual(
      sealed.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );
    let trial = await fetch(
      `${origin}/site/you/app@0.1.0/index.html?with=acme/palette=you/palette`,
    );
    assert.strictEqual(trial.headers.get('cache-control'), 'no-store');
    assert.true((await trial.text()).includes('/site/you/palette/'));
  });

  test('an override that cannot be served is refused, not silently dropped', async function (assert) {
    let response = await fetch(
      `${origin}/site/you/app/index.html?with=acme/palette@9.9.9`,
    );
    assert.strictEqual(response.status, 500);
    assert.true(
      /no published version satisfies/.test(await response.text()),
      'the reviewer is told why, rather than shown the un-swapped app',
    );
  });
  // The endpoint's own report of a conflict. The daemon is what leaves the
  // conflicted tree alone (see `@cardstack/deck-tools`); this asserts the
  // half the server owns — that a survey names the conflicting file rather
  // than hiding the proposal.
  test('a conflicted proposal is reported by the endpoint, and nothing is written', async function (assert) {
    await forkPalette();
    await writeFile(
      join(depotDir, 'you', 'palette', 'notes.md'),
      'one\nMINE\nthree\n',
    );
    await writeDeck(
      'acme/palette',
      {
        'palette.js': "export const colors = ['red', 'teal'];\n",
        'notes.md': 'one\nUPSTREAM\nthree\n',
      },
      {
        deck: {
          packages: {
            palette: { version: '1.1.0', entry: '$DECK/palette.js' },
          },
        },
      },
    );
    await publish('acme/palette', '1.1.0');

    let body = await (await fetch(`${origin}/site/_offers`)).json();
    assert.strictEqual(body.meta.conflicted, 1);
    assert.deepEqual(body.data[0].attributes.conflicts, ['notes.md']);
    assert.strictEqual(
      (
        await readFile(join(depotDir, 'you', 'palette', 'notes.md'))
      ).toString(),
      'one\nMINE\nthree\n',
      'surveying the queue does not touch a working tree',
    );
  });
});
