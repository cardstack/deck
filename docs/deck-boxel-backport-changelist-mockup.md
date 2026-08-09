# Bringing Deck into Boxel — proposed PR series

This is a story of the work, told as stacked pull requests. It was written
after walking today’s Boxel tree (`runtime-common`, `realm-server`, `host`)
and standalone `boxel-cli`. Read it to feel **blast radius**, to brief an
implementation agent, or to show a teammate what card authors and realm users
will actually get when each slice lands.

It is a design of the work — not a measured diff. The `+ / −` counts under
each commit are order-of-magnitude guesses after reading the real files;
they tell you *where the mass is*, not what to put in a spreadsheet.

Companion for product context: [`deck-boxel-backport-for-team.md`](deck-boxel-backport-for-team.md).

Sample artifacts you can open beside this doc:

- [`artifacts/backport-remix-decklist.json`](artifacts/backport-remix-decklist.json) — RRI pins, scopes, `extends`
- [`artifacts/backport-gallery-scene.gts`](artifacts/backport-gallery-scene.gts) — a gallery card on the newer `three`

---

## RRI — how we name things in the examples

Boxel already has **RRI** (`RealmResourceIdentifier`): a hosting-independent
name that `VirtualNetwork` maps to a serve URL. The backport should **author
and pin in RRI**, not paste `https://app.boxel.ai/…` into every decklist and
card. Serve URLs still exist — they are what HTTP fetches after the mapping.

| Form | Example | Role |
| --- | --- | --- |
| **Versioned package RRI** | `@catalog/lib/three@0.169.0/build/three.module.js` | `@place/publisher/name@version/path` — the cross-realm pin |
| **Platform RRI** | `@cardstack/base/card-api` | What `Loader.identify` emits today; the map pins `@cardstack/base@1.12.0/` |
| **Workspace RRI** | `@workspace/acme/gallery/scene` | Importer identity for scopes (`place` = `workspace`) |
| **Serve URL** | `https://app.boxel.ai/catalog/lib/three@0.169.0/…` | Bytes on the wire |
| **Bare** | `three` | Local alias only — the decklist says what it means |

```text
author writes                    decklist pin (RRI)                         VN → serve URL
─────────────────────────────    ───────────────────────────────────────    ────────────────────────────
import from 'three'              @catalog/lib/three@0.169.0/…               https://app…/three@0.169.0/…
from '@cardstack/base/card-api'  prefix @cardstack/base@1.12.0/             https://app…/base/@1.12.0/…
```

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
 0  Drop Deck Core into packages/deck
 1  Resolver knows the importer          →  remix without copying (K8)
 2  Classify URLs on publish             →  safe publish / pack prep
 3  Serve vendored packages              →  own unpkg (K3)
 4  Timeline on every realm write        →  Steps for UI + agents (K1)   ← hinge
 5  CLI sync becomes three-way merge     →  (K4)
 6  Cache headers for Version vs live    →  (K2)
 7  Minified published Releases          →  (K9)
 8  Base realm via Deck                  →  (K11)
 9  Agent activity in preview            →  (K12)
10  Realm download as Deck Pack + intake →  (K14)
11  Catalog mirrors to GitHub            →  (K6)
12  Install / upgrade / remix / use      →  (K5)
13  Matrix submission, retire GH PRs     →  (K7)
14  Review tools over protocol data      →  (K13)
```

**K10** (replace github + npm + esm.sh) is the destination of the whole stack,
not a separate ticket. If you only ship three PRs: **1 → 4 → 5**.

---

## PR 0 — Drop Deck Core

**Why.** Boxel should not reimplement tree identity, three-way merge, or pack
format inside `runtime-common`. Those algorithms already exist. This PR only
makes them importable: a tight Core package with a browser-safe entry for the
host and a Node entry for the realm server. No Hub, no demos, no Deck CLI —
those stay out of the monorepo on purpose.

**Unlocks.** Nothing user-facing yet. Everything later depends on this cone.

**Authors see.** Nothing in the product. Engineers see ordinary imports:

```ts
// runtime-common / host — must stay free of node:fs
import { resolveSpecifier } from '@cardstack/deck';

