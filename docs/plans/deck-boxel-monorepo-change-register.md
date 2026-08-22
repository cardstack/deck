# Monorepo change register — what Boxel must change, per benefit

**Status: REGISTER** (2026-08-09) — **appendix** (file-level *what*). Execution
order lives in [`deck-boxel-backport-for-team.md`](./deck-boxel-backport-for-team.md)
(**How we execute**) and
[`deck-boxel-backport-changelist-mockup.md`](./deck-boxel-backport-changelist-mockup.md)
(product spine **1 → 1b → 4c**; History sliced). Deck-side gates:
[`deck-work-plan-for-backport.md`](./deck-work-plan-for-backport.md).

Companion for *why*: [`deck-boxel-backport-plan.md`](./deck-boxel-backport-plan.md).
Also see [`deck-core-backport-split.md`](./deck-core-backport-split.md),
[`deck-publish-as-a-pointer.md`](../deck-publish-as-a-pointer.md),
[`deck-realm-download-as-pack.md`](../deck-realm-download-as-pack.md),
[`deck-catalog-cdn-delivery.md`](../deck-catalog-cdn-delivery.md).

---

## 0. How to read this

- **Verified** paths and line numbers were read on 2026-08-09. **New** means
  a file that does not exist yet. **Content** means realm content, *not* a
  monorepo change — several benefits need little or no monorepo work, and
  saying so is part of the answer.
- **Deck Core supplies** lists what arrives as a dependency, so the monorepo
  diff stays a wiring diff.
- Postgres changes follow the two-phase rule: additive in
  `packages/postgres/migrations/`, destructive in
  `packages/postgres/migrations-removal/`.
- Boxel keeps the word **realm**. Nothing here renames it.

---

## 1. Four prerequisites carry twelve of the fourteen

Most benefits are thin once the thing underneath them lands. The register is
easier to plan as four prerequisites plus per-benefit remainders.

| | Prerequisite | Where | Unlocks |
| --- | --- | --- | --- |
| **P1** | Resolver takes the importer; longest-prefix; scopes | `runtime-common/virtual-network.ts`, `runtime-common/loader.ts` | K3, K5, K8, K10, K11 |
| **P2** | Versions behind the realm write path | `runtime-common/realm.ts`, `realm-server/lib/realm-history.ts` | K1, K4, K13, publish-as-tag |
| **P3** | Deck serve grammar + three cache classes | `realm-server/handlers/*`, `runtime-common/realm.ts` | K2, K9, K10 |
| **P4** | Absolute-reference classifier (rebind / rewrite / leave alone) | **`@cardstack/deck/classify`** — imported, not written | K14, publish Stage 1, pack intake |

P4 is the sleeper. It is needed by pack intake *and* by the publish
optimisation, and the publish optimisation can ship before any of Deck — so
P4 is the earliest thing with two customers.

**Correction (2026-08-09):** P4 was originally listed as new code in
`runtime-common/`. That was wrong — what counts as a declared dependency is
a decklist question, so it is protocol. It now ships as
`@cardstack/deck/classify`, and the monorepo imports it. Boxel writes no
classification logic of its own.

---

## 2. Master table

| # | Benefit | Monorepo packages | New files | Migration | Depends on |
| --- | --- | --- | ---: | --- | --- |
| K1 | Version behind the realm FS | runtime-common, realm-server | ~4 | yes | P2 |
| K2 | Immutable, cacheable imports | runtime-common, realm-server | 0 | no | P3 |
| K3 | Vendoring + LibSpec | realm-server *(+ content)* | ~2 | no | P1 |
| K4 | Unified checkpoint + 3-way sync | boxel-cli | ~1 | no | P2 |
| K5 | install / upgrade / remix / use | runtime-common, host *(+ content)* | ~1 | no | P1, K8 |
| K6 | Catalog authoritative, GitHub a mirror | realm-server | ~1 | no | K1 |
| K7 | Inter-realm submission | realm-server *(mostly content)* | 0 | no | K6 |
| K8 | Remix without copying | runtime-common, host | ~1 | no | **P1** |
| K9 | Minified + gzipped releases | realm-server | ~1 | no | P3, K2 |
| K10 | Versioned realm infra as registry | — | — | — | the sum |
| K11 | Base realm via Deck | runtime-common, host | 0 | no | P1, K1 |
| K12 | Live agent monitoring | realm-server, host | ~1 | no | P2 |
| K13 | Review tools over protocol data | *(content)* | 0 | no | P2 |
| K14 | Deck Pack + prune negotiation | realm-server, runtime-common | ~3 | no | P4 |

