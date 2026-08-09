import { posix } from 'node:path';
import { moduleSpecifiers } from '@deck/core/es-lexer';
import { resolveSpecifier } from '@deck/core/resolve';

// Re-exported because it used to live here. The resolution algorithm is not
// a preload detail — it is the contract any host with its own module loader
// has to implement — so it moved to the browser-safe half of Core.
export { resolveSpecifier };

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
  depot: string;
  publisher: string;
  pkg: string;
  version?: string;
  path: string;
}

// ONE definition of what a name segment is. Two spellings of the same
// grammar drift, and the drift shows up as a URL the router answers and the
// closure walk silently skips — which is exactly the failure mode the walk
// already had once. server.ts imports this rather than restating it.
export const SEGMENT = '[a-z0-9][a-z0-9-]{0,63}';

const DECK_URL = new RegExp(
  `^/(?<depot>${SEGMENT})/(?<publisher>${SEGMENT})/(?<pkg>${SEGMENT})(?:@(?<version>[^/]+))?/(?<path>.+)$`,
);

export function parseDeckUrl(url: string): DeckUrl | undefined {
  let match = DECK_URL.exec(url);
  if (!match?.groups) {
    return undefined;
  }
  let { depot, publisher, pkg, version, path } = match.groups;
  return { depot, publisher, pkg, ...(version ? { version } : {}), path };
}

export function formatDeckUrl(url: DeckUrl): string {
  let at = url.version ? `@${url.version}` : '';
  return `/${url.depot}/${url.publisher}/${url.pkg}${at}/${url.path}`;
}


const MODULE_SCRIPT =
  /<script([^>]*\btype\s*=\s*["']module["'][^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;

// What the DOCUMENT actually starts from.
//
// Not "every value in the import map". A map lists what a deck declares, and
// a page rarely imports all of it — seeding the walk from the map preloads
// modules the page will never request, and `modulepreload crossorigin` is a
// real download, not a hint. Over-preloading is the classic way this feature
// makes a page slower rather than faster.
//
// Inline module scripts are entries too: `<script type="module">import
// 'app';</script>` has no src, and skipping it would miss the whole graph on
// any page written that way.
export function documentEntries(options: {
  html: string;
  imports: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
  // The document's own URL, so an inline script's bare specifiers resolve
  // through the scopes that apply to it.
  fromUrl: string;
}): string[] {
  let { html, imports, scopes = {}, fromUrl } = options;
  let entries: string[] = [];
  for (let [, attributes, body] of html.matchAll(MODULE_SCRIPT)) {
    let src = SRC_ATTR.exec(attributes)?.[1];
    if (src) {
      // A script src is a URL, never a bare specifier — import maps do not
      // apply to it. So it is resolved the way the browser resolves it:
      // against the document. Requiring an absolute path here was the same
      // class of mistake as the empty `scopes` — the common spelling,
      // `src="./app.js"`, dropped out of the walk and every page written
      // that way advertised an empty closure while looking like it worked.
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) {
        continue; // another origin; not this depot's bytes to preload
      }
      entries.push(
        src.startsWith('/')
          ? src
          : posix.normalize(posix.join(posix.dirname(fromUrl), src)),
      );
      continue;
    }
    for (let specifier of moduleSpecifiers(body)) {
      let resolved = specifier.startsWith('/')
        ? specifier
        : resolveSpecifier({ specifier, fromUrl, imports, scopes });
      if (resolved?.startsWith('/')) {
        entries.push(resolved);
      }
    }
  }
  return [...new Set(entries)];
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
