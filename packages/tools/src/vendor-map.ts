import { posix } from 'node:path';
import { isValidTreePath } from '@cardstack/deck/tree-hash';
import {
  fetchNpmPackage,
  fetchPublishTimes,
  judgeCooldown,
  normalizePolicy,
  repoUrlFor,
  type CooldownPolicy,
  type NpmPackage,
} from './npm.ts';
import { candidateEntries, type VendoredFrom } from './vendor-npm.ts';

// Map mode: getting a module tree back out of a bundle.
//
// Four of the thirteen packages the boxel cards import publish one built
// file and nothing else — chart.js, preact, marked, jszip. Source mode
// cannot help them: the boundary was destroyed at publish time, and npm
// holds no copy of what went in.
//
// The source map does. Every one of those bundles ships a `.map` carrying
// `sources` AND `sourcesContent` — the original paths and their full text —
// so the pre-bundle tree can be reconstructed exactly.
//
// The rule that must never be soft-pedalled: A RECONSTRUCTED TREE DOES NOT
// RUN. marked's sources are `.ts`. preact's rely on build-time
// substitutions. What you get is what the author wrote, which is right for
// reading, diffing and producing a pull request, and wrong for execution.
//
// That is enforced structurally rather than by documentation: a map-mode
// deck declares NO entry, so the server answers `no-entry-module` to anyone
// who tries to import it. The files are addressable; the package is not
// executable.

export interface SourceMap {
  version?: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
}

const DATA_URI = /^data:application\/json[^,]*;base64,(.+)$/;

