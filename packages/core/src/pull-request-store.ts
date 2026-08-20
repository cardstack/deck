import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  canonicalJson,
  hashProtocolObject,
  isHash,
  repositoryState,
  revision,
  type JsonValue,
  type RevisionAuthor,
} from './repository.ts';
import {
  pullRequest,
  pullRequestEvent,
  pullRequestEventHash,
  pullRequestHash,
  type PullRequest,
  type PullRequestEndpoint,
  type PullRequestEvent,
  type PullRequestEventType,
} from './pull-request.ts';
import { mergeRepositoryRevisions } from './repository-merge.ts';
import {
  ConditionalWriteConflictError,
  readBranchRef,
  readRepository,
  readRevision,
  storeRepository,
  storeRevision,
  updateBranchRef,
  type ConditionalObjectStore,
} from './repository-store.ts';

export const PULL_REQUESTS_DIR = '_pull_requests';
export const PULL_REQUEST_EVENTS_DIR = '_pull_request_events';
export const PULL_REFS_DIR = '_pulls';
export const PULL_REF_SPEC = 'deck-pull-request-ref-v1';
export const PULL_COUNTER_SPEC = 'deck-pull-request-counter-v1';

interface PullRequestCounter {
  schema: typeof PULL_COUNTER_SPEC;
  next: number;
}

export interface PullRequestRef {
  schema: typeof PULL_REF_SPEC;
  number: number;
  pullRequestHash: string;
  eventHash?: string;
  generation: number;
  state: 'open' | 'merged' | 'closed';
}

export interface StoredPullRequest {
  ref: PullRequestRef;
  request: PullRequest;
  events: PullRequestEvent[];
}

function objectPath(storeDir: string, kind: string, hash: string): string {
  return join(storeDir, kind, hash.slice(0, 2), `${hash}.json`);
}

function pullRefPath(
  storeDir: string,
  owner: string,
  repository: string,
  number: number,
): string {
  if (
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(owner) ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(repository)
  ) {
    throw new Error('invalid pull request repository name');
  }
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error('invalid pull request number');
  }
  return join(storeDir, PULL_REFS_DIR, owner, repository, `${number}.json`);
}

async function writeOnce(path: string, value: JsonValue): Promise<string> {
  let bytes = canonicalJson(value);
  let hash = hashProtocolObject(value);
  await mkdir(dirname(path), { recursive: true });
  try {
    let existing = await readFile(path);
    if (!existing.equals(bytes))
      throw new Error(`content-address collision at ${path}`);
    return hash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
  return hash;
}

async function readHashed<T>(path: string, hash: string): Promise<T> {
  let parsed = JSON.parse(await readFile(path, 'utf8')) as JsonValue;
  if (hashProtocolObject(parsed) !== hash) {
    throw new Error(`protocol object does not match its hash: ${path}`);
  }
  return parsed as unknown as T;
}

async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`pull request metadata is busy: ${path}`);
    }
    throw error;
  }
  try {
    return await fn();
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

function parsePullRef(bytes: Buffer): PullRequestRef {
  let value = JSON.parse(bytes.toString('utf8')) as PullRequestRef;
  if (
    value.schema !== PULL_REF_SPEC ||
    !Number.isSafeInteger(value.number) ||
    value.number < 1 ||
    !isHash(value.pullRequestHash) ||
    (value.eventHash !== undefined && !isHash(value.eventHash)) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !['open', 'merged', 'closed'].includes(value.state)
  ) {
    throw new Error('invalid pull request ref');
  }
  return value;
}

function parseCounter(bytes: Buffer): PullRequestCounter {
  let value = JSON.parse(bytes.toString('utf8')) as PullRequestCounter;
  if (
    value.schema !== PULL_COUNTER_SPEC ||
    !Number.isSafeInteger(value.next) ||
    value.next < 1
  ) {
    throw new Error('invalid pull request counter');
  }
  return value;
}

export async function allocateConditionalPullRequestNumber(options: {
  objects: ConditionalObjectStore;
  key: string;
  maxAttempts?: number;
}): Promise<number> {
  for (let attempt = 0; attempt < (options.maxAttempts ?? 8); attempt++) {
    let currentObject = await options.objects.get(options.key);
    let current: PullRequestCounter = currentObject
      ? parseCounter(currentObject.bytes)
      : { schema: PULL_COUNTER_SPEC, next: 1 };
    let number = current.next;
    let next: PullRequestCounter = { ...current, next: number + 1 };
    try {
      await options.objects.put(
        options.key,
        canonicalJson(next as unknown as JsonValue),
        currentObject ? { ifMatch: currentObject.etag } : { ifNoneMatch: '*' },
      );
      return number;
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) throw error;
    }
  }
  throw new Error('pull request number allocation stayed contended');
}

