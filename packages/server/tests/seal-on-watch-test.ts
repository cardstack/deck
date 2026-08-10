import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HistoryBackend, HistoryEntry } from '@cardstack/deck-history/backend';
import { storeDirFor, watchDepot } from '../src/depot.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockHistory(kind: 'jj' | 'deckd', notes: string[]): HistoryBackend {
  return {
    kind,
    noteMutation(_dir, path) {
      notes.push(path);
    },
    async flush() {
      notes.push('__flush__');
      return 'seal-1';
    },
    async seal() {
      return 'seal-1';
    },
    async head() {
      return 'seal-1';
    },
    async list(): Promise<HistoryEntry[]> {
      return [];
    },
    async fileAt() {
      return undefined;
    },
    async restorePlan() {
      return { writes: [], deletes: [] };
    },
    close() {},
  };
}

module('sealOnWatch cutover (deckd owns Timeline)', function () {
  test('deckd history: publish/HMR path does not noteMutation or flush', async function (assert) {
    assert.timeout(15_000);
    let work = await mkdtemp(join(tmpdir(), 'deck-seal-on-watch-'));
    let depotDir = join(work, 'demo');
    let deckDir = join(depotDir, 'me', 'app');
    await mkdir(deckDir, { recursive: true });
    await writeFile(
      join(deckDir, 'importmap.json'),
      JSON.stringify({
        imports: {},
        deck: { packages: { app: { version: '0.1.0', entry: '$DECK/index.js' } } },
      }),
    );
    await writeFile(join(deckDir, 'index.js'), 'export const v = 0;\n');

    let notes: string[] = [];
    let history = mockHistory('deckd', notes);
    let controller = watchDepot({
      depot: {
        name: 'demo',
        dir: depotDir,
        storeDir: storeDirFor(depotDir),
        history,
      },
      debounceMs: 80,
    });
    await controller.rescan();
    await controller.settled();
    notes.length = 0;

    await writeFile(join(deckDir, 'index.js'), 'export const v = 1;\n');
    await controller.settled();
    await sleep(100);

    assert.deepEqual(
      notes.filter((n) => n !== '__flush__'),
      [],
      'deckd kind must not noteMutation from Node watch',
    );
    assert.false(
      notes.includes('__flush__'),
      'deckd kind must not flush Timeline from Node watch',
    );

    controller.close();
    history.close();
    await rm(work, { recursive: true, force: true });
  });

  test('jj history still notes + flushes (Node owns Timeline)', async function (assert) {
    assert.timeout(15_000);
    let work = await mkdtemp(join(tmpdir(), 'deck-seal-on-watch-jj-'));
    let depotDir = join(work, 'demo');
    let deckDir = join(depotDir, 'me', 'app');
    await mkdir(deckDir, { recursive: true });
    await writeFile(
      join(deckDir, 'importmap.json'),
      JSON.stringify({
        imports: {},
        deck: { packages: { app: { version: '0.1.0', entry: '$DECK/index.js' } } },
      }),
    );
    await writeFile(join(deckDir, 'index.js'), 'export const v = 0;\n');

    let notes: string[] = [];
    let history = mockHistory('jj', notes);
    let controller = watchDepot({
      depot: {
        name: 'demo',
        dir: depotDir,
        storeDir: storeDirFor(depotDir),
        history,
      },
      debounceMs: 80,
    });
    await controller.rescan();
    await controller.settled();
    notes.length = 0;

    await writeFile(join(deckDir, 'index.js'), 'export const v = 1;\n');
    await controller.settled();
    await sleep(100);

    assert.true(
      notes.some((n) => n.includes('index.js')),
      'jj kind still notes author paths',
    );
    assert.true(notes.includes('__flush__'), 'jj kind still flushes on publish');

    controller.close();
    history.close();
    await rm(work, { recursive: true, force: true });
  });
});
