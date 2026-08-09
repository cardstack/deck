import { readFile } from 'node:fs/promises';
import { minify, type MinifyOptions } from 'terser';
import { pack, unpack } from '@cardstack/deck/pack';
import { parsePackages } from '@cardstack/deck/import-map';

// Workstream A — minify as a DERIVED SEALED TREE.
//
// Not a header flag, not `?minify=1`, not a rewrite of `@1.2.3`. Minifying
// in place would break "fork the bytes you ran", make the pack round-trip
// depend on a toolchain, and put dev and prod on one cache key — the esm.sh
// lesson already adopted. So the minified form is its own tree, its own
// treeHash, its own version, and consumers point at it deliberately.
//
// Three rulings from the amended spec are load-bearing here:
//
//   [A2] terser, not esbuild. Minify runs once per release, so esbuild's
//   throughput buys nothing, and it trades ratio for speed — backwards for
//   a workstream about smaller bytes. What settles it is that terser is
//   pure JS, so its output does not vary by platform; a native minifier
//   could make `derivation` a claim nobody can reproduce.
//
//   [A5] `1.2.3-min.0`, never `1.2.3+min`. Build metadata is stripped by
//   semver.valid (so the store rejects it) and compares EQUAL to the source
//   version (so range resolution would be nondeterministic). A prerelease
//   is distinct and ranges never match it, which makes prod an explicit
//   choice rather than something a `^1.0.0` drifts into.
//
//   [A4] A derivation that cannot be re-run is a story. The record carries
//   the tool, its version, and canonically serialized options, and
//   `verifyDerivation` re-runs it and compares hashes.

export const DERIVATION_KIND = 'minify-v1';

// Read from the installed package rather than hardcoded: a derivation record
// naming a version other than the one that actually ran would be worse than
// no record at all. It lives here because this is where terser is a
// dependency — the CLI cannot resolve it.
let cachedVersion: string | undefined;
export async function terserVersion(): Promise<string> {
  if (cachedVersion) {
    return cachedVersion;
  }
  // Walk up from whatever the resolver points at until a package.json with
  // the right name turns up. Guessing a layout breaks the moment a packager
  // nests things differently.
  // `new URL('.', fileUrl)` is the CONTAINING directory; `'../'` would drop
  // the filename and climb, skipping the package directory itself.
  let current = new URL('.', import.meta.resolve('terser'));
  for (let depth = 0; depth < 6; depth++) {
    try {
      let parsed = JSON.parse(
        await readFile(new URL('package.json', current), 'utf8'),
      ) as { name?: string; version?: string };
      if (parsed.name === 'terser' && parsed.version) {
        cachedVersion = parsed.version;
        return cachedVersion;
      }
    } catch {
      // keep climbing
    }
    current = new URL('../', current);
  }
  throw new Error('derive: cannot determine the installed terser version');
}

export interface Derivation {
  kind: typeof DERIVATION_KIND;
  tool: string;
  options: Record<string, unknown>;
}

export interface DerivedTree {
  files: { path: string; bytes: Buffer }[];
  derivedFrom: string;
  derivation: Derivation;
  version: string;
  minifiedPaths: string[];
  // Bytes before and after, so the release can say whether it was worth it.
  sourceBytes: number;
  derivedBytes: number;
}

// Sorted keys, so two agents recording "the same options" record the same
// string and the comparison in verifyDerivation is meaningful.
export function canonicalOptions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(options).sort(([a], [b]) => a.localeCompare(b)),
  );
}

// Deliberately conservative and fixed. Options that vary per invocation
// would make the derivation unreproducible, which is the one property it
// exists to have.
export const MINIFY_OPTIONS: MinifyOptions = {
  module: true,
  compress: true,
  mangle: true,
  format: { comments: 'some' },
  sourceMap: false,
};

// §2.3: what gets minified. HTML is excluded because it is the injection
// target and the injection points must stay findable; binaries and maps are
// excluded because minifying them is meaningless.
export function isMinifiable(path: string): boolean {
  return /\.(m?js)$/.test(path) && !path.endsWith('.min.js');
}

export function minifiedVersion(source: string, counter = 0): string {
  return `${source}-min.${counter}`;
}