async function putConditionalOnce(options: {
  objects: ConditionalObjectStore;
  key: string;
  bytes: Buffer;
}): Promise<void> {
  let existing = await options.objects.get(options.key);
  if (existing) {
    if (!existing.bytes.equals(options.bytes)) {
      throw new Error(`content-address collision at ${options.key}`);
    }
    return;
  }
  try {
    await options.objects.put(options.key, options.bytes, { ifNoneMatch: '*' });
  } catch (error) {
    if (!(error instanceof ConditionalWriteConflictError)) throw error;
    let winner = await options.objects.get(options.key);
    if (!winner?.bytes.equals(options.bytes)) {
      throw new Error(`content-address collision at ${options.key}`);
    }
  }
}

// S3 counterpart of createPullRequest. Endpoint Revisions are supplied by
// the caller after reading branch refs through the same conditional store.
// S3 Files may materialize package directories; these authoritative metadata
// writes go through the S3 API so ETags enforce compare-and-swap.
export async function createConditionalPullRequest(options: {
  objects: ConditionalObjectStore;
  prefix: string;
  target: PullRequestEndpoint;
  source: PullRequestEndpoint;
  title: string;
  body?: string;
  author: RevisionAuthor;
  createdAt: string;
}): Promise<{ ref: PullRequestRef; request: PullRequest }> {
  let request = pullRequest({
    target: options.target,
    source: options.source,
    title: options.title,
    body: options.body ?? '',
    author: options.author,
    createdAt: options.createdAt,
  });
  let requestHash = pullRequestHash(request);
  await putConditionalOnce({
    objects: options.objects,
    key: `${options.prefix}/${PULL_REQUESTS_DIR}/${requestHash.slice(0, 2)}/${requestHash}.json`,
    bytes: canonicalJson(request as unknown as JsonValue),
  });
  let repositoryPrefix = `${options.prefix}/${PULL_REFS_DIR}/${request.target.owner}/${request.target.repository}`;
  let number = await allocateConditionalPullRequestNumber({
    objects: options.objects,
    key: `${repositoryPrefix}/_counter.json`,
  });
  let ref: PullRequestRef = {
    schema: PULL_REF_SPEC,
    number,
    pullRequestHash: requestHash,
    generation: 1,
    state: 'open',
  };
  await options.objects.put(
    `${repositoryPrefix}/${number}.json`,
    canonicalJson(ref as unknown as JsonValue),
    { ifNoneMatch: '*' },
  );
  return { ref, request };
}

// Appends an immutable event and advances only the mutable numbered ref. A
// losing writer may leave an unreachable event object, which is safe in CAS;
// it retries from the winning event head rather than overwriting history.
export async function appendConditionalPullRequestEvent(options: {
  objects: ConditionalObjectStore;
  prefix: string;
  owner: string;
  repository: string;
  number: number;
  type: PullRequestEventType;
  actor: RevisionAuthor;
  createdAt: string;
  revisionHash?: string;
  verdict?: 'approved' | 'changes-requested';
  maxAttempts?: number;
}): Promise<{ ref: PullRequestRef; event: PullRequestEvent }> {
  // Reuse the local path validator so local and hosted names have one grammar.
  pullRefPath('', options.owner, options.repository, options.number);
  let refKey = `${options.prefix}/${PULL_REFS_DIR}/${options.owner}/${options.repository}/${options.number}.json`;
  for (let attempt = 0; attempt < (options.maxAttempts ?? 8); attempt++) {
    let currentObject = await options.objects.get(refKey);
    if (!currentObject) throw new Error(`no pull request #${options.number}`);
    let current = parsePullRef(currentObject.bytes);
    if (current.state !== 'open') {
      throw new Error(`pull request #${options.number} is ${current.state}`);
    }
    let event = pullRequestEvent({
      pullRequestHash: current.pullRequestHash,
      previousEventHash: current.eventHash,
      type: options.type,
      actor: options.actor,
      createdAt: options.createdAt,
      revisionHash: options.revisionHash,
      verdict: options.verdict,
    });
    let eventHash = pullRequestEventHash(event);
    await putConditionalOnce({
      objects: options.objects,
      key: `${options.prefix}/${PULL_REQUEST_EVENTS_DIR}/${eventHash.slice(0, 2)}/${eventHash}.json`,
      bytes: canonicalJson(event as unknown as JsonValue),
    });
    let state: PullRequestRef['state'] =
      options.type === 'merged'
        ? 'merged'
        : options.type === 'closed'
          ? 'closed'
          : 'open';
    let ref: PullRequestRef = {
      ...current,
      eventHash,
      generation: current.generation + 1,
      state,
    };
    try {
      await options.objects.put(
        refKey,
        canonicalJson(ref as unknown as JsonValue),
        { ifMatch: currentObject.etag },
      );
      return { ref, event };
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) throw error;
    }
  }
  throw new Error('pull request event head stayed contended');
}

