import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { unpack } from './pack.ts';
import { packagesFromPack } from './import-map.ts';

// A Deck store is pure at-rest state on disk — the standalone counterpart
// of the realm's bookmarks. The server only READS it; all writes go through
// the CLI/watcher (an agent arranges state; distribution follows).
//
//   <store>/<name>/packs/<treeHash>.pack.zip   — sealed bytes, ONCE per hash
//   <store>/<name>/meta.json                   — versions + dist-tags
//
// The store is CONTENT-ADDRESSED: pack bytes are stored by treeHash, and a
// version is a POINTER (version → treeHash) in meta.json. Two consequences,
// both deliberate:
//   - publishing a tree whose bytes are already stored writes no new bytes
//   - RELEASING a new version from an existing sealed state (a dev
//     prerelease, a tag, another version) is a metadata edit — never a
//     copy. "Publish never seals new content" — the realm-server law —
//     holds here as "release never writes new bytes."
//
// Invariants:
//   - published versions are immutable: re-publishing refuses; meta updates
//     are atomic (tmp+rename)
//   - only verified packs enter the store (full unpack verification)
//   - manifest agreement: when the pack's import map declares a version for
//     the package, a published stable must EQUAL it, and a prerelease must
//     extend it (`<declared>-…`) — so bumping the map version in the live
//     tree is the ONLY edit a new line needs
//   - dist-tags are movable; names never semver-shaped; `latest` never
//     points at a prerelease

export interface StoreVersionRecord {
  treeHash: string;
  file: string; // relative to <store>/<name>/
}

export interface StoreMeta {
  name: string;
  versions: Record<string, StoreVersionRecord>;
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

function assertTagRules(tag: string, version: string): void {
  if (!isValidDistTag(tag)) {
    throw new Error(
      `"${tag}" is not a valid dist-tag (lowercase, not semver-shaped)`,
    );
  }
  if (tag === 'latest' && semver.prerelease(version) !== null) {
    throw new Error(`latest may only point at a stable release`);
  }
}

// Manifest agreement: the pack's own import map is the manifest. When it
// declares a version for this package, the published version must be that
// version (stable) or extend it as a prerelease (`<declared>-…`). Undeclared
// packages (plain libraries without a map entry) publish unconstrained.
function assertManifestAgreement(
  name: string,
  version: string,
  packBytes: Buffer,
): void {
  let declared = packagesFromPack(packBytes)?.[name]?.version;
  if (declared === undefined) {
    return;
  }
  if (version === declared || version.startsWith(`${declared}-`)) {
    return;
  }
  throw new Error(
    `importmap.json declares ${name}@${declared}, but the request is publishing ${name}@${version}`,
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function publishToStore(
  storeDir: string,
  name: string,
  version: string,
  packBytes: Buffer,
  options: { tag?: string } = {},
): Promise<StoreVersionRecord> {
  if (!isValidPackageName(name)) {
    throw new Error(`invalid package name: ${JSON.stringify(name)}`);
  }
  if (semver.valid(version) !== version) {
    throw new Error(`not an exact canonical semver version: ${version}`);
  }
  let { tag } = options;
  if (tag !== undefined) {
    assertTagRules(tag, version);
  }
  // Only verified packs enter the store.
  let { treeHash } = unpack(packBytes);
  assertManifestAgreement(name, version, packBytes);
  let meta = (await readStoreMeta(storeDir, name)) ?? {
    name,
    versions: {},
    tags: {},
  };
  if (meta.versions[version]) {
    throw new Error(`version already published: ${name}@${version}`);
  }
  // Content-addressed: bytes land once per treeHash; a re-publish of
  // already-stored content is a pure pointer add.
  let file = join('packs', `${treeHash}.pack.zip`);
  let absolute = join(storeDir, name, file);
  if (!(await fileExists(absolute))) {
    await mkdir(join(storeDir, name, 'packs'), { recursive: true });
    await writeFile(absolute, packBytes);
  }
  meta.versions[version] = { treeHash, file };
  if (tag) {
    meta.tags[tag] = version;
  }
  await writeStoreMeta(storeDir, meta);
  return { treeHash, file };
}

// THE no-copies version update: name an EXISTING sealed state (found via a
// dist-tag or a published version) as a new version. No pack is read into
// memory beyond the manifest check, no bytes are written, nothing is
// copied — the new version is a pointer to the same sealed content.
export async function releaseVersion(
  storeDir: string,
  name: string,
  version: string,
  from: { tag?: string; version?: string },
  options: { tag?: string } = {},
): Promise<StoreVersionRecord> {
  if (semver.valid(version) !== version) {
    throw new Error(`not an exact canonical semver version: ${version}`);
  }
  let meta = await readStoreMeta(storeDir, name);
  if (!meta) {
    throw new Error(`no published versions for package ${name}`);
  }
  let sourceVersion =
    from.version ?? (from.tag ? meta.tags[from.tag] : undefined);
  if (!sourceVersion) {
    throw new Error(
      from.tag
        ? `no dist-tag "${from.tag}" for ${name}`
        : `release requires a source: { tag } or { version }`,
    );
  }
  let record = meta.versions[sourceVersion];
  if (!record) {
    throw new Error(`${name}@${sourceVersion} is not a published version`);
  }
  if (meta.versions[version]) {
    throw new Error(`version already published: ${name}@${version}`);
  }
  let { tag } = options;
  if (tag !== undefined) {
    assertTagRules(tag, version);
  }
  // The sealed content must AGREE it is this version: the map inside the
  // seal declares it. Bumping the map version in the live tree — one edit,
  // part of the seal — is what makes a state releasable as that version.
  let packBytes = await readFile(join(storeDir, name, record.file));
  assertManifestAgreement(name, version, packBytes);
  meta.versions[version] = { ...record };
  if (tag) {
    meta.tags[tag] = version;
  }
  await writeStoreMeta(storeDir, meta);
  return { ...record };
}

export async function setDistTag(
  storeDir: string,
  name: string,
  tag: string,
  version: string,
): Promise<void> {
  let meta = await readStoreMeta(storeDir, name);
  if (!meta || !meta.versions[version]) {
    throw new Error(`${name}@${version} is not a published version`);
  }
  assertTagRules(tag, version);
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

// The next auto-publish number for a dev line: `<base>-dev.<n>`.
export function nextDevVersion(
  meta: StoreMeta | undefined,
  base: string,
): string {
  let max = 0;
  for (let version of Object.keys(meta?.versions ?? {})) {
    let match = version.match(
      new RegExp(`^${base.replace(/[.+]/g, '\\$&')}-dev\\.(\\d+)$`),
    );
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `${base}-dev.${max + 1}`;
}
