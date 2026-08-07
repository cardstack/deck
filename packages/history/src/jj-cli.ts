import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  DirQueue,
  SealDebouncer,
  isValidHistoryPath,
  isValidRevisionId,
  type HistoryActor,
  type HistoryBackend,
  type HistoryEntry,
  type RestorePlan,
} from './backend.ts';

const execFileAsync = promisify(execFile);

// The jj CLI backend: one `jj` subprocess per operation, colocated with the
// watched tree. It is the reference implementation of the tier-2 contract —
// historyd (src/historyd.ts) is the faster swap-in, not the definition.
//
// Ported from the vetted realm-server sidecar (packages/realm-server/lib/
// realm-history.ts), minus everything realm-specific: no bookmarks (the
// STORE's meta.json is the version registry in the standalone protocol), no
// logger, no fs-extra.

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const MAX_BUFFER = 64 * 1024 * 1024;

const DEFAULT_NAME = 'deck-history';
const DEFAULT_EMAIL = 'deck-history@localhost';

// Expands git-style rename summaries. jj prints renames/copies as
// `R {old => new}` or with a shared prefix/suffix, e.g. `R sub/{a => b}.txt`.
function expandRenamePath(raw: string): { from: string; to: string } {
  let match = raw.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (!match) {
    return { from: raw, to: raw };
  }
  let [, prefix, from, to, suffix] = match;
  return { from: `${prefix}${from}${suffix}`, to: `${prefix}${to}${suffix}` };
}

export interface JjCliOptions {
  bin?: string;
  debounceMs?: number;
  onError?: (error: unknown) => void;
}

export class JjCliHistory implements HistoryBackend {
  readonly kind = 'jj' as const;
  #bin: string;
  #queue = new DirQueue();
  #debouncer: SealDebouncer;

