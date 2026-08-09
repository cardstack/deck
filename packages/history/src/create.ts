import { HistorydHistory } from './historyd.ts';
import { JjCliHistory, jjVersion } from './jj-cli.ts';
import type { HistoryBackend } from './backend.ts';

// Attaching history is always OPTIONAL and never fatal. Tier 2 needs a jj on
// the machine (or a daemon on a port); when neither is there the caller
// keeps the Versions loop — same watcher, same store, same immutable dev
// versions, just no seals between publishes. That is why this returns an
// attachment describing what happened instead of throwing: a missing jj is a
// capability fact to print, not an error to crash on.

export type HistoryKind = 'auto' | 'jj' | 'historyd' | 'none';

export interface CreateHistoryOptions {
  // The tree to attach history to. Probing is per-tree because historyd's
  // liveness check is "will you manage this directory?".
  dir: string;
  kind?: HistoryKind;
  debounceMs?: number;
  baseUrl?: string;
  bin?: string;
  onError?: (error: unknown) => void;
}

export interface HistoryAttachment {
  backend?: HistoryBackend;
  tier: 1 | 2;
  // One line, ready to print: what is live, or why there is no Timeline.
  detail: string;
}

export function isValidHistoryKind(value: string): value is HistoryKind {
  return ['auto', 'jj', 'historyd', 'none'].includes(value);
}

export async function createHistory(
  options: CreateHistoryOptions,
): Promise<HistoryAttachment> {
  let { dir, kind = 'auto', debounceMs, baseUrl, bin, onError } = options;
  let wantsDaemon = baseUrl !== undefined || process.env.DECK_HISTORYD_URL;

  if (kind === 'none') {
    return { tier: 1, detail: 'history off — the store is the history' };
  }

  if (kind === 'historyd' || (kind === 'auto' && wantsDaemon)) {
    let daemon = new HistorydHistory({ baseUrl, debounceMs, onError });
    if (await daemon.probe(dir)) {
      return {
        backend: daemon,
        tier: 2,
        detail: `history: historyd at ${daemon.baseUrl} (seal-grained)`,
      };
    }
    daemon.close();
    if (kind === 'historyd') {
      // An explicit backend choice never silently becomes a different
      // backend — the depot keeps its Versions, loses the Timeline, and says so.
      return {
        tier: 1,
        detail: `history: no daemon at ${daemon.baseUrl} — Versions only, no Timeline`,
      };
    }
  }

  let version = await jjVersion(bin);
  if (version) {
    return {
      backend: new JjCliHistory({ bin, debounceMs, onError }),
      tier: 2,
      detail: `history: ${version} — a Step per save`,
    };
  }
  return {
    tier: 1,
    detail:
      kind === 'jj'
        ? 'history: jj is not installed — Versions only, no Timeline'
        : 'history: Versions only, no Timeline — install jj for a Step per save',
  };
}
