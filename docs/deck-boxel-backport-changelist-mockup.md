# Bringing Deck into Boxel — proposed PR series

**Living doc for Boxel wiring** (paired with
[`deck-work-plan-for-backport.md`](deck-work-plan-for-backport.md) in the Deck
repo — protocol questions close there first). Product context:
[`deck-boxel-backport-for-team.md`](deck-boxel-backport-for-team.md)
(**How we execute**, **An app is a decklist**).

This is a story of the work, told as stacked pull requests. It was written
after walking today’s Boxel tree (`runtime-common`, `realm-server`, `host`)
and standalone `boxel-cli`. Read it to feel **blast radius**, to brief an
implementation agent, or to show a teammate what card authors and realm users
will actually get when each slice lands.

It is a design of the work — not a measured diff. The `+ / −` counts under
each commit are order-of-magnitude guesses after reading the real files;
they tell you *where the mass is*, not what to put in a spreadsheet.

**This doc owns the numbering.** PR 0–14 below are the only identifiers;
the team brief groups them and does not number anything of its own. If you
see a "Phase 5" anywhere, it is stale.

**Campaign order beats numeric order.** Do not blindly merge 0→14. Prefer:

- **Product spine:** PR 1 → **PR 3** (versioned addresses) → **PR 1b** (thin
  verbs) → PR 4c (host restore)
- **Infra spine:** PR 1 → PR 4a (Steps on write) → PR 5 (CLI 3-way)

PR 3 sits on the product spine because we ship on fully-qualified URLs (see
**Naming**): the version lives in the path, so nothing can pin one until the
realm server answers `@version` addresses.

Timeline is **sliced** (4a–4d + PR 5), not one epic. Vendoring, minify,
Matrix, and review tools are **off the critical path**.

Sample artifacts you can open beside this doc:

- [`artifacts/backport-remix-decklist.json`](artifacts/backport-remix-decklist.json) — **what to ship**: URL pins, scopes, `extends`
- [`artifacts/backport-remix-decklist-rri.json`](artifacts/backport-remix-decklist-rri.json) — the same decklist after the RRI migration
- [`artifacts/backport-gallery-scene.gts`](artifacts/backport-gallery-scene.gts) — a gallery card on the newer `three`

---

## Naming — build on URLs now, move to RRI when it lands

**Read this before the samples.** Every example below is written in RRI
notation because that is where we are going. It is *not* what the first PRs
should ship, and the difference is deliberate.

### What exists today

