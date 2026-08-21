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
   revision, let the real watcher auto-publish `1.0.0-dev.1`, run
   `deck repo-init`, and release `1.0.0` as the LTS line.
2. Create `ana/customer-impact`. Run `deck vendor` against a local two-module
   origin and publish `vendor/impact-score@1.0.0` with the `approved` tag.
3. Apply Ana's `1.1.0` work in two saves. Each save enters History with actor
   attribution and auto-publishes the changed packages on their `-dev.N`
   lines. Create one cross-package Checkpoint, open Review #1, and record Kim's
   approval through the Review API.
4. Restore the original History revision, replay Ana's result as an attributed
   merge save, run `deck merge`, and release `1.1.0` as `latest`. `main` now
   names a two-parent Checkpoint.
5. Create `kim/carrier-routing` and apply three `1.2.0` saves across all three
   packages. This produces a visible `1.2.0-dev.1`/`.2` tape, then a
   Checkpoint and approved Review #2. The Review remains open and turns the
   app into an unmistakably different carrier command center.
6. Assert the exact vendored Version and RRI lock, all three semver lines,
   autosave descriptions and actors, old and new History revisions, branch
   heads, Review events, merge topology, semver-aware projections, and clean
   three-way preview.

On this machine the replay takes under four seconds after deckd is available.

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
- `http://localhost:8788/track?at=/collaboration&group=0`

Track shows the authored History saves and deliberate releases by default.
Press `a` or use the **auto-publishes** switch to reveal every immutable
`-dev.N` Version created by those same saves.

A release that gives an existing tree a stable Version is shown as a naming
event, with the source Version called out explicitly. Only transitions whose
tree hash changed offer a diff, so Track never sends a deliberate zero-copy
release to an empty comparison.

`depot/` is ignored by git. The authoritative fixture is the ordered replay
plus its readable source inputs—not generated CAS objects or mutable refs.
