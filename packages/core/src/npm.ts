import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

// The npm carriage layer.
//
// esm.sh gives a browser one fast bundle, which is exactly what a consumer
// wants and exactly what an editor cannot use: the module boundary is gone
// by the time the bytes leave the CDN. The npm tarball still has it. For
// three@0.160.0 the published `src/` is 374 ES modules with relative,
// extension-complete imports and no bare specifiers — loadable by a
// browser with no rewriting, and byte-identical to the GitHub tree at the
// commit npm recorded in `gitHead`.
//
// So this module fetches the tarball rather than N files: one request, one
// integrity hash, the whole package.

export const NPM_REGISTRY = 'https://registry.npmjs.org';

export interface NpmSpec {
  name: string;
  range: string;
}

// `three@0.160.0`, `three`, `@scope/pkg@1.2.3`. The leading `@` of a scope
// is not a version separator, so the search starts after it.
export function parseNpmSpec(spec: string): NpmSpec {
  let scoped = spec.startsWith('@');
  let at = spec.indexOf('@', scoped ? 1 : 0);
  if (at === -1) {
    return { name: spec, range: 'latest' };
  }
  return { name: spec.slice(0, at), range: spec.slice(at + 1) || 'latest' };
}

// A deck package name is one lowercase segment (the publisher supplies the
// other), so `@tanstack/query-core` has to flatten. Flattening npm's
// namespace into `[a-z0-9-]` is necessarily lossy, and a lossy map is not
// injective: `@babel/runtime` and `babel-runtime` are both real packages and
// both fold to `babel-runtime`, as do `three.js` and `three-js`.
//
// That matters because a deck name is a RESOLUTION KEY. Two upstreams under
// one name means a range picks between versions of two different libraries,
// which breaks L7. Per-version provenance stays truthful throughout, so L8
// never notices.
//
// The fix here is Nix's, not Debian's. Debian's answer to a flat namespace
// is a central authority refusing collisions at registration; Deck is
// federated and has no such authority, so refusal can only fire late — in
// somebody's depot, at publish time. Nix's answer is `<hash>-<name>`: the
// name is decoration and identity lives elsewhere, which Deck already
// believes, since L1 makes identity the treeHash.
//
// Applied selectively, because most names lose nothing:
//
//   lodash                -> lodash                     (fold is identity)
//   babel-runtime         -> babel-runtime              (fold is identity)
//   @babel/runtime        -> babel-runtime-<h>          (scope dropped)
//   three.js              -> three-js-<h>               (dot folded)
//   @tanstack/query-core  -> tanstack-query-core-<h>
//
// The digest is over the TRUE npm name, so it separates exactly the names
// the fold conflated. Six hex characters rather than four: a collision needs
// the same fold AND the same prefix, and fold buckets hold two or three
// names, so this is margin on an already small number. Whatever is left is
// caught by the store's one-deck-one-upstream check — which also covers the
// case no derivation can, a hand-passed `--name`.

const NAME_DIGEST_LENGTH = 6;
// The 64-character segment cap, less the digest and its separator.
const NAME_BUDGET = 64 - NAME_DIGEST_LENGTH - 1;

function foldNpmName(name: string): string {
  return name
    .replace(/^@/, '')
    .replace(/\//g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+/, '');
}

export function deckNameForNpm(name: string): string {
  let folded = foldNpmName(name);
  // Lossless means the fold changed nothing AND the result fits. Truncation
  // loses information too, which is why the length belongs in this test
  // rather than in a `slice` applied afterwards to whatever came out.
  if (folded === name && folded.length <= 64) {
    return folded;
  }
  let digest = createHash('sha256')
    .update(name, 'utf8')
    .digest('hex')
    .slice(0, NAME_DIGEST_LENGTH);
  // `|| 'npm'` keeps the segment alnum-led for a name that folds away
  // entirely; trailing hyphens go so the join never doubles them.
  let base = folded.slice(0, NAME_BUDGET).replace(/-+$/, '') || 'npm';
  return `${base}-${digest}`;
}

export interface NpmVersionDoc {
  name: string;
  version: string;
  type?: string;
  main?: string;
  module?: string;
  exports?: unknown;
  gitHead?: string;
  repository?: { url?: string; type?: string; directory?: string } | string;
  dist: {
    tarball: string;
    integrity?: string;
    shasum?: string;
    fileCount?: number;
    unpackedSize?: number;
    attestations?: { url?: string; provenance?: unknown };
  };
}

export async function fetchVersionDoc(options: {
  spec: string;
  fetchImpl?: typeof fetch;
  registry?: string;
}): Promise<NpmVersionDoc> {
  let { spec, fetchImpl = fetch, registry = NPM_REGISTRY } = options;
  let { name, range } = parseNpmSpec(spec);
  // The registry resolves an exact version or a dist-tag for us; a real
  // range would need a full packument, which is the one case we refuse
  // rather than half-implement.
  let url = `${registry}/${encodeURIComponent(name).replace('%40', '@')}/${encodeURIComponent(range)}`;
  let response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `npm: ${response.status} resolving ${name}@${range} (${url}) — exact versions and dist-tags only`,
    );
  }
  let doc = (await response.json()) as NpmVersionDoc;
  if (!doc?.dist?.tarball) {
    throw new Error(`npm: ${name}@${range} has no tarball`);
  }
  return doc;
}

