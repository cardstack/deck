import { posix } from 'node:path';
import { isValidTreePath } from './tree-hash.ts';
import { extractSpecifiers } from './vendor.ts';
import {
  deckNameForNpm,
  fetchNpmPackage,
  repoUrlFor,
  type NpmPackage,
} from './npm.ts';

// Source-mode vendoring: keep the module boundary.
//
// The bundle a CDN serves is one address. The tree npm publishes is many,
// and the many is the point — you cannot fork what you cannot see. For
// three@0.160.0 the difference is 1 file against 374, for 7% more bytes.
//
// Nothing here rewrites a package that does not need it. three's `src/`
// uses relative, extension-complete specifiers, so the vendored tree is
// byte-for-byte what npm published, which is in turn byte-for-byte the
// GitHub tree at the recorded commit. That identity is the whole value:
// an edit to a vendored file is a diff against a known upstream commit.

const JS_EXTENSIONS = ['.js', '.mjs', '.cjs'];
const PARSEABLE = new Set([...JS_EXTENSIONS, '.ts', '.mts']);

function isParseable(path: string): boolean {
  return PARSEABLE.has(posix.extname(path).toLowerCase());
}

function normalizeJoin(fromPath: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(fromPath), specifier));
}

// Node's resolution, minus the parts a browser cannot do anyway. Returns
// the path as published, so an already-complete specifier resolves to
// itself and needs no rewrite.
export function resolveRelative(
  fromPath: string,
  specifier: string,
  files: Map<string, Buffer>,
): string | undefined {
  let base = normalizeJoin(fromPath, specifier);
  let candidates = [
    base,
    ...JS_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...JS_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => files.has(candidate));
}

export interface SourceGraph {
  entry: string;
  modules: string[];
  // Specifiers the walk would have to leave live: bare names, `node:`
  // builtins, absolute URLs.
  externals: string[];
  // Relative specifiers that resolve to nothing in the published files.
  unresolved: string[];
  // Non-JS members of the graph (JSON, CSS, WASM). Carried, not parsed.
  assets: string[];
  bytes: number;
}

export function walkSourceGraph(
  files: Map<string, Buffer>,
  entry: string,
  options: { maxModules?: number; maxBytes?: number } = {},
): SourceGraph {
  let { maxModules = 5000, maxBytes = 64 * 1024 * 1024 } = options;
  let seen = new Set<string>();
  let externals = new Set<string>();
  let unresolved = new Set<string>();
  let assets = new Set<string>();
  let bytes = 0;
  let queue = [entry];

  while (queue.length > 0) {
    let path = queue.pop()!;
    if (seen.has(path)) {
      continue;
    }
    let content = files.get(path);
    if (!content) {
      unresolved.add(path);
      continue;
    }
    seen.add(path);
    bytes += content.length;
    if (seen.size > maxModules) {
      throw new Error(`vendor: module cap exceeded (${maxModules})`);
    }
    if (bytes > maxBytes) {
      throw new Error(`vendor: byte cap exceeded (${maxBytes})`);
    }
    if (!isParseable(path)) {
      assets.add(path);
      continue;
    }
    for (let specifier of extractSpecifiers(content.toString('utf8'))) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        externals.add(specifier); // bare, `node:`, or an absolute URL
        continue;
      }
      let resolved = resolveRelative(path, specifier, files);
      if (resolved) {
        queue.push(resolved);
      } else {
        unresolved.add(`${path} → ${specifier}`);
      }
    }
  }

  return {
    entry,
    modules: [...seen].sort(),
    externals: [...externals].sort(),
    unresolved: [...unresolved].sort(),
    assets: [...assets].sort(),
    bytes,
  };
}

function exportTargets(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  // Browser and ESM conditions first: those are the ones that can be
  // late-bound over a URL.
  let record = value as Record<string, unknown>;
  for (let key of ['browser', 'import', 'module', 'default']) {
    if (key in record) {
      exportTargets(record[key], out);
    }
  }
}

