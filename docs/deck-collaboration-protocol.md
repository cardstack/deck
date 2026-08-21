# Deck collaboration protocol

There is no separate kind of thing called a “Deck Repository.” A mutable Deck
package is already a repository: it can be forked, branched, reviewed, and
merged. The Checkpoint, ref, and review objects in this document are the durable
collaboration layer for packages.

`.deck/repository.json` handles only the additional case where several packages
must advance atomically. That is Deck’s content-addressed equivalent of a
traditional monorepo—not an opt-in required for ordinary package work.

Imported packages are immutable inputs. They do not acquire a writable branch
in place: forking materializes the chosen exact Version under a new package
identity, records its base tree, and initializes that mutable package's
`main`. Branch and fork therefore share ancestry and merge mechanics while
preserving different ownership boundaries.

When the source is itself mutable, a fork also records the exact source
Checkpoint. Opening a cross-owner Review uses that Checkpoint as the three-way
merge base. The Review retains the fork endpoint as authored metadata, but
normalizes its one package tree into the upstream package member key before
preview and merge. Imported packages have no mutable upstream Checkpoint, so a
fork of an import begins an independent repository rather than advertising a
fake upstream Review. The Hub derives this base from the fork's stored lineage;
it does not trust a browser-supplied Checkpoint hash.

**Status: RRI/CHECKPOINT PROTOCOL IS THE ONLY SUPPORTED COLLABORATION FORMAT.**
Deck makes a clean cutover before Boxel A0: durable member/root identities are
scoped RRIs and intentional collaboration points use `deck-checkpoint-v2`.
There is no V1 compatibility reader or legacy write surface. This document defines
the durable objects beneath Deck's familiar repository, branch, fork, Review,
and merge UX. The protocol deliberately introduces no new product
noun. A repository containing several member packages is simply a monorepo.

Companions: [`deck-laws.md`](deck-laws.md),
[`deck-package-json-and-depot-lock.md`](deck-package-json-and-depot-lock.md),
[`deck-cas-packages-vs-monorepos.md`](deck-cas-packages-vs-monorepos.md), and
[`deck-fork-merge-pr-ux.md`](deck-fork-merge-pr-ux.md). The Boxel mapping—one
realm with multiple branch-specific source states, indexes, and Histories—is
specified in
[`deck-boxel-branch-index-backport.md`](deck-boxel-branch-index-backport.md).

---

## 0. Ruling

> **A Repository is the atomic collaboration boundary. A package remains the
> independently addressable execution and release boundary.**

A Repository Checkpoint can therefore change one package or many packages. It
does not combine their source into one giant package and it does not make
their dependency identities disappear.

```text
Branch ── mutable compare-and-swap head ──▶ Repository
  │                                           │
  ├── historyHead ──▶ deckd/jj Step           ├── root RRIs
  └── latestCheckpoint ──▶ Checkpoint ────────┤
                                              ├── member package RRI → treeHash
                                              └── lockHash
                                                      │
                                                      ▼
                                                 exact import map
```

The UI says Repository, Checkpoint, Branch, Fork, Review, and Merge.
`deck-repository-v2` is only a wire-format name.

Runnable walkthrough: [`deck-repository-tour.md`](deck-repository-tour.md).

The real Hub exposes Repository identity and branches in `/browse`, beside the
packages they govern. Proposed changes move to `/review`, where familiar forge
labels remain and **Underneath** reveals the exact objects and paths. A
preview is an immutable Version projection of the proposed Repository, handed
to the existing `/run` resolver with explicit dependency substitutions. A
review link hands the same projection to `/browse` with an exact base Version.
Neither surface reconstructs repository state independently.

## 1. Existing identities remain intact

The Repository layer is above Deck's existing package laws:

- `treeHash` still identifies one package tree.
- a Version still points to a package `treeHash`.
- `package.json` still declares package identity and dependency ranges.
- the canonical composition of applicable import maps is still the exact
  execution lock.
- blobs and package trees remain content addressed and shared.

The new layer answers a different question: **which exact package trees and
lock were reviewed and landed together?**

## 2. Exact lock object

