import { readZipEntry } from './canonical-zip.ts';

// The import map is a tree file (importmap.json at the root) — the deck's
// manifest. The vendor key is `deck`; `boxel` is honored for content
// authored in Boxel realms. Same shape, one namespace per ecosystem.

export const IMPORT_MAP_PATH = 'importmap.json';
export const MOUNT_SEPARATOR = '.pack.zip!/';

export interface PackageMapEntry {
  version?: string;
  entry?: string;
  exports?: Record<string, string>;
  baseApi?: string;
}

export function parsePackages(
  jsonText: string,
): Record<string, PackageMapEntry> | undefined {
  try {
    let parsed = JSON.parse(jsonText);
    let packages = parsed?.deck?.packages ?? parsed?.boxel?.packages;
    if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
      return packages as Record<string, PackageMapEntry>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// What this deck depends on, as RANGES: `"acme/confetti": "^1.0.0"`. The
// author writes intent here; `deck lock` resolves it into `imports` pins
// (see lock.ts) so consumers of a published deck never inherit somebody
// else's working tree.
export function parseDependencies(
  jsonText: string,
): Record<string, string> | undefined {
  try {
    let parsed = JSON.parse(jsonText);
    let dependencies =
      parsed?.deck?.dependencies ?? parsed?.boxel?.dependencies;
    if (
      dependencies &&
      typeof dependencies === 'object' &&
      !Array.isArray(dependencies)
    ) {
      return dependencies as Record<string, string>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function packagesFromPack(
  packBytes: Buffer,
): Record<string, PackageMapEntry> | undefined {
  let raw = readZipEntry(packBytes, IMPORT_MAP_PATH);
  return raw ? parsePackages(raw.toString('utf8')) : undefined;
}

// Map values point into the tree as `$REALM/<path>`, `./<path>`, or a bare
// relative path. Absolute URLs (references to web decks) and traversal
// shapes are not tree paths. `!` is legal only as the mount separator.
export function treePathFromMapValue(value: string): string | undefined {
  let path = value;
  if (path.startsWith('$REALM/')) {
    path = path.slice('$REALM/'.length);
  } else if (path.startsWith('./')) {
    path = path.slice('./'.length);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith('$')) {
    return undefined;
  }
  if (path.length === 0 || path.startsWith('/')) {
    return undefined;
  }
  if (path.includes('!') && !path.includes(MOUNT_SEPARATOR)) {
    return undefined;
  }
  let segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return undefined;
  }
  return path;
}
