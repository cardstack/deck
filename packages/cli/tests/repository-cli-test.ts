import QUnit from 'qunit';
const { module, test } = QUnit;
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readPullRequest } from '@cardstack/deck/pull-request-store';
import { readBranchRef, readRevision } from '@cardstack/deck/repository-store';
import { storeDirFor } from '@cardstack/deck-server/depot';

const execFileAsync = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/deck.js', import.meta.url));

module('deck CLI: Repository workflow', function (hooks) {
  let work: string;
  let depot: string;
  hooks.beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), 'deck-repository-cli-'));
    depot = join(work, 'product');
    for (let name of ['app/root', 'ui/theme']) {
      let directory = join(depot, ...name.split('/'));
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'package.json'),
        `${JSON.stringify({ name, type: 'module' })}\n`,
      );
      await writeFile(
        join(directory, 'index.js'),
        `export const value = '${name}:main';\n`,
      );
    }
    await writeFile(join(depot, 'importmap.json'), '{"imports":{}}\n');
  });
  hooks.afterEach(() => rm(work, { recursive: true, force: true }));

  test('init → branch → multi-package commit → review → merge', async function (assert) {
    let run = (...args: string[]) =>
      execFileAsync(process.execPath, [BIN, ...args], {
        cwd: work,
        env: { ...process.env, DECK_ACTOR: 'Test agent' },
      });
    await run(
      'repo-init',
      '--depot',
      depot,
      '--owner',
      'acme',
      '--name',
      'product',
      '--root',
      'app/root',
      '--member',
      'app/root',
      '--member',
      'ui/theme',
    );
    await run(
      'branch',
      '--depot',
      depot,
      '--repo',
      'acme/product',
      '--name',
      'agent/change',
    );
    await writeFile(
      join(depot, 'app/root/index.js'),
      "export const value = 'root:changed';\n",
    );
    await writeFile(
      join(depot, 'ui/theme/index.js'),
      "export const value = 'theme:changed';\n",
    );
    await run(
      'commit',
      '--depot',
      depot,
      '--repo',
      'acme/product',
      '--branch',
      'agent/change',
      '--message',
      'Change root and theme',
    );
    await run(
      'review',
      '--depot',
      depot,
      '--repo',
      'acme/product',
      '--source',
      'agent/change',
      '--title',
      'Change root and theme',
    );
    await run(
      'merge',
      '--depot',
      depot,
      '--repo',
      'acme/product',
      '--number',
      '1',
    );

    let storeDir = storeDirFor(depot);
    let main = await readBranchRef(storeDir, 'acme', 'product', 'main');
    let feature = await readBranchRef(
      storeDir,
      'acme',
      'product',
      'agent/change',
    );
    let merged = await readRevision(storeDir, main!.revisionHash);
    let review = await readPullRequest(storeDir, 'acme', 'product', 1);
    assert.strictEqual(
      merged!.parents.length,
      2,
      'merge Revision has two parents',
    );
    assert.strictEqual(
      merged!.parents[1],
      feature!.revisionHash,
      'source branch is the second parent',
    );
    assert.strictEqual(review!.ref.state, 'merged');
    assert.true(review!.events.some((event) => event.type === 'merged'));
    assert.deepEqual(
      JSON.parse(await readFile(join(depot, 'repository.json'), 'utf8'))
        .members,
      ['app/root', 'ui/theme'],
    );
  });

  test('a mutable package is an implicit repository', async function (assert) {
    let run = (...args: string[]) =>
      execFileAsync(process.execPath, [BIN, ...args], {
        cwd: work,
        env: { ...process.env, DECK_ACTOR: 'Test agent' },
      });
    await run(
      'branch',
      '--depot',
      depot,
      '--repo',
      'app/root',
      '--name',
      'agent/single-package',
    );
    await writeFile(
      join(depot, 'app/root/index.js'),
      "export const value = 'implicit repository';\n",
    );
    await run(
      'commit',
      '--depot',
      depot,
      '--repo',
      'app/root',
      '--branch',
      'agent/single-package',
      '--message',
      'Change one package',
    );
    await run(
      'review',
      '--depot',
      depot,
      '--repo',
      'app/root',
      '--source',
      'agent/single-package',
      '--title',
      'Change one package',
    );
    await run('merge', '--depot', depot, '--repo', 'app/root', '--number', '1');
    let storeDir = storeDirFor(depot);
    assert.ok(await readBranchRef(storeDir, 'app', 'root', 'main'));
    assert.strictEqual(
      (await readPullRequest(storeDir, 'app', 'root', 1))!.ref.state,
      'merged',
    );
    await assert.rejects(
      readFile(join(depot, 'app/root/repository.json')),
      'the package needed no manifest',
    );
  });
});
