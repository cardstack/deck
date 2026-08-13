// Activity — where agents are working, as one endpoint.
//
// Specified in docs/deck-activity-protocol.md. This is slices A0–A2: the law,
// the trie, the lean focus object, and claims. `story=1` (A3) is not here yet
// and the endpoint says so rather than pretending.
//
// WHY THIS IS PROTOCOL AND NOT HUB. It began as `/_hub/heat`, computed by the
// Hub process for the Hub's own decoration. That was the wrong home twice
// over: a second consumer would have had to reimplement the ranking and the
// two would have drifted, and a depot server that is not the Hub — a demo's
// second mount, a cloud working depot — could not answer "who is working
// here" at all. It is a fact about a depot, so the depot's server owns it.
//
// TWO CHANNELS, NEVER BLENDED.
//
//   touch   bytes actually changed here lately.        Observed.
//   claim   an agent SAID it is working here, w/ TTL.  Declared.
//
// Blending them into one number would be the tempting simplification and it
// destroys the only interesting distinction: an agent that has claimed a
// package and not yet written to it is the most informative state on the
// screen — it is about to change, and nothing has moved. Equally, a claim
// must never inflate the touch score, or "how much work landed here" stops
// being answerable and starts being gameable by saying so.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isIgnoredTreeSegment } from '@cardstack/deck/tree-hash';
import type { DepotMount } from './depot.js';

/** e^(−Δt/τ): a change now is worth 1, a change τ ago is worth 0.37. */
export const TAU_MS = 2 * 60 * 60 * 1000;
/** Beyond this, e^-24 is indistinguishable from zero and costs a walk. */
export const WINDOW_MS = 48 * 60 * 60 * 1000;
/** Serve stale heat this long after a change before rebuilding. */
export const INVALIDATE_DEBOUNCE_MS = 1500;

// The TTL belongs to the WRITER, not the reader — `deck claim` decides how
// long it is asserting for, and this only enforces expiry. Exported so the
// CLI and the server cannot disagree about the default.
export const CLAIM_DEFAULT_TTL_MS = 30 * 60 * 1000;
export const CLAIM_MAX_TTL_MS = 2 * 60 * 60 * 1000;

export interface Claim {
  actor: string;
  prefix: string;
  since: number;
  until: number;
  text?: string;
}

export interface Focus {
  id: string;
  prefix: string;
  grain: Grain;
  score: number;
  last: number;
  actors: { id: string; score: number }[];
  claims: Omit<Claim, 'prefix'>[];
}

export type Grain = 'depot' | 'package' | 'file';

interface Change {
  path: string;
  when: number;
  actor?: string;
}

/**
 * Where `deck claim` leaves records: one file per actor, never a shared
 * array. Two agents appending to one file is a lost update; two agents
 * writing two files is a set union — the codelist demo's argument applied to
 * this repo's own machinery.
 */
export const CLAIMS_DIR = 'claims';

/**
 * `<depot>/.deck/claims/` — beside the store, not inside it.
 *
 * `.deck/store/` is content-addressed package storage; a claim is neither
 * content nor a package, and filing it there would put a thing with a
 * half-hour lifetime among the bytes the depot exists to keep. One exported
 * derivation so the CLI that writes and the server that reads cannot end up
 * looking in two different places.
 */
export function claimsDirFor(depotDir: string): string {
  return join(depotDir, '.deck', CLAIMS_DIR);
}

/**
 * The claim register — READ ONLY, and read from disk.
 *
 * There is no POST. The server answers GET and HEAD and nothing else, and
 * that rule is worth more than the convenience of a write endpoint: it is
 * what makes an address a promise instead of an API. So a claim arrives the
 * way every other change to a depot arrives — the CLI writes it, and this
 * reads it. `deck claim` is the only mouth.
 *
 * That also makes the claim a thing an agent already has a way to say. An
 * agent editing a depot is already running `deck` commands; declaring intent
 * is one more, and it needs no token, no port, and no CORS.
 *
 * The file lives in `.deck/`, which is depot machinery rather than depot
 * content: it is outside every tree, so it can never move a tree hash, and it
 * is already ignored by git.
 *
 * ONE LIVE CLAIM PER ACTOR, which is the honest default. An agent that can
 * claim five prefixes at once can make a whole depot look busy without doing
 * anything, and then the colour stops meaning what it says.
 */
export class ClaimRegister {
  #dirs: { name: string; dir: string }[];
  #cache = new Map<string, Claim>();
  /** Max mtime of claims dirs last load; `-1` means never loaded. */
  #stamp = -1;

  constructor(depots: DepotMount[]) {
    this.#dirs = depots.map((depot) => ({ name: depot.name, dir: depot.dir }));
  }