Boxel has **RRI** (`RealmResourceIdentifier`): a branded string that is
either a **scoped identifier** (`@cardstack/base/card-api`) or a **full
URL**. `VirtualNetwork` maps the scoped form to a serve URL. Three prefixes
are registered — `@cardstack/base/`, `@cardstack/catalog/`,
`@cardstack/skills/` — and the
[RRI migration](https://linear.app/cardstack/project/cardstackbase-defea0d67319)
that built it is at Phase 3 of 5 (Phase 3 itself 94%).

**There is no version segment in that grammar, and no `@catalog/` or
`@workspace/` prefix.** `resolveRRI`'s spec covers scoped identifiers, URLs,
relative resolution, and `$thisRealm/` — nothing else. Unmapped user realms
deliberately stay in URL form.

### The ruling

**Ship the backport on fully-qualified URLs. Let the RRI migration move us to
aliases afterwards.** The goal now is buildability and runnability, not final
notation.

This costs nothing in capability, because the version does not need an
identifier grammar to live in — it lives in the **path**:

```text
https://app.boxel.ai/catalog/lib/three@0.169.0/build/three.module.js
```

That is Deck's own serve grammar, specified in `deck-at-rest.md` and covered
by `deck conform`. So the dependency moves off the `@cardstack/base` migration
and onto **PR 3**, the package-serve handler — a new read-only route rather
than a change to a 94%-complete persistence migration. Verified end to end in
the Deck repo: scopes, sibling-realm isolation, `extends` flattening and
specifier resolution all work with fully-qualified URLs on both sides.

`extends` accepts all three forms **today** (Deck W1, amended 2026-08-09), so
the later swap needs no Deck change:

```text
acme/blog@1.2.3                              depot-local
https://app.example/catalog/acme/blog@1.2.3/ fully qualified   ← ship this
@catalog/acme/blog@1.2.3/                    scoped alias      ← later, free
```

### Reading the samples

| Sample notation | Ship as | Becomes |
| --- | --- | --- |
| `@catalog/lib/three@0.169.0/build/three.module.js` | `https://app.boxel.ai/catalog/lib/three@0.169.0/build/three.module.js` | itself, once the prefix exists |
| `@workspace/acme/gallery/scene` | `https://app.boxel.ai/workspace/acme/gallery/scene` | itself |
| `@cardstack/base/card-api` | **unchanged — this one is real today** | unchanged |
| `https://app.boxel.ai/…` | unchanged | may alias later |

`@cardstack/base/card-api` is the exception: that prefix is registered,
`identify()` already emits it, and the base realm's startup identity already
flipped to it (CS-12048). Authors keep writing it.

The swap, when it comes, rewrites **decklist values** — one `importmap.json`
per deck, not card JSON scattered across the index — and Deck's classifier
(`leave` / `rebind` / `rewrite`, PR 2) is exactly the tool for it.

Old published content that still says `https://cardstack.com/base/…` keeps a
**permanent** VN read-mapping — published Versions never change, so that
compat layer is not a temporary flag. New authoring prefers `@cardstack/base/…`.

---

## Shape of every PR and commit

Each **PR** opens with a short narrative (**Why**), what benefit it buys
(**Unlocks**), and — when it matters — what shows up for humans (**Authors
see**), with real syntax. Then the commits.

Each **commit** keeps a full **Story** (what you’re doing and why it matters),
a **Touch** list with dry-run diffs (blast radius), then **Do** / **Don’t** /
**Done when** so an agent can execute without inventing scope.

---

## The stack at a glance

```text
−1  Deck work-plan gates (extends, classify, packs, lean Core, conform)
 0  Lean Core into packages/deck
 1  Resolver knows the importer          →  app = decklist; remix without copy (K8)
1b  Thin install / remix / use (fixture) →  early K5          ← product spine
 2  Classify URLs on publish             →  Track C; parallel OK
 3  Serve versioned addresses            →  K3; PREREQUISITE for any version pin
4a  Steps on one write path              →  K1 start          ← hinge slices
4b  Timeline HTTP + restore through write
4c  Host: list / restore Steps
4d  Agent writes → Steps + claims
 5  CLI sync becomes three-way merge     →  K4
 6  Cache headers for Version vs live    →  K2
 7  Minified published Releases          →  K9; demoted (after cache trusted)
 8  Base realm via Deck                  →  K11; after 4c restore
 9  Agent activity in preview            →  K12
10  Realm download as Deck Pack + intake →  K14
11  Catalog mirrors to GitHub            →  K6; share/gather interim
12  Catalog verb polish                  →  rest of K5 (1b already proved model)
13  Matrix submission, retire GH PRs     →  K7; after A+B real
14  Review tools over protocol data      →  K13; trails tape
```

**K10** is the destination of the whole stack, not a separate ticket.

**Cut hard?** Product: **1 → 3 → 1b → 4c**. Infra: **1 → 4a → 5**.

---

## PR 0 — Lean Deck Core

**Why.** Boxel should not reimplement tree identity, three-way merge, or pack
format inside `runtime-common`. Those algorithms already exist — and the
**decisions** around them are closed in
[`deck-work-plan-for-backport.md`](deck-work-plan-for-backport.md). This PR
only makes a **lean** Core importable: browser-safe entry for the host and a
Node entry for the realm server. No Hub, demos, teaching CLI, npm vendor
pipeline, minify derive, or rebase-daemon.

**Unlocks.** Nothing user-facing yet. Everything later depends on this cone.

**Authors see.** Nothing in the product. Engineers see ordinary imports:

```ts
// runtime-common / host — must stay free of node:fs
import { resolveSpecifier } from '@cardstack/deck';

// realm-server only
import { mergeTrees, publishToStore } from '@cardstack/deck/node';
```

**Depends on.** Clean Boxel `main` **and** the Deck work-plan gates:
`extends`, classifier, provenance, bare/hermetic, lean trim, foreign
`deck conform`, scopes proof. If review would reopen those, stop and fix
Deck — do not “design in the monorepo PR.”

### Commit — Add `@cardstack/deck` to the workspace

**Story.** Copy or workspace-link the **lean** Core into `packages/deck`.
Export two surfaces and wire the three consumers. Do not call any Deck API
from Boxel yet — if behavior changes in this PR, something went wrong. Prefer
the trimmed cone (~protocol + serve helpers + history + conform), not the
whole teaching repo.

**Touch.**

```
packages/deck/package.json                              +80 / -0
packages/deck/src/**  (lean Core)                       +~8–10k / -0
pnpm-workspace.yaml                                     +1 / -0
packages/realm-server/package.json                      +2 / -0
packages/runtime-common/package.json                    +2 / -0
packages/host/package.json                              +2 / -0
```

**Do.** Add the workspace package; depend from `runtime-common` and `host` on
the browser entry, from `realm-server` on `/node`. Add one trivial unit import
that proves the host graph does not pull `node:fs`.

**Don’t.** Bring Hub, examples, teaching CLI, `vendor-npm`, minify/`derive`,
or rebase-daemon. “Helpfully” start rewriting the resolver in the same PR.

**Done when.** `pnpm` install and build succeed; no realm behavior change.

---

## PR 1 — Resolver that knows who is importing

**Why.** This PR is where Boxel has to internalize a Deck thesis that is
easy to miss: **an app is a decklist** — an import map of pins (RRI /
Version), not a private copy of every dependency. Today
`VirtualNetwork.resolveImport` walks import-map prefixes and ignores *who
asked*. A realm cannot honestly hold two majors of the same library at
once, so remix copies whole trees — the only way to get a private `three`.
Deck’s answer is importer-aware resolution plus import-map **scopes**,
keyed by the importer’s RRI prefix. Remix becomes “write a decklist”
(`extends` + overrides), not “duplicate 180 files.” Install / upgrade /
use (PR 12 / K5) are the same object with different verbs. If we ship
scopes plumbing but keep teaching “remix = copy package,” we have not
shipped the model.

**Unlocks.** **K8** coexistence (author gate). Door to **PR 1b** (early K5),
K3 / K11, and the “app = decklist” product story.

**Authors see.** A decklist, and card code that still looks like normal GTS.
**Ship the first form** — see **Naming**; the second is the same decklist
after the RRI migration, and nothing in Deck has to change between them.

```json
{
  "imports": {
    "three": "https://app.boxel.ai/catalog/lib/three@0.169.0/build/three.module.js",
    "@cardstack/base/": "https://app.boxel.ai/base@1.12.0/"
  },
  "scopes": {
    "https://app.boxel.ai/workspace/acme/gallery/legacy-viewer/": {
      "three": "https://app.boxel.ai/catalog/lib/three@0.160.0/build/three.module.js"
    }
  },
  "deck": {
    "extends": "https://app.boxel.ai/catalog/chris/gallery-board@2.1.0/"
  }
}
```

```json
{
  "imports": {
    "three": "@catalog/lib/three@0.169.0/build/three.module.js",
    "@cardstack/base/": "@cardstack/base@1.12.0/"
  },
  "scopes": {
    "@workspace/acme/gallery/legacy-viewer/": {
      "three": "@catalog/lib/three@0.160.0/build/three.module.js"
    }
  },
  "deck": {
    "extends": "@catalog/chris/gallery-board@2.1.0/"
  }
}
```

Two details worth knowing before you write the resolver against these:

- **`extends` lives under `deck`, not at the root.** A root-level `extends`
  is not read — `parseExtends` returns "inherits nothing" and the app comes
  up missing most of its dependencies, surfacing later as unrelated import
  errors. Both samples above were wrong about this until 2026-08-09; check
  yours against `docs/artifacts/`.
- **A scope key is a prefix only when it ends in `/`.** Otherwise it must
  match the importer exactly. Skip that rule and a scope written
  `…/gallery` silently governs `…/gallery-legacy/…`, which resolves a
  neighbouring deck to the wrong version with no error. Deck's resolver
  enforces it; a Boxel adapter that re-implements matching must too.
- **`@cardstack/base/` is real today** and stays as written in both forms.
  Only the *value* it maps to gains a version.

```gts
// This module’s RRI: @workspace/acme/gallery/scene  →  three@0.169
import * as THREE from 'three';
import { CardDef, field, contains } from '@cardstack/base/card-api';

export class GalleryScene extends CardDef {
  static displayName = 'Gallery Scene';
  // …
}
```

```gts
// @workspace/acme/gallery/legacy-viewer/scene  →  three@0.160 via scopes
import * as THREE from 'three';
```

Full samples: the two artifacts linked at the top.

**Depends on.** PR 0 (you can stub, but calling Deck’s `resolveSpecifier` is
the point).

### Commit — Thread the importer into resolution

**Story.** Change resolution from “global prefix table” to “this specifier,
from that module.” The second argument is the importer’s RRI (or URL that VN
can unresolve to one). Scope keys are importer RRI prefixes. Prefer making
Boxel’s virtual network a thin adapter over `@cardstack/deck`’s
`resolveSpecifier` rather than forking the algorithm again. Cache keys in
the loader must include the importer — otherwise the wrong major wins forever
and the bug looks like “scopes don’t work.”

**Touch.**

```
packages/runtime-common/virtual-network.ts            +120 / -40
packages/runtime-common/loader.ts                     +60 / -25
packages/runtime-common/index.ts                      +5 / -0
packages/realm-server/tests/virtual-network-test.ts   +80 / -10
packages/runtime-common/tests/… (new or extend)       +150 / -0
```

**Do.** Add `relativeTo` (match Deck’s options shape). Pass it from
`Loader.import`. Keep every existing single-version test green — no
behavior change until a scopes fixture appears.

**Don’t.** Open `realm.ts`. Break today’s one-`three` realms.

**Done when.** Unit tests cover old prefix behavior *and* two scopes for
one bare name resolving differently by importer RRI.

### Commit — Acceptance: two live majors of one library

**Story.** This is the K8 gate, not a nice-to-have. Build a fixture realm
where one module’s RRI sits under `@workspace/…/gallery/` (newer `three`)
and another under `…/legacy-viewer/` (older `three`). Both load. No esm.sh
query-string version hack, no `@ts-expect-error`. If this fails, the
resolver work is not done — stop and fix it.

**Touch.**

```
packages/host/tests/… or realm-server/tests/…         +120 / -0
```

**Do.** Assert both graphs; make the failure message name which importer
got which Version RRI.

**Don’t.** Ship host catalog verbs here — that is **PR 1b**.

**Done when.** That fixture is green in CI. This is the program **author
gate** for K8 (coexistence). Product remix UI is the next PR.

---

## PR 1b — Thin decklist verbs (early product win)

**Why.** If “app = decklist” is the thesis, authors must see it **before**
Timeline, Matrix, or catalog-authority theater. Install / remix / use
(upgrade may be stubby) mutate the app’s import map — `extends` + pins —
and must not full-copy trees. A fixture LibSpec is enough; pretty catalog
pages wait for PR 12 polish.

**Unlocks.** Early **K5** + author-visible **K8**. Product spine checkpoint.

**Authors see.**

```text
Fixture LibSpec → @catalog/lib/three@0.169.0
────────────────────────────────────────────
  [ Use ]      create instance, pin exact
  [ Install ]  add pin to my decklist
  [ Remix ]    extends + override (no full copy)
```

```text
Catalog → @catalog/chris/gallery-board@2.1.0 → [Remix]

  before:  copy ~180 files into the workspace
  after:   write a decklist; listing shows only what you changed
```

**Depends on.** PR 1 and **PR 3** (a pin needs a servable versioned address).
Does **not** depend on Timeline (PR 4*) or Matrix.

### Commit — Map helpers

**Story.** Four operations on maps — use / install / remix / upgrade —
calling Deck `extends` + resolve. No new resolver. Upgrade may return
“not implemented” if that keeps the PR small; install + remix + use must
be real.

**Touch.**

```
packages/runtime-common/decklist-adopt.ts (new)       +150 / -0
packages/runtime-common/tests/…                       +80 / -0
```

**Done when.** Install pins a versioned RRI; remix writes `extends` without
duplicating unchanged files.

### Commit — Host actions + fixture Spec

**Story.** Find today’s remix / “make a copy” path in host. Change it so
Remix writes a decklist (`extends` + overrides/scopes), not a full tree
copy. Wire Install / Use with honest names. Seed one fixture LibSpec so
authors can click through without a full catalog redesign. First edit to
an overridden module may copy-on-write that single file (L12: no
write-through into the parent catalog realm).

**Touch.**

```
packages/host/app/…catalog-adopt… / remix             +200 / -50
packages/host/app/services/realm.ts                   +20 / -5
# fixture realm content                               +80 / -0
```

**Do.** Align product copy with “map, not copy.” Kill full-copy fallback.

**Don’t.** Wait for GitHub mirror, Matrix, or Timeline. Build the full
review product. Quietly keep full-copy “just in case.”

**Done when.** Author can install and remix from the fixture without a
tree duplicate; adoptsFrom / decklist show versioned RRIs.

---

## PR 2 — Honest URLs on publish

**Track C — parallel OK; not on the product spine.**

**Why.** Publish today can treat every absolute URL as something to rewrite.
Image CDNs get mangled into broken pins; real module deps get missed.
What counts as a declared dependency is a **decklist question** — protocol —
so classification lives in Deck (`classify`), not as a one-off in the publish
handler. This PR teaches publish to ask the classifier: leave, rebind, or
rewrite.

**Unlocks.** Safer publish immediately; the same brain is required for pack
intake later (**K14**).

**Authors see.** Card instances keep their asset URLs. Module identity moves
toward RRI pins without authors hand-editing every thumbnail:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "title": "Letter C",
      "thumbnailURL": "https://boxel-images.boxel.ai/icons/Letter-c.png"
    },
    "meta": {
      "adoptsFrom": {
        "module": "../blog-post",
        "name": "BlogPost"
      }
    }
  }
}
```

After publish: `thumbnailURL` still points at the image CDN (**leave**).
`@cardstack/base/…` graphs **rebind** to the pinned base Version. Declared
catalog deps **rewrite** to versioned package RRIs like
`@catalog/chris/money@2.1.0/…`.

**Depends on.** PR 0.

### Commit — Classify leave / rebind / rewrite

**Story.** Open `handle-publish-realm.ts` and extract URL handling into a
helper that calls `@cardstack/deck/classify` with the realm’s decklist.
Keep the publish entrypoint and published-realm override behavior unless
tests prove they must change. The regression that matters is the asset URL:
if Letter-c.png becomes a module pin, you have made publish worse.

**Touch.**

```
packages/realm-server/handlers/handle-publish-realm.ts   +90 / -120
packages/realm-server/lib/publish-url-rewrite.ts (new)   +120 / -0
packages/realm-server/tests/publish-unpublish-realm-test.ts +80 / -20
```

**Do.** Three fixtures: relative import left alone; base rebound; image CDN
untouched.

**Don’t.** Copy classifier rules into `runtime-common`.

**Done when.** Tests cover leave / rebind / rewrite; assets never become pins.

### Commit — Cheaper index copy on publish (optional)

**Story.** Replace expensive prerender fan-out with an additive SQL path over
existing index rows, still rewritten through the classifier. Migrations stay
additive. If this fights you, ship the classifier alone — do not hold honest
URLs hostage to a clever `INSERT…SELECT`.

**Touch.**

```
packages/realm-server/handlers/handle-publish-realm.ts   +60 / -100
packages/postgres/migrations/….ts (additive only)        +40 / -0
```

**Do.** Explain the before/after query shape in the PR body.

**Don’t.** Destructive Postgres removals in this PR.

**Done when.** Large-realm publish remains correct and still leaves assets alone.

---

## PR 3 — Serve versioned addresses

**On the product spine.** Was "optional early"; the URL-first ruling (see
**Naming**) moved it. The version lives in the path, so until the realm
server answers `…/three@0.169.0/…` there is nothing for a decklist to pin
and PR 1b has no fixture to install from. Still small — a read-only handler
— but it is now a prerequisite, not a nice-to-have.


**Why.** Third-party libraries should be first-class, policy-gated addresses
in our world — not forever-links to esm.sh. The crawl and corpus migration
can live on a hosted Deck outside the monorepo. Boxel still needs a **serve
door** and a thin registry gate so republishing the same name at a different
treeHash is a conscious act.

**Unlocks.** **K3** on the serve side, and the address space everything else
pins into: those packages become cacheable pins authors can put in a decklist
as fully-qualified URLs today, aliases later.

**Authors see.** A Spec in the catalog and a fetchable Version:

```text
RRI:   @catalog/lib/three@0.169.0/build/three.module.js
Serve: https://app.boxel.ai/catalog/lib/three@0.169.0/build/three.module.js
       Cache-Control: public, max-age=31536000, immutable   (once PR 6 lands)
