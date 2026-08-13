import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  createSecureServer as createHttp2SecureServer,
  type Http2SecureServer,
  type Http2ServerRequest,
  type Http2ServerResponse,
} from 'node:http2';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveTlsMaterials, type TlsOption } from './tls.ts';
import { ActivityIndex } from './activity.ts';
import { DECKBOOK_PATHS, loadDeckbookHtml } from './deckbook.ts';
import { readZipEntry } from '@cardstack/deck/canonical-zip';
import {
  type PackageMapEntry,
  treePathFromMapValue,
  IMPORT_MAP_PATH,
  MOUNT_SEPARATOR,
  parsePackages,
} from '@cardstack/deck/import-map';
import { peekPacklist } from '@cardstack/deck/pack';
import type { Packlist } from '@cardstack/deck/packlist';
import { readTree, readTreeFile } from '@cardstack/deck/object-store';
import { readEnvelope, summarizeEnvelope } from '@cardstack/deck/signature';
import { negotiateBody } from './compression.ts';
import {
  documentEntries,
  injectModulePreload,
  moduleClosure,
  SEGMENT,
  type Closure,
} from './preload.ts';
import {
  listStorePackages,
  readStoredPack,
  readStoredFile,
  readStoreMeta,
  resolveVersionSpec,
} from '@cardstack/deck/store';
import {
  resolveDependencies,
  resolveScopes,
  parseDepotLock,
  unfrozenBindingsFromDepot,
  unfrozenBindingsFromTree,
  unfrozenKeysMissingFromLock,
  decksFromTreePaths,
  rewriteImportMapIntoStep,
} from '@cardstack/deck/lock';
import {
  PACKAGE_JSON_PATH,
  parsePackageJson,
  entryFromPackageJson,
  subpathExports,
} from '@cardstack/deck/package-json';
import {
  parseLink,
  resolveInheritance,
} from '@cardstack/deck/inherit';
import { isValidTreePath, treeHashFromDir } from '@cardstack/deck/tree-hash';
import {
  isValidHistoryPath,
  isValidRevisionId,
} from '@cardstack/deck-history/backend';
import {
  bytesToPreview,
  listingFromLiveDir,
  listingFromPacklist,
  looksLikeText,
  findPackFile,
  readLiveFile,
} from './browse.ts';
import { BROWSER_HTML } from './browser-ui.ts';
import {
  createLiveBus,
  HMR_CLIENT_SOURCE,
  type LiveBus,
  type LiveChangeEvent,
} from './live-events.ts';
import { injectImportMap } from './inject-importmap.ts';
import { surveyOffers } from './offer-survey.ts';
import { discoverDecks, type DepotMount } from './depot.ts';

// The minimal Deck server: READ-ONLY serving of depots laid out on disk.
// All state changes happen through the CLI and the watcher (an agent
// arranges state; distribution follows mechanically) — there is no write
// endpoint here at all.
//
// The address space IS the disk layout (see depot.ts):
//
//   /<depot>/<publisher>/<package>/<path>            live bytes, no-store
//   /<depot>/<publisher>/<package>@<spec>/<path>     sealed, immutable
//   /<depot>/_history/<changeId>/<path>              any sealed state
//
// A version-less URL is the working tree, the way a realm server serves a
// depot file. Adding `@<version>` reads the same path out of a seal. The
// depot's own machinery (`.deck`, `.jj`) is never servable.
//
// Reserved: a leading `_` on a path segment (`/_packages`, `/_browse`,
// `/_live/*`, `/<depot>/_history`), matching the realm server's convention,
// so no depot, publisher, or package can shadow an endpoint.
//
// Serving rules carried over from the protocol (and its unpkg/esm.sh
// hardening):
//   - exact-version raw bytes: `immutable, 1y` + Content-Digest
//   - range/dist-tag: ONE 302 hop straight to the canonical target,
//     short TTL; the query string survives every redirect
//   - bare exact form → 301 to the entry module; export alias → 301
//     (the answer derives from sealed content; permanent)
//   - `?meta` on the bare form: machine-readable version listing
//   - `?format=pack` on the bare form: the stored faithful pack itself
//   - misses: coded JSON errors, two negative-cache tiers by permanence
//   - `!/` mounts: serve files from inside a pack stored in a deck
//     (depth-capped); the reader enforces size caps and never touches
//     the filesystem with archive-derived paths
//   - HEAD rides the GET path

// SEGMENT comes from preload.ts so the router and the closure walk cannot
// disagree about what a name is.
const SEALED_PATH = new RegExp(
  `^/(?<depot>${SEGMENT})/(?<publisher>${SEGMENT})/(?<pkg>${SEGMENT})@(?<spec>[^/]+)(?<rest>/.*)?$`,
);
const HISTORY_PATH = new RegExp(
  `^/(?<depot>${SEGMENT})/_history(?:/(?<rev>[^/]+))?(?<rest>/.*)?$`,
);
const LIVE_PATH = new RegExp(`^/(?<depot>${SEGMENT})(?<rest>/.*)?$`);
const BROWSE_PATH = new RegExp(
  `^/_browse/(?<depot>${SEGMENT})(?:/(?<publisher>${SEGMENT}))?(?:/(?<pkg>${SEGMENT})(?:@(?<spec>[^/]+))?)?(?<rest>/.*)?$`,
);
const PACKAGES_INDEX = /^\/_packages\/?$/;
const PACKAGES_PATH = new RegExp(
  `^/_packages/(?<depot>${SEGMENT})/(?<publisher>${SEGMENT})/(?<pkg>${SEGMENT})$`,
);
const OFFERS_PATH = new RegExp(`^/(?<depot>${SEGMENT})/_offers/?$`);
// L9: endorsements are addressed by TREE, not by package or version, because
// that is what they are about — and it is what lets a fork of the same bytes
// read the same answer (L10).
const SIGNATURES_PATH = new RegExp(
  `^/(?<depot>${SEGMENT})/_trees/(?<treeHash>[0-9a-f]{64})/signatures/?$`,
);
// One door for "where are agents working". See docs/deck-activity-protocol.md
// and the note at the top of activity.ts for why this is protocol rather than
// something the Hub computes for itself.
const ACTIVITY_PATH = /^\/_activity\/?$/;
const LIVE_EVENTS_PATH = '/_live/events';
const LIVE_HMR_PATH = '/_live/hmr.js';
const BROWSER_PATHS = new Set(['/', '/_browser', '/_browser/']);

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const SHORT_CACHE = 'public, max-age=60, s-maxage=300';

const MAX_MOUNT_DEPTH = 2;

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
};

function contentTypeFor(path: string): string {
  let dot = path.lastIndexOf('.');
  return (
    (dot >= 0 ? CONTENT_TYPES[path.slice(dot)] : undefined) ??
    'application/octet-stream'
  );
}

// `pub/pkg@spec` → [`pub/pkg`, `spec`]. The `@` that matters is the last
// one, because a version can contain none and a name never contains one.
function splitAtVersion(value: string): [string, string | undefined] {
  let at = value.lastIndexOf('@');
  return at <= 0 ? [value, undefined] : [value.slice(0, at), value.slice(at + 1)];
}

// Overrides may be written with or without the depot they are already in.
function stripDepot(name: string, depot: string): string {
  return name.startsWith(`${depot}/`) ? name.slice(depot.length + 1) : name;
}

function digestOf(bytes: Buffer): string {
  return `sha-256=:${createHash('sha256').update(bytes).digest('base64')}:`;
}

// The representation digest: the module bytes, encoding aside. A caller
// sets this; `respond` derives `Content-Digest` from whatever it actually
// puts on the wire. Keeping the derivation in one place is what stops the
// two from drifting apart at some call site nobody re-read.
function reprDigest(bytes: Buffer): string {
  return digestOf(bytes);
}

export interface DeckServerOptions {
  // The depots this server mounts. Each is a directory on disk whose
  // contents ARE its URL space.
  depots: DepotMount[];
  // Optional fallthrough for anything that is not a Deck route (demo
  // pages, health checks). Without it, non-routes 404.
  // Typed against the Node HTTP compat shapes — `allowHTTP1` h2 requests
  // duck-type the same `writeHead` / `end` surface at runtime.
  fallback?: (req: IncomingMessage, res: ServerResponse) => void;
  // In-process bus for live-tree change notifications (SSE). Created
  // automatically when omitted; pass one in to share with watchers.
  liveBus?: LiveBus;
  // When true (or when cert/key materials are passed), listen with
  // `http2.createSecureServer({ allowHTTP1: true })` so browsers get
  // HTTP/2 multiplexing for many-module pages. `true` mints/loads a
  // localhost leaf via `resolveTlsMaterials` (see `./tls.ts`). Omit for
  // plain HTTP/1.1 — what the unit tests use.
  tls?: TlsOption;
}

export type DeckServer = (Server | Http2SecureServer) & {
  liveBus: LiveBus;
  // 'https' always means HTTP/2 is offered (HTTP/1.1 still accepted).
  protocol: 'http' | 'https';
  /** Prefetch `/_activity` so the first browser hit is not a cold seal walk. */
  warmActivity: () => Promise<void>;
};

