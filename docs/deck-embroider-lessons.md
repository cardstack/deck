# Improvements from Embroider — direction, not a port

**Status: GUIDANCE** (2026-08-09). Short list of changes and principles
Deck should adopt, drawn from Embroider’s experience with real-world
JS/ESM and build performance. Not “use Embroider”; use what eight years
of ecosystem contact taught.

Companions: `deck-laws.md`, `deck-efficient-delivery-spec.md`,
`deck-core-backport-split.md`, `deck-vendor-source-mode.md`.

---

## Principles (nail these first)

1. **Publication format ≠ authoring format.** Pain belongs at seal /
   vendor / lock time. The browser only ever sees static, pull-based ESM
   and an import map.
2. **Native Deck is cheap; foreign intake is gated.** Do not grow a
   forever compat layer in the serve path. Refuse ambiguity (L11).
3. **Pull, don’t push.** Consumers pin and import; nothing injects itself
   into another deck’s tree at runtime.
4. **Static edges are a performance feature.** Preload, hermeticity, and
   cacheability require literal specifiers and a known graph.
5. **Prove against messy graphs, not only demos.** Scenario fixtures beat
   green unit tests for evolution pressure.

---

## Suggestions to implement

### 1. Scenario suite (highest leverage)

Add `examples/scenarios/` or `packages/conformance/scenarios/` that vendor
ugly real packages and assert lock + serve + preload:

- dual `exports` / browser vs module vs main  
- deep import paths, CSS side-effect imports  
- large module graphs (keep three.js-class cases)  
- optional / missing peers → hard refuse, not warn  

Wire into CI beside `deck conform`. This is Embroider’s scenario-test
lesson in Deck clothes.

### 2. Freeze a “native Deck package” checklist

One page (laws companion): a sealed deck **must** have ESM-only public
entry, literal `import`/`import()`, resolved lock, no runtime reach to
npm/CDN (L6). Anything else is **intake work** (vendor), not serve work.

Stops casual “just make the server understand this package shape.”

### 3. Keep compat out of `@deck/server`

All npm/CJS/`exports` normalization stays in vendor / CLI / Tools.
Serve only: live tree, `@exact`, tags, digests, maps, Timeline.

If a behavior needs “best effort like ember-auto-import,” it is a
vendor flag with an explicit lossy report — never a silent serve path.

### 4. Dynamic import policy (write it down)

Document and enforce in `verify-links` / lock: only **string-literal**
`import()` is supported for graph/preload. Non-literal → refuse at seal
(with override), same motivation as Embroider’s analyzability rule.

### 5. Graph performance budget in conform or bench

One CI or `pnpm` bench that records for a sealed app:

- module count in closure  
- preload link count vs budget  
- cold-request count (or recorded waterfall proxy)  

Fails or warns when a change blows the budget. Makes “waterfall is
real” a regression gate, not a doc claim.

### 6. Tree-diff the watcher hot path

Ensure auto-publish / seal work is driven by **changed paths** (and
stable cache keys), not full-store or full-depot walks on every settle.
Embroider’s incremental instinct: don’t redo work the digest already
proves unchanged.

### 7. Catalog verbs = pull by default

In consumption docs and Hub copy: **install / use / import** (pin) are
default; **remix** (copy) is the escape hatch with provenance. Aligns
with Embroider’s pull-vs-push lesson and Deck’s remix-without-copy fork
model.

### 8. Ambiguity resolution table

Small doc + tests: when `exports`, `main`, and a bare specifier disagree,
Deck picks **one** rule and refuses the rest. No “usually works.”
Embroider’s cost was years of ambiguous invokables; don’t reopen that
class of bug in lock/vendor.

---

## Explicit non-goals (from the same lessons)

- Do not run Webpack and Vite eras in parallel as identity. One serve
  grammar; derived minify/bundle later if ever.  
- Do not take Ember-specific resolvers or macros into Core.  
- Do not grow Hub features as a substitute for scenario coverage.

---

## Success signal

A new contributor can tell whether a change belongs in **vendor/lock**,
**serve**, or **Tools**, and CI fails when real-package scenarios or the
graph budget regress — before Hub UX papers over it.
