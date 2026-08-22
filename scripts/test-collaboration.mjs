#!/usr/bin/env node

// CI-safe end-to-end confidence test for the collaboration protocol. It
// replays the public CLI into a disposable realm, talks to a private deckd,
// and asks the real Hub Repository service to preview, merge, and reject work.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const replay = join(root, 'scripts', 'replay-collaboration.mjs');

async function freePort() {
  let server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  let address = server.address();
  let port = typeof address === 'object' && address ? address.port : undefined;
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  if (!port) throw new Error('could not reserve a local test port');
  return port;
}

async function waitForDeckd(url, child, output) {
  let deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `test deckd exited ${child.exitCode}\n${output.join('')}`,
      );
    }
    try {
      let response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`test deckd did not become healthy\n${output.join('')}`);
}

async function runReplay(env) {
  await new Promise((resolvePromise, reject) => {
    let child = spawn(process.execPath, [replay], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`collaboration replay exited ${signal ?? code}`));
    });
  });
}

let work = await mkdtemp(join(tmpdir(), 'deck-collaboration-test-'));
let deckdPort = await freePort();
let vendorPort = await freePort();
let deckdUrl = `http://127.0.0.1:${deckdPort}`;
let output = [];
let deckd = spawn('cargo', ['run', '--quiet'], {
  cwd: join(root, 'packages', 'deckd'),
  env: {
    ...process.env,
    DECKD_BIND: `127.0.0.1:${deckdPort}`,
    RUST_LOG: 'deckd=warn',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
deckd.stdout.on('data', (chunk) => output.push(chunk.toString()));
deckd.stderr.on('data', (chunk) => output.push(chunk.toString()));

try {
  await waitForDeckd(deckdUrl, deckd, output);
  await runReplay({
    DECKD_URL: deckdUrl,
    DECK_VENDOR_PORT: String(vendorPort),
    DECK_COLLABORATION_DEPOT: join(work, 'depot'),
    DECK_COLLABORATION_TEST: '1',
    DECK_REPLAY_VERIFY_MUTATIONS: '1',
  });
  process.stdout.write('collaboration integration passed\n');
} finally {
  deckd.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => deckd.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  await rm(work, { recursive: true, force: true });
}
