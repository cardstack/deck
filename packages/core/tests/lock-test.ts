import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack } from '../src/pack.ts';
import { publishToStore } from '../src/store.ts';
import {
  applyLock,
  lockDeck,
  parseDependencyValue,
  resolveDependencies,
} from '../src/lock.ts';

let realmDir: string;
let storeDir: string;

function confetti(version: string) {
  return pack([
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify({
          deck: {
            packages: {
              confetti: { version, entry: '$REALM/confetti.js' },
            },
          },
        }),
      ),
    },
    {
      path: 'confetti.js',
      bytes: Buffer.from(`export const V = '${version}';\n`),
    },
  ]);
}

async function writeAppMap(dependencies: Record<string, string>) {
  await writeFile(
    join(realmDir, 'me', 'app', 'importmap.json'),
    JSON.stringify(
      {
        imports: { 'some-other/': '/elsewhere/' },
        deck: {
          packages: { app: { version: '0.1.0', entry: '$REALM/app.js' } },
          dependencies,
        },
      },
      null,
      2,
    ) + '\n',
  );
}

module('the decklist lock: ranges in, pins out', function (hooks) {
  hooks.beforeEach(async function () {
    realmDir = join(await mkdtemp(join(tmpdir(), 'deck-lock-')), 'demo');
    storeDir = join(realmDir, '.deck', 'store');
    await mkdir(join(realmDir, 'me', 'app'), { recursive: true });
    await mkdir(join(realmDir, 'acme', 'confetti'), { recursive: true });
    await writeFile(
      join(realmDir, 'acme', 'confetti', 'importmap.json'),
      JSON.stringify({
        deck: {
          packages: {
            confetti: { version: '2.0.0', entry: '$REALM/confetti.js' },
          },
        },
      }),
    );
    await publishToStore(storeDir, 'acme/confetti', '1.0.0', confetti('1.0.0'));
    await publishToStore(storeDir, 'acme/confetti', '1.2.0', confetti('1.2.0'), {
      tag: 'latest',
    });
    await publishToStore(storeDir, 'acme/confetti', '2.0.0', confetti('2.0.0'));
    await publishToStore(
      storeDir,
      'acme/confetti',
      '1.3.0-dev.4',
      confetti('1.3.0-dev.4'),
      { tag: 'dev' },
    );
  });

  hooks.afterEach(async function () {
    await rm(join(realmDir, '..'), { recursive: true, force: true });
  });

  test('a range resolves to the highest STABLE that satisfies it', async function (assert) {
    await writeAppMap({ 'acme/confetti': '^1.0.0' });
    let { resolutions, text, changed } = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    assert.true(changed);
    assert.strictEqual(resolutions[0].version, '1.2.0');
    assert.deepEqual(resolutions[0].imports, {
      'acme/confetti': '/demo/acme/confetti@1.2.0/confetti.js',
      'acme/confetti/': '/demo/acme/confetti@1.2.0/',
    });
    let map = JSON.parse(text);
    assert.strictEqual(
      map.imports['acme/confetti'],
      '/demo/acme/confetti@1.2.0/confetti.js',
      'the pin is a plain URL — the browser needs no deck-specific logic',
    );
    assert.strictEqual(
      map.imports['some-other/'],
      '/elsewhere/',
      'unrelated import entries are left alone',
    );
    assert.deepEqual(
      map.deck.dependencies,
      { 'acme/confetti': '^1.0.0' },
      'the RANGE survives: intent is not overwritten by what it resolved to',
    );
  });

  test('a range never picks up a prerelease; the dev tag is how you opt in', async function (assert) {
    await writeAppMap({ 'acme/confetti': '^1.0.0' });
    let ranged = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    assert.strictEqual(
      ranged.resolutions[0].version,
      '1.2.0',
      '1.3.0-dev.4 satisfies ^1.0.0 numerically, and is still not chosen',
    );

    await writeAppMap({ 'acme/confetti': 'dev' });
    let tagged = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    assert.strictEqual(tagged.resolutions[0].version, '1.3.0-dev.4');
  });

  test('"live" pins to the working tree — the YOLO end of the dial', async function (assert) {
    await writeAppMap({ 'acme/confetti': 'live' });
    let { resolutions } = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    assert.strictEqual(resolutions[0].version, undefined);
    assert.deepEqual(resolutions[0].imports, {
      'acme/confetti': '/demo/acme/confetti/confetti.js',
      'acme/confetti/': '/demo/acme/confetti/',
      // no @version: every save of the dependency is picked up on reload
    });
  });

  test('an exact pin, and a tag, resolve as themselves', async function (assert) {
    await writeAppMap({ 'acme/confetti': '2.0.0' });
    let exact = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    assert.strictEqual(exact.resolutions[0].version, '2.0.0');

    await writeAppMap({ 'acme/confetti': 'latest' });
    let tagged = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    assert.strictEqual(tagged.resolutions[0].version, '1.2.0');
  });

  test('locking twice is a no-op; moving the range moves the pin', async function (assert) {
    await writeAppMap({ 'acme/confetti': '^1.0.0' });
    let first = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    await writeFile(join(realmDir, 'me', 'app', 'importmap.json'), first.text);

    let again = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    assert.false(again.changed, 'a settled lock writes nothing');

    // The publisher moves the dependency forward deliberately.
    let map = JSON.parse(
      await readFile(join(realmDir, 'me', 'app', 'importmap.json'), 'utf8'),
    );
    map.deck.dependencies['acme/confetti'] = '^2.0.0';
    await writeFile(
      join(realmDir, 'me', 'app', 'importmap.json'),
      JSON.stringify(map, null, 2) + '\n',
    );
    let moved = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    assert.true(moved.changed);
    assert.strictEqual(moved.resolutions[0].version, '2.0.0');
    assert.strictEqual(
      moved.resolutions[0].previous,
      '/demo/acme/confetti@1.2.0/confetti.js',
      'the report says what it moved from',
    );
  });

  // A fork stands in for its base under the BASE's specifier, so the
  // consumer's own `import … from 'acme/confetti'` keeps working.
  test('a dependency value may alias another deck', async function (assert) {
    assert.deepEqual(parseDependencyValue('^1.0.0'), { spec: '^1.0.0' });
    assert.deepEqual(parseDependencyValue('live'), { spec: 'live' });
    assert.deepEqual(parseDependencyValue('you/confetti@live'), {
      target: 'you/confetti',
      spec: 'live',
    });
    assert.deepEqual(parseDependencyValue('you/confetti@^1.0.0'), {
      target: 'you/confetti',
      spec: '^1.0.0',
    });
    assert.deepEqual(
      parseDependencyValue('you/confetti'),
      { target: 'you/confetti', spec: 'live' },
      'a bare deck name means live — what a fork wants',
    );
  });

  test('an alias repoints a specifier without renaming it', async function (assert) {
    await mkdir(join(realmDir, 'you', 'confetti'), { recursive: true });
    await writeFile(
      join(realmDir, 'you', 'confetti', 'importmap.json'),
      JSON.stringify({
        deck: {
          packages: {
            confetti: { version: '1.2.0', entry: '$REALM/confetti.js' },
          },
        },
      }),
    );
    await writeAppMap({ 'acme/confetti': 'you/confetti@live' });
    let { resolutions, text } = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    assert.strictEqual(resolutions[0].key, 'acme/confetti');
    assert.strictEqual(resolutions[0].alias, 'you/confetti');
    assert.strictEqual(resolutions[0].publisher, 'you');
    let map = JSON.parse(text);
    assert.strictEqual(
      map.imports['acme/confetti'],
      '/demo/you/confetti/confetti.js',
      'the specifier the consumer writes now resolves to the fork',
    );
    assert.strictEqual(
      map.imports['you/confetti'],
      undefined,
      'no second specifier appears — nothing in the consumer has to change',
    );
  });

  test('an alias to a published fork resolves its range', async function (assert) {
    await publishToStore(storeDir, 'you/confetti', '1.5.0', confetti('1.5.0'));
    await writeAppMap({ 'acme/confetti': 'you/confetti@^1.0.0' });
    let { resolutions } = await lockDeck({
      realmDir,
      realmName: 'demo',
      storeDir,
      deckDir: join(realmDir, 'me', 'app'),
    });
    assert.strictEqual(resolutions[0].version, '1.5.0');
    assert.deepEqual(resolutions[0].imports, {
      'acme/confetti': '/demo/you/confetti@1.5.0/confetti.js',
      'acme/confetti/': '/demo/you/confetti@1.5.0/',
    });
  });

  test('an alias to a deck that does not parse is refused', async function (assert) {
    await writeAppMap({ 'acme/confetti': 'a/b/c/d@live' });
    await assert.rejects(
      lockDeck({
        realmDir,
        realmName: 'demo',
        storeDir,
        deckDir: join(realmDir, 'me', 'app'),
      }),
      /aliases "a\/b\/c\/d"/,
    );
  });

  test('unsatisfiable, unknown, and cross-realm dependencies are refused', async function (assert) {
    await assert.rejects(
      resolveDependencies({
        realmDir,
        realmName: 'demo',
        storeDir,
        dependencies: { 'acme/confetti': '^9.0.0' },
      }),
      /no published version satisfies "\^9\.0\.0"/,
    );
    await assert.rejects(
      resolveDependencies({
        realmDir,
        realmName: 'demo',
        storeDir,
        dependencies: { 'acme/nope': '^1.0.0' },
      }),
      /has no published versions/,
    );
    await assert.rejects(
      resolveDependencies({
        realmDir,
        realmName: 'demo',
        storeDir,
        dependencies: { 'other/acme/confetti': '^1.0.0' },
      }),
      /only demo can be locked from here/,
      'a pin nobody can serve is worse than an error',
    );
    await assert.rejects(
      resolveDependencies({
        realmDir,
        realmName: 'demo',
        storeDir,
        dependencies: { confetti: '^1.0.0' },
      }),
      /is not <publisher>\/<package>/,
    );
  });

  test('dropping a dependency drops its pins', function (assert) {
    let text = JSON.stringify(
      {
        imports: {
          'acme/palette': '/demo/acme/palette@1.1.0/palette.js',
          'acme/palette/': '/demo/acme/palette@1.1.0/',
          'some-other/': '/elsewhere/',
          'acme/kept': '/demo/acme/kept@1.0.0/k.js',
        },
      },
      null,
      2,
    );
    let { text: locked, changed } = applyLock(text, [
      {
        key: 'acme/kept',
        realm: 'demo',
        publisher: 'acme',
        package: 'kept',
        spec: '^1.0.0',
        version: '1.0.0',
        imports: { 'acme/kept': '/demo/acme/kept@1.0.0/k.js' },
      },
    ]);
    assert.true(changed);
    assert.deepEqual(JSON.parse(locked).imports, {
      'acme/kept': '/demo/acme/kept@1.0.0/k.js',
      'some-other/': '/elsewhere/',
    });
  });

  test('applyLock only touches the specifiers it owns', function (assert) {
    let text = JSON.stringify({ imports: { 'a/': '/a/' } }, null, 2);
    let { text: locked } = applyLock(text, [
      {
        key: 'acme/confetti',
        realm: 'demo',
        publisher: 'acme',
        package: 'confetti',
        spec: '^1.0.0',
        version: '1.2.0',
        imports: { 'acme/confetti/': '/demo/acme/confetti@1.2.0/' },
      },
    ]);
    assert.deepEqual(JSON.parse(locked).imports, {
      'a/': '/a/',
      'acme/confetti/': '/demo/acme/confetti@1.2.0/',
    });
  });
});