async function endpointAt(options: {
  storeDir: string;
  owner: string;
  repository: string;
  branch: string;
}): Promise<PullRequestEndpoint> {
  let ref = await readBranchRef(
    options.storeDir,
    options.owner,
    options.repository,
    options.branch,
  );
  if (!ref) {
    throw new Error(
      `no branch ${options.owner}/${options.repository}:${options.branch}`,
    );
  }
  return {
    owner: options.owner,
    repository: options.repository,
    branch: options.branch,
    revisionHash: ref.revisionHash,
  };
}

export async function createPullRequest(options: {
  storeDir: string;
  target: Omit<PullRequestEndpoint, 'revisionHash'>;
  source: Omit<PullRequestEndpoint, 'revisionHash'>;
  title: string;
  body?: string;
  author: RevisionAuthor;
  createdAt: string;
  baseRevisionHash?: string;
}): Promise<StoredPullRequest> {
  let [target, source] = await Promise.all([
    endpointAt({ storeDir: options.storeDir, ...options.target }),
    endpointAt({ storeDir: options.storeDir, ...options.source }),
  ]);
  if (options.baseRevisionHash) {
    if (!(await readRevision(options.storeDir, options.baseRevisionHash))) {
      throw new Error('pull request base Revision is missing');
    }
    target.revisionHash = options.baseRevisionHash;
  }
  let request = pullRequest({
    target,
    source,
    title: options.title,
    body: options.body ?? '',
    author: options.author,
    createdAt: options.createdAt,
  });
  let requestHash = pullRequestHash(request);
  await writeOnce(
    objectPath(options.storeDir, PULL_REQUESTS_DIR, requestHash),
    request as unknown as JsonValue,
  );

  let directory = join(
    options.storeDir,
    PULL_REFS_DIR,
    target.owner,
    target.repository,
  );
  let opened = await withLock(join(directory, '.allocate.lock'), async () => {
    let names = await readdir(directory).catch(() => [] as string[]);
    let number =
      Math.max(
        0,
        ...names
          .filter((name) => /^\d+\.json$/.test(name))
          .map((name) => Number(name.replace(/\.json$/, ''))),
      ) + 1;
    let ref: PullRequestRef = {
      schema: PULL_REF_SPEC,
      number,
      pullRequestHash: requestHash,
      generation: 1,
      state: 'open',
    };
    let path = pullRefPath(
      options.storeDir,
      target.owner,
      target.repository,
      number,
    );
    await writeFile(path, canonicalJson(ref as unknown as JsonValue), {
      flag: 'wx',
    });
    return { ref, request, events: [] };
  });
  if (
    target.owner === source.owner &&
    target.repository === source.repository
  ) {
    return opened;
  }

  // A fork has a different package identity, but merging it upstream is the
  // same tree operation as merging a branch. Normalize a single-package
  // fork into the target's logical member slot and record that exact Revision
  // as a source-updated event. The opening still names the real fork endpoint.
  let [targetRevision, sourceRevision] = await Promise.all([
    readRevision(options.storeDir, target.revisionHash),
    readRevision(options.storeDir, source.revisionHash),
  ]);
  if (!targetRevision || !sourceRevision) {
    throw new Error('pull request endpoint Revision is missing');
  }
  let [targetRepository, sourceRepository] = await Promise.all([
    readRepository(options.storeDir, targetRevision.repositoryHash),
    readRepository(options.storeDir, sourceRevision.repositoryHash),
  ]);
  if (!targetRepository || !sourceRepository) {
    throw new Error('pull request endpoint Repository is missing');
  }
  let targetMembers = Object.keys(targetRepository.members);
  let sourceMembers = Object.keys(sourceRepository.members);
  if (targetMembers.length !== 1 || sourceMembers.length !== 1) {
    throw new Error(
      'cross-repository pull requests currently require one package on each side',
    );
  }
  let normalizedRepository = repositoryState({
    roots: targetRepository.roots,
    members: {
      [targetMembers[0]]: sourceRepository.members[sourceMembers[0]],
    },
    lockHash: targetRepository.lockHash,
  });
  let normalizedRepositoryHash = await storeRepository(
    options.storeDir,
    normalizedRepository,
  );
  let normalizedRevisionHash = await storeRevision(
    options.storeDir,
    revision({
      repositoryHash: normalizedRepositoryHash,
      parents: [source.revisionHash],
      author: options.author,
      message: `Map ${source.owner}/${source.repository} onto ${target.owner}/${target.repository}`,
      createdAt: options.createdAt,
    }),
  );
  return appendPullRequestEvent({
    storeDir: options.storeDir,
    owner: target.owner,
    repository: target.repository,
    number: opened.ref.number,
    type: 'source-updated',
    actor: options.author,
    createdAt: options.createdAt,
    revisionHash: normalizedRevisionHash,
  });
}

