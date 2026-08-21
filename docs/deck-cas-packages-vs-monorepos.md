# The monorepo is a legacy storage model

**Status: THESIS + ARCHITECTURAL REQUIREMENTS.** This document explains why
Deck treats independently addressable, content-addressed packages as the
primary unit of software rather than treating one physically co-located
repository as the unit of identity, history, review, release, and delivery.

Companions: [`deck-laws.md`](deck-laws.md),
[`deck-at-rest.md`](deck-at-rest.md),
[`deck-package-json-and-depot-lock.md`](deck-package-json-and-depot-lock.md),
[`deck-catalog-cdn-delivery.md`](deck-catalog-cdn-delivery.md), and
[`deck-fork-merge-pr-ux.md`](deck-fork-merge-pr-ux.md).

---

## 0. The claim

> **A monorepo preserves coherence by putting everything in one mutable
> place. Deck preserves coherence by naming every immutable thing and naming
> the exact Repository that uses it.**

The monorepo is not a bad organizational idea. One product still needs one
place to search, refactor, test, review, and understand. What is legacy is
using **physical co-location as the mechanism that creates that coherence**.

A monorepo makes these facts coincide:

- where source files happen to sit;
- what changed together;
- what may be reviewed together;
- what may be built together;
- what may be deployed together;
- what may be versioned together;
- what a branch copies or isolates;
- what CI must consider.

Those are different facts. They became one because filesystems and Git had
one convenient boundary: the repository.

Deck splits them without losing the useful experience:

- a **package tree** says what one package's bytes are;
- a **Checkpoint** says how one line of work reached those bytes;
- a **Version** says what compatibility promise those bytes carry;
- a **depot lock** says which exact package trees execute together;
- a **Repository Checkpoint** says which package changes are atomic;
- a **pull request** says which work should enter which target;
- an **HTTP URL** serves the exact ESM file the browser executes.

The result should still feel as coherent as a monorepo. It no longer needs to
be stored, copied, invalidated, released, or deployed as one.

---

## 1. Why monorepos won

Any replacement that starts by mocking monorepos has misunderstood the job.
Monorepos won because they repair the fragmentation produced by traditional
package registries and multi-repository development.

```text
MANY REPOSITORIES                         MONOREPO

repo-a ── publish ──┐                    ┌──────────────────────────────┐
                    ├─ install ─ app     │ app/                         │
repo-b ── publish ──┤                    │ packages/a/                  │
                    │                    │ packages/b/                  │
repo-c ── publish ──┘                    │ packages/c/                  │
                                          └──────────────────────────────┘
version choreography                       one checkout
cross-repo PR choreography                  one change
registry round trips                        one search
dependency drift                            one CI graph
```

The monorepo gives teams real advantages:

1. **Atomic cross-package changes.** Change producer and consumers together.
2. **Global discovery.** Search and navigation see the whole product.
3. **Mechanical refactors.** One tool can rewrite every affected caller.
4. **One review object.** A pull request can explain a product-level change.
5. **One reproducible checkout.** A commit identifies a coherent repository.
6. **Shared policy.** Formatting, tests, ownership, and CI can be centralized.
7. **Local source dependencies.** Packages need not be published before they
   can be used by siblings.

These are product requirements. Deck should preserve every one of them.

The mistake is assuming they require one Git repository forever.

---

## 2. The hidden bargain

The monorepo recovers coherence by accepting coupling at the storage and
coordination layer.

```text
                         ONE REPOSITORY
                              │
             ┌────────────────┼────────────────┐
             │                │                │
          identity         history          delivery
             │                │                │
       one commit DAG    one branch set    build extracts
       for all source    for all teams     deployable pieces
```

That bargain creates costs which become sharper under agent-scale work.

### 2.1 The repository is the invalidation boundary

A two-line change can cause repository-wide dependency analysis, CI
scheduling, indexing, checkout, and cache-key work. Good build systems reduce
the blast radius, but only after reconstructing package boundaries from the
large mutable tree.

### 2.2 Branches isolate too much and too little

A Git branch cheaply names another commit, but a usable branch usually needs
a checkout or worktree of the repository. It isolates the entire repository
even when an agent changes one package, while still allowing that agent to
accidentally edit anything in the checkout.

At human cadence this is manageable. Hundreds of agents turn the shared
index, worktree machinery, CI graph, merge queue, and review surface into the
bottleneck.

### 2.3 Package boundaries are advisory until build time

`packages/a` looks independent, but its runtime identity is usually produced
later by a build, package, or deploy pipeline. The source tree, npm artifact,
bundle, container, and CDN output occupy different address spaces. Tooling
must keep proving that each is a faithful copy of the previous one.

