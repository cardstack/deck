# Deck storage backends — local filesystem and hosted AWS

**Status: RULING** (2026-08-21). This document is part of the Boxel
backport contract. AWS is not a later deployment optimization. The backport
ships a regular-filesystem backend for Boxel Desktop and a hosted AWS backend
using S3 Files plus S3 conditional writes.

Companions:

- [`deck-at-rest.md`](deck-at-rest.md) — canonical package objects;
- [`deck-daemon.md`](deck-daemon.md) — deckd and jj-backed History;
- [`deck-collaboration-protocol.md`](deck-collaboration-protocol.md) —
  Repository, Checkpoint, branch, Review, and merge objects;
- [`deck-boxel-branch-index-backport.md`](./plans/deck-boxel-branch-index-backport.md)
  — Boxel branch and index integration;
- [`deck-boxel-host-publish-treehash.md`](./plans/deck-boxel-host-publish-treehash.md)
  — immutable release delivery.

---

## 0. Ruling

> `.deck/history/` is Deck's jj-style History tree. It is managed by deckd.
> It is not replaced by a Deck-specific log of JSON Step objects.

Deck has two related durable planes:

```text
History plane                         Collaboration plane
────────────────────────────────      ────────────────────────────────
.deck/history/repo                    .deck/store/_repositories/…
jj repository                         .deck/store/_checkpoints/…
jj internal Git object backend        .deck/reviews/…
one Step per settled save             .deck/refs/…
restore / blame / every-save safety   CAS objects + conditional refs
owned by deckd                         owned by Deck Core adapters
```

They meet at a branch head. A settled branch head names the current Repository,
the opaque deckd/jj History head, the completed index generation, and the most
recent intentional Checkpoint. A normal save advances History without inventing
a Checkpoint. Opening a Review or merging creates a Checkpoint.

The two production shapes are:

```text
Boxel Desktop                         Hosted Boxel
──────────────────────────────        ──────────────────────────────
ordinary local filesystem             S3 Files POSIX workspace
deckd + jj-lib                         deckd + jj-lib
local atomic ref replacement           S3 conditional branch-ref PUT
local index generation                 durable index generation on AWS
```

Deck Core defines canonical bytes and storage contracts. It does not import an
AWS SDK. Boxel supplies local and AWS adapters.

## 1. Realm-contained layout

Every Deck resource belongs below the realm it describes. There is no sibling
bucket-wide `protocol/` tree and no floating global branch database.

Each mutable branch or fork has a stable workspace identity. The realm owns
the shared collaboration objects and every branch workspace:

```text
<realm-root>/
  <default-branch authored realm tree>   unchanged Boxel realm layout
  package.json                           at each conventional package boundary
  importmap.json                         optional root resolution input
  apps/<name>/importmap.json             optional app-local resolution input
  packages/<scope>/<name>/importmap.json optional package-local resolution input
  .deck/
    repository.json                      optional multi-package manifest
    history/
      repo/                              default-branch jj repository
    branches/<opaque-branch-id>/
      source/                            non-default branch materialization
      history/repo/                      branch-local jj repository
      transaction/                       prepared recovery records
      index-staging/                     private index build files
    store/
      _objects/<hh>/<blobHash>
      _trees/<hh>/<treeHash>.json
      _locks/<hh>/<lockHash>.json
      _repositories/<hh>/<repositoryHash>.json
      _checkpoints/<hh>/<checkpointHash>.json
    indexes/<hh>/<indexGenerationHash>/…
    refs/heads/<branch-token>.json
    refs/published.json
    reviews/objects/<hh>/<reviewHash>.json
    reviews/events/<hh>/<eventHash>.json
    reviews/numbers/<number>.json
    reviews/counter.json
    releases/objects/<hh>/<releaseHash>.json
  .jj/
    repo                                  default-branch thin pointer
```

The physical default-branch exception preserves today's editable realm shape.
This is an additive backport of the shape proven on Boxel's
`deck/at-rest-poc` branch, not a new wrapper directory for realms. The paths
shown above are examples, not mandatory roots: existing authored cards,
modules, assets, and conventional package directories remain where they are.
`package.json` supplies package identity, exports, and dependency suggestions.
The applicable root and nested `importmap.json` files are composed into one
canonical exact lock for a Checkpoint; no individual file is assumed to be the
whole repository lock.

