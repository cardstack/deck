# Backporting Deck into the Boxel realm server — subsystem analysis and phasing

**Status: ANALYSIS + PROPOSED PHASING** (2026-08-09).

Companions: [`deck-core-backport-split.md`](deck-core-backport-split.md) (what
Boxel vendors), [`deck-depot-and-realm-backport.md`](deck-depot-and-realm-backport.md)
(depot vs realm vocabulary), [`deck-laws.md`](deck-laws.md).

This note answers one question: **for each contribution Deck makes to Boxel,
which monorepo subsystem has to change, how much, and in what order.**

Everything below is grounded in code read on 2026-08-09: the `boxel` monorepo
at `codex/boxel-execution-runtime-architecture`, the seven paused `deck/*`
branches, the 16,366 card files in `~/boxel-workspaces`, and the 993 files in
`~/Projects/boxel-catalog`.

---

## 0. Summary of findings

Three things changed my view of the sequencing.

1. **The resolver is the whole game, and it is one function.**
   `VirtualNetwork.resolveImport` (`packages/runtime-common/virtual-network.ts:107`)
   is a nine-line prefix match. Every module identifier in the system —
   card, base field, boxel-ui component, CDN library — goes through it.
   Deck's import maps plug in exactly here. But its signature cannot express
   Deck's scopes (§2.1), and that is a real, findable API change.

2. **The corpus already needs scopes.** `~/boxel-workspaces` contains both
   `three@0.160.0` and `three@0.169.0`, live, in different cards. A flat
   prefix map cannot serve both under one specifier. This is not a
   hypothetical requirement.

3. **A realm cannot legally send `immutable`, and Deck's whole cache win
   depends on it.** Realm modules go out as `public, max-age=0`
   (`realm.ts:3298`, `realm.ts:3773`) or `max-age=60, must-revalidate`
   (`realm.ts:3851`). That is correct today, because a realm path is mutable.
   An exact Version is not, which is what makes K2 and K9 possible at all.

The consequence for phasing: **your Release 1 is right to be first, but it is
not zero monorepo work.** It needs the resolver change. That change is small,
it is the same change Releases 2–5 all need, and it is worth doing properly
once rather than as a vendoring special case.

---

## 1. Prior art already in the monorepo

Seven stacked branches, paused. `deck/07-server-maturity` is 19 commits and
39 files ahead of `main`:

| Branch | What it built |
| --- | --- |
| `deck/01-bookmarks` | jj bookmark primitives: immutable version pointers, movable dist-tags |
| `deck/02-registry` | Package registry: publish gate, immutable versions, dist-tags over jj bookmarks |
| `deck/03-serve` | Serve published versions: exact bytes, range/tag redirects |
| `deck/04-transpile` | Serve **executable** modules at published versions, transpiled |
| `deck/05-package-map` | `importmap.json` as both package manifest and realm resolver map |
| `deck/06-serving-hardening` | Production serving hardening from the unpkg comparison |
| `deck/07-server-maturity` | Adopt the Deck protocol name (was BPM) |

The files it added are the skeleton of the backport:

```
packages/realm-server/handlers/handle-package-registry.ts
packages/realm-server/handlers/handle-package-serve.ts
packages/realm-server/handlers/handle-realm-history.ts
packages/realm-server/lib/package-registry.ts
packages/realm-server/lib/realm-history.ts
packages/realm-server/lib/realm-history-jj-lib-client.ts
+ tests for each
```

Plus edits to `main.ts`, `server.ts`, `node-realm.ts`, and
`runtime-common/realm-index-updater.ts`.

**This is worth rebasing before writing anything new.** `deck/05-package-map`
in particular already made the ruling that `importmap.json` is the manifest —
the same ruling standalone Deck landed on independently.

Caveat: these branches predate the current Deck laws and the `treeHash`
identity. The *shape* is reusable; the identity and immutability semantics
must be re-derived from `deck-laws.md`, not assumed.

---

## 2. The four seams

Everything in your list lands on one of four places.

### 2.1 Seam A — the resolver (`runtime-common/virtual-network.ts`)

This is the load-bearing one.

