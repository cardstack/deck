import { pack, unpack } from './pack.ts';
import { mergeJsonValues, mergeTrees } from './merge.ts';
import { readObject, readTree, storePack } from './object-store.ts';
import {
  changedMembers,
  repositoryState,
  revision,
  type JsonValue,
  type RepositoryState,
  type RevisionAuthor,
} from './repository.ts';
import {
  readRepository,
  readRepositoryLock,
  readRevision,
  storeRepository,
  storeRepositoryLock,
  storeRevision,
  updateBranchRef,
} from './repository-store.ts';

export interface RepositoryMergeReady {
  state: 'ready';
  baseRevisionHash: string;
  targetRevisionHash: string;
  sourceRevisionHash: string;
  repository: RepositoryState;
  repositoryHash: string;
  changedMembers: string[];
}

export interface RepositoryMergeConflicted {
  state: 'conflicted';
  baseRevisionHash: string;
  targetRevisionHash: string;
  sourceRevisionHash: string;
  conflicts: string[];
}

export type RepositoryMergeResult =
  RepositoryMergeReady | RepositoryMergeConflicted;

async function requiredRevision(storeDir: string, hash: string) {
  let value = await readRevision(storeDir, hash);
  if (!value) throw new Error(`missing Revision ${hash}`);
  return value;
}

async function requiredRepository(storeDir: string, hash: string) {
  let value = await readRepository(storeDir, hash);
  if (!value) throw new Error(`missing Repository ${hash}`);
  return value;
}

async function requiredLock(storeDir: string, hash: string) {
  let value = await readRepositoryLock(storeDir, hash);
  if (!value) throw new Error(`missing Repository lock ${hash}`);
  return value;
}

async function treeFiles(
  storeDir: string,
  treeHash: string,
): Promise<Map<string, Buffer>> {
  let tree = await readTree(storeDir, treeHash);
  if (!tree) throw new Error(`missing package tree ${treeHash}`);
  let files = new Map<string, Buffer>();
  for (let entry of tree.entries) {
    let bytes = await readObject(storeDir, entry.sha256);
    if (!bytes)
      throw new Error(`missing object ${entry.sha256} for ${treeHash}`);
    files.set(entry.path, bytes);
  }
  return files;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function mergeRoots(
  base: string[],
  target: string[],
  source: string[],
): { roots?: string[]; conflicted: boolean } {
  if (sameJson(target, source)) return { roots: target, conflicted: false };
  if (sameJson(base, target)) return { roots: source, conflicted: false };
  if (sameJson(base, source)) return { roots: target, conflicted: false };
  return { conflicted: true };
}

export async function mergeRepositoryRevisions(options: {
  storeDir: string;
  baseRevisionHash: string;
  targetRevisionHash: string;
  sourceRevisionHash: string;
}): Promise<RepositoryMergeResult> {
  let [baseRevision, targetRevision, sourceRevision] = await Promise.all([
    requiredRevision(options.storeDir, options.baseRevisionHash),
    requiredRevision(options.storeDir, options.targetRevisionHash),
    requiredRevision(options.storeDir, options.sourceRevisionHash),
  ]);
  let [base, target, source] = await Promise.all([
    requiredRepository(options.storeDir, baseRevision.repositoryHash),
    requiredRepository(options.storeDir, targetRevision.repositoryHash),
    requiredRepository(options.storeDir, sourceRevision.repositoryHash),
  ]);
  let conflicts: string[] = [];
  let roots = mergeRoots(base.roots, target.roots, source.roots);
  if (roots.conflicted) conflicts.push('repository.json#roots');

  let [baseLock, targetLock, sourceLock] = await Promise.all([
    requiredLock(options.storeDir, base.lockHash),
    requiredLock(options.storeDir, target.lockHash),
    requiredLock(options.storeDir, source.lockHash),
  ]);
  let lockMerge = mergeJsonValues(baseLock, targetLock, sourceLock);
  if (lockMerge.conflicted) conflicts.push('importmap.json');

  let members: Record<string, string> = {};
  let pendingPacks = new Map<string, Buffer>();
  let names = [
    ...new Set([
      ...Object.keys(base.members),
      ...Object.keys(target.members),
      ...Object.keys(source.members),
    ]),
  ].sort();
  for (let name of names) {
    let b = base.members[name];
    let o = target.members[name];
    let t = source.members[name];
    if (o === t) {
      if (o) members[name] = o;
      continue;
    }
    if (o === b) {
      if (t) members[name] = t;
      continue;
    }
    if (t === b) {
      if (o) members[name] = o;
      continue;
    }
    if (!b || !o || !t) {
      conflicts.push(`${name}/`);
      continue;
    }
    let merged = mergeTrees(
      await treeFiles(options.storeDir, b),
      await treeFiles(options.storeDir, o),
      await treeFiles(options.storeDir, t),
    );
    if (merged.conflicts.length > 0) {
      conflicts.push(...merged.conflicts.map((path) => `${name}/${path}`));
      continue;
    }
    let bytes = pack(
      [...merged.files].map(([path, fileBytes]) => ({
        path,
        bytes: fileBytes,
      })),
    );
    let treeHash = unpack(bytes).treeHash;
    members[name] = treeHash;
    pendingPacks.set(treeHash, bytes);
  }

  if (conflicts.length > 0 || !roots.roots) {
    return {
      state: 'conflicted',
      baseRevisionHash: options.baseRevisionHash,
      targetRevisionHash: options.targetRevisionHash,
      sourceRevisionHash: options.sourceRevisionHash,
      conflicts: [...new Set(conflicts)].sort(),
    };
  }

  for (let bytes of pendingPacks.values()) {
    await storePack(options.storeDir, bytes);
  }
  let lockHash = await storeRepositoryLock(
    options.storeDir,
    lockMerge.value as JsonValue,
  );
  let repository = repositoryState({ roots: roots.roots, members, lockHash });
  let repositoryHash = await storeRepository(options.storeDir, repository);
  return {
    state: 'ready',
    baseRevisionHash: options.baseRevisionHash,
    targetRevisionHash: options.targetRevisionHash,
    sourceRevisionHash: options.sourceRevisionHash,
    repository,
    repositoryHash,
    changedMembers: changedMembers(target, repository),
  };
}

export async function landRepositoryMerge(options: {
  storeDir: string;
  owner: string;
  repository: string;
  branch: string;
  baseRevisionHash: string;
  targetRevisionHash: string;
  sourceRevisionHash: string;
  author: RevisionAuthor;
  message: string;
  createdAt: string;
}): Promise<
  | RepositoryMergeConflicted
  | (RepositoryMergeReady & { mergeRevisionHash: string })
> {
  let result = await mergeRepositoryRevisions(options);
  if (result.state === 'conflicted') return result;
  let mergeRevision = revision({
    repositoryHash: result.repositoryHash,
    parents: [options.targetRevisionHash, options.sourceRevisionHash],
    author: options.author,
    message: options.message,
    createdAt: options.createdAt,
  });
  let mergeRevisionHash = await storeRevision(options.storeDir, mergeRevision);
  await updateBranchRef({
    storeDir: options.storeDir,
    owner: options.owner,
    repository: options.repository,
    branch: options.branch,
    expectedRevision: options.targetRevisionHash,
    nextRevision: mergeRevisionHash,
  });
  return { ...result, mergeRevisionHash };
}