```

```json
{
  "data": {
    "attributes": {
      "title": "three.js",
      "description": "JavaScript 3D library",
      "moduleHref": "@catalog/lib/three@0.169.0/build/three.module.js"
    },
    "meta": {
      "adoptsFrom": {
        "module": "@cardstack/base/spec",
        "name": "Spec"
      }
    }
  }
}
```

```gts
import { WebGLRenderer } from 'three';
// bare name → decklist → versioned RRI → serve URL
```

**Depends on.** PR 0; PR 1 makes consuming two versions pleasant. **PR 1b
depends on this** — it is what a pin points at.

### Commit — Package serve handler + registry gate

**Story.** Add a read-only handler that serves already-vendored trees using
Deck URL grammar. `package-registry.ts` is the publish-gate stub (cooldown,
refuse silent treeHash swaps). Register the route next to other `_` admin
routes. Sane cache defaults until PR 6 teaches L12 properly.

**Touch.**

```
packages/realm-server/handlers/handle-package-serve.ts (new)  +180 / -0
packages/realm-server/lib/package-registry.ts (new)           +120 / -0
packages/realm-server/routes.ts                               +15 / -0
packages/realm-server/tests/…-package-serve-test.ts (new)     +100 / -0
```

**Do.** Coded JSON errors for unknown packages. Unit-test the gate.

**Don’t.** Implement npm crawl or corpus migration in the monorepo PR.
Touch `realm.ts`.

**Done when.** A fixture vendored package is GET-able via its serve URL;
the registry gate has a failing test if you skip the policy check.

### Commit — LibSpec content (catalog)

**Story.** In the catalog realm, create `Spec` instances whose `moduleHref`
is the versioned package RRI. No new card type — `spec.gts` already carries
`ref` / `moduleHref`. Make them searchable like any Spec.

**Touch.** Catalog content (separate content PR is fine) · roughly `+200 / -0`.

**Do.** Point `moduleHref` at `@catalog/lib/…@version/…`, not a bare CDN.

**Don’t.** Invent a LibSpec card class.

**Done when.** Catalog search finds the Spec; opening it shows the RRI pin.

---

## PR 4a — Steps on one write path ← hinge start

**Track B.** First Timeline slice. Wire Core; do **not** reimplement
merge/store in realm-server.

**Why.** Editable realms need a tape. This slice only: after a successful
write batch, record a **Step** (debounced). No host UI, no claims UX, no
CLI. Versions-only remains OK for some read-only catalog mounts — not for
working realms once this lands.

**Unlocks.** Start of **K1**. Data plane for later slices.

**Authors see.** Nothing in host yet — engineers see Steps in store/tests.

**Depends on.** PR 0. Pairing with PR 1 / 1b is nice; not required.

### Commit — History façade + surgical write hooks

**Story.** Create `realm-history.ts` as the façade: `recordStep`,
`listSteps`, `restoreStep`, `publishVersion`, via `@cardstack/deck/node`.
In `realm.ts`, after successful `_batchWriteUnlocked` and delete paths,
call `recordStep` with actor metadata when present. Debounce (~500ms
quiet). Reuse notify / broadcast — no parallel bus. Stay inside
`withWriteLock`. Surgical hooks only in the large `realm.ts`.

**Touch.**

```
packages/runtime-common/realm.ts                      +180 / -40
packages/runtime-common/realm-history.ts (new)        +250 / -0
packages/runtime-common/index.ts                      +10 / -0
```

**Do.** Same hook for UI instance writes and agent definition writes.
Document the debounce constant.

**Don’t.** Reformat `realm.ts`. Treat a claim refresh as a Step. Ship host
restore UI (that is **4c**).

**Done when.** Two writes produce Timeline entries; the façade can restore
in unit tests even if HTTP is the next PR.

---

## PR 4b — Timeline HTTP + restore through write

**Why.** Realm-server needs list Steps / Versions, file-at-Step, and
restore **through** normal `Realm.write` so indexing follows. Attach jj or
historyd per **editable** realm; Versions-only mounts OK for RO catalog.

**Unlocks.** Remote restore API for host and CLI.

**Depends on.** PR 4a.

### Commit — Server Timeline + history HTTP

**Story.** Invent `realm-history*` on the server. HTTP list/restore. Optionally
bridge `realm-file-changes-listener` so events can carry step ids.

**Touch.**

```
packages/realm-server/lib/realm-history.ts (new)      +300 / -0
packages/realm-server/handlers/handle-realm-history.ts (new) +220 / -0
packages/realm-server/routes.ts                       +25 / -0
packages/realm-server/lib/realm-file-changes-listener.ts +40 / -15
packages/realm-server/tests/realm-history-*.ts (new)  +250 / -0
```

**Do.** Restore always goes through the write path.

**Don’t.** Point the server at standalone CLI `.boxel-history` git repos.
Build host UI here.

**Done when.** HTTP round-trip: write → list Steps → restore → indexed card
matches the earlier Step.

---

## PR 4c — Host: list and restore Steps

**Why.** Authors need one history list and restore confirmation. Vocabulary
is Step / Version / Timeline — never “jj” or “seal” in chrome. This is the
**product-spine** end of Tape (with 1b on Map).

**Unlocks.** User-visible **K1** restore.

**Depends on.** PR 4b.

### Commit — Host history UI

**Story.** Extend `RealmService` with list/restore. Minimal UI. Show that
agent turns and UI edits will share one tape (claims UI is **4d**).

**Touch.**

```
packages/host/app/services/realm.ts                   +80 / -10
packages/host/app/components/…-history… (new)         +150 / -0
```

**Do.** Link a Step row to the path RRI when you have it.

**Don’t.** Build the full review product (PR 14). Rewrite CLI (PR 5).

**Done when.** A user can restore a Step from host with correct labels.

### Commit — Gate test

**Story.** Integration test: write A, write B, restore to A’s Step; assert
index and rendered card follow. Include one agent-batch-shaped write
(actor header or meta).

**Touch.**

```
packages/realm-server/tests/…                         +120 / -0
```

**Done when.** That test owns the merge button for the 4a–4c stack.

---

## PR 4d — Agent writes → Steps + claims

**Why.** Agent definition/instance writes must hit the same Step path.
Claims (“I am working here”) are intent, not history — separate from Steps.
Cheap activity read path can land here if small; preview chrome may wait
for PR 9.

**Unlocks.** Honest agent audit trail; foundation for **K12**.

**Depends on.** PR 4a (4b helpful).

### Commit — Claims + agent batch Steps

**Story.** Settled agent write batches → Steps with actor metadata. Claim
file layout / refresh must **not** create Steps. Document the distinction
in code comments reviewers will see.

**Touch.**

```
packages/runtime-common/realm.ts                      +40 / -10
packages/realm-server/…claims…                        +80 / -0
packages/realm-server/tests/…                         +80 / -0
```

**Do.** One test: claim refresh does not add a Step; agent write batch does.

**Don’t.** Build the full preview activity UI (PR 9) unless trivial.
Ship CLI sync here (PR 5).

**Done when.** Agent batch → Step; claim ≠ Step; restore still green.

---

## PR 5 — CLI checkpoints and 3-way sync

**The last Timeline slice / Track B.** Infra spine end: **1 → 4a → 5**.

**Why.** Standalone `boxel-cli` still thinks in git checkpoints and
`--prefer-local` / `--prefer-remote` as the main story. Once realms have
Steps and Versions, sync can finally merge with a **real common ancestor**
via Deck’s `mergeTrees`. prefer-* becomes the fallback when the merge
reports conflicts — not the everyday path. This is a parallel-repo PR that
depends on PR **4b** APIs; it is not the monorepo `@cardstack/boxel-cli`
package (different command set).

**Unlocks.** **K4**.

**Authors see.**

```bash
boxel history ./workspace/acme/gallery
boxel history ./workspace/acme/gallery -r 3

