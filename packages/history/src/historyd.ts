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

// The historyd backend: the same Timeline contract served by jj-historyd —
// jj-lib in Rust, spoken to over localhost HTTP. It exists because the CLI
// backend pays a fork/exec per operation, which measured ~5-6x the cost of
// an in-process jj-lib call in the realm-server spike. Identical opaque
// changeId contract, so callers never learn which one is live.
//
// The daemon's surface (POST, JSON in/out):
//   /ensure       {dir}                       → {}
//   /seal         {dir, message}              → {changeId: string | null}
//   /list         {dir}                       → HistoryEntry[]
//   /file-at      {dir, revisionId, path}     → {found, contentBase64?}
//   /restore-plan {dir, revisionId}           → {writes, deletes}
//
// Two capability gaps against the CLI backend, both declared rather than
// faked: an `actor` is dropped (/seal takes only {dir, message}), and there
// is no tree-enumeration endpoint, so `fileListAt` is absent — a caller must
// read that as "cannot enumerate", never as "the tree is empty".

const DEFAULT_URL = 'http://127.0.0.1:8787';

export interface HistorydOptions {
  baseUrl?: string;
  debounceMs?: number;
  onError?: (error: unknown) => void;
}

export class HistorydHistory implements HistoryBackend {
  readonly kind = 'historyd' as const;
  #base: string;
  #ensured: Set<string> = new Set();
  #queue = new DirQueue();
  #debouncer: SealDebouncer;

  constructor(options: HistorydOptions = {}) {
    this.#base = (
      options.baseUrl ??
      process.env.DECK_HISTORYD_URL ??
      DEFAULT_URL
    ).replace(/\/$/, '');
    this.#debouncer = new SealDebouncer({
      debounceMs: options.debounceMs ?? 400,
      seal: (dir, message) => this.seal(dir, message),
      onError: options.onError,
    });
  }

  get baseUrl(): string {
    return this.#base;
  }

  noteMutation(dir: string, path: string): void {
    this.#debouncer.note(dir, path);
  }

  async flush(dir: string): Promise<string | undefined> {
    return this.seal(dir, this.#debouncer.take(dir) ?? 'save');
  }

  // `actor` is accepted for interface parity and deliberately dropped: the
  // daemon's /seal takes only {dir, message}. Dropping it loudly would break
  // callers that pass an actor opportunistically, so this backend's missing
  // `author` in `list()` is the visible, consistent consequence.
  async seal(
    dir: string,
    message: string,
    _actor?: HistoryActor,
  ): Promise<string | undefined> {
    return this.#queue.run(dir, async () => {
      await this.#ensure(dir);
      let { changeId } = await this.#post<{ changeId: string | null }>(
        '/seal',
        { dir, message },
      );
      return changeId ?? undefined;
    });
  }

  async head(dir: string): Promise<string | undefined> {
    return this.#queue.run(dir, async () => {
      await this.#ensure(dir);
      // No /head endpoint: the newest entry of the log IS the head, and the
      // daemon filters the working-copy change the same way the CLI does.
      let entries = await this.#post<HistoryEntry[]>('/list', { dir });
      return entries[0]?.changeId;
    });
  }

  async list(dir: string): Promise<HistoryEntry[]> {
    await this.flush(dir);
    return this.#queue.run(dir, async () => {
      await this.#ensure(dir);
      return this.#post<HistoryEntry[]>('/list', { dir });
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
      await this.#ensure(dir);
      let result = await this.#post<{ found: boolean; contentBase64?: string }>(
        '/file-at',
        { dir, revisionId, path },
      );
      if (!result.found || !result.contentBase64) {
        return undefined;
      }
      return Buffer.from(result.contentBase64, 'base64');
    });
  }

  async restorePlan(dir: string, revisionId: string): Promise<RestorePlan> {
    if (!isValidRevisionId(revisionId)) {
      throw new Error('invalid revision id');
    }
    await this.flush(dir);
    return this.#queue.run(dir, async () => {
      await this.#ensure(dir);
      return this.#post<RestorePlan>('/restore-plan', { dir, revisionId });
    });
  }

  // Is the daemon actually up and willing to manage this tree? Used at
  // attach time so an absent daemon degrades to Versions only (or to the CLI
  // backend) instead of failing every later save.
  async probe(dir: string): Promise<boolean> {
    try {
      await this.#queue.run(dir, () => this.#ensure(dir));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.#debouncer.close();
  }

  async #ensure(dir: string): Promise<void> {
    if (this.#ensured.has(dir)) {
      return;
    }
    await this.#post('/ensure', { dir });
    this.#ensured.add(dir);
  }

  async #post<T = unknown>(path: string, body: unknown): Promise<T> {
    let response = await fetch(`${this.#base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let text = await response.text();
    if (!response.ok) {
      throw new Error(`historyd ${path} ${response.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
