import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packFromDir } from './pack.ts';
import { storePack } from './object-store.ts';
import {
  repositoryManifest,
  repositoryState,
  revision,
  type RevisionAuthor,
} from './repository.ts';
import {
  readBranchRef,
  storeRepository,
  storeRepositoryLock,
  storeRevision,
  updateBranchRef,
} from './repository-store.ts';

export const REPOSITORY_CONFIG_SPEC = 'deck-repository-config-v1';
export const REPOSITORY_CONFIG_FILE = 'repository.json';

export interface RepositoryConfig {
  schema: typeof REPOSITORY_CONFIG_SPEC;
  owner: string;
  name: string;
  roots: string[];
  members: string[];
}

const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function repositoryConfig(value: unknown): RepositoryConfig {
  let input = value as Partial<RepositoryConfig>;
  if (
    input.schema !== REPOSITORY_CONFIG_SPEC ||
    typeof input.owner !== 'string' ||
    typeof input.name !== 'string' ||
    !SEGMENT.test(input.owner) ||
    !SEGMENT.test(input.name) ||
    !Array.isArray(input.roots) ||
    !Array.isArray(input.members)
  ) {
    throw new Error('invalid Deck repository configuration');
  }
  let manifest = repositoryManifest({
    roots: input.roots,
    members: input.members,
  });
  return {
    schema: REPOSITORY_CONFIG_SPEC,
    owner: input.owner,
    name: input.name,
    roots: manifest.roots,
    members: manifest.members,
  };
}

export async function readRepositoryConfig(
  depotDir: string,
): Promise<RepositoryConfig | undefined> {
  try {
    return repositoryConfig(
      JSON.parse(
        await readFile(join(depotDir, REPOSITORY_CONFIG_FILE), 'utf8'),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

// A package is a repository without registration. repository.json exists
// only for the monorepo-equivalent case where several packages land as one.
export async function resolveRepositoryConfig(
  depotDir: string,
  identity?: string,
): Promise<RepositoryConfig> {
  let grouped = await readRepositoryConfig(depotDir);
  if (!identity) {
    if (grouped) return grouped;
    throw new Error('repository required: use --repo <publisher/package>');
  }
  if (`${grouped?.owner}/${grouped?.name}` === identity) return grouped!;
  let parts = identity.split('/');
  if (parts.length !== 2 || !parts.every((part) => SEGMENT.test(part))) {
    throw new Error('repository must be <publisher>/<package>');
  }
  try {
    await readFile(join(depotDir, ...parts, 'package.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`mutable package not found: ${identity}`);
    }
    throw error;
  }
  return {
    schema: REPOSITORY_CONFIG_SPEC,
    owner: parts[0],
    name: parts[1],
    roots: [identity],
    members: [identity],
  };
}

export async function ensureRepositoryMain(options: {
  depotDir: string;
  storeDir: string;
  config: RepositoryConfig;
  author: RevisionAuthor;
}): Promise<string> {
  let current = await readBranchRef(
    options.storeDir,
    options.config.owner,
    options.config.name,
    'main',
  );
  if (current) return current.revisionHash;
  return (
    await captureRepositoryRevision({
      ...options,
      branch: 'main',
      message: `Initialize ${options.config.owner}/${options.config.name}`,
    })
  ).revisionHash;
}

export async function captureRepositoryRevision(options: {
  depotDir: string;
  storeDir: string;
  config: RepositoryConfig;
  branch: string;
  message: string;
  author: RevisionAuthor;
  createdAt?: string;
}): Promise<{
  repositoryHash: string;
  revisionHash: string;
  parentRevisionHash?: string;
}> {
  let current = await readBranchRef(
    options.storeDir,
    options.config.owner,
    options.config.name,
    options.branch,
  );
  let members: Record<string, string> = {};
  for (let member of options.config.members) {
    members[member] = (
      await storePack(
        options.storeDir,
        await packFromDir(join(options.depotDir, ...member.split('/'))),
      )
    ).treeHash;
  }
  let lock = JSON.parse(
    await readFile(join(options.depotDir, 'importmap.json'), 'utf8'),
  );
  let lockHash = await storeRepositoryLock(options.storeDir, lock);
  let state = repositoryState({
    roots: options.config.roots,
    members,
    lockHash,
  });
  let repositoryHash = await storeRepository(options.storeDir, state);
  let next = revision({
    repositoryHash,
    parents: current ? [current.revisionHash] : [],
    author: options.author,
    message: options.message,
    createdAt: options.createdAt ?? new Date().toISOString(),
  });
  let revisionHash = await storeRevision(options.storeDir, next);
  await updateBranchRef({
    storeDir: options.storeDir,
    owner: options.config.owner,
    repository: options.config.name,
    branch: options.branch,
    expectedRevision: current?.revisionHash ?? null,
    nextRevision: revisionHash,
  });
  return {
    repositoryHash,
    revisionHash,
    ...(current ? { parentRevisionHash: current.revisionHash } : {}),
  };
}

export async function createRepositoryBranch(options: {
  storeDir: string;
  config: RepositoryConfig;
  branch: string;
  from?: string;
}): Promise<string> {
  let source = await readBranchRef(
    options.storeDir,
    options.config.owner,
    options.config.name,
    options.from ?? 'main',
  );
  if (!source)
    throw new Error(`source branch not found: ${options.from ?? 'main'}`);
  await updateBranchRef({
    storeDir: options.storeDir,
    owner: options.config.owner,
    repository: options.config.name,
    branch: options.branch,
    expectedRevision: null,
    nextRevision: source.revisionHash,
  });
  return source.revisionHash;
}