```ts
// virtual-network.ts:107
resolveImport = (moduleIdentifier: string) => {
  for (let [prefix, handler] of this.importMap) {
    if (moduleIdentifier.startsWith(prefix)) {
      return handler(moduleIdentifier.slice(prefix.length));
    }
  }
  if (!isUrlLike(moduleIdentifier)) {
    moduleIdentifier = new URL(moduleIdentifier, PACKAGES_FAKE_ORIGIN).href;
  }
  return moduleIdentifier;
};
```

Registration is `addImportMap(prefix, handler)` (`:151`), and
`addRealmMapping(realmIdentifier, targetURL)` (`:163`) registers a realm
prefix and an import-map entry together. Today's live registrations are the
realm prefixes plus one hand-written entry for
`@cardstack/boxel-icons/` (`packages/host/app/services/network.ts:86`).

Three specific gaps against Deck:

**(a) No importer, so no scopes.** The signature is
`(moduleIdentifier: string) => string`. Deck's import maps have `scopes` —
each deck's dependencies resolve inside its own URL prefix, which is what
lets `three@0.160.0` and `three@0.169.0` both be live. Resolving a scope
requires knowing *who is importing*, and `resolveImport` is not told.

The importer is not entirely absent from the codebase — `boxel-source-classifier.ts:562`
declares `resolveImport(specifier: string, relativeTo: string): string` and
`boxel-execution.ts:785` adapts to it. So a two-argument form already exists
at a higher layer; it just does not reach `VirtualNetwork`. The change is
threading `relativeTo` down through `Loader` (`loader.ts:252`, nine call
sites at `:379 :404 :426 :576 :614 :633 :653 :706 :1238`) and widening the
`VirtualNetwork` signature. Mechanical, but it touches the hottest path in
the loader and every caller.

**(b) First match wins, not longest match.** The loop returns on the first
`startsWith` hit in `Map` insertion order. With a handful of realm prefixes
that is fine. With per-package Deck entries, `@catalog/external/three` and
`@catalog/external/three-bvh-csg` become order-dependent. Deck (and the
import-maps spec) resolve longest-prefix-first. This is a latent bug the
moment the map gets denser.

**(c) No version dimension.** A prefix maps to exactly one target URL. There
is nowhere to say "this deck at this Version" without encoding it into the
prefix string.

### 2.2 Seam B — the realm write path (`runtime-common/realm.ts`)

```
Realm.write()      :2008
Realm.writeMany()  :2019
Realm.delete()     :2670
Realm.deleteAll()  :2736
```

Four entry points. Everything that mutates a realm goes through them, which
is what makes K1 tractable: a Deck Step/Version hook has exactly four
attachment points, not a scattered set. The prior art already threads
`realm-index-updater.ts`, so the pattern for hanging work off a write exists.

The hard part is not the hook, it is the **debounce and the identity**: Deck
publishes `<base>-dev.N` on a debounced watcher, and a realm write is already
transactional against the index. Getting one Version per meaningful change
rather than one per keystroke is a policy decision (see K1).

### 2.3 Seam C — realm-server HTTP (`packages/realm-server/`)

~40 handlers today. The prior art adds three more. Deck needs:

- the serve grammar (`live` / `@exact` / tag / `?meta` / digests / pack)
- cache-control that can say `immutable` for an exact Version
- the read-only gate (L12) for the Deck routes specifically — note the realm
  server as a whole *must* keep writing, so L12 applies to the Deck surface,
  not the server

### 2.4 Seam D — `packages/boxel-cli`

`lib/checkpoint-manager.ts` is **git-backed today**: `git rev-parse HEAD`
(`:257`), `git show --stat` (`:414`), `git checkout <hash> -- .` (`:454`).
`commands/realm/` already has `sync.ts`, `push.ts`, `pull.ts`,
`milestone.ts`, `history.ts`.

`sync.ts` classifies conflicts **two-way** — `--prefer-local`,
`--prefer-remote`, `--prefer-newest` (`:588-590`). There is no common
ancestor, which is precisely why it can only offer "pick a side". This is
K4's whole opportunity and it is a clean one.

---

## 3. What the card code looks like after

