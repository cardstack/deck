import QUnit from 'qunit';
const { module, test } = QUnit;
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { JjCliHistory, jjVersion } from '../src/jj-cli.ts';

const run = promisify(execFile);

// THE GITLINK TRAP
// ════════════════
// jj colocates by default, which puts a real `.git` at the top level of the
// depot it is attached to. Git treats any directory containing `.git` as a
// submodule boundary: `git add` on it records a 160000 gitlink pointing at a
// commit nobody else will ever have, and every file underneath is dropped
// from the commit.
//
// It stages without error. It commits without error. `git status` is clean
// afterwards. The only signal is an advisory hint that scrolls past, and the
// loss is invisible until somebody clones and finds an empty directory.
//
// A depot's whole reason to exist is holding source. Losing it silently on
// `git commit` is the worst failure this project can have, so it is not
// guarded by a comment or a convention — it is guarded by these tests, which
// fail loudly the moment either half of the arrangement slips.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

let jj = await jjVersion();

module('history: no gitlinks, ever', function () {
  test('attaching history does not create a top-level .git', async function (assert) {
    if (!jj) {
      assert.ok(true, 'skipped — no jj on PATH (tier 1)');
      return;
    }
    let dir = await mkdtemp(join(tmpdir(), 'deck-colocate-'));
    try {
      await mkdir(join(dir, 'acme', 'palette'), { recursive: true });
      await writeFile(join(dir, 'acme', 'palette', 'palette.js'), 'export let a = 1;\n');
      let history = new JjCliHistory();
      await history.seal(dir, 'first');
      history.close();

      assert.true(existsSync(join(dir, '.jj')), 'jj attached');
      assert.false(
        existsSync(join(dir, '.git')),
        'NO top-level .git — a colocated repo makes git commit this depot as ' +
          'a gitlink and silently drop every file in it',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('the depot store is never sealed into history', async function (assert) {
    if (!jj) {
      assert.ok(true, 'skipped — no jj on PATH (tier 1)');
      return;
    }
    let dir = await mkdtemp(join(tmpdir(), 'deck-autotrack-'));
    try {
      await mkdir(join(dir, 'acme', 'palette'), { recursive: true });
      await writeFile(join(dir, 'acme', 'palette', 'palette.js'), 'export let a = 1;\n');
      // The machinery: a store full of packs, which must never be sealed
      // alongside the tree — a seal carrying every pack would make restore
      // rewind the published versions themselves.
      await mkdir(join(dir, '.deck', 'store'), { recursive: true });
      await writeFile(join(dir, '.deck', 'store', 'meta.json'), '{}\n');

      let history = new JjCliHistory();
      let sealed = await history.seal(dir, 'first');
      assert.ok(sealed, 'sealed');
      let files = await history.fileListAt(dir, sealed!);
      history.close();

      assert.deepEqual(
        files,
        ['acme/palette/palette.js'],
        'the seal holds the tree and nothing but the tree',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('this repository has no gitlinks and no colocated depots', async function (assert) {
    let inGit = await run('git', ['rev-parse', '--git-dir'], { cwd: repoRoot })
      .then(() => true)
      .catch(() => false);
    if (!inGit) {
      assert.ok(true, 'skipped — not a git checkout');
      return;
    }

    // Nothing already committed as a gitlink.
    let { stdout } = await run('git', ['ls-tree', '-r', 'HEAD'], {
      cwd: repoRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    let links = stdout
      .split('\n')
      .filter((line) => line.startsWith('160000'))
      .map((line) => line.split('\t')[1]);
    assert.deepEqual(links, [], 'no 160000 entries in HEAD');

    // And nothing in the working tree that WOULD become one.
    //
    // A depot is a directory with a STORE (`.deck/store`) or a history
    // (`.jj`). Not merely a `.deck`: the repo root has `.deck/certs`, which
    // is the TLS cache the demos share and not a depot at all. And the repo
    // root is excluded outright — it is supposed to contain `.git`.
    let depots: string[] = [];
    async function walk(relative: string, depth: number): Promise<void> {
      if (depth > 3) return;
      let full = join(repoRoot, relative);
      let entries = await readdir(full, { withFileTypes: true }).catch(() => []);
      let isDepot =
        relative !== '.' &&
        (existsSync(join(full, '.deck', 'store')) || existsSync(join(full, '.jj')));
      if (isDepot) {
        depots.push(relative);
      }
      for (let entry of entries) {
        if (!entry.isDirectory() || entry.name === 'node_modules') continue;
        if (entry.name.startsWith('.')) continue;
        await walk(join(relative, entry.name), depth + 1);
      }
    }
    await walk('.', 0);

    let colocated = [...new Set(depots)].filter((depot) =>
      existsSync(join(repoRoot, depot, '.git')),
    );
    assert.deepEqual(
      colocated,
      [],
      'no depot carries a colocated .git; run `rm -rf <depot>/.git <depot>/.jj` ' +
        'on any listed here and let the watcher re-attach history',
    );
  });
});
