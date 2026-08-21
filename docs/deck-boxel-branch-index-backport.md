# Multi-branch realms — Deck backport design

**Status: RULING** (2026-08-21). This is the Boxel backport shape implied by
Deck branches. It refines the History backport plan; it does not introduce a
second repository protocol.

Companions: [`deck-collaboration-protocol.md`](deck-collaboration-protocol.md),
[`deck-boxel-backport-for-team.md`](deck-boxel-backport-for-team.md), and
[`deck-boxel-backport-changelist-mockup.md`](deck-boxel-backport-changelist-mockup.md).
Local filesystem and hosted AWS persistence are binding in
[`deck-storage-backends.md`](deck-storage-backends.md).
Host-mode publication and browser delivery are specialized in
[`deck-boxel-host-publish-treehash.md`](deck-boxel-host-publish-treehash.md).

---

## 0. Ruling

> A Boxel realm is one repository identity with one default branch and zero or
> more additional branches. Each branch has its own mutable source state,
> History, and index. Creating a branch or fork clones the selected source
> state **and its index**. Merging applies one reviewed change set to the target
> branch through the target realm's normal write path and records one History
> Step.

This keeps the familiar model:

- **branch**: another line of work inside the same realm, permissions, and
  ownership boundary;
- **fork**: the same operation across a new realm identity and ownership
  boundary;
- **Review**: exact source and target Checkpoints plus their indexed previews;
- **merge**: one atomic target mutation, one target reindex transaction, and
  one target History Step.

The index clone is an implementation operation, not a new protocol object. A
branch is still a mutable ref to source history. Boxel happens to maintain a
derived index beside each branch so Browse, Run, search, and previews remain
real.

```text
Realm acme/app
  │
  ├── main ───────── source state M3 ───────── index M3 ───────── History
  │                       ▲                         ▲
  │                       │ one merge batch         │ one index transaction
  │                       └──────────────┬──────────┘
  │                                      │
  └── improve-nav ─ source state B7 ─ index B7 ─ History
                         │                 │
                         └──── Review ─────┘

create branch: clone source state M3 + clone index M3; then diverge
merge review:  apply B7 − base to main once; append one Step to main
```

### 0.1 Execution decisions

These choices close the readiness questions. They are implementation inputs,
not another protocol layer.

