# deckd — Timeline + build daemon

**Status: RULING + OPEN QUESTIONS** (2026-08-09).

Deck-owned long-lived process that attaches a **Timeline** to a depot and
(optionally) runs **derived build work** (esbuild, AMD, and friends) so the
realm server / `deck serve` HTTP surface stays thin and read-only.

Companions: [`deck-at-rest.md`](deck-at-rest.md) (layout),
[`deck-step-version-vocabulary.md`](deck-step-version-vocabulary.md),
[`deck-laws.md`](deck-laws.md) (L12 surface),
[`deck-efficient-delivery-spec.md`](deck-efficient-delivery-spec.md) (A2 minify),
[`deck-embroider-lessons.md`](deck-embroider-lessons.md) (pain at seal time),
[`deck-boxel-backport-for-team.md`](deck-boxel-backport-for-team.md) (campaign).

jj-lib source used for spikes / dependency work:
`/Users/chris/Projects/jj` (upstream [`jj-vcs/jj`](https://github.com/jj-vcs/jj)
`lib/`). That tree is **not** where AMD or esbuild live.

**POC repo:** [`christse/deckd-poc`](https://github.com/christse/deckd-poc) —
historyd-compatible HTTP, Timeline under `.deck/timeline`, jj via CLI first
(`jj_lib_notes` for the in-process path).

---

## 0. Why

Today:

| Concern | Where it lives |
| --- | --- |
| Versions / claims | `<depot>/.deck/store`, `.deck/claims` |
| Timeline Steps | top-level `<depot>/.jj/` via jj CLI, or external **historyd** |
| Boxel edit history | often a separate `.boxel-history` git story |
| AMD / expensive transform | Boxel realm-server lifecycle (request-adjacent) |
| Minify derived releases | Tools/`derive`, **terser** (A2) |

Problems: two (or three) hidden directories; Timeline backend unsupervised;
compile cost on the wrong process; serve path tempted to grow Embroider-shaped
compat forever.

**deckd** is the grown-up form of historyd: one supervised daemon, one
machinery directory, build pain at settle/seal time — not on GET.

---

## 1. Rulings (settled)

### R1 — Product name and ownership

- Product speak: **deckd**.
- Deck owns the binary and its RPC. jj upstream stays a **library dependency**
  (jj-lib), not a long-lived full-repo fork, unless a lib patch is unavoidable.
- Prefer: crate depends on jj-lib from crates.io or a pinned path to
  `/Users/chris/Projects/jj/lib`. Deck ships `deckd`; it does not become
  “Cardstack’s jj distribution.”

### R2 — Roles of deckd

deckd may:

1. **Timeline** — ensure repo, seal Step, list, file-at, restore-plan
   (today’s historyd surface, gaps closed — see §3).
2. **Build plane** — run named, versioned **derived** transforms (esbuild
   graph work, AMD, etc.), cache outputs under `.deck/build/`.
3. **Notify** — tell the watcher / realm server that a Step or build artifact
   is ready (same event family as today’s live loop; no second bus required).

deckd must **not**:

- Become the public Deck HTTP origin (L12: that surface stays read-only).
- Silently rewrite `@exact` **identity** trees.
- Replace the content-addressed **Version** store with jj/git objects.

### R3 — `.deck` is the only hidden machinery folder

Target layout:

```text
<depot>/
  <publisher>/<package>/…          live content (hashed + served)
  .deck/
    store/                         Versions (unchanged role)
    claims/                        WIP claims
    policy.json                    optional
    timeline/                      jj repo / Timeline state  ← replaces top-level .jj
    build/                         derived cache (esbuild, AMD, …)
```

- No top-level `.jj`.
- No `.boxel-history` once Timeline is attached (Boxel CLI/checkpoints speak
  deckd / realm Timeline APIs only).
- No colocated `.git` in the depot (existing no-gitlink law stands). Outer
  monorepos must never see a gitlink because Timeline lived at depot root.

`DEFAULT_IGNORE` / tree-hash / UI C4 already treat `.deck` as machinery; nesting
Timeline under it keeps Steps out of identity hashes.

**Migration:** on `ensure`, if `<depot>/.jj` exists and `.deck/timeline` does
not, move or re-init per a one-shot tool; document in Hub/doctor. Do not
support two Timeline roots forever.

### R4 — Identity vs derived (AMD / esbuild)

> **`@exact` Version identity is author source** (or whatever the publisher
> sealed as the source tree). AMD, esbuild graph transforms, and minify
> projections are **derived**: keyed by
> `(source treeHash | step tip, toolchainId, transform set)` and recorded so
> they can be re-run or refused (L11 / A4 spirit).

esbuild is allowed for **throughput of transform / graph work**. It does
**not** silently overturn A2 for release minify: minify remains a separately
pinned tool in the derivation record (terser today). Mixing “we used esbuild
because AMD is fast” into an unverifiable minify claim is forbidden.

### R5 — When build runs

**Recommendation (default):** on settled save / before that tip is served for
transform-needing modules — **ensure-built**, path-invalidated cache (not
full-depot rebuild every keystroke). See Q2.

Serving GET never runs AMD “for the first time” on the realm-server hot path;
at most it waits on deckd or returns a clear not-ready.

### R6 — L12 and process shape

- HTTP Deck / realm **surface**: read-only for what a later GET returns.
- deckd is a **sidecar** that may write under `.deck/` (and the live tree only
  via restore replay rules already defined for Timeline).
- Transforms are RPC to deckd (`/ensure-build`), not `PUT` handlers on the
  serve origin.

### R7 — Campaign fit

Not inside lean Core drop, resolver, or thin decklist verbs (PR 1 / 1b).
Treat as **Track D — Build**, after or parallel to Timeline slices:

| Slice | Outcome |
| --- | --- |
| **D0** | Layout only: Timeline under `.deck/timeline`; kill top-level `.jj` / `.boxel-history` |
| **D1** | Own supervised deckd Timeline (historyd contract + gaps) |
| **D2** | Build plane: esbuild + AMD derived cache; realm-server stops transforming |
| **D3** | Editable realms default to deckd; Versions-only remains for RO catalog mirrors |

Boxel can keep shipping **jj CLI in-image** until D1; same `HistoryBackend`
contract.

---

## 2. RPC surface (v1)

Timeline (compat with today’s historyd client in
`packages/history/src/historyd.ts`):

| Route | Body (sketch) | Result |
| --- | --- | --- |
| `POST /ensure` | `{ dir }` | `{}` — repo at `.deck/timeline` |
| `POST /seal` | `{ dir, message, actor? }` | `{ changeId }` |
| `POST /list` | `{ dir }` | `HistoryEntry[]` (incl. author when actor was set) |
| `POST /file-at` | `{ dir, revisionId, path }` | bytes or not found |
| `POST /file-list-at` | `{ dir, revisionId }` | paths — **close the CLI gap** |
| `POST /restore-plan` | `{ dir, revisionId }` | `{ writes, deletes }` |

Build (new):

| Route | Body (sketch) | Result |
| --- | --- | --- |
| `POST /ensure-build` | `{ dir, tip?, transforms[], toolchainId }` | `{ ready, artifactRoot \| digests }` |
| `POST /artifact-at` | `{ dir, key, path }` | derived bytes |
| `GET /build-meta` | query key | derivation record for verify |

Default listen: `http://127.0.0.1:8787` (today’s `DECK_HISTORYD_URL`);
`deck serve` stays on 8788. Env: `DECKD_URL` supersedes `DECK_HISTORYD_URL`
when both set.

---

## 3. Gaps vs today’s historyd (must close in D1)

| Gap | Today | deckd |
| --- | --- | --- |
| `actor` on seal | dropped | persisted; `list` shows author |
| `fileListAt` | absent | `/file-list-at` |
| Supervision | unsupervised sibling | started/supervised by `deck serve` / realm-server |
| Repo path | implicit `.jj` at `dir` | **`.deck/timeline` only** |

---

## 4. Open questions

For each: **recommendation**, then **other options** kept visible.

### Q1 — Where does the deckd crate live?

**Recommendation:** new repo or `deck` workspace path
`packages/deckd/` (Rust), depending on jj-lib via path/crates.io. TypeScript
in Deck keeps only the HTTP client (`HistoryBackend` + build client).

**Other options:**

- Soft-fork jj-vcs/jj and add a `deckd` binary crate upstream-shaped in that
  clone (`/Users/chris/Projects/jj`) — heavier merge tax.
- Keep using external jj-historyd forever and put only build in a second
  process — two daemons to supervise; rejected for product default.

### Q2 — When does AMD / esbuild run?

**Recommendation:** **ensure-built on settle** (debounced with Step seal),
invalidate by changed paths; publish/`@exact` may re-ensure with release
toolchain pin. Live tip serves derived when ready; identity Version remains
source unless a derived Version was explicitly published.

**Other options:**

- **On publish/Version only** — simpler; leaves live preview on the slow
  realm-server path (fails the main Boxel goal).
- **Lazy on first GET via deckd** — OK as fallback if settle missed; must not
  run inside realm-server itself.
- **Every Step always full rebuild** — correct but too expensive; path cache
  is mandatory if chosen.

### Q3 — What does the loader fetch after D2?

**Recommendation:** browser/loader keeps consuming **ESM** (and Deck import
maps). AMD is an **internal** projection for stacks that still need it
(Ember/Boxel pipeline), produced into `.deck/build/` and served under an
explicit derived URL grammar or internal loader hook — not as a second public
identity for the same `@exact` without recording derivation.

**Other options:**

- Dual public URLs for source vs AMD under one Version (like `foo.js` /
  `foo.amd.js`) — honest two digests; more catalog/authoring noise.
- Transform only in host memory — recreates today’s realm-server cost.

### Q4 — esbuild vs A2 terser minify?

**Recommendation:** **split tools by job.** esbuild (or equivalent) for AMD /
graph transforms; **terser** (A2) remains the default recorded minifier for
release derive until a new ruling replaces A2 with a reproducible pin. Both
appear in derivation meta when used.

**Other options:**

- Pin esbuild for minify too — only with a verify-derivation story that
  accepts platform risk or locks native builds.
- No minify in deckd at all — leave `deck derive` in Tools forever (fine;
  D2 does not require absorbing A/B delivery workstreams).

### Q5 — One daemon for many depots, or one per realm?

**Recommendation:** **one deckd per host**, many `{ dir }` arguments (historyd
model). Realm-server passes absolute depot paths.

**Other options:**

- One process per realm — easier blast radius, worse ops on multi-tenant hosts.
- In-process jj-lib inside realm-server — no second process; couples Node and
  Rust, harder crash isolation; acceptable only as a later embed if RPC cost
  dominates.

### Q6 — Seal source tip, projected tip, or both?

**Recommendation:** Timeline **Steps always capture the live author tree**
(what humans/agents edited). Build outputs live only under `.deck/build/` and
are not Step content. A Version may point at source and optionally record
`derivation` for a published derived tree.

**Other options:**

- Seal after projecting into the live tree — mutates what authors see; easy to
  confuse with identity; discouraged.
- Parallel Timeline for build artifacts — complexity with little product win.

### Q7 — Failure mode when build fails?

**Recommendation:** Step seal **still succeeds** (tape of edits is sacred);
build status is separate (`ensure-build` → error). Preview shows “build
failed” without losing restore. Never leave a half-written identity Version.

**Other options:**

- Block seal until build green — safer for “broken tip never recorded”; worse
  for agent/debug restore.
- Roll back live tree on build fail — hostile to authors.

### Q8 — Name of Timeline subdirectory?

**Recommendation:** `.deck/timeline/` (product word matches UI: Timeline).

**Other options:**

- `.deck/jj/` — honest about backend; leaks impl into paths.
- `.deck/history/` — clashes with “History: Versions vs Timeline” chrome.

---

## 5. Relation to existing backends

```text
HistoryBackend (TS)
  ├─ jj CLI          → temporary Boxel/default until D1
  ├─ historyd client → today’s external daemon (D1 replaces)
  └─ deckd client    → Timeline + ensure-build (target)
```

Capability block grows: `{ jj, historyd, deckd, build? }`. Doctor copy:
`History: Timeline · via deckd` (not “via jj” once D1 is default).

---

## 6. What stays out of deckd

| Stays elsewhere | Why |
| --- | --- |
| Hub UI / teaching demos | Tools |
| Offer rebase daemon | Tools; write policy separate |
| npm vendor corpus pipeline | Tools / ops |
| Negotiated pack prune | undesigned |
| Replacing import maps with a bundler identity | laws / at-rest |

---

## 7. Acceptance sketches

**D0:** depot with Timeline has no top-level `.jj`; `tree-hash` unchanged;
no-gitlink tests green; restore still replays forward.

**D1:** `deck serve --history deckd` (or `auto`) seals Steps with actor;
`fileListAt` works; killing deckd is visible in doctor; restart supervised.

**D2:** a Boxel AMD-hot fixture compiles via `ensure-build`; realm-server
path no longer runs that transform; derivation record verifies; live edit
invalidates only touched graph nodes.

**D3:** new editable realm defaults to Timeline+deckd; RO catalog mount may
stay Versions-only.

---

## 8. One-sentence summary

**deckd** is Deck’s supervised sidecar: jj-lib Timeline under **`.deck` only**,
plus a derived esbuild/AMD build plane, so Boxel’s realm server stops being a
compiler and stop growing extra hidden git folders.
