import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { DEFAULT_IGNORE, isIgnoredTreeSegment } from '@cardstack/deck/tree-hash';
import {
  PACKAGE_JSON_PATH,
  parsePackageJson,
} from '@cardstack/deck/package-json';
import { packFromDir } from '@cardstack/deck/pack';
import {
  nextDevVersion,
  publishToStore,
  readStoreMeta,
  setDistTag,
} from '@cardstack/deck/store';
import { treeHashFromDir } from '@cardstack/deck/tree-hash';
import type { HistoryBackend } from '@cardstack/deck-history/backend';

// The auto-publish loop:
//
//   file change → debounce (quiet period) → treeHash(dir)
//     → unchanged since last publish? STOP (dedup)
//     → [with every-save History: capture the tree, take the changeId]
//     → packFromDir → publish <base>-dev.<n>, tag `dev`
//
// <base> comes from the directory's own package.json — bumping its version
// is the only edit a new line needs.
// Ranges never match prereleases, so auto-publishes are invisible to every
// consumer who did not explicitly opt in via the `dev` tag or an exact pin.
// Stable versions are NEVER auto-minted: semver intent is human.
//
// Tier 2 (a `history` backend) slots in WITHOUT changing that loop: every
// save is sealed on its own debounce, so the states between publishes are
// recoverable too, and each published pack records the seal it was cut from.

// Machinery writes land inside the watched tree. Treating them as edits
// would make capturing feed itself: capture → .deck/history (or .jj) write →
// event → treeHash → seal. Named events under DEFAULT_IGNORE are dropped.
// Nameless events are dropped too: on macOS, recursive fs.watch often
// omits the filename for deep repo writes, and re-hashing the whole depot
// on those is what wedged the Hub at 100% CPU after History moved under
// `.deck/`. A real editor save reports a path; mount already schedules once.
function isMachineryWatchPath(path: string | undefined): boolean {
  if (!path) {
    return true;
  }
  return path.split('/').some((segment) => isIgnoredTreeSegment(segment));
}

export interface WatchPublishEvent {
  name: string;
  version: string;
  treeHash: string;
  // The Step this version was cut from, when every-save History is attached.
  sealChangeId?: string;
  // True when the tree was ALREADY published under this name: no new
  // version was minted, the `dev` tag simply points back at the one that
  // holds this exact content.
  reused?: boolean;
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
  // The History. Absent: the store is still the history, just
  // at published-state granularity.
  history?: HistoryBackend;
  // Where the history repo lives. A depot seals as ONE tree, the way a
  // realm server does, so several deck watchers inside a depot share the
  // depot's repo; their paths are reported depot-relative. Defaults to the
  // watched directory (a standalone deck is its own depot).
  historyDir?: string;
  // When false, this watcher publishes Versions + HMR only — it does not
  // noteMutation / flush History. Default false: deckd's FS watch owns seals.
  sealOnWatch?: boolean;
  onPublish?: (event: WatchPublishEvent) => void;
  // Fired as soon as a new treeHash is observed — before packing — so
  // live HMR can reload against on-disk `/live/` bytes without waiting
  // for the auto-publish zip.
  onLiveChange?: (event: WatchLiveChangeEvent) => void;
  onError?: (error: unknown) => void;
}

export interface WatchController {
  close(): void;
  // Resolves once the store reflects the current tree — the publish loop is
  // idle AND has nothing left to do. Bounded, so a deck that cannot publish
  // (a bad manifest, say) does not hang a caller forever.
  settled(timeoutMs?: number): Promise<void>;
}

