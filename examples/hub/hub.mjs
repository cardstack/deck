#!/usr/bin/env node
// The Deck demo hub.
//
// One command, one URL. It starts every example as its own process on its own
// port — because each one really is a separate depot with its own store, and
// pretending otherwise would be the first lie — and serves a console that
// puts each demo's explanation, its live app, and its actual console
// transcript side by side.
//
// The transcript is the point. Every demo measures rather than asserts, and
// what it printed while building the store is a better explanation of what
// happened than any prose could be. So the hub captures it and shows it.
//
//   pnpm demo
//   open http://localhost:8789/  (hub shell; demos are https + http/2)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localFetch } from '@cardstack/deck-server/tls';
import { demoOrigin } from '../shared/depot.mjs';
import { DEMOS, LAWS } from './demos.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, '..');
const repoRoot = resolve(examplesDir, '..');
const PORT = Number(process.env.PORT ?? 8789);
const SHARED_TLS_DIR = join(examplesDir, 'shared', '.deck', 'certs');

// One record per demo, mutated as its child process talks.
const state = new Map(
  DEMOS.map((demo) => [
    demo.name,
    {
      ...demo,
      status: 'starting',
      log: '',
      origin: demoOrigin(demo.port),
      exit: null,
    },
  ]),
);

function log(name, chunk) {
  let entry = state.get(name);
  entry.log += chunk;
  // A demo that keeps running is a demo that keeps printing; the transcripts
  // here are a few KB, but a bound stops a runaway from eating the process.
  if (entry.log.length > 200_000) {
    entry.log = entry.log.slice(-200_000);
  }
}

function start(demo) {
  let child = spawn(process.execPath, ['demo.mjs'], {
    cwd: join(examplesDir, demo.dir),
    env: {
      ...process.env,
      PORT: String(demo.port),
      // Same leaf for every child so one browser trust warning covers all.
      DECK_TLS_DIR: SHARED_TLS_DIR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => log(demo.name, chunk.toString('utf8')));
  child.stderr.on('data', (chunk) => log(demo.name, chunk.toString('utf8')));
  child.on('exit', (code) => {
    let entry = state.get(demo.name);
    entry.exit = code;
    // A demo server does not exit on its own. If it did, whatever it printed
    // on the way out is the whole story, so the transcript stays readable.
    entry.status = 'failed';
  });
  return child;
}

const children = DEMOS.map(start);

function stopAll() {
  for (let child of children) {
    child.kill('SIGTERM');
  }
}
for (let signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}
process.on('exit', stopAll);

// Readiness is "it answers", not "it printed something" — the demos vendor
// from npm, so the slow ones take a while and the fast ones must not wait.
async function poll() {
  await Promise.all(
    [...state.values()].map(async (entry) => {
      if (entry.status === 'ready' || entry.exit !== null) {
        return;
      }
      try {
        let response = await localFetch(entry.origin, { redirect: 'manual' });
        if (response.status < 500) {
          entry.status = 'ready';
          console.log(`   ready  ${entry.name.padEnd(24)} ${entry.origin}`);
        }
      } catch {
        // still booting
      }
    }),
  );
}
let ticker = setInterval(poll, 700);
ticker.unref?.();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function json(res, body) {
  let bytes = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': bytes.length,
  });
  res.end(bytes);
}

const server = createServer(async (req, res) => {
  let url = new URL(req.url ?? '/', 'http://localhost');
  let path = url.pathname;

  if (path === '/api/demos') {
    json(res, {
      demos: [...state.values()].map((entry) => ({
        name: entry.name,
        workload: entry.workload,
        title: entry.title,
        lede: entry.lede.replace(/\s+/g, ' ').trim(),
        look: entry.look,
        tries: entry.tries,
        origin: entry.origin,
        port: entry.port,
        status: entry.status,
        lines: entry.log.split('\n').length,
      })),
      laws: LAWS,
    });
    return;
  }

  if (path.startsWith('/api/log/')) {
    let entry = state.get(path.slice('/api/log/'.length));
    let text = entry ? entry.log : '';
    res.writeHead(entry ? 200 : 404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(text || '(nothing yet)\n');
    return;
  }

  // The hub is not a depot, so it cannot depend on `ui/pills` the way the
  // demos do. It serves the same source file instead — one definition, two
  // carriages, which is the L2/L3 point restated as a build step that is not
  // a build step.
  if (path === '/pills.js') {
    let bytes = await readFile(join(examplesDir, 'shared', 'ui', 'pills', 'pills.js'));
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(bytes);
    return;
  }

  if (path === '/deckbook') {
    try {
      let html = await readFile(join(repoRoot, 'deckbook.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('deckbook.html not found at the repo root');
    }
    return;
  }

  let file = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
  if (file.includes('..')) {
    res.writeHead(400);
    res.end();
    return;
  }
  try {
    let bytes = await readFile(join(here, 'app', file));
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(bytes);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log('\n  THE DECK DEMO HUB\n');
  console.log(`   ${DEMOS.length} demos starting — the ones that vendor from npm take a moment.\n`);
  console.log(`      http://localhost:${PORT}/\n`);
  console.log('   Each demo is its own process, its own depot, and its own store.');
  console.log('   Ctrl-C stops all of them.\n');
});