// `sha512-<base64>` as npm writes it. A tarball that does not match is not
// the tarball the registry described, and vendoring it would seal bytes
// nobody approved.
export function verifyIntegrity(bytes: Buffer, integrity: string): void {
  let [algorithm, expected] = integrity.split('-');
  if (!algorithm || !expected) {
    throw new Error(`npm: unparsable integrity "${integrity}"`);
  }
  let actual = createHash(algorithm).update(bytes).digest('base64');
  if (actual !== expected) {
    throw new Error(
      `npm: integrity mismatch — expected ${algorithm}-${expected}, got ${algorithm}-${actual}`,
    );
  }
}

const BLOCK = 512;

function readString(block: Buffer, offset: number, length: number): string {
  let end = block.indexOf(0, offset);
  let stop =
    end === -1 || end > offset + length ? offset + length : Math.max(end, offset);
  return block.toString('utf8', offset, stop);
}

function readOctal(block: Buffer, offset: number, length: number): number {
  let raw = readString(block, offset, length).trim();
  if (raw === '') {
    return 0;
  }
  return parseInt(raw, 8) || 0;
}

// A tar reader for exactly the tars npm produces: ustar, with GNU long
// names and pax extended headers handled because scoped packages and deep
// example trees do overflow the 100-byte name field.
export function readTar(buffer: Buffer): Map<string, Buffer> {
  let files = new Map<string, Buffer>();
  let offset = 0;
  let longName: string | undefined;
  let paxPath: string | undefined;

  while (offset + BLOCK <= buffer.length) {
    let header = buffer.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) {
      break; // end-of-archive marker
    }
    let name = readString(header, 0, 100);
    let size = readOctal(header, 124, 12);
    let typeFlag = String.fromCharCode(header[156] || 0x30);
    let prefix = readString(header, 345, 155);
    if (prefix) {
      name = `${prefix}/${name}`;
    }
    let dataStart = offset + BLOCK;
    let data = buffer.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (typeFlag === 'L') {
      longName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (typeFlag === 'x' || typeFlag === 'X') {
      let match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      paxPath = match?.[1];
      continue;
    }
    if (typeFlag === 'g') {
      continue; // global pax header: not per-entry, ignore
    }
    let resolved = paxPath ?? longName ?? name;
    longName = undefined;
    paxPath = undefined;
    if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '') {
      files.set(resolved, Buffer.from(data));
    }
    // Directories, links and devices carry nothing a deck can hold.
  }
  return files;
}

export interface NpmPackage {
  name: string;
  version: string;
  doc: NpmVersionDoc;
  // Keyed by path with the tarball's `package/` prefix stripped, so the
  // keys are the paths the repository uses.
  files: Map<string, Buffer>;
  packageJson: Record<string, unknown>;
}

export async function fetchNpmPackage(options: {
  spec: string;
  fetchImpl?: typeof fetch;
  registry?: string;
  maxBytes?: number;
}): Promise<NpmPackage> {
  let {
    spec,
    fetchImpl = fetch,
    registry = NPM_REGISTRY,
    maxBytes = 128 * 1024 * 1024,
  } = options;
  let doc = await fetchVersionDoc({ spec, fetchImpl, registry });
  let response = await fetchImpl(doc.dist.tarball, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(
      `npm: ${response.status} fetching ${doc.dist.tarball}`,
    );
  }
  let gz = Buffer.from(await response.arrayBuffer());
  if (gz.length > maxBytes) {
    throw new Error(`npm: tarball exceeds byte cap (${maxBytes})`);
  }
  if (doc.dist.integrity) {
    verifyIntegrity(gz, doc.dist.integrity);
  }
  let files = new Map<string, Buffer>();
  for (let [path, bytes] of readTar(gunzipSync(gz))) {
    // Every npm tarball roots at a single directory, conventionally
    // `package/`. Strip whatever it is so the keys match the repo.
    let slash = path.indexOf('/');
    if (slash === -1) {
      continue;
    }
    files.set(path.slice(slash + 1), bytes);
  }
  let manifest = files.get('package.json');
  return {
    name: doc.name,
    version: doc.version,
    doc,
    files,
    packageJson: manifest
      ? (JSON.parse(manifest.toString('utf8')) as Record<string, unknown>)
      : {},
  };
}

