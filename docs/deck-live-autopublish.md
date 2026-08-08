# Live-tree serving + auto-publish: the filesystem endpoint design

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Status: TIER 1 BUILT AND TESTED (2026-08-07) — watcher auto-publish, /live/ routes, and the no-copies release (content-addressed store + `deck release`) are implemented; tier 2 (historyd) remains design.
Question answered: can historyd attach to the standalone Deck server
so a plain directory becomes an auto-versioning module publisher
while still supporting live-tree vibe coding? Yes — and the design
splits into two tiers, only one of which needs historyd at all.

## 0. The shape of the answer

One command:

```
deck serve --store ./store --watch ./my-lib --as my-lib
```

gives one directory three simultaneous lives:

1. **The live tree** (vibe coding): `GET /live/my-lib/<path>` serves
   the working directory directly, `Cache-Control: no-store`. Every
   save is visible on the next request. This is the hand you edit;
   nothing downstream can be hurt by it.
2. **Auto-published prereleases** (the auto version publisher):
   every settled edit state becomes an immutable, addressable
   version — automatically.
3. **Deliberate stable versions**: `deck publish` stays a human/agent
   decision. Semver INTENT (breaking or not) cannot be inferred from
   a file watcher; stables are never auto-minted.

## 1. The auto-publish loop

```
file change → watcher → debounce (≈500ms quiet)
  → treeHash(dir)                 — identical to last publish? STOP
  → [tier 2 only: historyd seal]
  → packFromDir(dir) → publish into the store:
        version  <base>-dev.<n>   (n = monotonic counter)
        tag      dev
```

- `<base>` comes from the directory's own `importmap.json`
  (`deck.packages[<name>].version`) — the map stays the manifest.
  Declare `1.2.0` and edits publish `1.2.0-dev.1`, `1.2.0-dev.2`, …
  Bump the map and the dev line follows.
- **The protocol already protects consumers**: ranges never match
  prereleases, so `^1.0.0` users NEVER see dev builds; only an
  explicit `@my-lib@dev` (or exact `-dev.N` pin) opts in. Auto-
  publishing is safe by the existing resolution rule, not by a new
  mechanism.
- treeHash dedup means save-storms and no-op saves publish nothing.
  The store's immutability rule is untouched — every auto version is
  a normal verified pack; there is no "mutable dev version."
- Consumer choices become import-map values, as always:
  `/@my-lib@1.2.0/` (prod, immutable), `/@my-lib@dev/` (follow the
  freshest auto-publish via short-TTL redirect), `/live/my-lib/`
  (the raw hand — instant, unversioned).

## 2. Tier 1 — no historyd: watcher + store only

Pure Node, zero new dependencies: `fs.watch` + debounce +
`packFromDir` + `publishToStore`. The STORE ITSELF is the history —
every settled state is a pack, addressable forever, diffable by
treeHash. Restore = unpack an old dev version over the directory.

What tier 1 does NOT give: sub-publish granularity (states inside
the debounce window are lost), actor attribution, an audit log
between versions, or serving arbitrary past states that were never
published. For the vibe-coding-to-publisher use case, tier 1 covers
the whole loop.

Prune policy (dev versions accumulate): keep the last K dev packs
per line + any that a tag points at; pruning deletes PACK FILES of
prereleases only — stable versions are never pruned (immutability
of the public surface holds; dev prereleases are declared
prunable-by-policy in the store meta so consumers know the deal).

## 3. Tier 2 — historyd: seal-grained history under the same loop

Attach jj (via jj-historyd, the Rust jj-lib daemon measured ~5-6x
faster than CLI fork/exec, or the jj CLI as fallback) colocated on
the watched directory. The auto-publish loop is UNCHANGED; history
slots in beneath it:

- **Every save sealed** (debounced), not just every published state:
  full restore ("mulligan") between publishes, actor attribution,
  the audit trail — the same guarantees the realm sidecar gives.
- **Serve any sealed state**, published or not:
  `/history/my-lib/<changeId>/<path>` via `fileAt` — the standalone
  counterpart of `_history/<changeId>/<path>`.
