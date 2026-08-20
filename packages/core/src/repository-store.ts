import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  canonicalJson,
  hashProtocolObject,
  isHash,
  repositoryHash,
  revisionHash,
  type JsonValue,
  type RepositoryState,
  type Revision,
} from './repository.ts';

export const LOCKS_DIR = '_locks';
export const REPOSITORIES_DIR = '_repositories';
export const REVISIONS_DIR = '_revisions';
export const REFS_DIR = '_refs';
export const REF_SPEC = 'deck-ref-v1';

export interface BranchRef {
  schema: typeof REF_SPEC;
  revisionHash: string;
  generation: number;
}

function parseBranchRef(bytes: Buffer): BranchRef {
  let parsed = JSON.parse(bytes.toString('utf8')) as Partial<BranchRef>;
  if (
    parsed.schema !== REF_SPEC ||
    typeof parsed.revisionHash !== 'string' ||
    !isHash(parsed.revisionHash) ||
    !Number.isSafeInteger(parsed.generation) ||
    (parsed.generation ?? 0) < 1
  ) {
    throw new Error('invalid Deck branch ref');
  }
  return parsed as BranchRef;
}

function casPath(storeDir: string, kind: string, hash: string): string {
  return join(storeDir, kind, hash.slice(0, 2), `${hash}.json`);
}

async function writeOnce(path: string, bytes: Buffer): Promise<void> {
  try {
    let existing = await readFile(path);
    if (!existing.equals(bytes)) {
      throw new Error(`content-address collision at ${path}`);
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  let tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

async function readHashedJson<T>(
  path: string,
  expectedHash: string,
): Promise<T | undefined> {
  try {
    let bytes = await readFile(path);
    let parsed = JSON.parse(bytes.toString('utf8')) as JsonValue;
    if (hashProtocolObject(parsed) !== expectedHash) {
      throw new Error(`protocol object does not match its hash: ${path}`);
    }
    return parsed as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function storeRepositoryLock(
  storeDir: string,
  lock: JsonValue,
): Promise<string> {
  let hash = hashProtocolObject(lock);
  await writeOnce(casPath(storeDir, LOCKS_DIR, hash), canonicalJson(lock));
  return hash;
}

export async function readRepositoryLock(
  storeDir: string,
  lockHash: string,
): Promise<JsonValue | undefined> {
  if (!isHash(lockHash)) return undefined;
  return readHashedJson(casPath(storeDir, LOCKS_DIR, lockHash), lockHash);
}

export async function storeRepository(
  storeDir: string,
  repository: RepositoryState,
): Promise<string> {
  let hash = repositoryHash(repository);
  await writeOnce(
    casPath(storeDir, REPOSITORIES_DIR, hash),
    canonicalJson(repository as unknown as JsonValue),
  );
  return hash;
}

export async function readRepository(
  storeDir: string,
  hash: string,
): Promise<RepositoryState | undefined> {
  if (!isHash(hash)) return undefined;
  return readHashedJson(casPath(storeDir, REPOSITORIES_DIR, hash), hash);
}

export async function storeRevision(
  storeDir: string,
  value: Revision,
): Promise<string> {
  let hash = revisionHash(value);
  await writeOnce(
    casPath(storeDir, REVISIONS_DIR, hash),
    canonicalJson(value as unknown as JsonValue),
  );
  return hash;
}

export async function readRevision(
  storeDir: string,
  hash: string,
): Promise<Revision | undefined> {
  if (!isHash(hash)) return undefined;
  return readHashedJson(casPath(storeDir, REVISIONS_DIR, hash), hash);
}

const REF_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const BRANCH = /^[a-z0-9][a-z0-9._/-]{0,127}$/;

function branchRefPath(
  storeDir: string,
  owner: string,
  repository: string,
  branch: string,
): string {
  if (
    !REF_SEGMENT.test(owner) ||
    !REF_SEGMENT.test(repository) ||
    !BRANCH.test(branch) ||
    branch.includes('..')
  ) {
    throw new Error('invalid repository ref name');
  }
  return join(storeDir, REFS_DIR, owner, repository, 'heads', `${branch}.json`);
}

export async function readBranchRef(
  storeDir: string,
  owner: string,
  repository: string,
  branch: string,
): Promise<BranchRef | undefined> {
  try {
    return parseBranchRef(
      await readFile(branchRefPath(storeDir, owner, repository, branch)),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export class RefConflictError extends Error {}
export class RefBusyError extends Error {}
// An S3 adapter translates HTTP 412 Precondition Failed into this error so
// higher-level CAS loops can retry without treating transport failure as a
// protocol conflict.
export class ConditionalWriteConflictError extends Error {}

// Local refs use a per-ref mkdir lock, then tmp+rename. S3 implementations
// must not put this mutable file through the NFS projection: use If-Match or
// If-None-Match through the S3 API, as updateConditionalBranchRef does below.
export async function updateBranchRef(options: {
  storeDir: string;
  owner: string;
  repository: string;
  branch: string;
  expectedRevision: string | null;
  nextRevision: string;
}): Promise<BranchRef> {
  if (!isHash(options.nextRevision))
    throw new Error('invalid next revision hash');
  let path = branchRefPath(
    options.storeDir,
    options.owner,
    options.repository,
    options.branch,
  );
  let lock = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new RefBusyError(
        `branch ref is being updated: ${options.owner}/${options.repository}:${options.branch}`,
      );
    }
    throw error;
  }
  try {
    let current = await readBranchRef(
      options.storeDir,
      options.owner,
      options.repository,
      options.branch,
    );
    if ((current?.revisionHash ?? null) !== options.expectedRevision) {
      throw new RefConflictError('branch moved since it was read');
    }
    let next: BranchRef = {
      schema: REF_SPEC,
      revisionHash: options.nextRevision,
      generation: (current?.generation ?? 0) + 1,
    };
    let tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, canonicalJson(next as unknown as JsonValue));
    await rename(tmp, path);
    return next;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export interface ConditionalObject {
  bytes: Buffer;
  etag: string;
}

export interface ConditionalObjectStore {
  get(key: string): Promise<ConditionalObject | undefined>;
  put(
    key: string,
    bytes: Buffer,
    condition: { ifMatch?: string; ifNoneMatch?: '*' },
  ): Promise<{ etag: string }>;
}

export async function updateConditionalBranchRef(options: {
  objects: ConditionalObjectStore;
  key: string;
  expectedRevision: string | null;
  nextRevision: string;
}): Promise<BranchRef> {
  if (!isHash(options.nextRevision)) {
    throw new Error('invalid next revision hash');
  }
  let currentObject = await options.objects.get(options.key);
  let current = currentObject ? parseBranchRef(currentObject.bytes) : undefined;
  if ((current?.revisionHash ?? null) !== options.expectedRevision) {
    throw new RefConflictError('branch moved since it was read');
  }
  let next: BranchRef = {
    schema: REF_SPEC,
    revisionHash: options.nextRevision,
    generation: (current?.generation ?? 0) + 1,
  };
  await options.objects.put(
    options.key,
    canonicalJson(next as unknown as JsonValue),
    currentObject ? { ifMatch: currentObject.etag } : { ifNoneMatch: '*' },
  );
  return next;
}