// Resolve a possibly-mounted path against a pack: `a/b.js` reads directly;
// `vendor/x.pack.zip!/inner.js` opens the nested pack (depth-capped).
function readTreePath(packBytes: Buffer, path: string): Buffer | undefined {
  let segments = path.split(MOUNT_SEPARATOR);
  if (segments.length - 1 > MAX_MOUNT_DEPTH) {
    return undefined;
  }
  let current: Buffer | undefined = packBytes;
  for (let i = 0; i < segments.length; i++) {
    if (current === undefined) {
      return undefined;
    }
    let inner =
      i < segments.length - 1 ? `${segments[i]}.pack.zip` : segments[i];
    current = readZipEntry(current, inner);
  }
  return current;
}

interface CachedPack {
  treeHash: string;
  packlist: Packlist;
  // One file, straight out of its object.
  read(path: string): Promise<Buffer | undefined>;
  // The sealed archive, rebuilt on first request and then held.
  bytes(): Promise<Buffer | undefined>;
}

export function createDeckServer(options: DeckServerOptions): DeckServer {
  let { depots, fallback } = options;
  let liveBus = options.liveBus ?? createLiveBus();
  let byName = new Map(depots.map((depot) => [depot.name, depot]));
  // The activity index reads the same depots the router serves, so "who is
  // working here" can never be answered about a depot this server does not
  // actually hold.
  let activity = new ActivityIndex(depots);
  // Do not await — listen should not block on jj log across every depot.
  void activity.warm().catch(() => {});
  // Stored packs are immutable (published versions never change), so this
  // cache never invalidates; the cap only bounds memory.
  let packCache = new Map<string, CachedPack>();
  const PACK_CACHE_MAX = 50;
  // Keyed on the sealed document plus the exact map it was resolved with, so
  // a `?with=` trial can never be served a sealed page's closure.
  let closureCache = new Map<string, Closure>();
  const CLOSURE_CACHE_MAX = 100;

  // A sealed version is opened LAZILY. The store keeps files as objects and
  // rebuilds the archive on request, so decoding — or worse, re-deflating —
  // 374 modules to serve one of them would be pure waste. The listing comes
  // from the tree manifest, a file comes from its own object, and the zip is
  // built only when someone actually asks for `?format=pack`.
  async function loadPack(
    depot: DepotMount,
    name: string,
    version: string,
  ): Promise<CachedPack | undefined> {
    let key = `${depot.name}/${name}@${version}`;
    let hit = packCache.get(key);
    if (hit) {
      return hit;
    }
    let meta = await readStoreMeta(depot.storeDir, name);
    let record = meta?.versions[version];
    if (!record) {
      return undefined;
    }
    let packlist = record.file
      ? undefined
      : await readTree(depot.storeDir, record.treeHash);
    let legacyBytes = packlist
      ? undefined
      : await readStoredPack(depot.storeDir, name, version);
    if (!packlist && !legacyBytes) {
      return undefined;
    }
    let resolved = packlist ?? peekPacklist(legacyBytes!);
    let archive: Promise<Buffer | undefined> | undefined = legacyBytes
      ? Promise.resolve(legacyBytes)
      : undefined;
    let cached: CachedPack = {
      treeHash: resolved.treeHash.hash,
      packlist: resolved,
      read: async (path) => {
        if (legacyBytes) {
          return readTreePath(legacyBytes, path);
        }
        // `!/` mounts still descend: the outer member is an object like any
        // other file, and the nested pack is read out of it.
        let segments = path.split(MOUNT_SEPARATOR);
        if (segments.length - 1 > MAX_MOUNT_DEPTH) {
          return undefined;
        }
        let outer =
          segments.length > 1 ? `${segments[0]}.pack.zip` : segments[0];
        let current = await readTreeFile(
          depot.storeDir,
          record.treeHash,
          outer,
        );
        for (let index = 1; index < segments.length; index++) {
          if (current === undefined) {
            return undefined;
          }
          let inner =
            index < segments.length - 1
              ? `${segments[index]}.pack.zip`
              : segments[index];
          current = readZipEntry(current, inner);
        }
        return current;
      },
      bytes: () => {
        archive ??= readStoredPack(depot.storeDir, name, version);
        return archive;
      },
    };
    if (packCache.size >= PACK_CACHE_MAX) {
      let oldest = packCache.keys().next().value;
      if (oldest !== undefined) {
        packCache.delete(oldest);
      }
    }
    packCache.set(key, cached);
    return cached;
  }

  // Walk the sealed graph across decks. Every hop reads through the same
  // store the request would, so a URL that makes it into the list is one
  // the server can actually answer.
  // Scopes are not optional here. A vendored dependency resolves its own
  // bare specifiers through its own record, so walking with `{}` silently
  // stops at the first scoped edge — and because the walk never sees those
  // modules, `total` shrinks with `urls` and the response reports full
  // coverage of a graph it only half-walked. A cap nobody can see reads as
  // "we covered it"; a cap that lies about its own denominator is worse.
  async function closureFor(
    html: Buffer,
    documentUrl: string,
    imports: Record<string, string>,
    scopes: Record<string, Record<string, string>>,
  ): Promise<Closure> {
    let entries = documentEntries({
      html: html.toString('utf8'),
      imports,
      scopes,
      fromUrl: documentUrl,
    });
    // Everything the walk reads is SEALED — the document, its map, and every
    // module it reaches — so the answer cannot change while the key holds.
    // Without this the server reads the whole reachable graph off disk on
    // every request for the same immutable page: 843 files for the vendored
    // corpus, to emit a list it had already computed. The byte budget clips
    // the OUTPUT; only the cache clips the work.
    let key = `${documentUrl} ${JSON.stringify([entries, imports, scopes])}`;
    let hit = closureCache.get(key);
    if (hit) {
      return hit;
    }
    let closure = await moduleClosure({
      entries,
      imports,
      scopes,
      read: async (target) => {
        let mount = byName.get(target.depot);
        if (!mount || !target.version) {
          return undefined;
        }
        return readStoredFile(
          mount.storeDir,
          `${target.publisher}/${target.pkg}`,
          target.version,
          target.path,
        );
      },
    });
    if (closureCache.size >= CLOSURE_CACHE_MAX) {
      closureCache.delete(closureCache.keys().next().value!);
    }
    closureCache.set(key, closure);
    return closure;
  }

  async function packageMapOf(
    pack: CachedPack,
  ): Promise<Record<string, PackageMapEntry> | undefined> {
    let raw = await pack.read(PACKAGE_JSON_PATH);
    if (!raw) {
      return undefined;
    }
    let pkg = parsePackageJson(raw.toString('utf8'));
    if (!pkg) {
      return undefined;
    }
    let entryPath = entryFromPackageJson(pkg);
    let exports = subpathExports(pkg);
    let mapRaw = await pack.read(IMPORT_MAP_PATH);
    let fromMap = mapRaw
      ? parsePackages(mapRaw.toString('utf8'))
      : undefined;
    let mapEntry =
      (pkg.name ? fromMap?.[pkg.name] : undefined) ??
      (pkg.name
        ? fromMap?.[pkg.name.replace(/^@[^/]+\//, '')]
        : undefined) ??
      (fromMap ? Object.values(fromMap)[0] : undefined);
    let entry: PackageMapEntry = {
      version: pkg.version,
      ...(entryPath ? { entry: `$DECK/${entryPath}` } : {}),
      ...(Object.keys(exports).length > 0
        ? {
            exports: Object.fromEntries(
              Object.entries(exports).map(([alias, path]) => [
                `./${alias}`,
                `$DECK/${path}`,
              ]),
            ),
          }
        : {}),
      ...(mapEntry?.vendoredFrom
        ? { vendoredFrom: mapEntry.vendoredFrom }
        : {}),
      ...(mapEntry?.forkedFrom ? { forkedFrom: mapEntry.forkedFrom } : {}),
      ...(mapEntry?.derivedFrom ? { derivedFrom: mapEntry.derivedFrom } : {}),
      ...(mapEntry?.derivation ? { derivation: mapEntry.derivation } : {}),
      ...(mapEntry?.baseApi ? { baseApi: mapEntry.baseApi } : {}),
    };
    let out: Record<string, PackageMapEntry> = {};
    if (pkg.name) {
      out[pkg.name] = entry;
      let unscoped = pkg.name.replace(/^@[^/]+\//, '');
      if (unscoped !== pkg.name) {
        out[unscoped] = entry;
      }
    }
    return out;
  }

  function historyCapability(): Record<string, unknown> {
    let kinds = new Set(
      depots
        .map((depot) => depot.history?.kind)
        .filter(
          (kind): kind is 'historyd' | 'deckd' => kind !== undefined,
        ),
    );
    if (kinds.size === 0) {
      return {
        tier: 1,
        kind: 'content-addressed-packs',
        deckd: false,
        note: 'Versions are pointers in meta.json → a tree in _trees/, whose files live once each in _objects/. No seals between publishes: attach deckd for /<depot>/_history/<changeId>.',
      };
    }
    return {
      tier: 2,
      kind: 'sealed-tree',
      deckd: kinds.has('deckd') || kinds.has('historyd'),
      depots: depots
        .filter((depot) => depot.history)
        .map((depot) => depot.name)
        .sort(),
      note: 'Every save is sealed by deckd. GET /<depot>/_history lists seals; /<depot>/_history/<changeId>/<path> serves any of them, published or not.',
    };
  }

  function respond(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    headers: Record<string, string>,
    body?: Buffer | string,
  ): void {
    let sent: Buffer | string | undefined = body;
    if (body !== undefined) {
      let bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      let negotiated = negotiateBody({
        body: bytes,
        contentType: headers['content-type'],
        acceptEncoding: req.headers['accept-encoding'] as string | undefined,
        alreadyEncoded: headers['content-encoding'] !== undefined,
      });
      if (negotiated.encoding) {
        headers = { ...headers, 'content-encoding': negotiated.encoding };
      }
      if (negotiated.vary) {
        headers = { ...headers, vary: 'Accept-Encoding' };
      }
      // Content-Digest describes the bytes on the wire; Repr-Digest, set by
      // the caller, describes the module. They differ exactly when a coding
      // was applied — and that difference is the point.
      if (headers['repr-digest']) {
        headers = { ...headers, 'content-digest': digestOf(negotiated.body) };
      }
      headers = {
        ...headers,
        'content-length': String(negotiated.body.length),
      };
      sent = negotiated.body;
    }
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || sent === undefined) {
      res.end();
    } else {
      res.end(sent);
    }
  }

  function respondJson(
    req: IncomingMessage,
    res: ServerResponse,
    value: unknown,
    cacheControl: string,
    extra: Record<string, string> = {},
  ): void {
    respond(
      req,
      res,
      200,
      {
        'content-type': 'application/json',
        'cache-control': cacheControl,
        'access-control-allow-origin': '*',
        ...extra,
      },
      JSON.stringify(value, null, 2),
    );
  }

  function respondError(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    code: string,
    detail: string,
    cacheControl: string = SHORT_CACHE,
  ): void {
    respond(
      req,
      res,
      status,
      {
        'content-type': 'application/json',
        'cache-control': cacheControl,
        'access-control-allow-origin': '*',
      },
      JSON.stringify({ errors: [{ code, detail }] }, null, 2),
    );
  }

  function writeSse(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // A depot's own machinery is not part of the depot's content.
  function isHiddenPath(path: string): boolean {
    return path.split('/').some((segment) => segment.startsWith('.'));
  }

  async function entryOfLiveDeck(
    depot: DepotMount,
    publisher: string,
    pkg: string,
  ): Promise<string | undefined> {
    let dir = join(depot.dir, publisher, pkg);
    try {
      let pkgJson = parsePackageJson(
        await readFile(join(dir, PACKAGE_JSON_PATH), 'utf8'),
      );
      return pkgJson ? entryFromPackageJson(pkgJson) : undefined;
    } catch {
      return undefined;
    }
  }

  async function readDepotLock(depot: DepotMount): Promise<{
    imports: Record<string, string>;
    scopes: Record<string, Record<string, string>>;
    integrity: Record<string, string>;
  } | undefined> {
    try {
      let text = await readFile(join(depot.dir, IMPORT_MAP_PATH), 'utf8');
      let lock = parseDepotLock(text);
      if (
        Object.keys(lock.imports).length > 0 ||
        Object.keys(lock.scopes).length > 0
      ) {
        return lock;
      }
    } catch {
      // no depot lock yet
    }
    return undefined;
  }

  // The `imports` a live document should carry: this depot's lock, overlaid
  // with unfrozen edges from every live package.json (workspace:* and
  // dist-tags) **only when the lock has no pin for that specifier**. Those
  // edges skip the freeze — trying a sibling or chasing `latest` does not
  // require `deck lock`. Ranges stay on the lock. A compiled depot lock
  // (section A) makes the expensive store walk the uncommon path.
  //
  // CACHE, NOT AN INDEX. Building unfrozen bindings walks every live
  // package.json and opens store packs to learn npm names — hundreds of
  // milliseconds per HTML document. Without a cache, every Hub navigation
  // pays that again; with six parallel HTML requests the browser starves
  // (same failure ActivityIndex documents). TTL + single-flight; dropped on
  // any live-tree change so a save still shows up on the next paint.
  type LiveImportMap = {
    imports: Record<string, string>;
    scopes: Record<string, Record<string, string>>;
    integrity: Record<string, string>;
  };
  const LIVE_IMPORTS_TTL_MS = 5000;
  let liveImportsCache = new Map<
    string,
    { at: number; lockFp: string; value: LiveImportMap }
  >();
  let liveImportsInFlight = new Map<string, Promise<LiveImportMap>>();

  function invalidateLiveImports() {
    liveImportsCache.clear();
    activity.invalidate();
  }

  liveBus.subscribe(() => {
    invalidateLiveImports();
  });

  async function depotLockFingerprint(depot: DepotMount): Promise<string> {
    try {
      let info = await stat(join(depot.dir, IMPORT_MAP_PATH));
      return `${info.mtimeMs}:${info.size}`;
    } catch {
      return 'none';
    }
  }

  /**
   * Live pins (`/hub/ui/nav/nav.js`) change on every save. Lock-time SRI
   * hashes go stale the moment an agent edits the file — the browser then
   * refuses the module and the Hub sticks on a blank page. Versioned URLs
   * keep the lock's integrity (immutable). Live URLs are rehashed from disk
   * at serve time (or dropped if the file is gone) so development never
   * requires a manual `deck lock` just to keep integrity honest.
   */
  async function refreshLiveIntegrity(
    depot: DepotMount,
    integrity: Record<string, string>,
  ): Promise<Record<string, string>> {
    let prefix = `/${depot.name}/`;
    let out: Record<string, string> = {};
    for (let [url, hash] of Object.entries(integrity)) {
      if (!url.startsWith(prefix)) {
        out[url] = hash;
        continue;
      }
      let rest = url.slice(prefix.length);
      // publisher/package@ver/... is sealed — trust the lock.
      if (/^[^/]+\/[^/]+@/.test(rest)) {
        out[url] = hash;
        continue;
      }
      try {
        let bytes = await readFile(join(depot.dir, rest));
        out[url] =
          `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
      } catch {
        // Omit rather than inject a stale hash that blocks the module.
      }
    }
    return out;
  }

  async function liveImports(
    depot: DepotMount,
    _treePath: string,
  ): Promise<LiveImportMap> {
    let key = depot.name;
    let lockFp = await depotLockFingerprint(depot);
    let hit = liveImportsCache.get(key);
    let now = Date.now();
    if (hit && hit.lockFp === lockFp && now - hit.at < LIVE_IMPORTS_TTL_MS) {
      return {
        imports: hit.value.imports,
        scopes: hit.value.scopes,
        integrity: await refreshLiveIntegrity(depot, hit.value.integrity),
      };
    }
    let pending = liveImportsInFlight.get(key);
    if (pending) {
      return pending.then(async (value) => ({
        imports: value.imports,
        scopes: value.scopes,
        integrity: await refreshLiveIntegrity(depot, value.integrity),
      }));
    }
    let build = (async (): Promise<LiveImportMap> => {
      let lock = (await readDepotLock(depot)) ?? {
        imports: {},
        scopes: {},
        integrity: {},
      };
      let gaps = await unfrozenKeysMissingFromLock({
        depotDir: depot.dir,
        lockImports: lock.imports,
      });
      if (gaps.length === 0) {
        // Lock already compiled every unfrozen edge — Hub's common case.
        let value: LiveImportMap = {
          imports: lock.imports,
          scopes: lock.scopes,
          integrity: lock.integrity,
        };
        liveImportsCache.set(key, {
          at: Date.now(),
          lockFp,
          value,
        });
        return value;
      }
      let unfrozen = await unfrozenBindingsFromDepot({
        depotDir: depot.dir,
        depotName: depot.name,
        storeDir: depot.storeDir,
      });
      let imports = { ...lock.imports };
      for (let [specifier, target] of Object.entries(unfrozen.imports)) {
        if (!(specifier in imports)) {
          imports[specifier] = target;
        }
      }
      let scopes = { ...lock.scopes };
      for (let [prefix, table] of Object.entries(unfrozen.scopes)) {
        scopes[prefix] = { ...(scopes[prefix] ?? {}), ...table };
      }
      let value: LiveImportMap = {
        imports,
        scopes,
        integrity: lock.integrity,
      };
      liveImportsCache.set(key, {
        at: Date.now(),
        lockFp,
        value,
      });
      return value;
    })().finally(() => {
      liveImportsInFlight.delete(key);
    });
    liveImportsInFlight.set(key, build);
    return build.then(async (value) => ({
      imports: value.imports,
      scopes: value.scopes,
      integrity: await refreshLiveIntegrity(depot, value.integrity),
    }));
  }

  // TRY-BY-URL.
  //
  //   ?with=acme/palette@1.4.0-dev.7    same package, another version
  //   ?with=acme/palette=you/palette    replace it with a fork (live)
  //   ?with=acme/palette=you/palette@1.4.0-dev.7
  //
  // Reviewing a proposal should not mean checking anything out. Every
  // proposal is already published at a URL, so trying one is a matter of
  // resolving the app's import map differently for ONE request — the same
  // resolution rules `deck lock` uses, applied at serve time instead of
  // write time. Repeat the parameter to try several at once.
  interface Override {
    // The import specifier to rebind. Undefined when the caller named only a
    // target and the document's own map has to say which specifier that deck
    // currently answers.
    specifier?: string;
    name: string;
    spec: string;
  }

  function parseOverrides(url: URL, depot: DepotMount): Override[] {
    let overrides: Override[] = [];
    for (let raw of url.searchParams.getAll('with')) {
      let [left, right] = raw.split('=');
      let target = right ?? left;
      let [name, spec] = splitAtVersion(target);
      overrides.push({
        // `?with=<left>=<right>` says which specifier explicitly.
        // `?with=<target>` does not — see specifiersFor.
        ...(right
          ? { specifier: stripDepot(splitAtVersion(left)[0], depot.name) }
          : {}),
        name: stripDepot(name, depot.name),
        // No version asked for means the working tree — the point of trying
        // a fork is usually to see every save of it.
        spec: spec ?? 'live',
      });
    }
    return overrides;
  }

  // Which specifier(s) the document currently binds to a deck.
  //
  // `?with=lib/three@0.160.0-min.0` used to rebind the specifier
  // `lib/three`, which the page never imports: since aliased dependencies
  // landed, a deck answers to whatever key its consumer chose — `three`. So
  // the map is read backwards to find the specifier actually in use, and the
  // deck name is only the fallback for a page that imports it by that name.
  function specifiersFor(
    deck: string,
    depot: string,
    current: Record<string, string>,
  ): string[] {
    let prefix = `/${depot}/${deck}`;
    let found = Object.entries(current)
      .filter(
        ([specifier, value]) =>
          !specifier.endsWith('/') &&
          (value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}@`)),
      )
      .map(([specifier]) => specifier);
    return found.length > 0 ? found : [deck];
  }

  // An override has to reach INSIDE the scopes too, or a trial swaps the
  // app's binding and leaves every vendored dependency pointing at the old
  // deck — two copies of the same library in one document, which is the
  // exact failure L7's dedupe corollary is about. A scope entry keyed by a
  // specifier the override rebinds gets the same target.
  function rebindScopes(
    scopes: Record<string, Record<string, string>>,
    overrides: Record<string, string>,
  ): Record<string, Record<string, string>> {
    if (Object.keys(overrides).length === 0) {
      return scopes;
    }
    let rebound: Record<string, Record<string, string>> = {};
    for (let [prefix, table] of Object.entries(scopes)) {
      rebound[prefix] = Object.fromEntries(
        Object.entries(table).map(([specifier, value]) => [
          specifier,
          overrides[specifier] ?? value,
        ]),
      );
    }
    return rebound;
  }

  interface OverrideResolution {
    imports: Record<string, string>;
    // The substitute's OWN scopes. Rebinding cannot produce these: it
    // rewrites values under the original deck's URL prefix, and a document
    // that swaps `app/gallery@1.0.0` for `app/gallery@1.1.0-try.c` has no
    // scope covering the new prefix at all — so the substitute's own bare
    // specifiers go unresolved and the trial renders nothing. Resolving them
    // from what the substitute declares also covers the case where it
    // depends on something the original never did.
    scopes: Record<string, Record<string, string>>;
  }

  async function overrideImports(
    url: URL,
    depot: DepotMount,
    current: Record<string, string> = {},
  ): Promise<OverrideResolution> {
    let overrides = parseOverrides(url, depot);
    if (overrides.length === 0) {
      return { imports: {}, scopes: {} };
    }
    let resolutions = await resolveDependencies({
      depotDir: depot.dir,
      depotName: depot.name,
      storeDir: depot.storeDir,
      dependencies: Object.fromEntries(
        overrides.map((override) => [override.name, override.spec]),
      ),
    });
    let imports: Record<string, string> = {};
    for (let override of overrides) {
      let resolution = resolutions.find(
        (candidate) => candidate.key === override.name,
      );
      if (!resolution) {
        continue;
      }
      // The pins are computed for the TARGET package, then bound to every
      // specifier the document actually imports it under — which is what
      // lets a fork, or a minified projection, stand in for the thing it
      // was derived from without the page changing a line.
      let bindings = override.specifier
        ? [override.specifier]
        : specifiersFor(override.name, depot.name, current);
      for (let binding of bindings) {
        for (let [specifier, value] of Object.entries(resolution.imports)) {
          let suffix = specifier.endsWith('/') ? '/' : '';
          imports[`${binding}${suffix}`] = value;
        }
      }
    }
    let scopes = Object.fromEntries(
      (
        await resolveScopes({
          depotName: depot.name,
          storeDir: depot.storeDir,
          roots: resolutions,
        })
      ).map(({ scope, imports: table }) => [scope, table]),
    );
    // A version the caller NAMED beats one derived from what a substitute
    // declares. `?with=app/gallery@1.0.0&with=ui/card@1.0.0` asks for two
    // exact things; without this, the gallery's own scope re-resolves its
    // `ui/card: ^1.0.0` range against the store and quietly reinstates
    // whatever `latest` points at — so the trial disagrees with itself and
    // renders the version the caller was trying to avoid. A range in a
    // substitute is a question; the query string already answered it.
    return { imports, scopes: rebindScopes(scopes, imports) };
  }

  async function readLiveBytes(
    depot: DepotMount,
    treePath: string,
  ): Promise<{ bytes: Buffer; path: string } | undefined> {
    let candidates = /\.[^/]+$/.test(treePath)
      ? [treePath]
      : [treePath, `${treePath}.js`, `${treePath}.mjs`];
    for (let candidate of candidates) {
      try {
        let bytes = await readFile(join(depot.dir, ...candidate.split('/')));
        return { bytes, path: candidate };
      } catch {
        // keep probing
      }
    }
    return undefined;
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);

    // The read-only gate. This server answers GET and HEAD and nothing else,
    // and that is not a limitation to work around — it is what makes an
    // address a promise. Every change to what a depot holds goes through the
    // CLI or the watcher, INCLUDING claims: `deck claim` writes the record
    // and this server reads it, so presence arrives by the same road as
    // everything else and there is no write endpoint to secure.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respondError(req, res, 405, 'method-not-allowed', `${req.method}`);
      return;
    }

    let search = url.search;

    // `/` is the store browser — unless the embedder mounted something there.
    // A caller that supplies a `fallback` has an app to show at the root, and
    // taking `/` from it made that option silently do nothing: every demo in
    // examples/ printed a root URL that landed on the store browser instead of
    // the app it had just built. `/_browser` is always the browser, so the
    // browser is never lost, only moved out of the way.
    if (BROWSER_PATHS.has(pathname) && !(pathname === '/' && fallback)) {
      respond(
        req,
        res,
        200,
        {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
        BROWSER_HTML,
      );
      return;
    }

    if (DECKBOOK_PATHS.has(pathname)) {
      let html = await loadDeckbookHtml();
      if (!html) {
        respondError(
          req,
          res,
          404,
          'not-found',
          'deckbook.html not found next to the server (run from the deck repo)',
          'no-store',
        );
        return;
      }
      respond(
        req,
        res,
        200,
        {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
        html,
      );
      return;
    }

    if (pathname === LIVE_HMR_PATH) {
      respond(
        req,
        res,
        200,
        {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
        HMR_CLIENT_SOURCE,
      );
      return;
    }

    if (pathname === LIVE_EVENTS_PATH) {
      if (req.method === 'HEAD') {
        respond(req, res, 200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
        });
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      });
      res.write(': deck live\n\n');
      let unsubscribe = liveBus.subscribe((event: LiveChangeEvent) => {
        writeSse(res, 'change', event);
      });
      let heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15000);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }

    // ── /_activity ────────────────────────────────────────────────────
    //
    // Two channels, never blended: `score`/`last` is what actually changed
    // here (observed), `claims` is what an agent SAID it is working on
    // (declared, with a TTL). A claim deliberately does not move the score —
    // otherwise "how much work landed here" becomes something an agent can
    // inflate by announcing itself.
    if (ACTIVITY_PATH.test(pathname)) {
      respondJson(req, res, await activity.report(url.searchParams), 'no-store');
      return;
    }

    if (PACKAGES_INDEX.test(pathname)) {
      let data = [];
      for (let depot of depots) {
        let stored = new Map(
          (await listStorePackages(depot.storeDir)).map((meta) => [
            meta.name,
            meta,
          ]),
        );
        let decks = await discoverDecks(depot.dir);
        let names = new Set([...stored.keys(), ...decks.map((d) => d.name)]);
        let live = new Set(decks.map((deck) => deck.name));
        data.push({
          type: 'depot',
          id: depot.name,
          name: depot.name,
          // Honest at-rest paths — this is the layout, not a metaphor.
          dir: depot.dir,
          storePath: `${depot.name}/.deck/store/`,
          history: depot.history?.kind ?? null,
          historyPath: depot.history ? `/${depot.name}/_history` : undefined,
          packages: [...names].sort().map((name) => {
            let meta = stored.get(name);
            let [publisher, pkg] = name.split('/');
            return {
              type: 'package',
              id: `${depot.name}/${name}`,
              publisher,
              name: pkg,
              live: live.has(name),
              livePath: live.has(name)
                ? `/${depot.name}/${name}/`
                : undefined,
              storePath: `.deck/store/${name}/`,
              versions: Object.fromEntries(
                Object.entries(meta?.versions ?? {}).map(([version, r]) => [
                  version,
                  {
                    treeHash: r.treeHash,
                    ...(r.file ? { file: r.file } : {}),
                    // Two clocks, both optional, never folded into one field:
                    // when this store took the version, and when the registry
                    // published what it took. A client sorting by the wrong
                    // one gets a defensible but different answer, so it has
                    // to choose rather than be chosen for.
                    ...(r.publishedAt ? { publishedAt: r.publishedAt } : {}),
                    ...(r.upstreamPublishedAt
                      ? { upstreamPublishedAt: r.upstreamPublishedAt }
                      : {}),
                  },
                ]),
              ),
              // `<registry>:<name>` when anything here was vendored. Says
              // whether the times above have an upstream to be about.
              upstream: meta?.upstream,
              distTags: meta?.tags ?? {},
            };
          }),
        });
      }
      respondJson(
        req,
        res,
        {
          meta: {
            history: historyCapability(),
            layout:
              '<depot>/<publisher>/<package>/ on disk and in the URL; sealed versions in <depot>/.deck/store/<publisher>/<package>/',
          },
          data,
        },
        'no-store',
      );
      return;
    }

    let packagesMatch = pathname.match(PACKAGES_PATH);
    if (packagesMatch?.groups) {
      let { depot: depotName, publisher, pkg } = packagesMatch.groups;
      let depot = byName.get(depotName);
      if (!depot) {
        respondError(req, res, 404, 'depot-not-found', `no depot ${depotName}`);
        return;
      }
      let name = `${publisher}/${pkg}`;
      let meta = await readStoreMeta(depot.storeDir, name);
      let isLive = await stat(
        join(depot.dir, publisher, pkg, PACKAGE_JSON_PATH),
      )
        .then(() => true)
        .catch(() => false);
      if ((!meta || Object.keys(meta.versions).length === 0) && !isLive) {
        respondError(
          req,
          res,
          404,
          'package-not-found',
          `no published versions for ${depotName}/${name}`,
        );
        return;
      }
      respondJson(
        req,
        res,
        {
          data: {
            type: 'package',
            id: `${depotName}/${name}`,
            attributes: {
              depot: depotName,
              publisher,
              name: pkg,
              live: isLive,
              livePath: isLive ? `/${depotName}/${name}/` : undefined,
              history: depot.history !== undefined,
              historyPath: depot.history
                ? `/${depotName}/_history`
                : undefined,
              storePath: `.deck/store/${name}/`,
              versions: Object.fromEntries(
                Object.entries(meta?.versions ?? {}).map(([version, r]) => [
                  version,
                  {
                    treeHash: r.treeHash,
                    ...(r.file ? { file: r.file } : {}),
                    // Two clocks, both optional, never folded into one field:
                    // when this store took the version, and when the registry
                    // published what it took. A client sorting by the wrong
                    // one gets a defensible but different answer, so it has
                    // to choose rather than be chosen for.
                    ...(r.publishedAt ? { publishedAt: r.publishedAt } : {}),
                    ...(r.upstreamPublishedAt
                      ? { upstreamPublishedAt: r.upstreamPublishedAt }
                      : {}),
                  },
                ]),
              ),
              // `<registry>:<name>` when anything here was vendored. Says
              // whether the times above have an upstream to be about.
              upstream: meta?.upstream,
              distTags: meta?.tags ?? {},
            },
          },
        },
        SHORT_CACHE,
      );
      return;
    }

    let browseMatch = pathname.match(BROWSE_PATH);
    if (browseMatch?.groups) {
      let {
        depot: depotName,
        publisher,
        pkg,
        spec,
        rest: browseRest,
      } = browseMatch.groups;
      let depot = byName.get(depotName);
      if (!depot) {
        respondError(req, res, 404, 'depot-not-found', `no depot ${depotName}`);
        return;
      }
      let rest = browseRest?.replace(/^\/+/, '') ?? '';
      try {
        if (!publisher || !pkg) {
          // A depot or publisher listing: the decks that live there.
          let decks = await discoverDecks(depot.dir);
          let scoped = publisher
            ? decks.filter((deck) => deck.publisher === publisher)
            : decks;
          respondJson(
            req,
            res,
            {
              data: {
                type: 'directory',
                attributes: {
                  package: publisher ? `${depotName}/${publisher}` : depotName,
                  version: 'live',
                  path: '',
                  kind: 'live',
                  entries: scoped.map((deck) => ({
                    name: publisher ? deck.package : deck.publisher,
                    type: 'dir',
                    path: publisher ? deck.name : deck.publisher,
                  })),
                },
              },
            },
            'no-store',
          );
          return;
        }
        let name = `${publisher}/${pkg}`;
        if (!spec) {
          let dir = join(depot.dir, publisher, pkg);
          if (rest) {
            let file = await readLiveFile(dir, rest);
            if (file) {
              let binary = !looksLikeText(rest, file.bytes);
              respondJson(
                req,
                res,
                {
                  data: {
                    type: 'file',
                    attributes: {
                      package: `${depotName}/${name}`,
                      version: 'live',
                      path: rest,
                      kind: 'live',
                      size: file.size,
                      contentType: contentTypeFor(rest),
                      text: binary ? undefined : bytesToPreview(file.bytes),
                      binary,
                      rawUrl: `/${depotName}/${name}/${rest}`,
                    },
                  },
                },
                'no-store',
              );
              return;
            }
          }
          let listing = await listingFromLiveDir(
            `${depotName}/${name}`,
            dir,
            rest,
          );
          respondJson(
            req,
            res,
            { data: { type: 'directory', attributes: listing } },
            'no-store',
          );
          return;
        }

        let meta = await readStoreMeta(depot.storeDir, name);
        if (!meta || Object.keys(meta.versions).length === 0) {
          respondError(
            req,
            res,
            404,
            'package-not-found',
            `no published versions for ${depotName}/${name}`,
          );
          return;
        }
        let resolution = resolveVersionSpec(spec, meta);
        if (resolution.kind === 'invalid') {
          respondError(
            req,
            res,
            404,
            'invalid-version-spec',
            `${name}@${spec}: ${resolution.detail}`,
            IMMUTABLE_CACHE,
          );
          return;
        }
        if (resolution.kind === 'not-found') {
          respondError(
            req,
            res,
            404,
            'version-not-found',
            `${name}@${spec}: ${resolution.detail}`,
          );
          return;
        }
        // Tags/ranges resolve in-place for the browser (no redirect hop).
        let version = resolution.version;
        let pack = await loadPack(depot, name, version);
        if (!pack) {
          respondError(
            req,
            res,
            404,
            'version-not-found',
            `pack missing for ${name}@${version}`,
          );
          return;
        }
        let packlist = pack.packlist;
        if (rest) {
          let fileMeta = findPackFile(packlist, rest);
          if (fileMeta) {
            let bytes = await pack.read(rest);
            if (!bytes) {
              respondError(
                req,
                res,
                404,
                'file-not-found',
                `${rest} not in ${name}@${version}`,
              );
              return;
            }
            let binary = !looksLikeText(rest, bytes);
            respondJson(
              req,
              res,
              {
                data: {
                  type: 'file',
                  attributes: {
                    package: `${depotName}/${name}`,
                    version,
                    treeHash: pack.treeHash,
                    path: rest,
                    kind: 'sealed',
                    size: fileMeta.size,
                    sha256: fileMeta.sha256,
                    contentType: contentTypeFor(rest),
                    text: binary ? undefined : bytesToPreview(bytes),
                    binary,
                    rawUrl: `/${depotName}/${name}@${version}/${rest}`,
                  },
                },
              },
              SHORT_CACHE,
            );
            return;
          }
        }
        let listing = listingFromPacklist(
          `${depotName}/${name}`,
          version,
          packlist,
          rest,
        );
        respondJson(
          req,
          res,
          { data: { type: 'directory', attributes: listing } },
          SHORT_CACHE,
        );
        return;
      } catch (error) {
        respondError(
          req,
          res,
          400,
          'browse-error',
          String((error as Error)?.message ?? error),
          'no-store',
        );
        return;
      }
    }

    let signaturesMatch = pathname.match(SIGNATURES_PATH);
    if (signaturesMatch?.groups) {
      let depot = byName.get(signaturesMatch.groups.depot);
      if (!depot) {
        respondError(
          req,
          res,
          404,
          'depot-not-found',
          `no depot ${signaturesMatch.groups.depot}`,
        );
        return;
      }
      let treeHash = signaturesMatch.groups.treeHash;
      let envelope = await readEnvelope(depot.storeDir, treeHash);
      if (!envelope) {
        respondError(
          req,
          res,
          404,
          'no-signatures',
          `no endorsements recorded for ${treeHash}`,
          IMMUTABLE_CACHE,
        );
        return;
      }
      // The envelope is about an immutable tree, so it is cacheable — but
      // only briefly: a new co-signature is an addition to the same subject.
      respondJson(req, res, envelope as unknown as Record<string, unknown>, SHORT_CACHE);
      return;
    }

    let offersMatch = pathname.match(OFFERS_PATH);
    if (offersMatch?.groups) {
      let depot = byName.get(offersMatch.groups.depot);
      if (!depot) {
        respondError(
          req,
          res,
          404,
          'depot-not-found',
          `no depot ${offersMatch.groups.depot}`,
        );
        return;
      }
      // Read-only: the daemon writes, this only reports. A maintainer wants
      // the three that stopped merging, not the hundred that are fine.
      let { outcomes, rebased, conflicted } = await surveyOffers({ depot });
      respondJson(
        req,
        res,
        {
          meta: { depot: depot.name, open: outcomes.length, conflicted },
          data: outcomes.map((outcome) => ({
            type: 'offer',
            id: outcome.offer,
            attributes: {
              ...outcome,
              applied: undefined,
              rebased,
              // One URL a reviewer can open: the app, with this proposal
              // standing in for what it forked.
              tryWith: `?with=${outcome.upstream}=${outcome.offer}`,
            },
          })),
        },
        'no-store',
      );
      return;
    }

    let historyMatch = pathname.match(HISTORY_PATH);
    if (historyMatch?.groups) {
      let depot = byName.get(historyMatch.groups.depot);
      if (!depot) {
        respondError(
          req,
          res,
          404,
          'depot-not-found',
          `no depot ${historyMatch.groups.depot}`,
        );
        return;
      }
      let backend = depot.history;
      if (!backend) {
        respondError(
          req,
          res,
          404,
          'no-history',
          `depot ${depot.name} has no Timeline — no history backend is attached, so its Versions are its history`,
        );
        return;
      }
      let revision = historyMatch.groups.rev;
      if (revision === undefined) {
        // The seal log: every state this depot has been in, newest first.
        // It grows with every save, so nothing caches it.
        // `?limit=` keeps /track's first paint off multi-megabyte jj logs.
        let rawLimit = Number(url.searchParams.get('limit'));
        let limit =
          Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(Math.floor(rawLimit), 500)
            : undefined;
        let seals = await backend.list(depot.dir, limit ? { limit } : undefined);
        // Limited lists are for /track first paint. Fat demos ship megabytes
        // of filesSummary per seal (vendor trees); the feed only needs a
        // short subject line, so cap the summary when paginating.
        const SUMMARY_CAP = 32;
        respondJson(
          req,
          res,
          {
            meta: {
              backend: backend.kind,
              tier: 2,
              depot: depot.name,
              ...(limit
                ? {
                    limit,
                    // Client may ask again with a higher limit; truncated
                    // means "there may be more", not an exact remaining count.
                    truncated: seals.length >= limit,
                    filesSummaryCap: SUMMARY_CAP,
                  }
                : {}),
            },
            data: seals.map((seal) => ({
              type: 'seal',
              id: seal.changeId,
              attributes: {
                ...seal,
                filesSummary: limit
                  ? (seal.filesSummary ?? []).slice(0, SUMMARY_CAP)
                  : seal.filesSummary,
                filesUrl: `/${depot.name}/_history/${seal.changeId}`,
              },
            })),
          },
          'no-store',
        );
        return;
      }
      if (!isValidRevisionId(revision)) {
        // Grammar-invalid: no future seal can ever carry this id.
        respondError(
          req,
          res,
          404,
          'invalid-revision',
          `"${revision}" is not a revision id`,
          IMMUTABLE_CACHE,
        );
        return;
      }
      let rest = historyMatch.groups.rest?.slice(1);
      if (rest === undefined || rest === '') {
        // What was in the depot at this seal. `fileListAt` is optional on
        // the backend — an absent enumeration is reported as such, never as
        // an empty tree.
        let files = await backend.fileListAt?.(depot.dir, revision);
        if (files === undefined && backend.fileListAt) {
          respondError(
            req,
            res,
            404,
            'revision-not-found',
            `${revision} is not a seal of ${depot.name}`,
          );
          return;
        }
        respondJson(
          req,
          res,
          {
            data: {
              type: 'seal',
              id: revision,
              attributes: {
                depot: depot.name,
                changeId: revision,
                files: files ?? null,
                filesAvailable: files !== undefined,
                backend: backend.kind,
              },
            },
          },
          // A seal is immutable, and so is its file list.
          IMMUTABLE_CACHE,
        );
        return;
      }
      if (!isValidHistoryPath(rest) || isHiddenPath(rest)) {
        respondError(
          req,
          res,
          404,
          'file-not-found',
          'invalid path',
          IMMUTABLE_CACHE,
        );
        return;
      }
      // Live trees redirect a deck directory to its index.html. History must
      // do the same: `/_history/<id>/app/form` without that hop is served as
      // application/octet-stream (no extension), and the browser downloads a
      // file named `form` instead of framing the page.
      let leaf = rest.split('/').pop() ?? '';
      if (!leaf.includes('.')) {
        let index = `${rest}/index.html`;
        if (isValidHistoryPath(index)) {
          let indexBytes = await backend.fileAt(depot.dir, revision, index);
          if (indexBytes !== undefined) {
            respond(req, res, 302, {
              location: `/${depot.name}/_history/${revision}/${index}${search}`,
              'cache-control': IMMUTABLE_CACHE,
              'access-control-allow-origin': '*',
            });
            return;
          }
        }
      }
      let bytes = await backend.fileAt(depot.dir, revision, rest);
      if (bytes === undefined) {
        respondError(
          req,
          res,
          404,
          'file-not-found',
          `${rest} is not in seal ${revision} of ${depot.name}`,
        );
        return;
      }
      // A STEP HAS TO BE RUNNABLE, OR IT IS ONLY READABLE.
      //
      // Resolution for a historical page:
      //   1. That Step's depot lock (exact pins from that moment), if any
      //   2. Unfrozen edges from that Step's package.json files
      //      (workspace:* / dist-tags) — even when there is no lock
      //   3. Live (versionless) targets rewritten into
      //      `/_history/<rev>/…` so siblings bind THIS Step, not today
      //
      // Taking today's live pins would silently show a hybrid that never
      // existed. Per-pack maps are lineage, not the lock.
      let injected = false;
      if (rest.endsWith('.html')) {
        let imports: Record<string, string> = {};
        let scopes: Record<string, Record<string, string>> = {};
        let integrity: Record<string, string> = {};
        let mapBytes = await backend.fileAt(
          depot.dir,
          revision,
          IMPORT_MAP_PATH,
        );
        if (mapBytes) {
          try {
            let lock = parseDepotLock(mapBytes.toString('utf8'));
            imports = { ...lock.imports };
            scopes = { ...lock.scopes };
            integrity = { ...lock.integrity };
          } catch {
            // A step whose import map does not parse is a step that was
            // saved mid-edit. Fall through to unfrozen edges only.
          }
        }
        let readAtStep = async (path: string) =>
          backend.fileAt(depot.dir, revision, path);
        let decks: Array<{
          publisher: string;
          package: string;
          name: string;
        }> = [];
        if (backend.fileListAt) {
          let files = await backend.fileListAt(depot.dir, revision);
          if (files) {
            decks = decksFromTreePaths(files);
          }
        }
        if (decks.length === 0) {
          // Backends without file-list-at: probe every live deck path at
          // this Step. Decks that only existed then are missed — prefer
          // fileListAt when available.
          for (let deck of await discoverDecks(depot.dir)) {
            if (await readAtStep(`${deck.name}/${PACKAGE_JSON_PATH}`)) {
              decks.push({
                publisher: deck.publisher,
                package: deck.package,
                name: deck.name,
              });
            }
          }
        }
        if (decks.length > 0) {
          let unfrozen = await unfrozenBindingsFromTree({
            depotName: depot.name,
            storeDir: depot.storeDir,
            depotDir: depot.dir,
            decks,
            readTreeFile: readAtStep,
          });
          imports = { ...imports, ...unfrozen.imports };
          for (let [prefix, table] of Object.entries(unfrozen.scopes)) {
            scopes[prefix] = { ...(scopes[prefix] ?? {}), ...table };
          }
        }
        if (
          Object.keys(imports).length > 0 ||
          Object.keys(scopes).length > 0
        ) {
          let atStep = rewriteImportMapIntoStep(
            depot.name,
            revision,
            imports,
            scopes,
            integrity,
          );
          ({ bytes, injected } = injectImportMap(
            bytes,
            atStep.imports,
            atStep.scopes,
            atStep.integrity,
          ));
        }
      }
      // A sealed state never changes — the same caching promise an exact
      // version gets, for a state that was never published at all.
      respond(
        req,
        res,
        200,
        {
          'content-type': contentTypeFor(rest),
          'cache-control': IMMUTABLE_CACHE,
          'repr-digest': reprDigest(bytes),
          'x-deck-seal': revision,
          'x-deck-depot': depot.name,
          ...(injected ? { 'x-deck-importmap': 'injected' } : {}),
          'access-control-allow-origin': '*',
        },
        bytes,
      );
      return;
    }

    let sealedMatch = pathname.match(SEALED_PATH);
    if (sealedMatch?.groups) {
      await serveSealed(req, res, url, search, sealedMatch.groups);
      return;
    }

    let liveMatch = pathname.match(LIVE_PATH);
    if (liveMatch?.groups) {
      let depot = byName.get(liveMatch.groups.depot);
      if (depot) {
        await serveLive(req, res, depot, liveMatch.groups.rest, search, url);
        return;
      }
    }

    if (fallback) {
      fallback(req, res);
      return;
    }
    respondError(req, res, 404, 'not-found', `no route for ${pathname}`);
  }

  // `/<depot>/<path>` — the working tree, exactly as it sits on disk.
  async function serveLive(
    req: IncomingMessage,
    res: ServerResponse,
    depot: DepotMount,
    rawRest: string | undefined,
    search: string,
    url: URL,
  ): Promise<void> {
    let rest = rawRest?.replace(/^\/+/, '').replace(/\/+$/, '') ?? '';
    if (rest !== '' && (!isValidTreePath(rest) || isHiddenPath(rest))) {
      respondError(req, res, 404, 'file-not-found', 'invalid path', 'no-store');
      return;
    }

    // LIVE ?meta — same shape as a sealed package-meta, built by walking the
    // working tree. Without this, "compare this -dev.N to live" could only
    // shrug: the digests exist (tree-hash-v1), the UI just had no way to ask
    // for them. no-store: the answer moves with every save.
    if (url.searchParams.has('meta')) {
      let segments = rest === '' ? [] : rest.split('/');
      if (segments.length !== 2) {
        respondError(
          req,
          res,
          404,
          'no-manifest',
          'live ?meta is for a package root (publisher/package)',
          'no-store',
        );
        return;
      }
      let [publisher, pkg] = segments;
      let name = `${publisher}/${pkg}`;
      let dir = join(depot.dir, publisher, pkg);
      let info = await stat(dir).catch(() => undefined);
      if (!info?.isDirectory()) {
        respondError(
          req,
          res,
          404,
          'package-not-found',
          `no live tree for ${depot.name}/${name}`,
          'no-store',
        );
        return;
      }
      let hashed = await treeHashFromDir(dir);
      respondJson(
        req,
        res,
        {
          data: {
            type: 'package-meta',
            id: `${depot.name}/${name}@live`,
            attributes: {
              depot: depot.name,
              publisher,
              name: pkg,
              version: 'live',
              treeHash: hashed.treeHash,
              entry: null,
              exports: {},
              baseApi: null,
              sealChangeId: null,
              signatures: [],
              files: hashed.entries.map((entry) => entry.path),
              tree: hashed.entries.map((entry) => ({
                path: entry.path,
                sha256: entry.sha256,
              })),
            },
          },
        },
        'no-store',
        { 'x-deck-tree-hash': hashed.treeHash },
      );
      return;
    }
    let found = rest === '' ? undefined : await readLiveBytes(depot, rest);
    if (!found) {
      // A directory: an index.html if there is one, otherwise the deck's
      // declared entry module. Both are answers that change with the tree,
      // so the redirect never caches.
      let segments = rest === '' ? [] : rest.split('/');
      let index = rest === '' ? 'index.html' : `${rest}/index.html`;
      let candidate = await readLiveBytes(depot, index);
      if (candidate) {
        respond(req, res, 302, {
          location: `/${depot.name}/${index}${search}`,
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        });
        return;
      }
      if (segments.length === 2) {
        let entry = await entryOfLiveDeck(depot, segments[0], segments[1]);
        if (entry) {
          respond(req, res, 302, {
            location: `/${depot.name}/${rest}/${entry}${search}`,
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          });
          return;
        }
      }
      respondError(
        req,
        res,
        404,
        'file-not-found',
        `${rest || '/'} does not exist in depot ${depot.name}`,
        'no-store',
      );
      return;
    }
    let bytes = found.bytes;
    let injected = false;
    let trying: string[] = [];
    if (found.path.endsWith('.html')) {
      let live = await liveImports(depot, found.path);
      let override = await overrideImports(url, depot, live.imports);
      trying = Object.keys(override.imports).sort();
      ({ bytes, injected } = injectImportMap(
        bytes,
        { ...live.imports, ...override.imports },
        { ...rebindScopes(live.scopes, override.imports), ...override.scopes },
        live.integrity,
      ));
    }
    // The whole point: every save is visible on the next request.
    respond(
      req,
      res,
      200,
      {
        'content-type': contentTypeFor(found.path),
        'cache-control': 'no-store',
        'repr-digest': reprDigest(bytes),
        'x-deck-depot': depot.name,
        ...(injected ? { 'x-deck-importmap': 'injected' } : {}),
        ...(trying.length > 0 ? { 'x-deck-with': trying.join(', ') } : {}),
        'access-control-allow-origin': '*',
      },
      bytes,
    );
  }

  // `/<depot>/<publisher>/<package>@<spec>/<path>` — the sealed read.
  async function serveSealed(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    search: string,
    groups: Record<string, string | undefined>,
  ): Promise<void> {
    let depot = byName.get(groups.depot!);
    if (!depot) {
      respondError(req, res, 404, 'depot-not-found', `no depot ${groups.depot}`);
      return;
    }
    let name = `${groups.publisher}/${groups.pkg}`;
    let spec = groups.spec!;
    let rest = groups.rest?.slice(1);

    let meta = await readStoreMeta(depot.storeDir, name);
    if (!meta || Object.keys(meta.versions).length === 0) {
      respondError(
        req,
        res,
        404,
        'package-not-found',
        `no published versions for ${depot.name}/${name}`,
      );
      return;
    }
    let resolution = resolveVersionSpec(spec, meta);
    if (resolution.kind === 'invalid') {
      // Grammar-invalid: the refusal can never change — caches like content.
      respondError(
        req,
        res,
        404,
        'invalid-version-spec',
        `${name}@${spec}: ${resolution.detail}`,
        IMMUTABLE_CACHE,
      );
      return;
    }
    if (resolution.kind === 'not-found') {
      respondError(
        req,
        res,
        404,
        'version-not-found',
        `${name}@${spec}: ${resolution.detail}`,
      );
      return;
    }
    let version = resolution.version;
    let pack = await loadPack(depot, name, version);
    if (!pack) {
      respondError(
        req,
        res,
        404,
        'version-not-found',
        `${name}@${version} has no stored pack`,
      );
      return;
    }

    let wantsMeta = rest === undefined && url.searchParams.has('meta');
    let wantsPack = rest === undefined && url.searchParams.has('format');
    if (wantsPack && url.searchParams.get('format') !== 'pack') {
      respondError(
        req,
        res,
        400,
        'invalid-query',
        `unsupported format: ${url.searchParams.get('format')}`,
        IMMUTABLE_CACHE,
      );
      return;
    }

    let map = await packageMapOf(pack);
    let mapEntry =
      map?.[groups.pkg!] ?? (map ? Object.values(map)[0] : undefined);
    let canonicalRest: string | undefined;
    if (wantsMeta || wantsPack) {
      canonicalRest = undefined;
    } else if (rest === undefined) {
      canonicalRest = mapEntry?.entry
        ? treePathFromMapValue(mapEntry.entry)
        : undefined;
      if (!canonicalRest) {
        respondError(
          req,
          res,
          404,
          'no-entry-module',
          `${name}@${version} declares no entry module in package.json`,
        );
        return;
      }
    } else {
      let aliasTarget = mapEntry?.exports?.[`./${rest}`];
      let aliasPath = aliasTarget
        ? treePathFromMapValue(aliasTarget)
        : undefined;
      canonicalRest = aliasPath && aliasPath !== rest ? aliasPath : rest;
    }

    let canonicalLocation = `/${depot.name}/${name}@${version}${
      canonicalRest !== undefined ? `/${canonicalRest}` : ''
    }${search}`;

    if (resolution.kind === 'redirect') {
      // One hop, short TTL: version AND form canonicalize together.
      respond(req, res, 302, {
        location: canonicalLocation,
        'cache-control': SHORT_CACHE,
        'x-deck-resolved': `${name}@${version}`,
        'access-control-allow-origin': '*',
      });
      return;
    }

    if (wantsPack) {
      // Rebuilt from the objects, and byte-identical to what was sealed:
      // the packlist fixes the order and every hash, and canonical-zip-v1
      // is deterministic.
      let archive = await pack.bytes();
      if (!archive) {
        respondError(
          req,
          res,
          404,
          'version-not-found',
          `${name}@${version} has no stored content`,
        );
        return;
      }
      respond(
        req,
        res,
        200,
        {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${groups.pkg}-${version}.pack.zip"`,
          'cache-control': IMMUTABLE_CACHE,
          'repr-digest': reprDigest(archive),
          'x-deck-tree-hash': pack.treeHash,
          'access-control-allow-origin': '*',
        },
        archive,
      );
      return;
    }

    if (wantsMeta) {
      let packlist = pack.packlist;
      let exports: Record<string, string> = {};
      for (let [alias, value] of Object.entries(mapEntry?.exports ?? {})) {
        let treePath = treePathFromMapValue(value);
        if (treePath) {
          exports[alias] = treePath;
        }
      }
      respondJson(
        req,
        res,
        {
          data: {
            type: 'package-meta',
            id: `${depot.name}/${name}@${version}`,
            attributes: {
              depot: depot.name,
              publisher: groups.publisher,
              name: groups.pkg,
              version,
              treeHash: pack.treeHash,
              entry: mapEntry?.entry
                ? (treePathFromMapValue(mapEntry.entry) ?? null)
                : null,
              exports,
              baseApi: mapEntry?.baseApi ?? null,
              // Which seal this version was cut from, when the pack was
              // sealed by a watcher with a Timeline — the link from a published
              // version back into `/<depot>/_history/<changeId>`.
              sealChangeId: packlist.provenance?.sealChangeId ?? null,
              // L9/L10: who endorsed these BYTES. Public keys are not
              // included; the full envelope is one fetch away at
              // /<depot>/_trees/<treeHash>/signatures.
              signatures: summarizeEnvelope(
                pack.treeHash,
                await readEnvelope(depot.storeDir, pack.treeHash),
              ),
              files: packlist.entries.map((entry) => entry.path),
              // The same entries with their digests, which is what a
              // COMPARISON needs and a path list cannot give. Two versions'
              // path lists answer "added" and "removed"; only the digests
              // answer "changed", and answering it any other way means
              // walking the tree one directory per request or fetching two
              // whole packs to look at their manifests.
              //
              // It is the packlist verbatim, so it costs nothing to produce
              // and inherits the pack's own guarantee: identical sha256
              // means identical bytes, which is how a fork that touched one
              // file out of 375 can be shown to have touched one file out
              // of 375 rather than asserted to have.
              tree: packlist.entries.map((entry) => ({
                path: entry.path,
                size: entry.size,
                sha256: entry.sha256,
              })),
            },
          },
        },
        SHORT_CACHE,
        { 'x-deck-tree-hash': pack.treeHash },
      );
      return;
    }

    if (canonicalRest !== rest) {
      // Version already exact; only the FORM changes — permanent.
      respond(req, res, 301, {
        location: canonicalLocation,
        'cache-control': IMMUTABLE_CACHE,
        'x-deck-package': `${name}@${version}`,
        'access-control-allow-origin': '*',
      });
      return;
    }

    let bytes = await pack.read(rest!);
    if (bytes === undefined && !/\.[^/]+$/.test(rest!)) {
      // Extensionless specifiers probe .js then .mjs (vanilla serving).
      for (let candidate of [`${rest}.js`, `${rest}.mjs`]) {
        bytes = await pack.read(candidate);
        if (bytes !== undefined) {
          rest = candidate;
          break;
        }
      }
    }
    if (bytes === undefined) {
      respondError(
        req,
        res,
        404,
        'file-not-found',
        `${groups.rest?.slice(1)} does not exist in ${name}@${version}`,
      );
      return;
    }
    let injected = false;
    let trying: string[] = [];
    let preload: Closure | undefined;
    if (rest!.endsWith('.html')) {
      let depotLock = await readDepotLock(depot);
      // Sealed pages carry their own graph in the pack's importmap.json
      // (remix `extends`, preview's `app/gallery`, …). The depot lock is the
      // depot-wide authority and overlays that graph — it must not erase it
      // when empty, which left external `<script type=importmap src>` tags
      // inert and every sealed demo blank.
      let imports: Record<string, string> = {};
      let scopes: Record<string, Record<string, string>> = {};
      let integrity: Record<string, string> = {};
      let packMapBytes = await pack.read(IMPORT_MAP_PATH);
      if (packMapBytes) {
        try {
          let start = parseLink(packMapBytes.toString('utf8'));
          let flat = await resolveInheritance({
            start,
            load: async (parent) => {
              let match = /^([^@/\s]+\/[^@/\s]+)@([^@/\s]+)$/.exec(parent);
              if (!match) return undefined;
              let parentBytes = await readStoredPack(
                depot.storeDir,
                match[1],
                match[2],
              );
              if (!parentBytes) return undefined;
              let raw = readZipEntry(parentBytes, IMPORT_MAP_PATH);
              return raw ? parseLink(raw.toString('utf8')) : undefined;
            },
          });
          imports = flat.imports;
          scopes = flat.scopes;
        } catch {
          // Malformed extends fails closed at lock time; at serve time keep
          // the depot lock so a broken pack does not take the page down.
        }
      }
      if (depotLock) {
        imports = { ...imports, ...depotLock.imports };
        for (let [prefix, table] of Object.entries(depotLock.scopes)) {
          scopes[prefix] = { ...(scopes[prefix] ?? {}), ...table };
        }
        integrity = depotLock.integrity;
      }
      let override = await overrideImports(url, depot, imports);
      trying = Object.keys(override.imports).sort();
      let resolved = { ...imports, ...override.imports };
      let resolvedScopes = {
        ...rebindScopes(scopes, override.imports),
        ...override.scopes,
      };
      ({ bytes, injected } = injectImportMap(
        bytes,
        resolved,
        resolvedScopes,
        integrity,
      ));
      // The closure is advertised only for a SEALED document. A trial has
      // substituted dependencies, so its graph is not the one the seal
      // describes, and preloading the sealed closure would fetch bytes the
      // page will not use.
      if (trying.length === 0) {
        preload = await closureFor(
          bytes,
          // `rest` is a TREE path — the leading slash was stripped when it was
          // parsed out of the URL. Pasting it straight on produced
          // `…@1.0.0index.html`, which is not a deck URL: relative resolution
          // walked out of the package and no scope prefix matched, so the
          // closure came back empty and the response advertised nothing while
          // looking perfectly healthy.
          `/${depot.name}/${name}@${version}/${rest}`,
          resolved,
          resolvedScopes,
        );
        if (preload.urls.length > 0) {
          bytes = injectModulePreload(bytes, preload.urls).bytes;
        }
      }
    }
    respond(
      req,
      res,
      200,
      {
        'content-type': contentTypeFor(rest!),
        // A trial is NOT the sealed representation, so it never inherits the
        // sealed response's immutability.
        'cache-control': trying.length > 0 ? 'no-store' : IMMUTABLE_CACHE,
        'repr-digest': reprDigest(bytes),
        ...(preload && preload.total > 0
          ? {
              // Say what was clipped. A cap nobody can see reads as
              // "we covered it".
              'x-deck-preload': `${preload.urls.length}/${preload.total}`,
            }
          : {}),
        ...(injected ? { 'x-deck-importmap': 'injected' } : {}),
        ...(trying.length > 0 ? { 'x-deck-with': trying.join(', ') } : {}),
        'x-deck-package': `${name}@${version}`,
        'x-deck-depot': depot.name,
        'x-deck-tree-hash': pack.treeHash,
        'access-control-allow-origin': '*',
      },
      bytes,
    );
  }

  let onRequest = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      respondError(
        req,
        res,
        500,
        'internal-error',
        String((error as Error)?.message ?? error),
        'no-store',
      );
    });
  };

  let tls = resolveTlsMaterials(options.tls);
  let server = (
    tls
      ? createHttp2SecureServer(
          {
            cert: tls.cert,
            key: tls.key,
            // Browsers that cannot negotiate h2 still load the page.
            allowHTTP1: true,
          },
          // Compat listener: Http2ServerRequest/Response satisfy the
          // IncomingMessage/ServerResponse methods we actually call.
          onRequest as unknown as (
            req: Http2ServerRequest,
            res: Http2ServerResponse,
          ) => void,
        )
      : createServer(onRequest)
  ) as DeckServer;
  server.liveBus = liveBus;
  server.protocol = tls ? 'https' : 'http';
  server.warmActivity = () => activity.warm();
  return server;
}