| ID      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1**  | Cut a stack, not one feature-set PR: **R0** Deck RRI/Checkpoint/realm-relative path gate; **A0** current Lean Core vendor from that exact commit; **A1** resolver/scopes; **A2** versioned serve door; **A3** thin decklist verbs. Then cut **B0–B7** below. Each PR must be independently reviewable and green.                                                                                                                                              |
| **Q2**  | Start every Boxel PR from fetched `origin/main`. Re-vendor Deck Core at the chosen current Deck commit. Transplant the proven Map tests and small adapter changes from `deck/at-rest-poc`; do not replay the fork's commits, realm-global jj History, Atlas rewrite, or CRM rewrite.                                                                                                                                                                          |
| **Q3**  | Use the reserved Deck transport namespace: default `/<path>`, branch `/__deck/branch/<token>/<path>`, Checkpoint `/__deck/checkpoint/<hash>/<path>`. `<token>` is unpadded base64url of the NFC UTF-8 branch name. The UI always shows the decoded familiar name.                                                                                                                                                                                             |
| **Q4**  | “Clone the index” means publish an independently owned completed generation before the branch appears. Same-realm branches may initially point at the same immutable generation manifest; their first write creates a new generation. Cross-authority forks create a rebased generation. SQL/SQLite rows are rebuildable projections, not the durable generation identity.                                                                                    |
| **Q5**  | Every branch contains its complete authored resolution inputs: conventional package `package.json` files plus any applicable root and nested `importmap.json` files. A Checkpoint hashes their canonical composed exact lock. V1 merges authored files normally, then compares the three composed locks with structural conflict detection; it does not silently re-lock.                                                                                     |
| **Q6**  | Boxel v1 uses Deck's `HistoryBackend` against **deckd**, one supervised daemon per realm-server host. Every branch has a stable opaque source directory and independent jj History at `<branch-source>/.deck/history/repo`; its thin `.jj/repo` pointer is branch-local. `.deck/timeline/` is legacy input only and migrates one way. No `.jj` repository or stub is shared between branches or placed at the host-global root.                               |
| **Q7**  | Import Deck Repository/Checkpoint/ref/Review types and `mergeTrees`; implement Boxel's mutable source, index, cache, job, and event substrate separately. Hub's checkout-less ref swap is not Boxel's realm write path.                                                                                                                                                                                                                                       |
| **Q8**  | Pin index generations for current branch heads, open Reviews, and published Releases. Retain closed/merged Review generations for 30 days. Other exact indexes are derived cache: evictable and rebuilt from the durable source snapshot on demand.                                                                                                                                                                                                           |
| **Q9**  | Add a distinct merge capability. Existing realms remain directly writable on `main` for compatibility; branch protection is opt-in. A protected branch rejects direct mutation and accepts Review merge only from a realm owner or principal with merge capability.                                                                                                                                                                                           |
| **Q10** | Build a private candidate generation for Review/merge. It is the target's next generation, seeded from the exact target generation and updated with the proposed change set. After a target-head recheck, the normal target write transaction publishes that source snapshot and generation once.                                                                                                                                                             |
| **Q11** | Use RRI as the canonical identity from R0 onward. Mutable realms use `@owner/repository/`; exact Versions use `@owner/repository@version/`. Locks, indexes, Repository records, and UI author RRIs. Absolute URLs are derived browser/HTTP projections. Branch and Checkpoint remain `RealmViewContext`, not RRI syntax.                                                                                                                                      |
| **Q12** | AWS is inside the backport and all Deck data is realm-contained under `<realm>/.deck/`. Branch workspaces, index staging, and deckd/jj History use S3 Files. Agents may read all `.deck` files, but POSIX writes to `store/`, `indexes/`, `refs/`, `reviews/`, and `releases/` are denied; only direct S3 conditional writes mutate them. Desktop uses the same contracts over a regular filesystem. One coordinated deckd writer owns each branch workspace. |

The first executable work is **R0 in Deck**. Once its RRI-native V2 Core is
green and committed, the first Boxel branch is **A0 only**, cut from
`origin/main` and pinned to that Deck commit. A1–A3 stack on it. No branch /
index, History, Atlas, host publish, or collaboration UI belongs in A0–A3.

## 1. Why this is below the UI

Today Boxel's index identity is effectively `(realm URL, resource URL, type)`.
`realm_generations` also has one current generation per realm URL. That means
two branches of one logical realm RRI cannot simultaneously contain different
indexed answers for the same resource RRI.

A branch selector alone would therefore be false. Branch support must first
make the live realm, index writer, query engine, cache keys, jobs, and events
branch-aware.

The existing single-realm behavior remains the compatibility case:

```text
realm URL with no branch selector = realm's default branch (normally main)
```

## 2. Identities

Keep these identities separate:

| Identity         | Mutable?        | Meaning                                                    |
| ---------------- | --------------- | ---------------------------------------------------------- |
| Realm RRI        | Stable          | logical repository/package namespace, e.g. `@acme/shop/`   |
| Realm URL        | Stable location | HTTP route and control-plane lookup; not authored identity |
| Branch name      | Mutable ref     | named line of work within a realm                          |
| Source snapshot  | No              | exact files plus exact RRI import-map/dependency lock      |
| History Step     | No              | every-save jj event on one branch                          |
| Checkpoint       | No              | intentional collaboration point with parent Checkpoint(s)  |
| Index generation | No              | derived searchable/renderable view of one branch state     |

