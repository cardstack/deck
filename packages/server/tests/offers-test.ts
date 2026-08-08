import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { forkDeck } from '@deck/core/fork';
import { packFromDir } from '@deck/core/pack';
import { publishToStore } from '@deck/core/store';
import { createDeckServer } from '../src/server.ts';
import { storeDirFor, type DepotMount } from '../src/depot.ts';
import { rebasePass, startRebaseDaemon } from '../src/rebase-daemon.ts';

let root: string;
let depotDir: string;
let depot: DepotMount;
let server: Server;
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

  test('the daemon rebases what merges and leaves conflicts alone', async function (assert) {
    await forkPalette();
    // The proposal changes one file…
    await writeFile(
      join(depotDir, 'you', 'palette', 'palette.js'),
      "export const colors = ['a', 'b', 'c', 'd'];\n",
    );
    // …upstream changes a different one and releases.
    await writeFile(
      join(depotDir, 'acme', 'palette', 'notes.md'),
      'one\nTWO\nthree\n',
    );
    await writeDeck(
      'acme/palette',
      {
        'palette.js': "export const colors = ['red', 'teal'];\n",
        'notes.md': 'one\nTWO\nthree\n',
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

    let behind = await rebasePass({ depot, dryRun: true });
    assert.strictEqual(behind.outcomes[0].state, 'rebased');
    assert.false(behind.outcomes[0].applied, 'a dry run writes nothing');

    let daemon = startRebaseDaemon({ depot, intervalMs: 60_000 });
    let pass = await daemon.pass();
    daemon.close();
    assert.strictEqual(pass.rebased, 1);
    assert.strictEqual(pass.conflicted, 0);
    assert.strictEqual(
      (
        await readFile(join(depotDir, 'you', 'palette', 'notes.md'))
      ).toString(),
      'one\nTWO\nthree\n',
      "the proposal absorbed upstream's change without the contributor doing anything",
    );
    assert.strictEqual(
      (
        await readFile(join(depotDir, 'you', 'palette', 'palette.js'))
      ).toString(),
      "export const colors = ['a', 'b', 'c', 'd'];\n",
      'and kept its own',
    );

    let settled = await rebasePass({ depot, dryRun: true });
    assert.strictEqual(
      settled.outcomes[0].state,
      'current',
      'the loop converges — a second pass has nothing to do',
    );
  });

  test('a conflicted proposal is reported, never written', async function (assert) {
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

    let pass = await rebasePass({ depot });
    assert.strictEqual(pass.conflicted, 1);
    assert.strictEqual(pass.rebased, 0);
    assert.deepEqual(pass.outcomes[0].conflicts, ['notes.md']);
    assert.strictEqual(
      (
        await readFile(join(depotDir, 'you', 'palette', 'notes.md'))
      ).toString(),
      'one\nMINE\nthree\n',
      'a machine never damages a contributor\'s work',
    );

    let body = await (await fetch(`${origin}/site/_offers`)).json();
    assert.strictEqual(body.meta.conflicted, 1);
    assert.deepEqual(body.data[0].attributes.conflicts, ['notes.md']);
  });
});