The lock object is the canonical composed resolution result for the authored
realm tree, encoded with Deck canonical JSON and addressed by SHA-256. Its
inputs may include a root `importmap.json`, nested package/app import maps, and
their declared inheritance. It includes the effective `imports`, `scopes`,
`integrity`, and Deck-owned lock policy. Exact Version RRIs are values;
importer RRIs are scope keys. `package.json` remains conventional package
metadata and dependency suggestion; it is not itself the exact lock.

```text
lockHash = sha256(canonical-json(compose(authored import maps)))
```

This is not another dependency decision or a parallel lock. For native ESM,
Deck deterministically projects the same lock into a standard browser import
map whose targets and scopes are absolute transport URLs. The RRI lock is the
portable reviewed authority; the URL map is a derived delivery artifact.
Storing the canonical lock by hash makes exact resolution closed over by a
Repository and reconstructable on another machine without baking one host's
origin into authored history.

Deck accepts standard authored import maps at the authoring boundary. Before
hashing, it removes the transport projector: a target such as
`/site/acme/theme@2.1.0/index.js` becomes
`@acme/theme@2.1.0/index.js`, relative targets resolve against the root RRI,
and URL-form values never enter the stored lock. Delivery later performs the
inverse projection for the serving authority.

## 3. Repository membership

A hosted forge may project repository membership into authenticated query
metadata. The canonical authoring manifest remains inside the owning realm at
`.deck/repository.json`, so an agent can inspect and move the realm without a
parallel service tree:

```json
{
  "schema": "deck-repository-manifest-v2",
  "roots": ["@acme/dashboard/"],
  "members": {
    "@acme/editor/": "acme/editor",
    "@acme/theme/": "acme/theme",
    "@acme/dashboard/": "app/dashboard"
  }
}
```

The manifest maps canonical member RRIs to local authoring paths. Those paths
are placement intent, not durable identity. Sealing resolves each member to a
`treeHash` and the effective composed resolution state to a `lockHash`.

## 4. `deck-repository-v2`

```json
{
  "schema": "deck-repository-v2",
  "roots": ["@acme/dashboard/"],
  "members": {
    "@acme/editor/": "<treeHash>",
    "@acme/theme/": "<treeHash>",
    "@acme/dashboard/": "<treeHash>"
  },
  "lockHash": "<sha256>"
}
```

- `roots` contains runnable or publishable package RRIs. Every root must be a
  member.
- `members` maps independently addressable package RRI roots to exact package
  trees. Membership means “may change and land atomically,” not “is imported
  at runtime.”
- `lockHash` names the exact runtime closure.

Member RRIs and roots are sorted in canonical form. A Repository must have at
least one member. Hashes are lowercase SHA-256 hex.

Repository writers require scoped RRI roots. URL-form identities and bare
`owner/package` member keys are invalid protocol input.

```text
dependency edge = this package is needed to run
member edge     = this package may change and land with this repository
```

External dependencies occur in the lock but not in `members`. A repository
with one member is ordinary. A repository with several members is a monorepo.

## 5. `deck-checkpoint-v2`

```json
{
  "schema": "deck-checkpoint-v2",
  "repositoryHash": "<sha256>",
  "parents": ["<checkpointHash>"],
  "historyHead": "<opaque deckd/jj change identity>",
  "indexGenerationHash": "<sha256>",
  "author": {
    "id": "@chris:example.test",
    "name": "Chris"
  },
  "message": "Add compact editor density",
  "createdAt": "2026-08-20T00:00:00.000Z"
}
```

A Checkpoint is immutable and content addressed. Parent order is meaningful:
the first parent is the target line; the second parent of a merge is the
source line. Two authored events may point at the same Repository hash.

This separation preserves both useful identities:

- Repository hash: “are the executable bytes and resolution identical?”
- Checkpoint hash: “is this the same history event?”

`historyHead` binds the intentional collaboration point to the exact
every-save History state that produced it. It is opaque to the collaboration
protocol. `indexGenerationHash` binds the exact Browse/Run projection reviewed
with that state. A normal save creates a deckd/jj Step and advances the branch
head; it does not write a Checkpoint. Opening a Review, explicitly naming a
milestone, and merging do write Checkpoints.

The API and storage vocabulary is Checkpoint throughout:
`deck-checkpoint-v2`, `checkpointHash`, and `_checkpoints/`. There is no
Revision alias.