Grounded in real files from `~/boxel-workspaces` (16,366 card files mined).

### 3.1 What is there now

| Import form | Count | Example |
| --- | ---: | --- |
| `https://cardstack.com/base/*` | 118 card-api, 86 string, 45 number, 21 datetime, 19 boolean | base fields |
| `@cardstack/base/*` (RRI) | 61 card-api, 54 string, 28 number | the newer form |
| `@cardstack/boxel-ui/*` | 46 components, 37 helpers | |
| CDN | leaflet, three ×2 versions, tone, chess.js, cm-chessboard | see below |
| Cross-realm absolute | `https://realms-staging.stack.cards/ctse/common-libs/...` | 5 |
| Bare npm | ember-modifier 21, yaml 16, ember-concurrency 12, zod, lodash, jstat, bessel | |

### 3.2 A CDN import today

From `boxel-skills-getmenu-fix/skills/boxel-patterns/patterns/integrate-leaflet-via-cdn/example.gts`:

```ts
import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { modifier } from 'ember-modifier';
// @ts-expect-error esm.sh is a runtime import; TS can't resolve it
import L from 'https://esm.sh/leaflet@1.9.4';
```

and later, inside the modifier:

```ts
// Use an absolute URL for the marker icon — relative paths don't resolve in realms.
const icon = L.icon({
  iconUrl: 'https://esm.sh/leaflet@1.9.4/dist/images/marker-icon.png',
  ...
});
```

Four things are wrong here and every one of them is a Deck contribution:

- `@ts-expect-error` on every CDN import — the type system is switched off at
  exactly the boundary where a card meets third-party code.
- The version `1.9.4` is written twice, in two syntaxes, in one file. Nothing
  keeps them in step.
- `esm.sh` is a live third-party origin in the render path (L6 hermeticity
  says a sealed deck reaches nothing at runtime; this reaches the internet).
- The asset URL has to be absolute because relative paths do not resolve —
  the module and its assets are not one addressable tree.

The three.js pattern is worse, because the transitive pin leaks into the
specifier:

```ts
// @ts-expect-error Runtime ESM import is resolved by the realm.
import * as THREE from "https://esm.sh/three@0.160.0";
// @ts-expect-error Runtime ESM import is resolved by the realm.
import { Brush, Evaluator, SUBTRACTION } from "https://esm.sh/three-bvh-csg@0.0.16?deps=three@0.160.0";
```

`?deps=three@0.160.0` is a query-string import map. It is esm.sh's answer to
the problem Deck solves with scopes.

### 3.3 The same card, deck'd

```ts
import { CardDef, field, contains, Component } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { modifier } from 'ember-modifier';
import L from 'leaflet';
```

and the asset resolves relative to the module, because the module and its
assets are one tree:

```ts
const icon = L.icon({
  iconUrl: new URL('./dist/images/marker-icon.png', import.meta.resolve('leaflet')).href,
  ...
});
```

No `@ts-expect-error`: the vendored package carries its own `.d.ts`, so
`leaflet` type-checks like any dependency. No version in the source at all —
it is in the realm's `importmap.json`:

```json
{
  "imports": {
    "leaflet": "/catalog/external/leaflet@1.9.4/dist/leaflet-src.esm.js",
    "three": "/catalog/external/three@0.169.0/build/three.module.js",
    "three-bvh-csg": "/catalog/external/three-bvh-csg@0.0.16/build/index.module.js"
  },
  "scopes": {
    "/catalog/external/three-bvh-csg@0.0.16/": {
      "three": "/catalog/external/three@0.160.0/build/three.module.js"
    }
  }
}
```

That `scopes` block is the whole argument for Seam A(a): `three-bvh-csg`
needs `0.160.0`, the card wants `0.169.0`, and both are already in your
corpus. Today that is expressible only as an esm.sh query string; after the
backport it is protocol.

The three.js card's source becomes:

```ts
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
```

### 3.4 Base fields (K11)

Today `https://cardstack.com/base/card-api` is a **virtual** URL —
`constants.ts:11` declares `baseRealm` at `https://cardstack.com/base/`, and
`network.ts:78` maps it to the real URL. It is a hostname that does not
serve, special-cased in the resolver.