  /**
   * Reload when a claims directory's mtime moved.
   *
   * A two-second clock throttle kept a *deleted* claim painted after Release
   * — wrap-up looked like a no-op. Mtime sees the file gone on the next GET.
   * Expiry still filters from cache in `under()` when disk is unchanged.
   */
  async refresh(): Promise<void> {
    let stamp = 0;
    for (let depot of this.#dirs) {
      let mtime = await stat(claimsDirFor(depot.dir))
        .then((info) => info.mtimeMs)
        .catch(() => 0);
      if (mtime > stamp) stamp = mtime;
    }
    if (stamp === this.#stamp) return;
    this.#stamp = stamp;
    let now = Date.now();
    let next = new Map<string, Claim>();
    for (let depot of this.#dirs) {
      let dir = claimsDirFor(depot.dir);
      let files = await readdir(dir).catch(() => [] as string[]);
      for (let file of files) {
        if (!file.endsWith('.json')) continue;
        let raw = await readFile(join(dir, file), 'utf8').catch(() => undefined);
        if (!raw) continue;
        let claim: Partial<Claim>;
        try {
          claim = JSON.parse(raw) as Partial<Claim>;
        } catch {
          // A half-written file during a CLI write is an ordinary race, not
          // an error worth surfacing: the next read picks it up.
          continue;
        }
        if (!claim.actor || !claim.prefix || !claim.until) continue;
        // Expiry is enforced HERE, not by the writer. A crashed agent cannot
        // clean up after itself, and a claim that outlives its process is
        // exactly the ghost this must never show.
        if (claim.until <= now) continue;
        next.set(claim.actor, {
          actor: claim.actor,
          prefix: normalise(`/${depot.name}/${String(claim.prefix).replace(/^\/+/, '')}`),
          since: claim.since ?? now,
          until: claim.until,
          text: claim.text,
        });
      }
    }
    this.#cache = next;
  }

  /** Live claims at or under `prefix`. */
  under(prefix: string): Claim[] {
    let now = Date.now();
    let clean = normalise(prefix);
    let found: Claim[] = [];
    for (let claim of this.#cache.values()) {
      if (claim.until <= now) continue;
      if (!clean || claim.prefix === clean || claim.prefix.startsWith(`${clean}/`)) {
        found.push(claim);
      }
    }
    return found;
  }

  all(): Claim[] {
    return this.under('');
  }
}

/** Trailing slashes off; a prefix must end on a segment boundary. */
function normalise(prefix: string): string {
  return `/${String(prefix ?? '').replace(/^\/+/, '').replace(/\/+$/, '')}`.replace(
    /^\/$/,
    '',
  );
}

/**
 * Cheap change leaves for gutters — not the seal tape.
 *
 * `/_history` / `/track` own seal-accurate rivers. Those answers pay for
 * `jj log` + `diff.summary()` and are multi-second on fat demo depots. Heat
 * only needs "what is warm right now", so this uses:
 *
 *   1. mtime of the live working tree (per file)
 *   2. mtime of each store `meta.json` (per package — covers Versions-only)
 *
 * Under-reports bursty seal history vs the old walk; never blocks a file list.
 */
async function depotChanges(depot: DepotMount): Promise<Change[]> {
  let since = Date.now() - WINDOW_MS;
  let changes: Change[] = [];

  async function walkLive(dir: string, prefix: string): Promise<void> {
    let entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (let entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (isIgnoredTreeSegment(entry.name)) continue;
      let path = prefix ? `${prefix}/${entry.name}` : entry.name;
      let full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkLive(full, path);
      } else {
        let info = await stat(full).catch(() => undefined);
        if (info && info.mtimeMs >= since) changes.push({ path, when: info.mtimeMs });
      }
    }
  }
  await walkLive(depot.dir, '');

  // Store packages: publisher/pkg/meta.json — one leaf per deck at package grain.
  let publishers = await readdir(depot.storeDir, { withFileTypes: true }).catch(
    () => [],
  );
  for (let pub of publishers) {
    if (!pub.isDirectory() || pub.name.startsWith('.')) continue;
    let pubDir = join(depot.storeDir, pub.name);
    let pkgs = await readdir(pubDir, { withFileTypes: true }).catch(() => []);
    for (let pkg of pkgs) {
      if (!pkg.isDirectory()) continue;
      let metaPath = join(pubDir, pkg.name, 'meta.json');
      let info = await stat(metaPath).catch(() => undefined);
      if (info && info.mtimeMs >= since) {
        changes.push({
          path: `${pub.name}/${pkg.name}`,
          when: info.mtimeMs,
        });
      }
    }
  }
  return changes;
}

interface Leaf {
  score: number;
  last: number;
  actors: Map<string, number>;
}

/**
 * The report, cached.
 *
 * Walking every depot's seal log per request costs more than the decoration
 * it buys. Hold a computed index, debounce invalidation so a save-storm does
 * not rebuild on every SSE tick, and keep a compact per-depot change list so
 * a rebuild is Σ(recent seals) rather than re-parsing multi-MB histories.
 */
