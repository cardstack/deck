import { watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';
import { discoverDecks, type DeckRef } from '@deck/core/deck-scan';
import type { HistoryBackend } from '@deck/history/backend';
import {
  watchAndPublish,
  type WatchController,
  type WatchLiveChangeEvent,
  type WatchPublishEvent,
} from './watcher.ts';

// A realm on disk, laid out the way a Boxel realm is: the directory IS the
// namespace, and a URL path is a file path.
//
//   <root>/<realm>/                     served at /<realm>/
//     <publisher>/<package>/            a deck — /<realm>/<publisher>/<package>/…
//       importmap.json                  what makes the directory a deck
//       app.js
//     .deck/store/<publisher>/<package>/{meta.json,packs/*.pack.zip}
//     .jj/                              seals for the whole realm
//
// Both dot-directories are ignored by the tree hash, so a realm carries its
// own versions and its own history without either one changing what the
// realm IS. Copy the directory and everything — live files, published
// versions, seals — travels with it.
//
// Addressing follows the same shape:
//   /<realm>/<publisher>/<package>/<path>            the live file on disk
//   /<realm>/<publisher>/<package>@<version>/<path>  the sealed one
// Version-less is the working tree, exactly as a realm server serves it;
// adding `@<version>` reads the same path out of a seal instead.

export const DECK_DIR = '.deck';

export function storeDirFor(realmDir: string): string {
  return join(realmDir, DECK_DIR, 'store');
}

export { discoverDecks, type DeckRef };

export interface RealmMount {
  name: string;
  dir: string;
  storeDir: string;
  history?: HistoryBackend;
}

export interface WatchRealmOptions {
  realm: RealmMount;
  debounceMs?: number;
  onPublish?: (event: WatchPublishEvent) => void;
  onLiveChange?: (event: WatchLiveChangeEvent) => void;
  onDeck?: (deck: DeckRef) => void;
  onError?: (error: unknown) => void;
}

export interface RealmWatchController {
  decks(): DeckRef[];
  close(): void;
  settled(timeoutMs?: number): Promise<void>;
  // Picks up decks created after startup. Called automatically when the
  // realm changes shape; exposed so tests need not wait on a watcher.
  rescan(): Promise<DeckRef[]>;
}

// One watcher per deck (each publishes its own versions), plus a realm-level
// watch that notices a NEW deck appearing — creating a directory with an
// importmap.json is all it should take to start publishing.
export function watchRealm(options: WatchRealmOptions): RealmWatchController {
  let { realm, debounceMs, onPublish, onLiveChange, onDeck, onError } = options;
  let realmDir = resolve(realm.dir);
  let watchers = new Map<string, { deck: DeckRef; controller: WatchController }>();
  let closed = false;
  let rescanTimer: NodeJS.Timeout | undefined;

  function add(deck: DeckRef): void {
    if (watchers.has(deck.name)) {
      return;
    }
    let controller = watchAndPublish({
      dir: deck.dir,
      name: deck.name,
      storeDir: realm.storeDir,
      debounceMs,
      history: realm.history,
      historyDir: realmDir,
      onPublish,
      onLiveChange,
      onError,
    });
    watchers.set(deck.name, { deck, controller });
    onDeck?.(deck);
  }

  async function rescan(): Promise<DeckRef[]> {
    let found = await discoverDecks(realmDir);
    for (let deck of found) {
      add(deck);
    }
    return found;
  }

  // Mounting a realm discovers what is already there; the watch below only
  // has to notice what appears later.
  let initial = rescan().catch((error) => onError?.(error));

  let realmWatcher: FSWatcher = watch(
    realmDir,
    { recursive: true },
    (_event, raw) => {
      let path = raw?.toString().split('\\').join('/');
      // The realm's own machinery is not a deck, and a file inside an
      // existing deck is that deck's watcher's business.
      if (!path || path.startsWith('.')) {
        return;
      }
      if (rescanTimer) {
        clearTimeout(rescanTimer);
      }
      rescanTimer = setTimeout(() => {
        rescanTimer = undefined;
        if (!closed) {
          rescan().catch((error) => onError?.(error));
        }
      }, 200);
      rescanTimer.unref?.();
    },
  );

  return {
    decks() {
      return [...watchers.values()].map((entry) => entry.deck);
    },
    close() {
      closed = true;
      if (rescanTimer) {
        clearTimeout(rescanTimer);
      }
      realmWatcher.close();
      for (let { controller } of watchers.values()) {
        controller.close();
      }
    },
    async settled(timeoutMs?: number) {
      await initial;
      await Promise.all(
        [...watchers.values()].map(({ controller }) =>
          controller.settled(timeoutMs),
        ),
      );
    },
    rescan,
  };
}
