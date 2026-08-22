# Bringing Deck into Boxel — team brief

**Audience:** Boxel / Cardstack engineers who have not worked in the Deck repo.  
**Purpose:** Plain-English plan for what we gain, what lands where in Boxel, and in what order.  
**Assumption:** We start from a clean Boxel `main`, add a tight **Deck Core** package under something like `packages/deck`, and wire Boxel to it (no Hub UI, no Deck demos).

Internal numbering from our planning docs is kept in parentheses so you can match longer write-ups later. You do not need those docs to follow this.

| Shorthand     | Means                                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **K1–K14**    | The fourteen product benefits we want from Deck in Boxel                                                                                                              |
| **P1–P4**     | Four technical prerequisites that unlock most of those benefits                                                                                                       |
| **PR 0–14**   | The older product-benefit stack in [`deck-boxel-backport-changelist-mockup.md`](./deck-boxel-backport-changelist-mockup.md). Kept stable for existing cross-references. |
| **R0**        | Deck-side V2 gate (W11): RRI Repository/lock, Checkpoint, branch head, Review, realm-relative `.deck` paths, transport projector, compatibility reads.                |
| **A0–A3**     | The first clean execution stack: current Lean Core, resolver/scopes, versioned serve, thin verbs.                                                                     |
| **B0–B7**     | The branch/index/History/Review/merge substrate slices in [`deck-boxel-branch-index-backport.md`](./deck-boxel-branch-index-backport.md).                               |
| **Deck Core** | Protocol library: identity, packs, store, merge, serve grammar, optional timeline — not the Deck Hub app                                                              |

**Two living docs for execution** (everything else is appendix):

| Where          | Doc                                                                                    | Role                                                     |
| -------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Deck repo**  | [`deck-work-plan-for-backport.md`](./deck-work-plan-for-backport.md)                     | Protocol questions closed _here_ so Boxel PRs are wiring |
| **Boxel work** | [`deck-boxel-backport-changelist-mockup.md`](./deck-boxel-backport-changelist-mockup.md) | Stacked PRs, blast radius, agent prompts                 |

Appendix (why / deep dives): `deck-boxel-monorepo-change-register.md`, `deck-boxel-backport-plan.md`, `deck-depot-and-realm-backport.md`, [`deck-boxel-branch-index-backport.md`](./deck-boxel-branch-index-backport.md) (one realm, multiple branch indexes), [`deck-storage-backends.md`](../deck-storage-backends.md) (realm-contained Desktop + AWS storage), `deck-core-backport-split.md`, [`deck-daemon.md`](../deck-daemon.md) (deckd / `.deck`-only History + build). Sample decklist + `.gts` under `docs/artifacts/`.

Published host-mode fast path and immutable browser caching:
[`deck-boxel-host-publish-treehash.md`](./deck-boxel-host-publish-treehash.md).

---

## How we execute (campaign, not the benefit list)

The K1–K14 table is the destination. The **campaign** is shorter and stricter:

1. **Deck-side gate before Boxel A0.** Finish R0/W11 after the existing `extends`, classifier, provenance, bare/hermetic packs, lean Core cone, and foreign conformance work. The selected Core commit must write RRI-native Repository/lock plus Checkpoint/branch-head/Review V2 with realm-relative paths before it is vendored. Monorepo PRs must stay “call this / mount that,” not reopen design.
2. **Prove the decklist in product early.** After importer-aware resolve, ship a **thin** install / remix / use against a fixture LibSpec — before History, before Matrix, before catalog authority theater.
3. **Put branch/index identity below History.** Add `main` compatibility,
   branch-qualified index generations, and atomic source + completed-index
   clone first. Then slice the History hinge: Steps on one branch write path →
   restore API → one host restore surface → agent claims → CLI 3-way. Refuse
   History PRs that record realm-global Steps or reimplement merge/store in
   realm-server.
4. **Three tracks, different merge bars.**