export class ActivityIndex {
  #depots: DepotMount[];
  #claims: ClaimRegister;
  #leaves = new Map<string, Leaf>();
  #computedAt = 0;
  #ttlMs: number;
  #debounceMs: number;
  #invalidateTimer: ReturnType<typeof setTimeout> | undefined;
  /** Compact leaves per depot — cleared when invalidation flushes. */
  #changeCache = new Map<string, Change[]>();
  // SINGLE FLIGHT. A TTL alone does not prevent a stampede — it only helps
  // requests that arrive AFTER one has finished. Twelve depots take about
  // half a second to walk, a browser will happily have six requests in the
  // air at once, and every one of them arriving inside that half-second
  // missed the cache and started its own full walk.
  //
  // The failure was not slowness. Those six requests each hold one of the
  // browser's six per-origin connections, so the page could not issue any
  // OTHER request at all — it sat on `loading…` for ever while the server
  // sat at 0% CPU. Starvation does not throw and nothing in the console
  // says a word about it.
  //
  // So the second caller through the door does not compute anything; it
  // awaits the first caller's promise. One walk, however many askers.
  #inFlight: Promise<void> | undefined;

  constructor(
    depots: DepotMount[],
    options: { ttlMs?: number; debounceMs?: number } = {},
  ) {
    this.#depots = depots;
    this.#claims = new ClaimRegister(depots);
    // Long enough that start's 15s refresh and browse navigation share one
    // walk; short enough that heat still moves while you watch.
    this.#ttlMs = options.ttlMs ?? 30_000;
    this.#debounceMs = options.debounceMs ?? INVALIDATE_DEBOUNCE_MS;
  }

  get claims(): ClaimRegister {
    return this.#claims;
  }

  /**
   * Schedule a rebuild. Until the debounce fires, callers keep the last
   * index — a one-second-stale gutter beats a five-second blank page.
   */
  invalidate(): void {
    if (this.#invalidateTimer) return;
    this.#invalidateTimer = setTimeout(() => {
      this.#invalidateTimer = undefined;
      this.#computedAt = 0;
      this.#changeCache.clear();
    }, this.#debounceMs);
  }