A Step and a Checkpoint are not synonyms. Normal UI and agent saves advance the
branch state and append Steps without requiring commit ceremony. A Review
captures exact Checkpoints so its comparison does not move underneath the
reviewer.

`realm.json`, conventional package manifests, and authored import maps are
branch content. Branch heads,
Checkpoints, Reviews, completed index manifests, and Repository objects are
realm-owned files below `<realm>/.deck/`; they are excluded from authored tree
hashes. The stable Realm RRI authority mapping, Realm URL, ownership, ACLs,
default branch, and branch protection may also have authenticated database
projections, but those projections do not relocate the Deck objects outside
the realm.

## 3. Branch state

The minimum durable branch record is conceptually:

```ts
interface RealmBranch {
  id: string;
  realmRRI: RealmIdentifier;
  realmURL: string;
  name: string;
  repositoryHash: string;
  historyHead: string;
  indexGenerationHash: string;
  latestCheckpointHash: string | null;
  refGeneration: number;
  updatedAt: string;
}
```

Moving this record uses compare-and-swap. A writer supplies the branch head it
read; Boxel rejects a stale move instead of silently overwriting concurrent
work.

`id` is an opaque stable identifier. Physical source and History directories
key on it, not on the display name, so renaming a branch does not move storage.
The physical host may keep non-default state at
`<realm>/.deck/branches/<id>/`, but the selected branch realm view always
projects its durable jj store as `/.deck/history/repo`; implementations must
not introduce a Boxel-specific product synonym. A pre-backport
`.deck/timeline/` directory is migrated only when `.deck/history/` is absent;
if both exist, startup refuses to choose.
`refGeneration` is the logical monotonic compare-and-swap generation. The local
adapter also verifies its filesystem token; the AWS adapter verifies the
observed S3 ETag. `historyHead` is deckd/jj state and
`latestCheckpointHash` is the most recent intentional collaboration point;
normal saves advance the former without inventing the latter.

The Repository named by the branch record is the authoritative settled source
snapshot. The mutable workspace is its authoring materialization. For `main`,
that materialization remains the existing realm root. A non-default branch is
the only case that needs the new `.deck/branches/<id>/source/` location. It is
a clone of the authored realm tree, not a recursively nested realm and not a
copy of `.deck` or `.jj`. The index is
derived state, but its generation travels with the branch pointer so readers
never observe new files with an old index or an index for files that are not
yet visible.

### 3.1 Physical placement: additive to `deck/at-rest-poc`

The backport does not create `branches/main/` and does not move authored realm
content. It retains or deliberately evolves the POC paths as follows:

| State                                              | Placement                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| default-branch source                              | existing realm root, unchanged                                                                                                        |
| package metadata and resolution inputs             | existing conventional package/app paths, including root and nested maps                                                               |
| default-branch History                             | migrated from the POC's colocated root `.jj` repository to `.deck/history/repo`, with only a thin realm-local `.jj` workspace pointer |
| realm package/CAS store                            | moved from the POC's parallel realm-qualified `.package-store/<host>/<realm>/` root to the owning realm's `.deck/store/`              |
| completed indexes and collaboration objects        | shared realm-owned namespaces under `.deck/indexes/`, `.deck/refs/`, `.deck/reviews/`, and `.deck/store/`                             |
| non-default branch source                          | new `.deck/branches/<opaque-id>/source/`                                                                                              |
| non-default branch History and private build state | new siblings under `.deck/branches/<opaque-id>/history/`, `transaction/`, and `index-staging/`                                        |

Thus the only new source-tree location is for a non-default branch. Everything
else either keeps the pushed realm shape or moves hidden implementation state
into the realm as required by the later realm-containment and History rulings.

## 4. Create branch and fork

Branch and fork use the same primitive with different destinations.

```text
source realm + source branch/Checkpoint
              │
              ├── clone source state
              ├── clone completed index generation
              └── initialize History ancestry
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
    branch in same realm       fork in new realm
    same ACL boundary          new owner / ACL boundary
```