A branch-qualified realm view projects the chosen
`.deck/branches/<id>/source/` as `/` and its History as
`/.deck/history/`. Agents therefore see one coherent realm filesystem without
learning the host's opaque storage path.

The exact deckd layout is defined by [`deck-daemon.md`](deck-daemon.md):

- durable History bytes live under `.deck/history/repo/`;
- `.jj/repo` is a small pointer required by jj tooling;
- no `.jj` repository or stub is shared across branches or placed at the
  host-global root; the default branch's thin stub is realm-local;
- `.deck/timeline/` is legacy input and is migrated only when History is absent;
- `.deck/history/` has the same meaning on Desktop and hosted Boxel.

Realm-scoped immutable objects are shared by that realm's branches. A fork
starts a destination realm and copies only the reachable immutable objects it
does not already possess. The bytes and hashes are identical across backends.

## 2. History is deckd + jj, everywhere

Deck already has the correct every-save engine:

```text
filesystem change
      │
      ▼
deckd watcher + settle boundary
      │
      ▼
jj-lib change in .deck/history/repo
      │
      ├── list / inspect / blame
      └── restore exact files
```

A **Step** is Deck's product name for one settled jj change. `historyHead` is
an opaque identity returned by deckd; Deck protocol code must not reinterpret
it as a Checkpoint hash, Version, Git commit ID, or CAS tree hash.

Branch and fork creation are storage-isomorphic. Both clone the complete
authored realm tree, including its package boundaries and resolution inputs,
but exclude realm-control directories such as `.deck`, `.jj`, and `.git`.
Both create a distinct branch workspace and distinct jj repository,
initialized by deckd from the exact source state and provenance. In the
selected realm view that repository is
always `/.deck/history/repo`; its physical host path may be
`.deck/branches/<id>/history/repo`. They do not recursively copy `.deck` or
`.jj` internals. Familiar ownership and merge policy determine whether the UI
says “branch” or “fork.”

The backport does **not** introduce a `HistoryBackend` that writes
`.deck/history/steps/<hash>.json`. Replacing jj with native S3 History objects
would require a new traversal, restore, blame, compaction, pagination, and
migration engine. That is a possible future backend, not a prerequisite for
branching or the AWS deployment.

## 3. Storage contracts

Boxel implements four small storage boundaries. History remains behind deckd's
existing History API rather than entering the object-store interface:

```ts
interface WorkspaceFS {
  // POSIX-compatible source, jj repository, and index-staging operations.
}

interface ObjectStore {
  putIfAbsent(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
}

interface RefStore {
  read(key: string): Promise<{ bytes: Uint8Array; token: string } | undefined>;
  compareAndSwap(
    key: string,
    expectedToken: string | undefined,
    bytes: Uint8Array,
  ): Promise<void>;
}

interface IndexGenerationStore {
  publishIfAbsent(hash: string, sourceDirectory: string): Promise<void>;
  materialize(hash: string, destinationDirectory: string): Promise<void>;
}
```

The `RefStore` token is a local generation under the filesystem backend and an
S3 ETag under the AWS backend. Callers do not branch on token kind.

deckd remains the History boundary:

```ts
interface HistoryBackend {
  ensure(dir: string): Promise<void>;
  settle(dir: string, metadata: StepMetadata): Promise<HistoryHead>;
  list(dir: string): Promise<StepSummary[]>;
  fileAt(dir: string, historyHead: HistoryHead, path: string): Promise<bytes>;
  restore(dir: string, historyHead: HistoryHead): Promise<RestorePlan>;
  fork(
    sourceDir: string,
    sourceHead: HistoryHead,
    targetDir: string,
  ): Promise<void>;
}
```

The TypeScript shape is illustrative; the implemented HTTP contract remains
authoritative until Deck Core exposes an equivalent library boundary.

## 4. Boxel Desktop

Boxel Desktop runs the entire stack on an ordinary filesystem. The packaged
application includes and supervises deckd; the user does not install or operate
a separate daemon or cloud service.

The local settlement discipline is:

```text
write immutable objects
  → write ref.json.tmp
  → fsync temporary file
  → verify expected local generation
  → atomic rename over ref.json
  → fsync containing directory
```

