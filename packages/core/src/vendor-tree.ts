import semver from 'semver';
import {
  deckNameForNpm,
  fetchNpmPackage,
  fetchPublishTimes,
  newestAged,
  normalizePolicy,
  parseNpmSpec,
  type CooldownPolicy,
  type NpmPackage,
} from './npm.ts';
import {
  probeEntries,
  vendorFromNpmSource,
  walkSourceGraph,
  type VendoredFrom,
} from './vendor-npm.ts';
import { listStorePackages, readStoredPack } from './store.ts';
import { packagesFromPack } from './import-map.ts';

// Transitive vendoring.
//
// Probing the packages the boxel cards actually import showed that a single
// package is the exception, not the rule: tone needs standardized-audio-context
// and tslib, chrono-node needs dayjs, three-bvh-csg needs three and
// three-mesh-bvh. Hermetic-or-refuse therefore meant "refuse", and source
// mode was only usable on the handful of libraries with no dependencies.
//
// So a vendor walks the dependency graph, seals each package as its OWN deck,
// and wires the bare specifiers together with aliased dependency records:
//
//   "dependencies": { "three": "acme/three@0.160.0" }
//
// The key is the specifier the source writes; the value is the deck that
// answers to it. Nothing in the vendored bytes is rewritten, so the tree
// stays byte-identical to what npm published — which is what keeps it a
// verifiable checkout of the upstream repo.
//
// Deduplication is by npm identity: three-bvh-csg's `three` resolves to the
// three deck already in the store rather than sealing a second copy.

// Specifiers that name a build-time or framework virtual rather than a
// package you can fetch. Vendoring cannot make these resolvable, and
// pretending otherwise would seal a deck that cannot load.
const VIRTUAL_PREFIXES = ['node:', '@ember/', '@glimmer/', '@embroider/'];
const VIRTUAL_EXACT = new Set(['ember', 'require', 'rsvp']);

export function isVirtualSpecifier(specifier: string): boolean {
  return (
    VIRTUAL_EXACT.has(specifier) ||
    VIRTUAL_PREFIXES.some((prefix) => specifier.startsWith(prefix))
  );
}

export interface ParsedExternal {
  // The npm package the specifier names.
  name: string;
  // Anything after the package name: `plugin/quarterOfYear.js` for
  // `dayjs/plugin/quarterOfYear.js`. Empty for a bare package import.
  subpath: string;
}

