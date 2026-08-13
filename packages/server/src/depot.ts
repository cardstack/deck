import { watch, type FSWatcher } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { discoverDecks, type DeckRef } from '@cardstack/deck/deck-scan';
import {
  lockDepot,
  parseDepotLock,
  DEPOT_LOCK_PATH,
} from '@cardstack/deck/lock';
import type { HistoryBackend } from '@cardstack/deck-history/backend';
import {
  watchAndPublish,
  type WatchController,
  type WatchLiveChangeEvent,
  type WatchPublishEvent,
} from './watcher.ts';

// A depot on disk, laid out the way a Boxel realm is: the directory IS the
// namespace, and a URL path is a file path.
//
//   <root>/<depot>/                     served at /<depot>/
//     <publisher>/<package>/            a deck — /<depot>/<publisher>/<package>/…
//       package.json                    what makes the directory a deck
//       app.js
//     importmap.json                    the depot lock (not a deck)
//     .deck/store/{_objects/,_trees/,<publisher>/<package>/meta.json}
//     .deck/timeline/                   seals for the whole depot (via deckd)
//
// Both dot-directories are ignored by the tree hash, so a depot carries its
// own versions and its own history without either one changing what the
// depot IS. Copy the directory and everything — live files, published
// versions, seals — travels with it.
//
// Addressing follows the same shape:
//   /<depot>/<publisher>/<package>/<path>            the live file on disk
//   /<depot>/<publisher>/<package>@<version>/<path>  the sealed one
// Version-less is the working tree, exactly as a realm server serves it;
// adding `@<version>` reads the same path out of a seal instead.

export const DECK_DIR = '.deck';

export function storeDirFor(depotDir: string): string {
  return join(depotDir, DECK_DIR, 'store');
}

export { discoverDecks, type DeckRef };

export interface DepotMount {
  name: string;
  dir: string;
  storeDir: string;
  history?: HistoryBackend;
}

export interface WatchDepotOptions {
  depot: DepotMount;
  debounceMs?: number;
  onPublish?: (event: WatchPublishEvent) => void;
  onLiveChange?: (event: WatchLiveChangeEvent) => void;
  onDeck?: (deck: DeckRef) => void;
  onError?: (error: unknown) => void;
}

export interface DepotWatchController {
  decks(): DeckRef[];
  close(): void;
  settled(timeoutMs?: number): Promise<void>;
  // Picks up decks created after startup. Called automatically when the
  // depot changes shape; exposed so tests need not wait on a watcher.
  rescan(): Promise<DeckRef[]>;
}

// One watcher per deck (each publishes its own versions), plus a depot-level
// watch that notices a NEW deck appearing — creating a directory with a
// package.json is all it should take to start publishing.
export function watchDepot(options: WatchDepotOptions): DepotWatchController {
  let { depot, debounceMs, onPublish, onLiveChange, onDeck, onError } = options;
  let depotDir = resolve(depot.dir);
  let watchers = new Map<string, { deck: DeckRef; controller: WatchController }>();
  let closed = false;
  let rescanTimer: NodeJS.Timeout | undefined;
  let locking = false;

  async function refreshContinuousLock(): Promise<void> {
    if (locking) {
      return;
    }
    try {
      let text = await readFile(join(depotDir, DEPOT_LOCK_PATH), 'utf8');
      if (!parseDepotLock(text).continuous) {
        return;
      }
    } catch {
      return;
    }
    locking = true;
    try {
      let locked = await lockDepot({
        depotDir: depot.dir,
        depotName: depot.name,
        storeDir: depot.storeDir,
        update: true,
        continuous: true,
      });
      if (locked.changed) {
        await writeFile(join(depotDir, DEPOT_LOCK_PATH), locked.text);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      locking = false;
    }
  }

  function add(deck: DeckRef): void {
    if (watchers.has(deck.name)) {
      return;
    }
    let controller = watchAndPublish({
      dir: deck.dir,
      name: deck.name,
      storeDir: depot.storeDir,
      debounceMs,
      history: depot.history,
      historyDir: depotDir,
      onPublish: async (event) => {
        onPublish?.(event);
        await refreshContinuousLock();
      },
      onLiveChange,
      onError,
    });
    watchers.set(deck.name, { deck, controller });
    onDeck?.(deck);
  }

  async function rescan(): Promise<DeckRef[]> {
    let found = await discoverDecks(depotDir);
    for (let deck of found) {
      add(deck);
    }
    return found;
  }

  // Mounting a depot discovers what is already there; the watch below only
  // has to notice what appears later.
  let initial = rescan().catch((error) => onError?.(error));

  let depotWatcher: FSWatcher = watch(
    depotDir,
    { recursive: true },
    (_event, raw) => {
      let path = raw?.toString().split('\\').join('/');
      // The depot's own machinery is not a deck, and a file inside an
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
      depotWatcher.close();
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