// `//# sourceMappingURL=…` on the last non-empty line, or a sibling file.
export function sourceMappingUrl(source: string): string | undefined {
  let match = /[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/m.exec(source);
  return match?.[1];
}

export interface LocatedMap {
  // Where the map lives, so `sources` can be resolved relative to it.
  dir: string;
  map: SourceMap;
  from: string;
}

export function locateSourceMap(
  pkg: NpmPackage,
  entryPath: string,
): LocatedMap | undefined {
  let source = pkg.files.get(entryPath)?.toString('utf8') ?? '';
  let declared = sourceMappingUrl(source);
  let entryDir = posix.dirname(entryPath);

  if (declared) {
    let inline = DATA_URI.exec(declared);
    if (inline) {
      try {
        return {
          dir: entryDir,
          from: `${entryPath} (inline)`,
          map: JSON.parse(Buffer.from(inline[1], 'base64').toString('utf8')),
        };
      } catch {
        return undefined;
      }
    }
    if (!/^[a-z]+:/i.test(declared)) {
      let mapPath = posix.normalize(posix.join(entryDir, declared));
      let bytes = pkg.files.get(mapPath);
      if (bytes) {
        try {
          return {
            dir: posix.dirname(mapPath),
            from: mapPath,
            map: JSON.parse(bytes.toString('utf8')),
          };
        } catch {
          return undefined;
        }
      }
    }
  }
  // No comment, or it pointed somewhere absent: the conventional sibling.
  let sibling = `${entryPath}.map`;
  let bytes = pkg.files.get(sibling);
  if (!bytes) {
    return undefined;
  }
  try {
    return {
      dir: posix.dirname(sibling),
      from: sibling,
      map: JSON.parse(bytes.toString('utf8')),
    };
  } catch {
    return undefined;
  }
}

// A `sources` entry into a tree path.
//
// The common shape is `../src/core/x.js` relative to the map's directory,
// which resolves to the repository-relative path — the whole point, because
// that is what makes the reconstruction diffable against upstream. Bundlers
// also emit scheme-prefixed forms (`webpack://pkg/./src/x.js`), and paths
// that climb out of the package entirely.
export function sourceToTreePath(
  mapDir: string,
  sourceRoot: string | undefined,
  source: string,
): { path: string; escaped: boolean } {
  let resolved: string;

  let protocol = /^[a-z][a-z0-9+.-]*:\/\//i.exec(source);
  if (protocol) {
    // `webpack://<library>/./src/x.js` — the `/./` marks the project root,
    // so what follows is root-relative and must NOT be joined to the map's
    // directory. Without the marker, drop the library segment and treat the
    // rest the same way.
    let rest = source.slice(protocol[0].length);
    let marker = rest.indexOf('/./');
    resolved = posix.normalize(
      marker === -1 ? rest.split('/').slice(1).join('/') : rest.slice(marker + 3),
    );
  } else {
    let cleaned = source.replace(/^\.\//, '');
    if (sourceRoot) {
      cleaned = posix.join(sourceRoot, cleaned);
    }
    resolved = posix.normalize(posix.join(mapDir, cleaned));
  }

  let escaped = resolved.startsWith('..') || posix.isAbsolute(resolved);
  if (escaped) {
    // Keep it, but say so: a source outside the package is still worth
    // reading, and silently dropping files would make the tree a lie about
    // what the bundle was built from.
    resolved = posix.join(
      '_outside',
      resolved.replace(/^(\.\.\/)+/, '').replace(/^\//, ''),
    );
  }
  return { path: resolved, escaped };
}

export interface MapVendorResult {
  files: { path: string; bytes: Buffer }[];
  // Deliberately absent as an import entry; kept for the record.
  bundleEntry: string;
  mapFrom: string;
  modules: number;
  escaped: string[];
  missingContent: string[];
  vendoredFrom: VendoredFrom;
  pkg: NpmPackage;
}

export interface VendorMapOptions {
  spec: string;
  pkg?: NpmPackage;
  entry?: string;
  fetchImpl?: typeof fetch;
  registry?: string;
  policy?: Partial<CooldownPolicy>;
  now?: number;
  publishedAt?: string;
}

// Bundles that are themselves ES modules first: their sources are the real
// module tree, where a CJS or UMD bundle's may have been transformed on the
// way in.
function rankEntries(pkg: NpmPackage): string[] {
  let candidates = candidateEntries(pkg);
  let all = candidates.length > 0 ? candidates : [];
  for (let path of pkg.files.keys()) {
    if (/\.(m?js)$/.test(path) && pkg.files.has(`${path}.map`)) {
      if (!all.includes(path)) {
        all.push(path);
      }
    }
  }
  return all.sort((a, b) => score(b) - score(a));
  function score(path: string): number {
    let points = 0;
    if (/\.(esm|module|mjs)/.test(path)) points += 4;
    if (/\.min\./.test(path)) points -= 4;
    if (/umd|cjs/.test(path)) points -= 2;
    if (pkg.files.has(`${path}.map`)) points += 2;
    return points;
  }
}

export async function vendorFromSourceMap(
  options: VendorMapOptions,
): Promise<MapVendorResult> {
  let { spec, entry, fetchImpl = fetch, registry, now = Date.now() } = options;
  let policy = normalizePolicy(options.policy);
  let pkg =
    options.pkg ?? (await fetchNpmPackage({ spec, fetchImpl, registry }));

  let publishedAt = options.publishedAt;
  if (policy.minimumReleaseAge > 0 && publishedAt === undefined) {
    publishedAt = (
      await fetchPublishTimes({ name: pkg.name, fetchImpl, registry })
    )[pkg.version];
  }
  let cooldown = judgeCooldown({
    name: pkg.name,
    version: pkg.version,
    publishedAt,
    policy,
    now,
  });
  if (!cooldown.ok) {
    throw new Error(
      `vendor: cooldown refused ${pkg.name}@${pkg.version} — ${cooldown.reason}`,
    );
  }

  let located: LocatedMap | undefined;
  let chosen = entry;
  if (chosen) {
    located = locateSourceMap(pkg, chosen);
  } else {
    for (let candidate of rankEntries(pkg)) {
      located = locateSourceMap(pkg, candidate);
      if (located) {
        chosen = candidate;
        break;
      }
    }
  }
  if (!chosen || !located) {
    throw new Error(
      `vendor: ${pkg.name}@${pkg.version} ships no source map, so its module tree cannot be recovered — vendor it in bundle mode instead`,
    );
  }

  let { map, dir, from } = located;
  if (!Array.isArray(map.sources) || map.sources.length === 0) {
    throw new Error(`vendor: ${from} declares no sources`);
  }
  if (!Array.isArray(map.sourcesContent)) {
    throw new Error(
      `vendor: ${from} carries source paths but no sourcesContent, so the files themselves are not recoverable`,
    );
  }

  let files: { path: string; bytes: Buffer }[] = [];
  let escaped: string[] = [];
  let missingContent: string[] = [];
  let seen = new Set<string>();
  for (let index = 0; index < map.sources.length; index++) {
    let content = map.sourcesContent[index];
    if (typeof content !== 'string') {
      missingContent.push(map.sources[index]);
      continue;
    }
    let { path, escaped: didEscape } = sourceToTreePath(
      dir,
      map.sourceRoot,
      map.sources[index],
    );
    if (!isValidTreePath(path) || seen.has(path)) {
      missingContent.push(map.sources[index]);
      continue;
    }
    seen.add(path);
    if (didEscape) {
      escaped.push(map.sources[index]);
    }
    files.push({ path, bytes: Buffer.from(content, 'utf8') });
  }
  if (files.length === 0) {
    throw new Error(`vendor: ${from} yielded no recoverable sources`);
  }

  let directory =
    typeof pkg.doc.repository === 'object'
      ? pkg.doc.repository?.directory
      : undefined;
  let vendoredFrom: VendoredFrom = {
    registry: registry ?? 'https://registry.npmjs.org',
    name: pkg.name,
    version: pkg.version,
    integrity: pkg.doc.dist.integrity,
    // `mode` is what tells a reader these bytes were RECOVERED rather than
    // published — they are the author's source, not the artifact anyone ran.
    mode: 'map',
    entry: chosen,
    ...(repoUrlFor(pkg.doc)
      ? {
          repo:
            repoUrlFor(pkg.doc)! + (directory ? `/tree/HEAD/${directory}` : ''),
        }
      : {}),
    ...(pkg.doc.gitHead ? { commit: pkg.doc.gitHead } : {}),
    ...(cooldown.publishedAt ? { publishedAt: cooldown.publishedAt } : {}),
    minimumReleaseAge: policy.minimumReleaseAge,
    ...(cooldown.ageMinutes !== undefined
      ? { ageMinutesAtVendor: Math.floor(cooldown.ageMinutes) }
      : {}),
    ...(cooldown.excluded ? { cooldownExcluded: true } : {}),
  };

  return {
    files: files.sort((a, b) => (a.path < b.path ? -1 : 1)),
    bundleEntry: chosen,
    mapFrom: from,
    modules: files.length,
    escaped,
    missingContent,
    vendoredFrom,
    pkg,
  };
}

// The import map for a recovered tree. Note what is NOT here: an `entry`.
// Without one the server answers `no-entry-module`, so nothing can import
// this deck as a module — which is exactly the promise map mode can keep.
export function mapVendorImportMap(
  name: string,
  result: MapVendorResult,
): Buffer {
  return Buffer.from(
    JSON.stringify(
      {
        deck: {
          packages: {
            [name]: {
              sourceOnly: true,
              recoveredFrom: {
                bundle: result.bundleEntry,
                sourceMap: result.mapFrom,
              },
              vendoredFrom: result.vendoredFrom,
            },
          },
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}
