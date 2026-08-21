# Deck branch and review workflow tour

This is the real workflow used by agents, the CLI, and Deck Hub. The
collaboration example is not a checked-in protocol snapshot: the launcher asks
`scripts/replay-collaboration.mjs` to create it through the same commands and
APIs an agent uses. Hub then reads those refs and immutable objects directly;
it has no parallel fixture state.

Deck writes only the RRI-native Repository/Checkpoint/Review protocol. CLI
`--root` / `--member` arguments are local authoring paths; the manifest maps
them to canonical roots such as `@acme/dashboard/`. URL-form identity,
Revision, and Pull Request wire objects are not accepted aliases.

## 1. Rebuild the worked example from statements

From the Deck checkout:

```sh
DECK_REPLAY_COLLABORATION=1 ./scripts/run-hub-with-deckd.sh
```

After deckd is ready, the replay itself takes about two seconds. It creates
multiple attributed History revisions, a hermetically vendored two-module
package, three branches, four Checkpoints, merged Review #1, and open
approved Review #2. It then reads the state back and asserts the RRI lock, old
History revision, two-parent merge, event chains, and clean three-package
preview.

The tracked input is under `examples/collaboration/scenario/`; the resulting
realm under `examples/collaboration/depot/` is ignored generated state.

## 2. Package first; grouping only when needed

No initialization is required to branch an ordinary package. Its
`publisher/package` name is its repository identity.

This validation case intentionally needs three packages to land atomically,
so it has the optional monorepo-equivalent grouping:

The replay invokes this initialization command internally:

```sh
deck repo-init \
  --depot examples/collaboration/depot \
  --owner acme --name dashboard \
  --root app/dashboard \
  --member app/dashboard \
  --member acme/editor \
  --member acme/theme \
  --history <deckd-head> \
  --index <completed-index-generation-hash>
```

`repo-init` writes the realm-owned `.deck/repository.json`, captures all three
packages and the depot import map into CAS, creates an immutable Repository and
Checkpoint, then creates `main`. Run it only for an atomic multi-package group.
A single package never needs this file.

## 3. Ask an agent to make another branch

The direct command is:

```sh
deck branch \
  --depot examples/collaboration/depot \
  --repo acme/dashboard \
  --name you/delivery-exceptions \
  --from main
```

A Deck branch is a familiar named branch in one Repository. Internally its
realm-local head names current Repository, deckd/jj History, and index state;
the same branch/fork primitive uses repository-local naming for team workflow.

Open Browse at:

```text
http://localhost:8788/browse?at=/collaboration/app/dashboard
```

The Repository panel lists the new branch immediately. Agent-side CLI changes
are detected by Hub and sent over its live event stream.

## 4. Change several packages and capture one Checkpoint

Edit any member directories. Then capture them atomically:

```sh
deck checkpoint \
  --depot examples/collaboration/depot \
  --repo acme/dashboard \
  --branch you/delivery-exceptions \
  --message "Prioritize delayed shipments" \
  --history <deckd-head> \
  --index <completed-index-generation-hash>
```

One Checkpoint now points to one Repository containing exact tree hashes for
every member. Packages remain individually addressable, but the composition
lands as a unit.

Ordinary saves produce addressable deckd History revisions without requiring a
Checkpoint. `deck checkpoint` is the deliberate boundary that captures the
current Repository, History head, and completed index generation on the named
branch before Review.

## 5. Open a review

```sh
deck review \
  --depot examples/collaboration/depot \
  --repo acme/dashboard \
  --source you/delivery-exceptions \
  --target main \
  --title "Prioritize delayed shipments" \
  --body "Adds risk-ranked exceptions, owner routing, and alert tokens across the dashboard, queue component, and theme."
```

Visit [Review](http://localhost:8788/review?repository=acme/dashboard&depot=collaboration).
The page shows exact package diffs, a runnable projection, Checkpoint history,
review events, and expandable canonical protocol objects.

The replay owns Review numbers 1 and 2, so this fresh follow-up becomes Review
#3. Always use the number printed by `deck review` rather than assuming it.

## 6. Merge through the same protocol

```sh
deck merge \
  --depot examples/collaboration/depot \
  --repo acme/dashboard \
  --number 3 \
  --history <post-merge-deckd-head> \
  --index <post-merge-index-generation-hash>
```

Deck computes the three-way merge from exact Checkpoints, creates a two-parent
merge Checkpoint, advances `main` with compare-and-swap, and appends immutable
`merge-started` and `merged` events. A conflict writes no partial result.

Browse updates to the new main without a reload. Underneath, inspect:

```text
<realm>/.deck/
├── refs/heads/*.json
├── store/_repositories/<prefix>/<hash>.json
├── store/_checkpoints/<prefix>/<hash>.json
├── reviews/numbers/<number>.json
├── reviews/objects/<prefix>/<hash>.json
├── reviews/events/<prefix>/<hash>.json
├── indexes/<prefix>/<generationHash>/…
└── history/repo/                         deckd/jj History
```

The numbered file and branch heads are the small mutable coordination layer.
Everything they name is immutable CAS and maps directly to conditional S3
writes in a hosted deployment. Agents can inspect these files through the
realm's S3 Files view; only the realm service may mutate protocol-owned paths,
using direct S3 preconditions.

## The agent request

You can now ask: “Create a branch for this change, implement it, checkpoint the
Repository, open a Review, and merge it after verification.” The agent should
use these commands in order and report the branch, review number, and resulting
main Checkpoint. The explicit Checkpoint is required before opening a Review.
For ordinary package work, pass the package identity—for
example, `--repo app/dashboard`. No `repo-init` is involved.
