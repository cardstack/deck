# Deck collaboration protocol

There is no separate kind of thing called a “Deck Repository.” A mutable Deck
package is already a repository: it can be forked, branched, reviewed, and
merged. The Revision, ref, and review objects in this document are the durable
collaboration layer for packages.

`repository.json` handles only the additional case where several packages
must advance atomically. That is Deck’s content-addressed equivalent of a
traditional monorepo—not an opt-in required for ordinary package work.

Imported packages are immutable inputs. They do not acquire a writable branch
in place: forking materializes the chosen exact Version under a new package
identity, records its base tree, and initializes that mutable package's
`main`. Branch and fork therefore share ancestry and merge mechanics while
preserving different ownership boundaries.

When the source is itself mutable, a fork also records the exact source
Revision. Opening a cross-owner Review uses that Revision as the three-way
merge base. The Review retains the fork endpoint as authored metadata, but
normalizes its one package tree into the upstream package member key before
preview and merge. Imported packages have no mutable upstream Revision, so a
fork of an import begins an independent repository rather than advertising a
fake upstream Review. The Hub derives this base from the fork's stored lineage;
it does not trust a browser-supplied Revision hash.

**Status: PROTOCOL V1 — local reference implementation plus conditional object
store adapters.** This document defines the durable objects beneath Deck's
familiar repository, branch, fork, pull request, and merge UX. The protocol
deliberately introduces no new product noun. A repository containing several
member packages is simply a monorepo.

Companions: [`deck-laws.md`](deck-laws.md),
[`deck-package-json-and-depot-lock.md`](deck-package-json-and-depot-lock.md),
[`deck-cas-packages-vs-monorepos.md`](deck-cas-packages-vs-monorepos.md), and
[`deck-fork-merge-pr-ux.md`](deck-fork-merge-pr-ux.md).

---

## 0. Ruling

> **A Repository is the atomic collaboration boundary. A package remains the
> independently addressable execution and release boundary.**

A Repository Revision can therefore change one package or many packages. It
does not combine their source into one giant package and it does not make
their dependency identities disappear.

```text
Branch
  │ mutable compare-and-swap ref
  ▼
Revision
  │ immutable authored history event
  ▼
Repository
  ├── roots
  ├── member package name → treeHash
  └── lockHash
          │
          ▼
     exact import map
```

The UI says Repository, Revision, Branch, Fork, Pull request, and Merge.
`deck-repository-v1` is only a wire-format name.

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
- the depot's `importmap.json` is still the exact execution lock.
- blobs and package trees remain content addressed and shared.

The new layer answers a different question: **which exact package trees and
lock were reviewed and landed together?**

## 2. Exact lock object

The lock object is the parsed JSON value of the depot's exact
`importmap.json`, encoded with Deck canonical JSON and addressed by SHA-256.
It includes `imports`, `scopes`, `integrity`, and any Deck-owned lock policy.

```text
lockHash = sha256(canonical-json(importmap.json))
```

This is not another lock format. The browser import map remains the executable
artifact. Storing it by hash makes the exact resolution closed over by a
Repository and reconstructable on another machine.

## 3. Repository membership

A hosted forge may keep repository membership as ordinary authenticated
metadata. Local Deck uses a small authoring manifest so it can reconstruct the
same boundary without a service:

```json
{
  "schema": "deck-repository-manifest-v1",
  "roots": ["app/dashboard"],
  "members": ["acme/editor", "acme/theme", "app/dashboard"]
}
```

The manifest contains intent, not resolved identity. Sealing resolves each
member to a `treeHash` and the import map to a `lockHash`.

## 4. `deck-repository-v1`

```json
{
  "schema": "deck-repository-v1",
  "roots": ["app/dashboard"],
  "members": {
    "acme/editor": "<treeHash>",
    "acme/theme": "<treeHash>",
    "app/dashboard": "<treeHash>"
  },
  "lockHash": "<sha256>"
}
```

- `roots` names runnable or publishable entry packages. Every root must be a
  member.
- `members` maps independently addressable package names to exact package
  trees. Membership means “may change and land atomically,” not “is imported
  at runtime.”
- `lockHash` names the exact runtime closure.

Names and roots are sorted in canonical form. A Repository must have at least
one member. Hashes are lowercase SHA-256 hex.

```text
dependency edge = this package is needed to run
member edge     = this package may change and land with this repository
```

External dependencies occur in the lock but not in `members`. A repository
with one member is ordinary. A repository with several members is a monorepo.

## 5. `deck-revision-v1`

```json
{
  "schema": "deck-revision-v1",
  "repositoryHash": "<sha256>",
  "parents": ["<revisionHash>"],
  "author": {
    "id": "@chris:example.test",
    "name": "Chris"
  },
  "message": "Add compact editor density",
  "createdAt": "2026-08-20T00:00:00.000Z"
}
```

A Revision is immutable and content addressed. Parent order is meaningful:
the first parent is the target line; the second parent of a merge is the
source line. Two authored events may point at the same Repository hash.

This separation preserves both useful identities:

- Repository hash: “are the executable bytes and resolution identical?”
- Revision hash: “is this the same history event?”

## 6. Branches and forks

A branch ref is mutable metadata:

```json
{
  "schema": "deck-ref-v1",
  "revisionHash": "<sha256>",
  "generation": 7
}
```

Ref address:

```text
_refs/<owner>/<repository>/heads/<branch>.json
```

The update contract is compare-and-swap:

```text
update(ref, expectedRevision, nextRevision)

current == expected  → write next
current != expected  → conflict; write nothing
```

