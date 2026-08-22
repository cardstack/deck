import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { DeckServer } from '@cardstack/deck-server/server';
import { forkDeck } from '@cardstack/deck/fork';
import { packFromDir } from '@cardstack/deck/pack';
import { publishToStore } from '@cardstack/deck/store';
import { createDeckServer } from '@cardstack/deck-server/server';
import { storeDirFor, type DepotMount } from '@cardstack/deck-server/depot';
import { rebasePass, startRebaseDaemon } from '../src/rebase-daemon.ts';

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
  let pkgName = name.split('/')[1]!;
  let deck = (map.deck ?? {}) as {
    packages?: Record<string, { version?: string; entry?: string }>;
    dependencies?: Record<string, string>;
  };
  let self = deck.packages?.[pkgName];
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: pkgName,
        version: self?.version ?? '0.1.0',
        type: 'module',
        ...(self?.entry
          ? {
              exports: {
                '.': `./${self.entry.replace(/^\$DECK\//, '')}`,
              },
            }
          : {}),
        ...(deck.dependencies ? { dependencies: deck.dependencies } : {}),
      },
      null,
      2,
    ) + '\n',
  );
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

module('the rebase daemon', function (hooks) {
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
