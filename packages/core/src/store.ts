import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { unpack } from './pack.ts';

// A Deck store is pure at-rest state on disk — the standalone counterpart
// of the realm's bookmarks. The server only READS it; all writes go through
// the CLI (an agent arranges state; distribution follows).
//
//   <store>/<name>/<version>.pack.zip     — the sealed deck, faithful pack
//   <store>/<name>/meta.json              — versions + dist-tags
//
// Invariants (the registry's at-rest coherence rules):
//   - published versions are immutable: publishing an existing version
//     refuses; the meta update is atomic (tmp+rename)
//   - only verified packs enter the store (full unpack verification)
//   - dist-tags are movable; names must never be semver-shaped;
//     `latest` may not point at a prerelease

export interface StoreMeta {
  name: string;
  versions: Record<string, { treeHash: string; file: string }>;
  tags: Record<string, string>;
}

const PACKAGE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function isValidPackageName(name: string): boolean {
  return PACKAGE_NAME.test(name);
}

const DIST_TAG = /^[a-z][a-z0-9-]{0,31}$/;
export function isValidDistTag(tag: string): boolean {
  return (
    DIST_TAG.test(tag) &&
    semver.valid(tag) === null &&
    semver.validRange(tag) === null
  );
}

function metaPath(storeDir: string, name: string): string {
  return join(storeDir, name, 'meta.json');
}

export async function readStoreMeta(
  storeDir: string,
  name: string,
): Promise<StoreMeta | undefined> {
  if (!isValidPackageName(name)) {
    return undefined;
  }
  try {
    let parsed = JSON.parse(await readFile(metaPath(storeDir, name), 'utf8'));
    return {
      name,
      versions: parsed.versions ?? {},
      tags: parsed.tags ?? {},
    };
  } catch {
    return undefined;
  }
}

async function writeStoreMeta(
  storeDir: string,
  meta: StoreMeta,
): Promise<void> {
  let path = metaPath(storeDir, meta.name);
  let tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(meta, null, 2) + '\n');
  await rename(tmp, path);
}

export async function publishToStore(
  storeDir: string,
  name: string,
  version: string,
  packBytes: Buffer,
  options: { tag?: string } = {},
): Promise<{ treeHash: string; file: string }> {
  if (!isValidPackageName(name)) {
    throw new Error(`invalid package name: ${JSON.stringify(name)}`);
  }
  if (semver.valid(version) !== version) {
    throw new Error(`not an exact canonical semver version: ${version}`);
  }
  let { tag } = options;
  if (tag !== undefined && !isValidDistTag(tag)) {
    throw new Error(
      `"${tag}" is not a valid dist-tag (lowercase, not semver-shaped)`,
    );
  }
  if (tag === 'latest' && semver.prerelease(version) !== null) {
    throw new Error(`latest may only point at a stable release`);
  }
  // Only verified packs enter the store.
  let { treeHash } = unpack(packBytes);
  let meta = (await readStoreMeta(storeDir, name)) ?? {
    name,
    versions: {},
    tags: {},
  };
  if (meta.versions[version]) {
    throw new Error(`version already published: ${name}@${version}`);
  }
  let file = `${version}.pack.zip`;
  await mkdir(join(storeDir, name), { recursive: true });
  await writeFile(join(storeDir, name, file), packBytes);
  meta.versions[version] = { treeHash, file };
  if (tag) {
    meta.tags[tag] = version;
  }
  await writeStoreMeta(storeDir, meta);
  return { treeHash, file };
}

export async function setDistTag(
  storeDir: string,
  name: string,
  tag: string,
  version: string,
): Promise<void> {
  if (!isValidDistTag(tag)) {
    throw new Error(
      `"${tag}" is not a valid dist-tag (lowercase, not semver-shaped)`,
    );
  }
  let meta = await readStoreMeta(storeDir, name);
  if (!meta || !meta.versions[version]) {
    throw new Error(`${name}@${version} is not a published version`);
  }
  if (tag === 'latest' && semver.prerelease(version) !== null) {
    throw new Error(`latest may only point at a stable release`);
  }
  meta.tags[tag] = version;
  await writeStoreMeta(storeDir, meta);
}

export type SpecResolution =
  | { kind: 'exact'; version: string }
  | { kind: 'redirect'; version: string }
  | { kind: 'not-found'; detail: string }
  | { kind: 'invalid'; detail: string };

// Identical semantics to the realm-server implementation: exact before
// range (so an exact prerelease matches directly), tags before ranges,
// npm prerelease exclusion, and the invalid-vs-not-found permanence split.
export function resolveVersionSpec(
  spec: string,
  meta: StoreMeta,
): SpecResolution {
  let versions = Object.keys(meta.versions);
  if (semver.valid(spec) === spec) {
    return versions.includes(spec)
      ? { kind: 'exact', version: spec }
      : { kind: 'not-found', detail: `${spec} is not a published version` };
  }
  let tagged = meta.tags[spec];
  if (tagged) {
    return { kind: 'redirect', version: tagged };
  }
  if (semver.validRange(spec)) {
    let best = semver.maxSatisfying(versions, spec);
    return best
      ? { kind: 'redirect', version: best }
      : { kind: 'not-found', detail: `no published version satisfies ${spec}` };
  }
  if (isValidDistTag(spec)) {
    return {
      kind: 'not-found',
      detail: `no dist-tag "${spec}" for this package`,
    };
  }
  return {
    kind: 'invalid',
    detail: `"${spec}" is not a version, dist-tag, or semver range`,
  };
}

export async function readStoredPack(
  storeDir: string,
  name: string,
  version: string,
): Promise<Buffer | undefined> {
  let meta = await readStoreMeta(storeDir, name);
  let record = meta?.versions[version];
  if (!record) {
    return undefined;
  }
  return readFile(join(storeDir, name, record.file));
}