boxel milestone ./workspace/acme/gallery -n opening-night
# → Version @workspace/acme/gallery@0.3.0  (catalog RRI after publish)

boxel sync ./workspace/acme/gallery
# mergeTrees(base=@workspace/acme/gallery@0.3.0, local, remote)
# conflict: @workspace/acme/gallery/scene
# conflict: BlogPost/opening-night.json
```

```text
before                                    after
─────────────────────────────────────     ────────────────────────────────
--prefer-local overwrites                 mergeTrees; prefer-* on conflicts only
.git inside .boxel-history                realm Steps / Versions
```

**Depends on.** PR 4b (4c nice for humans testing the same realm).

### Commit — Checkpoints speak Timeline

**Story.** `CheckpointManager` today shells git. Replace the backend with
realm Timeline APIs: create → Step, restore → `restoreStep`, list → Steps.
`markMilestone` becomes “publish / tag a Version,” not a git tag in
`.boxel-history`. Keep the class’s command-facing API stable where you can
so `history` / `track` callers don’t churn for sport.

**Touch.**

```
src/lib/checkpoint-manager.ts                         +200 / -350
src/lib/find-checkpoint.ts                            +40 / -60
```

**Do.** Delete git subprocess usage for checkpoints.

**Don’t.** Leave a second source of truth in local git “for rollback.”

**Done when.** Checkpoint flows work against a deck-enabled realm without
`.boxel-history` git.

### Commit — Sync via mergeTrees

**Story.** Happy path: resolve base = last common Version or Step treeHash,
ours = local tree, theirs = remote, call `mergeTrees` from
`@cardstack/deck`. Surface conflict paths (as workspace paths or RRIs).
prefer-* flags remain only for unresolved conflicts.

**Touch.**

```
src/commands/sync.ts                                  +180 / -220
```

**Do.** Integration-test the happy path before polishing flags.

**Don’t.** Silent overwrite. Call prefer-local the “smart default.”

**Done when.** Shared-ancestor divergence merges cleanly; true conflicts
list paths and write nothing for those files.

### Commit — History and milestone commands

**Story.** Point `history` and `milestone` at realm Timeline/Versions.
Document the old footgun in help text: stop watch before restore.

**Touch.**

```
src/commands/history.ts                               +80 / -120
src/commands/milestone.ts                             +40 / -40
```

**Done when.** Help text and commands say Step/Version; no git log.

### Commit — Sync merge tests

**Story.** Mocked realm: clean merge with shared base; same-file conflict
→ path list, no write.

**Touch.**

```
test/…                                                +200 / -50
```

**Done when.** Both cases green.

---

## PR 6 — Cache what is immutable

**Why.** Exact Versions never change — browsers may cache them for a year.
Live trees must never be cached. Wrong `Cache-Control` quietly makes the
product look haunted (stale cards, “I saved but nothing moved”). This PR is
small in LOC and large in trust.

**Unlocks.** **K2**.

**Authors see.**

```bash
# versioned RRI → serve URL
curl -sI \
  'https://app.boxel.ai/catalog/lib/three@0.169.0/build/three.module.js' \
  | grep -i cache
