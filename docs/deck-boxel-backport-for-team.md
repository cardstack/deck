# Bringing Deck into Boxel — team brief

**Audience:** Boxel / Cardstack engineers who have not worked in the Deck repo.  
**Purpose:** Plain-English plan for what we gain, what lands where in Boxel, and in what order.  
**Assumption:** We start from a clean Boxel `main`, add a tight **Deck Core** package under something like `packages/deck`, and wire Boxel to it (no Hub UI, no Deck demos).

Internal numbering from our planning docs is kept in parentheses so you can match longer write-ups later. You do not need those docs to follow this.

| Shorthand | Means |
| --- | --- |
| **K1–K14** | The fourteen product benefits we want from Deck in Boxel |
| **P1–P4** | Four technical prerequisites that unlock most of those benefits |
| **R1–R5** | Suggested release / phase order |
| **Deck Core** | Protocol library: identity, packs, store, merge, serve grammar, optional timeline — not the Deck Hub app |

Companions (optional deep dives):  
`deck-boxel-monorepo-change-register.md`, `deck-boxel-backport-plan.md`, `deck-depot-and-realm-backport.md`, `deck-work-plan-for-backport.md`,
`deck-boxel-backport-changelist-mockup.md` (stacked PR walkthrough with author-facing examples; sample decklist + `.gts` under `docs/artifacts/`).

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

Phase 5 is therefore not “optional history if someone wants undo.” It is **Timeline + Steps for interactive and agent edits**, with Versions as the publish layer on top. Catalog read-only mirrors may stay Versions-only; personal and team working realms should ship with Timeline.

---

## What we are trying to buy (the benefits)

| # | Benefit in plain English |
| --- | --- |
| **K1** | **Timeline + Steps** behind UI and agent edits (restore/undo), plus **Versions** for publish/checkpoint — not Versions-only |
| **K2** | Immutable, cacheable module URLs (CDN-grade caching when pinned to an exact version) |
| **K3** | Our own unpkg-style vendoring of third-party libs, with policy, browsable as catalog specs |
| **K4** | One checkpoint/milestone story; sync uses **3-way merge** instead of “pick local or remote” |
| **K5** | Honest catalog verbs: install / upgrade / remix / use (not one blunt “copy”) |
| **K6** | Catalog is the authority; GitHub is a read-only mirror (plus a safe intake path when needed) |
| **K7** | Submit / review / vote across realms (not “open a GitHub PR” as the product workflow) |
| **K8** | Remix **without** copying the whole tree — override only what you change |
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
| **`boxel-cli`** | Local checkpoints align with Timeline/Steps; sync conflicts become 3-way merges against a Version (or Step) base. |
| **Catalog / realm content** | LibSpec cards, four consumption verbs, submission workflow cards, review tools — much of K5/K7/K13 is **content**, not core TS. |
| **Outside the monorepo (early)** | Hosted Deck / vendor pipeline / corpus migration for third-party libs (K3 bulk). |

Boxel keeps the word **realm**. “Depot” is Deck-standalone vocabulary; a deck-enabled realm *plays the role* of a depot for the protocol.

---

## Order of operations

Order and dependencies matter more than calendar guesses. With AI-assisted
implementation, wiring goes much faster than classical estimates; what still
sets the pace is **review risk**, **blast radius** (especially base realm),
and a few design gaps (negotiated packs, full Matrix submission). Below,
phases are labeled by shape — small / parallelizable / hinge — not by weeks.

### Phase 0 — Drop Core into the monorepo

**Add:** `packages/deck` (tight Core only).  
**Do not add:** Deck Hub, Deck examples, Deck’s teaching CLI as a dependency of Boxel.

**Gate:** we can run Deck’s conformance suite against a URL once the realm speaks enough of the protocol (`deck conform`).

**Benefits yet:** none for end users — this is the dependency cone.

---

### Phase 1 — Resolver that knows who is importing (**R1a / P1**)

**Change in:** `runtime-common` (virtual network / loader). Small PR; should not change behavior for today’s single-version maps.

**What we add:** resolution with importer context, longest-prefix matching, import-map **scopes** shape.

| Benefit unlocked | Why |
| --- | --- |
| **K8** Remix without copying | Acceptance test for this phase: one card on library A@new, another path still on A@old, both live |
| Path to **K5**, **K3**, **K11** | Those all need scoped resolution |

**Shape:** small, low risk. **Do this first.**

---

### Phase 2 — Safer publish + shared URL classifier (**P4**, publish stage 1)

**Change in:** `realm-server` publish handler; import classifier from `packages/deck` (do not fork the logic into `runtime-common`).

