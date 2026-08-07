import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parsePackages, IMPORT_MAP_PATH } from '@deck/core/import-map';
import { packFromDir } from '@deck/core/pack';
import {
  nextDevVersion,
  publishToStore,
  readStoreMeta,
} from '@deck/core/store';
import { treeHashFromDir } from '@deck/core/tree-hash';
import type { HistoryBackend } from '@deck/history/backend';

// The auto-publish loop:
//
//   file change → debounce (quiet period) → treeHash(dir)
//     → unchanged since last publish? STOP (dedup)
//     → [tier 2: seal the tree, take the changeId]
//     → packFromDir → publish <base>-dev.<n>, tag `dev`
//
// <base> comes from the directory's own importmap.json — the map stays the
// manifest, and bumping its version is the only edit a new line needs.
// Ranges never match prereleases, so auto-publishes are invisible to every
// consumer who did not explicitly opt in via the `dev` tag or an exact pin.
// Stable versions are NEVER auto-minted: semver intent is human.
//
// Tier 2 (a `history` backend) slots in WITHOUT changing that loop: every
// save is sealed on its own debounce, so the states between publishes are
// recoverable too, and each published pack records the seal it was cut from.

// jj and git write into their own repos on every operation, and those
// writes land inside the watched tree. Treating them as tree changes would
// make sealing feed itself: seal → .jj write → event → seal. The tree hash
// already ignores both directories, so filtering here costs nothing.
const REPO_INTERNALS = /^\.(jj|git)(\/|$)/;

export interface WatchPublishEvent {
  name: string;
  version: string;
  treeHash: string;
  // The tier-2 seal this version was cut from, when history is attached.
  sealChangeId?: string;
}

export interface WatchLiveChangeEvent {
  name: string;
  treeHash: string;
}

export interface WatchOptions {
  dir: string;
  name: string;
  storeDir: string;
  debounceMs?: number;
  // Tier-2 history. Absent = tier 1: the store is still the history, just
  // at published-state granularity.
  history?: HistoryBackend;
  onPublish?: (event: WatchPublishEvent) => void;
  // Fired as soon as a new treeHash is observed — before packing — so
  // live HMR can reload against on-disk `/live/` bytes without waiting
  // for the auto-publish zip.
  onLiveChange?: (event: WatchLiveChangeEvent) => void;
  onError?: (error: unknown) => void;
}

export interface WatchController {
  close(): void;
  // Settles when the CURRENT burst of changes (if any) has been processed;
  // used by tests to await quiescence deterministically.
  settled(): Promise<void>;
}

export function watchAndPublish(options: WatchOptions): WatchController {
  let {
    dir,
    name,
    storeDir,
    debounceMs = 500,
    history,
    onPublish,
    onLiveChange,
    onError,
  } = options;
  // A store inside the watched tree feeds itself: publishing writes packs
  // into the tree, which changes its treeHash, which publishes again —
  // forever, with every pack swallowing the previous ones. Refuse it
  // outright rather than leave it as a footgun in a guide.
  let watchedRoot = resolve(dir);
  let storeRoot = resolve(storeDir);
  if (storeRoot === watchedRoot || storeRoot.startsWith(`${watchedRoot}/`)) {
    throw new Error(
      `the store (${storeRoot}) is inside the watched directory (${watchedRoot}); ` +
        `every publish would change the tree and trigger another publish — keep the store outside`,
    );
  }
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let dirty = false;
  let closed = false;
  let lastPublishedTreeHash: string | undefined;
  let pending: Promise<void> = Promise.resolve();
  let watcher: FSWatcher = watch(dir, { recursive: true }, (_event, raw) => {
    let path = raw?.toString().split('\\').join('/');
    if (path && REPO_INTERNALS.test(path)) {
      return;
    }
    // Only a NAMED file feeds the sealer. When the platform gives no
    // filename we cannot tell a repo write from a tree write, so we fall
    // back to publish-time sealing rather than risk the feedback loop.
    if (path && history) {
      history.noteMutation(dir, path);
    }
    schedule();
  });

  function schedule(): void {
    if (closed) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      pending = run();
    }, debounceMs);
  }

  async function run(): Promise<void> {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      do {
        dirty = false;
        await publishIfChanged();
      } while (dirty && !closed);
    } catch (error) {
      onError?.(error);
    } finally {
      running = false;
    }
  }

  async function publishIfChanged(): Promise<void> {
    let { treeHash } = await treeHashFromDir(dir);
    if (treeHash === lastPublishedTreeHash) {
      return;
    }
    // Notify live clients first: `/live/` already serves the new bytes.
    onLiveChange?.({ name, treeHash });
    let base = '0.0.0';
    try {
      let map = parsePackages(
        await readFile(join(dir, IMPORT_MAP_PATH), 'utf8'),
      );
      base = map?.[name]?.version ?? base;
    } catch {
      // no map — dev line runs on 0.0.0
    }
    let meta = await readStoreMeta(storeDir, name);
    let version = nextDevVersion(meta, base);
    // Seal first, then pack, so the version names a state that history can
    // also hand back file-by-file. `flush` returns the changeId it sealed;
    // when the debounced sealer already got there, `head` names that seal.
    let sealChangeId = history
      ? ((await history.flush(dir)) ?? (await history.head(dir)))
      : undefined;
    // Content-addressing means an identical tree keeps the pack bytes it was
    // first stored under — so a tree that comes back (a restore) keeps the
    // provenance of the seal that first produced it. The version is new; the
    // sealed content, correctly, is not.
    let packBytes = await packFromDir(
      dir,
      sealChangeId ? { sealChangeId } : undefined,
    );
    try {
      await publishToStore(storeDir, name, version, packBytes, {
        tag: 'dev',
      });
    } catch (error) {
      // A racing publish of the same state is fine; anything else surfaces.
      if (!/already published/.test(String(error))) {
        throw error;
      }
    }
    lastPublishedTreeHash = treeHash;
    onPublish?.({ name, version, treeHash, sealChangeId });
  }

  return {
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      watcher.close();
    },
    async settled() {
      // Filesystem events arrive asynchronously — always wait out at least
      // one full debounce window before checking for quiescence, then wait
      // for any scheduled/in-flight run to finish.
      do {
        await new Promise((resolve) => setTimeout(resolve, debounceMs + 60));
        await pending;
      } while (timer !== undefined || running);
      await pending;
    },
  };
}
