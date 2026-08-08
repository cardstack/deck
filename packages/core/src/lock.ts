import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import {
  packagesFromPack,
  parseDependencies,
  parsePackages,
  treePathFromMapValue,
  IMPORT_MAP_PATH,
} from './import-map.ts';
import { readStoreMeta, readStoredPack } from './store.ts';

// The decklist lock.
//
// A deck declares what it depends on as RANGES — `"acme/confetti": "^1.0.0"` —
// because that is what the author means. What its users get must not be a
// range: a consumer of a published deck should never be exposed to the
// volatility of somebody else's working tree. So publishing resolves every
// range to one exact version and writes those pins into the deck's own
// import map, where the browser reads them.
//
// The pins go INTO THE TREE, as an ordinary edit. That keeps three things
// true at once: packs stay faithful (nothing is rewritten at pack time or
// serve time), the lock is visible in `cat importmap.json`, and moving a
// dependency forward is just another save — which auto-publishes, seals,
// and can be reverted like any other.
//
// Three levels of volatility, all expressible, all just URLs:
//
//   "live"      → /<realm>/<pub>/<pkg>/…        every save, instantly (YOLO)
//   "dev"       → /<realm>/<pub>/<pkg>@0.2.0-dev.7/…  the freshest seal
//   "^1.0.0"    → /<realm>/<pub>/<pkg>@1.2.0/…  dependable; moves when you say
//
// Prereleases are excluded from range matching (the npm rule), so a `^1.0.0`
// dependency never silently picks up somebody's auto-published dev line.

export const LIVE_SPEC = 'live';

export interface DependencyResolution {
  // The declared key: `<publisher>/<package>` or `<realm>/<publisher>/<package>`.
  key: string;
  realm: string;
  publisher: string;
  package: string;
  spec: string;
  // The exact version the range resolved to; undefined when pinned to live.
  version?: string;
  entry?: string;
  treeHash?: string;
  // The import-map entries this resolution contributes.
  imports: Record<string, string>;
  // What the map pointed at before, when it is changing.
  previous?: string;
}

export interface ResolveOptions {
  realmDir: string;
  realmName: string;
  storeDir: string;
  dependencies: Record<string, string>;
  // The map being locked, so the report can say what moved.
  currentImports?: Record<string, string>;
}

function parseKey(
  key: string,
  defaultRealm: string,
): { realm: string; publisher: string; package: string } | undefined {
  let segments = key.split('/');
  if (segments.length === 2) {
    return { realm: defaultRealm, publisher: segments[0], package: segments[1] };
  }
  if (segments.length === 3) {
    return { realm: segments[0], publisher: segments[1], package: segments[2] };
  }
  return undefined;
}

// npm's rule: a range never matches a prerelease. An exact prerelease pin or
// a dist-tag is how you opt in on purpose.
function resolveSpec(
  spec: string,
  meta: { versions: Record<string, unknown>; tags: Record<string, string> },
): string | undefined {
  let versions = Object.keys(meta.versions);
  if (semver.valid(spec) === spec) {
    return versions.includes(spec) ? spec : undefined;
  }
  if (meta.tags[spec]) {
    return meta.tags[spec];
  }
  if (semver.validRange(spec)) {
    return (
      semver.maxSatisfying(
        versions.filter((version) => semver.prerelease(version) === null),
        spec,
      ) ?? undefined
    );
  }
  return undefined;
}

async function entryOf(
  options: ResolveOptions,
  target: { realm: string; publisher: string; package: string },
  version: string | undefined,
): Promise<string | undefined> {
  if (version === undefined) {
    // Live: the entry is whatever the working tree declares right now.
    try {
      let text = await readFile(
        join(
          options.realmDir,
          target.publisher,
          target.package,
          IMPORT_MAP_PATH,
        ),
        'utf8',
      );
      let value = parsePackages(text)?.[target.package]?.entry;
      return value ? treePathFromMapValue(value) : undefined;
    } catch {
      return undefined;
    }
  }
  let bytes = await readStoredPack(
    options.storeDir,
    `${target.publisher}/${target.package}`,
    version,
  );
  if (!bytes) {
    return undefined;
  }
  let value = packagesFromPack(bytes)?.[target.package]?.entry;
  return value ? treePathFromMapValue(value) : undefined;
}

