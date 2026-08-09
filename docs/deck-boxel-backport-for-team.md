# Bringing Deck into Boxel — team brief

**Audience:** Boxel / Cardstack engineers who have not worked in the Deck repo.  
**Purpose:** Plain-English plan for what we gain, what lands where in Boxel, and in what order.  
**Assumption:** We start from a clean Boxel `main`, add a tight **Deck Core** package under something like `packages/deck`, and wire Boxel to it (no Hub UI, no Deck demos).

Internal numbering from our planning docs is kept in parentheses so you can match longer write-ups later. You do not need those docs to follow this.

| Shorthand | Means |
| --- | --- |
| **K1–K14** | The fourteen product benefits we want from Deck in Boxel |
| **P1–P4** | Four technical prerequisites that unlock most of those benefits |
| **PR 0–14** | The stack in [`deck-boxel-backport-changelist-mockup.md`](deck-boxel-backport-changelist-mockup.md). **The only numbering.** This doc groups those PRs; it does not number anything itself. |
| **Deck Core** | Protocol library: identity, packs, store, merge, serve grammar, optional timeline — not the Deck Hub app |

**Two living docs for execution** (everything else is appendix):

| Where | Doc | Role |
| --- | --- | --- |
| **Deck repo** | [`deck-work-plan-for-backport.md`](deck-work-plan-for-backport.md) | Protocol questions closed *here* so Boxel PRs are wiring |
| **Boxel work** | [`deck-boxel-backport-changelist-mockup.md`](deck-boxel-backport-changelist-mockup.md) | Stacked PRs, blast radius, agent prompts |

Appendix (why / deep dives): `deck-boxel-monorepo-change-register.md`, `deck-boxel-backport-plan.md`, `deck-depot-and-realm-backport.md`, `deck-core-backport-split.md`. Sample decklist + `.gts` under `docs/artifacts/`.

---

## How we execute (campaign, not the benefit list)

The K1–K14 table is the destination. The **campaign** is shorter and stricter:

1. **Deck-side gate before Boxel PR 0.** `extends`, classifier, provenance, bare/hermetic packs, lean Core cone, and `deck conform` against a foreign URL — settled in the Deck work plan. Monorepo PRs must stay “call this / mount that,” not reopen design.
2. **Prove the decklist in product early.** After importer-aware resolve, ship a **thin** install / remix / use against a fixture LibSpec — before Timeline, before Matrix, before catalog authority theater.
3. **Slice the Timeline hinge.** Steps on one write path → restore API → one host restore surface → agent claims → CLI 3-way. Refuse Timeline PRs that reimplement merge/store in realm-server.
4. **Three tracks, different merge bars.**

| Track | Owns | May lag |
| --- | --- | --- |
| **A — Map** | Resolver, decklist, thin verbs, LibSpec fixtures | Matrix, packs polish |
| **B — Tape** | Timeline / Steps / Versions, restore, CLI merge | Catalog CDN |
| **C — Carriage** | Classifier wiring, packs, GitHub share/gather interim | Base realm |

5. **Program gates** (falsifiable — not fourteen local Done whens):
   - Monorepo PRs are wiring, not design debates.
   - Algorithms imported from `@cardstack/deck`, not forked.
   - `deck conform` against a deck-enabled realm URL is green.
   - **Author gate:** remix of a multi-file package does not duplicate unchanged files.

**Demote / do not staff on the critical path:** negotiated prune; full Matrix submission (use GitHub share/gather + Base-Version until A+B are real); review-tools product (K13); minify gold-plating (K9); bulk vendor corpus and “catalog on CDN” as blockers for Map/Tape.

**Spines if you cut hard:**

- **Product:** resolver → versioned serve door → thin decklist verbs → Timeline restore  
- **Infra:** resolver → Timeline write path → CLI 3-way  

---

## What Deck is (one paragraph)

