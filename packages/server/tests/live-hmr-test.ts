import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDeckServer, type DeckServer } from '../src/server.ts';
import {
  storeDirFor,
  watchDepot,
  type DepotMount,
  type DepotWatchController,
} from '../src/depot.ts';

let workDir: string;
let depotDir: string;
let deckDir: string;
let server: DeckServer;
let origin: string;
let controller: DepotWatchController;

async function readSseChange(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 5000,
): Promise<{ name: string; treeHash: string }> {
  let buffer = '';
  let deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let remaining = Math.max(1, deadline - Date.now());
    let chunk = await Promise.race([
      reader.read().then((r) => ({ kind: 'read' as const, r })),
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), remaining),
      ),
    ]);
    if (chunk.kind === 'timeout') {
      break;
    }
    if (chunk.r.value) {
      buffer += new TextDecoder().decode(chunk.r.value);
    }
    let match = buffer.match(/event: change\ndata: ({[^\n]+})\n\n/);
    if (match) {
      return JSON.parse(match[1]);
    }
    if (chunk.r.done) {
      throw new Error(`SSE stream closed before change event: ${buffer}`);
    }
  }
  throw new Error(`timed out waiting for SSE change event: ${buffer}`);
}

module('live HMR-lite transports', function (hooks) {
  hooks.before(async function () {
    workDir = await mkdtemp(join(tmpdir(), 'deck-hmr-test-'));
    depotDir = join(workDir, 'demo');
    deckDir = join(depotDir, 'me', 'mylib');
    await mkdir(deckDir, { recursive: true });
    await writeFile(
      join(deckDir, 'package.json'),
      JSON.stringify({
        name: 'mylib',
        version: '0.1.0',
        type: 'module',
        exports: { '.': './lib.js' },
      }),
    );
    await writeFile(join(deckDir, 'lib.js'), 'export const v = 1;\n');

    let depot: DepotMount = {
      name: 'demo',
      dir: depotDir,
      storeDir: storeDirFor(depotDir),
    };
    server = createDeckServer({ depots: [depot] });
    controller = watchDepot({
      depot,
      debounceMs: 40,
      onLiveChange: (event) => server.liveBus.emit(event),
    });
    await controller.rescan();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  hooks.after(async function () {
    controller.close();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(workDir, { recursive: true, force: true });
  });

  test('/_live/hmr.js serves the client helper', async function (assert) {
    let res = await fetch(`${origin}/_live/hmr.js`);
    assert.equal(res.status, 200);
    assert.true(/javascript/.test(res.headers.get('content-type') ?? ''));
    let body = await res.text();
    assert.true(body.includes("fetch('/_live/state'"));
    assert.false(body.includes('EventSource'));
  });

  test('liveBus emit fans out over SSE', async function (assert) {
    assert.timeout(8000);
    let res = await fetch(`${origin}/_live/events`);
    assert.equal(res.status, 200);
    assert.true(
      /text\/event-stream/.test(res.headers.get('content-type') ?? ''),
    );
    assert.ok(res.body, 'SSE response has a body stream');

    let reader = res.body!.getReader();
    let pending = readSseChange(reader);
    server.liveBus.emit({
      name: 'me/mylib',
      treeHash: 'a'.repeat(64),
    });
    let event = await pending;
    assert.equal(event.name, 'me/mylib');
    assert.equal(event.treeHash, 'a'.repeat(64));
    await reader.cancel();
  });

  test('/_live/state exposes a pollable moving sequence', async function (assert) {
    let before = await (await fetch(`${origin}/_live/state`)).json();
    server.liveBus.emit({
      name: 'me/mylib',
      treeHash: 'b'.repeat(64),
    });
    let res = await fetch(`${origin}/_live/state`);
    let after = await res.json();
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(after.data.sequence, before.data.sequence + 1);
    assert.deepEqual(after.data.event, {
      name: 'me/mylib',
      treeHash: 'b'.repeat(64),
    });
  });

  test('settled live edits emit through the watcher onto SSE', async function (
    assert,
  ) {
    assert.timeout(10000);
    let res = await fetch(`${origin}/_live/events`);
    assert.ok(res.body);
    let reader = res.body!.getReader();
    let pending = readSseChange(reader);
    await writeFile(join(deckDir, 'lib.js'), 'export const v = 2;\n');
    let event = await pending;
    assert.equal(event.name, 'me/mylib');
    assert.true(/^[0-9a-f]{64}$/.test(event.treeHash));
    await controller.settled();
    await reader.cancel();
  });
});
