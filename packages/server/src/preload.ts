import { posix } from 'node:path';
import { moduleSpecifiers } from '@deck/core/es-lexer';

// Workstream C — closure preload.
//
// A bundle's real advantage on a cold network is not that it is one file.
// It is that the browser learns every URL at once. Loading `a → b → c` as
// separate modules costs a round trip per LEVEL of the graph, because each
// import is only discovered after its parent parses. Multiplexing does not
// fix that; H2 lets you fetch many things at once but cannot tell you what
// to ask for.
//
// `modulepreload` is what the platform kept after Server Push was removed,
// and the closure is computable here because the graph is sealed: the tree
// manifest lists every file and the lexer says what each one imports.
//
// Two rules from the spec's amendments, both about not making things worse:
//
//   A preload whose URL differs from what the resolver actually requests
//   causes a SECOND fetch. So resolution here has to be the same import-map
//   algorithm the browser will run — including scopes, since a vendored
//   dependency's bare specifiers resolve through its own records.
//
//   A cap that nobody can see reads as "we covered it". The budget is in
//   bytes, the order is breadth-first so the early round trips are the ones
//   bought, and what was clipped is reported.

export interface DeckUrl {
  realm: string;
  publisher: string;
  pkg: string;
  version?: string;
  path: string;
}

const DECK_URL =
  /^\/(?<realm>[a-z0-9][a-z0-9-]*)\/(?<publisher>[a-z0-9][a-z0-9-]*)\/(?<pkg>[a-z0-9][a-z0-9-]*)(?:@(?<version>[^/]+))?\/(?<path>.+)$/;

export function parseDeckUrl(url: string): DeckUrl | undefined {
  let match = DECK_URL.exec(url);
  if (!match?.groups) {
    return undefined;
  }
  let { realm, publisher, pkg, version, path } = match.groups;
  return { realm, publisher, pkg, ...(version ? { version } : {}), path };
}

export function formatDeckUrl(url: DeckUrl): string {
  let at = url.version ? `@${url.version}` : '';
  return `/${url.realm}/${url.publisher}/${url.pkg}${at}/${url.path}`;
}

// The import-map resolution a browser performs: an exact key wins; failing
// that the longest key ending in `/` that prefixes the specifier, with the
// remainder appended. Scopes are consulted first, longest prefix first.
export function resolveSpecifier(options: {
  specifier: string;
  fromUrl: string;
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
}): string | undefined {
  let { specifier, fromUrl, imports, scopes } = options;
  let applicable = Object.keys(scopes)
    .filter((prefix) => fromUrl.startsWith(prefix))
    .sort((a, b) => b.length - a.length);
  for (let prefix of applicable) {
    let hit = lookup(specifier, scopes[prefix]);
    if (hit) {
      return hit;
    }
  }
  return lookup(specifier, imports);
}

function lookup(
  specifier: string,
  table: Record<string, string>,
): string | undefined {
  if (table[specifier]) {
    return table[specifier];
  }
  let best: string | undefined;
  for (let key of Object.keys(table)) {
    if (key.endsWith('/') && specifier.startsWith(key)) {
      if (best === undefined || key.length > best.length) {
        best = key;
      }
    }
  }
  return best ? table[best] + specifier.slice(best.length) : undefined;
}

export interface ClosureOptions {
  entries: string[];
  imports: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
  read(url: DeckUrl): Promise<Buffer | undefined>;
  // Sum of module bytes worth advertising up front.
  byteBudget?: number;
  // A ceiling on how much HTML the list may add, independent of bytes.
  maxLinks?: number;
}

export interface Closure {
  // In breadth-first order: the early waves are the round trips being bought.
  urls: string[];
  // Everything reachable, so a caller can report what was clipped.
  total: number;
  bytes: number;
  truncated: boolean;
}

export async function moduleClosure(options: ClosureOptions): Promise<Closure> {
  let {
    entries,
    imports,
    scopes = {},
    read,
    byteBudget = 1024 * 1024,
    maxLinks = 200,
  } = options;
  let seen = new Set<string>();
  let ordered: { url: string; size: number }[] = [];
  let queue = entries.filter((entry) => parseDeckUrl(entry) !== undefined);
  for (let entry of queue) {
    seen.add(entry);
  }

  while (queue.length > 0) {
    // One wave at a time, so `ordered` really is breadth-first and a budget
    // that clips the tail clips the DEEPEST modules — the ones whose round
    // trip is furthest away and least likely to be reached at all.
    let wave = queue;
    queue = [];
    for (let url of wave) {
      let parsed = parseDeckUrl(url);
      if (!parsed) {
        continue;
      }
      let bytes = await read(parsed);
      if (!bytes) {
        continue;
      }
      ordered.push({ url, size: bytes.length });
      if (!/\.(m?js)$/.test(parsed.path)) {
        continue; // carried, not parsed
      }
      for (let specifier of moduleSpecifiers(bytes.toString('utf8'))) {
        let next: string | undefined;
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          next = formatDeckUrl({
            ...parsed,
            path: posix.normalize(
              posix.join(posix.dirname(parsed.path), specifier),
            ),
          });
        } else {
          next = resolveSpecifier({ specifier, fromUrl: url, imports, scopes });
        }
        if (next && !seen.has(next) && parseDeckUrl(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }

  let urls: string[] = [];
  let bytes = 0;
  for (let entry of ordered) {
    if (urls.length >= maxLinks || bytes + entry.size > byteBudget) {
      break;
    }
    urls.push(entry.url);
    bytes += entry.size;
  }
  return {
    urls,
    total: ordered.length,
    bytes,
    truncated: urls.length < ordered.length,
  };
}

const HEAD_END = /<\/head\s*>/i;
const IMPORTMAP_TAG =
  /<script[^>]*type\s*=\s*["']importmap["'][^>]*>[\s\S]*?<\/script\s*>/i;

// `crossorigin` is not optional: module fetches are always CORS-mode, and a
// preload whose credentials mode disagrees is downloaded a second time —
// the exact way `modulepreload` makes pages slower instead of faster.
export function injectModulePreload(
  html: Buffer,
  urls: readonly string[],
): { bytes: Buffer; injected: number } {
  if (urls.length === 0) {
    return { bytes: html, injected: 0 };
  }
  let text = html.toString('utf8');
  let links = urls
    .map((url) => `<link rel="modulepreload" href="${url}" crossorigin>`)
    .join('');
  // After the import map, because a preload of a bare specifier would be
  // meaningless before the map that resolves it, and browsers begin the
  // fetch as soon as the tag is parsed.
  let map = text.match(IMPORTMAP_TAG);
  if (map) {
    let at = map.index! + map[0].length;
    return {
      bytes: Buffer.from(text.slice(0, at) + links + text.slice(at), 'utf8'),
      injected: urls.length,
    };
  }
  let head = text.match(HEAD_END);
  if (head) {
    return {
      bytes: Buffer.from(
        text.slice(0, head.index!) + links + text.slice(head.index!),
        'utf8',
      ),
      injected: urls.length,
    };
  }
  return { bytes: Buffer.from(links + text, 'utf8'), injected: urls.length };
}