- **The colocated git repo** falls out (jj git init --colocate), so
  the GitHub mirror story from the realm design applies to
  standalone directories too.
- **Publish gains provenance**: the packlist's `sealChangeId` field
  (already in the schema, caller-supplied) gets filled for real —
  every pack names the seal it was cut from.

What historyd needs that it lacks today: nothing, for this design.
Bookmarks (its known missing feature vs the CLI backend) are NOT
required — the STORE's meta.json is the version registry in the
standalone world; jj only supplies seals, fileAt, and log. That
neatly sidesteps the historyd bookmark gap that blocks it in the
realm server.

Known operational gap carried over: historyd is an unsupervised
sibling process (no auto-restart, no fallback mid-session). Tier 2
must degrade to tier 1 when the daemon is absent — same loop, less
granularity — which also keeps the CLI usable on machines with no
jj at all.

## 4. Equivalences that make this coherent

- **Seal ≙ pack**: the realm server turns edits into sealed trees
  via jj; the standalone turns them into packs via the watcher. A
  version names a sealed tree in both worlds; treeHash is the
  identity in both. Tier 2 simply gives the standalone BOTH forms.
- **The live tree is never behind the registry**: `/live/` bypasses
  the store entirely, so vibe coding has zero publish latency; the
  dev line trails by one debounce window.
- **"Saving is not shipping" survives automation**: auto-publish
  ships only into the prerelease namespace that ranges cannot see.
  Shipping to users still means a deliberate stable publish or a
  deliberate tag move.

## 5. Surface sketch (when built)

```
deck serve --store <dir> [--watch <dir> --as <name>]...   # tier 1
           [--history jj|historyd]                        # tier 2

GET /live/<name>/<path>                 no-store, straight from disk
GET /@<name>@dev                        302 → freshest auto-publish
GET /@<name>@<base>-dev.<n>/<path>      immutable, like any version
GET /history/<name>/<changeId>/<path>   tier 2 only
```

Everything else (?meta, ?format=pack, mounts, error tiers) applies
to auto-published versions with no changes — they are ordinary
versions.

## 6. Recommendation

Build tier 1 first: it is small (watcher + debounce + dedup +
prune), needs no new dependencies, and delivers the requested
capability — a filesystem endpoint that IS an auto-versioning
module publisher with live vibe coding. Add tier 2 when seal-grained
history/restore/audit earns its daemon: the design above means no
rework, only additions.

---

## Addendum (2026-08-07): built, plus the realm layout

Tier 2 is BUILT (`packages/history`): the jj CLI backend and a
historyd client behind one contract, seals under the auto-publish
loop, `/<realm>/_history/<changeId>/<path>`, `deck history`, and
`deck restore`. Two things changed against the sketch above:

- **The repo is per REALM, not per deck.** A realm seals as one tree,
  the way a realm server does, so seal paths are realm-relative
  (`acme/palette/app.js`) — the same path the URL uses. Each deck
  under the realm still publishes its own version line.
- **Routes moved under the realm**: `/<realm>/_history/…` rather than
  `/history/<name>/…`, matching the realm server's `_`-prefixed
  reserved segments.

What the design did NOT anticipate, and what it cost:

- **jj sealed the realm's own store.** With `.deck/store` inside the
  realm (so a realm directory is self-contained), jj tracked it: every
  seal carried a copy of every pack, and a restore rewound the
  published versions themselves. Fixed by writing the tree-hash ignore
  set into `.git/info/exclude` at repo creation — git's untracked
  ignore file, so the rules are not part of the tree and attaching
  history never changes a deck's hash — plus a restore-time refusal of
  those paths for repos sealed before the rule existed.
  **The invariant to hold: what jj seals is exactly what the tree hash
  covers.**
- **The watcher had to stop feeding itself.** jj writes into `.jj` on
  every operation, inside the watched tree; without filtering those
  events, sealing triggers sealing forever.
- **`settled()` had to mean "the store reflects the tree"**, not "the
  debounce elapsed". A filesystem event can arrive late, and a
  publish that never happened is not settled.