// git's object id for a blob: sha1("blob <length>\0" + content). Computing
// it locally is what turns npm's `gitHead` claim into a checked fact.
export function gitBlobSha(bytes: Buffer): string {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

export function repoUrlFor(doc: NpmVersionDoc): string | undefined {
  let repository = doc.repository;
  let raw =
    typeof repository === 'string' ? repository : repository?.url;
  if (!raw) {
    return undefined;
  }
  let cleaned = raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
  return /^https?:\/\//.test(cleaned) ? cleaned : undefined;
}

export interface RepoVerification {
  repo: string;
  commit: string;
  subtree: string;
  matched: number;
  total: number;
  differing: string[];
  missing: string[];
}

// Compare a vendored subtree against the GitHub tree at the commit npm
// recorded. One API call plus a SHA-1 per file; if every blob matches,
// the vendored deck IS a checkout, and an edit to it is a diff against a
// known upstream commit.
export async function verifyAgainstGithubTree(options: {
  repo: string;
  commit: string;
  subtree: string;
  files: Map<string, Buffer>;
  fetchImpl?: typeof fetch;
}): Promise<RepoVerification> {
  let { repo, commit, subtree, files, fetchImpl = fetch } = options;
  let match = /github\.com\/([^/]+)\/([^/]+)/.exec(repo);
  if (!match) {
    throw new Error(`verify: not a GitHub repository url: ${repo}`);
  }
  let [, owner, name] = match;
  let ref = subtree ? `${commit}:${subtree}` : commit;
  let url = `https://api.github.com/repos/${owner}/${name}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  let response = await fetchImpl(url, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(`verify: ${response.status} reading ${url}`);
  }
  let tree = (await response.json()) as {
    truncated?: boolean;
    tree?: { path: string; type: string; sha: string }[];
  };
  if (tree.truncated) {
    throw new Error(
      `verify: GitHub truncated the tree for ${ref}; cannot verify completely`,
    );
  }
  let matched = 0;
  let differing: string[] = [];
  let missing: string[] = [];
  let blobs = (tree.tree ?? []).filter((entry) => entry.type === 'blob');
  for (let entry of blobs) {
    let local = files.get(subtree ? `${subtree}/${entry.path}` : entry.path);
    if (!local) {
      missing.push(entry.path);
      continue;
    }
    if (gitBlobSha(local) === entry.sha) {
      matched++;
    } else {
      differing.push(entry.path);
    }
  }
  return {
    repo,
    commit,
    subtree,
    matched,
    total: blobs.length,
    differing,
    missing,
  };
}

// The cooldown policy.
//
// Most registry supply-chain attacks are caught within days: a compromised
// maintainer account publishes a malicious patch, and it is yanked once
// somebody notices. A consumer who refuses anything published in the last N
// minutes misses almost the entire blast radius, at the cost of being N
// minutes behind — which, for a dependency you pin anyway, costs nothing.
//
// The vocabulary is pnpm's, deliberately: `minimumReleaseAge` in MINUTES and
// `minimumReleaseAgeExclude`, the same two settings the boxel monorepo
// already carries in pnpm-workspace.yaml (1440, with two @glint packages
// excluded). A depot's policy is therefore copy-pasteable from the
// workspace it serves, and means the same thing on both sides.
//
// npm's registry has no such gate, so it lives here, at the moment bytes
// enter the store. Only the FULL packument carries per-version publish
// times — the abbreviated one does not — so this costs one extra fetch per
// package and is worth it.

// Minutes. Matches pnpm-workspace.yaml in the boxel monorepo.
export const DEFAULT_MINIMUM_RELEASE_AGE = 1440;
const MINUTE_MS = 60_000;

export interface CooldownPolicy {
  // Minutes a version must have existed before it may be vendored. 0 is off.
  minimumReleaseAge: number;
  // Package names exempt from the gate.
  minimumReleaseAgeExclude: string[];
}

export function normalizePolicy(
  partial: Partial<CooldownPolicy> | undefined,
): CooldownPolicy {
  return {
    minimumReleaseAge:
      partial?.minimumReleaseAge ?? DEFAULT_MINIMUM_RELEASE_AGE,
    minimumReleaseAgeExclude: partial?.minimumReleaseAgeExclude ?? [],
  };
}

const packumentCache = new Map<string, Record<string, string>>();

export async function fetchPublishTimes(options: {
  name: string;
  fetchImpl?: typeof fetch;
  registry?: string;
}): Promise<Record<string, string>> {
  let { name, fetchImpl = fetch, registry = NPM_REGISTRY } = options;
  let key = `${registry}/${name}`;
  let hit = packumentCache.get(key);
  if (hit) {
    return hit;
  }
  let url = `${registry}/${encodeURIComponent(name).replace('%40', '@')}`;
  let response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`npm: ${response.status} reading publish times for ${name}`);
  }
  let doc = (await response.json()) as { time?: Record<string, string> };
  let time = doc.time ?? {};
  packumentCache.set(key, time);
  return time;
}

export interface CooldownVerdict {
  name: string;
  version: string;
  publishedAt?: string;
  ageMinutes?: number;
  minimumReleaseAge: number;
  ok: boolean;
  excluded?: boolean;
  reason?: string;
}

function describeMinutes(minutes: number): string {
  if (minutes >= 1440) {
    return `${(minutes / 1440).toFixed(minutes % 1440 === 0 ? 0 : 1)} day(s)`;
  }
  if (minutes >= 60) {
    return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)} hour(s)`;
  }
  return `${Math.round(minutes)} minute(s)`;
}

