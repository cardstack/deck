import {
  hashProtocolObject,
  isHash,
  type JsonValue,
  type RevisionAuthor,
} from './repository.ts';

export const PULL_REQUEST_SPEC = 'deck-pull-request-v1';
export const PULL_REQUEST_EVENT_SPEC = 'deck-pull-request-event-v1';

export interface PullRequestEndpoint {
  owner: string;
  repository: string;
  branch: string;
  revisionHash: string;
}

export interface PullRequest {
  schema: typeof PULL_REQUEST_SPEC;
  target: PullRequestEndpoint;
  source: PullRequestEndpoint;
  title: string;
  body: string;
  author: RevisionAuthor;
  createdAt: string;
}

export type PullRequestEventType =
  'source-updated' | 'reviewed' | 'merge-started' | 'merged' | 'closed';

export interface PullRequestEvent {
  schema: typeof PULL_REQUEST_EVENT_SPEC;
  pullRequestHash: string;
  previousEventHash?: string;
  type: PullRequestEventType;
  actor: RevisionAuthor;
  createdAt: string;
  revisionHash?: string;
  verdict?: 'approved' | 'changes-requested';
}

function canonicalInstant(createdAt: string): void {
  let date = new Date(createdAt);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== createdAt) {
    throw new Error('createdAt must be a canonical UTC ISO-8601 timestamp');
  }
}

function endpoint(value: PullRequestEndpoint): PullRequestEndpoint {
  if (!value.owner || !value.repository || !value.branch) {
    throw new Error(
      'pull request endpoints require owner, repository, and branch',
    );
  }
  if (!isHash(value.revisionHash)) {
    throw new Error('pull request endpoint requires a Revision hash');
  }
  return { ...value };
}

export function pullRequest(options: Omit<PullRequest, 'schema'>): PullRequest {
  canonicalInstant(options.createdAt);
  if (!options.title.trim())
    throw new Error('pull request title must not be empty');
  if (!options.author.id.trim())
    throw new Error('pull request author must not be empty');
  return {
    schema: PULL_REQUEST_SPEC,
    target: endpoint(options.target),
    source: endpoint(options.source),
    title: options.title,
    body: options.body,
    author: { ...options.author },
    createdAt: options.createdAt,
  };
}

export function pullRequestHash(value: PullRequest): string {
  return hashProtocolObject(value as unknown as JsonValue);
}

export function pullRequestEvent(
  options: Omit<PullRequestEvent, 'schema'>,
): PullRequestEvent {
  canonicalInstant(options.createdAt);
  if (!isHash(options.pullRequestHash))
    throw new Error('invalid pull request hash');
  if (options.previousEventHash && !isHash(options.previousEventHash)) {
    throw new Error('invalid previous pull request event hash');
  }
  if (!options.actor.id.trim())
    throw new Error('pull request event actor must not be empty');
  if (
    ['source-updated', 'reviewed', 'merge-started', 'merged'].includes(
      options.type,
    ) &&
    !options.revisionHash
  ) {
    throw new Error(`${options.type} requires a Revision hash`);
  }
  if (options.revisionHash && !isHash(options.revisionHash)) {
    throw new Error('invalid event Revision hash');
  }
  if (options.type === 'reviewed' && !options.verdict) {
    throw new Error('reviewed requires a verdict');
  }
  if (options.type !== 'reviewed' && options.verdict) {
    throw new Error('only reviewed may carry a verdict');
  }
  return { schema: PULL_REQUEST_EVENT_SPEC, ...options };
}

export function pullRequestEventHash(value: PullRequestEvent): string {
  return hashProtocolObject(value as unknown as JsonValue);
}