### 2.4 History and release have the wrong shared boundary

Some packages want independent semver. Some changes span several packages.
Monorepo release tools must infer which package versions to bump, coordinate
them, generate manifests, and preserve the relationship between a repository
commit and many registry artifacts.

The repository had one history; the published world receives many partial
translations of it.

### 2.5 Ownership is layered onto location

Teams use path rules such as `CODEOWNERS` because the repository boundary is
too broad. The ownership model is metadata saying that particular subtrees
were always the real units of authority.

### 2.6 Physical completeness becomes expensive

Every checkout presents the whole repository as ordinary files even when a
task needs one component and a handful of exact dependencies. Sparse
checkout, virtual filesystems, partial clone, build graphs, and remote caches
all exist to recover demand-loading after choosing an eagerly complete
logical unit.

These tools are impressive. Collectively, they are evidence that the storage
boundary is no longer the product boundary.

### 2.7 The agent-era tension: global context, bounded mutation

The strongest argument for a monorepo in an agent system is navigation. An
agent can search once, follow imports without negotiating credentials across
repositories, read shared conventions, and discover code it did not know to
ask for. Breaking a product into ordinary independent repositories often
makes remote work worse: every ephemeral machine must discover, clone,
authenticate, install, align, and update the right set before useful work can
begin.

That does not imply that every agent should receive one globally writable
tree.

Agents need two views with different widths:

```text
                         ORGANIZATION CONTEXT
                  code · docs · policy · issues · schemas
                                  │
                    broad, searchable, read-only
                                  │
                                  ▼
                              PLANNER
                                  │ chooses task closure
                                  ▼
                 ┌────────────────────────────────┐
                 │ bounded worker checkout        │
                 │                                │
                 │ writable:  acme/editor branch │
                 │ read-only: app + exact deps    │
                 │ context:   relevant decisions │
                 └────────────────────────────────┘
                                  │
                                  ▼
                    new trees + Repository delta
```

The planner wants global legibility. The worker wants a small, explicit
authority boundary. Conflating those needs produces a checkout that is easy
to navigate but too easy to damage, expensive to materialize, and noisy to
validate.

This reframes the question from “one repo or many repos?” to four separate
questions:

1. **What may this agent discover?** Usually much broader than one package.
2. **What must this agent materialize?** The task closure, not all source.
3. **What may this agent mutate?** A named branch/fork and an explicit set of
   packages.
4. **What must land atomically?** The resulting Repository delta, possibly
   spanning several packages.

The filesystem boundary answers none of these precisely. It is only one
possible projection of their answers.

### 2.8 All code is not all knowledge

Putting every source file in one repository still does not put the whole
organization in one context. Agents also need design decisions, tickets,
runtime evidence, schemas, ownership, security policy, prior reviews, and
the reasons a dependency is pinned. Vendoring all of that into a repository
would make the repository larger without making the relationships clearer.

Deck should treat organizational context as an addressable graph around the
code graph:

```text
                         decision record
                               │
issue ─────▶ pull request ─────▶ Checkpoint ─────▶ treeHash
                  │                │                │
                  │                │                └─ package files
                  │                └─ checks / reviews / authorship
                  └─ preview / discussion / acceptance

Repository ──▶ exact package trees + lock ──▶ runtime evidence
```

One search surface can index this entire graph without pretending every node
belongs in one source checkout. “One place for context” is a product and
indexing requirement, not a mandate for one Git object database.

### 2.9 Remote agents need cheap reconstruction, not permanent co-location

Multi-repository development often feels acceptable on a long-lived laptop
because the machine quietly accumulates clones, credentials, caches, sibling
checkouts, and human memory. An ephemeral agent machine starts with none of
them. Reconstructing the implicit repository checkout becomes the task before the
task.

CAS changes the economics:

```text
task says: Repository 8f31… + writable acme/dashboard:add-myr
                              │
                              ▼
agent fetches one manifest ──▶ already has 91% of objects in shared cache
                              │
                              ▼
materialize exact closure ───▶ no repository discovery or version guessing
```

The unit sent to a remote worker is not “clone these seven repositories and
run their bootstrap scripts.” It is an immutable Repository identity plus a
write capability for one branch. Any machine reconstructs the same inputs;
shared objects arrive once; unrelated product source never needs to become
ordinary files.

### 2.10 Version coordination moves to the Repository edge

Splitting a monorepo into conventional repositories reintroduces version-bump
and submodule-pointer choreography. That is not the CAS model.

