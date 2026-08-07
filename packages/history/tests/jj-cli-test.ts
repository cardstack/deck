import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRestore } from '../src/backend.ts';
import { JjCliHistory, jjVersion } from '../src/jj-cli.ts';

// Tier 2 is optional by design, so its tests are too: without a jj on the
// machine there is nothing to exercise, and the tier-1 suite still covers
// the whole publish loop.
let version = await jjVersion();

if (!version) {
  module('history: jj CLI backend', function () {
    test('skipped — jj is not installed', function (assert) {
      assert.ok(true, 'tier 2 degrades to tier 1; nothing to test here');
    });
  });
} else {
  module('history: jj CLI backend', function (hooks) {
    let dir: string;
    let history: JjCliHistory;

    hooks.beforeEach(async function () {
      dir = await mkdtemp(join(tmpdir(), 'deck-history-'));
      history = new JjCliHistory({ debounceMs: 20 });
    });

    hooks.afterEach(async function () {
      history.close();
      await rm(dir, { recursive: true, force: true });
    });

    test('a seal names a state; a clean tree seals nothing', async function (assert) {
      await writeFile(join(dir, 'app.js'), 'export const v = 1;\n');
      let first = await history.seal(dir, 'save: app.js');
      assert.true(
        typeof first === 'string' && first.length > 0,
        'sealing a dirty tree returns a changeId',
      );
      assert.strictEqual(
        await history.seal(dir, 'save: nothing'),
        undefined,
        'sealing an unchanged tree is a no-op — no empty seals accumulate',
      );
      assert.strictEqual(
        await history.head(dir),
        first,
        'head names the newest seal, not the working copy',
      );
    });

    test('a sealed state is readable after the tree has moved on', async function (assert) {
      await writeFile(join(dir, 'app.js'), 'export const v = 1;\n');
      let first = (await history.seal(dir, 'v1'))!;
      await writeFile(join(dir, 'app.js'), 'export const v = 2;\n');
      let second = (await history.seal(dir, 'v2'))!;

      assert.strictEqual(
        (await history.fileAt(dir, first, 'app.js'))?.toString(),
        'export const v = 1;\n',
        'the old bytes are still there — this is the never-lose-work guarantee',
      );
      assert.strictEqual(
        (await history.fileAt(dir, second, 'app.js'))?.toString(),
        'export const v = 2;\n',
      );
      assert.strictEqual(
        await history.fileAt(dir, first, 'nope.js'),
        undefined,
        'a path that was not in that seal is a miss, not an error',
      );
      assert.strictEqual(
        await history.fileAt(dir, 'zzzz', 'app.js'),
        undefined,
        'an unknown revision is a miss too',
      );
    });

    test('ids and paths are validated before they reach a revset', async function (assert) {
      await writeFile(join(dir, 'app.js'), 'export const v = 1;\n');
      let sealed = (await history.seal(dir, 'v1'))!;
      for (let bad of ['@', 'x y', '..', 'a|b', 'root()']) {
        assert.strictEqual(
          await history.fileAt(dir, bad, 'app.js'),
          undefined,
          `${JSON.stringify(bad)} is refused as a revision id`,
        );
      }
      for (let bad of ['../escape.js', '/etc/passwd', 'a//b']) {
        assert.strictEqual(
          await history.fileAt(dir, sealed, bad),
          undefined,
          `${JSON.stringify(bad)} is refused as a path`,
        );
      }
    });

    test('the seal log reads newest-first and flushes the tree first', async function (assert) {
      await writeFile(join(dir, 'a.js'), '1\n');
      await history.seal(dir, 'first');
      await writeFile(join(dir, 'b.js'), '2\n');
      // No explicit seal: list() flushes, so the log is never behind disk.
      let seals = await history.list(dir);
      assert.strictEqual(seals.length, 2);
      assert.strictEqual(seals[0].description, 'save');
      assert.strictEqual(seals[1].description, 'first');
      assert.true(
        seals[0].filesSummary.some((line) => line.endsWith('b.js')),
        `the newest seal names what moved: ${JSON.stringify(seals[0].filesSummary)}`,
      );
      assert.strictEqual(
        seals[0].author,
        undefined,
        'the default identity is not an actor — no fake attribution',
      );
    });

    test('a named actor is attributed', async function (assert) {
      await writeFile(join(dir, 'a.js'), '1\n');
      await history.seal(dir, 'anon');
      // jj fixes the author when a commit is CREATED, so an actor lands on
      // the change created by the previous commit — seal twice to observe it.
      await writeFile(join(dir, 'a.js'), '2\n');
      await history.seal(dir, 'by chris', { name: 'Chris' });
      await writeFile(join(dir, 'a.js'), '3\n');
      await history.seal(dir, 'after');
      let seals = await history.list(dir);
      assert.true(
        seals.some((seal) => seal.author === 'Chris'),
        `an actor reaches the log: ${JSON.stringify(seals.map((s) => s.author))}`,
      );
    });

    test('fileListAt enumerates the tree at a seal', async function (assert) {
      await writeFile(join(dir, 'a.js'), '1\n');
      let first = (await history.seal(dir, 'one file'))!;
      await writeFile(join(dir, 'b.js'), '2\n');
      let second = (await history.seal(dir, 'two files'))!;
      assert.deepEqual(await history.fileListAt(dir, first), ['a.js']);
      assert.deepEqual(await history.fileListAt(dir, second), ['a.js', 'b.js']);
      assert.strictEqual(
        await history.fileListAt(dir, '@'),
        undefined,
        'an invalid id enumerates nothing rather than resolving the working copy',
      );
    });

    test('restore replays a sealed state forward — never rewinding history', async function (assert) {
      await writeFile(join(dir, 'app.js'), 'export const v = 1;\n');
      await writeFile(join(dir, 'gone-later.js'), 'doomed\n');
      let first = (await history.seal(dir, 'v1'))!;
      await writeFile(join(dir, 'app.js'), 'export const v = 2;\n');
      await rm(join(dir, 'gone-later.js'));
      await writeFile(join(dir, 'added-later.js'), 'new\n');

      let result = await applyRestore(history, dir, first);
      assert.deepEqual(result.written.sort(), ['app.js', 'gone-later.js']);
      assert.deepEqual(result.deleted, ['added-later.js']);
      assert.strictEqual(
        (await readFile(join(dir, 'app.js'))).toString(),
        'export const v = 1;\n',
        'the tree is back',
      );
      assert.strictEqual(
        (await readFile(join(dir, 'gone-later.js'))).toString(),
        'doomed\n',
        'a file deleted after the seal comes back with it',
      );

      let seals = await history.list(dir);
      assert.strictEqual(
        seals.length,
        3,
        'the pre-restore state was sealed on the way out, and the restore seals too',
      );
      assert.true(
        result.from !== undefined && result.from !== first,
        'the state left behind has its own id — a restore is itself undoable',
      );
      let leftBehind = await history.fileAt(dir, result.from!, 'app.js');
      assert.strictEqual(
        leftBehind?.toString(),
        'export const v = 2;\n',
        'restoring did not destroy what it replaced',
      );
    });

    test('a burst of saves collapses into one seal', async function (assert) {
      history.noteMutation(dir, 'a.js');
      await writeFile(join(dir, 'a.js'), '1\n');
      history.noteMutation(dir, 'b.js');
      await writeFile(join(dir, 'b.js'), '2\n');
      history.noteMutation(dir, 'c.js');
      await writeFile(join(dir, 'c.js'), '3\n');
      let sealed = await history.flush(dir);
      assert.true(typeof sealed === 'string', 'one seal for the burst');
      let seals = await history.list(dir);
      assert.strictEqual(seals.length, 1);
      assert.strictEqual(
        seals[0].description,
        'save: a.js, b.js, c.js',
        'the message names the burst, and the debounce timer was consumed',
      );
    });
  });
}