Deck'd, it is not special at all:

```json
{
  "imports": {
    "@cardstack/base/": "https://deck.cardstack.com/base/cardstack/base@2.14.0/"
  }
}
```

The 118 `card-api` + 86 `string` imports keep working through the existing
RRI prefix; only the target changes, and it gains a Version. The gain is
`immutable` caching on a tree that every card in every realm loads — which is
the single biggest cache win available anywhere in the system.

The risk is equally concentrated: **one bad base Version is every realm.**
That argues for base distribution landing *after* the restore path (K1), not
before — a correction to the proposed ordering (§6).

---

## 4. `boxel-catalog` as a depot

993 files, laid out as one directory per card definition:

```
boxel-catalog/
  Spec/            Skill/          Category/       Tag/
  blog-app/        catalog-app/    boxel-surface/
  04868f-mortgage-calculator/      150b3a-virtual-piano/
  d29736-tier-list/                submission-workflow-card/
  ...
```

This is **placement-free realm layout** — paths are IDs, a card sits wherever
it sits. Standalone Deck's tidy `publisher/package/` shape is *one* way to
lay out a depot, not a requirement
(`deck-depot-and-realm-backport.md` §3.2).

So the depot view does not reorganise the directory. It adds a decklist that
names trees over the existing paths:

```
/catalog/                                  ← realm, unchanged, still indexed
/catalog/blog-app/                         ← live, what you edit
/catalog/_deck/catalog/blog-app@3.2.0/     ← a sealed Version of that subtree
/catalog/_deck/catalog/blog-app@stable/    ← a movable tag
/catalog/external/three@0.169.0/           ← a vendored package, same machinery
```

Two consequences worth being explicit about, since you raised both:

**Indexing survives untouched.** The Deck store sits *behind* the realm file
system, not in front of it. The indexer keeps reading the live tree; search,
`Spec` cards, and `adoptionFrom` all work exactly as now. What is added is a
second, read-only address space over sealed trees. A sealed Version is not
indexed as instances — it is bytes at an address — which is the correct
answer, because indexing a thousand historical Versions would be pointless
work.

**LibSpec falls out of the existing Spec card.** `packages/base/spec.gts`
already carries `ref` (a `CodeRef`: module + exported name) and `moduleHref`.
A LibSpec is a `Spec` whose `ref.module` points into
`/catalog/external/<pkg>@<version>/`. It is browsable, searchable, and
linkable *today* — no new card type, no new indexing path. That makes K3's
catalog half nearly free once vendoring exists.

---

## 5. Contribution → subsystem map

Effort is rough engineer-weeks. "Seam" refers to §2.

| # | Contribution | Seam | Files that change | Prior art | Effort | Risk |
| --- | --- | --- | --- | --- | ---: | --- |
| **K1** | Version behind the realm FS (restore/undo/checkpoint) | B, C | `realm.ts` ×4 write points, `realm-history*.ts`, `handle-realm-history.ts`, index updater | `deck/01`, `deck/07` | 4–6 | **High** — write path, debounce policy, storage growth |
| **K2** | Immutable imports, cacheable | C | `realm.ts:3298/3773/3851` cache-control, serve path | `deck/03`, `deck/06` | 1–2 | Low — but only legal on exact Versions |
| **K3** | Vendoring as our own unpkg + policy + LibSpec | A, C | new `handle-package-serve`, vendor pipeline, `Spec` instances (content) | `deck/02`, `deck/03` | 3–4 | Medium — npm ingest, cooldown policy |
| **K4** | Unify checkpoint/milestone; 3-way sync | D | `checkpoint-manager.ts` (drop git), `sync.ts` conflict engine, `milestone.ts` | — | 2–3 | Medium — changes a shipped CLI's semantics |
| **K5** | install / upgrade / remix / use | A, C | resolver + catalog verbs; mostly realm content | — | 2 | Low once A lands |
| **K6** | Catalog authoritative, GitHub a mirror | C, D | mirror job, `handle-github-pr.ts` retire | — | 2–3 | Medium — org/process, not just code |
| **K7** | Submission/review/voting inter-realm | — | realm content (`submission-workflow-card`) + activity read path | `deck` activity | 3–4 | Medium — needs K6 to matter |
| **K8** | Remix without copying | **A** | resolver scopes + fork semantics | `deck/05` | included in A | Low |
| **K9** | Minified + gzipped releases | C | derive pipeline, serve negotiation | `deck/06` | 1–2 | Low — depends on K2 |
| **K10** | Versioned realm infra replaces gh+npm+esm.sh | A,B,C,D | the sum of the above | all | — | It is the goal, not a task |
| **K11** | Base realm via Deck import map | **A** | `constants.ts`, `network.ts` mapping, base publish pipeline | — | 2 | **High blast radius** — one Version is every realm |
| **K12** | Live agent monitoring in preview | C | `/_activity` read path; boxel already has preview + prerender | `deck` activity | 2 | Low |
| **K13** | Review/patch tools over protocol data | — | realm content, reading Versions/Steps/claims | — | 2+ | Low — pure upside, needs K1 |
| **K14** | Deck Pack + prune negotiation | C | `handle-download-realm`/`publish-realm`, pack equivalence | pack spec | 3 | Medium — **the negotiation is unspecified** |