During development, packages compose by exact tree or Checkpoint identity.
Changing a producer and three consumers creates one proposed Repository Checkpoint.
No semver bump is required merely to make the repository coherent. Semver is
assigned later, when somebody makes a compatibility promise to external
consumers.

```text
DEVELOPMENT                              RELEASE

tree A2 + tree B4                        editor 3.0.0 ──▶ tree B4
        │                                dashboard 8.2.0 ──▶ tree A2
        ▼
Repository Checkpoint 91ce…
one atomic repository change
```

This retains independent package releases without making version numbers the
internal transport for every coordinated source edit.

---

## 3. The Deck alternative: content-addressed packages

Deck begins at the boundary monorepo tooling has to rediscover.

```text
PACKAGE CONTENT

acme/editor tree
  editor.js       ──sha256──▶ object 81c4…
  toolbar.js      ──sha256──▶ object a319…
  package.json    ──sha256──▶ object 0f72…
                              │
                              ▼
                    tree manifest 46bd…
                    path → object hash
                              │
                              ▼
                    treeHash = package identity
```

The store is global to the depot:

```text
                         CONTENT-ADDRESSED STORE

app/dashboard ──tree──┐
                      │             ┌─ object A  stored once
acme/editor ──tree────┼─ manifests ─┼─ object B  stored once
                      │             └─ object C  stored once
chris/editor ──tree───┘

same bytes ───────────────▶ same object
same package tree ─────────▶ same treeHash
new fork, no edits ─────────▶ zero new content
one-file edit ──────────────▶ one new object + one manifest
```

Package boundaries are no longer conventions inferred from paths. A package
has an immutable identity before release and remains directly addressable
after release.

---

## 4. The lock replaces physical co-location

A monorepo checkout answers “which versions work together?” by handing every
package the files that happened to coexist at one commit.

Deck answers with an explicit lock:

```json
{
  "imports": {
    "app/dashboard": "/site/app/dashboard@3.2.0/index.js",
    "acme/editor": "/site/acme/editor@2.4.1/editor.js",
    "acme/theme": "/site/acme/theme@1.8.0/theme.js"
  },
  "integrity": {
    "/site/acme/editor@2.4.1/editor.js": "sha256-…"
  }
}
```

This is not weaker than a checkout. It is more explicit:

- every edge names the exact package and file that answers it;
- integrity is checkable;
- two applications can select different Versions without separate installs;
- an unchanged package keeps the same URL across every application update;
- the browser consumes the map directly.

A useful compression of the idea is:

> **A monorepo checkout is an implicit lockfile rendered as a directory.
> Deck stores the lock as data and renders a directory only when a tool needs
> one.**

---

## 5. Atomic changes do not require one physical source tree

This is the strongest monorepo argument and the place where a naive
“microrepos everywhere” answer fails.

Updating package refs one at a time is not sufficient:

```text
BAD

editor head ──▶ new tree       visible now
app head    ──▶ old tree       visible for 40 ms
app head    ──▶ new tree       visible later
```

Deck needs an immutable **Repository** object, named by a Checkpoint, that
records the complete member package set produced by one atomic change:

```json
{
  "schema": "deck-repository-v2",
  "roots": ["@acme/dashboard/"],
  "members": {
    "@acme/dashboard/": "tree-app-new",
    "@acme/editor/": "tree-editor-new",
    "@acme/theme/": "tree-theme-unchanged"
  },
  "lockHash": "sha256-of-import-map"
}
```

The branch is one CAS-updated pointer:

```text
immutable package trees written first
              │
              ▼
immutable Repository + Checkpoint written second
              │
              ▼
acme/dashboard:main ── atomic CAS ──▶ new Checkpoint
```

Readers see the complete old Repository or the complete new Repository,
never a half-landed refactor. This preserves the defining monorepo property
without making all package histories, releases, caches, or working trees one
object.

This capability and Repository-level three-way merge are implemented and
exercised by the tour in
[`deck-repository-tour.md`](deck-repository-tour.md).

---

## 6. Branches are zero-copy Repository forks

The familiar UX can remain:

```text
acme/dashboard:main
acme/dashboard:transaction-api
```

But the implementation does not need a second checkout of an entire product.
The branch is a real isolated fork of the Repository:

```text
main
  app/dashboard ─────────────── tree A
  acme/editor ───────────────── tree B
  acme/theme ────────────────── tree C

transaction-api
  app/dashboard ─────────────── tree A2       changed
  acme/editor ───────────────── tree B2       changed
  acme/theme ────────────────── tree C        shared
```

