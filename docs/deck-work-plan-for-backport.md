# Work plan: make the backport a one-way port

**Status: PLAN** (2026-08-09). Branch: `deck/backport-ready`. The deck-repo counterpart to
[`deck-boxel-monorepo-change-register.md`](deck-boxel-monorepo-change-register.md),
which lists what changes inside `cardstack/boxel`.

---

## 0. The principle

> Every decision settled here is a decision Boxel does not have to make in
> review.

A backport that needs round trips — "what should happen when two overrides
collide?", "is this URL a dependency or data?", "does a published realm get
its own history?" — is a backport that stalls in a monorepo PR where the
answer is expensive to change and the reviewers have the least context.

So the work here is not "finish Deck". It is **remove every question the
monorepo PR would otherwise have to ask.**

### The test for done

Three checks, all of them falsifiable:

1. **The monorepo PR can be described without the word "design."** Every
   change is "call this function", "mount this handler", "thread this
   argument".
2. **Every algorithm the monorepo needs is imported, not reimplemented.**
   Resolution, tree identity, merge, classification, pack read/write.
3. **`deck conform` can be pointed at the realm server** and say yes or no.
   Without that, "Boxel implements Deck" is an opinion.

---

## 1. Work items, in order

### W1 — `extends` in a decklist  ▸ **first**

**What.** A decklist may name a parent Version and override entries;
unnamed entries inherit.

**Why first.** Three things reduce to it and none of them can start without
it: remix (K8), the four verbs (K5), and publish-as-overlay — a published
realm is the source tree with `/realm.json` overridden, which is the same
mechanism. Today each would be designed separately, in three different PRs.

**Decisions to settle, not just code:**
- resolution order, and whether a child may *remove* a parent entry
- conflict rule when a parent's scope and a child's import disagree
- depth limit, and whether a chain may fork
- whether `extends` may name a tag or only an exact Version (L4 says the
  latter — inheriting from something movable is a promise nobody can keep)

**Done when:** the resolver handles inheritance, conformance covers it, and a
demo remixes a deck by overriding one entry.

### W2 — the absolute-reference classifier

**What.** `(string, decklist) → leave | rebind | rewrite`. Pure, browser-safe.

**Why here and not in the monorepo.** I originally put this in
`runtime-common`. That was wrong: what counts as a declared dependency is a
decklist question, so it is protocol. It has three customers — pack intake,
publish Stage 1, realm import — and if it lives here they share one tested
implementation instead of two.

**Done when:** given `boxel-catalog`'s own files it leaves
`./catalog-app/catalog`, rebinds `https://cardstack.com/base/realm-config`,
and does not touch `https://boxel-images.boxel.ai/icons/Letter-c.png`. That
last one is the test that matters — a classifier that corrupts asset URLs is
worse than no classifier.

### W3 — the provenance block

**What.** A written format, a writer and a reader for what a pack carries
about itself: source URL, `treeHash`, pinned decklist, per-file digests,
prune record, toolchain generation, source Version.

**Why.** Pack intake is the larger half of K14 and cannot begin against a
prose list. This is also what makes merge-on-import a three-way merge, since
the source Version is the ancestor.

### W4 — pack modes `bare` and `hermetic`

**What.** The two endpoints of the prune spectrum, both implementable with no
negotiation.

**Why.** They cover backup and archival — what the realm download is actually
used for — and they prove the model while `negotiated` stays undesigned.

**Done so far:** `planPack` in `@cardstack/deck/pack-mode` decides what each mode
carries and prunes, and emits the provenance block's `pruned` record.
**Not done:** wiring `hermetic`'s byte carriage to the existing vendoring in
`vendor.ts` / `vendor-tree.ts`. The decision is the part the backport needed
settled; the copying is machinery that already works and can be connected
when a caller wants a hermetic pack for real.

### W5 — conformance against a foreign implementation

**What.** `deck conform <base-url>` as a black box over HTTP, runnable
against something that is not this server.

**Why.** It is check 3 of the test for done, and it is the only artifact that
converts "we ported it" into a CI gate the monorepo can keep passing.

### W6 — one installable entry, with types

**What.** Replace 25 module-shaped subpaths with entries split by runtime.

**Why.** Check 2. Boxel wants a contract, not an archaeology dig.