// realm-server only
import { mergeTrees, publishToStore } from '@cardstack/deck/node';
```

**Depends on.** A clean Boxel `main`.

### Commit — Add `@cardstack/deck` to the workspace

**Story.** Copy or workspace-link Deck Core into `packages/deck`. Export two
surfaces and wire the three consumers. Do not call any Deck API from Boxel
yet — if behavior changes in this PR, something went wrong. The whole point
is a boring dependency drop that later PRs can lean on.

**Touch.**

```
packages/deck/package.json                              +80 / -0
packages/deck/src/**  (vendored Core)                   +~12000 / -0
pnpm-workspace.yaml                                     +1 / -0
packages/realm-server/package.json                      +2 / -0
packages/runtime-common/package.json                    +2 / -0
packages/host/package.json                              +2 / -0
```

**Do.** Add the workspace package; depend from `runtime-common` and `host` on
the browser entry, from `realm-server` on `/node`. Add one trivial unit import
that proves the host graph does not pull `node:fs`.

**Don’t.** Bring Hub, examples, or Deck’s teaching CLI. “Helpfully” start
rewriting the resolver in the same PR.

**Done when.** `pnpm` install and build succeed; no realm behavior change.

---

## PR 1 — Resolver that knows who is importing

**Why.** Today `VirtualNetwork.resolveImport` walks import-map prefixes and
ignores *who asked*. That means a realm cannot honestly hold two majors of
the same library at once. Remix therefore copies whole trees — the only way
to get a private `three`. Deck’s answer is importer-aware resolution plus
import-map **scopes**, keyed by the importer’s RRI prefix. Remix becomes
“write a decklist,” not “duplicate 180 files.”

**Unlocks.** **K8** — remix without copying. Also the door to K5 / K3 / K11.

**Authors see.** A decklist spoken in RRI, and card code that still looks
like normal GTS:

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
  "extends": "@catalog/chris/gallery-board@2.1.0/"
}
```

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

**Don’t.** Ship remix UI in this commit.

**Done when.** That fixture is green in CI.

### Commit — Remix writes a map, not a tree

**Story.** Find today’s remix / “make a copy” path in host. Change it so
Remix against `@catalog/chris/gallery-board@2.1.0/` writes a decklist
(`extends` + optional overrides/scopes), not a full tree copy. The realm’s
file listing *is* the changeset. First edit to an overridden module may
copy-on-write that single file (L12: you cannot write through into the
parent catalog realm).

**Authors see.**

```text
Catalog → @catalog/chris/gallery-board@2.1.0 → [Remix]

  before:  copy ~180 files into the workspace
  after:   write a decklist; listing shows only what you changed
```

**Touch.**

```
packages/host/app/… (remix command / service)         +80 / -40
packages/host/app/services/realm.ts                   +20 / -5
```

**Do.** Align product copy with “map, not copy.” Wire helpers through
`RealmService` without inventing a second resolver.

**Don’t.** Quietly keep full-copy as a fallback “just in case.”

**Done when.** Remix of a multi-file package does not duplicate unchanged
files; one edit materializes one path.

---

## PR 2 — Honest URLs on publish

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

## PR 3 — Serve vendored packages

**Why.** Third-party libraries should be first-class, policy-gated addresses
in our world — not forever-links to esm.sh. The crawl and corpus migration
can live on a hosted Deck outside the monorepo. Boxel still needs a **serve
door** and a thin registry gate so republishing the same name at a different
treeHash is a conscious act.

**Unlocks.** **K3** on the serve side; those packages become cacheable pins
authors can put in a decklist as RRIs.

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

**Depends on.** PR 0; PR 1 makes consuming two versions pleasant.

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

## PR 4 — Timeline on the write path ← hinge

**Why.** Editable realms need a tape of what happened while people and agents
worked — not only named releases. Every settled UI save and every agent write
batch (especially definition files) should become a **Step** on a **Timeline**.
When someone means “this is the cut others pin,” that becomes a **Version**.
Claims (“I am working here”) stay separate: intent, not history. Without this
PR, restore, 3-way sync, activity correlation, and review tools have nothing
honest to stand on. Versions-only is fine for some read-only catalog mounts;
it is **not** the product default for working realms.

**Unlocks.** **K1**. Data plane for **K4**, **K12**, **K13**.

**Authors see.** History in the host (CLI follows in PR 5):

```text
History: Timeline                          @workspace/acme/gallery/

  Step  ·  14:32  ·  you@boxel.ai           UI · blog-post
  Step  ·  14:28  ·  agent:vale             definition · scene
  Step  ·  14:21  ·  agent:vale             (claim was on scene)
  Step  ·  13:05  ·  you@boxel.ai           BlogPost/opening-night.json
  ───
  Version  @workspace/acme/gallery@0.4.0-dev.12    published from Step 14:21
  Version  @workspace/acme/gallery@0.3.0           milestone “opening night”
```

```text
[ Restore Step 13:05 ]

  live tree ← that Step
  Versions @0.4.0-dev.12 and @0.3.0 unchanged
  index + isolated preview follow the restored files
```

```json
{
  "actor": "vale",
  "at": "@workspace/acme/gallery/scene",
  "text": "denser lighting on the hero mesh",
  "until": "2026-08-09T19:00:00.000Z"
}
```

**Depends on.** PR 0. Pairing with PR 1 is nice if agents remix while this lands.

### Commit — History façade + surgical write hooks

**Story.** Create `realm-history.ts` as the façade: `recordStep`, `listSteps`,
`restoreStep`, `publishVersion`, implemented via `@cardstack/deck/node`. In
`realm.ts`, after a successful `_batchWriteUnlocked` and after delete paths,
call `recordStep` with actor metadata when present (Matrix id / agent id).
Debounce the way Deck’s live loop does (~500ms quiet) so formatters don’t
create three Steps for one save. Reuse existing notify / broadcast channels
so subscribers learn a Step id was cut — do not invent a parallel bus. Stay
inside `withWriteLock` semantics. This file is ~7.5k lines: **surgical
hooks only**, no drive-by cleanup.

**Touch.**

```
packages/runtime-common/realm.ts                      +180 / -40
packages/runtime-common/realm-history.ts (new)        +250 / -0
packages/runtime-common/index.ts                      +10 / -0
```

**Do.** Same hook for UI instance writes and agent definition writes.
Document the debounce constant.

**Don’t.** Reformat `realm.ts`. Treat a claim refresh as a Step. Bypass the
index when restore arrives next.

**Done when.** Two writes produce Timeline entries; the façade can restore
even if HTTP is the next commit.

### Commit — Server Timeline + history HTTP

**Story.** Realm-server has no `realm-history*` module today — you are
inventing it. Attach jj or historyd per **editable** realm; allow
Versions-only mounts for read-only catalog mirrors. HTTP must list Steps,
list Versions, fetch file-at-Step, and restore **through** normal
`Realm.write` so indexing follows. Optionally bridge
`realm-file-changes-listener` so file-change events can carry step ids.

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

**Done when.** HTTP round-trip: write → list Steps → restore → indexed card
matches the earlier Step.

### Commit — Host: list and restore Steps

**Story.** Extend `RealmService` with list/restore against the new endpoints.
Minimal UI: a history list and a restore confirmation. Vocabulary is Step /
Version / Timeline — never “jj” or “seal” in chrome. Show that agent turns
and UI edits share one tape.

**Touch.**

```
packages/host/app/services/realm.ts                   +80 / -10
packages/host/app/components/…-history… (new)         +150 / -0
```

**Do.** Link a Step row to the path RRI when you have it.

**Don’t.** Build the full review product here (PR 14).

**Done when.** A user can restore a Step from host with correct labels.

### Commit — Gate test

**Story.** Integration test that is the CI gate for this whole PR: write A,
write B, restore to A’s Step; assert index and rendered card follow. Include
one path that looks like an agent batch write (actor header or meta).

**Touch.**

```
packages/realm-server/tests/…                         +120 / -0
```

**Done when.** That test owns the merge button for PR 4.

---

## PR 5 — CLI checkpoints and 3-way sync

**Why.** Standalone `boxel-cli` still thinks in git checkpoints and
`--prefer-local` / `--prefer-remote` as the main story. Once realms have
Steps and Versions, sync can finally merge with a **real common ancestor**
via Deck’s `mergeTrees`. prefer-* becomes the fallback when the merge
reports conflicts — not the everyday path. This is a parallel-repo PR that
depends on PR 4’s APIs; it is not the monorepo `@cardstack/boxel-cli`
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

**Depends on.** PR 4.

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

**Depends on.** PR 4 (so exact Version URLs exist).

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

**Depends on.** PR 4.

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

**Depends on.** PR 4 helpful for correlating with Steps.

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

**Depends on.** PR 2 (classifier); PR 4 (writes/Steps on intake).

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

**Depends on.** PR 4.

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

## PR 12 — Four catalog verbs

**Why.** “Remix” has been doing too many jobs. Install, upgrade, remix, and
use are different promises on the same map machinery. Authors should see
four honest actions; the decklist should show versioned RRIs afterward.

**Unlocks.** **K5** (remix-without-copy already shipped in PR 1).

**Authors see.**

```text
@catalog/lib/three@0.169.0
────────────────────────────────────────────
  [ Use ]      create instance, pin exact latest now
  [ Install ]  add to my app decklist, manage upgrades
  [ Remix ]    extends + override (no full copy)
  [ Upgrade ]  repoint parent, re-resolve
```

```json
// after Install
{
  "imports": {
    "three": "@catalog/lib/three@0.169.0/build/three.module.js"
  }
}
```

```json
// after Use — exact pin in adoptsFrom (versioned RRI)
{
  "data": {
    "meta": {
      "adoptsFrom": {
        "module": "@catalog/chris/gym-board@2.1.3/gym-shift-board",
        "name": "GymShiftBoard"
      }
    }
  }
}
```

**Depends on.** PR 1.

### Commit — Map helpers

**Story.** Four operations on maps — use / install / remix / upgrade —
calling Deck `extends` + resolve. No new resolver.

**Touch.**

```
packages/runtime-common/decklist-adopt.ts (new)       +150 / -0
packages/runtime-common/tests/…                       +80 / -0
```

**Done when.** Install pins a versioned RRI; upgrade re-resolves.

### Commit — Host commands

**Story.** Wire catalog UI actions with honest names. Don’t call everything
“remix.”

**Touch.**

```
packages/host/app/…catalog-adopt…                     +250 / -50
```

**Done when.** Four verbs visible and distinct; remix doesn’t full-copy.

### Commit — Catalog content

**Story.** Affordances on package Specs in the catalog realm. Keep huge
content dumps out of the monorepo PR if you can.

**Touch.** Catalog content · roughly `+400 / -100`.

**Done when.** A package page offers Use / Install / Remix / Upgrade.

---

## PR 13 — Inter-realm submission over Matrix

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

**Depends on.** PR 4; PR 11 for mirror-only GitHub.

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

**Depends on.** PR 4; PR 9 for claims.

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

1. Pick **one commit** — not a whole multi-commit PR unless it is tiny.  
2. Paste the commit’s **Story**, **Touch**, **Do**, **Don’t**, and **Done when**.  
3. Include the parent PR’s **Authors see** (and the RRI primer if names are
   involved) so the agent optimizes for the user-visible outcome.  
4. Point at `docs/artifacts/` when implementing PR 1.  
5. Prove **Done when** before starting the next commit.

---

## Appendix — rough change volume

| PR | Scale | Where the mass is |
| --- | --- | --- |
| 0 | S | Dependency wiring |
| 1 | M | Virtual network + loader + remix |
| 2 | M | Publish handler |
| 3 | S–M | Serve handlers; corpus outside |
| **4** | **L** | **Write path + history stack** |
| 5 | L | CLI rewrite (standalone repo) |
| 6 | S | Headers + tests |
| 7 | S–M | Derive pipeline |
| 8 | S code / **XL blast** | Base pin — every realm |
| 9 | S | Activity + preview |
| 10 | L | Intake dominates download |
| 11 | M | Mirror job + GH narrow |
| 12 | M | Host + catalog content |
| 13 | M | Content + ACL; deletes GH PR path |
| 14 | L content | Review product surface |