Deck is a **versioning and serving protocol for module trees** (and JSON): immutable published **Versions**, a working “live” tree, content-addressed storage, 3-way merge, and a **Timeline** of every-save **Steps**. In Boxel terms: a **realm can become deck-enabled** — same realm product word, with Deck’s versioning and serve rules underneath. Boxel stays the product; Deck Core is the library the realm server and host import.

Deck Core is a library drop, not the whole Deck teaching repo (no Hub, no demos).

---

## Versions vs Timeline — what Boxel should turn on

Deck can run **Versions-only** (publish/restore named cuts, no every-save tape). That is fine for some catalog mirrors. **It is not the product default for editable Boxel realms.**

For Boxel we generally want **Timeline on**:

| Who is writing | What we want recorded | Why |
| --- | --- | --- |
| **Human in the UI** (card instances, fields, layout, code in the host) | A **Step** on every settled save | Undo/restore, “what did the canvas look like an hour ago,” safe experimentation |
| **Agent-based updates** (especially **definitions** — `.gts` / card defs — and any agent write into the realm) | A **Step** per settled write batch; **claims** for “I am working here” | Audit what the agent changed, rewind a bad turn, parallel agents don’t erase each other’s trail |
| **Publish / milestone / catalog cut** | A **Version** (immutable `@exact`) | What others pin, cache, and remix against — not every keystroke |

```text
UI edit or agent write  →  live tree changes  →  Step (Timeline)
                                      └─ when you mean it  →  Version (store)
```

- **Steps** answer “what happened while we were editing.”  
- **Versions** answer “what is the named release others depend on.”  
- Restoring a Step does **not** rewrite published Versions.  
- Agent **claims** (intent) and **touch/activity** (observed heat) are separate from Steps — see K12; don’t conflate “working here” with “captured a Step.”

The Timeline hinge is therefore not “optional history if someone wants undo.” It is **Timeline + Steps for interactive and agent edits**, with Versions as the publish layer on top. Catalog read-only mirrors may stay Versions-only; personal and team working realms should ship with Timeline.

---

## An app is a decklist (import map)

This is easy to understate and expensive to miss.

In Deck terms, a running **app is not a folder of copied dependencies**. It is
a **decklist** — an import map (plus optional `scopes` and `extends`) that
says which **RRI / Version** answers each bare name. The cards and modules
you author sit in the live tree; everything else is a pin.

| Verb | What actually changes |
| --- | --- |
| **Use** | Create an instance whose `adoptsFrom` is an exact versioned RRI |
| **Install** | Add pins to *my* decklist (manage upgrades later) |
| **Remix** | `extends` a parent Version + override only what I change — **not** a tree copy |
| **Upgrade** | Repoint a pin / parent and re-resolve |

So K5 and K8 are not four product features and a performance tip. They are
consequences of “the app *is* the map.” If Boxel keeps teaching remix as
copy-the-package, we have not backported the model — only some plumbing.

Authors still write normal imports (`three`, `@cardstack/base/card-api`).
The decklist is where versions and coexistence live. See the sample in
`docs/artifacts/backport-remix-decklist.json` and PR 1 in the changelist.

