import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { peekPacklist } from '@cardstack/deck/pack';
import { PACKLIST_PATH, type Packlist } from '@cardstack/deck/packlist';
import { isValidTreePath } from '@cardstack/deck/tree-hash';

// Directory listings for the Deck browser: sealed packs (from packlist)
// and live working trees (from the filesystem). Same JSON shape either way.

export interface BrowseEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
  size?: number;
  sha256?: string;
}

export interface BrowseListing {
  package: string;
  version: string;
  treeHash?: string;
  path: string;
  kind: 'sealed' | 'live';
  entries: BrowseEntry[];
}

export interface BrowseFile {
  package: string;
  version: string;
  treeHash?: string;
  path: string;
  kind: 'sealed' | 'live';
  size: number;
  sha256?: string;
  contentType: string;
  text?: string;
  rawUrl: string;
  binary: boolean;
}

function normalizeDirPath(path: string): string {
  if (!path || path === '/') return '';
  return path.replace(/^\/+|\/+$/g, '');
}

export function listingFromPacklist(
  packName: string,
  version: string,
  packlist: Packlist,
  dirPath: string,
): BrowseListing {
  let prefix = normalizeDirPath(dirPath);
  if (prefix && !isValidTreePath(prefix) && prefix !== '') {
    throw new Error(`invalid path: ${dirPath}`);
  }
  let dirs = new Map<string, BrowseEntry>();
  let files: BrowseEntry[] = [];
  for (let entry of packlist.entries) {
    if (entry.path === PACKLIST_PATH) continue;
    if (prefix) {
      if (entry.path === prefix) {
        // Exact file match handled by caller; skip in listing.
        continue;
      }
      if (!entry.path.startsWith(`${prefix}/`)) continue;
    }
    let rest = prefix ? entry.path.slice(prefix.length + 1) : entry.path;
    let slash = rest.indexOf('/');
    if (slash === -1) {
      files.push({
        name: rest,
        type: 'file',
        path: entry.path,
        size: entry.size,
        sha256: entry.sha256,
      });
    } else {
      let name = rest.slice(0, slash);
      let childPath = prefix ? `${prefix}/${name}` : name;
      if (!dirs.has(name)) {
        dirs.set(name, { name, type: 'dir', path: childPath });
      }
    }
  }
  let entries = [...dirs.values(), ...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return {
    package: packName,
    version,
    treeHash: packlist.treeHash.hash,
    path: prefix,
    kind: 'sealed',
    entries,
  };
}

export function findPackFile(
  packlist: Packlist,
  filePath: string,
): { size: number; sha256: string } | undefined {
  let path = normalizeDirPath(filePath);
  return packlist.entries.find((e) => e.path === path);
}

export async function listingFromLiveDir(
  packName: string,
  rootDir: string,
  dirPath: string,
): Promise<BrowseListing> {
  let prefix = normalizeDirPath(dirPath);
  if (prefix && !isValidTreePath(prefix)) {
    throw new Error(`invalid path: ${dirPath}`);
  }
  let absolute = prefix ? join(rootDir, ...prefix.split('/')) : rootDir;
  let names = await readdir(absolute);
  let entries: BrowseEntry[] = [];
  for (let name of names.sort()) {
    if (name === '.DS_Store' || name.startsWith('.')) continue;
    let childAbs = join(absolute, name);
    let childPath = prefix ? `${prefix}/${name}` : name;
    if (prefix ? !isValidTreePath(childPath) : name.includes('/')) continue;
    let info = await stat(childAbs);
    if (info.isDirectory()) {
      entries.push({ name, type: 'dir', path: childPath });
    } else if (info.isFile()) {
      entries.push({ name, type: 'file', path: childPath, size: info.size });
    }
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return {
    package: packName,
    version: 'live',
    path: prefix,
    kind: 'live',
    entries,
  };
}

export async function readLiveFile(
  rootDir: string,
  filePath: string,
): Promise<{ bytes: Buffer; size: number } | undefined> {
  let path = normalizeDirPath(filePath);
  if (!isValidTreePath(path)) return undefined;
  try {
    let bytes = await readFile(join(rootDir, ...path.split('/')));
    return { bytes, size: bytes.length };
  } catch {
    return undefined;
  }
}

export function peekListing(packBytes: Buffer): Packlist {
  return peekPacklist(packBytes);
}

const TEXT_EXT =
  /\.(js|mjs|cjs|ts|tsx|jsx|json|html|htm|css|md|txt|svg|map|xml|yml|yaml|toml)$/i;

export function looksLikeText(path: string, bytes: Buffer): boolean {
  if (TEXT_EXT.test(path)) return true;
  let sample = bytes.subarray(0, Math.min(bytes.length, 800));
  for (let b of sample) {
    if (b === 0) return false;
  }
  return true;
}

export function bytesToPreview(bytes: Buffer, max = 200_000): string {
  let slice = bytes.subarray(0, Math.min(bytes.length, max));
  return slice.toString('utf8');
}
