import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { packFromDir } from '@cardstack/deck/pack';
import { publishToStore } from '@cardstack/deck/store';
import { createDeckServer, type DeckServer } from '../src/server.ts';
import { storeDirFor, type DepotMount } from '../src/depot.ts';

// Serving a deck that inherits.
//
// The unit tests in `@cardstack/deck` cover the merge. What is checked here is
// the part a consumer actually sees: a page whose deck states only its
// differences still gets a COMPLETE import map injected into its HTML, with
// the parent's entries in it.

let root: string;
let depotDir: string;
let depot: DepotMount;
let server: DeckServer;
let origin: string;

const PAGE = `<!doctype html>
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

async function publish(name: string, version: string) {
  await publishToStore(
    depot.storeDir,
    name,
    version,
    await packFromDir(join(depotDir, ...name.split('/'))),
    { tag: 'latest' },
  );
}

function injectedMap(html: string): {
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
} {
  let match = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  if (!match) {
    throw new Error(`no import map injected into: ${html.slice(0, 200)}`);
  }
  return JSON.parse(match[1]);
}

module('serving a deck that inherits', function (hooks) {
  hooks.beforeEach(async function () {
    root = await mkdtemp(join(tmpdir(), 'deck-inherit-'));
    depotDir = join(root, 'site');
    depot = { name: 'site', dir: depotDir, storeDir: storeDirFor(depotDir) };

    // The parent: a small app with three modules, published and sealed.
    await writeDeck(
      'acme/blog',
      { 'post.js': 'export const post = 1;\n' },
      {
        imports: {
          'blog/post': '/site/acme/blog@1.0.0/post.js',
          'blog/list': '/site/acme/blog@1.0.0/list.js',
          'blog/theme': '/site/acme/blog@1.0.0/theme.js',
        },
        deck: { packages: { blog: { version: '1.0.0' } } },
      },
    );
    await publish('acme/blog', '1.0.0');

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

  test('a remix states one entry and is served all of them', async function (assert) {
    await writeDeck(
      'you/my-blog',
      { 'theme.js': 'export const theme = "mine";\n', 'index.html': PAGE },
      {
        deck: {
          extends: 'acme/blog@1.0.0',
          packages: { 'my-blog': { version: '0.1.0' } },
        },
        imports: { 'blog/theme': '/site/you/my-blog/theme.js' },
      },
    );

    let html = await (
      await fetch(`${origin}/site/you/my-blog/index.html`)
    ).text();
    let map = injectedMap(html);

    // Inherited, untouched.
    assert.strictEqual(map.imports['blog/post'], '/site/acme/blog@1.0.0/post.js');
    assert.strictEqual(map.imports['blog/list'], '/site/acme/blog@1.0.0/list.js');
    // Overridden — the one entry the remix actually wrote.
    assert.strictEqual(map.imports['blog/theme'], '/site/you/my-blog/theme.js');
    assert.strictEqual(Object.keys(map.imports).length, 3);
  });

  test('a remix may drop an inherited entry', async function (assert) {
    await writeDeck(
      'you/lean-blog',
      { 'index.html': PAGE },
      {
        deck: {
          extends: 'acme/blog@1.0.0',
          packages: { 'lean-blog': { version: '0.1.0' } },
        },
        imports: { 'blog/list': null },
      },
    );

    let html = await (
      await fetch(`${origin}/site/you/lean-blog/index.html`)
    ).text();
    let map = injectedMap(html);

    assert.false('blog/list' in map.imports);
    assert.strictEqual(map.imports['blog/post'], '/site/acme/blog@1.0.0/post.js');
  });

  // L11. Serving a page whose map is silently missing everything it
  // inherited would surface as unrelated import failures in the browser.
  test('a parent that is not in the store is not served as an empty map', async function (assert) {
    await writeDeck(
      'you/broken',
      { 'index.html': PAGE },
      {
        deck: {
          extends: 'acme/nothing@9.9.9',
          packages: { broken: { version: '0.1.0' } },
        },
        imports: { own: '/site/you/broken/own.js' },
      },
    );

    let response = await fetch(`${origin}/site/you/broken/index.html`);
    assert.strictEqual(response.status, 500);
    // Naming the parent is the difference between a fixable report and a
    // morning spent bisecting import errors.
    assert.true(
      (await response.text()).includes('acme/nothing@9.9.9'),
      'the error names the parent it could not reach',
    );
  });

  test('a deck with no parent is unaffected', async function (assert) {
    await writeDeck(
      'you/plain',
      { 'index.html': PAGE },
      {
        imports: { thing: '/site/you/plain/thing.js' },
        deck: { packages: { plain: { version: '0.1.0' } } },
      },
    );

    let html = await (await fetch(`${origin}/site/you/plain/index.html`)).text();
    assert.deepEqual(injectedMap(html).imports, {
      thing: '/site/you/plain/thing.js',
    });
  });
});
