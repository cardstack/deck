import { applyRebase } from '@cardstack/deck/offer';
import {
  outcomeOf,
  planOffers,
  surveyOffers,
  tally,
  type OfferSurveyOptions,
  type Offer,
  type RebaseOutcome,
  type RebasePassResult,
  type RebasePlan,
  type RebaseState,
} from '@cardstack/deck-server/offer-survey';

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
//
// It is a tool rather than part of the server because of what it does: it
// moves trees. The server plans (`@cardstack/deck-server/offer-survey`) and
// reports; this applies. Running the daemon in the same process as the
// server is fine and normal — the separation is about which module can
// write, not about which host it runs on.

export interface RebaseDaemonOptions extends OfferSurveyOptions {
  // Report only — the CI/read-only shape.
  dryRun?: boolean;
  intervalMs?: number;
  onPass?: (result: RebasePassResult) => void;
}

export async function rebasePass(
  options: Omit<RebaseDaemonOptions, 'intervalMs' | 'onPass'>,
): Promise<RebasePassResult> {
  if (options.dryRun) {
    return surveyOffers(options);
  }
  let outcomes: RebaseOutcome[] = [];
  for (let plan of await planOffers(options)) {
    let applied = false;
    if (plan.state === 'rebased') {
      try {
        applied = (await applyRebase(plan)).changed;
      } catch (error) {
        options.onError?.(error);
      }
    }
    outcomes.push(outcomeOf(plan, applied));
  }
  return tally(outcomes);
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

export type { Offer, RebaseOutcome, RebasePassResult, RebasePlan, RebaseState };
