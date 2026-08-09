# Deck

```bash
node packages/cli/bin/deck.js hello
```

That scaffolds a working app, serves it live, and prints the URL. Edit
a file, reload, see it. That is the whole loop.

Nothing here is published to npm yet, and **`npx deck` is somebody else's
package** — install from this repo. [INSTALL.md](INSTALL.md) covers the
three ways; [CLI.md](CLI.md) is the CLI's own readme.

**No npm. No GitHub. No deploy. No PR.** Instant feedback. Ship any
version, share any milestone, revert anytime, use any ESM library from
the web, keep the whole web platform, never lose work, reuse and
combine what you built before, and fork an experiment with no
consequences.

## The layout is the address

A depot is a directory. What `ls` shows and what the URL says are the
same thing:

```
<root>/site/acme/palette/palette.js     on disk
       /site/acme/palette/palette.js    live — every save, no-store
       /site/acme/palette@1.1.0/palette.js
                                        the sealed copy, immutable forever
       /site/_history/<changeId>/acme/palette/palette.js
                                        any state it was ever in, published or not
```

`ls` and `cat` give you the LATEST of everything, and an agent can
change any of it. Adding `@<version>` to the package segment reads the
same path out of a seal instead. A depot carries its own machinery
inside itself — `.deck/store/` for sealed versions, `.jj/` for seals —
both invisible to the tree hash, so copying the directory takes the
live files, every published version, and the whole history with it.

## Three levels of volatility, all just URLs

| You want | You write | You get |
| --- | --- | --- |
| every save, instantly — 18 agents on one tree | `"acme/palette": "live"` | `/site/acme/palette/…` |
| the freshest seal, for a shape still moving | `"acme/palette": "dev"` | `/site/acme/palette@1.2.0-dev.7/…` |
| something dependable underneath you | `"acme/palette": "^1.0.0"` | `/site/acme/palette@1.1.0/…` |

`latest` is a dist-tag on a stable release. **`latest` is not live** —
live is the bytes on disk, with no version segment at all.

Ranges never match prereleases, so a `^1.0.0` dependency cannot pick up
somebody's auto-published dev line by accident. Opting into churn is
always explicit.

## The workflow

```bash
deck serve --root ./work                 # every depot under ./work, live + auto-publishing
# …edit anything. Every settled save auto-publishes <base>-dev.N (tag: dev)
#   and is sealed, whether or not it is published.

deck release --depot ./work/site --publisher acme --name palette \
  --version 1.1.0 --from dev --tag latest      # instantly a real semver, zero bytes copied

deck lock --depot ./work/site --publisher you --name app
#   resolves this deck's declared RANGES to exact versions and pins them in
#   its import map — what your users get, so they never inherit your
#   dependencies' working trees. Move them forward when you're ready.

deck fork --depot ./work/site --from acme/palette --as you/palette --use-in you/app
#   copy someone's deck into YOUR publisher scope and change it at byte speed.
#   Separate version line, separate dist-tags. Their versions never move.

deck offers --depot ./work/site          # every open proposal, and whether it still merges
deck rebase --depot ./work/site          # re-merge them all; conflicts are reported, not written

deck history ./work/site                 # every state the depot has been in
deck restore ./work/site <changeId>      # go back to any of them; the state you
                                         # leave is sealed first, so this is undoable
```

The publisher segment IS the fork boundary: `acme/palette` and
`you/palette` are different names with different version lines in the
same depot. An undiverged fork costs no bytes — the store is content-
addressed, so identical content is stored once.

How each promise is kept:

| Promise | Mechanism |
| --- | --- |
| instant feedback | the version-less URL serves your working directory, `no-store` |
| never lose work | every settled save auto-publishes an immutable version, and every save is sealed |
| revert anytime | `deck restore <depot> <changeId>` — replayed forward, never rewinding |
| ship any version | `deck release … --from dev` — names a sealed state, copies nothing |
| share any milestone | `deck pack <deck>` → one `.pack.zip` any zip tool opens |
| use any library | `deck vendor https://esm.sh/three@0.160.0 …` — pulled in for good, hermetic |
| fork freely | `deck fork` — your own publisher scope; theirs is untouched |
| stability where you need it | `deck lock` — ranges in the tree, exact pins in the map |
| whole web platform | plain ES modules and import maps; no bundler, no transpile |

Deck is deliberately independent:

- **No framework required.** The protocol serves ANY vanilla JS/HTML
  app. Nothing here depends on `.gts`, card-api, or Boxel — those
  are one consumer.
- **Reference implementation here**: a CLI and a minimal Node
  webserver, developed and tested standalone.
- **The Boxel realm server will IMPLEMENT Deck later**, when this is
  mature. A working at-rest implementation already exists inside the
  realm server (branches `deck/01`–`deck/07` on the
  `jj-history-sidecar` worktree of the boxel monorepo, L1–L7, fully
  tested) — it is prior art and a re-import target, not the home.

## Contribution: the proposal is a version, not a diff

A fork records its base — package, version, and treeHash — in its own import
map, so a fork IS a proposal. Nothing registers it; there is no branch and no
side table. That makes two things possible that a diff-based flow cannot do.

**Review by running, not by reading.** Every proposal is already published at
a URL, so trying one is a query parameter:

```
/site/you/app/index.html?with=acme/palette=you/palette
/site/you/app/index.html?with=acme/palette@1.1.0
```

The server resolves the app's import map differently for that one request —
same rules `deck lock` uses, applied at serve time. No checkout, no build, no
branch, and the app's own tree is untouched. Repeat `with` to try several at
once. A trial is never cached as if it were the sealed thing.

**Nobody rebases.** `deck serve --rebase` keeps every open proposal merged
against upstream continuously: the base is exact and both sides are
content-addressed, so re-merging is a pure function a machine can run. Clean
merges are written into the proposal's own tree — which auto-publishes and
seals like any other save — and the base pointer moves to what it absorbed.
Conflicted ones are reported and **left strictly alone**: a machine never
damages a contributor's work.

So a maintainer with 200 open proposals sees the three that stopped merging,
not 197 that need a rebase.

JSON is merged as data rather than as lines. In a pretty-printed object,
adding a key makes the line above grow a comma, so a line merge would call
that a conflict — and manifests and card instances are JSON. Merging by key
means only the same key, changed differently on both sides, is a real
disagreement.

Accepting a proposal is a pointer move: upstream publishes the treeHash the
proposal already holds. **Zero bytes are copied.**

## Bring a CDN library in-house

```bash
deck vendor https://esm.sh/three@0.160.0 --name three --version 0.160.0 \
  --depot ./work/site --publisher acme --tag latest
```

That pulls three.js's whole module graph from esm.sh ONCE, rewrites
every cross-module reference to stay inside the pack, and seals it.
Your app's import map then points at your own server:

```html
<script type="importmap">
{ "imports": { "three": "/site/acme/three@0.160.0/esm.sh/three@0.160.0.mjs" } }
</script>
<script type="module">
  import * as THREE from 'three';   // never touches a public CDN
</script>
```

Verified end to end against the real esm.sh: three.js r160 loads and
executes in a browser with every request going to the Deck server and
none to any CDN. Vendoring is **hermetic by default** — if the graph
reaches a host the walker will not follow, the command fails rather
than sealing a pack with a live external reference inside it.
`--allow-external` (keep it live) and `--allow-host` (follow it too)
are the explicit opt-outs. The canonical source travels with the
bytes as `vendoredFrom`, so a consumer can always tell what a
vendored module IS — dedupe it, upgrade it, or check it upstream.

Because a browser only honours an INLINE import map, the server
injects each document's map when it serves HTML — including replacing
an inert `<script type="importmap" src="…">` with the real thing. The
sealed bytes are untouched: `?format=pack` and the tree hash are
exactly what was sealed.

## The safe-vendor requirement (noted 2026-08-07)

A Deck server must be able to act as **your own unpkg for a curated
set of third-party packages**: vendor in a specific, reviewed semver
of a library (say, one vetted three.js), seal it, and serve it
immutably by hash. Apps then import ONLY from your Deck server —
never from a public CDN — so the supply chain narrows to versions a
human approved, each verifiable by treeHash/Content-Digest. This
revives the CatalogJS-era idea with modern mechanics: pin + hash +
review, then serve forever. It falls out of the vendoring design
(carriage modes) rather than being a bolt-on.

## Run it

```bash
pnpm install
pnpm demo
# open http://localhost:8789/
```

[`examples/hub`](examples/hub/) starts all seven examples at once — each in its
own process, its own depot, its own store — and serves one console: the
Deckbook, and for each demo its explanation, its live app, and the transcript
it actually printed while building its store. See [examples/](examples/) to run
one on its own.

