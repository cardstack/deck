import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// tree-hash-v1: the canonical identity of a deck, independent of its
// container (realm tree at a seal, .pack.zip artifact, or a pack mounted
// inside a deck). Every implementation — CLI, minimal server, and later the
// realm server — must produce byte-identical results from the same logical
// tree. The zip's own bytes are NEVER an identity: two byte-different zips
// (timestamps, entry order) can carry the same deck.
//
// The manifest text is deliberately `shasum -a 256`-compatible
// (`<hex><space><space><path>`, one line per file, sorted by path in UTF-8
// byte order), so a tree can be checked with stock coreutils:
//
//   find . -type f | sort | xargs shasum -a 256
//
// treeHash = sha256 of that manifest text. The spec name (below) is part of
// every packlist and every derived-artifact build key, so a change to these
// rules is a new spec version, never silent drift.

export const TREE_HASH_SPEC = 'tree-hash-v1';

export interface TreeHashEntry {
  // Relative path from the tree root: forward slashes, no leading slash,
  // no '.'/'..' segments, no empty segments, no NUL, and no '!' (reserved
  // by the pack-mount separator `!/`).
  path: string;
  // Lowercase sha256 hex of the file's bytes.
  sha256: string;
}

export interface TreeHashResult {
  spec: typeof TREE_HASH_SPEC;
  treeHash: string; // lowercase sha256 hex of manifestText
  manifestText: string;
  entries: TreeHashEntry[]; // sorted, as hashed
}

export function hashBytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// The `!` exclusion is a protocol ruling: `!/` marks the archive boundary
// for packs mounted inside decks, so it can never appear in a tree path.
export function isValidTreePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.endsWith('/')) {
    return false;
  }
  if (path.includes('\0') || path.includes('\\') || path.includes('!')) {
    return false;
  }
  return path
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

const HEX_64 = /^[0-9a-f]{64}$/;

// Sort key: UTF-8 byte order (NOT locale or UTF-16 code-unit order), so
// every language and libc agrees on the ordering.
function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function treeHashFromEntries(
  entries: readonly TreeHashEntry[],
): TreeHashResult {
  let seen = new Set<string>();
  for (let { path, sha256 } of entries) {
    if (!isValidTreePath(path)) {
      throw new Error(`invalid tree path: ${JSON.stringify(path)}`);
    }
    if (!HEX_64.test(sha256)) {
      throw new Error(`invalid sha256 for ${path}: ${JSON.stringify(sha256)}`);
    }
    if (seen.has(path)) {
      throw new Error(`duplicate tree path: ${path}`);
    }
    seen.add(path);
  }
  let sorted = [...entries].sort((a, b) => compareUtf8(a.path, b.path));
  let manifestText = sorted
    .map(({ path, sha256 }) => `${sha256}  ${path}\n`)
    .join('');
  return {
    spec: TREE_HASH_SPEC,
    treeHash: hashBytes(manifestText),
    manifestText,
    entries: sorted,
  };
}

// Default names never part of a deck's logical tree, whichever container
// it sits in. Callers can extend but not shrink protocol-reserved names.
// A realm carries its own machinery in dot-directories, the way a Boxel
// realm carries `.jj` and `.boxel-history`: `.deck` holds the sealed-pack
// store. They live INSIDE the realm so a realm directory is self-contained
// and movable, and they are ignored here so a realm's own bookkeeping can
// never change the hash of the tree it is keeping.
export const DEFAULT_IGNORE = new Set([
  '.git',
  '.jj',
  '.deck',
  '.DS_Store',
  'node_modules',
  '.boxel-history',
]);

export async function treeHashFromDir(
  dir: string,
  options: { ignore?: ReadonlySet<string> } = {},
): Promise<TreeHashResult> {
  // Union, never replacement. L1 names DEFAULT_IGNORE as part of the
  // algorithm, so a caller that could shrink it could make two
  // implementations disagree about the same directory — which is precisely
  // the drift the law exists to forbid. `??` would have allowed exactly
  // that, quietly, from any caller.
  let ignore = options.ignore
    ? new Set([...DEFAULT_IGNORE, ...options.ignore])
    : DEFAULT_IGNORE;
  let entries: TreeHashEntry[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    for (let dirent of await readdir(current, { withFileTypes: true })) {
      if (ignore.has(dirent.name)) {
        continue;
      }
      let path = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
      if (dirent.isDirectory()) {
        await walk(join(current, dirent.name), path);
      } else if (dirent.isFile()) {
        entries.push({
          path,
          sha256: hashBytes(await readFile(join(current, dirent.name))),
        });
      }
      // Symlinks and other non-regular entries are deliberately not part
      // of a logical tree; a deck is files only.
    }
  }
  await walk(dir, '');
  return treeHashFromEntries(entries);
}

export function formatTreeHash(result: Pick<TreeHashResult, 'treeHash'>) {
  return `${TREE_HASH_SPEC}:${result.treeHash}`;
}