### 4.1 Clone contract

The operation must:

1. resolve an exact source snapshot and a **completed** index generation;
2. clone the complete authored realm tree from that snapshot, preserving its
   existing paths and excluding `.deck`, `.jj`, `.git`, and other
   implementation directories;
3. publish the destination index-generation reference (which may initially
   name the same immutable generation for a same-realm branch);
4. ask deckd to initialize the destination's own `.deck/history/repo` from the
   exact source `historyHead`, recording source Checkpoint provenance;
5. publish the destination branch pointer only after source, index, and
   History initialization all succeed.

The clone may use an immutable generation-manifest reference, copy-on-write,
database `INSERT … SELECT`, filesystem reflinks, or CAS references. Those are
backend choices. Semantically the destination owns an independent branch/index
line from the moment it is published.

The local SQL/SQLite projection may use transactional `INSERT … SELECT` into a
fresh opaque generation ID. The AWS backend publishes an immutable generation
manifest; a same-realm branch may initially reference the source generation
and diverges on first write. Branch source bytes are materialized into the
destination's stable workspace. All conventional package boundaries and
root/nested import-map inputs survive unchanged. deckd initializes the
destination History via its History API; `.deck` and `.jj` machinery are never
copied as authored source. The destination never shares a mutable jj repository
with the source.

If cloning the index fails, no branch is visible. Boxel must not publish an
empty branch and fill Browse/search later.

### 4.2 Same-realm clone vs fork rebase

A branch inside one realm preserves the logical Realm RRI namespace, so its
completed index generation can be cloned directly.

A fork changes the Realm RRI authority and its transport URL. Boxel's current
index contains realm-qualified resource identities, dependencies, metadata,
and rendered output, so a fork cannot blindly byte-copy every row. It performs
a **rebased index clone**:

1. copy the completed structured index generation;
2. change each realm-local row identity from the source Realm RRI prefix to
   the destination Realm RRI prefix;
3. rebase only references that resolve inside the forked realm; external exact
   dependencies remain unchanged;
4. regenerate prerendered/embedded output whose derived transport URLs cannot
   be safely rebased;
5. verify that the finished destination index contains no accidental
   source-realm identity before publishing the fork ref.

This is still a clone, not an empty full crawl: the source completed index is
the seed and only namespace-sensitive derived fields are repaired. The
indexer's existing dependency and rendering rules remain authoritative.

### 4.3 Why clone instead of share

Cloning makes branch reads and writes operationally independent:

- no parent-chain query semantics in the first backport;
- no accidental invalidation across branches;
- existing index queries need only select the branch's generation;
- a fork can leave the source realm without retaining a live dependency on it.

Physical deduplication can follow. It must not change the branch contract.

## 5. Write and index contract

Every write carries a `RealmViewContext`:

```ts
interface RealmViewContext {
  realmRRI: RealmIdentifier;
  realmURL: string;
  branch: string;
  repositoryHash: string;
  indexGenerationHash: string;
}
```

For a settled human or agent write batch:

1. acquire the write lock for `(Realm RRI, branch)`, not the whole realm;
2. mutate that branch's source state through its workspace filesystem;
3. ask deckd to append one History Step for the settled batch;
4. create the Repository and completed branch index generation;
5. compare-and-swap the branch head to Repository, History, and index together;
6. emit branch-qualified invalidation and activity events.

Unrelated branches can therefore write and index concurrently. Writes on the
same branch remain serialized.

All derived state must include the canonical RRI plus view context: loader
caches, query cache keys, index jobs, prerender jobs, invalidation events,
activity, and published HTML readiness. A cache keyed only by Realm RRI or
realm URL is incorrect after this backport.