**Naming: fully-qualified URLs now, RRI aliases later.** Boxel's RRI grammar
today is a scoped identifier (`@cardstack/base/card-api`) or a full URL —
there is no version segment, and no `@catalog/` or `@workspace/` prefix. We
are not waiting for one. The version lives in the **path**
(`https://app.boxel.ai/catalog/lib/three@0.169.0/…`), which is Deck's own
serve grammar, so the backport builds and runs on what exists. When the
[RRI migration](https://linear.app/cardstack/project/cardstackbase-defea0d67319)
adds the aliases, the swap is a rewrite of decklist values — one
`importmap.json` per deck, using the classifier we already need for publish.
Deck's `extends` accepts both forms today, so nothing there has to change.

The cost of the ruling is one sequencing change: **PR 3 moves onto the
spine**, because a pin needs a servable `@version` address to point at.

---

## What we are trying to buy (the benefits)

| # | Benefit in plain English |
| --- | --- |
| **K1** | **Timeline + Steps** behind UI and agent edits (restore/undo), plus **Versions** for publish/checkpoint — not Versions-only |
| **K2** | Immutable, cacheable module URLs (CDN-grade caching when pinned to an exact version) |
| **K3** | Our own unpkg-style vendoring of third-party libs, with policy, browsable as catalog specs |
| **K4** | One checkpoint/milestone story; sync uses **3-way merge** instead of “pick local or remote” |
| **K5** | Honest catalog verbs on a **decklist**: install / upgrade / remix / use (the app *is* the map) |
| **K6** | Catalog is the authority; GitHub is a read-only mirror (plus a safe intake path when needed) |
| **K7** | Submit / review / vote across realms (not “open a GitHub PR” as the product workflow) |
| **K8** | Remix = decklist `extends` + overrides — **without** copying the whole tree |
| **K9** | Published releases can be minified and gzipped (safe because exact versions never change) |
| **K10** | Versioned realm infra that can replace the github + npm + esm.sh combo for card apps/libs |
| **K11** | Base realm (card-api, etc.) distributed via Deck import maps instead of a special snowflake |
| **K12** | Live agent awareness / activity visible in preview while work happens |
| **K13** | Richer review / patch tools over protocol data (versions, diffs, claims, offers) |
| **K14** | Realm download / move as a real **Deck Pack** (with provenance); full “negotiate what to prune” later |

**K10** is the destination (the sum of the above), not a separate ticket.

---

## Where things land in the Boxel monorepo

Think in subsystems, not Deck package names:

| Boxel area | What Deck asks it to do |
| --- | --- |
| **`packages/deck` (new)** | Vendor Deck Core. Host imports the **browser-safe** surface (resolution). Realm-server imports the **Node** surface (store, pack, history helpers, serve helpers). |
| **`runtime-common`** | Resolver takes the *importer* (so two versions of the same library can coexist); realm write path records **Steps** (and publishes **Versions** when appropriate); classification of absolute URLs imported from Core — not reinvented. |
| **`realm-server`** | Serve Deck-shaped addresses and cache headers; **Timeline attached for editable realms**; activity/claims read path; pack download/intake; later mirror job; ACL around offers. |
| **`host` (Ember app)** | Remix / install / use UX; preview shows activity; restore/browse Steps from UI edits and agent turns; eventually base-realm URLs via Deck. |
| **`packages/boxel-cli`** | Local checkpoints align with Timeline/Steps; sync conflicts become 3-way merges against a Version (or Step) base. **The standalone `cardstack/boxel-cli` is retired** — this is the only CLI to migrate. |
| **Catalog / realm content** | LibSpec cards, four consumption verbs, submission workflow cards, review tools — much of K5/K7/K13 is **content**, not core TS. |
| **Outside the monorepo (early)** | Hosted Deck / vendor pipeline / corpus migration for third-party libs (K3 bulk). |

Boxel keeps the word **realm**. “Depot” is Deck-standalone vocabulary; a deck-enabled realm *plays the role* of a depot for the protocol.

---

## Order of operations

Order and dependencies matter more than calendar guesses. What sets the pace
is **review risk**, **blast radius** (especially base realm), and refusing
to reopen protocol design inside Boxel PRs. Sections below are the **campaign
order** — not “list every K benefit once.”

### Deck work plan complete — the gate before PR 0

Before PR 0: `extends`, classifier, provenance, bare/hermetic,
lean Core, foreign `deck conform`, scopes proof — see
[`deck-work-plan-for-backport.md`](deck-work-plan-for-backport.md). If a
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

| Benefit unlocked | Why |
| --- | --- |
| **K8** Remix without copying | One card on A@new, another path on A@old, both live |
| Path to **K5**, **K3**, **K11** | All need scoped resolution |

**Shape:** small. **First monorepo behavior PR.**

---

### Thin decklist verbs — PR 1b (**Track A**, early product win)

**Change in:** `runtime-common` decklist helpers; minimal host actions;
**fixture** LibSpec (not full catalog redesign).

**What we add:** install / remix / use (upgrade can be stubby) that mutate
the app **decklist** — `extends` + pins — and do **not** full-copy trees.

| Benefit unlocked | Why |
| --- | --- |
| Early **K5** + author-visible **K8** | Proves “app = decklist” in the product, not only in unit tests |

**Shape:** small–medium. **Do this before staffing Timeline.** Full catalog
polish and package-page affordances can trail (PR 12 verb polish).

---

### Classifier on publish — PR 2 (**Track C**, parallel OK)

**Change in:** `realm-server` publish handler; **import**
`@cardstack/deck/classify` (do not fork).

| Benefit unlocked | Why |
| --- | --- |
| Publish hygiene / **K14** prep | leave / rebind / rewrite; assets never become pins |

**Shape:** small; parallel with PR 1 / 1b. Not on the product spine.

---

### Versioned serve addresses — PR 3 (**on the spine**)

**Was "optional early"; the URL-first naming ruling moved it.** The realm
server has to answer `…/three@0.169.0/…` before anything can pin a version,
so PR 1b has nothing to install from until this lands. The serve door is
small — a read-only handler plus a thin registry gate.

**PR 3 also starts the `deck conform` CI job** (decided 2026-08-09). It is
the first Deck-shaped HTTP surface, so the program gate begins running here
rather than arriving finished and late. Most laws will report *not
applicable* at first; the job tightens as PR 6 and PR 4b land.

What stays optional is the **corpus**: the npm crawl and bulk vendoring for
third-party libs (**K3**, catalog **K2**/**K9**) can live on a hosted Deck
outside the monorepo and must **not** block Track A or B. Staff the door now;
staff the corpus when someone owns it.

---

### Timeline hinge — PRs 4a–4d, then 5 (**Track B**) — *sliced*, not one epic

**Runtime: the `jj` binary in the realm-server image** (decided 2026-08-09).
The faster `historyd` backend is a later swap behind an identical contract;
shipping a binary avoids a second process to deploy and supervise, and Steps
are debounced so the per-call cost stays off the hot path. It is a deployment
task with an owner. A realm whose Timeline cannot start degrades to
Versions-only with a printed reason — it never fails writes.

Do **not** ship editable realms as Versions-only and call K1 done.
Do **not** land write path + host UI + claims + CLI sync in one PR.

| Slice | Ship | Explicit non-goal |
| --- | --- | --- |
| **4a** | Steps on *one* write path (definition saves or batched writes) via Deck façade | No host restore UI |
| **4b** | List/restore HTTP through normal `Realm.write` | No agent claims UX |
| **4c** | One host history list + restore | No CLI rewrite |
| **4d** | Agent writes → same Step path + claims; activity read if cheap | No 3-way sync |
| **5** | CLI checkpoints + `mergeTrees` 3-way (**K4**) | No minify / CDN |

Each slice: wire Core; **refuse** reimplementing merge/store in realm-server.
Gate with integration tests and, when the realm speaks enough HTTP,
`deck conform`.

| Benefit unlocked | Why |
| --- | --- |
| **K1** | Steps for edits; Versions when you publish a cut |
| **K4** (PR 5) | Real common ancestor for sync |
| Foundation for **K12** / **K13** | Claims and review read the same tape |

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

Catalog verb *polish* (pretty package pages, upgrade UX) lands here if not
finished in PR 1b.

---

### Packs and review tools — PRs 10 and 14 (**K14**, **K13**)

Bare/hermetic packs with provenance (**K14**). Negotiated prune stays
undesigned. Review tools (**K13**) are content after Steps exist — trail,
don’t block.

---

## Dependency picture (campaign)

```text
−1  Deck work plan gates     →  Boxel PRs stay wiring
 0  lean Core drop
 1  resolver                 →  K8
1b  thin decklist verbs      →  early K5 (product spine)     ← prove the model
 2  classifier on publish    →  parallel (Track C)
 3  versioned serve door     →  spine: a pin needs an address  ← prereq for 1b
 3′ vendor corpus / CDN      →  optional; must not block A/B
4a–4d, 5  Timeline slices    →  K1, then K4                  ← hinge, sliced
 8  base via Deck            →  K11 (after PR 4c restore)
 6  cache, then 9 activity   →  K2, K12; PR 7 / K9 later
11  mirror; 13 Matrix later  →  K6, then K7
10  packs; 14 review trails  →  K14, K13
```

---

## What is *not* “port the Deck Hub”

| Stays out of the first Boxel drop | Why |
| --- | --- |
| Deck Hub UI | Inspiration only; Boxel has host + catalog UX |
| Deck example demos | Teaching artifacts |
| Full prune-negotiation protocol | Undesigned; ship bare/hermetic first |
| Treating GitHub as the registry | Opposite of K6 |
| Matrix submission as day-one work | Interim = share/gather + Base-Version |
| Fat Core (vendor-npm, minify, rebase-daemon) | Tools until a PR needs them |

Collaboration across private realms long-term: **Matrix** (identity + room +
message of intent) + optional Deck Pack; realm ACL for offer/rebase. Until
Tracks A+B ship, the GitHub mirror is the truck — not the authority. (The
`share`/`gather` CLI verbs that used to carry this live in the retired
standalone repo; see PR 11.)

---

## Practical “start Monday” checklist

1. Confirm the Deck work-plan gates — do not open Boxel design debates.
2. Clean Boxel `main`; add **lean** `packages/deck` (PR 0).
3. PR 1 resolver; author gate: **remix without copying**.
4. PR **3** serve door — versioned addresses, so a pin has a target.
5. PR **1b** thin install/remix/use on a fixture — **before** Timeline.
6. Parallel (optional owners): classifier publish (2), vendor corpus (3′).
7. Staff Timeline as **4a → 4d → 5** slices with restore before base realm.
8. Base realm (PR 8) only after Step restore works.
9. Mirror / share-gather (PR 11); Matrix retirement of GH submission last (PR 13).
10. Packs (PR 10) + review tools (PR 14) without blocking Map/Tape wins.

---

## Cheat sheet

| PR | Main Boxel touchpoints | Benefits | Shape |
| --- | --- | --- | --- |
| — Deck gates | Deck repo work plan | — | **hard gate** |
| 0 Lean Core | `packages/deck` | — | dependency drop |
| 1 Resolver | `runtime-common` | K8 | small — first behavior |
| **1b Thin verbs** | host + helpers + fixture | **early K5** | **product spine** |
| 2 Classifier | `realm-server` | publish / K14 prep | parallel OK |
| **3 Serve door** | `realm-server` | **address space** | **spine — prereq for 1b** |
| 3′ Vendor corpus | outside + content | K3, catalog K2 | optional early |
| **4a–4d, 5 Tape** | realm write, HTTP, host, claims, CLI | **K1, K4** | **hinge — sliced** |
| 8 Base realm | `runtime-common`, `host` | K11 | highest blast radius |
| 6 Cache, 9 activity | `realm-server`, `host` | K2, K12 (K9 later) | medium |
| 11 Mirror; 13 Matrix later | content + jobs | K6, then K7 | process |
| 10 Packs; 14 review trails | content + `realm-server` | K14, K13 | after tape |

Commit-level Touch / Do / Don’t: `deck-boxel-backport-changelist-mockup.md`.

---

## One-sentence summary for stakeholders

We finish protocol decisions in Deck, drop a lean Core into Boxel, treat an
**app as a decklist** addressed by fully-qualified URLs until the RRI
migration hands us aliases, prove remix/install without copying **before** we
attach a Timeline of Steps (Versions on publish), then serve/cache correctly
and move registry authority into the catalog — with GitHub share/gather as
interim collaboration and Matrix later, never as the source of truth.
