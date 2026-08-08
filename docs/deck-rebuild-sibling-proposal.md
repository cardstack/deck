# Proposal: `rebuild-v1` — rebuild siblings (git + build ≠ npm bytes)

**Status: PROPOSAL** (2026-08-08). Companions:
`packages/core/src/derive.ts` (minify `derivedFrom` / `derivation` pattern),
`deck-vendor-source-mode.md` (`map` / `source` / `repo` carriages),
`deck-laws.md` (L8 provenance, L9 endorsement, L10 inheritance, L11 fail
closed), `deck-pack-equivalence.md` (derived packs carry `derivedFrom`).

## 0. Problem

Some npm packages ship **built** `dist/` with **no source map**
(ProseMirror, CodeMirror, …). Deck can still record `repository` +
`gitHead` and clone author source — but a runnable tree needs a **build**,
and that build often produces bytes that **do not** match the registry
tarball.

Two false stories to avoid:

1. **“Same as the npm package”** — different `treeHash` means different
   identity. L10 must not transfer endorsements.
2. **“Just a fork”** — a product fork is an intentional edit/proposal.
   A rebuild that drifts is failed (or unattempted) **reproduction**, not
   a contribution branch.

We need a third lineage: **rebuild sibling** — same claimed upstream
intent, new sealed tree, honest about match/mismatch.

### Non-goals

- Replacing npm integrity checks when the tarball is what you vendor.
- Assuming builds are reproducible (they are a per-package experiment).
- Using Git tree OIDs as Deck `treeHash`.
- Offer/rebase UX for rebuilds (unless someone later forks the sibling to
  edit).
- Running the compiler inside a Cloudflare Worker isolate (§4).
- Pretending ProseMirror-class packages support three.js-style edit-in-`src`
  without a transform (§5).

### Goal

> Encode git→build seals as `derivedFrom` + `derivation.kind = rebuild-v1`,
> with an explicit `match` bit, so locks and signatures cannot confuse a
> sibling with the registry artifact.

---

## 1. Ruling

> **A rebuild is a derivation, not a fork and not the npm tree.**
> It MAY record the npm seal (or npm coordinate) it tried to match.
> `match: "exact"` means file hashes under comparison agreed.
> `match: "mismatch"` means the rebuild is a **sibling**: sealable,
> pin-able, never a silent substitute for `name@version` on the registry.

This sits next to minify derivation (`minify-v1` in `derive.ts`):

| Kind | Intent | Typical `derivedFrom` |
| --- | --- | --- |
| `minify-v1` | smaller projection of a sealed tree | source package treeHash |
| `rebuild-v1` | regenerate publish outputs from git | npm package treeHash (if sealed) |

Same machinery: tool pin, canonical options, `verifyDerivation` re-runs.

---

## 2. Record shape (normative sketch)

Carried in the rebuilt deck’s import map / package entry (same place
minify writes `derivedFrom`), and summarized in `?meta` / store browser.

```json
{
  "derivedFrom": "<treeHash of sealed npm carriage, if any>",
  "derivation": {
    "kind": "rebuild-v1",
    "tool": "pm-buildhelper@0.1.2",
    "options": {
      "npm": "prosemirror-model@1.25.11",
      "npmIntegrity": "sha512-…",
      "git": "https://code.haverbeke.berlin/prosemirror/prosemirror-model.git",
      "gitHead": "09098e3b00a2e36843040bcde1b7af9adf76816e",
      "recipe": ["npm ci", "npm run prepare"],
      "compare": ["dist/index.js", "dist/index.cjs"],
      "match": "mismatch",
      "comparedAt": "optional ISO — omit from identity-facing canonical form"
    }
  }
}
```

### Field rules

| Field | Rule |
| --- | --- |
| `kind` | Exactly `rebuild-v1` |
| `tool` | Name@version of the **pinned** builder that ran (not “latest”) |
| `options` | Canonical key order (same helper as minify) so verify is stable |
| `npm` | Registry coordinate claimed as intended equivalent |
| `npmIntegrity` | Registry dist integrity when known (tarball claim, not Deck identity) |
| `git` / `gitHead` | Required for rebuild-from-git |
| `recipe` | Ordered argv/shell steps; must be enough to re-run offline once tools are pinned |
| `compare` | Paths whose sha256s decided `match` (usually `dist/**`) |
| `match` | `"exact"` \| `"mismatch"` \| `"uncompared"` |

**Identity:** `treeHash` hashes the **rebuilt tree bytes only**. The
derivation record is sealed *inside* that tree (as with minify) so it is
part of what was published — but two rebuilds with different `match`
notes and identical file payloads would still collide on content; do not
put wall-clock into any file that enters the treeHash. Prefer `match` +
tool pins only inside the sealed map entry that is part of the tree.