export async function resolveDependencies(
  options: ResolveOptions,
): Promise<DependencyResolution[]> {
  let resolutions: DependencyResolution[] = [];
  for (let [key, spec] of Object.entries(options.dependencies)) {
    let target = parseKey(key, options.realmName);
    if (!target) {
      throw new Error(
        `dependency "${key}" is not <publisher>/<package> or <realm>/<publisher>/<package>`,
      );
    }
    if (target.realm !== options.realmName) {
      // Cross-realm dependencies need that realm's store, which this realm
      // does not have. Refusing beats writing a pin nobody can serve.
      throw new Error(
        `dependency "${key}" is in realm ${target.realm}; only ${options.realmName} can be locked from here`,
      );
    }
    let base = `/${target.realm}/${target.publisher}/${target.package}`;
    let version: string | undefined;
    if (spec !== LIVE_SPEC) {
      let meta = await readStoreMeta(
        options.storeDir,
        `${target.publisher}/${target.package}`,
      );
      if (!meta || Object.keys(meta.versions).length === 0) {
        throw new Error(`dependency "${key}" has no published versions`);
      }
      version = resolveSpec(spec, meta);
      if (!version) {
        throw new Error(
          `dependency "${key}": no published version satisfies "${spec}"`,
        );
      }
    }
    let versioned = version === undefined ? base : `${base}@${version}`;
    let entry = await entryOf(options, target, version);
    let imports: Record<string, string> = { [`${key}/`]: `${versioned}/` };
    if (entry) {
      imports[key] = `${versioned}/${entry}`;
    }
    resolutions.push({
      key,
      realm: target.realm,
      publisher: target.publisher,
      package: target.package,
      spec,
      version,
      entry,
      imports,
      previous: options.currentImports?.[key],
    });
  }
  return resolutions;
}

export interface LockResult {
  text: string;
  changed: boolean;
}

// Writes the pins into the map, leaving everything else — including the
// ranges under `deck.dependencies` — exactly as the author wrote it. The
// ranges are the intent; the pins are what that intent resolved to today.
export function applyLock(
  mapText: string,
  resolutions: readonly DependencyResolution[],
): LockResult {
  let parsed = JSON.parse(mapText);
  let imports: Record<string, string> = { ...(parsed.imports ?? {}) };
  let changed = false;
  let desired = new Set<string>();
  for (let resolution of resolutions) {
    for (let [specifier, target] of Object.entries(resolution.imports)) {
      desired.add(specifier);
      if (imports[specifier] !== target) {
        changed = true;
      }
      imports[specifier] = target;
    }
  }
  // The lock OWNS the pins it writes: drop a dependency from the decklist
  // (or fork away from it) and its pins go too. Anything else in `imports`
  // is the author's and is never touched — a pin is recognised by pointing
  // at the very package its specifier names.
  for (let [specifier, target] of Object.entries(imports)) {
    if (desired.has(specifier) || !isPin(specifier, target)) {
      continue;
    }
    delete imports[specifier];
    changed = true;
  }
  parsed.imports = imports;
  return { text: JSON.stringify(parsed, null, 2) + '\n', changed };
}

function isPin(specifier: string, target: string): boolean {
  let name = specifier.replace(/\/$/, '');
  if (name.split('/').length !== 2) {
    return false;
  }
  return new RegExp(
    `^/[a-z0-9][a-z0-9-]*/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(@[^/]+)?/`,
  ).test(target);
}

export async function lockDeck(options: {
  realmDir: string;
  realmName: string;
  storeDir: string;
  deckDir: string;
}): Promise<{ resolutions: DependencyResolution[]; text: string; changed: boolean }> {
  let mapPath = join(options.deckDir, IMPORT_MAP_PATH);
  let mapText = await readFile(mapPath, 'utf8');
  let dependencies = parseDependencies(mapText) ?? {};
  let currentImports = (JSON.parse(mapText).imports ?? {}) as Record<
    string,
    string
  >;
  let resolutions = await resolveDependencies({
    realmDir: options.realmDir,
    realmName: options.realmName,
    storeDir: options.storeDir,
    dependencies,
    currentImports,
  });
  let { text, changed } = applyLock(mapText, resolutions);
  return { resolutions, text, changed };
}
