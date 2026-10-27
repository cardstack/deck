# deckd — History + build daemon

**Status: RULING + OPEN QUESTIONS** (2026-08-09).

Deck-owned long-lived process that attaches a **History** to a depot and
(optionally) runs **derived build work** (esbuild, AMD, and friends) so the
realm server / `deck serve` HTTP surface stays thin and read-only.

Companions: [`deck-at-rest.md`](deck-at-rest.md) (layout),
[`deck-step-version-vocabulary.md`](deck-step-version-vocabulary.md),
[`deck-laws.md`](deck-laws.md) (L12 surface),
[`deck-efficient-delivery-spec.md`](deck-efficient-delivery-spec.md) (A2 minify),
[`deck-embroider-lessons.md`](deck-embroider-lessons.md) (pain at seal time),
[`deck-boxel-backport-for-team.md`](./plans/deck-boxel-backport-for-team.md) (campaign).

jj-lib source used for spikes / dependency work: a local checkout of
[`jj-vcs/jj`](https://github.com/jj-vcs/jj) (`lib/`). That tree is **not** where AMD or
esbuild live.

**Implementation:** [`packages/deckd/`](../packages/deckd/) — historyd-compatible
HTTP, History under `.deck/history`, jj-lib in-process with a watchexec-shaped
FS seal plane (`jj_cli` feature optional).

---

## 0. Why

Today:

| Concern                   | Where it lives                                                |
| ------------------------- | ------------------------------------------------------------- |
| Versions / claims         | `<depot>/.deck/store`, `.deck/claims`                         |
| History Steps             | top-level `<depot>/.jj/` via jj CLI, or external **historyd** |
| Boxel edit history        | often a separate `.boxel-history` git story                   |
| AMD / expensive transform | Boxel realm-server lifecycle (request-adjacent)               |
| Minify derived releases   | Tools/`derive`, **terser** (A2)                               |

Problems: two (or three) hidden directories; History backend unsupervised;
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
  a local jj checkout's `lib/`. Deck ships `deckd`; it does not become
  “Cardstack’s jj distribution.”

### R2 — Roles of deckd

deckd may:

1. **History** — ensure repo, seal Step, list, file-at, restore-plan
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
<realm>/
  <authored realm tree>/…          existing default-branch content (hashed + served)
  package.json                     conventional package metadata where present
  importmap.json                   optional root resolution input
  apps/<name>/…                    existing app-local trees and maps
  packages/<scope>/<name>/…        existing package-local trees and maps
  .deck/
    repository.json                optional multi-package manifest
    store/                         Versions (unchanged role)
    refs/                          branch/published heads
    reviews/                       Review objects and events
    indexes/                       completed index generations
    claims/                        WIP claims
    policy.json                    optional
    history/
      repo/                        jj op store + internal git  ← durable History
    branches/<opaque-id>/
      source/                      non-default branch materialization
      history/repo/                branch-local jj History
      index-staging/               derived private build state
    build/                         reserved (derived plane later; unused for now)
  .jj/                             jj workspace stub ONLY (not a symlink)
    repo                           file: "../.deck/history/repo"
    working_copy/                  jj WC state (jj requires this next to .jj)
```

The default branch stays at the realm root, matching Boxel's existing
`deck/at-rest-poc` layout. Only non-default branches require the new
`.deck/branches/<opaque-id>/` locations. Their `source/` directory clones the
authored realm tree without `.deck`, `.jj`, or `.git`; it preserves ordinary
package boundaries and all applicable import-map inputs.

- **No** `.jj` → `.deck/history` symlink.
- **No** empty `.deck/history/.jj` nested-repo marker.
- Durable History bytes live only under `.deck/history/repo/`.
- Top-level `.jj/` remains a thin stub because stock jj discovers the
  workspace by that basename; jj-lib can later root the stub under `.deck`
  and delete it. The stub’s `repo` _file_ is jj’s supported out-of-tree
  pointer (same idea as git’s `gitdir:`), not a Deck hack.
- No `.boxel-history` once History is attached.
- No colocated `.git` in the realm (no-gitlink law).

All Deck resources remain inside the owning realm. A selected non-default
branch view projects its physical History as `/.deck/history/repo`, so deckd,
agents, and UI keep one stable path even though the host uses an opaque branch
directory. On AWS, this realm tree is on S3 Files. Agents can inspect History;
only deckd's POSIX principal writes the jj repository.

`DEFAULT_IGNORE` / `snapshot.auto-track` exclude `.deck` so the store is never
sealed into itself; `file-list-at` / restore also filter machinery paths.

**Migration:** `ensure` converts symlink or full-`.jj` layouts to the thin
stub. It also atomically renames a lone legacy `.deck/timeline/` directory to
`.deck/history/` and rewrites the pointer. If both directories exist, it
refuses to choose and preserves both for manual repair.

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
  via restore replay rules already defined for History).
- Transforms are RPC to deckd (`/ensure-build`), not `PUT` handlers on the
  serve origin.

### R7 — Campaign fit

Not inside lean Core drop, resolver, or thin decklist verbs (PR 1 / 1b).
Treat as **Track D — Build**, after or parallel to History slices:

| Slice  | Outcome                                                                             |
| ------ | ----------------------------------------------------------------------------------- |
| **D0** | Layout only: History under `.deck/history`; kill top-level `.jj` / `.boxel-history` |
| **D1** | Own supervised deckd History (historyd contract + gaps)                             |
| **D2** | Build plane later; until then identity JS only (main Hub pipeline)                  |
| **D3** | Editable realms default to deckd; Versions-only remains for RO catalog mirrors      |

Boxel can keep shipping **jj CLI in-image** until D1; same `HistoryBackend`
contract.

---

## 2. RPC surface (v1)

History (compat with today’s historyd client in
`packages/history/src/historyd.ts`):

| Route                | Body (sketch)               | Result                                             |
| -------------------- | --------------------------- | -------------------------------------------------- |
| `POST /ensure`       | `{ dir }`                   | `{}` — repo at `.deck/history`                     |
| `POST /seal`         | `{ dir, message, actor? }`  | `{ changeId }`                                     |
| `POST /list`         | `{ dir }`                   | `HistoryEntry[]` (incl. author when actor was set) |
| `POST /file-at`      | `{ dir, revisionId, path }` | bytes or not found                                 |
| `POST /file-list-at` | `{ dir, revisionId }`       | paths — **close the CLI gap**                      |
| `POST /restore-plan` | `{ dir, revisionId }`       | `{ writes, deletes }`                              |

Explicit commits, for a writer that stages content itself and must record each
write exactly once. These address a bare history repo by path rather than a
depot; the [deckd README](../packages/deckd/README.md#explicit-commits) has the
full contract:

| Route             | Body (sketch)                                                        | Result                                                    |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| `POST /commit`    | `{ repo, parent, operationId, author, message, trailers?, changes }` | `{ revision, tree, created, replayed }`, or a typed error |
| `POST /outcome`   | `{ repo, operationId }`                                              | `committed` + revision, or `absent` (fences the ID)       |
| `POST /head`      | `{ repo }`                                                           | `{ revision, tree }`                                      |
| `POST /tree-hash` | `{ repo, revision }`                                                 | `{ tree }`, the git tree ID                               |

Build (deferred — **not** on the Hub serve path):

| Route                | Body (sketch)                               | Result                                     |
| -------------------- | ------------------------------------------- | ------------------------------------------ |
| `POST /ensure-build` | `{ dir, tip?, transforms[], toolchain_id }` | derived cache under `.deck/build/` (later) |
| `POST /artifact-at`  | `{ dir, tip, path, … }`                     | derived bytes (later)                      |

**Near-term serve:** Hub / `deck serve` keep **main’s identity JS pipeline**
(live ESM from the working tree / sealed packs). No esbuild, no
`?derived=amd` hook in Deck. deckd’s job for D0–D1 is History under
`.deck/history` so Hub stops forking `jj` CLI.

Default listen: `http://127.0.0.1:8787` (today’s `DECK_HISTORYD_URL`);
`deck serve` stays on 8788. Env: `DECKD_URL` supersedes `DECK_HISTORYD_URL`
when both set. With `DECKD_URL`, `createHistory` attaches **deckd** (not jj CLI).

**Sealer cutover:** when `history.kind === 'deckd'`, Hub `watchAndPublish`
defaults `sealOnWatch: false` — Versions + HMR only. History seals come from
deckd’s FS watch plane (`notify` → debounce → jj-lib). jj / historyd keep
Node-side note/flush.

---

## 3. Gaps vs today’s historyd (must close in D1)

| Gap             | Today                   | deckd                                             |
| --------------- | ----------------------- | ------------------------------------------------- |
| `actor` on seal | dropped                 | persisted; `list` shows author                    |
| `fileListAt`    | absent                  | `/file-list-at`                                   |
| Supervision     | unsupervised sibling    | started/supervised by `deck serve` / realm-server |
| Repo path       | implicit `.jj` at `dir` | **`.deck/history` only**                          |

---

## 4. Open questions

For each: **recommendation**, then **other options** kept visible.

### Q1 — Where does the deckd crate live?

**Resolved:** `packages/deckd/` (Rust), jj-lib from crates.io. TypeScript in
Deck keeps only the HTTP client (`HistoryBackend` + build client). The former
`christse/deckd-poc` sidecar is folded in and retired.

**Rejected options:** soft-fork jj-vcs/jj for a `deckd` binary (merge tax);
keep external jj-historyd + a second build process (two daemons).

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

### Q5 — One daemon for many realm branches, or one per realm?

**Recommendation:** **one deckd per host**, many `{ dir }` arguments (historyd
model). Realm-server passes the selected branch workspace path. One
coordinated deckd writer owns each branch History at a time; hosted paths may
be S3 Files mounts.

**Other options:**

- One process per realm — easier blast radius, worse ops on multi-tenant hosts.
- In-process jj-lib inside realm-server — no second process; couples Node and
  Rust, harder crash isolation; acceptable only as a later embed if RPC cost
  dominates.

### Q6 — Seal source tip, projected tip, or both?

**Recommendation:** History **Steps always capture the live author tree**
(what humans/agents edited). Build outputs live only under `.deck/build/` and
are not Step content. A Version may point at source and optionally record
`derivation` for a published derived tree.

**Other options:**

- Seal after projecting into the live tree — mutates what authors see; easy to
  confuse with identity; discouraged.
- Parallel History for build artifacts — complexity with little product win.

### Q7 — Failure mode when build fails?

**Recommendation:** Step seal **still succeeds** (tape of edits is sacred);
build status is separate (`ensure-build` → error). Preview shows “build
failed” without losing restore. Never leave a half-written identity Version.

**Other options:**

- Block seal until build green — safer for “broken tip never recorded”; worse
  for agent/debug restore.
- Roll back live tree on build fail — hostile to authors.

### Q8 — Name of History subdirectory?

**Recommendation:** `.deck/history/` (product word matches UI: History).

**Other options:**

- `.deck/jj/` — honest about backend; leaks impl into paths.
- `.deck/history/` — clashes with “History: Versions vs History” chrome.

---

## 5. Relation to existing backends

```text
HistoryBackend (TS)
  ├─ jj CLI          → legacy fallback only
  ├─ historyd client → legacy external compatibility
  └─ deckd client    → official History + ensure-build backend
```

Capability block is `{ jj, historyd, deckd, build? }`. Doctor copy:
`History: Every save · via deckd` (not “via jj” once D1 is default).

---

## 6. What stays out of deckd

| Stays elsewhere                               | Why                          |
| --------------------------------------------- | ---------------------------- |
| Hub UI / teaching demos                       | Tools                        |
| Offer rebase daemon                           | Tools; write policy separate |
| npm vendor corpus pipeline                    | Tools / ops                  |
| Negotiated pack prune                         | undesigned                   |
| Replacing import maps with a bundler identity | laws / at-rest               |

---

## 7. Acceptance sketches

**D0:** History store under `.deck/history/repo`; thin `.jj/repo` file
pointer (no symlink, no nested marker); sealed `file-list-at` has zero
`.deck/**`; `tree-hash` unchanged; no-gitlink tests green; restore still
replays forward.

**D1:** `deck serve --history deckd` (or `auto`) seals Steps with actor;
`fileListAt` works; killing deckd is visible in doctor; restart supervised.

**D2 (deferred):** derived build plane under `.deck/build/` when Boxel needs
it; Hub continues identity ESM until then.

**D3:** new editable realm defaults to History+deckd; RO catalog mount may
stay Versions-only.

---

## 8. One-sentence summary

**deckd** is Deck’s supervised sidecar: History under **`.deck` only**
(replacing Hub’s jj CLI forks and top-level `.jj`), so Boxel/Deck stop growing
extra hidden git folders. Derived build plane is optional later; identity JS
stays on the Hub.