---

## 3. The prerequisites in detail

### P1 — the resolver

| File | Change |
| --- | --- |
| `runtime-common/virtual-network.ts:107` | `resolveImport(specifier)` → `resolveImport(specifier, relativeTo?)`. Replace first-match-wins with longest-prefix. Delegate to Deck Core. |
| `runtime-common/virtual-network.ts:151` | `addImportMap(prefix, handler)` gains a scopes-aware sibling, or is replaced by `setImportMap(map)` taking `{imports, scopes}` |
| `runtime-common/virtual-network.ts:163` | `addRealmMapping` keeps working — it becomes one writer into the map |
| `runtime-common/loader.ts:252` | field type widens; thread `relativeTo` through the nine call sites at `:379 :404 :426 :576 :614 :633 :653 :706 :1238` |
| `host/app/services/network.ts:42` | `get resolveImport()` passes the new arg through |
| `host/app/lib/boxel-source-classifier.ts:562` | already declares the two-arg form — the adapter at `boxel-execution.ts:785` collapses |

**Deck Core supplies:** `resolveSpecifier({specifier, fromUrl, imports, scopes})`
from `@cardstack/deck/resolve` — pure, browser-safe, lint-enforced, already built.

**Test gate:** one card importing `three@0.169.0` whose dependency resolves
`three@0.160.0`, both live, no `@ts-expect-error`, no `?deps=` query string.
Both versions are already in `~/boxel-workspaces`.

**Risk:** the loader's hottest path. No behaviour change on today's inputs;
the existing suite is the gate.

### P2 — Versions behind the write path

| File | Change |
| --- | --- |
| `runtime-common/realm.ts:2008` `write` | publish hook |
| `runtime-common/realm.ts:2019` `writeMany` | publish hook (one Version for the batch, not per file) |
| `runtime-common/realm.ts:2670` `delete` | publish hook |
| `runtime-common/realm.ts:2736` `deleteAll` | publish hook |
| `runtime-common/realm-index-updater.ts` | already threaded by the prior art; the pattern for hanging work off a write exists |
| `realm-server/lib/realm-history.ts` | **new** (exists on `deck/01`, `deck/07` — rebase) |
| `realm-server/lib/realm-history-jj-lib-client.ts` | **new** (same) |
| `realm-server/handlers/handle-realm-history.ts` | **new** (same) |
| `realm-server/main.ts`, `server.ts`, `node-realm.ts` | mount + lifecycle |

**Migration:** a table for Version pointers and Steps. Additive.

**Open policy, not code:** one Version per write, per debounced burst, or per
explicit checkpoint. Decides storage growth and History readability.

**Deck Core supplies:** tree hash, store, pack, the History adapter.

### P3 — serve grammar and cache classes

| File | Change |
| --- | --- |
| `realm-server/handlers/handle-package-serve.ts` | **new** (exists on `deck/03`, `deck/04` — rebase) |
| `realm-server/handlers/handle-package-registry.ts` | **new** (exists on `deck/02` — rebase) |
| `realm-server/routes.ts` | mount both |
| `runtime-common/realm.ts:3298, :3773, :3851` | three cache classes instead of one: `immutable` for an exact Version, short TTL for a tag, `no-store` for live |

**Deck Core supplies:** URL grammar parsing, digests, `?meta`, pack serving.

### P4 — the absolute-reference classifier

**Built, in Deck Core.** `classifyReference` from `@cardstack/deck/classify`. The
monorepo calls it; it writes no classification logic of its own.