Two notes on that table.

**K8 is not a separate project.** "Remix without copying" *is* import-map
scopes plus fork. Once Seam A can express scopes, remix is a decklist that
overrides one entry and inherits the rest by reference. It costs nothing
extra and it is one of the most valuable items on your list — I would stop
treating it as a line item and start treating it as the acceptance test for
Seam A.

**K14 has an unsolved design problem, correctly identified in your own
note.** "What is mutually accessible to the recipient, to prune" is a
negotiation, and negotiation is in-motion protocol. Nothing in Deck specifies
it today. That is a design task before it is an engineering task, and it
should not be inside an early release.

---

## 6. Phasing

Your five releases hold up well. I would make three changes.

### R1 — Vendoring, read-only, off-monorepo *(mostly as proposed)*

Cloudflare-hosted `cardstack/deck`. Mine every user realm for CDN imports,
republish them as vendored packages, address them as `@catalog/external/…`.
Pull-based sync to the catalog realm; no upload API.

**Change: R1 is not zero monorepo work.** It needs Seam A — at minimum
longest-prefix matching and the `relativeTo` thread-through, because your
corpus already has two live `three` versions. Trying to avoid that with
per-version prefixes (`three-0-160/`) would encode versions into specifiers
and poison every later release.

So R1 splits:

- **R1a (monorepo, small):** widen `resolveImport` to `(specifier, relativeTo)`,
  longest-prefix match, accept a scopes-shaped map. One PR, well-tested,
  no behaviour change on today's inputs. *This is the first commit.*
- **R1b (outside monorepo):** the vendor pipeline, the CF-hosted deck server,
  the corpus migration, LibSpec instances in the catalog.

Delivers K3, K8, and most of K2.

### R2 — Distribute base + catalog realms via Deck *(defer the base half)*

Read-only, CF-hosted, HTTP/2/3, gzipped, no rollup.

**Change: split base from catalog, and move base later.** The catalog half is
safe — a new address space over content that already exists. The base half
(K11) has the largest blast radius in the system: 118 files import
`card-api` in one workspace mirror alone, and every realm everywhere depends
on it. Shipping base distribution *before* the restore path (K1) means the
recovery story for a bad base Version is "roll the CF deployment", not
"restore the Version". Do base *after* R3.

Delivers K9, half of K2, catalog-side K6.

### R3 — History into the realm server *(as proposed, and this is the hinge)*

jj/historyd in `packages/realm-server`, versioned resolver, restore from
tag/checkpoint, `boxel-cli` on Deck-style revisions.

This is the first genuine monorepo PR and the one to rebase the `deck/*`
branches onto. It delivers K1 and K4 together — and it should, because K4's
3-way merge needs the merge base that K1's Versions provide. Doing them
separately means building the sync engine twice.

Then, and only then, **R3.5: base realm via Deck** (K11), with restore
available.

### R4 — Deck inside the realm server *(as proposed)*

Every write gets Version tagging and reuse. Enables K12, K13.