**What we add:** correct treatment of absolute URLs when copying/publishing (dependency vs asset vs rebind). Big standalone win even before “full Deck history.”

| Benefit unlocked | Why |
| --- | --- |
| Early half of **K14** / publish hygiene | Intake and publish stop guessing what an HTTPS string means |
| Faster, safer realm publish | Less fan-out / clearer rewrites |

**Shape:** small; can overlap Phase 1.

---

### Phase 3 — Our own library CDN (**R1b / K3**, mostly outside monorepo)

**Change in:** hosted Deck (or equivalent), vendor pipeline, catalog **content** (LibSpec). Light `realm-server` serve wiring as needed.

**What we add:** third-party JS ingested under our policy, addressed like first-class packages, browsable in catalog.

| Benefit unlocked | Why |
| --- | --- |
| **K3** Vendoring + LibSpec | The unpkg/esm.sh replacement for libs we care about |
| Most of **K2** for those packages | Exact versions → cacheable |

**Shape:** parallel track outside the monorepo (ops + catalog content), light Boxel wiring.

---

### Phase 4 — Distribute the catalog via Deck (**R2**)

**Change in:** how catalog (and later other read-only realms) are published/served — Cloudflare or similar, HTTP/2, gzip. Not “rewrite every realm” yet.

| Benefit unlocked | Why |
| --- | --- |
| Catalog-side **K2** / **K9** | Fast, cacheable catalog modules |
| Prep for **K6** | Catalog starts behaving like an authoritative store |

**Shape:** mostly outside + small wiring.  
**Defer base realm (K11)** until after history/restore exists.

---

### Phase 5 — Timeline on the realm write path (**R3 / P2**) — the hinge

**Change in:** `runtime-common` realm writes; `realm-server` history backend; **`boxel-cli`** checkpoint/sync (**K4** in the same effort); host surfaces that restore/list Steps.

**What we add (product intent):**

1. **UI saves** → settle into a **Step** on the realm Timeline (debounced the way Deck’s live loop already does).  
2. **Agent writes** (definition files and instance updates alike) → same path: settled batches become **Steps**, with **claims** marking the path under edit.  
3. **Publish / milestone / “make this the cut others pin”** → a **Version** in the store (may record which Step it was cut from).  
4. CLI sync uses a real common ancestor (Version or Step) for **3-way merge**, not prefer-local theater.

Do **not** ship editable realms as Versions-only and call K1 done. Versions-only is a valid mode for some read-only catalog mounts; working realms need the tape.

| Benefit unlocked | Why |
| --- | --- |
| **K1** Timeline for UI + agent edits; Versions for publish | Steps on the write path; Versions when you cut a release |
| **K4** Unified checkpoint + 3-way sync | Needs that merge base; don’t build sync twice |
| Foundation for **K12** / **K13** | Activity and review tools read Steps, claims, and Versions together |

**Shape:** the hinge — largest monorepo change, highest integration risk. Schedule as one epic; earlier phases stay small on purpose so this PR is “wire Core,” not “invent versioning.”

---

### Phase 6 — Base realm via Deck (**R3.5 / K11**)

**Change in:** `runtime-common` / `host` mappings; how base (`card-api`, etc.) is published and resolved.

| Benefit unlocked | Why |
| --- | --- |
| **K11** Base realm as Deck packages | Common fields/modules via import map + exact versions |

**Shape:** not huge in code, **highest blast radius** — every realm depends on base. Only after restore (Phase 5) so a bad base Version is recoverable.

---

### Phase 7 — Deck serve rules on the realm server (**R4 / P3**)

**Change in:** `realm-server` handlers and cache policy; wire activity; minify/derive pipeline as needed.

**What we add:** exact version → immutable caching; live → no-store; optional compressed derived artifacts; read path for agent activity in preview.

| Benefit unlocked | Why |
| --- | --- |
| **K2** (fully) | Cache classes correct for versioned vs live |
| **K9** Minified + gzipped releases | Safe because bytes at `@exact` never change |
| **K12** Live agent monitoring in preview | Activity protocol read path + existing preview |
| Data for **K13** | Versions/steps/claims available to build review UI on |

**Shape:** medium wiring across serve path, derive/minify, and host preview.

---

### Phase 8 — Catalog as the product registry (**R5**)

**Change in:** mostly **catalog realm content** + small `realm-server` jobs; retire GitHub-PR-as-submission where Deck/Matrix replaces it.

**What we add:**

- Catalog verbs in the product (**K5**): install / upgrade / remix / use  
- GitHub as **mirror** of authority, not the source of truth (**K6**)  
- Inter-realm submission / review — Matrix identity, room, and message as the “message of intent”; realm ACL for who may offer / accept; Deck Pack attached when the tip isn’t public (**K7**)  
- Human “share/gather” against GitHub remains an interim for teams that already live there  