  constructor(options: JjCliOptions = {}) {
    this.#bin = options.bin ?? process.env.JJ_BIN ?? 'jj';
    this.#debouncer = new SealDebouncer({
      debounceMs: options.debounceMs ?? 400,
      seal: (dir, message) => this.seal(dir, message),
      onError: options.onError,
    });
  }

  noteMutation(dir: string, path: string): void {
    this.#debouncer.note(dir, path);
  }

  async flush(dir: string): Promise<string | undefined> {
    // Even with no pending burst the tree may hold writes made before the
    // backend was attached, or around a restart — so always try to seal.
    return this.seal(dir, this.#debouncer.take(dir) ?? 'save');
  }

  // Seals the working copy as one jj change when it is dirty. `actor`
  // overrides the AUTHOR — but jj fixes a commit's author when it is
  // CREATED, not when it is described, so an actor supplied here lands on
  // the NEXT change unless the caller first advanced to a fresh empty
  // commit under that identity. The standalone protocol has no
  // authenticated writer, so this is a pass-through for callers that do.
  async seal(
    dir: string,
    message: string,
    actor?: HistoryActor,
  ): Promise<string | undefined> {
    return this.#queue.run(dir, async () => {
      await this.#ensureRepo(dir);
      // Any jj invocation snapshots the working copy first; this one also
      // reports whether there is anything to seal.
      let { stdout } = await this.#jj(dir, [
        'log',
        '--no-graph',
        '-r',
        '@',
        '-T',
        'if(empty, "empty", "dirty")',
      ]);
      if (stdout.trim() !== 'dirty') {
        return undefined;
      }
      await this.#jj(dir, ['commit', '-m', message], actor);
      let sealed = await this.#jj(dir, [
        'log',
        '--no-graph',
        '-r',
        '@-',
        '-T',
        'change_id',
      ]);
      return sealed.stdout.trim();
    });
  }

  async head(dir: string): Promise<string | undefined> {
    return this.#queue.run(dir, async () => {
      await this.#ensureRepo(dir);
      let { stdout } = await this.#jj(dir, [
        'log',
        '--no-graph',
        '-r',
        '@-',
        '-T',
        'if(empty, "", change_id)',
      ]);
      let changeId = stdout.trim();
      return changeId === '' ? undefined : changeId;
    });
  }

  async list(dir: string): Promise<HistoryEntry[]> {
    await this.flush(dir);
    return this.#queue.run(dir, async () => {
      let template =
        `change_id ++ "${FIELD_SEP}" ++ commit_id ++ "${FIELD_SEP}" ++ ` +
        `committer.timestamp().format("%Y-%m-%dT%H:%M:%S%z") ++ "${FIELD_SEP}" ++ ` +
        `description.first_line() ++ "${FIELD_SEP}" ++ ` +
        `if(empty, "empty", "change") ++ "${FIELD_SEP}" ++ ` +
        `author.name() ++ "${FIELD_SEP}" ++ ` +
        `diff.summary() ++ "${RECORD_SEP}"`;
      let { stdout } = await this.#jj(dir, [
        'log',
        '--no-graph',
        '-r',
        '::@ ~ root()',
        '-T',
        template,
      ]);
      let entries: HistoryEntry[] = [];
      for (let record of stdout.split(RECORD_SEP)) {
        if (!record.trim()) {
          continue;
        }
        let [
          changeId,
          commitId,
          timestamp,
          description,
          emptiness,
          author,
          summary,
        ] = record.split(FIELD_SEP);
        if (emptiness === 'empty') {
          // the (usually empty) working-copy change on top of history
          continue;
        }
        entries.push({
          changeId,
          commitId,
          timestamp,
          description,
          author: author && author !== DEFAULT_NAME ? author : undefined,
          filesSummary: (summary ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        });
      }
      return entries;
    });
  }

  async fileAt(
    dir: string,
    revisionId: string,
    path: string,
  ): Promise<Buffer | undefined> {
    if (!isValidRevisionId(revisionId) || !isValidHistoryPath(path)) {
      return undefined;
    }
    return this.#queue.run(dir, async () => {
      await this.#ensureRepo(dir);
      try {
        let { stdout } = await execFileAsync(
          this.#bin,
          [...this.#baseArgs(), 'file', 'show', '-r', revisionId, path],
          { cwd: dir, maxBuffer: MAX_BUFFER, encoding: 'buffer' },
        );
        return stdout as unknown as Buffer;
      } catch (error) {
        if (isNotFound(error)) {
          return undefined;
        }
        throw error;
      }
    });
  }

  async fileListAt(
    dir: string,
    revisionId: string,
  ): Promise<string[] | undefined> {
    if (!isValidRevisionId(revisionId)) {
      return undefined;
    }
    return this.#queue.run(dir, async () => {
      await this.#ensureRepo(dir);
      try {
        let { stdout } = await this.#jj(dir, [
          'file',
          'list',
          '-r',
          revisionId,
        ]);
        return stdout.split('\n').filter(Boolean);
      } catch (error) {
        if (isNotFound(error)) {
          return undefined;
        }
        throw error;
      }
    });
  }

  // The changes needed to make the live tree match `revisionId`. This class
  // never writes tree files itself — `applyRestore` replays the plan.
  async restorePlan(dir: string, revisionId: string): Promise<RestorePlan> {
    if (!isValidRevisionId(revisionId)) {
      throw new Error('invalid revision id');
    }
    await this.flush(dir);
    return this.#queue.run(dir, async () => {
      let { stdout } = await this.#jj(dir, [
        'diff',
        '--summary',
        '--from',
        '@',
        '--to',
        revisionId,
      ]);
      let writes: string[] = [];
      let deletes: string[] = [];
      for (let line of stdout.split('\n')) {
        if (!line.trim()) {
          continue;
        }
        let match = line.match(/^([MADRC]) (.*)$/);
        if (!match) {
          throw new Error(`unrecognized diff summary line: ${line}`);
        }
        let [, status, rawPath] = match;
        switch (status) {
          case 'M':
          case 'A':
            writes.push(rawPath);
            break;
          case 'D':
            deletes.push(rawPath);
            break;
          case 'R': {
            let { from, to } = expandRenamePath(rawPath);
            writes.push(to);
            deletes.push(from);
            break;
          }
          case 'C': {
            let { to } = expandRenamePath(rawPath);
            writes.push(to);
            break;
          }
        }
      }
      return { writes, deletes };
    });
  }

  close(): void {
    this.#debouncer.close();
  }

  async #ensureRepo(dir: string): Promise<void> {
    if (existsSync(join(dir, '.jj'))) {
      return;
    }
    // Colocated git backend: jj gets its storage and the embedded git repo
    // is there for anyone who wants to push the tree somewhere else.
    await this.#jj(dir, ['git', 'init', '--colocate']);
  }

  #baseArgs(actor?: HistoryActor): string[] {
    // jj's --config value is a TOML string literal; a raw embedded quote
    // would break out of it (a jj-level parse error, not a shell one — args
    // reach jj as an argv array, never a shell), so strip quotes rather
    // than try to escape them.
    let sanitize = (value: string) => value.replace(/"/g, '').slice(0, 200);
    let name = actor?.name ? sanitize(actor.name) : DEFAULT_NAME;
    let email = actor?.email ? sanitize(actor.email) : DEFAULT_EMAIL;
    return [
      '--no-pager',
      '--color=never',
      '--config',
      `user.name="${name}"`,
      '--config',
      `user.email="${email}"`,
    ];
  }

  async #jj(
    dir: string,
    args: string[],
    actor?: HistoryActor,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(this.#bin, [...this.#baseArgs(actor), ...args], {
      cwd: dir,
      maxBuffer: MAX_BUFFER,
    });
  }
}

function isNotFound(error: unknown): boolean {
  let stderr = (error as { stderr?: unknown })?.stderr;
  return /No such path|doesn't exist|Revision.*doesn't exist/i.test(
    stderr?.toString() ?? '',
  );
}

// Is a usable jj on this machine? Tier 2 is optional by design: when the
// answer is no, the caller stays on tier 1 rather than failing.
export async function jjVersion(bin?: string): Promise<string | undefined> {
  try {
    let { stdout } = await execFileAsync(
      bin ?? process.env.JJ_BIN ?? 'jj',
      ['--version'],
      { timeout: 5000 },
    );
    return stdout.trim();
  } catch {
    return undefined;
  }
}