| Track            | Owns                                                                                                  | May lag                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **A — Map**      | Resolver, decklist, thin verbs, LibSpec fixtures                                                      | Matrix, packs polish                                                       |
| **B — Tape**     | History / Steps / Versions, restore, CLI merge                                                        | Catalog CDN                                                                |
| **C — Carriage** | Classifier wiring, packs, GitHub share/gather interim                                                 | Base realm                                                                 |
| **D — Build**    | **deckd**: History under `.deck` only; esbuild/AMD derived plane ([`deck-daemon.md`](../deck-daemon.md)) | D0–D1 are required for per-branch History; only the D2 build plane may lag |

5. **Program gates** (falsifiable — not fourteen local Done whens):
   - Monorepo PRs are wiring, not design debates.
   - Algorithms imported from `@cardstack/deck`, not forked.
   - `deck conform` against a deck-enabled realm URL is green.
   - **Author gate:** remix of a multi-file package does not duplicate unchanged files.

**Demote / do not staff on the critical path:** negotiated prune; full Matrix submission (use GitHub share/gather + Base-Version until A+B are real); review-tools product (K13); minify gold-plating (K9); bulk vendor corpus and “catalog on CDN” as blockers for Map/Tape.

**Spines if you cut hard:**

- **First shippable stack:** R0 Deck V2 identity/collaboration gate → A0 Lean Core → A1
  resolver/scopes → A2 versioned serve door → A3 thin decklist verbs
- **Collaboration stack:** B0 protocol types → B1 realm-contained local/AWS
  storage + branch refs → B2
  branch-qualified index → B3 clone → B4 deckd History → B5 exact Review →
  B6 merge → B7 quiet UX