Same owner and repository is presented as a branch. A different owner is
presented as a fork. Both use isolated refs and identical ancestry rules.

For a single-package cross-owner Review, source and target package identities
differ by design. Deck records an immutable normalized source Revision whose
member key is the target package and whose tree is the fork's current tree.
The Pull Request still names the real source endpoint. Existing preview,
three-way merge, and target-ref compare-and-swap then operate unchanged.

## 7. Merge

A merge produces package trees first, then one Repository, then one Revision:

```text
base Repository ─┐
target Repository ├─ merge changed package trees + lock
source Repository ┘                 │
                                    ▼
                         new Repository hash
                                    │
                                    ▼
                  Revision(parents=[target, source])
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

Conflicts are qualified by member package, for example
`acme/editor/index.js`. A conflicted merge writes no Repository, Revision,
branch ref, or pull-request state. Immutable package objects produced while
planning may already exist and are harmless because no ref reaches them.

## 8. At-rest layout

The first local implementation extends the existing depot store:

```text
.deck/store/
├── _objects/                         file blobs (existing)
├── _trees/                           package trees (existing)
├── _locks/<hh>/<lockHash>.json       exact import maps
├── _repositories/<hh>/<hash>.json    Repository objects
├── _revisions/<hh>/<hash>.json       Revision objects
├── _refs/<owner>/<repo>/heads/*.json mutable branch refs
├── _pull_requests/<hh>/<hash>.json   immutable request openings
├── _pull_request_events/<hh>/*.json  append-only request events
├── _pulls/<owner>/<repo>/<n>.json    mutable numbered request refs
└── _pulls/<owner>/<repo>/_counter.json mutable number allocator
```

Locks, repositories, and revisions are immutable write-once objects. Only refs
need coordination.

## 9. Local and S3 Files persistence

### Local Deck

- Content-addressed writes use temporary file plus rename.
- A branch update holds a per-ref exclusive directory lock, verifies the
  expected Revision, and atomically renames the new ref.
- A failed expectation writes nothing.

The local daemon should be the normal ref writer. A leftover lock after an
unclean process exit is an operational condition to inspect, not something a
second writer silently steals.

### Deck with S3 Files

S3 Files is appropriate for live/materialized package directories and local
tool compatibility. It is not the authority for mutable collaboration refs.

- Immutable blobs, trees, locks, repositories, and revisions may be uploaded
  through S3 or materialized through S3 Files; their hashes detect damage.
- Branch and pull-request refs are read and written through the S3 object API.
- Immutable request openings, events, and numbered refs are created with
  `If-None-Match: *`.
- Branch refs, the repository-local Pull Request counter, and Pull Request
  event heads move with `If-Match: <observed ETag>`.
- A precondition failure is a concurrency conflict. Number and event writers
  reread and retry; a branch move reports the conflict to the merge caller.

This is the small “origin” Deck needs: durable immutable objects plus
conditional ref mutation. It does not require a Git server, routing database,
or consensus service.

## 10. Pull requests

A `deck-pull-request-v1` opening durably names:

- source repository ref and captured source Revision;
- target repository ref and captured target Revision;
- author, title, body, and creation time.

It must not contain package bytes. Those are already named by Repository and
tree hashes.

The opening is immutable and content addressed. A numbered mutable ref at
`_pulls/<owner>/<repo>/<number>.json` names the opening, the newest event, its
generation, and the visible state (`open`, `merged`, or `closed`). Events form
an immutable backward chain:

```text
Pull request #1 ref
        │
        ▼
merged ──▶ merge-started ──▶ reviewed ──▶ source-updated
```

`source-updated` captures the new exact source Revision. `reviewed` binds its
verdict to a Revision. `merge-started` records the prepared two-parent merge
Revision before the target branch moves. `merged` records completion.

The two-event merge sequence makes local recovery idempotent:

1. write the merged Repository and merge Revision;
2. append `merge-started(mergeRevisionHash)`;
3. compare-and-swap the target branch;
4. append `merged(mergeRevisionHash)`.

If the process stops after step 2 or 3, the next merge call reads
`merge-started`, completes the missing ref update, and appends `merged`. It
never creates a second merge Revision.

Preview runs the same Repository merge engine as Merge, using the captured
target as base, the current target as “ours,” and the captured or explicitly
updated source as “theirs.” Therefore a clean preview and its immediate merge
name the same Repository hash.

## 11. Implementation status

| Layer                                                | Status                                          |
| ---------------------------------------------------- | ----------------------------------------------- |
| Canonical Repository, Revision, branch ref           | Implemented and tested                          |
| Local compare-and-swap refs                          | Implemented and tested                          |
| Conditional object-store branch adapter for S3       | Implemented and tested                          |
| Multi-package Repository merge                       | Implemented and tested                          |
| Durable Pull Request opening, events, preview, merge | Implemented and tested locally                  |
| Crash recovery across branch + Pull Request refs     | Implemented                                     |
| Depot-owned `repository.json` discovery              | Implemented                                     |
| Agent CLI: init, branch, commit, review, merge       | Implemented                                     |
| Generic Hub Browse and Review projection             | Implemented                                     |
| Multi-package validation depot and guided tour       | Implemented                                     |
| Hosted authentication and authorization              | Not implemented                                 |
| Signed checks and required-review policy             | Event shape exists; enforcement not implemented |
| S3 Pull Request numbering, creation, and event refs  | Implemented and tested                          |
| Production AWS client, credentials, and Hub wiring   | Not implemented                                 |
| Production Hub repository UI                         | Specified, not implemented                      |

The validation depot is the architectural test. UX must not invent state the protocol
cannot reproduce.