// Candidate entries, most source-shaped first. Which one wins is decided
// by measurement, not by this order — see probeEntries.
export function candidateEntries(pkg: NpmPackage): string[] {
  let json = pkg.packageJson;
  let candidates: string[] = [];
  let base = pkg.name.replace(/^@[^/]+\//, '');
  let capitalized = base.charAt(0).toUpperCase() + base.slice(1);

  let exportsField = json.exports as Record<string, unknown> | undefined;
  // A package that exports its own source tree is inviting this.
  if (exportsField && typeof exportsField === 'object') {
    for (let key of Object.keys(exportsField)) {
      let match = /^\.\/(.+)\/\*$/.exec(key);
      if (match) {
        let dir = match[1];
        candidates.push(
          ...['index', 'main', base, capitalized].flatMap((stem) =>
            JS_EXTENSIONS.map((extension) => `${dir}/${stem}${extension}`),
          ),
        );
      }
    }
  }
  // Conventional unminified trees, published alongside a bundle.
  for (let dir of ['src', 'development', 'esm', 'es', 'module', 'lib']) {
    candidates.push(
      ...['index', 'main', base, capitalized].flatMap((stem) =>
        JS_EXTENSIONS.map((extension) => `${dir}/${stem}${extension}`),
      ),
    );
  }
  // Whatever the package itself declares, last: it usually points at the
  // bundle, which is the thing source mode exists to avoid.
  let declared: string[] = [];
  if (exportsField && typeof exportsField === 'object') {
    exportTargets((exportsField as Record<string, unknown>)['.'], declared);
  } else if (exportsField) {
    exportTargets(exportsField, declared);
  }
  for (let field of ['module', 'main']) {
    let value = json[field];
    if (typeof value === 'string') {
      declared.push(value);
    }
  }
  candidates.push(...declared.map((path) => path.replace(/^\.\//, '')));

  let unique: string[] = [];
  for (let candidate of candidates) {
    if (!unique.includes(candidate) && pkg.files.has(candidate)) {
      unique.push(candidate);
    }
  }
  return unique;
}

export interface EntryProbe {
  entry: string;
  modules: number;
  externals: number;
  unresolved: number;
  bytes: number;
}

// The one rule that needs no per-package configuration: count the modules
// reachable from a candidate. One means the boundary is gone; N means
// there is a tree to edit.
export function probeEntries(pkg: NpmPackage): EntryProbe[] {
  let probes: EntryProbe[] = [];
  for (let entry of candidateEntries(pkg)) {
    try {
      let graph = walkSourceGraph(pkg.files, entry);
      probes.push({
        entry,
        modules: graph.modules.length,
        externals: graph.externals.length,
        unresolved: graph.unresolved.length,
        bytes: graph.bytes,
      });
    } catch {
      // A candidate that blows a cap is not a candidate.
    }
  }
  return probes.sort(
    (a, b) =>
      b.modules - a.modules ||
      a.unresolved - b.unresolved ||
      a.entry.localeCompare(b.entry),
  );
}

export interface VendoredFrom {
  registry: string;
  name: string;
  version: string;
  integrity?: string;
  mode: 'source';
  entry: string;
  subtree?: string;
  repo?: string;
  commit?: string;
  hasProvenance?: boolean;
  repoVerified?: { matched: number; total: number };
}

export interface VendorSourceResult {
  files: { path: string; bytes: Buffer }[];
  entryPath: string;
  modules: { path: string; size: number }[];
  externals: string[];
  unresolved: string[];
  assets: string[];
  rewritten: string[];
  vendoredFrom: VendoredFrom;
  pkg: NpmPackage;
}

// The directory every module shares, if there is one. `src` for three —
// which is also the subtree to check against the repository.
export function commonSubtree(paths: string[]): string | undefined {
  if (paths.length === 0) {
    return undefined;
  }
  let split = paths.map((path) => path.split('/').slice(0, -1));
  let prefix = split[0];
  for (let segments of split.slice(1)) {
    let length = 0;
    while (
      length < prefix.length &&
      length < segments.length &&
      prefix[length] === segments[length]
    ) {
      length++;
    }
    prefix = prefix.slice(0, length);
    if (prefix.length === 0) {
      return undefined;
    }
  }
  return prefix.join('/') || undefined;
}

export interface VendorNpmOptions {
  spec: string;
  entry?: string;
  fetchImpl?: typeof fetch;
  registry?: string;
  allowExternal?: boolean;
  maxModules?: number;
  maxBytes?: number;
  pkg?: NpmPackage;
}

export async function vendorFromNpmSource(
  options: VendorNpmOptions,
): Promise<VendorSourceResult> {
  let {
    spec,
    entry,
    fetchImpl = fetch,
    registry,
    allowExternal = false,
    maxModules,
    maxBytes,
  } = options;
  let pkg =
    options.pkg ?? (await fetchNpmPackage({ spec, fetchImpl, registry }));

  let chosen = entry;
  if (!chosen) {
    let probes = probeEntries(pkg);
    if (probes.length === 0) {
      throw new Error(
        `vendor: no ES module entry found in ${pkg.name}@${pkg.version}`,
      );
    }
    if (probes[0].modules <= 1) {
      throw new Error(
        `vendor: ${pkg.name}@${pkg.version} publishes a bundle, not a module tree — best candidate ${probes[0].entry} reaches ${probes[0].modules} module(s). Vendor it in bundle mode, or reconstruct the tree from its source map.`,
      );
    }
    chosen = probes[0].entry;
  }

  let graph = walkSourceGraph(pkg.files, chosen, { maxModules, maxBytes });
  if (graph.unresolved.length > 0) {
    throw new Error(
      `vendor: ${graph.unresolved.length} relative reference(s) resolve to nothing: ${graph.unresolved.slice(0, 3).join(', ')}`,
    );
  }
  if (graph.externals.length > 0 && !allowExternal) {
    throw new Error(
      `vendor: ${graph.externals.length} reference(s) point outside the package, so it would not be hermetic: ${graph.externals.slice(0, 5).join(', ')} (pass --allow-external to keep them live, or vendor them as their own decks)`,
    );
  }

  // A specifier that already resolves as written is left exactly as
  // published — that is what keeps the tree byte-identical to the repo.
  let files: { path: string; bytes: Buffer }[] = [];
  let modules: { path: string; size: number }[] = [];
  let rewritten: string[] = [];
  for (let path of graph.modules) {
    if (!isValidTreePath(path)) {
      throw new Error(`vendor: ${path} is not a valid tree path`);
    }
    let original = pkg.files.get(path)!;
    let bytes = original;
    if (isParseable(path)) {
      let source = original.toString('utf8');
      let updated = source;
      for (let specifier of extractSpecifiers(source)) {
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
          continue;
        }
        let target = resolveRelative(path, specifier, pkg.files);
        if (!target || target === normalizeJoin(path, specifier)) {
          continue; // already complete as written
        }
        let replacement = posix.relative(posix.dirname(path), target);
        if (!replacement.startsWith('.')) {
          replacement = `./${replacement}`;
        }
        updated = updated
          .split(`'${specifier}'`)
          .join(`'${replacement}'`)
          .split(`"${specifier}"`)
          .join(`"${replacement}"`);
      }
      if (updated !== source) {
        rewritten.push(path);
        bytes = Buffer.from(updated, 'utf8');
      }
    }
    files.push({ path, bytes });
    modules.push({ path, size: bytes.length });
  }

  let repository = pkg.doc.repository;
  let directory =
    typeof repository === 'object' ? repository?.directory : undefined;
  let subtree = commonSubtree(graph.modules);
  let vendoredFrom: VendoredFrom = {
    registry: registry ?? 'https://registry.npmjs.org',
    name: pkg.name,
    version: pkg.version,
    integrity: pkg.doc.dist.integrity,
    mode: 'source',
    entry: chosen,
    ...(subtree ? { subtree } : {}),
    ...(repoUrlFor(pkg.doc)
      ? { repo: repoUrlFor(pkg.doc)! + (directory ? `/tree/HEAD/${directory}` : '') }
      : {}),
    ...(pkg.doc.gitHead ? { commit: pkg.doc.gitHead } : {}),
    ...(pkg.doc.dist.attestations ? { hasProvenance: true } : {}),
  };

  return {
    files,
    entryPath: chosen,
    modules,
    externals: graph.externals,
    unresolved: graph.unresolved,
    assets: graph.assets,
    rewritten,
    vendoredFrom,
    pkg,
  };
}

export { deckNameForNpm };