## 6. Branches and forks

A branch head is mutable metadata and is also the settlement point for source,
History, and the completed index:

```json
{
  "schema": "deck-branch-head-v2",
  "generation": 7,
  "repositoryHash": "<sha256>",
  "historyHead": "<opaque deckd/jj change identity>",
  "indexGenerationHash": "<sha256>",
  "latestCheckpointHash": "<sha256 or null>"
}
```

Ref address:

```text
<realm-root>/.deck/refs/heads/<branch-token>.json
```

The realm root supplies owner/repository identity. A branch ref must not float
in a bucket-global namespace. A cross-owner fork gets a new destination realm
and therefore a new realm-local `.deck/` namespace.

The update contract is compare-and-swap:

```text
update(ref, expectedGeneration, nextHead)

current generation == expected  → write next head
current generation != expected  → conflict; write nothing
```

Same owner and repository is presented as a branch. A different owner is
presented as a fork. Both use isolated refs and identical ancestry rules.

For a single-package cross-owner Review, source and target package identities
differ by design. Deck records an immutable normalized source Checkpoint whose
member key is the target package and whose tree is the fork's current tree.
The Review still names the real source endpoint. Existing preview,
three-way merge, and target-ref compare-and-swap then operate unchanged.

## 7. Merge

A merge produces package trees first, then one Repository, then one Checkpoint:

```text
base Repository ─┐
target Repository ├─ merge changed package trees + lock
source Repository ┘                 │
                                    ▼
                         new Repository hash
                                    │
                                    ▼
                  Checkpoint(parents=[target, source])
                                    │
                                    ▼
                    CAS update target branch ref
```

If two packages change, both new tree hashes enter one Repository object. The
branch moves once. A reader can observe the old repository or the new one,
never half of either.

The package merge algorithm remains `mergeTrees`. Repository merge adds:

1. member-set merge;
2. per-member tree merge where both sides changed;
3. lock merge or deterministic re-lock;
4. one final branch compare-and-swap.

Conflicts are qualified by member RRI, for example
`@acme/editor/index.js`. A conflicted merge writes no Repository, Checkpoint,
branch ref, or Review state. Immutable package objects produced while
planning may already exist and are harmless because no ref reaches them.

## 8. At-rest layout

Each realm owns its protocol data. A host may physically aggregate realms in
one bucket, but no Deck resource floats in a parallel protocol tree:

- For an ordinary one-package Repository, the package directory is the realm
  root and its `.deck/` belongs to that package alone.
- For an explicit multi-package Repository, the directory containing
  `.deck/repository.json` is the realm root and owns the shared atomic state.

```text
<realm-root>/.deck/
├── store/
│   ├── _objects/                         file blobs
│   ├── _trees/                           package trees
│   ├── _locks/<hh>/<lockHash>.json       exact import maps
│   ├── _repositories/<hh>/<hash>.json    Repository objects
│   └── _checkpoints/<hh>/<hash>.json     Checkpoint objects
├── refs/heads/<branch-token>.json        mutable branch heads
├── reviews/
│   ├── objects/<hh>/<hash>.json          immutable Review openings
│   ├── events/<hh>/<hash>.json           append-only Review events
│   ├── numbers/<n>.json                  mutable numbered Review refs
│   └── counter.json                      mutable number allocator
├── indexes/<hh>/<generationHash>/…       completed index generations
├── releases/objects/<hh>/<hash>.json     immutable published Releases
└── history/repo/                         default-branch deckd/jj History
```

Locks, repositories, and Checkpoints are immutable write-once objects. Mutable
branch heads, Review number refs/counters, and event heads need coordination.

## 9. Local and S3 Files persistence

### Local Deck

- Content-addressed writes use temporary file plus rename.
- A branch update holds a per-ref exclusive directory lock, verifies the
  expected generation, and atomically renames the new ref.
- A failed expectation writes nothing.

The local daemon should be the normal ref writer. A leftover lock after an
unclean process exit is an operational condition to inspect, not something a
second writer silently steals.

### Deck with S3 Files

S3 Files is the hosted POSIX substrate for live package directories, index
staging, and deckd's jj repository at `.deck/history/repo`. It is not the
authority for mutable collaboration refs. The complete local/AWS split is
specified in [`deck-storage-backends.md`](deck-storage-backends.md).