# Cache-Control: public, max-age=31536000, immutable
# Content-Digest: sha-256=:…:

curl -sI \
  'https://app.boxel.ai/workspace/acme/gallery/scene.gts' \
  | grep -i cache
# Cache-Control: no-store
```

Decklists keep pinning RRIs; HTTP just finally tells the truth about them.

**Depends on.** PR 4a (so exact Version URLs exist).

### Commit — L12 cache classes on the serve path

**Story.** Find every place module/card source is served with
`Cache-Control` (re-grep on tip — old line numbers drift). Apply Deck L12:
exact Version → immutable (+ digests when available); live → no-store;
tag/range → one hop, short TTL. Lock it with tests.

**Touch.**

```
packages/runtime-common/realm.ts                      +40 / -30
packages/realm-server/handlers/… (module serve)       +80 / -40
packages/realm-server/tests/…                         +60 / -0
```

**Do.** Header-matrix tests for the three classes.

**Don’t.** Mark live immutable “for performance.”

**Done when.** Tests fail if someone “optimizes” live into a cacheable class.

### Commit — Show the win (optional)

**Story.** Capture module request counts: load card A, then card B sharing
~90% of a closure. Put the numbers in the PR body — this is the claim people
repeat without evidence.

**Touch.**

```
# harness / notes                                     +80 / -0
```

**Done when.** PR description has a real before/after note.

---

## PR 7 — Minified releases

**Demoted.** Ship only after PR 6 cache classes are trusted. Easy to
gold-plate; not on either spine.


**Why.** Because exact Versions never change, minify and gzip are safe and
worth it. Live must stay readable source for authors and agents.

**Unlocks.** **K9**.

**Authors see.**

```text
RRI      @catalog/lib/three@0.169.0/build/three.module.js
derive   @catalog/lib/three@0.169.0/build/three.module.min.js
live     @workspace/acme/gallery/scene  → always source
```

**Depends on.** PR 6.

### Commit — Derive minified Version on publish

**Story.** On publish of an exact Version, derive a minified artifact
(follow Deck derive patterns when present). Serve negotiation may choose it.
Never minify live.

**Touch.**

```
packages/realm-server/lib/derive-minified.ts (new)    +200 / -0
packages/realm-server/handlers/handle-publish-realm.ts +40 / -5
packages/realm-server/… serve negotiation             +50 / -15
packages/realm-server/tests/…                         +80 / -0
```

**Do.** Prove bytes stable across two GETs.

**Don’t.** Invent brotli at origin — that belongs at the edge.

**Done when.** Published derivative exists; live URLs unchanged.

---

## PR 8 — Base realm via Deck

**Highest blast radius. Only after PR 4c restore works.**


**Why.** `https://cardstack.com/base/` is a special snowflake. Base should
be a pinned Deck Version like everything else — while authors keep writing
`@cardstack/base/card-api` so identify/unresolve don’t explode. The code
change is tiny; the blast radius is **every realm**. Do not ship this before
PR 4 restore exists, or a bad base Version means “roll the deployment.”

