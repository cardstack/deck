# Deck branch and review workflow tour

This is the real workflow used by agents, the CLI, and Deck Hub. The Hub does
not seed examples or keep parallel state. Every mutable package is implicitly
a repository, and Hub reads the same refs and immutable objects the CLI writes.

Deck writes only the RRI-native Repository/Checkpoint/Review protocol. CLI
`--root` / `--member` arguments are local authoring paths; the manifest maps
them to canonical roots such as `@acme/dashboard/`. URL-form identity,
Revision, and Pull Request wire objects are not accepted aliases.

## 1. Package first; grouping only when needed

No initialization is required to branch an ordinary package. Its
`publisher/package` name is its repository identity.

This validation case intentionally needs three packages to land atomically,
so it has the optional monorepo-equivalent grouping:

From the Deck checkout:

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

`repo-init` writes the realm-owned `.deck/repository.json`, captures all three packages and the
depot import map into CAS, creates an immutable Repository and Checkpoint, then
creates `main`. Run it only for an atomic multi-package group; this checkout is
already initialized. A single package never needs this file.

## 2. Ask an agent to make a branch

The direct command is:

```sh
deck branch \
  --depot examples/collaboration/depot \
  --repo acme/dashboard \
  --name ops/delivery-exceptions \
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

## 3. Change several packages and capture one Checkpoint

Edit any member directories. Then capture them atomically:

```sh
deck checkpoint \
  --depot examples/collaboration/depot \
  --repo acme/dashboard \
  --branch ops/delivery-exceptions \
  --message "Prioritize delayed shipments" \
  --history <deckd-head> \
  --index <completed-index-generation-hash>
```

One Checkpoint now points to one Repository containing exact tree hashes for
every member. Packages remain individually addressable, but the composition
lands as a unit.

Ordinary saves produce deckd History Steps and advance the branch head without
this command. `deck checkpoint` deliberately names the current Repository,
History head, and completed index generation before Review.

## 4. Open a review

```sh
deck review \
  --depot examples/collaboration/depot \
  --repo acme/dashboard \
  --source ops/delivery-exceptions \
  --target main \
  --title "Prioritize delayed shipments" \
  --body "Adds risk-ranked exceptions, owner routing, and alert tokens across the dashboard, queue component, and theme."
```

Visit [Review](http://localhost:8788/review?repository=acme/dashboard&depot=collaboration).
The page shows exact package diffs, a runnable projection, Checkpoint history,
review events, and expandable canonical protocol objects.

## 5. Merge through the same protocol

```sh
deck merge \
  --depot examples/collaboration/depot \
  --repo acme/dashboard \
  --number 1 \
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