export function watchAndPublish(options: WatchOptions): WatchController {
  let {
    dir,
    name,
    storeDir,
    debounceMs = 500,
    history,
    historyDir,
    sealOnWatch,
    onPublish,
    onLiveChange,
    onError,
  } = options;
  // deckd owns History seals via its watchexec-shaped FS plane. Hub/Node
  // watchers still publish + HMR; they must not double-note /flush.
  let sealWithWatch = sealOnWatch ?? false;
  // A store inside the watched tree feeds itself: publishing writes packs
  // into the tree, which changes its treeHash, which publishes again —
  // forever, with every pack swallowing the previous ones. Refuse it
  // outright rather than leave it as a footgun in a guide.
  // …unless it sits in a directory the tree hash ignores (`.deck`, `.jj`),
  // which is exactly how a depot holds its own store without feeding itself.
  let watchedRoot = resolve(dir);
  let storeRoot = resolve(storeDir);
  if (storeRoot === watchedRoot || storeRoot.startsWith(`${watchedRoot}/`)) {
    let hidden = relative(watchedRoot, storeRoot)
      .split('/')
      .some((segment) => isIgnoredTreeSegment(segment));
    if (!hidden) {
      throw new Error(
        `the store (${storeRoot}) is inside the watched directory (${watchedRoot}); ` +
          `every publish would change the tree and trigger another publish — keep the store outside, ` +
          `or under a directory the tree hash ignores (${[...DEFAULT_IGNORE].join(', ')}, .jj.*)`,
      );
    }
  }
  let sealRoot = historyDir ? resolve(historyDir) : watchedRoot;
  // Seal paths are reported relative to the repo, so a depot's log reads
  // `chris/tier-maker/app.js` — the same path the URL uses.
  let sealPrefix = relative(sealRoot, watchedRoot);
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let dirty = false;
  let closed = false;
  let lastPublishedTreeHash: string | undefined;
  let pending: Promise<void> = Promise.resolve();
  let watcher: FSWatcher = watch(dir, { recursive: true }, (_event, raw) => {
    let path = raw?.toString().split('\\').join('/');
    if (isMachineryWatchPath(path)) {
      return;
    }
    // Only a NAMED identity-tree file feeds the sealer / publish loop.
    if (history && sealWithWatch) {
      history.noteMutation(sealRoot, sealPrefix ? `${sealPrefix}/${path}` : path!);
    }
    schedule();
  });

  // Mounting is itself a reason to check: the tree on disk may never have
  // been published (a fresh deck), or may have moved while nothing was
  // watching. Re-publishing an already-published tree costs nothing — the
  // reuse path below just re-points `dev` — so this is safe on every start.
  schedule();

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
      let pkg = parsePackageJson(
        await readFile(join(dir, PACKAGE_JSON_PATH), 'utf8'),
      );
      if (pkg?.version) {
        base = pkg.version;
      }
    } catch {
      // no package.json — dev line runs on 0.0.0
    }
    let meta = await readStoreMeta(storeDir, name);
    // Content-addressed identity, taken seriously: a tree that is already
    // published under this name needs no second version — it needs the dev
    // tag to point back at the one it has. This is what makes a restore
    // (or a restart) cost nothing instead of inflating the version list.
    let existing = Object.entries(meta?.versions ?? {}).find(
      ([, record]) => record.treeHash === treeHash,
    )?.[0];
    if (existing) {
      if (meta!.tags.dev !== existing) {
        await setDistTag(storeDir, name, 'dev', existing);
      }
      lastPublishedTreeHash = treeHash;
      onPublish?.({ name, version: existing, treeHash, reused: true });
      return;
    }
    let version = nextDevVersion(meta, base);
    // Seal only when this watcher owns History. With deckd, the daemon FS
    // plane seals; we still read head() for pack provenance (may lag one burst).
    let sealChangeId = history
      ? sealWithWatch
        ? ((await history.flush(sealRoot)) ?? (await history.head(sealRoot)))
        : await history.head(sealRoot)
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
    // Settled means what a caller actually wants: THE STORE REFLECTS THE
    // TREE. Waiting out the debounce is not enough — a filesystem event can
    // arrive late, or (rarely) not at all — so this also compares the tree
    // against the last publish and drives the loop itself when they differ.
    async settled(timeoutMs = 10_000) {
      let deadline = Date.now() + timeoutMs;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, debounceMs + 60));
        await pending;
        if (timer !== undefined || running) {
          continue;
        }
        let { treeHash } = await treeHashFromDir(dir);
        if (treeHash === lastPublishedTreeHash || Date.now() > deadline) {
          await pending;
          return;
        }
        // The tree moved and nothing is queued: the notification never came.
        schedule();
      }
    },
  };
}
