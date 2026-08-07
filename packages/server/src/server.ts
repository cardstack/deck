import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readZipEntry } from '@deck/core/canonical-zip';
import {
  packagesFromPack,
  parsePackages,
  treePathFromMapValue,
  IMPORT_MAP_PATH,
  MOUNT_SEPARATOR,
} from '@deck/core/import-map';
import { peekPacklist } from '@deck/core/pack';
import {
  readStoredPack,
  readStoreMeta,
  resolveVersionSpec,
} from '@deck/core/store';
import { isValidTreePath } from '@deck/core/tree-hash';

// The minimal Deck server: READ-ONLY versioned serving over an at-rest
// store directory. All state changes happen through the CLI (an agent
// arranges state; distribution follows mechanically) — there is no write
// endpoint here at all.
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

const SERVE_PATH =
  /^\/@(?<name>[a-z0-9][a-z0-9-]{0,63})@(?<spec>[^/]+)(?<rest>\/.*)?$/;
const PACKAGES_PATH = /^\/_packages\/(?<name>[a-z0-9][a-z0-9-]{0,63})$/;
const LIVE_PATH = /^\/live\/(?<name>[a-z0-9][a-z0-9-]{0,63})(?<rest>\/.*)?$/;

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

function contentDigest(bytes: Buffer): string {
  return `sha-256=:${createHash('sha256').update(bytes).digest('base64')}:`;
}

export interface DeckServerOptions {
  storeDir: string;
  // Live directories: `/live/<name>/<path>` serves these straight from
  // disk with no-store caching — the vibe-coding surface. Names use the
  // package-name grammar; paths are tree-path validated (never joined
  // into the filesystem unchecked).
  live?: Record<string, string>;
  // Optional fallthrough for anything that is not a Deck route (demo
  // pages, health checks). Without it, non-routes 404.
  fallback?: (req: IncomingMessage, res: ServerResponse) => void;
}

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
  bytes: Buffer;
  treeHash: string;
}