Two of them are about the act of writing software with agents rather than about
a kind of software: [two-agents](examples/two-agents/) — concurrent editing, a
clean merge, and a conflict resolved deterministically from a published policy —
and [variations](examples/variations/) — three agent answers at three layers,
one promoted, two kept.

## The CLI

[INSTALL.md](INSTALL.md) — prerequisites, three ways to install it, and how
to verify the install actually works.

[CLI.md](CLI.md) — the CLI's readme: the eight command groups, the loop you
will actually run, and what each refusal is protecting.

`deck help` prints the command map; `deck help <command>` explains any one
of them in full.

## Deckbook

Open [deckbook.html](deckbook.html) (or `http://localhost:<port>/deckbook.html`
on a running server) for a teaching tour of the protocol against what this
reference implementation actually runs — vocabulary, address space, live loop,
store/packs, history tiers, vendor, fork/lock/offers, HTTP + CLI maps, four
use cases worked end to end at the command line, and honest status.

## Documents

Design set in [docs/](docs/) — start with:

- **[deck-laws.md](docs/deck-laws.md) — the contract.** Twelve invariants,
  each one checkable, each one checked by `deck conform`. Everything else
  here is commentary, design history, or a record of how something was
  measured. An implementation implements Deck by passing the suite.
- [deck-at-rest-protocol.md](docs/deck-at-rest-protocol.md) — the
  protocol: state model, endpoints, serving rules, vocabulary.
- [deck-cas-v2-spec.md](docs/deck-cas-v2-spec.md) — next CAS work:
  blob store (pack as transport), verified dependency links, and
  signatures on treeHash.
- [deck-efficient-delivery-spec.md](docs/deck-efficient-delivery-spec.md)
  — **built.** Sealed releases without bundling-as-identity: minify as a
  derived tree, gzip at the origin, and `modulepreload` of the decklist
  closure. Brotli and HTTP/2–3 are the edge's job and terminate at
  Cloudflare, never here.
- [deck-tree-hash-v2-merkle-proposal.md](docs/deck-tree-hash-v2-merkle-proposal.md)
  — **rejected.** A Merkle directory identity does not solve what it was
  proposed for, and costs a second identity spec to find that out.
  `tree-hash-v1` is the identity for everything. The measurements are in
  [deck-tree-hash-v2-review.md](docs/deck-tree-hash-v2-review.md).
- [deck-rebuild-sibling-proposal.md](docs/deck-rebuild-sibling-proposal.md)
  — when git+build ≠ npm bytes: `rebuild-v1` derivation (sibling, not
  fork); explicit `match` exact/mismatch.
- [deck-depot-and-realm-backport.md](docs/deck-depot-and-realm-backport.md)
  — standalone Deck says **depot** (a place), not realm; publishers sit
  inside; Boxel realm is placement-free and may become deck-enabled.
- [deck-land-hostnames.md](docs/deck-land-hostnames.md) — **`deck.land`**
  map: apex / `local` / **`cloud`** (hosted sync server) / `cdn`; hub is
  the app, not a hostname.
- [deck-activity-protocol.md](docs/deck-activity-protocol.md) — **proposed.**
  **`GET /_activity`** replaces `/_heat`: one agent-activity door (EWMA
  trie + optional `story=1` run/code/commentary) for gutters and the
  watch canvas. ([old heat note](docs/deck-heat-protocol.md) points here.)
- [deck-tick-version-vocabulary.md](docs/deck-tick-version-vocabulary.md)
  — **ruled.** UI: **Version** / **Tick** / **Timeline**; imports:
  **Import** / **Pin** / **Entry** / **Leaf** / **Closure**.
- [deck-pack-equivalence.md](docs/deck-pack-equivalence.md) — deck ⇄
  pack: four homes, treeHash identity, carriage modes, round-trip
  laws, `!/` mounts, canonical-zip-v1. All opens ruled.
- [deck-live-autopublish.md](docs/deck-live-autopublish.md) — the
  live tree, the auto-publish loop, and seal-grained history.
- [deck-fitted-thesis.md](docs/deck-fitted-thesis.md) — the UX thesis: a
  deck is a card that authors its own fitted format, so the catalog is a
  wall of running things. Eight domain cards at three sizes each, the
  protocol reduced to a badge vocabulary, and the four surfaces that fall
  out.
- [deck-ui-spec.md](docs/deck-ui-spec.md) — product requirements for a
  UI, driven by the four workloads: fixed requirements and invariants,
  open information architecture, and a rubric that catches a design
  which secretly serves only one workload.
