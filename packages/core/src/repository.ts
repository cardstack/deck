import { createHash } from 'node:crypto';

export const REPOSITORY_SPEC = 'deck-repository-v1';
export const REPOSITORY_MANIFEST_SPEC = 'deck-repository-manifest-v1';
export const REVISION_SPEC = 'deck-revision-v1';

const HASH = /^[0-9a-f]{64}$/;
const NAME_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface RepositoryState {
  schema: typeof REPOSITORY_SPEC;
  roots: string[];
  members: Record<string, string>;
  lockHash: string;
}

export interface RepositoryManifest {
  schema: typeof REPOSITORY_MANIFEST_SPEC;
  roots: string[];
  members: string[];
}

export interface RevisionAuthor {
  id: string;
  name?: string;
}

export interface Revision {
  schema: typeof REVISION_SPEC;
  repositoryHash: string;
  parents: string[];
  author: RevisionAuthor;
  message: string;
  createdAt: string;
}

function normalizedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(normalizedJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map(([key, member]) => [key, normalizedJson(member)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('canonical JSON cannot contain a non-finite number');
  }
  return value;
}

// Canonical protocol JSON is recursively key-sorted, UTF-8, two-space
// indented, and newline terminated. The readable form is also the hashed
// form: an object copied between local disk and S3 keeps the same identity.
export function canonicalJson(value: JsonValue): Buffer {
  return Buffer.from(JSON.stringify(normalizedJson(value), null, 2) + '\n');
}

export function hashProtocolObject(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function isHash(value: string): boolean {
  return HASH.test(value);
}

export function isRepositoryPackageName(value: string): boolean {
  let segments = value.split('/');
  return (
    segments.length === 2 && segments.every((part) => NAME_SEGMENT.test(part))
  );
}

function sortedUnique(values: string[], label: string): string[] {
  let sorted = [...values].sort((a, b) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  );
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return sorted;
}

export function repositoryManifest(options: {
  roots: string[];
  members: string[];
}): RepositoryManifest {
  let roots = sortedUnique(options.roots, 'repository roots');
  let members = sortedUnique(options.members, 'repository members');
  if (members.length === 0) {
    throw new Error('a repository must contain at least one member package');
  }
  for (let name of members) {
    if (!isRepositoryPackageName(name)) {
      throw new Error(
        `invalid repository member name: ${JSON.stringify(name)}`,
      );
    }
  }
  for (let root of roots) {
    if (!members.includes(root)) {
      throw new Error(
        `repository root is not a member: ${JSON.stringify(root)}`,
      );
    }
  }
  return { schema: REPOSITORY_MANIFEST_SPEC, roots, members };
}

export function repositoryState(options: {
  roots: string[];
  members: Record<string, string>;
  lockHash: string;
}): RepositoryState {
  let manifest = repositoryManifest({
    roots: options.roots,
    members: Object.keys(options.members),
  });
  let memberEntries = manifest.members.map(
    (name) => [name, options.members[name]] as const,
  );
  for (let [name, treeHash] of memberEntries) {
    if (!isHash(treeHash)) {
      throw new Error(
        `invalid treeHash for ${name}: ${JSON.stringify(treeHash)}`,
      );
    }
  }
  let members = Object.fromEntries(memberEntries);
  if (!isHash(options.lockHash)) {
    throw new Error(`invalid lockHash: ${JSON.stringify(options.lockHash)}`);
  }
  return {
    schema: REPOSITORY_SPEC,
    roots: manifest.roots,
    members,
    lockHash: options.lockHash,
  };
}

export function repositoryHash(state: RepositoryState): string {
  return hashProtocolObject(state as unknown as JsonValue);
}

export function revision(options: {
  repositoryHash: string;
  parents?: string[];
  author: RevisionAuthor;
  message: string;
  createdAt: string;
}): Revision {
  if (!isHash(options.repositoryHash)) {
    throw new Error(
      `invalid repositoryHash: ${JSON.stringify(options.repositoryHash)}`,
    );
  }
  let parents = options.parents ?? [];
  if (
    new Set(parents).size !== parents.length ||
    parents.some((parent) => !isHash(parent))
  ) {
    throw new Error('revision parents must be unique revision hashes');
  }
  if (options.author.id.trim() === '') {
    throw new Error('revision author id must not be empty');
  }
  if (options.message.trim() === '') {
    throw new Error('revision message must not be empty');
  }
  let instant = new Date(options.createdAt);
  if (
    !Number.isFinite(instant.valueOf()) ||
    instant.toISOString() !== options.createdAt
  ) {
    throw new Error(
      'revision createdAt must be a canonical UTC ISO-8601 timestamp',
    );
  }
  return {
    schema: REVISION_SPEC,
    repositoryHash: options.repositoryHash,
    parents: [...parents],
    author: { ...options.author },
    message: options.message,
    createdAt: options.createdAt,
  };
}

export function revisionHash(value: Revision): string {
  return hashProtocolObject(value as unknown as JsonValue);
}

export function changedMembers(
  before: RepositoryState,
  after: RepositoryState,
): string[] {
  return [
    ...new Set([...Object.keys(before.members), ...Object.keys(after.members)]),
  ]
    .filter((name) => before.members[name] !== after.members[name])
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}