**Unlocks.** **K11**.

**Authors see.** Same authoring; pin moves under the hood:

```gts
import { CardDef, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
```

```json
{
  "imports": {
    "@cardstack/base/": "@cardstack/base@1.12.0/"
  }
}
```

```text
identify still emits:   @cardstack/base/card-api
bytes come from:        @cardstack/base@1.12.0/card-api
legacy forever:         https://cardstack.com/base/…  → VN read map
```

**Depends on.** PR 4c (and PR 1 for scoped resolve).

### Commit — Repoint constants and host mapping

**Story.** `constants.ts` hardcodes `baseRealm` today; host
`makeVirtualNetwork` maps it with `addURLMapping` /
`addRealmMapping('@cardstack/base/', …)`. Repoint so the prefix still
works for identify, but resolution targets a Versioned RRI. Prefer config
over a second hardcoded URL.

**Touch.**

```
packages/runtime-common/constants.ts                  +25 / -15
packages/host/app/services/network.ts                 +30 / -20
packages/runtime-common/… consumers                   +40 / -40
```

**Do.** Minimize source churn; keep RRI identity stable.

**Don’t.** Ship before Step/Version restore works.

**Done when.** Host boots; `@cardstack/base/card-api` still identifies.

### Commit — Publish and pin base

**Story.** Publish base as an immutable Version; default maps pin
`@cardstack/base@…/`. Write the restore story in the PR body so on-call
knows what to do when base goes wrong.

**Touch.**

```
# publish pipeline / content                          +100 / -20
packages/realm-server/tests/… base pin                 +80 / -0
```

**Done when.** New workspace gets the pin; test shows recovery via restore.

---

## PR 9 — Agent presence in preview

**Why.** Agents already write realms. People need to see *who is working
where* without digging through the Timeline. Claims and touch heat are that
signal — standing presence, not toast spam. A claim without a Step is “about
to work”; a Step without a claim is “something landed.”

**Unlocks.** **K12**.

**Authors see.**

```text
┌─ Preview ─────────────────────────────────────────┐
│  Gallery Scene                                      │
│  ┌──────────────────────────────────────────────┐ │
│  │                 (canvas)                      │ │
│  └──────────────────────────────────────────────┘ │
│  ● vale  on  @workspace/acme/gallery/scene  18m left│
│    denser lighting on the hero mesh                 │
└─────────────────────────────────────────────────────┘
```

```http
GET /workspace/acme/gallery/_activity
```

```json
{
  "claims": [
    {
      "actor": "vale",
      "at": "@workspace/acme/gallery/scene",
      "text": "denser lighting on the hero mesh",
      "minutesLeft": 18
    }
  ],
  "heat": [{ "path": "@workspace/acme/gallery/scene", "score": 0.82 }]
}
```

**Depends on.** PR 4d helpful for correlating with Steps.

### Commit — `GET /_activity`

**Story.** Implement a read-only activity endpoint using Deck activity
types/layout. Prefer reading claim files / activity store. Ride existing
`subscribe` / `unsubscribe` plumbing — do not invent a second websocket.
L12: no writes on this handler.

**Touch.**

```
packages/realm-server/handlers/handle-activity.ts (new) +120 / -0
packages/realm-server/routes.ts                       +10 / -0
packages/runtime-common/realm.ts                      +30 / -5
```

**Do.** Return claims addressed with workspace RRIs when you can.

**Don’t.** Toast from the server. Treat claim TTL refresh as a Step.

**Done when.** Authenticated GET returns claims + heat; unauthorized denied.

### Commit — Preview chrome

**Story.** Consume activity in the existing preview canvas. Standing row:
actor, RRI path, claim text; optional link into Timeline.

**Touch.**

```
packages/host/app/services/message-service.ts         +40 / -10
packages/host/app/components/…preview…                +80 / -20
```

**Done when.** An in-flight agent claim is visible while the run proceeds.

---

## PR 10 — Packs you can trust

**Why.** Download today is a zip via `archiver`. There is no intake path in
the monorepo. Moving a realm should be a **Deck Pack** with provenance —
`bare` first (references stay RRIs), `hermetic` when we wire vendor carriage
so deps’ bytes ride along. Negotiated prune across trust boundaries waits on
design; do not block bare/hermetic on it.

