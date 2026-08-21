# Collaboration replay fixture

The collaboration realm is generated state, not a checked-in database
snapshot. The repository carries only the scenario inputs under `scenario/`
and [`scripts/replay-collaboration.mjs`](../../scripts/replay-collaboration.mjs)
rebuilds `depot/` by replaying current Deck operations.

That distinction is deliberate: if branch, History, vendoring, Checkpoint,
Review, or merge behavior stops composing, the example fails to materialize.
There is no JSON fixture that can stay green while the protocol breaks.

## What the replay creates

The scenario is an ACME fulfillment-control system made from three separately
addressable packages that must advance atomically:

- `app/dashboard`
- `acme/editor`
- `acme/theme`

The replay performs these statements in order:

1. Copy the small initial source tree into a new realm, seal its first History
   revision, and run `deck repo-init` to create `main`.
2. Create `ana/customer-impact`. Run `deck vendor` against a local two-module
   origin and publish `vendor/impact-score@1.0.0` with the `approved` tag.
3. Apply Ana's work in two saves, create one cross-package Checkpoint, open
   Review #1, and record Kim's approval through the Review API.
4. Restore the original History revision, replay Ana's result as an attributed
   merge save, and run `deck merge`. `main` now names a two-parent Checkpoint.
5. Create `kim/carrier-routing`, apply two more saves across all three
   packages, create a Checkpoint, open Review #2, and record Mina's approval.
   This Review remains open so Browse and Review have a real pending diff.
6. Assert the exact vendored Version and RRI lock, old and new History
   revisions, branch heads, Review event chains, merge topology, and clean
   three-way preview.

On this machine the replay takes about two seconds after deckd is available.

## Run it

The normal launcher automatically replays the scenario when the generated
marker is absent:

```sh
./scripts/run-hub-with-deckd.sh
```

To discard and recreate the collaboration realm explicitly, stop Hub, leave
deckd running, and use:

```sh
pnpm replay:collaboration
```

Or force a replay while starting the whole stack:

```sh
DECK_REPLAY_COLLABORATION=1 ./scripts/run-hub-with-deckd.sh
```

Inspect the result:

- `http://localhost:8788/browse?at=/collaboration/app/dashboard`
- `http://localhost:8788/review?repository=acme/dashboard&depot=collaboration`

`depot/` is ignored by git. The authoritative fixture is the ordered replay
plus its readable source inputs—not generated CAS objects or mutable refs.