**Done: two entries, not one.** `@cardstack/deck` is the browser-safe
surface and `@cardstack/deck/node` adds the filesystem half. One entry was
the wrong target — the package has two audiences with different runtimes,
and the root goes to the browser because a missing export is a signpost
while an accidental `node:fs` in someone's bundle is a morning.

**`.d.ts` struck from the plan.** `@cardstack/runtime-common` ships raw
`.ts` — no build, no `types` field, no `dist` — and host and realm-server
consume it as `workspace:*`. Deck already matches. Declarations would be
dead weight and lossier than the source. (Boxel splits browser from node
with conditional `imports` rather than separate entries; explicit entries
are the deliberate divergence, because a condition makes the split
invisible and this one should fail loudly.)

### W7 — the lean trim

**What.** Move `vendor-npm`, `derive`/minify and the rebase daemon to Tools.

**Why.** Vendoring runs outside the monorepo in Release 1b, so none of it is
in the first Boxel drop. Smaller cone, smaller review.

**Done.** `@cardstack/deck-tools` holds `npm`, `vendor-npm`, `vendor-map`,
`vendor-tree`, `derive`, the depot cooldown policy and the rebase daemon.
Core is down to 26 modules from 30, its only runtime dependency is `semver`
(`terser` left with `derive`), and `packages/core/src` now contains no
`fetch`. The layering `core ← server ← tools ← cli` is two lint rules, both
negative-tested. Full suite **374 pass / 0 fail** against a 373 baseline —
the extra test is a new one, see below.

Two findings the move surfaced, both written up in
[`deck-boxel-backport-plan.md`](deck-boxel-backport-plan.md) §7.6:

- **`walkSourceGraph` was in the wrong package.** Conformance calls it to
  check L6 — "a sealed deck resolves everything it contains" — and it knows
  nothing about npm. It is now `core/src/source-graph.ts`.
- **The server imported the module that writes proposals.** `/…/_offers`
  called `rebasePass({ dryRun: true })`, so `applyRebase` was in the serve
  path's import graph, held back by a flag. Planning is now
  `server/src/offer-survey.ts` and applying is the daemon in Tools, built on
  the same plans. Read-only became structural rather than conditional —
  which is W9, arriving here instead.

**No regression, checked rather than assumed.** Every baseline test is
accounted for: core 247 → 200 (52 moved out, 5 in from the graph split),
tools 0 → 49, server 84 → 83 (2 daemon tests to Tools, 1 new endpoint test
for the survey). Both new lint rules were verified by injecting a violation.
The `contribute-to-codelist` demo was rebuilt end to end (`RESET=1`) so the
daemon's real write path ran — dry run, apply, convergence, conflict left
untouched — and every package specifier in every demo was re-resolved.

### W8 — naming, in one pass

**What.** Decide the published name, then rename everything at once.

**Why.** Recommendation is `@cardstack/deck` — a scope Cardstack already
publishes to, and the name it will have *after* it moves into the monorepo,
so relocating is a directory move with no consumer churn. Doing it in one
pass keeps it out of every other diff.

**Decided (2026-08-09): `@cardstack/deck`.** A scope Cardstack already
publishes to, and the name Core will keep after it moves into the monorepo,
so relocating becomes a directory move with no consumer churn. Do the rename
before W6's entry consolidation, or the same import sites get touched twice.

### W9 — the L12 amendment

**What.** Read-only serving applies to the Deck *surface*, not the process.

**Why.** As written, the law would forbid the realm server from existing — a
realm must accept writes. Better fixed here than discovered in review.

**Done.** L12's bullet was "writes → refused; the server is read-only". It
now reads "refused **on the Deck surface**: no request may change what a
later request returns", with a section saying why. The old wording was not
merely imprecise — it was false of the reference implementation too, since
`deck serve` runs the watcher (a Version per save) and can run the rebase
daemon in the same process.

Two consequences that used to look arbitrary now follow from the law: a
work-in-progress claim is a file under `.deck/claims/` rather than a `POST`,
and the offer queue is reported by an endpoint that can only plan.