Agents can inspect the selected branch head, Checkpoints, Reviews, index
manifest, and History through ordinary realm paths. Agent writes below the
protocol-owned `.deck/store`, `.deck/indexes`, `.deck/refs`, and
`.deck/reviews`, and `.deck/releases` paths must fail. The realm service performs those writes
through the local atomic-file adapter or direct S3 conditional adapter.

## 6. Index storage

The first implementation adds an explicit branch/index-generation dimension
instead of manufacturing a different realm URL for every branch. A completed
generation has a canonical manifest/hash that can be stored locally or in S3.
Postgres and the host's SQLite mirror project that generation into queryable
rows; they are not the durable collaboration ref.

Conceptually:

```text
realm_branches
  (realm_rri, branch) -> realm_url, repository_hash, index_generation_hash,
                         history_head, latest_checkpoint_hash, ref_generation

realm_index_generations
  hash -> realm_rri, branch_id, repository_hash, manifest, status

boxel_index
  (index_generation, rri, type) -> indexed row

realm_file_meta / prerendered_html / working tables
  all qualified by index_generation
```

The current `realm_generations(realm_url)` becomes a projection of generation
state scoped to a branch head. Existing rows migrate their resource URLs to
canonical RRIs through the registered Realm RRI authority. Existing realms
receive a `main` branch and one completed generation; unqualified callers
continue to resolve `main`.

Do not implement branches by appending the branch name to stored RRIs. The
logical card/module identity stays inside the Realm RRI namespace. Branch is a
view used to choose source and index state.

## 7. Addressing and resolution

Canonical authored and indexed identities are RRIs:

```text
mutable realm        @acme/shop/
mutable resource     @acme/shop/products/sku-1
exact Version        @catalog/three@0.169.0/
exact resource       @catalog/three@0.169.0/build/three.module.js
```

Branch and Checkpoint are deliberately absent from that grammar. A logical RRI
plus `RealmViewContext` selects the source snapshot and index generation. The
resolver then projects that pair to a browser-safe absolute URL.

The host and server use a branch-qualified transport view because query
parameters do not reliably propagate through relative ESM imports. The wire
grammar is:

```text
default view   <realm>/<path>
branch view    <realm>/__deck/branch/<base64url(NFC UTF-8 name)>/<path>
checkpoint view <realm>/__deck/checkpoint/<lowercase checkpoint hash>/<path>
```

`__deck` is reserved and cannot be authored as a top-level realm path. Branch
tokens omit base64 padding and decode to at most 128 UTF-8 bytes. Branch-name
validation rejects empty names, NUL, invalid UTF-8, and names whose NFC form is
not unique within the realm. Names may contain familiar `/`, `.`, and `-`
characters because the wire token is a single opaque segment.

The server strips the transport prefix before selecting logical source/index
rows and sets `RealmViewContext`. Stored card data, import maps, dependency
edges, Repository records, and UI labels continue to use canonical RRIs.
Native relative ESM imports inherit the projected view prefix; the loader
carries the same context for bare and cross-realm RRI resolution. Branch
responses are mutable and revalidate. Exact Checkpoint responses are immutable
and may be cached forever.

## 8. Review and merge

A Review binds exact source and target Checkpoints and records their common base.
Browse and Run select the matching index generation for each side. They are not
mock previews and do not reconstruct state in the browser.

Merge is deliberately a **target mutation**, not a branch-pointer swap:

```text
base Checkpoint ─┐
source Checkpoint ├── 3-way merge ── candidate change set
target Checkpoint ┘                         │
                                          ▼
                       target Realm.writeBatch(changes)
                                 │
                                 ├── mutate target source
                                 ├── update target index
                                 ├── append ONE merge Step
                                 └── CAS target branch head
```

The write batch includes every added, changed, and deleted path plus the exact
import-map lock change. It uses the same validation, indexing, invalidation,
and authorization path as ordinary realm writes.