export async function readPullRequest(
  storeDir: string,
  owner: string,
  repository: string,
  number: number,
): Promise<StoredPullRequest | undefined> {
  let ref: PullRequestRef;
  try {
    ref = parsePullRef(
      await readFile(pullRefPath(storeDir, owner, repository, number)),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let request = await readHashed<PullRequest>(
    objectPath(storeDir, PULL_REQUESTS_DIR, ref.pullRequestHash),
    ref.pullRequestHash,
  );
  let events: PullRequestEvent[] = [];
  let eventHash = ref.eventHash;
  let seen = new Set<string>();
  while (eventHash) {
    if (seen.has(eventHash)) throw new Error('pull request event cycle');
    seen.add(eventHash);
    let event = await readHashed<PullRequestEvent>(
      objectPath(storeDir, PULL_REQUEST_EVENTS_DIR, eventHash),
      eventHash,
    );
    if (event.pullRequestHash !== ref.pullRequestHash) {
      throw new Error('pull request event belongs to another request');
    }
    events.push(event);
    eventHash = event.previousEventHash;
  }
  events.reverse();
  return { ref, request, events };
}

export async function appendPullRequestEvent(options: {
  storeDir: string;
  owner: string;
  repository: string;
  number: number;
  type: PullRequestEventType;
  actor: RevisionAuthor;
  createdAt: string;
  revisionHash?: string;
  verdict?: 'approved' | 'changes-requested';
}): Promise<StoredPullRequest> {
  let path = pullRefPath(
    options.storeDir,
    options.owner,
    options.repository,
    options.number,
  );
  return withLock(`${path}.lock`, async () => {
    let current = await readPullRequest(
      options.storeDir,
      options.owner,
      options.repository,
      options.number,
    );
    if (!current) throw new Error(`no pull request #${options.number}`);
    if (current.ref.state !== 'open') {
      throw new Error(
        `pull request #${options.number} is ${current.ref.state}`,
      );
    }
    let event = pullRequestEvent({
      pullRequestHash: current.ref.pullRequestHash,
      previousEventHash: current.ref.eventHash,
      type: options.type,
      actor: options.actor,
      createdAt: options.createdAt,
      revisionHash: options.revisionHash,
      verdict: options.verdict,
    });
    let eventHash = pullRequestEventHash(event);
    await writeOnce(
      objectPath(options.storeDir, PULL_REQUEST_EVENTS_DIR, eventHash),
      event as unknown as JsonValue,
    );
    let state: PullRequestRef['state'] =
      options.type === 'merged'
        ? 'merged'
        : options.type === 'closed'
          ? 'closed'
          : 'open';
    let ref: PullRequestRef = {
      ...current.ref,
      eventHash,
      generation: current.ref.generation + 1,
      state,
    };
    let tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, canonicalJson(ref as unknown as JsonValue));
    await rename(tmp, path);
    return {
      ref,
      request: current.request,
      events: [...current.events, event],
    };
  });
}

function effectiveSource(value: StoredPullRequest): string {
  return (
    [...value.events].reverse().find((event) => event.type === 'source-updated')
      ?.revisionHash ?? value.request.source.revisionHash
  );
}

export async function previewPullRequest(
  storeDir: string,
  owner: string,
  repository: string,
  number: number,
) {
  let value = await readPullRequest(storeDir, owner, repository, number);
  if (!value) throw new Error(`no pull request #${number}`);
  let target = await endpointAt({
    storeDir,
    owner: value.request.target.owner,
    repository: value.request.target.repository,
    branch: value.request.target.branch,
  });
  return mergeRepositoryRevisions({
    storeDir,
    baseRevisionHash: value.request.target.revisionHash,
    targetRevisionHash: target.revisionHash,
    sourceRevisionHash: effectiveSource(value),
  });
}

export async function mergePullRequest(options: {
  storeDir: string;
  owner: string;
  repository: string;
  number: number;
  actor: RevisionAuthor;
  message?: string;
  createdAt: string;
}) {
  let value = await readPullRequest(
    options.storeDir,
    options.owner,
    options.repository,
    options.number,
  );
  if (!value) throw new Error(`no pull request #${options.number}`);
  if (value.ref.state !== 'open') {
    throw new Error(`pull request #${options.number} is ${value.ref.state}`);
  }
  let pending = [...value.events]
    .reverse()
    .find((event) => event.type === 'merge-started');
  if (pending?.revisionHash) {
    let pendingRevision = await readRevision(
      options.storeDir,
      pending.revisionHash,
    );
    if (!pendingRevision || pendingRevision.parents.length !== 2) {
      throw new Error('pull request has an invalid pending merge Revision');
    }
    let targetRef = await readBranchRef(
      options.storeDir,
      value.request.target.owner,
      value.request.target.repository,
      value.request.target.branch,
    );
    if (!targetRef) throw new Error('pull request target branch disappeared');
    if (targetRef.revisionHash === pendingRevision.parents[0]) {
      await updateBranchRef({
        storeDir: options.storeDir,
        owner: value.request.target.owner,
        repository: value.request.target.repository,
        branch: value.request.target.branch,
        expectedRevision: pendingRevision.parents[0],
        nextRevision: pending.revisionHash,
      });
    } else if (targetRef.revisionHash !== pending.revisionHash) {
      throw new Error(
        'target branch moved during a pending pull request merge',
      );
    }
    let repository = await readRepository(
      options.storeDir,
      pendingRevision.repositoryHash,
    );
    if (!repository) throw new Error('pending merge Repository is missing');
    await appendPullRequestEvent({
      storeDir: options.storeDir,
      owner: options.owner,
      repository: options.repository,
      number: options.number,
      type: 'merged',
      actor: options.actor,
      createdAt: options.createdAt,
      revisionHash: pending.revisionHash,
    });
    return {
      state: 'ready' as const,
      baseRevisionHash: value.request.target.revisionHash,
      targetRevisionHash: pendingRevision.parents[0],
      sourceRevisionHash: pendingRevision.parents[1],
      repository,
      repositoryHash: pendingRevision.repositoryHash,
      changedMembers: [],
      mergeRevisionHash: pending.revisionHash,
      recovered: true,
    };
  }
  let target = await endpointAt({
    storeDir: options.storeDir,
    owner: value.request.target.owner,
    repository: value.request.target.repository,
    branch: value.request.target.branch,
  });
  let result = await mergeRepositoryRevisions({
    storeDir: options.storeDir,
    baseRevisionHash: value.request.target.revisionHash,
    targetRevisionHash: target.revisionHash,
    sourceRevisionHash: effectiveSource(value),
  });
  if (result.state === 'conflicted') return result;
  let mergeRevision = revision({
    repositoryHash: result.repositoryHash,
    parents: [result.targetRevisionHash, result.sourceRevisionHash],
    author: options.actor,
    message:
      options.message ??
      `Merge pull request #${options.number}: ${value.request.title}`,
    createdAt: options.createdAt,
  });
  let mergeRevisionHash = await storeRevision(options.storeDir, mergeRevision);
  await appendPullRequestEvent({
    storeDir: options.storeDir,
    owner: options.owner,
    repository: options.repository,
    number: options.number,
    type: 'merge-started',
    actor: options.actor,
    createdAt: options.createdAt,
    revisionHash: mergeRevisionHash,
  });
  await updateBranchRef({
    storeDir: options.storeDir,
    owner: target.owner,
    repository: target.repository,
    branch: target.branch,
    expectedRevision: target.revisionHash,
    nextRevision: mergeRevisionHash,
  });
  await appendPullRequestEvent({
    storeDir: options.storeDir,
    owner: options.owner,
    repository: options.repository,
    number: options.number,
    type: 'merged',
    actor: options.actor,
    createdAt: options.createdAt,
    revisionHash: mergeRevisionHash,
  });
  return { ...result, mergeRevisionHash };
}