The Q1–Q11 execution decisions, including RRI identity, URL grammar, and index cloning, are
closed in
[`deck-boxel-branch-index-backport.md`](./deck-boxel-branch-index-backport.md#01-execution-decisions).

### Latest-main cut plan

The Boxel base is **fetched `origin/main` at the moment a stack is cut**, never the
developer's local `main` and never `deck/at-rest-poc`. On 2026-08-21 the
observed Boxel base was `81678bd877f7903d5bba95cf2925b09d076fb9ce`; the
local `main` checkout was 111 commits behind it. Fetch and record the base
again immediately before creating A0. A0 itself remains blocked until R0 is
green and its exact clean Deck commit is recorded.

Use a clean worktree so unrelated files in the current checkout cannot enter
the backport:

```text
origin/main at cut time
  └── codex/deck-backport-a0-core
        └── codex/deck-backport-a1-resolver
              └── codex/deck-backport-a2-serve
                    └── codex/deck-backport-a3-verbs
```

The A stack is deliberately narrow:

| Branch/PR | Contains                                                                                 | Must not contain                                     | Primary proof                                                                                   |
| --------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **A0**    | Current immutable Deck Core vendor at the selected R0 commit, exports, workspace wiring  | Resolver behavior, routes, Host UX, old fork history | install/build; RRI V2 Core tests and conformance remain green; host graph has no Node built-ins |
| **A1**    | RRI-native importer-aware resolver, RRI scopes, browser-map projection, lifted Map tests | Serve door, History, catalog redesign                | one RRI lock resolves two versions by importer and projects exact transport URLs                |
| **A2**    | Resolve exact Version RRIs through read-only package serving and cache/address contract  | Vendor corpus, publishing rewrite, verbs             | registered realm-server tests plus first applicable `deck conform`                              |
| **A3**    | Thin install/remix/use helpers and one real LibSpec/product fixture                      | History, Atlas/CRM rewrite, collaboration UI         | remix changes the decklist and does not copy unchanged package files                            |

For A0, select and record the exact clean Deck commit that passes R0/W11. Do
not vendor from a dirty Deck worktree or a pre-RRI Core. From
`deck/at-rest-poc`, transplant only tests or small adapter changes whose
behavior is still required; recreate them against current APIs instead of
cherry-picking old commits.

After A0–A3 merge, fetch `origin/main` again and cut the collaboration stack
from that new base:

| Slice   | Implementation cut                                                                                                                  | Merge gate                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **B0**  | Boxel adapter for Repository/Checkpoint/ref/Review types with Repository members expressed as RRI roots                             | RRI protocol objects round-trip; no realm behavior changes                                                       |
| **B1**  | Realm-contained `.deck` layout; Desktop FS + AWS S3 Files/direct-S3 adapters; branch ID/source directory, `main` compatibility, CAS | Same state machine passes locally/AWS; agents inspect but cannot POSIX-write protocol state                      |
| **B2a** | Add immutable index-generation manifest/hash and assign/backfill canonical scoped RRIs without changing read selection              | Postgres/SQLite project one canonical generation; URL-form legacy reads remain green                             |
| **B2b** | Make writer/query paths select a generation through RRI-bearing `RealmViewContext`; new index keys are scoped RRIs                  | Two completed generations for one realm return different answers for the same logical RRI                        |
| **B2c** | Qualify RRI loader/query caches, jobs, prerendering, invalidation, activity, and events                                             | A branch write cannot invalidate or leak into `main`; no canonical cache key uses transport URL                  |
| **B3**  | Atomic source + completed-index + deckd History initialization; cross-authority fork rebase                                         | Architecture fixture proves source, Browse, search, Run, History isolation, and fork assertions on both backends |
| **B4**  | One host-level deckd, independent per-branch jj History on local FS/S3 Files, save/restore through branch write path                | Restore cannot cross branches; branch creation initializes History ancestry                                      |
| **B5**  | Exact Review opening and immutable target/source/candidate Browse + Run projections                                                 | Review does not drift when either live branch moves                                                              |
| **B6**  | Core three-way merge, invisible candidate generation, target-head recheck, one target write batch and one Step                      | conflict/stale head changes nothing; success changes source/index/ref/History exactly once                       |
| **B7**  | Quiet branch selector, History context, Review/merge UI, and agent/CLI branch verbs                                                 | UI and CLI operate only through the real B1–B6 state                                                             |

B2a–B2c are separate reviewable PRs behind an unexposed capability; together
they satisfy B2. No branch UI appears before the B3 fixture is green. Host
publish treeHash work, full/incremental publish controls, Atlas, CRM rewrites,
Matrix, and catalog polish remain later stacks.

Every implementation PR runs lint in each modified package. Type checking uses
Glint, never `tsc`. Realm-server work gets focused `TEST_FILES` coverage;
Host work gets focused Ember tests with complete output captured to a file;
schema changes use the Postgres migration generator and regenerate the SQLite
schema before review.

---

## What Deck is (one paragraph)

Deck is a **versioning and serving protocol for module trees** (and JSON): immutable published **Versions**, a working “live” tree, content-addressed storage, 3-way merge, and a **History** of every-save **Steps**. In Boxel terms: a **realm can become deck-enabled** — same realm product word, with Deck’s versioning and serve rules underneath. Boxel stays the product; Deck Core is the library the realm server and host import.

Deck Core is a library drop, not the whole Deck teaching repo (no Hub, no demos).

---

## Versions vs History — what Boxel should turn on

Deck can run **Versions-only** (publish/restore named cuts, no every-save tape). That is fine for some catalog mirrors. **It is not the product default for editable Boxel realms.**

For Boxel we generally want **History on**:

| Who is writing                                                                                                 | What we want recorded                                                  | Why                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Human in the UI** (card instances, fields, layout, code in the host)                                         | A **Step** on every settled save                                       | Undo/restore, “what did the canvas look like an hour ago,” safe experimentation                 |
| **Agent-based updates** (especially **definitions** — `.gts` / card defs — and any agent write into the realm) | A **Step** per settled write batch; **claims** for “I am working here” | Audit what the agent changed, rewind a bad turn, parallel agents don’t erase each other’s trail |
| **Publish / milestone / catalog cut**                                                                          | A **Version** (immutable `@exact`)                                     | What others pin, cache, and remix against — not every keystroke                                 |

```text
UI edit or agent write  →  live tree changes  →  Step (History)
                                      └─ when you mean it  →  Version (store)
```

- **Steps** answer “what happened while we were editing.”
- **Versions** answer “what is the named release others depend on.”
- Restoring a Step does **not** rewrite published Versions.
- Agent **claims** (intent) and **touch/activity** (observed heat) are separate from Steps — see K12; don’t conflate “working here” with “captured a Step.”

The History hinge is therefore not “optional history if someone wants undo.” It is **History + Steps for interactive and agent edits**, with Versions as the publish layer on top. Catalog read-only mirrors may stay Versions-only; personal and team working realms should ship with History.

---

## An app is a decklist (import map)

This is easy to understate and expensive to miss.

In Deck terms, a running **app is not a folder of copied dependencies**. It is
a **decklist** — an import map (plus optional `scopes` and `extends`) that
says which **RRI / Version** answers each bare name. The cards and modules
you author sit in the live tree; everything else is a pin.

| Verb        | What actually changes                                                          |
| ----------- | ------------------------------------------------------------------------------ |
| **Use**     | Create an instance whose `adoptsFrom` is an exact versioned RRI                |
| **Install** | Add pins to _my_ decklist (manage upgrades later)                              |
| **Remix**   | `extends` a parent Version + override only what I change — **not** a tree copy |
| **Upgrade** | Repoint a pin / parent and re-resolve                                          |

So K5 and K8 are not four product features and a performance tip. They are
consequences of “the app _is_ the map.” If Boxel keeps teaching remix as
copy-the-package, we have not backported the model — only some plumbing.

Authors still write normal imports (`three`, `@cardstack/base/card-api`).
The decklist is where versions and coexistence live. See the sample in
`docs/artifacts/backport-remix-decklist.json` and PR 1 in the changelist.

**Naming: RRI before the first Boxel write.** RRI support is present in current
Boxel `origin/main`: `RealmResourceIdentifier`, `resolveRRI`, registered realm
mappings, and canonical dependency tracking. The backport completes the
missing authority for arbitrary realms and exact package Versions instead of
shipping a temporary URL identity.

```text
mutable realm/package root   @acme/gallery/
resource                     @acme/gallery/scene
exact imported Version       @catalog/three@0.169.0/
exact imported resource      @catalog/three@0.169.0/build/three.module.js
```

The branch is deliberately absent from the RRI. `@acme/gallery/scene` plus
`RealmViewContext(branch=improve-nav)` resolves to a URL containing the
internal `__deck/branch/<token>` transport view. An exact Checkpoint uses the
same logical RRI with an immutable Checkpoint view.

The branch's canonical lock is the RRI-native composition of its applicable
root and nested `importmap.json` inputs: bare names resolve to exact Version
RRIs and `scopes` are keyed by importer RRI. A1 deterministically projects this
lock into the absolute URL import map native ESM consumes. The projection is
transport, not authored identity, and is never merged separately.

URL-form RRIs remain a compatibility and foreign-intake form. New source,
code refs, Repository members, lock values, index identities, fixtures, and UI
write or display scoped RRIs. **PR 3 stays on the spine** because an exact
Version RRI still needs a real immutable HTTP representation.

---

## What we are trying to buy (the benefits)

| #       | Benefit in plain English                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| **K1**  | **History + Steps** behind UI and agent edits (restore/undo), plus **Versions** for publish/checkpoint — not Versions-only |
| **K2**  | Immutable, cacheable module URLs (CDN-grade caching when pinned to an exact version)                                       |
| **K3**  | Our own unpkg-style vendoring of third-party libs, with policy, browsable as catalog specs                                 |
| **K4**  | One checkpoint/milestone story; sync uses **3-way merge** instead of “pick local or remote”                                |
| **K5**  | Honest catalog verbs on a **decklist**: install / upgrade / remix / use (the app _is_ the map)                             |
| **K6**  | Catalog is the authority; GitHub is a read-only mirror (plus a safe intake path when needed)                               |
| **K7**  | Submit / review / vote across realms (not “open a GitHub PR” as the product workflow)                                      |
| **K8**  | Remix = decklist `extends` + overrides — **without** copying the whole tree                                                |
| **K9**  | Published releases can be minified and gzipped (safe because exact versions never change)                                  |
| **K10** | Versioned realm infra that can replace the github + npm + esm.sh combo for card apps/libs                                  |
| **K11** | Base realm (card-api, etc.) distributed via Deck import maps instead of a special snowflake                                |
| **K12** | Live agent awareness / activity visible in preview while work happens                                                      |
| **K13** | Richer review / patch tools over protocol data (versions, diffs, claims, offers)                                           |
| **K14** | Realm download / move as a real **Deck Pack** (with provenance); full “negotiate what to prune” later                      |

**K10** is the destination (the sum of the above), not a separate ticket.

---

## Where things land in the Boxel monorepo

Think in subsystems, not Deck package names:

| Boxel area                       | What Deck asks it to do                                                                                                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`packages/deck` (new)**        | Vendor Deck Core. Host imports the **browser-safe** surface (resolution). Realm-server imports the **Node** surface (store, pack, history helpers, serve helpers).                                                                      |
| **`runtime-common`**             | Resolver takes the _importer_ (so two versions of the same library can coexist); realm write path records **Steps** (and publishes **Versions** when appropriate); classification of absolute URLs imported from Core — not reinvented. |
| **`realm-server`**               | Serve Deck-shaped addresses and cache headers; **History attached for editable realms**; activity/claims read path; pack download/intake; later mirror job; ACL around offers.                                                          |
| **`host` (Ember app)**           | Remix / install / use UX; preview shows activity; restore/browse Steps from UI edits and agent turns; eventually base-realm URLs via Deck.                                                                                              |
| **`packages/boxel-cli`**         | Local checkpoints align with deckd History; sync conflicts become 3-way merges against an exact Checkpoint base. **The standalone `cardstack/boxel-cli` is retired** — this is the only CLI to migrate.                                 |
| **Catalog / realm content**      | LibSpec cards, four consumption verbs, submission workflow cards, review tools — much of K5/K7/K13 is **content**, not core TS.                                                                                                         |
| **Outside the monorepo (early)** | Hosted Deck / vendor pipeline / corpus migration for third-party libs (K3 bulk).                                                                                                                                                        |

Boxel keeps the word **realm**. “Depot” is Deck-standalone vocabulary; a deck-enabled realm _plays the role_ of a depot for the protocol.

---

## Order of operations

Order and dependencies matter more than calendar guesses. What sets the pace
is **review risk**, **blast radius** (especially base realm), and refusing
to reopen protocol design inside Boxel PRs. Sections below are the **campaign
order** — not “list every K benefit once.”

### Deck work plan complete — the gate before PR 0

Before PR 0: `extends`, classifier, provenance, bare/hermetic,
lean Core, foreign `deck conform`, scopes proof — see
[`deck-work-plan-for-backport.md`](./deck-work-plan-for-backport.md). If a
Boxel PR needs a design debate, the work returns here.

---

### Lean Core into the monorepo — PR 0

**Add:** `packages/deck` — protocol + serve grammar + history helpers +
conform surface. Browser entry for host / `runtime-common`; `/node` for
realm-server.

**Do not add:** Hub, examples, teaching CLI, npm vendor pipeline, minify
derive, rebase-daemon (Tools until a customer PR needs them).

**Gate:** install/build green; host graph pulls no `node:fs`; no realm
behavior change.

---

### Resolver that knows who is importing — PR 1 (**Track A**)

**Change in:** `runtime-common` (virtual network / loader).

**What we add:** importer context, longest-prefix, import-map **scopes**.

| Benefit unlocked                | Why                                                 |
| ------------------------------- | --------------------------------------------------- |
| **K8** Remix without copying    | One card on A@new, another path on A@old, both live |
| Path to **K5**, **K3**, **K11** | All need scoped resolution                          |

**Shape:** small. **First monorepo behavior PR.**

---

### Thin decklist verbs — PR 1b (**Track A**, early product win)

**Change in:** `runtime-common` decklist helpers; minimal host actions;
**fixture** LibSpec (not full catalog redesign).

**What we add:** install / remix / use (upgrade can be stubby) that mutate
the app **decklist** — `extends` + pins — and do **not** full-copy trees.

| Benefit unlocked                     | Why                                                            |
| ------------------------------------ | -------------------------------------------------------------- |
| Early **K5** + author-visible **K8** | Proves “app = decklist” in the product, not only in unit tests |

**Shape:** small–medium. **Do this before staffing History.** Full catalog
polish and package-page affordances can trail (PR 12 verb polish).

---

### Classifier on publish — PR 2 (**Track C**, parallel OK)

**Change in:** `realm-server` publish handler; **import**
`@cardstack/deck/classify` (do not fork).

| Benefit unlocked               | Why                                                |
| ------------------------------ | -------------------------------------------------- |
| Publish hygiene / **K14** prep | leave / rebind / rewrite; assets never become pins |

**Shape:** small; parallel with PR 1 / 1b. Not on the product spine.

---

### Versioned serve addresses — PR 3 (**on the spine**)

**Required by RRI-native locks.** The resolver can select
`@catalog/three@0.169.0/`, but the realm server must map that exact RRI to an
immutable `…/three@0.169.0/…` HTTP representation before anything can execute
the pin. PR 1b therefore depends on this small read-only handler and registry
gate.

**PR 3 also starts the `deck conform` CI job** (decided 2026-08-09). It is
the first Deck-shaped HTTP surface, so the program gate begins running here
rather than arriving finished and late. Most laws will report _not
applicable_ at first; the job tightens as PR 6 and PR 4b land.

What stays optional is the **corpus**: the npm crawl and bulk vendoring for
third-party libs (**K3**, catalog **K2**/**K9**) can live on a hosted Deck
outside the monorepo and must **not** block Track A or B. Staff the door now;
staff the corpus when someone owns it.

---

### Branch and index substrate — B0–B3 (**hard prerequisite to History**)

These are new slices below the older PR 4 numbering. They are not UI work.

| Slice  | Ship                                                                                           | Proof                                                   |
| ------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **B0** | Repository/Checkpoint/ref/Review types with RRI member roots                                   | RRI protocol fixture round-trips                        |
| **B1** | Realm-local `.deck`; local FS + AWS S3 Files/direct-S3 adapters; `main`, metadata, CAS refs    | Existing realm is unchanged; backend conformance passes |
| **B2** | Immutable index-generation identity with canonical RRI keys throughout writer/query/cache/jobs | Two indexes for one RRI coexist                         |
| **B3** | Source + completed-index + deckd History initialization; rebased fork clone                    | Browse/search/Run/History diverge without leaking       |

The logical realm grammar is fixed: `@<owner>/<repository>/` is the stable
mutable RRI, while `@<owner>/<repository>@<version>/` is an exact Version RRI.
The transport grammar is separate: unqualified URLs select the default branch;
`__deck/branch/<token>/…` selects a mutable branch; and
`__deck/checkpoint/<hash>/…` selects an immutable Checkpoint. Branch source owns
its exact composed import-map lock.

---

### History hinge — PRs 4a–4d, then 5 (**Track B**) — _sliced_, not one epic

**Runtime: Deck's `HistoryBackend` connected to deckd**, one supervised daemon
per realm-server host. Each branch has a stable opaque source directory, so
deckd gives it an independent jj History exposed as `.deck/history/repo` in
that branch's realm view. Desktop uses the ordinary filesystem; hosted Boxel
uses S3 Files. Do not attach jj or `.jj` to the realm-global root. Read-only
imports may be Versions-only. A mutable realm must reject a write clearly if
deckd cannot settle its every-save History; it must not silently degrade.

Do **not** ship editable realms as Versions-only and call K1 done.
Do **not** land write path + host UI + claims + CLI sync in one PR.

| Slice       | Ship                                                                        | Explicit non-goal  |
| ----------- | --------------------------------------------------------------------------- | ------------------ |
| **4a / B4** | Per-branch Steps on one write path via Deck façade                          | No host restore UI |
| **4b / B4** | List/restore HTTP through the same branch `Realm.write` path                | No agent claims UX |
| **4c / B7** | One host History list + restore, with quiet branch context                  | No CLI rewrite     |
| **4d**      | Agent writes → same Step path + claims; activity read if cheap              | No 3-way sync      |
| **5 / B6**  | CLI checkpoints + Core `mergeTrees` through one target write batch (**K4**) | No minify / CDN    |

Each slice: wire Core; **refuse** reimplementing merge/store in realm-server.
Gate with integration tests and, when the realm speaks enough HTTP,
`deck conform`.

| Benefit unlocked                 | Why                                              |
| -------------------------------- | ------------------------------------------------ |
| **K1**                           | Steps for edits; Versions when you publish a cut |
| **K4** (PR 5)                    | Real common ancestor for sync                    |
| Foundation for **K12** / **K13** | Claims and review read the same tape             |

---

### Base realm via Deck — PR 8 (**K11**)

**Highest blast radius** — every realm depends on base. Only after **PR 4c**
(restore works) so a bad base Version is recoverable.

---

### Cache classes, then activity — PRs 6 and 9 (**K2**, **K12**; PR 7 / **K9** demoted)

Exact Version → immutable cache; live → no-store (**K2**). Agent activity in
preview (**K12**) when PR 4d data exists. **Minify/gzip derivatives (K9)** only
after cache classes are trusted — easy to gold-plate; not a spine item.

---

### Catalog authority and collaboration — PR 11, then 13 (**K6**, then **K7**)

GitHub as **mirror** (**K6**). **Caveat:** `share` / `gather` exist only in
the retired standalone CLI, so the "interim truck" is currently the mirror
export plus `Base-Version` trailers — no CLI verbs — unless someone scopes
share/gather as new commands in `packages/boxel-cli`. Full Matrix submission / retire GH-PR-as-
product (**K7**) **after** Tracks A+B are real — do not staff Matrix early.

Catalog verb _polish_ (pretty package pages, upgrade UX) lands here if not
finished in PR 1b.

---

### Packs and review tools — PRs 10 and 14 (**K14**, **K13**)

Bare/hermetic packs with provenance (**K14**). Negotiated prune stays
undesigned. Review tools (**K13**) are content after Steps exist — trail,
don’t block.

---

## Dependency picture (campaign)

```text
 R0 Deck V2 gate             →  RRI + Checkpoint + Review + realm paths
 A0 lean Core drop           →  Boxel PRs stay wiring
 A1 RRI resolver + projection → K8
 A2 exact-RRI serve door      → a pin has an immutable representation
 A3 thin decklist verbs      →  early K5                     ← prove the model
 2  classifier on publish    →  parallel (Track C)
 3′ vendor corpus / CDN      →  optional; must not block A/B
 B0–B3 branch/index substrate → one realm, real isolated branches
 B4 deckd History + restore  → K1
 B5 exact Review              → real Browse + Run preview
 B6 target-batch merge        → K4
 B7 quiet branch/Review UX    → familiar workflow
 8  base via Deck            →  K11 (after PR 4c restore)
 6  cache, then 9 activity   →  K2, K12; PR 7 / K9 later
11  mirror; 13 Matrix later  →  K6, then K7
10  packs; 14 review trails  →  K14, K13
```

---

## What is _not_ “port the Deck Hub”

| Stays out of the first Boxel drop            | Why                                           |
| -------------------------------------------- | --------------------------------------------- |
| Deck Hub UI                                  | Inspiration only; Boxel has host + catalog UX |
| Deck example demos                           | Teaching artifacts                            |
| Full prune-negotiation protocol              | Undesigned; ship bare/hermetic first          |
| Treating GitHub as the registry              | Opposite of K6                                |
| Matrix submission as day-one work            | Interim = share/gather + Base-Version         |
| Fat Core (vendor-npm, minify, rebase-daemon) | Tools until a PR needs them                   |

Collaboration across private realms long-term: **Matrix** (identity + room +
message of intent) + optional Deck Pack; realm ACL for offer/rebase. Until
Tracks A+B ship, the GitHub mirror is the truck — not the authority. (The
`share`/`gather` CLI verbs that used to carry this live in the retired
standalone repo; see PR 11.)

---

## Practical “start Monday” checklist

1. Complete Deck R0/W11 and record the clean commit where RRI/Checkpoint/Review V2 Core
   tests and conformance pass.
2. Fetch Boxel `origin/main`; cut **A0 only** and add Lean `packages/deck`
   from that exact commit (old PR 0). Do not cherry-pick the stale fork.
3. Stack A1 RRI resolver/scopes/projection; author gate: **remix without copying** and no new authored absolute identity.
4. Stack A2 exact-RRI serve door — a Version RRI gains its immutable HTTP representation.
5. Stack A3 thin install/remix/use on a fixture — **before** History.
6. Parallel (optional owners): classifier publish (2), vendor corpus (3′).
7. Land **B0 → B3** branch/index substrate, then **B4 → B7**. Never land a
   realm-global History as an intermediate state.
8. Base realm (PR 8) only after Step restore works.
9. Mirror / share-gather (PR 11); Matrix retirement of GH submission last (PR 13).
10. Packs (PR 10) + review tools (PR 14) without blocking Map/Tape wins.

---

## Cheat sheet

| PR                         | Main Boxel touchpoints               | Benefits           | Shape                     |
| -------------------------- | ------------------------------------ | ------------------ | ------------------------- |
| — Deck gates               | Deck repo work plan                  | —                  | **hard gate**             |
| 0 Lean Core                | `packages/deck`                      | —                  | dependency drop           |
| 1 Resolver                 | `runtime-common`                     | K8                 | small — first behavior    |
| **1b Thin verbs**          | host + helpers + fixture             | **early K5**       | **product spine**         |
| 2 Classifier               | `realm-server`                       | publish / K14 prep | parallel OK               |
| **3 Serve door**           | `realm-server`                       | **address space**  | **spine — prereq for 1b** |
| 3′ Vendor corpus           | outside + content                    | K3, catalog K2     | optional early            |
| **4a–4d, 5 Tape**          | realm write, HTTP, host, claims, CLI | **K1, K4**         | **hinge — sliced**        |
| 8 Base realm               | `runtime-common`, `host`             | K11                | highest blast radius      |
| 6 Cache, 9 activity        | `realm-server`, `host`               | K2, K12 (K9 later) | medium                    |
| 11 Mirror; 13 Matrix later | content + jobs                       | K6, then K7        | process                   |
| 10 Packs; 14 review trails | content + `realm-server`             | K14, K13           | after tape                |

Commit-level Touch / Do / Don’t: `deck-boxel-backport-changelist-mockup.md`.

---

## One-sentence summary for stakeholders

We finish protocol decisions in Deck, stack Lean Core → resolver → versioned
serve → thin decklist verbs onto current Boxel main, then add branch refs and
cloned indexes before attaching a per-branch deckd History, exact Review, and
one-batch merge—after which caching, publishing, and catalog authority can
build on real collaboration state rather than UI simulation.