Review preparation builds an invisible candidate index generation from the
exact target generation plus this change set. Merge acquires target writer
ownership, rechecks the target ref, writes a prepared transaction, applies the
target write batch, and asks deckd for exactly one Step. The final conditional
target-head move publishes the Repository, candidate generation, History head,
and merge Checkpoint together. It does not index the same change twice.

A moved target or failed candidate validation discovered before mutation
aborts cleanly. A crash after target mutation is different: the prepared
transaction causes recovery to complete the same ref move idempotently or
restore the workspace to its previously settled deckd History head. Browse,
Run, and Review never use uncommitted workspace bytes as branch truth.

The single merge Step records:

- Review ID;
- source, target, and base Checkpoint hashes;
- merge Checkpoint hash (with source and target parents);
- actor;
- complete changed-path summary;
- before/after source snapshot and index generation.

If the source branch contains 47 Steps, merging does **not** replay 47 Steps
onto `main`. Those Steps remain the source branch's daily history. `main`
receives one coherent Step: “merge this Review.”

The target branch pointer moves only after source mutation, index mutation,
and History append are ready to settle. A pre-mutation conflict or failed index
candidate leaves the target unchanged; a post-mutation interruption enters
explicit recovery rather than pretending the filesystem write never occurred.

## 9. Query behavior

- normal realm search queries the default branch's index;
- a branch workspace queries that branch's cloned index;
- a Review queries exact source, target, and optional merge-candidate indexes;
- federated search queries each realm's default branch, not every branch;
- historical Checkpoint indexes may be retained or rebuilt, but a Review's exact
  preview must remain available for the Review's retention period.

The initial retention policy pins current branch heads, open Reviews, and published Releases.
Closing or merging a Review starts a 30-day index-generation retention window.
After that, Boxel may evict the derived generation and rebuild it from the
durable source snapshot when requested; the Checkpoint and source bytes are not
evicted by this policy.

## 10. Permissions

Realm ACL remains the ownership boundary.

- create/write/delete branch: realm write permission;
- merge: a separate merge capability, held by realm owners and explicitly
  grantable to maintainers;
- fork: read permission on the source plus create permission in the destination
  realm/owner;
- Review source/target ancestry is server-derived, not trusted from the client.

Existing realms migrate with direct writes to `main` still allowed. Branch
protection is opt-in so the backport does not break today's authoring path.
When a branch is protected, direct source mutation is rejected and a Review
merge requires the merge capability.

This is why a branch and a fork feel similar without becoming the same noun.

## 11. Architecture-forcing fixture

Before host UX, add one integration fixture with a real realm and real indexes:

```text
realm: @acme/shop/

main
  products/sku-1.json   price: 10
  theme.gts             color: blue

branch: summer-sale
  products/sku-1.json   price: 8
  theme.gts             color: coral
  promotion.json        new
```

The fixture must prove:

1. branch creation clones `main` source **and its completed index**;
2. the same logical RRI returns price 10 on `main` and price 8 on
   `summer-sale`;
3. search, Browse, prerender, and Run select the correct branch index;
4. a later `main` write does not change the branch result;
5. a branch write does not invalidate `main` caches;
6. Review compares exact Checkpoints and previews the branch's real app;
7. merge mutates `main`, updates its index, and adds exactly one `main` Step;
8. the source branch keeps its own Steps and remains addressable after merge;
9. a stale concurrent merge loses the CAS and leaves `main` unchanged;
10. a fork repeats the clone into `@vale/shop/`, a new Realm RRI authority and
    ACL boundary;
11. every authored import-map input and the canonical composed lock,
    dependency edges, index rows, Repository records, and Review payloads
    contain RRIs rather than projected URLs;
12. the fixture passes once on the local filesystem backend and once with the
    workspace/History on S3 Files plus conditional S3 object/ref adapters.

The fork assertion also verifies that realm-local RRIs in the destination
index use `@vale/shop/`, while external exact Version RRIs are unchanged. Its
browser projection uses destination transport URLs, but those URLs never
become authored or reviewed identity.