If `comparedAt` is ever stored, keep it **out** of the hashed packlist
files (server annotation / separate sidecar) — same discipline as pack
provenance clocks.

### When `derivedFrom` is absent

Allowed: rebuild published without a prior npm seal in the store. Then
`options.npm` + `npmIntegrity` carry the registry claim; `derivedFrom`
omitted. Verify can still fetch the tarball **only** under an explicit
`--online` policy (L11 offline default: refuse online-only checks).

---

## 3. Match semantics

### 3.1 What is compared

Default: sha256 of each path in `compare` (logical file bytes), npm
carriage vs rebuild carriage.

Not compared unless asked:

- whole `.tgz` integrity (npm pack order / extra files),
- `node_modules` of the build environment,
- source maps absent from either side.

### 3.2 Outcomes

| `match` | Meaning | Lock / resolve |
| --- | --- | --- |
| `exact` | Compared paths byte-identical to npm seal (or tarball extract) | May advertise “verified rebuild of npm@…”; still a **distinct** deck if published separately — usually you just keep the npm seal |
| `mismatch` | At least one compared path differs | **Sibling.** Must use its own name/version in maps. Never aliased as if it *were* the npm treeHash |
| `uncompared` | Build ran; no compare step | Treat like mismatch for substitution; OK for “I need runnable dist from git” demos |

### 3.3 Not a sourcemap

| | Source map (`map` mode) | Rebuild sibling |
| --- | --- | --- |
| Evidence | Inside published artifact | Re-execution claim |
| Runnable | No (by design) | Yes, if `dist/` is what you sealed |
| Equals npm bytes | N/A (explains them) | Only if `match: "exact"` |

Matching npm package **integrity** (whole `.tgz`) is harder than matching
compared `dist/` file hashes and is **not** required for `match: "exact"`.
Exact means the compared logical files agree — Deck identity grain, not
npm pack quirks.

---

## 4. Where the compiler runs

`rebuild-v1` needs `git`, a filesystem, and Node (or whatever the recipe
pins). That is a **build host**, not an edge isolate.

| Surface | Can run `recipe`? | Role |
| --- | --- | --- |
| Laptop / CI VM / container | **Yes** | Clone, build, compare, seal |
| Cloudflare Worker (V8 isolate) | **No** | May orchestrate (queue a job) or **serve** the sealed sibling; must not pretend to compile |
| Cloudflare (or other) edge cache | N/A | Cache immutable sibling URLs once sealed |

**Human or AI** is needed only to **land the first pinned recipe** (which
tool, which steps, what to `compare`). After `tool` + `recipe` + `gitHead`
are sealed in the derivation record, re-run and `verifyDerivation` are
mechanical — no model in the loop. A Worker never substitutes for that
host; it can only trigger one.

---

## 5. Editing without a rebuild (ProseMirror-class packages)

Packages in this bucket ship **`src/` (often TypeScript) + runnable
`dist/`**, with **no** source map and with `exports` pointing at `dist/`.
They are not like three.js / Leaflet (`source` mode: edit the modules the
browser loads).

| What you change | Rebuild / `rebuild-v1`? | What it is |
| --- | --- | --- |
| **`dist/*.js`** (what `exports` loads) | **No** | Live/`deck serve` can pick it up. A **dist fork** — intentional edit of generated JS. Use `deck fork` (or ordinary publish), not `rebuild-v1`. Honest, demos fine; painful to upstream. |
| **`src/*.ts`** | **Yes** (full recipe) or live transpile | Browser does not run package entry as TS. Full recipe → may mint `rebuild-v1`. Live transpile = transform zone (short cache, not `immutable`) — not a sibling of npm and not map mode. |
| Expect edit-in-author-source like three | **No path** without transform | Prefer `source`/`map` when the package allows; otherwise choose dist-fork vs rebuild deliberately |

**Do not conflate:**

- **`rebuild-v1`** — regenerate `dist` from git; lineage to npm; `match` bit.
- **Dist fork** — change the bytes you already run; product fork/offer story.
- **`source` / `map` vendor** — different carriages; use when they apply so
  you never enter this bind.

---

## 6. Relationship to fork / offer / vendor modes

```
npm tarball ──vendor──► seal A (treeHash_npm)
                              │
git@gitHead ──build──► seal B (treeHash_rebuild)
                              │
                              ├─ match exact     → B verifies A’s dist
                              └─ match mismatch  → B is rebuild sibling of A
```

- **`deck fork`** — intentional edit (including **dist forks**); offer/rebase
  story; base in map for merge. Do **not** use for rebuild-only seals.
- **`vendor --mode repo`** — carriage that yields git tree; build on a
  build host (§4) may mint `rebuild-v1`.
