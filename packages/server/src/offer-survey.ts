import {
  discoverOffers,
  planRebase,
  type Offer,
  type RebasePlan,
  type RebaseState,
} from '@cardstack/deck/offer';
import type { DepotMount } from './depot.ts';

// Surveying the offer queue: planning, and nothing else.
//
// The server reports what a maintainer needs to see — the three proposals
// that stopped merging, not the hundred that are fine. Producing that
// report means re-merging every open offer, which is a pure function of two
// content-addressed trees, so the survey is free of consequences.
//
// Applying the clean merges is a different act, and it lives somewhere
// else: `@cardstack/deck-tools/rebase-daemon`. The split is deliberate. The
// serve path holds no code that can write a proposal's tree, so "read-only
// serving" is a property of what the module can reach rather than a flag
// callers remember to pass. `dryRun: true` was the old spelling, and a flag
// is exactly the kind of thing that flips.
//
// The daemon builds on these plans rather than repeating the walk, so the
// two agree by construction: what the endpoint reports is what the daemon
// would act on.

export interface RebaseOutcome {
  offer: string;
  upstream: string;
  state: RebaseState;
  upstreamVersion?: string;
  conflicts: string[];
  detail?: string;
  // True when this pass actually moved the proposal's tree. Always false in
  // a survey — surveys do not move anything.
  applied: boolean;
}

export interface RebasePassResult {
  outcomes: RebaseOutcome[];
  rebased: number;
  conflicted: number;
}

export interface OfferSurveyOptions {
  depot: DepotMount;
  // Which upstream state proposals chase. Default: the release if there is
  // one, else the freshest seal.
  onto?: string;
  onError?: (error: unknown) => void;
}

/**
 * Plan a rebase for every open offer in the depot.
 *
 * An offer whose plan throws is skipped and reported through `onError` — one
 * broken proposal must not hide the rest of the queue.
 */
export async function planOffers(
  options: OfferSurveyOptions,
): Promise<RebasePlan[]> {
  let { depot, onto } = options;
  let plans: RebasePlan[] = [];
  for (let offer of await discoverOffers(depot.dir)) {
    try {
      plans.push(
        await planRebase({
          depotDir: depot.dir,
          storeDir: depot.storeDir,
          offer,
          onto,
        }),
      );
    } catch (error) {
      options.onError?.(error);
    }
  }
  return plans;
}

export function outcomeOf(plan: RebasePlan, applied: boolean): RebaseOutcome {
  return {
    offer: plan.offer.name,
    upstream: plan.upstream,
    state: plan.state,
    upstreamVersion: plan.upstreamVersion,
    conflicts: plan.conflicts,
    detail: plan.detail,
    applied,
  };
}

export function tally(outcomes: RebaseOutcome[]): RebasePassResult {
  return {
    outcomes,
    rebased: outcomes.filter((outcome) => outcome.applied).length,
    conflicted: outcomes.filter((outcome) => outcome.state === 'conflicted')
      .length,
  };
}

/** Report the queue. Writes nothing, by construction. */
export async function surveyOffers(
  options: OfferSurveyOptions,
): Promise<RebasePassResult> {
  return tally(
    (await planOffers(options)).map((plan) => outcomeOf(plan, false)),
  );
}

export type { Offer, RebasePlan, RebaseState };
