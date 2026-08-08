import {
  applyRebase,
  discoverOffers,
  planRebase,
  type Offer,
  type RebasePlan,
  type RebaseState,
} from '@deck/core/offer';
import type { DepotMount } from './depot.ts';

// The rebase daemon.
//
// 200 open proposals against a moving upstream is only a backlog if humans
// have to keep them mergeable. They do not have to: the base is exact, both
// sides are content-addressed, and merging is a pure function. So a machine
// re-merges every offer whenever upstream publishes, writes the clean ones
// back into their own working trees — which auto-publish and seal like any
// other save — and leaves the conflicted ones strictly alone.
//
// What a maintainer sees is therefore not "197 proposals to rebase" but
// "3 that stopped merging". That is the whole point.
//
// Two properties keep this safe to run unattended:
//   - a conflicted merge writes NOTHING; the contributor's tree is never
//     damaged by a machine
//   - a clean merge that changes nothing writes nothing either, so the loop
//     converges instead of publishing itself forever

export interface RebaseOutcome {
  offer: string;
  upstream: string;
  state: RebaseState;
  upstreamVersion?: string;
  conflicts: string[];
  detail?: string;
  // True when this pass actually moved the proposal's tree.
  applied: boolean;
}

export interface RebasePassResult {
  outcomes: RebaseOutcome[];
  rebased: number;
  conflicted: number;
}

export interface RebaseDaemonOptions {
  depot: DepotMount;
  // Which upstream state proposals chase. Default: the release if there is
  // one, else the freshest seal.
  onto?: string;
  // Report only — the CI/read-only shape.
  dryRun?: boolean;
  intervalMs?: number;
  onPass?: (result: RebasePassResult) => void;
  onError?: (error: unknown) => void;
}

export async function rebasePass(
  options: Omit<RebaseDaemonOptions, 'intervalMs' | 'onPass'>,
): Promise<RebasePassResult> {
  let { depot, onto, dryRun } = options;
  let outcomes: RebaseOutcome[] = [];
  for (let offer of await discoverOffers(depot.dir)) {
    let plan: RebasePlan;
    try {
      plan = await planRebase({
        depotDir: depot.dir,
        storeDir: depot.storeDir,
        offer,
        onto,
      });
    } catch (error) {
      options.onError?.(error);
      continue;
    }
    let applied = false;
    if (plan.state === 'rebased' && !dryRun) {
      try {
        applied = (await applyRebase(plan)).changed;
      } catch (error) {
        options.onError?.(error);
      }
    }
    outcomes.push({
      offer: offer.name,
      upstream: plan.upstream,
      state: plan.state,
      upstreamVersion: plan.upstreamVersion,
      conflicts: plan.conflicts,
      detail: plan.detail,
      applied,
    });
  }
  return {
    outcomes,
    rebased: outcomes.filter((outcome) => outcome.applied).length,
    conflicted: outcomes.filter((outcome) => outcome.state === 'conflicted')
      .length,
  };
}

export interface RebaseDaemon {
  // Runs one pass now. Exposed so a caller (or a test) never has to wait on
  // a timer to know the queue is current.
  pass(): Promise<RebasePassResult>;
  close(): void;
}

export function startRebaseDaemon(
  options: RebaseDaemonOptions,
): RebaseDaemon {
  let { intervalMs = 5000, onPass, onError } = options;
  let running = false;
  let closed = false;

  async function pass(): Promise<RebasePassResult> {
    let result = await rebasePass(options);
    onPass?.(result);
    return result;
  }

  let timer = setInterval(() => {
    if (running || closed) {
      return;
    }
    running = true;
    pass()
      .catch((error) => onError?.(error))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  // Never hold a process open for the next sweep.
  timer.unref?.();

  return {
    pass,
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}

export type { Offer, RebasePlan, RebaseState };