- **`vendor --mode map` / `source`** — unchanged; prefer those when they
  apply (Leaflet, three, mapped bundles) so §5 never arises.

Alias pattern when a sibling must stand in at runtime (L7):

```json
"dependencies": {
  "prosemirror-model": "lib/prosemirror-model-rebuild@0.0.1"
}
```

The key stays the import specifier; the value names the **sibling deck**.
Provenance on that deck points at npm + gitHead + `match: "mismatch"`.

---

## 7. CLI / verify sketch

```
deck vendor prosemirror-model@1.25.11 --mode repo --rebuild
# clones gitHead, runs recipe with pinned tool, seals tree B,
# compares dist/* to npm extract, writes derivation

deck verify-derivation --store … --name lib/prosemirror-model-rebuild --version 0.0.1
# re-runs recipe; requires same treeHash_rebuild (L11)
```

Version shape for published siblings: prefer an explicit deck name
(`…-rebuild`) or prerelease `0.0.1-rebuild.0` — never a floating tag that
looks like the upstream semver line. (Same lesson as `1.2.3-min.0` for
minify.)

`deck lock --check` / `verify-links`: if a pin points at a rebuild sibling,
require the derivation record present; if something claims to *be* npm
`@1.25.11` but carries `match: "mismatch"`, **refuse**.

---

## 8. Laws interaction

| Law | Effect |
| --- | --- |
| L1 | Rebuild has its own `treeHash`; zip/build env not in identity |
| L3 | Publishing the sibling is a pointer once sealed |
| L8 | Provenance must record npm + git + tool (checkable form) |
| L9 | Signatures bind `treeHash_rebuild`, not the npm name |
| L10 | Mismatch ⇒ no endorsement inheritance from npm seal |
| L11 | Unpinned tool / unreproducible recipe ⇒ refuse verify; online tarball re-fetch is opt-in |
| L12 | Live transpile of `src/` (if offered) is not `immutable`; sealed siblings are |

---

## 9. Build slices

| Slice | Deliverable |
| --- | --- |
| R1 | Widen `Derivation.kind` union: `minify-v1` \| `rebuild-v1` (shared canonical options + verify harness) |
| R2 | `deck vendor --mode repo --rebuild` (or `deck rebuild`) on a **build host** (§4), writing the record |
| R3 | Compare step → `match`; store browser / `?meta` surfaces sibling badge (not “fork”) |
| R4 | Conformance: mismatch cannot satisfy a lock that names the npm treeHash; exact rebuild verify re-runs |
| R5 | Docs/UI copy: dist-fork vs rebuild sibling vs source/map (§5) |

Order: **R1 → R3 (record + display) → R2 → R4 → R5**. Recording mismatch by
hand is enough to teach the semantic before automation is perfect.

---

## 10. Open questions

1. **Default deck naming** — `lib/<npm>-rebuild` vs publisher-scoped
   `me/prosemirror-model@…-rebuild.0`. Lean: explicit suffix name so ranges
   on upstream cannot select it.
2. **Compare set** — default `dist/**` vs `files` from package.json.
3. **Partial exact** — some paths match, some don’t: still `mismatch`,
   with a machine-readable diff list in `?meta` (not in treeHash).
4. **Whether `exact` rebuilds are published at all** — usually no; the
   npm seal is enough. Exact is a **verify result**, not a reason to dual
   publish.
5. **Dist-fork provenance** — optional `editedFrom: <npm treeHash>` on an
   ordinary fork of vendored `dist/`, distinct from `rebuild-v1`.

---

## 11. Success criteria

- [ ] A ProseMirror (or similar) rebuild can seal with `kind: rebuild-v1`
      and `match: "mismatch"` without claiming npm’s `treeHash`
- [ ] Locks cannot treat the sibling as the npm seal
- [ ] `verifyDerivation` re-runs the pinned recipe offline on a build host
- [ ] Deckbook / browser show “rebuild sibling of npm@…” not “fork of …”
- [ ] Docs state Workers do not compile; dist edits ≠ rebuild (§4–§5)
- [ ] Minify derivation remains unchanged (`minify-v1`)

---

## 12. Summary

When git+build disagrees with the registry, Deck publishes a **rebuild
sibling**: new identity, `derivedFrom` + `rebuild-v1`, explicit `match`.
Like a fork in graph shape; unlike a fork in product meaning. The compiler
runs on a laptop/CI/container (not a Worker); a human or AI pins the recipe
once, then verify is mechanical. On-the-fly edits without rebuild mean
**patching `dist/`** (a dist fork) — not author `src/`, and not
`rebuild-v1`. Exact reproducibility is earned per package; mismatch is a
first-class honest outcome, not a failed vendor.