No branch UI should land before this fixture is green.

## 12. Backport order

This changes the old History order. History cannot be realm-global first and
made branch-aware later without migrating its identity twice.

| Slice  | Work                                                                                                                                                                            | Proof                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **B0** | Deck Core V2 Repository/Checkpoint/Review/branch-head types, RRI roots, and backend-neutral conformance fixture                                                                 | Protocol objects round-trip without Boxel    |
| **B1** | Realm-contained local filesystem plus AWS S3 Files/object/ref adapters; branch metadata, `main` compatibility, inspectable agent reads, writer ownership, and prepared recovery | Same state machine passes locally and on AWS |
| **B2** | RRI-keyed immutable index generations and view-qualified writer/query/cache/job/event keys                                                                                      | Two generations for one RRI coexist          |
| **B3** | Atomic source + completed-index + deckd History initialization for branch and fork                                                                                              | Architecture fixture items 1–5, 10, and 12   |
| **B4** | Per-branch deckd/jj Steps and restore through the branch write path on local FS and S3 Files                                                                                    | Save/restore cannot cross branches           |
| **B5** | Exact Checkpoint comparison and real Browse/Run preview                                                                                                                         | Fixture item 6                               |
| **B6** | Three-way merge through one prepared target write batch, one target Step, and conditional head move                                                                             | Fixture items 7–9 and crash recovery         |
| **B7** | Quiet branch selector, History context, Review/merge UX                                                                                                                         | UI only exposes already-real state           |

Likely Boxel seams:

- `packages/runtime-common/realm.ts`: view context, branch-scoped adapter and
  write lock;
- `packages/runtime-common/index-writer.ts`: generation-qualified index batch
  and atomic promotion;
- database migrations: branch-head projections plus index-generation keys on
  index/meta/prerender tables;
- storage adapters: local atomic files, S3 Files workspaces, conditional S3
  objects/refs, and immutable index-generation manifests;
- realm server routes and jobs: branch/Checkpoint view resolution;
- host loader/query services: carry view context;
- host Realm UI: quiet branch switcher, per-branch History, Review.

## 13. Rejected shortcuts

- **One realm URL per branch.** Fast initially, but breaks realm identity,
  ownership, links, ACLs, and “branch within an org/repo.”
- **One index with a UI branch filter.** Cannot represent two answers for the
  same RRI and makes Run/preview false.
- **Share one mutable index between branches.** Branch writes invalidate each
  other and destroy isolation.
- **Replay source Steps onto main.** Turns one reviewed merge into noisy
  pseudo-history and weakens atomic rollback.
- **Swap main to the branch's index.** Skips the target write path, target-side
  validation, current-target changes, and coherent every-save History.
- **Create branch source now, index later.** Exposes a branch that Browse and
  search cannot truthfully represent.

## 14. Settled implementation choices

The former open choices are closed for the first backport:

1. reserved `__deck/branch/<token>` and `__deck/checkpoint/<hash>` transport
   views;
2. canonical RRI index identity and immutable generation manifests, with
   SQL/SQLite as query projections and same-realm generation sharing allowed;
3. pin active heads, open Reviews, and Releases; retain closed Review indexes
   for 30 days; rebuild other exact indexes on demand;
4. compatibility direct writes by default, optional branch protection, and a
   separate merge capability;
5. an invisible candidate generation that a prepared target write transaction
   publishes after compare-and-swap validation;
6. deckd/jj at `.deck/history/repo` on both local filesystems and S3 Files;
7. direct conditional S3 writes for immutable protocol objects and mutable
   branch refs, with no dual-interface writes to the same keys.

The invariant across all choices is: **RRI is the identity; RealmViewContext
selects its branch or Checkpoint; `__deck` is only transport; a branch/fork
begins with a complete cloned index; branches diverge independently; merge
changes the target through one atomic write batch and advances its History
once.**
