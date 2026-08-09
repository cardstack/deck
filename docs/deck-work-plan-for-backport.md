# Work plan: make the backport a one-way port

**Status: PLAN** (2026-08-09). The deck-repo counterpart to
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

### W5 — conformance against a foreign implementation

**What.** `deck conform <base-url>` as a black box over HTTP, runnable
against something that is not this server.

**Why.** It is check 3 of the test for done, and it is the only artifact that
converts "we ported it" into a CI gate the monorepo can keep passing.

### W6 — one installable entry, with types

**What.** Collapse 25 subpath exports into one package entry. Ship `.d.ts`.

**Why.** Check 2. Boxel wants a contract, not an archaeology dig — and the
shipped types are what retire `@ts-expect-error` at the card boundary.

### W7 — the lean trim

**What.** Move `vendor-npm`, `derive`/minify and the rebase daemon to Tools.

**Why.** Vendoring runs outside the monorepo in Release 1b, so none of it is
in the first Boxel drop. Smaller cone, smaller review.

### W8 — naming, in one pass

**What.** Decide the published name, then rename everything at once.

**Why.** Recommendation is `@cardstack/deck` — a scope Cardstack already
publishes to, and the name it will have *after* it moves into the monorepo,
so relocating is a directory move with no consumer churn. Doing it in one
pass keeps it out of every other diff.

**Blocked on:** confirmation that publishing is intended at all. `deck` on
npm is someone else's.

### W9 — the L12 amendment

**What.** Read-only serving applies to the Deck *surface*, not the process.

**Why.** As written, the law would forbid the realm server from existing — a
realm must accept writes. Better fixed here than discovered in review.

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
| — | Browser-safe Core surface, lint-enforced | **done** (`deck/core-boundary`) |
| — | Resolver takes the importer | **done** |
| W1 | `extends` | **done** — core, server, conformance, `examples/remix` |
| W2 | absolute-reference classifier | **done** — `@deck/core/classify`, conformance L11 |
| W3 | provenance block | **done** — `PackProvenance`, `intakeReadiness`, conformance L11 |
| W4 | pack modes `bare` / `hermetic` | next |
| W5–W10 | | not started |