export async function deriveMinified(options: {
  packBytes: Buffer;
  sourceVersion: string;
  packageName: string;
  counter?: number;
  terserVersion: string;
}): Promise<DerivedTree> {
  let { packBytes, sourceVersion, packageName, counter = 0 } = options;
  let opened = unpack(packBytes);
  let version = minifiedVersion(sourceVersion, counter);
  let files: { path: string; bytes: Buffer }[] = [];
  let minifiedPaths: string[] = [];
  let sourceBytes = 0;
  let derivedBytes = 0;

  for (let [path, bytes] of [...opened.files.entries()].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    sourceBytes += bytes.length;
    if (!isMinifiable(path)) {
      files.push({ path, bytes });
      derivedBytes += bytes.length;
      continue;
    }
    let result = await minify(bytes.toString('utf8'), MINIFY_OPTIONS);
    if (typeof result.code !== 'string') {
      throw new Error(`derive: terser produced no output for ${path}`);
    }
    let out = Buffer.from(result.code, 'utf8');
    // A "minifier" that made the file bigger has nothing to offer, and
    // keeping the original keeps the tree closer to its source.
    let chosen = out.length < bytes.length ? out : bytes;
    if (chosen === out) {
      minifiedPaths.push(path);
    }
    files.push({ path, bytes: chosen });
    derivedBytes += chosen.length;
  }

  let derivation: Derivation = {
    kind: DERIVATION_KIND,
    tool: `terser@${options.terserVersion}`,
    options: canonicalOptions(MINIFY_OPTIONS as Record<string, unknown>),
  };

  // The derived tree declares its own version AND its lineage, inside the
  // map, before hashing — so `derivedFrom` is part of what was sealed rather
  // than metadata bolted on beside it. Manifest agreement also requires the
  // declared version to match what is published.
  let mapIndex = files.findIndex((file) => file.path === 'importmap.json');
  if (mapIndex !== -1) {
    let rewritten = rewriteMap(files[mapIndex].bytes, packageName, {
      version,
      derivedFrom: opened.treeHash,
      derivation,
    });
    // The rewrite happens after the byte tally, so correct the tally rather
    // than report a size for a tree that is not the one being returned.
    derivedBytes += rewritten.length - files[mapIndex].bytes.length;
    files[mapIndex] = { path: 'importmap.json', bytes: rewritten };
  }

  return {
    files,
    derivedFrom: opened.treeHash,
    derivation,
    version,
    minifiedPaths,
    sourceBytes,
    derivedBytes,
  };
}

function rewriteMap(
  bytes: Buffer,
  packageName: string,
  fields: Record<string, unknown>,
): Buffer {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  } catch {
    return bytes;
  }
  let key = packageName.split('/').at(-1)!;
  let deck = (parsed.deck ?? {}) as Record<string, unknown>;
  let packages = (deck.packages ?? {}) as Record<string, Record<string, unknown>>;
  packages[key] = { ...(packages[key] ?? {}), ...fields };
  deck.packages = packages;
  parsed.deck = deck;
  return Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8');
}

export function derivedPack(tree: DerivedTree): Buffer {
  return pack(tree.files);
}

export interface DerivationVerdict {
  ok: boolean;
  expected: string;
  actual?: string;
  detail?: string;
}

// [A4] L11 applied to derived trees: re-run the recorded derivation over the
// source tree and require the same treeHash. A `derivation` record nobody
// can reproduce is decoration.
export async function verifyDerivation(options: {
  sourcePack: Buffer;
  derivedTreeHash: string;
  derivation: Derivation;
  sourceVersion: string;
  packageName: string;
  version: string;
  terserVersion: string;
}): Promise<DerivationVerdict> {
  let {
    sourcePack,
    derivedTreeHash,
    derivation,
    sourceVersion,
    packageName,
    version,
  } = options;
  if (derivation.kind !== DERIVATION_KIND) {
    return {
      ok: false,
      expected: derivedTreeHash,
      detail: `unknown derivation kind "${derivation.kind}"`,
    };
  }
  let recorded = derivation.tool;
  let current = `terser@${options.terserVersion}`;
  if (recorded !== current) {
    return {
      ok: false,
      expected: derivedTreeHash,
      detail: `recorded ${recorded}, this machine has ${current} — install the recorded version to reproduce`,
    };
  }
  // `1.2.3` has no `-min.` to split on, so `at(-1)` hands back the whole
  // string and `Number` gives NaN — which would rebuild as `1.2.3-min.NaN`
  // and report a hash mismatch instead of the real problem.
  let suffix = version.split('-min.');
  let counter = suffix.length > 1 ? Number(suffix.at(-1)) : NaN;
  if (!Number.isInteger(counter) || counter < 0) {
    return {
      ok: false,
      expected: derivedTreeHash,
      detail: `"${version}" is not a derived version (expected "<source>-min.<n>")`,
    };
  }
  let rebuilt = await deriveMinified({
    packBytes: sourcePack,
    sourceVersion,
    packageName,
    counter,
    terserVersion: options.terserVersion,
  });
  let actual = unpack(derivedPack(rebuilt)).treeHash;
  return {
    ok: actual === derivedTreeHash,
    expected: derivedTreeHash,
    actual,
    ...(actual === derivedTreeHash
      ? {}
      : { detail: 're-running the derivation produced a different tree' }),
  };
}

// A derived tree points back at what it came from. `packagesFromPack` on the
// derived pack is how a reader finds it.
export function derivationFromMap(
  mapText: string,
  packageName: string,
): { derivedFrom?: string; derivation?: Derivation } {
  let entry = parsePackages(mapText)?.[packageName.split('/').at(-1)!] as
    | (Record<string, unknown> & {
        derivedFrom?: string;
        derivation?: Derivation;
      })
    | undefined;
  return {
    ...(entry?.derivedFrom ? { derivedFrom: entry.derivedFrom } : {}),
    ...(entry?.derivation ? { derivation: entry.derivation } : {}),
  };
}