- Immutable blobs, trees, locks, repositories, Checkpoints, Reviews, and
  completed index generations are written through direct S3 with
  `If-None-Match: *`. S3 Files exposes them read-only for agent inspection.
- Branch and Review refs are read and written through the S3 object API.
- Immutable request openings, events, and numbered refs are created with
  `If-None-Match: *`.
- Branch refs, the realm-local Review counter, and Review
  event heads move with `If-Match: <observed ETag>`.
- A precondition failure is a concurrency conflict. Number and event writers
  reread and retry; a branch move reports the conflict to the merge caller.
- Agents may read these realm-local objects as files through S3 Files. Their
  POSIX principal cannot write `store/`, `indexes/`, `refs/`, or `reviews/`;
  only the realm service's direct-S3 credentials mutate those subtrees.
- Coordination reads use the direct object API. S3 Files reads are an
  inspectable projection and may lag bucket synchronization.

This is the small durable coordination layer Deck needs: realm-local immutable
objects plus conditional ref mutation. It is not a Git origin and does not
require a Git server or commit-shaped history service.

## 10. Reviews

A `deck-review-v2` opening durably names:

- source repository ref and captured source Checkpoint;
- target repository ref and captured target Checkpoint;
- author, title, body, and creation time.

It must not contain package bytes. Those are already named by Repository and
tree hashes.

The opening is immutable and content addressed. A numbered mutable ref at
`.deck/reviews/numbers/<number>.json` names the opening, the newest event, its
generation, and the visible state (`open`, `merged`, or `closed`). Events form
an immutable backward chain:

```text
Review #1 ref
        │
        ▼
merged ──▶ merge-started ──▶ reviewed ──▶ source-updated
```

`source-updated` captures the new exact source Checkpoint. `reviewed` binds its
verdict to a Checkpoint. `merge-started` records the prepared two-parent merge
Checkpoint before the target branch moves. `merged` records completion.

The two-event merge sequence makes local recovery idempotent:

1. write the merged Repository and merge Checkpoint;
2. append `merge-started(mergeCheckpointHash)`;
3. compare-and-swap the target branch;
4. append `merged(mergeCheckpointHash)`.

If the process stops after step 2 or 3, the next merge call reads
`merge-started`, completes the missing ref update, and appends `merged`. It
never creates a second merge Checkpoint.

The API, paths, and wire objects use Review throughout. GitHub pull requests
may be produced later as a syndicated representation, but are not a Deck
protocol alias.

Preview runs the same Repository merge engine as Merge, using the captured
target as base, the current target as “ours,” and the captured or explicitly
updated source as “theirs.” Therefore a clean preview and its immediate merge
name the same Repository hash.

## 11. Implementation status

| Layer                                                    | Status                                          |
| -------------------------------------------------------- | ----------------------------------------------- |
| RRI-native Repository, Checkpoint, and branch head       | Implemented and tested                          |
| Local compare-and-swap refs                              | Implemented and tested                          |
| Conditional object-store branch adapter for S3           | Implemented and tested                          |
| Multi-package Repository merge                           | Implemented and tested                          |
| Review opening/events/preview/merge                      | Implemented and tested locally                  |
| Crash recovery across branch + Review refs               | Implemented                                     |
| Realm-owned `.deck/repository.json` discovery            | Implemented                                     |
| Agent CLI: init, branch, checkpoint, Review, merge       | Implemented and tested                          |
| Generic Hub Browse and Review projection                 | Implemented against current objects             |
| Replay-built multi-package validation realm and tour     | Implemented; current APIs recreate and assert it |
| Hosted authentication and authorization                  | Not implemented                                 |
| Signed checks and required-review policy                 | Event shape exists; enforcement not implemented |
| Realm-local conditional Review numbering/opening         | Implemented and tested                          |
| Conditional Review event-head adapter                    | Required by B1                                  |
| Production AWS object adapters and S3 Files/deckd wiring | Required by backport; not yet implemented       |
| Hosted multi-user Hub authorization/policy UI            | Specified, not implemented                      |

The validation depot is the architectural test. UX must not invent state the protocol
cannot reproduce.