An in-process/host mutex serializes each branch writer. The compare-and-swap
contract remains useful even for one person: two windows, agents, auto-save,
restore, and indexing may all overlap.

SQLite and local index files are derived. A branch head becomes visible only
after its named index generation is complete.

## 5. Hosted AWS

Hosted Boxel uses one realm-contained S3 namespace through two deliberately
separate interfaces:

```text
S3 Files / POSIX interface            Direct S3 object interface
──────────────────────────────        ────────────────────────────────
<realm>/source                        <realm>/.deck/store/…
<realm>/.deck/history/repo (jj)       <realm>/.deck/indexes/…
<realm>/.deck/branches/*/…            <realm>/.deck/refs/…
index build/staging files             <realm>/.deck/reviews/…
deckd filesystem locks               all conditional protocol writes
```

S3 Files gives realm-server, indexer, agent jobs, and deckd the normal POSIX
API they already expect. In particular, deckd writes the selected branch's
`.deck/history/repo` through the mounted filesystem; it does not issue direct
S3 object calls for jj internals.

Agents may read all realm-owned Deck resources as ordinary files. This makes
branch heads, Checkpoints, Reviews, index manifests, and History inspectable.
Their POSIX principal has these write rules:

```text
authored source                         read/write
selected .deck/history/repo            deckd read/write; agent read-only
.deck/branches/*/index-staging         indexer read/write
.deck/store, indexes, refs, reviews,
  releases                             read-only through S3 Files
```

Only the realm service's direct-S3 credentials write the last row. POSIX mode,
NFS export/access-point policy, and process credentials enforce the boundary;
a UI convention is not sufficient. Direct S3 writes become visible through S3
Files for inspection, but a coordination decision reads the direct object API
because the mounted read may lag synchronization.

Direct S3 operations implement the collaboration protocol:

- immutable object: `If-None-Match: *`;
- existing branch ref: `If-Match: <observed ETag>`;
- new branch ref: `If-None-Match: *`;
- stale precondition: concurrency conflict, never last-writer-wins.

Bucket policy should require conditional headers on mutable branch, Review,
event-head, counter, and published-ref prefixes.
The protocol subtrees are readable through both interfaces but writable only
through direct S3. This avoids cross-interface write conflict while preserving
the ordinary-file affordance for agents.

AWS operational rules:

1. one coordinated deckd writer owns a branch workspace at a time;
2. a lease/router may choose that writer, but the conditional branch ref is
   the durable concurrency authority;
3. deckd/jj filesystem locks protect the repository on its mounted filesystem;
4. no two hosts may write the same `.deck/history/repo` concurrently;
5. a writer re-reads the branch ref after acquiring ownership and before
   mutating source;
6. Browse, Run, and Review use the Repository/index named by the settled ref,
   not uncommitted bytes observed directly in a worker workspace.
7. an agent attempting a POSIX write below `.deck/store`, `.deck/indexes`,
   `.deck/refs`, `.deck/reviews`, or `.deck/releases` receives a permission
   error.

The required AWS APIs and behavior are documented by AWS:

- [S3 Files](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-files.html)
  supplies the shared POSIX filesystem interface;
- [S3 Files synchronization](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-files-synchronization.html)
  explains filesystem/bucket visibility and conflict behavior;