**The amendment is tested, not just written.** The conformance check was
`writes are refused` — four methods, four 4xx. It is now `writes are refused,
and change nothing`: it reads the body first and re-reads it after the four
refusals. "Is this process read-only?" has no answer; "did a request through
this door change what the next one returns?" does, and that is the question
the amended law actually asks. Both halves inverted and watched to fail: a
server whose method gate lets `PUT` through (58/1), and a `before` value
perturbed so the re-read compares against bytes that never existed (58/1).
Restored: 59 passed, 0 failed, 3 not applicable.

### W10 — two proofs

**What.**
- The scopes demo: one card on `three@0.169.0` whose dependency resolves
  `0.160.0`, both live, no query string, no `@ts-expect-error`.
- The streaming spike: can a pack be hashed while streamed (incremental hash
  over canonical order, or two-pass)?

**Why.** The first is P1's acceptance test, and building it here means the
monorepo PR arrives demonstrated rather than argued. The second decides the
512 MB / 10,000-entry ceiling, and therefore whether `bare` mode can replace
the download button outright or must coexist with it.

---

## 1a. Embroider lessons applied

From `deck-embroider-lessons.md`, read against the real repo at
`~/Projects/embroider`:

| | Lesson | State |
| --- | --- | --- |
| §4 | Dynamic import policy — only string-literal `import()` | **done.** The lexer now counts unanalyzable calls instead of skipping them, and conformance binds it under L6. Found and fixed a worse bug on the way: `import('./p/' + x)` was being recorded as a real edge to `./p/`. |
| §3 | Compat out of `@cardstack/deck-server` | **done.** Lint rule over `packages/server/src/**`, verified to fire. |
| §7 | Catalog verbs pull by default | already the model — `extends` (W1) is pull; remix is the copy-on-write escape hatch. |
| §1 | Scenario suite over ugly real packages | not started. The highest-leverage remaining item. |
| §5 | Graph performance budget in CI | not started. |
| §6 | Tree-diff the watcher hot path | not started. |
| §2 | Native-deck checklist | not started (doc). |
| §8 | Ambiguity resolution table | not started (doc + tests). |

The two that landed were the two that were *enforceable*. The rest are
either already true or need a body of fixtures behind them.

---

## 2. Not in scope

- **The prune negotiation.** Undesigned, and `bare`/`hermetic` do not need it.
- **Anything in the monorepo.** This plan exists so that work is mechanical.
- **Hub and examples**, except the two proofs in W10.

---

## 3. Order and why

```
W1  extends                  unblocks three Boxel items; a decision, not a build
W2  classifier               three customers; earliest work that ships without Deck
W3  provenance block         intake cannot start without it
W4  bare + hermetic          proves the pack model
W10 proofs                   can run alongside from W1 onward
W5  foreign conformance      the CI gate
W6  one entry + types  ─┐
W7  lean trim          ─┼─   packaging, best done together
W8  naming             ─┘
W9  L12 amendment            small, do it whenever
```

W1 and W2 are the two that other work waits on. Everything from W5 down is
packaging — real, but it does not block Boxel from starting.

---

## 4. Status

| | Item | State |
| --- | --- | --- |
| — | Browser-safe Core surface, lint-enforced | **done** |
| — | Resolver takes the importer | **done** |
| W1 | `extends` | **done** — core, server, conformance, `examples/remix` |
| W2 | absolute-reference classifier | **done** — `@cardstack/deck/classify`, conformance L11 |
| W3 | provenance block | **done** — `PackProvenance`, `intakeReadiness`, conformance L11 |
| W4 | pack modes `bare` / `hermetic` | **decision layer done** — `planPack`; byte carriage reuses `vendor.ts`, not yet wired |
| W5 | foreign conformance | **done** — `--export` + at-rest excluded from foreign runs |
| W6 | entries | **done** — `@cardstack/deck` (browser) + `/node`. `.d.ts` struck: Boxel consumes TS source (see W6 note). |
| W7 | lean trim | **done** — `@cardstack/deck-tools`; Core 26 modules, `semver` only |
| W8 | naming → `@cardstack/deck` | **done** |
| W9 | L12 amendment | **done** — law reworded, conformance now re-reads the bytes after the refusals; the serve path also cannot reach `applyRebase` (W7) |
| W10 | two proofs | scopes proof partly covered by `examples/remix` |
| — | Embroider §3 and §4 | **applied** (see §1a) |