**Unlocks.** **K14** (bare + hermetic).

**Authors see.**

```bash
curl -OJ 'https://app.boxel.ai/_download-realm?realm=https://app.boxel.ai/workspace/acme/gallery/'
# → pack whose provenance.source is @workspace/acme/gallery/
```

```json
{
  "provenance": {
    "source": "@workspace/acme/gallery/",
    "treeHash": "a3f1…c90",
    "mode": "bare",
    "decklist": {
      "imports": {
        "three": "@catalog/lib/three@0.169.0/build/three.module.js"
      }
    }
  }
}
```

Hermetic: same idea, dependency bytes inside — opens on an air-gapped laptop.

**Depends on.** PR 2 (classifier); PR 4a (writes/Steps on intake).

### Commit — Download writes a bare Deck Pack

**Story.** Keep auth, filename, and streaming shape of
`handle-download-realm`. Replace `archiver` with Deck’s pack writer in bare
mode so provenance and the decklist (RRI pins) travel. Drop `archiver` from
package.json. Note client breakage (zip → pack) in the PR body.

**Touch.**

```
packages/realm-server/handlers/handle-download-realm.ts  +80 / -100
packages/realm-server/package.json                      +1 / -1
packages/realm-server/tests/server-endpoints/download-realm-test.ts +40 / -30
```

**Do.** Verify the artifact as a Deck Pack in tests.

**Don’t.** Block on hermetic or negotiation.

**Done when.** Downloaded artifact verifies; provenance carries source RRI.

### Commit — Pack intake

**Story.** This is most of K14. Read pack → verify digests → classify
absolute URLs → re-home RRIs via VN → `mergeTrees` → write through
`Realm.write` so Steps and index follow. Conflicts → path/RRI list, no
partial silent apply.

**Touch.**

```
packages/realm-server/handlers/handle-pack-intake.ts (new) +400 / -0
packages/realm-server/routes.ts                         +15 / -0
packages/runtime-common/realm.ts                        +40 / -5
packages/realm-server/tests/pack-intake-test.ts (new)  +200 / -0
```

**Do.** Tests for clean intake, conflict, and asset URL left alone.

**Don’t.** Bypass indexing.

**Done when.** Download → intake round-trip on a fixture; conflicts explicit.

### Commit — Hermetic carriage

**Story.** `planPack({ mode: 'hermetic' })` plus existing Deck vendor
helpers put dependency bytes in the pack. You are wiring carriage — not
redesigning prune negotiation.

**Touch.**

```
packages/realm-server/lib/pack-hermetic.ts (new)      +150 / -0
```

**Done when.** Hermetic pack opens without network for declared deps.

---

## PR 11 — Catalog is authority; GitHub is a mirror

**Why.** GitHub pull requests must not be how the catalog becomes true.
Export Versions on a schedule as a monorepo projection with provenance
trailers. Keep GitHub as a mirror (and optional intake with `Base-Version` +
`mergeTrees`). Human share/gather can stay as an interim for teams that
already live on GitHub — but rewritten so it stops being a USB stick.

**Unlocks.** **K6**.

**Authors see.**

```text
Catalog (authority)                         GitHub (mirror)
─────────────────────────────────────       ────────────────────────────
publish @catalog/chris/gallery-board@2.1.0  tag chris/gallery-board@2.1.0
                                            main advances; .deck-mirror.json
PR without Base-Version                     bot/CI closes on RO catalog
```

```bash
boxel share ./workspace/acme/gallery \
  --repo cardstack/gallery-mirror \
  --branch share/vale/denser-lighting
# Base-Version: @workspace/acme/gallery@0.3.0
# treeHash: a3f1…c90
# Deck-Tip: live
# Actor: vale

boxel gather ./workspace/acme/gallery \
  --repo cardstack/gallery-mirror \
  --branch share/vale/denser-lighting \
  --into live
```

**Depends on.** PR 4a.

### Commit — Mirror export job

**Story.** Implement export per `deck-github-mirror-analysis.md`: one GitHub
monorepo per catalog/depot, curated `main`, annotated Version tags,
`.deck-mirror.json`, trailers (`treeHash`, `Deck-Version`, `Base-Version`).
Schedule on milestone or a few times a day — **never per write**. Project
RRI package paths into the git tree consistently.

**Touch.**

```
packages/realm-server/lib/deck-github-mirror.ts (new) +350 / -0
packages/realm-server/worker-manager.ts or jobs       +40 / -5
packages/realm-server/tests/…                         +120 / -0
```

**Do.** Deterministic trees; no-op when nothing changed.

**Don’t.** Push on every card save.

**Done when.** Fixture export produces tag + manifest; second run is a no-op.

### Commit — Narrow submission-shaped GitHub PR API

**Story.** Today’s `POST /_github-pr` is submission-shaped. Shrink it toward
mirror helpers; RO mirrors reject authority PRs. Full deletion can finish in
PR 13 once Matrix submission exists.

**Touch.**

```
packages/realm-server/lib/github.ts                   +40 / -60
packages/realm-server/handlers/handle-github-pr.ts    +30 / -80
packages/realm-server/routes.ts                       +10 / -15
```

**Done when.** Opening a random PR on a RO mirror does not publish the catalog.

### Commit — Optional CLI share / gather rewrite

**Story.** Replace copy-wipe share/gather with Deck-shaped verbs: share
stamps RRI `Base-Version` + trailers; gather runs `mergeTrees` into live or
publish. Force-with-lease on share branches only.

**Touch.**

```
src/commands/share.ts                                 +100 / -150
src/commands/gather.ts                                +120 / -80
```

**Don’t.** Restore dest wipe. Force-push `main` or Version tags.

**Done when.** Share PR body contains Base-Version RRI; gather conflicts list
paths.

---

## PR 12 — Catalog verb polish

**Not the first product win — that was PR 1b.** This PR finishes **K5** in
the real catalog: upgrade UX, package-page affordances, copy polish. If 1b
already taught “map not copy,” this is content + chrome, not a second
resolver project.

**Why.** Fixture LibSpec proved the model; authors still need honest verbs
on every Spec page and a real Upgrade path.

**Unlocks.** Rest of **K5**.

**Authors see.** Same four buttons as 1b, everywhere in catalog, with
Upgrade that re-resolves.

**Depends on.** PR 1b.

### Commit — Upgrade + catalog affordances

**Story.** Complete upgrade re-resolve; wire Spec pages in catalog content.
Keep huge content dumps out of the monorepo PR if you can. Do not
reintroduce full-copy remix.

**Touch.**