export function createDeckServer(options: DeckServerOptions): Server {
  let { storeDir, live = {}, fallback } = options;
  // Stored packs are immutable (published versions never change), so this
  // cache never invalidates; the cap only bounds memory.
  let packCache = new Map<string, CachedPack>();
  const PACK_CACHE_MAX = 50;

  async function loadPack(
    name: string,
    version: string,
  ): Promise<CachedPack | undefined> {
    let key = `${name}@${version}`;
    let hit = packCache.get(key);
    if (hit) {
      return hit;
    }
    let bytes = await readStoredPack(storeDir, name, version);
    if (!bytes) {
      return undefined;
    }
    let packlist = peekPacklist(bytes);
    let cached = { bytes, treeHash: packlist.treeHash.hash };
    if (packCache.size >= PACK_CACHE_MAX) {
      let oldest = packCache.keys().next().value;
      if (oldest !== undefined) {
        packCache.delete(oldest);
      }
    }
    packCache.set(key, cached);
    return cached;
  }

  function respond(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    headers: Record<string, string>,
    body?: Buffer | string,
  ): void {
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || body === undefined) {
      res.end();
    } else {
      res.end(body);
    }
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

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respondError(req, res, 405, 'method-not-allowed', `${req.method}`);
      return;
    }
    let url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    let search = url.search;

    let liveMatch = pathname.match(LIVE_PATH);
    if (liveMatch?.groups) {
      let dir = live[liveMatch.groups.name];
      if (!dir) {
        respondError(
          req,
          res,
          404,
          'package-not-found',
          `no live directory for ${liveMatch.groups.name}`,
        );
        return;
      }
      let rest = liveMatch.groups.rest?.slice(1);
      if (rest === undefined || rest === '') {
        // Bare live form → temporary redirect to the entry module; the
        // answer changes with every edit of the map, so nothing caches.
        let entry: string | undefined;
        try {
          let map = parsePackages(
            await readFile(join(dir, IMPORT_MAP_PATH), 'utf8'),
          );
          let value = map?.[liveMatch.groups.name]?.entry;
          entry = value ? treePathFromMapValue(value) : undefined;
        } catch {
          entry = undefined;
        }
        if (!entry) {
          respondError(
            req,
            res,
            404,
            'no-entry-module',
            `live ${liveMatch.groups.name} declares no entry module in ${IMPORT_MAP_PATH}`,
            'no-store',
          );
          return;
        }
        respond(req, res, 302, {
          location: `/live/${liveMatch.groups.name}/${entry}${search}`,
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        });
        return;
      }
      if (!isValidTreePath(rest)) {
        respondError(
          req,
          res,
          404,
          'file-not-found',
          `invalid path`,
          'no-store',
        );
        return;
      }
      let bytes: Buffer | undefined;
      let served = rest;
      for (let candidate of /\.[^/]+$/.test(rest)
        ? [rest]
        : [rest, `${rest}.js`, `${rest}.mjs`]) {
        try {
          bytes = await readFile(join(dir, ...candidate.split('/')));
          served = candidate;
          break;
        } catch {
          // keep probing
        }
      }
      if (bytes === undefined) {
        respondError(
          req,
          res,
          404,
          'file-not-found',
          `${rest} does not exist in the live tree`,
          'no-store',
        );
        return;
      }
      // The whole point: every save is visible on the next request.
      respond(
        req,
        res,
        200,
        {
          'content-type': contentTypeFor(served),
          'cache-control': 'no-store',
          'content-digest': contentDigest(bytes),
          'x-deck-live': liveMatch.groups.name,
          'access-control-allow-origin': '*',
        },
        bytes,
      );
      return;
    }

    let packagesMatch = pathname.match(PACKAGES_PATH);
    if (packagesMatch?.groups) {
      let meta = await readStoreMeta(storeDir, packagesMatch.groups.name);
      if (!meta || Object.keys(meta.versions).length === 0) {
        respondError(
          req,
          res,
          404,
          'package-not-found',
          `no published versions for package ${packagesMatch.groups.name}`,
        );
        return;
      }
      respond(
        req,
        res,
        200,
        {
          'content-type': 'application/json',
          'cache-control': SHORT_CACHE,
          'access-control-allow-origin': '*',
        },
        JSON.stringify(
          {
            data: {
              type: 'package',
              id: meta.name,
              attributes: {
                name: meta.name,
                versions: Object.fromEntries(
                  Object.entries(meta.versions).map(([v, r]) => [
                    v,
                    { treeHash: r.treeHash },
                  ]),
                ),
                distTags: meta.tags,
              },
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    let match = pathname.match(SERVE_PATH);
    if (!match?.groups) {
      if (fallback) {
        fallback(req, res);
        return;
      }
      respondError(req, res, 404, 'not-found', `no route for ${pathname}`);
      return;
    }
    let { name, spec } = match.groups;
    let rest = match.groups.rest?.slice(1); // strip leading '/'

    let meta = await readStoreMeta(storeDir, name);
    if (!meta || Object.keys(meta.versions).length === 0) {
      respondError(
        req,
        res,
        404,
        'package-not-found',
        `no published versions for package ${name}`,
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
        `@${name}@${spec}: ${resolution.detail}`,
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
        `@${name}@${spec}: ${resolution.detail}`,
      );
      return;
    }
    let version = resolution.version;
    let pack = await loadPack(name, version);
    if (!pack) {
      respondError(
        req,
        res,
        404,
        'version-not-found',
        `@${name}@${version} has no stored pack`,
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

    let mapEntry = packagesFromPack(pack.bytes)?.[name];
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
          `@${name}@${version} declares no entry module in importmap.json`,
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

    let canonicalLocation = `/@${name}@${version}${
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
      // Faithful by construction: these ARE the stored sealed bytes.
      respond(
        req,
        res,
        200,
        {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${name}-${version}.pack.zip"`,
          'cache-control': IMMUTABLE_CACHE,
          'content-digest': contentDigest(pack.bytes),
          'x-deck-tree-hash': pack.treeHash,
          'access-control-allow-origin': '*',
        },
        pack.bytes,
      );
      return;
    }

    if (wantsMeta) {
      let packlist = peekPacklist(pack.bytes);
      let exports: Record<string, string> = {};
      for (let [alias, value] of Object.entries(mapEntry?.exports ?? {})) {
        let treePath = treePathFromMapValue(value);
        if (treePath) {
          exports[alias] = treePath;
        }
      }
      respond(
        req,
        res,
        200,
        {
          'content-type': 'application/json',
          'cache-control': SHORT_CACHE,
          'x-deck-tree-hash': pack.treeHash,
          'access-control-allow-origin': '*',
        },
        JSON.stringify(
          {
            data: {
              type: 'package-meta',
              id: `${name}@${version}`,
              attributes: {
                name,
                version,
                treeHash: pack.treeHash,
                entry: mapEntry?.entry
                  ? (treePathFromMapValue(mapEntry.entry) ?? null)
                  : null,
                exports,
                baseApi: mapEntry?.baseApi ?? null,
                files: packlist.entries.map((e) => e.path),
              },
            },
          },
          null,
          2,
        ),
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

    let bytes = readTreePath(pack.bytes, rest!);
    if (bytes === undefined && !/\.[^/]+$/.test(rest!)) {
      // Extensionless specifiers probe .js then .mjs (vanilla serving).
      for (let candidate of [`${rest}.js`, `${rest}.mjs`]) {
        bytes = readTreePath(pack.bytes, candidate);
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
        `${match.groups.rest?.slice(1)} does not exist in ${name}@${version}`,
      );
      return;
    }
    respond(
      req,
      res,
      200,
      {
        'content-type': contentTypeFor(rest!),
        'cache-control': IMMUTABLE_CACHE,
        'content-digest': contentDigest(bytes),
        'x-deck-package': `${name}@${version}`,
        'x-deck-tree-hash': pack.treeHash,
        'access-control-allow-origin': '*',
      },
      bytes,
    );
  }

  return createServer((req, res) => {
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
  });
}