- [deck-use-cases.md](docs/deck-use-cases.md) — four workloads that
  need this protocol rather than merely benefit from it, written
  against the bottlenecks agentic engineering hits on git and npm.
- [deck-vendor-source-mode.md](docs/deck-vendor-source-mode.md) — how to
  vendor a package at its ESM module boundary instead of as a bundle, and
  why the npm tarball turns out to be a verifiable checkout of the GitHub
  repo: measured on three.js, 374/374 files byte-identical.
- [deck-competitive-gaps.md](docs/deck-competitive-gaps.md) — what is
  missing to replace git + GitHub + npm + unpkg, reconciled against what
  the Boxel realm server and CLI already built, and classified by who
  supplies each answer: backport, federation, protocol, or operations.
- [deck-cardpack-requirements.md](docs/deck-cardpack-requirements.md)
  — requirements recovered from the cardpack v0.2 implementation
  (preserved verbatim in [reference/cardpack-v0.2](reference/cardpack-v0.2)).
- [deck-unpkg-comparison.md](docs/deck-unpkg-comparison.md) and
  [deck-esmsh-comparison.md](docs/deck-esmsh-comparison.md) —
  production lessons from unpkg and esm.sh, and what was adopted.

The remaining docs cover the semver/migration spec, the publishing
skill, lifecycle, use-case ladder, catalog consumption modes,
multi-package design, and the GitHub mirror analysis.

## Status

**The reference implementation is built and tested** — 297 tests green
(185 core, 19 history, 76 server, 4 conformance, 13 CLI), lint and
typecheck clean, and `deck conform` reports 49 passed / 0 failed / 3 not
applicable.

- **`packages/core`** — `tree-hash-v1` (shasum-compatible manifest,
  UTF-8 byte-order sort), `canonical-zip-v1` (hand-rolled
  deterministic writer, zero deps; tolerant standard-zip reader with
  size caps), packlist (`deck-pack-v1`), `pack`/`unpack` verified
  under the round-trip laws, the shared import-map module, the
  **content-addressed store** (packs live once per treeHash; versions
  are pointers, so `release` copies nothing and pruning deletes bytes
  only when nothing points at them), the **decklist lock**, **fork**, the
  **three-way merge** (line-level for text, key-level for JSON), and
  **offers** — a fork with a recorded base, planned and rebased as a pure
  function.
- **`packages/history`** — tier-2 seals behind one contract, with two
  backends: the jj CLI and historyd (jj-lib over localhost HTTP,
  ~5-6x faster per call). A missing jj or a dead daemon degrades to
  tier 1 with a printed reason. Restores replay forward as ordinary
  writes, so history only ever grows.
- **`packages/server`** — read-only zero-framework serving of depots:
  version-less = the working tree (`no-store`); exact = immutable +
  Content-Digest; range/tag = one 302 hop; bare/alias = 301; `?meta`
  (including which seal a version was cut from); `?format=pack`;
  `!/` mounts; `/<depot>/_history/<changeId>/<path>`; import-map
  injection for HTML; coded JSON errors with two negative-cache
  tiers; HEAD; writes refused. Plus `/_packages`, `/_browse`,
  `/<depot>/_offers`, the `?with=` trial override, the **rebase daemon**,
  and an SSE change bus at `/_live/events` with a drop-in HMR client.
- **`packages/cli`** — 27 commands in eight groups, one module per group
  (see [CLI.md](CLI.md)): **start** `hello serve` · **seal** `hash pack
  unpack list verify` · **publish** `publish tag release prune store derive
  verify-derivation` · **depend** `vendor vendor-tree lock verify-links` ·
  **propose** `fork offers rebase` · **endorse** `keygen sign verify-sig` ·
  **recall** `history restore` · **prove** `conform`. Each command carries
  its own usage and explanation, and every help screen is rendered from the
  same records the dispatcher looks up.
- **`packages/conformance`** — the executable contract: the twelve laws as
  checks that run, against the reference server or against any
  implementation black-box over HTTP.

Run everything: `pnpm install && pnpm test && pnpm lint`.

### Not built yet

Cross-depot dependencies (a lock refuses them rather than writing a
pin nobody can serve). The `vendor`/`unvendor` map-rewrite toggle is
designed in [docs/deck-pack-equivalence.md](docs/deck-pack-equivalence.md);
the `!/` mount half it depends on is already serving.