export function parseExternal(specifier: string): ParsedExternal | undefined {
  if (specifier.startsWith('.') || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
    return undefined; // relative, or a URL/protocol specifier
  }
  let segments = specifier.split('/');
  let name = specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
  return { name, subpath: specifier.slice(name.length).replace(/^\//, '') };
}

function declaredRange(
  pkg: NpmPackage,
  name: string,
): string | undefined {
  for (let field of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    let record = pkg.packageJson[field] as
      | Record<string, string>
      | undefined;
    let range = record?.[name];
    if (typeof range === 'string') {
      return range;
    }
  }
  return undefined;
}

export interface StoredVendor {
  deck: string; // "<publisher>/<package>"
  version: string;
  npmName: string;
}

// What is already vendored here, by npm identity. This is what makes a
// second consumer of `three` a pointer instead of a second copy.
export async function inventoryVendored(
  storeDir: string,
): Promise<StoredVendor[]> {
  let found: StoredVendor[] = [];
  for (let meta of await listStorePackages(storeDir)) {
    for (let version of Object.keys(meta.versions)) {
      let bytes = await readStoredPack(storeDir, meta.name, version);
      if (!bytes) {
        continue;
      }
      let packages = packagesFromPack(bytes);
      let entry = packages?.[meta.name.split('/').at(-1)!];
      let vendoredFrom = entry?.vendoredFrom as
        | VendoredFrom
        | string
        | undefined;
      if (vendoredFrom && typeof vendoredFrom === 'object') {
        found.push({
          deck: meta.name,
          version,
          npmName: vendoredFrom.name,
        });
      }
    }
  }
  return found;
}

export interface VendorTreeOptions {
  spec: string;
  publisher: string;
  storeDir: string;
  fetchImpl?: typeof fetch;
  registry?: string;
  policy?: Partial<CooldownPolicy>;
  now?: number;
  // How deep to follow dependencies. 0 vendors only the named package.
  maxDepth?: number;
  // Keep unresolvable specifiers (framework virtuals) live instead of
  // failing. They will not load, but the rest of the graph seals.
  allowExternal?: boolean;
  // Reuse decks already in the store when the npm identity matches.
  reuse?: boolean;
}

export interface VendoredUnit {
  deck: string;
  npmName: string;
  version: string;
  entry: string;
  modules: number;
  files: { path: string; bytes: Buffer }[];
  // Bare specifier → "<publisher>/<deck>@<version>", the aliased records
  // this unit's import map declares.
  dependencies: Record<string, string>;
  // Subpaths consumers asked for, as `./<subpath>` → tree path.
  exports: Record<string, string>;
  vendoredFrom: VendoredFrom;
  reused: boolean;
  depth: number;
}

export interface VendorTreePlan {
  root: string;
  units: VendoredUnit[];
  // Specifiers nothing can resolve: framework virtuals, node builtins.
  unresolvable: { from: string; specifier: string; reason: string }[];
  // Packages that publish no module tree; they need bundle or map mode.
  bundleOnly: { npmName: string; from: string; detail: string }[];
  // Sealed, but not loadable as ES modules by a browser.
  notEsm: { npmName: string; entry: string }[];
}

// A single-file dependency is normal — tslib is one module of helpers. What
// is NOT usable is a file that speaks CommonJS, because no import map can
// make `require` exist in a browser.
export function looksCommonJs(source: string): boolean {
  let hasEsm = /(^|[\s;}])(?:import|export)[\s{*]/.test(source);
  let hasCjs = /(^|[\s;=(])(?:require\s*\(|module\.exports|exports\.)/.test(
    source,
  );
  return hasCjs && !hasEsm;
}

async function resolveVersion(options: {
  name: string;
  range: string;
  fetchImpl: typeof fetch;
  registry?: string;
  policy: CooldownPolicy;
  now: number;
  // Already-vendored versions of this package, preferred over anything new.
  prefer?: string[];
}): Promise<string> {
  let { name, range, fetchImpl, registry, policy, now, prefer = [] } =
    options;
  if (semver.valid(range) === range) {
    return range;
  }
  // Prefer what is already here. three-bvh-csg's peer range on `three` is
  // satisfied by the three the cards already pin, and taking the newest
  // release instead would seal a second 388-module copy of the same library
  // and give the app two incompatible `three`s at once. Reuse is not only a
  // disk saving — for a peer dependency it is the difference between working
  // and not.
  let reusable = prefer.filter(
    (version) =>
      semver.valid(version) &&
      (range === 'latest' || range === '*'
        ? true
        : semver.satisfies(version, range)),
  );
  if (reusable.length > 0) {
    return reusable.sort(semver.compare).at(-1)!;
  }
  let times = await fetchPublishTimes({ name, fetchImpl, registry });
  let published = Object.keys(times).filter(
    (key) => semver.valid(key) === key,
  );
  let matching =
    range === 'latest' || range === '*'
      ? published.filter((version) => semver.prerelease(version) === null)
      : published.filter(
          (version) =>
            semver.prerelease(version) === null &&
            semver.satisfies(version, range),
        );
  if (matching.length === 0) {
    throw new Error(`vendor: no published version of ${name} satisfies ${range}`);
  }
  // The cooldown is applied at RESOLUTION, not only as a veto: a range
  // picks the newest version that is old enough, rather than picking the
  // newest and then failing.
  let chosen = newestAged(name, times, matching, policy, now);
  if (!chosen) {
    throw new Error(
      `vendor: every version of ${name} satisfying ${range} is younger than the policy's ${policy.minimumReleaseAge} minute minimum release age`,
    );
  }
  return chosen;
}

export async function planVendorTree(
  options: VendorTreeOptions,
): Promise<VendorTreePlan> {
  let {
    spec,
    publisher,
    storeDir,
    fetchImpl = fetch,
    registry,
    now = Date.now(),
    maxDepth = 4,
    allowExternal = false,
    reuse = true,
  } = options;

  let policy = normalizePolicy(options.policy);
  let existing = reuse ? await inventoryVendored(storeDir) : [];
  let units = new Map<string, VendoredUnit>();
  let unresolvable: VendorTreePlan['unresolvable'] = [];
  let bundleOnly: VendorTreePlan['bundleOnly'] = [];
  let notEsm: VendorTreePlan['notEsm'] = [];
  let queue: { spec: string; depth: number; from: string }[] = [
    { spec, depth: 0, from: '(root)' },
  ];
  // Subpaths consumers ask for, so a dependency is sealed with the files
  // they actually import and not only the ones its own entry reaches.
  let requestedSubpaths = new Map<string, Set<string>>();
  let rootDeck = '';

  while (queue.length > 0) {
    let job = queue.shift()!;
    let { name, range } = parseNpmSpec(job.spec);
    if (units.has(name)) {
      continue;
    }
    let version = await resolveVersion({
      name,
      range,
      fetchImpl,
      registry,
      policy,
      now,
      prefer: [
        ...existing
          .filter((candidate) => candidate.npmName === name)
          .map((candidate) => candidate.version),
        ...[...units.values()]
          .filter((unit) => unit.npmName === name)
          .map((unit) => unit.version),
      ],
    });
    let reusedHit = existing.find(
      (candidate) =>
        candidate.npmName === name && candidate.version === version,
    );

    let pkg = await fetchNpmPackage({
      spec: `${name}@${version}`,
      fetchImpl,
      registry,
    });
    let probes = probeEntries(pkg);
    // The root was asked for as an EDITABLE tree, so one module means the
    // boundary was lost at publish time and the request cannot be met. A
    // dependency has no such promise to keep: it only has to seal and load,
    // and plenty of real packages are legitimately one file.
    if (probes.length === 0 || (job.depth === 0 && probes[0].modules <= 1)) {
      bundleOnly.push({
        npmName: name,
        from: job.from,
        detail:
          probes.length === 0
            ? 'no ES module entry'
            : `best candidate ${probes[0].entry} reaches 1 module`,
      });
      continue;
    }
    // The check has to cover the whole graph, not just the entry.
    // highlight.js publishes `es/index.js`, which is real ESM — and which
    // imports `../lib/index.js`, which is CommonJS. The entry looks fine
    // and the deck does not load.
    let cjsModule = walkSourceGraph(pkg.files, probes[0].entry).modules.find(
      (module) => looksCommonJs(pkg.files.get(module)?.toString('utf8') ?? ''),
    );
    if (cjsModule) {
      notEsm.push({ npmName: name, entry: cjsModule });
    }

    let graph = walkSourceGraph(pkg.files, probes[0].entry);
    let dependencies: Record<string, string> = {};
    for (let specifier of graph.externals) {
      let parsed = parseExternal(specifier);
      if (!parsed || isVirtualSpecifier(specifier)) {
        unresolvable.push({
          from: `${name}@${version}`,
          specifier,
          reason: isVirtualSpecifier(specifier)
            ? 'a build-time or framework virtual, not a fetchable package'
            : 'not a package specifier',
        });
        continue;
      }
      if (parsed.subpath) {
        let set = requestedSubpaths.get(parsed.name) ?? new Set<string>();
        set.add(parsed.subpath);
        requestedSubpaths.set(parsed.name, set);
      }
      if (parsed.name === name) {
        // A package importing itself by name; the trailing-slash mapping
        // of its own deck covers it.
        dependencies[parsed.name] = `${publisher}/${deckNameForNpm(name)}@SELF`;
        continue;
      }
      let childRange = declaredRange(pkg, parsed.name) ?? 'latest';
      dependencies[parsed.name] = `PENDING:${parsed.name}@${childRange}`;
      if (job.depth < maxDepth) {
        queue.push({
          spec: `${parsed.name}@${childRange}`,
          depth: job.depth + 1,
          from: `${name}@${version}`,
        });
      } else {
        unresolvable.push({
          from: `${name}@${version}`,
          specifier,
          reason: `dependency depth cap (${maxDepth}) reached`,
        });
      }
    }

    let sealed = await vendorFromNpmSource({
      spec: `${name}@${version}`,
      pkg,
      entry: probes[0].entry,
      extraEntries: [...(requestedSubpaths.get(name) ?? [])],
      allowExternal: true, // externals become dependency records, not errors
      policy: { minimumReleaseAge: 0 }, // already judged at resolution
      now,
    });
    let deck = `${publisher}/${deckNameForNpm(name)}`;
    if (job.depth === 0) {
      rootDeck = deck;
    }
    units.set(name, {
      deck,
      npmName: name,
      version,
      entry: sealed.entryPath,
      modules: sealed.modules.length,
      files: sealed.files,
      dependencies,
      exports: Object.fromEntries(
        Object.entries(sealed.subpathEntries).map(([subpath, treePath]) => [
          `./${subpath}`,
          `$REALM/${treePath}`,
        ]),
      ),
      vendoredFrom: sealed.vendoredFrom,
      reused: Boolean(reusedHit),
      depth: job.depth,
    });
  }

  // Second pass: PENDING placeholders become real deck references now that
  // every version in the graph is known.
  for (let unit of units.values()) {
    for (let [specifier, value] of Object.entries(unit.dependencies)) {
      if (value.endsWith('@SELF')) {
        unit.dependencies[specifier] = `${unit.deck}@${unit.version}`;
        continue;
      }
      if (!value.startsWith('PENDING:')) {
        continue;
      }
      let childName = parseNpmSpec(value.slice('PENDING:'.length)).name;
      let child = units.get(childName);
      if (child) {
        unit.dependencies[specifier] = `${child.deck}@${child.version}`;
      } else {
        delete unit.dependencies[specifier];
        unresolvable.push({
          from: `${unit.npmName}@${unit.version}`,
          specifier,
          reason: 'the dependency could not be vendored (see bundle-only)',
        });
      }
    }
  }

  if (notEsm.length > 0 && !allowExternal) {
    throw new Error(
      `vendor: ${notEsm.map((item) => item.npmName).join(', ')} is CommonJS at ${notEsm[0].entry}; a browser cannot load it and no import map can fix that (pass --allow-external to seal it anyway)`,
    );
  }
  if (unresolvable.length > 0 && !allowExternal) {
    let sample = unresolvable
      .slice(0, 5)
      .map((item) => `${item.specifier} (${item.reason})`)
      .join(', ');
    throw new Error(
      `vendor: ${unresolvable.length} specifier(s) cannot be resolved to a deck: ${sample}${unresolvable.length > 5 ? ', …' : ''} (pass --allow-external to seal anyway; they will not load)`,
    );
  }

  return {
    root: rootDeck,
    units: [...units.values()].sort((a, b) => a.depth - b.depth),
    unresolvable,
    bundleOnly,
    notEsm,
  };
}

// The import map a vendored unit declares: its own package entry, its
// aliased dependency records, and the provenance that makes it auditable.
export function vendorUnitImportMap(unit: VendoredUnit): Buffer {
  let name = unit.deck.split('/').at(-1)!;
  return Buffer.from(
    JSON.stringify(
      {
        imports: {},
        deck: {
          packages: {
            [name]: {
              version: unit.version,
              entry: `$REALM/${unit.entry}`,
              ...(Object.keys(unit.exports).length > 0
                ? { exports: unit.exports }
                : {}),
              vendoredFrom: unit.vendoredFrom,
            },
          },
          ...(Object.keys(unit.dependencies).length > 0
            ? { dependencies: unit.dependencies }
            : {}),
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}
