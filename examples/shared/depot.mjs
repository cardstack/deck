// The depot every demo serves, with the live loop actually turned on.
//
// A demo that serves a depot and stops there is showing at-rest state. That
// is half the story, and it is the half you can read. The other half only
// exists while something is running: you edit a file the server is serving,
// and without asking anyone the save is hashed, published as an immutable
// version, and sealed. So every demo here attaches a history backend and a
// watcher, and the live trees in them are live in the full sense.
//
// The watcher is started AFTER a demo has finished measuring its store.
// Every one of these demos prints counts — versions, objects, bytes — and
// asserts against them; a watcher publishing dev versions underneath those
// assertions would make the numbers depend on how fast the disk is.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeDirFor, watchDepot } from '@deck/server/depot';
import { createDeckServer } from '@deck/server/server';
import { createHistory } from '@deck/history/create';

const SHARED_TLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '.deck',
  'certs',
);

/**
 * Every demo speaks HTTPS + HTTP/2. One shared localhost leaf under
 * `examples/shared/.deck/certs` so accepting the browser warning once
 * covers every demo port the hub starts.
 */
export function createDemoServer(options) {
  if (!process.env.DECK_TLS_DIR) {
    process.env.DECK_TLS_DIR = SHARED_TLS_DIR;
  }
  return createDeckServer({ ...options, tls: true });
}

export function demoOrigin(port, host = 'localhost') {
  return `https://${host}:${port}`;
}

/**
 * A depot mount with tier-2 history attached when the machine can do it.
 * Prints which tier it got, because a capability that is quietly absent is
 * worse than one that is loudly absent.
 */
export async function openDemoDepot({ name, dir, quiet = false }) {
  let history = await createHistory({
    dir,
    onError: (error) => console.error(`   history: ${error}`),
  });
  if (!quiet) {
    // `detail` already names itself ("history: jj 0.43.0 (seal-grained)" /
    // "history: tier 1 — no jj on PATH"), so this only indents it.
    console.log(`   ${history.detail}`);
  }
  return { name, dir, storeDir: storeDirFor(dir), history: history.backend };
}

/**
 * Turn the live loop on: every settled save under this depot auto-publishes
 * as `<base>-dev.N`, is sealed if a backend attached, and is announced on the
 * SSE bus so any page carrying /_live/hmr.js reloads.
 */
export function serveLive({ depot, server, onPublish }) {
  let controller = watchDepot({
    depot,
    onLiveChange: (event) => server.liveBus.emit(event),
    onPublish:
      onPublish ??
      ((event) =>
        console.log(
          `   saved → ${event.name}@${event.version}${event.sealChangeId ? ` sealed ${event.sealChangeId.slice(0, 12)}` : ''}`,
        )),
    onError: (error) => console.error(`   watch: ${error}`),
  });
  controller.rescan();
  return controller;
}

/** The lines a demo prints to say the live half is on. */
export function liveNotes({ depot, port, origin }) {
  let base = origin ?? demoOrigin(port);
  let lines = [
    '   live: every save under depot/ auto-publishes @<base>-dev.N, and any',
    '         open page carrying /_live/hmr.js reloads itself',
    '   http2: HTTPS + HTTP/2 (self-signed localhost leaf — accept once)',
  ];
  if (depot.history) {
    lines.push(
      `   seals: ${base}/${depot.name}/_history — every save, published or not`,
    );
  }
  return lines.join('\n');
}