- [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
  supply create-if-absent and compare-and-swap preconditions.

## 6. Branch head is the settlement point

Normal saves create Steps without Checkpoint ceremony. The target branch-ref
shape therefore separates current settled state from the latest intentional
Checkpoint:

```json
{
  "schema": "deck-branch-head-v2",
  "generation": 184,
  "repositoryHash": "<current settled Repository>",
  "historyHead": "<opaque deckd/jj change identity>",
  "indexGenerationHash": "<completed index generation>",
  "latestCheckpointHash": "<latest intentional Checkpoint or null>"
}
```

`generation` is the logical monotonic generation stored in the object. The
filesystem adapter also checks its local token; the S3 adapter checks the ETag.

Opening a Review captures the current Repository and `historyHead` in a new
Checkpoint. A merge creates a two-parent Checkpoint, advances target History by
one Step, and names one completed candidate index generation. One conditional
target-ref move makes the result visible.

## 7. Branch and index cloning

Creating a branch or fork performs three logical clones:

```text
source Repository ───────────────▶ initial target Repository
source completed index generation ─▶ target generation pointer
source History head ──deckd fork──▶ target branch History repo
```

The target has a distinct branch ref, workspace, History identity, and future
index generations. Immutable CAS objects and an unchanged completed index
generation may be shared. The first target write creates new source state,
History, and an index delta/generation.

Forks crossing authority boundaries must rewrite or regenerate Realm-RRI and
transport-sensitive index entries even when content bytes are shared. Branches
inside one repository normally share authority-neutral index segments.

Directory copy and directory rename are not protocol primitives. They become
proportional to repository size on object storage. Manifest/ref sharing keeps
the authoritative clone proportional to changed package/card subgraphs; S3
Files may materialize working bytes asynchronously.

## 8. Settled save protocol

The branch writer serializes this operation:

1. acquire branch writer ownership and read the branch ref plus token;
2. create a prepared transaction record naming the observed ref;
3. mutate authored files through `WorkspaceFS`;
4. ask deckd to settle exactly one Step and return `historyHead`;
5. write missing blobs, trees, lock, and current Repository objects;
6. build and publish a completed private index generation;
7. compare-and-swap the branch ref to the new Repository, `historyHead`, and
   index generation;
8. mark the prepared transaction complete and emit best-effort wake-up events.

Events warm caches and projections; they never establish correctness.

A crash can leave workspace bytes, a jj Step, or immutable candidate objects
ahead of the settled ref. Recovery reads the prepared record and either
idempotently completes the same ref move or restores the workspace to the
settled `historyHead`. It must not advertise a half-indexed source tree.

## 9. Merge protocol

1. bind exact base, source, and target Checkpoints;
2. acquire target writer ownership and revalidate the target branch ref;
3. run `mergeTrees` plus structural lock/card merges;
4. write a prepared target transaction;
5. apply the target write batch through `WorkspaceFS`;
6. ask deckd to settle one target merge Step;
7. write the candidate Repository and completed target index generation;
8. write the two-parent Checkpoint containing the target `historyHead`;
9. compare-and-swap the target branch ref;
10. append the merged Review event idempotently.

A stale target detected before the write batch aborts without mutation. A crash
after target mutation follows the same prepared-transaction recovery rule as a
save. Retrying a completed merge returns the existing merge Checkpoint and does
not create a second Step.

## 10. Backport requirement

The Boxel backport is incomplete until both backends pass the same behavioral
suite:

- local filesystem immutable writes and ref CAS;
- deckd/jj History at `.deck/history/repo` on local storage;
- deckd/jj History at `.deck/history/repo` through S3 Files;
- one coordinated History writer per branch and no cross-branch restore;
- S3 `If-None-Match` immutable-write races;
- S3 `If-Match` branch-ref races;
- agent POSIX reads of realm-local protocol files and rejected POSIX writes;
- direct-S3 updates becoming inspectable through the realm's S3 Files view;
- branch creation with a distinct History repo and cloned index generation;
- recovery after source/History write but before ref publication;
- recovery after candidate index publication but before ref publication;
- one merge Step and one two-parent Checkpoint;
- stale merge leaves the target ref unchanged;
- local and AWS canonical collaboration bytes and hashes are identical.

Production S3 Files access points/mounts, prefix ownership, conditional-write
bucket policy, writer routing, metrics, backup, and recovery drills are
backport deliverables—not a post-backport operations exercise.

## 11. Future option: native object History

A future deckd backend could encode History directly as immutable S3 objects.
Potential advantages are stateless readers, object-level multi-writer CAS, and
cheap ancestry sharing. Costs are a new History engine, per-object request
latency, pagination/compaction design, restore/blame parity, and migration away
from the proven jj implementation.

That option must preserve the `HistoryBackend` behavior and `.deck/history/`
product identity. It is explicitly outside this backport.

## 12. Non-goals

- S3 Versioning is recovery defense, not Deck History.
- S3 Files alone is not the collaboration protocol.
- A bucket-global protocol tree outside the realm is not permitted.
- NFS locks alone are not distributed branch truth.
- Postgres/SQLite indexes are projections, not source authority.
- Git packfiles and a replay-only WAL are not Deck's collaboration format,
  even though jj's internal History backend uses Git objects.
- A Deck Pack remains an interchange artifact; branches and merges operate on
  live source, jj History, CAS trees, Repository states, and Checkpoints.
