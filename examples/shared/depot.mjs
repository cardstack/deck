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
import { storeDirFor, watchDepot } from '@cardstack/deck-server/depot';
import { createDeckServer } from '@cardstack/deck-server/server';
import { createHistory } from '@cardstack/deck-history/create';

const SHARED_TLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '.deck',
  'certs',
);

/**
 * Every demo speaks HTTPS + HTTP/2. One shared localhost leaf under
 * `examples/shared/.deck/certs` so accepting the browser warning once
 * covers every demo port the hub starts.
 *
 * `DECK_DEMO_HTTP=1` drops back to plain HTTP/1.1, the same switch
 * `deck serve --http` is. It exists because the self-signed leaf costs a
 * click-through per port, and when you are debugging a demo rather than
 * measuring one, that interstitial is between you and the console.
 */
export const DEMO_TLS = process.env.DECK_DEMO_HTTP !== '1';

export function createDemoServer(options) {
  if (!process.env.DECK_TLS_DIR) {
    process.env.DECK_TLS_DIR = SHARED_TLS_DIR;
  }
  return createDeckServer({ ...options, tls: DEMO_TLS });
}

export function demoOrigin(port, host = 'localhost') {
  return `${DEMO_TLS ? 'https' : 'http'}://${host}:${port}`;
}

/**
 * A depot mount with every-save History attached when the machine can do it.
 * Prints which of the two it got, because a capability that is quietly absent
 * is worse than one that is loudly absent.
 */
export async function openDemoDepot({ name, dir, quiet = false }) {
  let history = await createHistory({
    dir,
    onError: (error) => console.error(`   history: ${error}`),
  });
  if (!quiet) {
    // `detail` already names itself ("history: deckd at … — a Step per save" /
    // "history: no deckd at … — Versions only"), so this only indents it.
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
    DEMO_TLS
      ? '   http2: HTTPS + HTTP/2 (self-signed localhost leaf — accept once)'
      : '   http:  plain HTTP/1.1 (DECK_DEMO_HTTP=1)',
  ];
  if (depot.history) {
    lines.push(
      `   seals: ${base}/${depot.name}/_history — every save, published or not`,
    );
  }
  return lines.join('\n');
}