### R5 — Rebuild catalog as a deck-enabled realm *(as proposed)*

Mirror to GitHub on milestones (3–5/day, not per commit), all libs as
LibSpec, the four verbs, submission workflow off GitHub PRs. Mostly realm
content; the only monorepo work is retiring the PR-based submission path.

Delivers K5, K6, K7.

**K14 (Deck Pack negotiation)** sits outside all five until the prune
negotiation is designed. Slotting it into R4/R5 as a line item would be
scheduling a design problem.

### Revised order

```
R1a  resolver: (specifier, relativeTo), longest-prefix, scopes-shaped   [monorepo, small]
R1b  vendoring + CF deck + corpus migration + LibSpec                   [outside]
R2   catalog realm distributed via deck                                 [outside]
R3   history in realm server + boxel-cli 3-way        ← the hinge       [monorepo, large]
R3.5 base realm via deck import map                                     [monorepo, high blast radius]
R4   deck inside realm server for all writes                            [monorepo]
R5   catalog rebuilt as deck-enabled realm + GitHub mirror              [content + small monorepo]
—    K14 pack negotiation, when designed
```

---

## 7. The Core boundary — what Boxel imports

The strategy is that **the deck repo carries every piece until the monorepo
change is only wiring.** That makes the package boundary a design object, not
packaging trivia.

### 7.1 The shaping constraint: Seam A runs in a browser

`VirtualNetwork.resolveImport` executes in the Ember host. Boxel does not use
native import maps — it has its own loader — so it must run the resolution
algorithm itself, in the page.

That is the one part of Core that has to load in a browser, and as of this
analysis most of Core could not: ten of twenty-three modules in
`packages/core/src` reach `node:fs/promises`, `node:path`, `node:zlib` or
`node:crypto`.

So Core is not one lean package. It is **split by runtime**:

| Entry | Runtime | Contents | Who imports it |
| --- | --- | --- | --- |
| `…/resolve` | **Browser + Node** | import-map resolution with scopes, manifest parsing, tree-root tokens | host `VirtualNetwork`, realm server |
| `…/store`, `…/pack`, `…/lock`, … | Node only | object store, pack, lock, sign, vendor, npm ingest | realm server, CLI |
| `…/conform` | test | L1–L12 black box | CI gate on the realm |

### 7.2 What `…/resolve` exports

Done, and on `deck/core-boundary`:

```ts
// @cardstack/deck/resolve — zero `node:` imports, enforced by lint
export function resolveSpecifier(options: {
  specifier: string;
  fromUrl: string;                                  // ← the importer: what makes scopes possible
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
}): string | undefined;

export function parsePackages(jsonText): Record<string, PackageMapEntry> | undefined;
export function parseDependencies(...);
export function treePathFromMapValue(value): string | undefined;
export const IMPORT_MAP_PATH, MOUNT_SEPARATOR, TREE_ROOT, LEGACY_TREE_ROOTS;
export type { PackageMapEntry };
```

Two things worth recording about how that surface came to exist.

**The resolver was already written, in the wrong package.**
`resolveSpecifier` lived inside `packages/server/src/preload.ts`, used to
decide which `modulepreload` links to emit. It is exact — an exact key wins,
then the longest key ending in `/`, scopes consulted first, longest scope
prefix first — and it already takes the importer. It is not a preload
detail; it is the contract. It now lives in Core and `preload.ts` re-exports
it.

**`import-map.ts` was pure except for one function.** `packagesFromPack`
reads `importmap.json` out of a `.pack.zip`, which needs a zip reader, which
needs `node:zlib`. Parsing a manifest and unwrapping a container are
different jobs; the container half is now `import-map-pack.ts`, and five
call sites moved with it.

### 7.3 The boundary is a lint rule

A convention would not survive. `.eslintrc.cjs` names the pure files and
forbids `node:*` inside them:

```
'node:path' import is restricted from being used by a pattern. Part of the
browser-safe surface (see packages/core/src/resolve.ts). Put the Node-only
half in a sibling module.
```

Verified by injecting a violation and watching it fail, then restoring.
Full suite after the refactor: **308 pass, 0 fail** — unchanged.