```ts
classifyReference({ value, role, imports, sourceBase })
//   role: 'reference' | 'opaque'   ← required, on purpose
// → { action: 'leave',   reason: 'opaque' | 'relative' | 'bare' | 'foreign' }
// → { action: 'rebind',  reason: 'declared-dependency', specifier, rest }
// → { action: 'rewrite', reason: 'source-base', rest }
```

The one thing a caller must get right is `role`. It has no default, so code
that has not decided whether a string is a reference does not compile — and
data is never touched whatever it matches. That is what stops the failure
mode `boxel-catalog` would otherwise walk into: `backgroundURL` and
`iconURL` are absolute URLs that must survive relocation untouched, and
today they survive only because they happen not to match a rewrite rule.

Verified against the real catalog: `./catalog-app/catalog` leaves,
`https://cardstack.com/base/realm-config` rebinds, and
`https://boxel-images.boxel.ai/icons/Letter-c.png` is untouched even when
wrongly labelled a reference.

`summarise()` returns the `foreign` list — absolute references carried but
not resolvable — so intake can report what it did not carry.

---

## 4. Per benefit

### K1 — Version management behind the realm file system

*Restore / undo / checkpoint.*

Almost entirely P2. The remainder:

| File | Change |
| --- | --- |
| `realm-server/handlers/handle-realm-history.ts` | list Versions, file-at-Step, restore |
| `runtime-common/realm.ts` | `restore(version)` writing through the normal write path so the index follows |
| `host/app/services/realm.ts` | surface Versions to the UI |

**Test gate:** write, write, restore to the first Version, confirm the index
and a rendered card both follow.

### K2 — Immutable imports with cacheability

Entirely P3's cache-class change. Nothing else.

The measurable claim: a second card sharing nine-tenths of its closure issues
near-zero module requests on a warm cache. Worth an actual before/after
capture, since this is the benefit most often asserted and least often shown.

### K3 — Vendoring as our own unpkg, with policy and LibSpec

| File | Change |
| --- | --- |
| `realm-server/handlers/handle-package-serve.ts` | serve vendored packages (P3) |
| `realm-server/lib/package-registry.ts` | **new** — publish gate, cooldown policy |
| *content* | a `Spec` instance per vendored package |

**LibSpec needs no new card type.** `packages/base/spec.gts` already carries
`ref` (a `CodeRef`) and `moduleHref`. A LibSpec is a `Spec` whose
`ref.module` points into the vendored tree — browsable, searchable and
indexable today.

**Not monorepo work:** the vendor pipeline itself and the corpus migration
run outside, on the hosted deck (Release 1b).

### K4 — Unified checkpoint/milestone, sync as 3-way merge

| File | Change |
| --- | --- |
| `boxel-cli/src/lib/checkpoint-manager.ts` | replace git (`rev-parse` `:257`, `show --stat` `:414`, `checkout <hash> -- .` `:454`) with Deck Versions |
| `boxel-cli/src/commands/realm/sync.ts` | three-way merge; the `--prefer-local` / `--prefer-remote` / `--prefer-newest` strategies at `:588-590` become the *fallback* for genuine conflicts, not the only mechanism |
| `boxel-cli/src/commands/realm/milestone.ts` | a milestone is a tag |
| `boxel-cli/src/commands/realm/history.ts` | reads the realm's History instead of git log |
| `boxel-cli/src/lib/find-checkpoint.ts` | resolve by Version or tag |

**Deck Core supplies:** `merge` (pure, already in the browser-safe set).

**The point:** sync can only offer "pick a side" today because it has no
common ancestor. A Version *is* the ancestor. K4 is thin — but only after P2.

**Open:** keep git locally and translate, or drop it. Dropping is cleaner;
keeping is cheaper and reversible.

### K5 — install / upgrade / remix / use

Four operations on a map, not four features:

| Verb | Change |
| --- | --- |
| use | resolve the parent's map — P1, no new code |
| install | copy the map, pin every entry |
| remix | copy the map, override changed entries — K8 |
| upgrade | repoint the parent, re-resolve |

| File | Change |
| --- | --- |
| `runtime-common/` | **new** — decklist `extends` resolution (order, conflict rule, depth limit) |
| `host/app/…` | four commands in the UI |
| *content* | the catalog's adoption affordances |