The branch records different pointers for A and B. C is not copied, checked
out again, republished, or rebuilt. It is literally the same identity.

For a team, this is displayed as a **branch** within `acme/dashboard`. When the
owner changes, the same primitive is displayed as a **fork**. The naming and
UX ruling is specified in
[`deck-fork-merge-pr-ux.md`](deck-fork-merge-pr-ux.md).

---

## 7. Review the Repository, not only its diff

A monorepo pull request primarily shows a repository diff. Reviewers infer
what that diff will become after build and deployment.

Deck can show all three truths together:

```text
PULL REQUEST #418

intent             Add transaction API
content            editor B → B2; dashboard A → A2
resolution         exact import-map change
execution          [ Run proposed Repository ]
verification       checks bound to source + target Checkpoints
merge              one depot-head pointer move
```

The diff remains important. It is no longer forced to stand in for the
runtime result.

Because every proposed package tree already has an address, a pull request
can execute the exact proposal with no checkout, integration branch, build,
or preview deployment. The preview is a different resolution of the same
address space.

---

## 8. Release and deploy disappear into addressing

In the traditional pipeline:

```text
repository commit
      │ build
      ▼
package artifact
      │ publish
      ▼
registry version
      │ install + bundle
      ▼
deployment artifact
      │ deploy
      ▼
CDN/runtime bytes
```

Each arrow copies or transforms information into a new naming system.

In Deck:

```text
treeHash 46bd…
   ├─ branch Checkpoint points here
   ├─ Version 2.4.1 points here
   ├─ pull-request preview points here
   └─ exact HTTP module URL serves files from here
```

Release adds a compatibility name. Deployment changes a pointer or an import
map. Neither operation needs to manufacture a second copy of source.

Derived bundles, minified trees, and compiled outputs may still exist, but
they are separately content-addressed derivations with provenance. They do
not retroactively become the identity of the source package.

---

## 9. ESM makes packages the delivery unit

Traditional package systems stop at distribution. Another tool must install,
link, transform, bundle, and serve them.

Deck packages are ES modules at immutable HTTP addresses:

```html
<script type="importmap">
  {
    "imports": {
      "acme/editor": "/site/acme/editor@2.4.1/editor.js"
    }
  }
</script>
<script type="module">
  import { Editor } from 'acme/editor';
</script>
```

The package boundary survives into the browser. That produces compounding
cache behavior:

- changing the app does not invalidate the editor URL;
- changing one editor module does not invalidate the theme;
- several apps share exact immutable module responses;
- a fork that changes one file downloads and stores what is genuinely new;
- a CDN can cache every exact URL forever.

Modulepreload, HTTP/2 or HTTP/3, compression, and derived production variants
are required to make cold delivery competitive. CAS makes them optimizations
of an honest identity model rather than reasons to collapse identity into a
bundle.

---

## 10. Comparison

| Concern                 | Traditional monorepo                                 | Deck CAS packages                            |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------- |
| Primary identity        | repository commit                                    | Repository hash + member treeHashes          |
| Package boundary        | path/tool convention                                 | immutable addressed object                   |
| Cross-package atomicity | one commit                                           | one Repository Checkpoint pointer              |
| Branch isolation        | whole-repository worktree                            | Repository fork; unchanged objects shared    |
| Unchanged content       | repeated in checkouts and artifacts; cached by tools | shared by identity                           |
| Dependency selection    | package-manager rules + lockfile                     | depot import map                             |
| Review                  | repository diff                                      | package-grouped diff + exact running preview |
| Release                 | derive package artifacts from commit                 | Version pointer to existing tree             |
| Deploy                  | build/copy/upload artifact                           | move Repository pointer                      |
| Browser delivery        | usually bundle output                                | exact ESM URLs and derived variants          |
| Independent versioning  | release-tool concern                                 | native per package                           |
| Global refactor         | native directory-wide tooling                        | operate on materialized Repository           |
| Search/index            | repository-wide by default                           | catalog/index over addressed packages        |
| Offline work            | complete clone/worktree                              | explicit materialized working set required   |
| Coordination            | Git ref transaction + forge                          | CAS refs + durable Checkpoint/request metadata |
| Garbage collection      | Git reachability                                     | Versions + refs + requests + Checkpoints       |

---

## 11. What a directory becomes

Deck does not abolish directories. Editors, compilers, grep, language
servers, and people are excellent at working with them.

The change is ontological:

> **The directory becomes a materialized repository view, not the source of
> identity.**