| Benefit unlocked | Why |
| --- | --- |
| **K5**, **K6**, **K7** | Authority + workflow move into realms |
| **K10** becomes believable | Catalog + versions + cache + verbs cover the old stack |

**Shape:** heavy on catalog **content** and process (mirror policy, Matrix submission), light on new monorepo surface area.

---

### Phase 9 — Review tools and packs (**K13**, **K14**)

**Change in:** realm/catalog **content** for review UX (**K13**); `realm-server` download/publish as Deck Pack (**K14**).

| Benefit unlocked | Why |
| --- | --- |
| **K13** | Interesting diff/review over Versions, offers, claims — can trail Phase 5+ |
| **K14** | `bare` pack ≈ today’s download with provenance; `hermetic` pack carries dependency bytes; **negotiated** prune across trust boundaries is still a design problem — don’t block earlier phases on it |

**Shape:** K13 is content/UI once Phase 5 data exists; K14 bare/hermetic is wiring — negotiated prune waits on design.

---

## Dependency picture (simple)

```text
Phase 1  resolver          →  remix without copy (K8)
Phase 2  classifier        →  safer publish / pack intake
Phase 3  vendoring         →  own unpkg (K3)
Phase 4  catalog on Deck   →  fast catalog modules
Phase 5  Timeline + Versions + CLI → Steps for UI/agent edits (K1), 3-way sync (K4)  ← hinge
Phase 6  base via Deck     →  K11
Phase 7  serve + activity  →  K2, K9, K12
Phase 8  catalog product   →  K5, K6, K7  (→ K10 as outcome)
Phase 9  review + packs    →  K13, K14
```

---

## What is *not* “port the Deck Hub”

| Stays out of the first Boxel drop | Why |
| --- | --- |
| Deck Hub UI | Inspiration only; Boxel has host + catalog UX |
| Deck example demos | Teaching artifacts |
| Full prune-negotiation protocol | Undesigned; ship bare/hermetic first |
| Treating GitHub as the registry | Opposite of K6 |

Collaboration across private realms: **Matrix** (identity + room + message of intent), with optional **Deck Pack** attachment; realm ACL for offer/rebase. Until that ships, GitHub share/gather-style intake is an interim truck — not the long-term authority.

---

## Practical “start Monday” checklist

1. Clean Boxel `main` branch / fork.  
2. Add tight **`packages/deck`** (Core only).  
3. Land **Phase 1** resolver PR; prove **remix without copying (K8)**.  
4. In parallel: classifier/publish (Phase 2) and vendoring host (Phase 3).  
5. Only then staff the **Phase 5** epic (Timeline/Steps on UI + agent writes, Versions on publish, CLI 3-way).  
6. Base realm (Phase 6) after Step restore works.  
7. Catalog product + mirror + submission (Phase 8) when Timeline/Versions and serve path exist.  
8. Packs and review tools (Phase 9) without blocking earlier user-visible wins.

---

## Phase cheat sheet

| Phase | Main Boxel touchpoints | Benefits | Shape |
| --- | --- | --- | --- |
| 0 Drop Core | `packages/deck` | — | dependency drop |
| 1 Resolver | `runtime-common` | K8 | small — first |
| 2 Classifier / publish | `realm-server` | publish / K14 prep | small — parallel OK |
| 3 Vendoring | outside + catalog content | K3, early K2 | parallel outside track |
| 4 Catalog distribute | host/serve ops | catalog K2/K9 | ops + light wiring |
| 5 Timeline + Versions + CLI | `runtime-common`, `realm-server`, `boxel-cli`, host restore | **K1, K4** | **hinge — Steps for UI/agent; Versions for publish** |
| 6 Base realm | `runtime-common`, `host` | K11 | highest blast radius |
| 7 Serve + activity | `realm-server`, `host` | K2, K9, K12 | medium wiring |
| 8 Catalog product | content + `realm-server` | K5, K6, K7 | content + process |
| 9 Review + packs | content + `realm-server` | K13, K14 | trails Phase 5+ |

For a commit-by-commit walkthrough of *which files change and what to do
there*, see `deck-boxel-backport-changelist-mockup.md`.

---

## One-sentence summary for stakeholders

We add a small Deck Core package to Boxel, first teach the loader to resolve libraries in context (so remix stops copying), then put a **Timeline of Steps** behind UI and agent edits (with **Versions** when we publish), so restore and 3-way sync work, then serve and cache those versions properly, and finally make the catalog the authoritative registry—with GitHub and Matrix as collaboration channels, not the source of truth.