**Blocked on a protocol decision, not on Boxel:** `extends` in a decklist is
not implemented in Deck yet. That is the next protocol question, and it
belongs in the deck repo.

### K6 — Catalog authoritative, GitHub a read-only mirror

Normative design: [`deck-github-mirror-analysis.md`](../deck-github-mirror-analysis.md)
— **one GitHub monorepo per depot**, Versions remain in `.deck/store`,
Every-save History optional on `history`, catalog mirrors **read-only**, GitHub PRs
only via **intake** (`Base-Version` + `mergeTrees` + publish; no AI).
Human anytime path keeps legacy **`share` / `gather`** verbs (§5b) but
not copy-overwrite. Implement export → share → gather before bot intake.
Not built yet.

| File | Change |
| --- | --- |
| `realm-server/` | **new** — a mirror job: bulk export on milestone, 3–5×/day, not per write |
| `realm-server/handlers/handle-github-pr.ts` | retire once K7 lands |
| `realm-server/lib/github.ts` | `createPullRequest` becomes mirror-only |

Mostly organisational. The technical piece is small: a scheduled export
driven by tags rather than by writes.

### K7 — Submission / audit / review / voting, inter-realm

**Mostly realm content.** The catalog's `SubmissionWorkflowCard` already
models the workflow — it has `prCard`, `ciStatus` and `reviewStatus` fields.
Making submission inter-realm means replacing `prCard` with a realm-native
proposal that reads Deck data, not deleting the workflow.

Normative cross-realm carriage (offers / rebase between deck-enabled
realms): [`deck-depot-and-realm-backport.md`](../deck-depot-and-realm-backport.md)
§3.3 and [`deck-in-motion.md`](../deck-in-motion.md) §3.7 — (1) public realm
readable by both sides, (2) out-of-band **Matrix** identity + room +
message of intent, (3) Deck Pack attachment when the tip cannot be public.
Realm ACL gates who may issue an offer and who may rebase/accept. GitHub
PR is interim only (K6 intake / share-gather).

| File | Change |
| --- | --- |
| *content* | `submission-workflow-card.gts`: `prCard` → a proposal card over Versions / offers |
| *content* / host | Matrix room + message as intent signal; optional pack attach |
| `realm-server/` | ACL checks on offer issue and rebase/accept pointer moves |
| `realm-server/handlers/handle-github-pr.ts` | delete once Matrix + Deck path is live |

**Depends on K6** to be meaningful for catalog authority, and on the
activity read path for review state; depends on Deck Core offer/rebase
behind the realm FS (K1/P seam).

### K8 — Remix without copying

**This is P1 plus a small map operation.** Not a separate project — and it is
the right acceptance test for P1.

| File | Change |
| --- | --- |
| `runtime-common/` | decklist override + `extends` (shared with K5) |
| `host/app/…` | "remix" writes a map, not a copy |

Because a realm cannot be written to remotely (L12), **an edit to a remixed
module can only mean "this module is now a local file"** — copy-on-write per
module, enforced by the protocol. Remix writes nothing until the first edit,
so it is instantaneous, and a realm's file listing becomes its changeset.

### K9 — Minified, gzipped releases

| File | Change |
| --- | --- |
| `realm-server/` | **new** — derive a minified Version on publish |
| serve path | negotiate the derived variant |

Legal only because an exact Version never changes (K2). Origin gzip stays
cheap and universal; brotli belongs at the edge.

### K10 — Versioned realm infra replacing github+npm+esm.sh

Not a task. It is what K1–K9 add up to. Tracked as the exit criteria, not as
a change list.

### K11 — Base realm via Deck

| File | Change |
| --- | --- |
| `runtime-common/constants.ts:11` | `baseRealm` stops being a hardcoded virtual URL |
| `host/app/services/network.ts:78` | the `cardstack.com/base` → real URL mapping becomes an ordinary decklist entry |