```text
authoritative Repository
        │ materialize
        ▼
/checkout
  app/dashboard/
  acme/editor/
  acme/theme/
        │ edit with ordinary tools
        ▼
changed package trees + new Repository Checkpoint
```

On a laptop this can be ordinary local files. On AWS it can be an S3 Files
mount backed by S3. In both cases, sealing computes content identity and
publication moves CAS-protected metadata pointers.

The checkout may look like a traditional monorepo because that is productive.
It no longer has to _be_ the unit of storage, history, release, or delivery.

---

## 12. What Deck must solve honestly

CAS is not a magic word. Moving the boundary creates real engineering work.

### 12.1 Durable coordination

Immutable objects are easy. Mutable heads, Reviews, approvals, and atomic realm
heads require authenticated compare-and-swap and durable event history. S3
Files supplies the inspectable POSIX view, but not conditional coordination.
All objects remain below the owning realm's `.deck/`; agents may read them
there, while the realm service writes protocol-owned subtrees through direct
conditional S3 operations.

### 12.2 Repository-scale atomicity

Per-package refs are insufficient for product changes spanning several
packages. The Repository Checkpoint and its atomic ref update are required before
Deck can claim full monorepo parity.

### 12.3 Materialization and offline work

Tools still expect directories. Deck needs fast local materialization,
demand loading, an offline object cache, and a clear push/reconciliation
model.

### 12.4 Search and refactoring

Removing the physical monorepo must not remove global understanding. Indexes
must search a Repository or catalog, and refactoring tools must be able to
materialize and update a multi-package closure as one proposed depot
Checkpoint.

### 12.5 Small-object economics

Thousands of ESM files can create metadata, request, and cold-start costs.
Pack transport, local caches, S3 Files active-set caching, CDN delivery, and
preload closure computation remain necessary.

### 12.6 Garbage collection

Reachability now crosses Versions, Checkpoints, refs, pull requests, depot
Checkpoints, signatures, and retention policy. Deleting by “no Version points
here” would destroy branch-only work.

### 12.7 Ecosystem compatibility

Git hosting, npm, IDEs, CI systems, and security scanners exist. Deck needs
faithful projections and bridges during adoption; ideological purity is not
a migration strategy.

These are not arguments for returning to the monorepo. They are the work
required to replace its implicit guarantees with explicit ones.

---

## 13. Migration: make the monorepo a projection

A credible transition does not begin by splitting every repository.

### Phase 1 — identify package trees inside the monorepo

- Compute a treeHash for each existing package boundary.
- Record package dependencies and exact depot lock pins.
- Preserve the Git repository and existing CI.
- Verify that a Git repository commit can reproduce one Deck Repository.

### Phase 2 — serve immutable packages directly

- Publish exact Deck URLs for package trees.
- Run applications through the depot import map.
- Keep GitHub as the write/review bridge.
- Compare built artifacts with Deck-served source or derivations.

### Phase 3 — make branches Repository forks

- Create durable Checkpoints and CAS refs.
- Present same-owner forks as branches and cross-owner forks as forks.
- Open pull requests against exact source and target Checkpoints.
- Materialize only the packages a change needs.

### Phase 4 — make the Repository Checkpoint authoritative

- Land cross-package changes with one atomic depot-head update.
- Generate a monorepo-shaped directory for legacy tools on demand.
- Mirror accepted Deck history back to Git while required.
- Stop treating the Git repository as the only source of truth.

### Phase 5 — retire physical co-location as a requirement

- Keep monorepo projections where they improve ergonomics.
- Scale storage, review, CI, release, and delivery by package identity.
- Allow one Repository to span local, organizational, and public
  package catalogs without changing the collaboration model.

---

## 14. The revised meaning of “monorepo”

The useful part of a monorepo should survive:

```text
one product view
one global context and search surface
one searchable Repository
one atomic cross-package change
one coherent review
one command to run everything
```

The legacy part should not:

```text
one physical mutable tree as identity
one history graph for every package
one checkout boundary for every task
one invalidation boundary for every change
one build/deploy translation before code has an address
```

For agents, the replacement principle is:

```text
one global map
many bounded writable checkouts
immutable, reconstructable input closures
one atomic Repository update when the work lands
```

So the durable claim is narrower and stronger than “monorepos are bad”:

> **The monorepo is a valuable development experience implemented with a
> legacy storage boundary. Content-addressed packages let Deck retain the
> experience while replacing co-location with identity, explicit membership,
> and atomic pointers.**

That is why Deck works better. It does not fragment the monorepo back into
the multi-repository world that caused monorepos to win. It makes the package
graph coherent without pretending the graph is one file tree.