```
packages/runtime-common/decklist-adopt.ts             +40 / -10
packages/host/app/…catalog-adopt…                     +120 / -30
# catalog content                                     +400 / -100
```

**Done when.** A real package page offers Use / Install / Remix / Upgrade;
upgrade re-resolves; remix still does not full-copy.

---

## PR 13 — Inter-realm submission over Matrix

**Demoted off the critical path.** Until Tracks A+B are real, GitHub
share/gather + Base-Version (PR 11) is the interim truck. Staff Matrix
retirement of GH-PR-as-product only after 1b + 4c.

**Why.** Review across realms should be Matrix identity + room + message of
intent (and a Deck Pack when the tip isn’t public), with realm ACL on who
may offer and who may accept — not “open a GitHub PR” as the product.
Offers remain runnable Versions (RRI tips you can preview before merging).
Synthesis vs locus-shift merge philosophy stays human/AI policy
(`deck-in-motion.md`); the protocol only requires runnable Versions and an
auditable pointer move.

**Unlocks.** **K7**.

**Authors see.**

```text
Matrix room  #catalog-submissions
─────────────────────────────────
vale  proposed  @workspace/vale/gallery@0.4.0-dev.3/
      base: @catalog/chris/gallery-board@2.1.0/
      treeHash: b77c…019
      why: denser hero lighting — run the offer before merging

      serve: https://app.boxel.ai/workspace/vale/gallery/@0.4.0-dev.3/
      pack:  (attached) vale-gallery-offer.deckpack
```

```gts
@field proposal = contains(OfferRefField);    // RRI of the offer Version
@field baseVersion = contains(StringField); // @catalog/chris/gallery-board@2.1.0/
@field roomId = contains(StringField);
```

**Depends on.** PR 4c; PR 11 for mirror-only GitHub; **after** 1b.

### Commit — ACL for offer and accept

**Story.** Gate who may issue an offer and who may rebase/accept a pointer
move using realm permissions. Cross-realm carriage: public readable realm,
Matrix intent, or pack attachment — see
`deck-depot-and-realm-backport.md` §3.3.

**Touch.**

```
packages/realm-server/lib/offer-acl.ts (new)          +120 / -0
packages/realm-server/handlers/…                      +80 / -20
```

**Done when.** Unauthorized offer → 403; authorized path works.

### Commit — Submission workflow without `prCard`

**Story.** Replace GitHub PR fields with a proposal over Versions/offers.
Matrix carries intent; optional pack when the tip isn’t world-readable.

**Touch.**

```
# catalog submission-workflow-card.gts                +200 / -120
# host Matrix intent wiring                           +150 / -40
```

**Done when.** A submission exists with offer RRI and no GitHub PR id.

### Commit — Delete `/_github-pr` submission

**Story.** Remove the handler and route; keep mirror-only helpers in
`github.ts` from PR 11. Update tests and env flags.

**Touch.**

```
packages/realm-server/handlers/handle-github-pr.ts    +0 / -191
packages/realm-server/routes.ts                       +5 / -20
packages/realm-server/lib/github.ts                   +10 / -40
```

**Done when.** Route 404s; mirror export still green; no submission-via-GH-PR
references in server.

---

## PR 14 — Review tools on protocol data

**Trails the tape.** Content/UI after Steps exist — do not staff early.

**Why.** Once Steps, Versions, claims, and offers are real, review UI is
mostly catalog/host content — not a new forge in realm-server. Build cards
that compare an offer RRI to its upstream RRI, surface claims, and deep-link
into preview. Add server GETs only if something essential isn’t already
exposed from PR 4 / PR 9.

**Unlocks.** **K13**.

**Authors see.**

```text
Review  ·  @workspace/vale/gallery@0.4.0-dev.3/
        vs @catalog/chris/gallery-board@2.1.0/
────────────────────────────────────────────────
  scene.gts                      |  ++ lighting rig
  BlogPost/opening-night.json    |  ~ title
  claims   vale on scene (released)
  [ open preview ]   [ Accept → publish Version ]
```

```bash
curl -s 'https://app.boxel.ai/workspace/vale/gallery/@0.4.0-dev.3?meta' \
  | jq -r '.data.attributes.treeHash'
```

**Depends on.** PR 4c; PR 4d / PR 9 for claims.

### Commit — Review / patch cards

**Story.** Content-first. Iterate in catalog PRs. Do not block the hinge
(PR 4) on polish.

**Touch.**

```
# catalog / host review cards                         +1500 / -200
packages/realm-server (only if a GET is missing)      +50 / -0
```

**Do.** Diff offer RRI vs upstream RRI; link preview of the runnable tip.

**Don’t.** Rebuild GitHub inside Boxel.

**Done when.** A reviewer can compare two tips without leaving Boxel.

---

## Using this as an agent prompt

1. Respect **campaign order** (see top): do not start Timeline before PR 1b
   unless you are on the infra spine on purpose.  
2. Pick **one commit** — not a whole multi-commit PR unless it is tiny.
   Timeline: one of **4a / 4b / 4c / 4d**, not “all of PR 4.”  
3. Paste the commit’s **Story**, **Touch**, **Do**, **Don’t**, and **Done when**.  
4. Include the parent PR’s **Authors see** (and the RRI primer if names are
   involved) so the agent optimizes for the user-visible outcome.  
5. Point at `docs/artifacts/` when implementing PR 1 / 1b.  
6. If the task needs a protocol design debate, stop and open the Deck
   [`deck-work-plan-for-backport.md`](deck-work-plan-for-backport.md) — do
   not invent answers in the Boxel PR.  
7. Prove **Done when** (and program gates: wiring-only, import not fork,
   author remix-without-copy) before the next commit.

---

## Appendix — rough change volume

| PR | Scale | Where the mass is |
| --- | --- | --- |
| 0 | S | Lean dependency wiring |
| 1 | M | Virtual network + loader + coexistence fixture |
| **1b** | **M** | **Thin verbs + host remix-as-map** (product spine) |
| 2 | M | Publish handler (parallel) |
| **3** | **S–M** | **Serve handlers; corpus outside** (spine — the address space) |
| **4a–4d** | **L sliced** | **Write path → HTTP → host → claims** |
| 5 | L | CLI rewrite (standalone repo) |
| 6 | S | Headers + tests |
| 7 | S–M | Derive pipeline (demoted) |
| 8 | S code / **XL blast** | Base pin — after 4c |
| 9 | S | Activity + preview |
| 10 | L | Intake dominates download |
| 11 | M | Mirror job + GH share/gather interim |
| 12 | S–M | Catalog verb polish (after 1b) |
| 13 | M | Matrix; after A+B (demoted) |
| 14 | L content | Review product — trails tape |