  /** Tests / shutdown — drop debounce and force the next refresh to walk. */
  invalidateNow(): void {
    if (this.#invalidateTimer) {
      clearTimeout(this.#invalidateTimer);
      this.#invalidateTimer = undefined;
    }
    this.#computedAt = 0;
    this.#changeCache.clear();
  }

  /** Boot-time warm so the first browser hit is not the cold walk. */
  async warm(): Promise<void> {
    await this.#refresh();
  }

  async #refresh(): Promise<void> {
    if (!this.#inFlight) {
      // Cleared in a `finally` rather than after the await, so a walk that
      // throws does not wedge every later request behind a promise that will
      // never be replaced.
      this.#inFlight = this.#walk().finally(() => {
        this.#inFlight = undefined;
      });
    }
    return this.#inFlight;
  }

  async #depotChangeList(depot: DepotMount): Promise<Change[]> {
    let hit = this.#changeCache.get(depot.name);
    if (hit) return hit;
    let changes = await depotChanges(depot);
    this.#changeCache.set(depot.name, changes);
    return changes;
  }

  async #walk(): Promise<void> {
    // Claims refresh on their own, shorter clock: presence changes faster
    // than the touch index and must not wait on it.
    await this.#claims.refresh();
    let now = Date.now();
    if (this.#computedAt && now - this.#computedAt < this.#ttlMs) return;
    let leaves = new Map<string, Leaf>();
    // Parallel across depots — sequential jj log was Σ(cost), which made a
    // cold Hub look hung even after capping seals.
    let lists = await Promise.all(
      this.#depots.map(async (depot) => ({
        depot,
        changes: await this.#depotChangeList(depot),
      })),
    );
    for (let { depot, changes } of lists) {
      for (let change of changes) {
        let id = `/${depot.name}/${change.path}`;
        let weight = Math.exp(-(now - change.when) / TAU_MS);
        let leaf = leaves.get(id) ?? { score: 0, last: 0, actors: new Map() };
        leaf.score += weight;
        leaf.last = Math.max(leaf.last, change.when);
        if (change.actor) {
          leaf.actors.set(change.actor, (leaf.actors.get(change.actor) ?? 0) + weight);
        }
        leaves.set(id, leaf);
      }
    }
    this.#leaves = leaves;
    // Stamp when ready — walk-start would make a slow walk already expired.
    this.#computedAt = Date.now();
  }

  /**
   * Roll up to a prefix.
   *
   * Because the score is a SUM, this is a filter and an add — there is no
   * second index to keep true, and a directory is hot exactly because of what
   * is inside it. The `/`-boundary test matters: without it `/hub/app/run`
   * would also claim `/hub/app/runner`, and heat would leak sideways into a
   * deck that is merely spelled similarly.
   */
  #rollup(prefix: string): { score: number; last: number; actors: Map<string, number> } {
    let clean = normalise(prefix);
    let score = 0;
    let last = 0;
    let actors = new Map<string, number>();
    for (let [path, leaf] of this.#leaves) {
      if (clean && path !== clean && !path.startsWith(`${clean}/`)) continue;
      score += leaf.score;
      last = Math.max(last, leaf.last);
      for (let [actor, value] of leaf.actors) {
        actors.set(actor, (actors.get(actor) ?? 0) + value);
      }
    }
    return { score, last, actors };
  }

  #focus(prefix: string, grain: Grain): Focus {
    let { score, last, actors } = this.#rollup(prefix);
    return {
      id: normalise(prefix),
      prefix: normalise(prefix),
      grain,
      score,
      last,
      actors: [...actors]
        .map(([id, value]) => ({ id, score: value }))
        .sort((a, b) => b.score - a.score),
      claims: this.#claims.under(prefix).map(({ prefix: _p, ...rest }) => rest),
    };
  }

  /** Direct children of a prefix — the gutter query. */
  async children(prefix: string, grain: Grain = 'file'): Promise<Focus[]> {
    await this.#refresh();
    let clean = normalise(prefix);
    let names = new Set<string>();
    for (let path of this.#leaves.keys()) {
      if (clean && !path.startsWith(`${clean}/`)) continue;
      let rest = clean ? path.slice(clean.length + 1) : path.replace(/^\//, '');
      let head = rest.split('/')[0];
      if (head) names.add(head);
    }
    // A claim on a prefix nothing has touched must still produce a row, or
    // declared-but-not-yet-started work is invisible — which is the state
    // this protocol exists to make visible.
    for (let claim of this.#claims.all()) {
      if (clean && !claim.prefix.startsWith(`${clean}/`)) continue;
      let rest = clean ? claim.prefix.slice(clean.length + 1) : claim.prefix.replace(/^\//, '');
      let head = rest.split('/')[0];
      if (head) names.add(head);
    }
    return [...names]
      .map((name) => this.#focus(`${clean}/${name}`, grain))
      .sort((a, b) => b.score - a.score);
  }

  async at(prefix: string, grain: Grain = 'package'): Promise<Focus> {
    await this.#refresh();
    return this.#focus(prefix, grain);
  }

  /**
   * The ranked shortlist.
   *
   * Eligible if hot OR claimed, so intent that has produced no bytes yet
   * still gets a camera. Claims sort above equal touch rather than adding to
   * it — the boost is in the ORDER, never in S, so the score keeps meaning
   * "what landed here".
   */
  async top(count: number, grain: Grain): Promise<Focus[]> {
    await this.#refresh();
    let depth = grain === 'depot' ? 1 : grain === 'package' ? 3 : 0;
    let prefixes = new Set<string>();
    let collect = (path: string) => {
      if (depth === 0) {
        prefixes.add(path);
        return;
      }
      let parts = path.replace(/^\//, '').split('/');
      if (parts.length < depth) return;
      prefixes.add(`/${parts.slice(0, depth).join('/')}`);
    };
    for (let path of this.#leaves.keys()) collect(path);
    for (let claim of this.#claims.all()) collect(claim.prefix);
    return [...prefixes]
      .map((prefix) => this.#focus(prefix, grain))
      .sort(
        (a, b) =>
          Number(b.claims.length > 0) - Number(a.claims.length > 0) ||
          b.score - a.score,
      )
      .slice(0, count);
  }

  async report(query: URLSearchParams): Promise<Record<string, unknown>> {
    let grain = (query.get('grain') ?? 'package') as Grain;
    if (!['depot', 'package', 'file'].includes(grain)) grain = 'package';
    let base = {
      now: Date.now(),
      tau: TAU_MS,
      window: WINDOW_MS,
      // A3 is not built. Saying so beats answering `story=1` with a lean
      // object and letting a client conclude there is no story to tell.
      ...(query.get('story') === '1'
        ? { note: 'story=1 is specified but not implemented (protocol slice A3)' }
        : {}),
    };
    let prefix = query.get('prefix');
    if (prefix !== null && query.get('children') === '1') {
      return { ...base, foci: await this.children(prefix, grain === 'package' ? 'file' : grain) };
    }
    if (prefix !== null) {
      return { ...base, foci: [await this.at(prefix, grain)] };
    }
    let top = Number(query.get('top') ?? 12);
    return {
      ...base,
      foci: await this.top(Number.isFinite(top) && top > 0 ? Math.min(top, 200) : 12, grain),
    };
  }
}