### 7.4 Naming and publishing

Two open decisions, flagged rather than assumed:

1. `deck` on npm belongs to someone else. Publishing under the
   **`@cardstack/*`** scope sidesteps it and uses a scope Cardstack already
   publishes to.
2. Name it now what it will be called *after* the move into the monorepo —
   `@cardstack/deck` — so relocating is a directory move with no import
   churn in consumers. The package is still `@cardstack/deck` today; renaming is
   deliberate churn best done in one pass, not mixed into the split.

### 7.5 Exit criteria

The backport is "just wiring" when:

- [x] `…/resolve` has zero `node:` imports, enforced by CI
- [x] the resolver takes the importer, so scopes are expressible
- [ ] every function Boxel needs is reachable from a documented entry — no
      reaching into internals
- [x] two entries split by runtime rather than 25 by module —
      `@cardstack/deck` (browser-safe) and `@cardstack/deck/node`
- [ ] conformance runnable against a *foreign* implementation over HTTP, so
      it can gate the realm server in CI
- [x] ~~types shipped~~ — **not needed, and struck deliberately.**
      `@cardstack/runtime-common` ships raw `.ts` with no build, no
      `types` field and no `dist`, consumed as `workspace:*` by host and
      realm-server. Deck already matches that convention, so declarations
      would be dead weight in the monorepo and lossier than the source
      they were generated from. A build only becomes necessary if Core is
      consumed by something that will not transpile `node_modules` — and
      that consumer is not Boxel.

      This entry also conflated two problems. The `@ts-expect-error` on
      every CDN import in card code (§3.2) is not about Deck Core's own
      declarations at all — it dies when VENDORING carries a library's
      own `.d.ts` into the vendored tree. Different mechanism, different
      workstream (K3).

### 7.6 What stays irreducibly monorepo

Core shrinks this; it cannot remove it:

- threading `relativeTo` through `Loader`'s nine call sites and widening
  `VirtualNetwork.resolveImport`
- hooking `Realm.write` / `writeMany` / `delete` / `deleteAll`
- mounting the Deck handlers and changing cache-control

What Core does remove is **the semantics**: scope resolution, tree identity,
merge and pack arrive tested and conformance-covered, so the monorepo PR is
a wiring diff with no new algorithm to argue about in review.

---

## 8. What to do first

**Rebase `deck/05-package-map` onto current `main` and read it against
`deck-laws.md`.** It already ruled that `importmap.json` is both the package
manifest and the realm's resolver map. Before writing R1a, confirm that
ruling still holds under the current laws — if it does, R1a has a
specification and a test fixture already written.

Then R1a, as one PR:

1. Widen `VirtualNetwork.resolveImport` to `(specifier, relativeTo?)`.
2. Longest-prefix match instead of first-match-wins.
3. Accept a scopes-shaped map; resolve scopes against `relativeTo`.
4. Thread `relativeTo` through `Loader`'s nine call sites.
5. No behaviour change on today's inputs — the existing suite is the gate.

The acceptance test writes itself, and it is K8: **one card importing
`three@0.169.0` while its dependency resolves `three@0.160.0`, both live, no
`@ts-expect-error`, no query string.** That single test proves the seam is
right for every release after it.

---

## 9. Open questions

1. **Version granularity on write (K1).** One Version per `Realm.write`, per
   debounced burst, or per explicit checkpoint? Deck's watcher debounces;
   a realm write is already transactional. Storage growth and Timeline
   readability pull in opposite directions.
2. **Does `boxel-cli` keep git?** `checkpoint-manager.ts` is git-backed. K4
   can either replace git with Deck Versions or keep git locally and
   translate. Replacing is cleaner; keeping is cheaper and reversible.
3. **L12 scope.** The realm server must write. So the read-only gate applies
   to the Deck routes only — worth writing down as a law amendment rather
   than an implementation detail.
4. **Prune negotiation (K14).** Unspecified. Needs its own design note.
5. **Two live base Versions at once?** If base is deck-distributed, can two
   realms pin different base Versions and still exchange cards? This is the
   question that decides whether K11 is a distribution change or a protocol
   change.