export function judgeCooldown(options: {
  name: string;
  version: string;
  publishedAt: string | undefined;
  policy: CooldownPolicy;
  now: number;
}): CooldownVerdict {
  let { name, version, publishedAt, policy, now } = options;
  let { minimumReleaseAge } = policy;
  let base = { name, version, publishedAt, minimumReleaseAge };
  if (minimumReleaseAge <= 0) {
    return { ...base, ok: true };
  }
  if (policy.minimumReleaseAgeExclude.includes(name)) {
    return { ...base, ok: true, excluded: true };
  }
  if (!publishedAt) {
    // Fail closed: an unknown age is not a safe age.
    return {
      ...base,
      ok: false,
      reason: `the registry reports no publish time for ${version}, so its age cannot be checked`,
    };
  }
  let ageMinutes = (now - Date.parse(publishedAt)) / MINUTE_MS;
  if (Number.isNaN(ageMinutes)) {
    return {
      ...base,
      ok: false,
      reason: `unparsable publish time "${publishedAt}"`,
    };
  }
  return {
    ...base,
    ageMinutes,
    ok: ageMinutes >= minimumReleaseAge,
    reason:
      ageMinutes >= minimumReleaseAge
        ? undefined
        : `published ${describeMinutes(ageMinutes)} ago; policy requires ${describeMinutes(minimumReleaseAge)}`,
  };
}

// The newest version of a package that satisfies the cooldown — what you
// want when a range would otherwise pick something too fresh.
export function newestAged(
  name: string,
  times: Record<string, string>,
  candidates: string[],
  policy: CooldownPolicy,
  now: number,
): string | undefined {
  let aged = candidates.filter(
    (version) =>
      judgeCooldown({
        name,
        version,
        publishedAt: times[version],
        policy,
        now,
      }).ok,
  );
  return aged.sort((a, b) => Date.parse(times[a]) - Date.parse(times[b])).at(-1);
}

// A depot carries its own policy, so the gate is a property of the place
// bytes land rather than of whoever typed the command. The file is the same
// two keys pnpm uses, so it can be lifted straight out of a
// pnpm-workspace.yaml:
//
//   <depot>/.deck/policy.json
//   { "minimumReleaseAge": 1440, "minimumReleaseAgeExclude": ["@glint/template"] }
export const POLICY_FILE = 'policy.json';

export function parsePolicy(text: string): Partial<CooldownPolicy> {
  let parsed = JSON.parse(text) as Record<string, unknown>;
  let policy: Partial<CooldownPolicy> = {};
  if (typeof parsed.minimumReleaseAge === 'number') {
    policy.minimumReleaseAge = parsed.minimumReleaseAge;
  }
  if (Array.isArray(parsed.minimumReleaseAgeExclude)) {
    policy.minimumReleaseAgeExclude = parsed.minimumReleaseAgeExclude.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }
  return policy;
}
