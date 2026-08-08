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
// other). `@tanstack/query-core` therefore has to flatten.
export function deckNameForNpm(name: string): string {
  return name
    .replace(/^@/, '')
    .replace(/\//g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64);
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
