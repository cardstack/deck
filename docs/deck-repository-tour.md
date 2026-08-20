# Deck branch and review workflow tour

This is the real workflow used by agents, the CLI, and Deck Hub. The Hub does
not seed examples or keep parallel state. Every mutable package is implicitly
a repository, and Hub reads the same refs and immutable objects the CLI writes.

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
  --member acme/theme
```

`repo-init` writes `depot/repository.json`, captures all three packages and the
depot import map into CAS, creates an immutable Repository and Revision, then
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

A Deck branch is a familiar named branch in one Repository. Internally it is a
cheap ref over immutable Repository Revisions—the same content-addressed
mechanism as a fork, with repository-local naming for team workflow.

Open Browse at:

```text
http://localhost:8788/browse?at=/collaboration/app/dashboard
```

The Repository panel lists the new branch immediately. Agent-side CLI changes
are detected by Hub and sent over its live event stream.

## 3. Change several packages and capture one commit

Edit any member directories. Then capture them atomically:

```sh
deck commit \
  --depot examples/collaboration/depot \
  --repo acme/dashboard \
  --branch ops/delivery-exceptions \
  --message "Prioritize delayed shipments"
```

One Revision now points to one Repository containing exact tree hashes for
every member. Packages remain individually addressable, but the composition
lands as a unit.

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

Visit [Review](http://localhost:8788/review?repository=acme/dashboard). The
page shows exact package diffs, a runnable projection, Revision history, review
events, and expandable canonical protocol objects.

## 5. Merge through the same protocol

```sh
deck merge \
  --depot examples/collaboration/depot \
  --repo acme/dashboard \
  --number 1
```

Deck computes the three-way merge from exact Revisions, creates a two-parent
merge Revision, advances `main` with compare-and-swap, and appends immutable
`merge-started` and `merged` events. A conflict writes no partial result.

Browse updates to the new main without a reload. Underneath, inspect:

```text
depot/.deck/store/
├── _refs/<owner>/<repo>/heads/*.json
├── _repositories/<prefix>/<hash>.json
├── _revisions/<prefix>/<hash>.json
├── _pulls/<owner>/<repo>/<number>.json
├── _pull_requests/<prefix>/<hash>.json
└── _pull_request_events/<prefix>/<hash>.json
```

The numbered file and branch heads are the small mutable coordination layer.
Everything they name is immutable CAS and maps directly to conditional S3
writes in a hosted deployment.

## The agent request

You can now ask: “Create a branch for this change, implement it, commit the
Repository, open a review, and merge it after verification.” The agent should
use these commands in order and report the branch, review number, and resulting
main Revision. For ordinary package work, pass the package identity—for
example, `--repo app/dashboard`. No `repo-init` is involved.