Zero new files — which understates it. **The blast radius is every realm.**
118 `card-api` imports and 86 `string` imports in one workspace mirror alone,
and the RRI prefix means the source does not change at all; only the target
does, and it gains a Version.

**Sequence after K1.** Without restore, recovery from a bad base Version is
"roll the deployment".

**Open, and it is a protocol question:** can two realms pin different base
Versions and still exchange cards?

### K12 — Live agent monitoring in preview

| File | Change |
| --- | --- |
| `realm-server/` | **new** — `/_activity` read path |
| `runtime-common/realm.ts:733` | the adapter `subscribe`/`unsubscribe` contract already exists — activity rides it |
| `host/app/services/message-service.ts` | consume activity events |
| `host/app/…` | render into the existing preview |

Boxel starts ahead here: the live-event plumbing and a real preview canvas
already exist. This is the benefit with the best ratio of payoff to change.

### K13 — Review and patch tools over protocol data

**Content, not monorepo.** Once P2 exists, Versions, Steps, claims and notes
are readable data, and a review card is a card. The only monorepo dependency
is that the data is exposed over HTTP.

### K14 — Deck Pack with provenance and prune negotiation

| File | Change |
| --- | --- |
| `realm-server/handlers/handle-download-realm.ts:187` | `archiver` → the canonical pack writer; keep the streaming, auth, filename and unmounted-realm lookup |
| `realm-server/package.json` | drop `archiver` — one dependency, one call site |
| `realm-server/handlers/` | **new** — pack intake (read, verify, re-home, merge) |
| `runtime-common/` | **new** — P4, the classifier |
| `runtime-common/realm.ts` write path | merge-on-import writes through it |

**Intake is the larger half**, and it is the half that does not exist at all:
Boxel can write a zip and there is **no zip reader anywhere in the monorepo**.
Sizing this as "make the download a pack" underestimates it by most of the
work.

**Blocked on design, not engineering:** the prune negotiation. `bare` and
`hermetic` are the endpoints and need no conversation, so they ship first.

---

## 5. Adjacent: publishing

Not on the original list, but it is the same machinery and the first stage
needs no Deck at all.

| Stage | File | Change |
| --- | --- | --- |
| 1 | `realm-server/handlers/handle-publish-realm.ts:628` | replace the prerender fan-out with an `INSERT … SELECT` over `prerendered_html` + index rows, URL-rewritten via P4 |
| 2 | same, `:511` | `copy(sourceRealmPath, …)` → move a tag; the temp/backup/swap/restore path at `:507-528` deletes |
| 3 | `packages/postgres/migrations/` | re-key `prerendered_html` from `(url, realm_url, type)` toward content; two-phase, additive then removal |

Stage 3 also makes **remix cheap to render** — override 1 of 200 modules and
re-render only what depends on it. The `deps` column already carries a GIN
index for that containment query.

---

## 6. Ordering that respects the dependencies

```
P1  resolver                        small PR, no behaviour change     ← first
P4  absolute-reference classifier   two customers, no Deck needed
    publish Stage 1                 biggest standalone win
K3  vendoring + LibSpec             (outside monorepo, mostly)
K8  remix                           P1's acceptance test
K5  four verbs                      needs `extends` in Deck first
P2  Versions in the write path      the hinge — largest PR
K1  restore / checkpoint            falls out of P2
K4  boxel-cli 3-way                 ships with K1, not after
K2  cache classes  ─┐
P3  serve grammar  ─┴─ K9 minified variants
K11 base realm via deck             after K1, high blast radius
K12 live monitoring                 best payoff-to-change ratio
K14 pack: bare + hermetic           intake is the big half
K6  mirror job → K7 submission      content-led
K13 review tools                    content, needs only P2's data
```

---

## 7. What is *not* monorepo work

Worth stating, because it is a third of the list:

- the vendor pipeline and corpus migration (K3) — hosted deck
- LibSpec instances (K3) — catalog content
- the submission workflow card (K7) — catalog content
- review and patch tools (K13) — realm content
- `extends` in a decklist (K5, K8) — **Deck protocol**, and it is the next
  thing to settle in the deck repo
- the prune negotiation (K14) — Deck protocol, undesigned
