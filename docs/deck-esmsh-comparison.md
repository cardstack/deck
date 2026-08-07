# esm.sh vs. Deck: framework sugar, testing, and server techniques

Written 2026-08-07 from a full source read of `~/Projects/esm.sh`
(the real esm.sh server: Go single binary, HEAD d1695bca). Companion
to `deck-unpkg-comparison.md` (the unpkg rewrite). Three questions
from Chris: how did esm.sh give React sugar; does that sugar fit
Boxel/Ember/Glimmer; what testing and server-side techniques are
worth borrowing.

---

## 1. The React sugar, actual inventory

React's special treatment is smaller than its reputation. The
complete list:

1. **The react-dom → react exact-version pin**
   (`build_resolver.go:926`): when building react-dom@X, the
   rewritten import of `react` is forced to exactly X — overriding
   package.json ranges and even `?deps`. It is the ONLY such pin in
   the codebase. It exists because React is a runtime singleton
   split across two packages whose versions must match.
2. **`process` define reservation** (`consts.go:142`): react,
   react-dom, and typescript keep the bare `process` global (only
   `process.env.NODE_ENV` is inlined) so the process polyfill never
   gets dragged into React itself.
3. **JSX runtime defaults**: `JSXImportSource: "react"` unless the
   package's own deps say preact/solid/vue/hono; the `/transform`
   API infers the import source from the posted import map (first
   key ending `/jsx-runtime`), falling back to react.
4. **URL sugar for the runtime path** (`router.go:612`): a
   `/jsx-runtime` suffix may ride AFTER the query
   (`react?dev&target=es2020/jsx-runtime`) because that is the URL
   shape JSX tooling generates from a URL-typed import source.
5. **Forced dev builds** (`router.go:1320`): `react/jsx-dev-runtime`
   and the whole `react-refresh` package always build in dev mode,
   flag or not — they are meaningless in prod form.
6. **Self-reference externalization** (`build.go:589`): a subpath
   build (`react/jsx-runtime`) externalizes the import of its own
   package root, so there is never a second React inside the
   runtime module.
7. **HMR/Fast Refresh live OUTSIDE the CDN** — in the separate
   `web/` no-build dev handler: `/@hmr` websocket runtime,
   `/@refresh` (React Fast Refresh) vs `/@prefresh` (Preact) chosen
   by looking at the app's import map; the transformer injects the
   instrumentation only in dev. The registry itself has zero HMR
   code.

Everything else React "gets" (dev builds, deps propagation,
condition resolution) is generic machinery. The other frameworks'
sugar: Vue/Svelte get server-side SFC loaders (compiler version
chosen from the package's own deps, loader cached per compiler
version, executed in a permissionless Deno subprocess); five CSS
packages get a bare-package → css-file redirect from a hardcoded
map; ~150 trivial npm packages are replaced with browser-native
micro-implementations.

## 2. Does this sugar fit Boxel/Ember/Glimmer?

Mostly we get their sugar generically, because our substrate already
holds the things they had to hardcode. Item by item:

- **The version-alignment pin (their #1).** Boxel does not have the
  react-dom/react problem for the framework itself: Ember and
  Glimmer are HOST-PROVIDED SINGLETONS via the loader's shims —
  structurally the same as esm.sh's `?external` import-map mode,
  which is our default posture. The place the problem reappears is
  `@cardstack/base`: two packages in one realm compiled against
  different card-api generations. The borrow is not a hard pin but
  what our spec already anticipated: record the base API peer
  (`baseApiVersion`) on the PackageVersion record at publish and
  surface it in `?meta`, so consumers and the future gate can check
  alignment. Sugar as data, not as a hardcoded exception.
- **JSX runtime (their #3, #4, #6).** The Glimmer template
  precompile IS our JSX transform, and the imports it injects
  (`setComponentTemplate`, `createTemplateFactory`, …) are our
  jsx-runtime analog. They stay bare/host-resolved — external mode
  again — so their versioning question dissolves into the host. The
  discipline that transfers: the transpiler that injects them is
  part of the artifact identity — which L6's `TRANSPILE_SERVICE`
  build key already encodes.
- **CSS package redirects (their hardcoded map).** Our
  `boxel.packages[<name>].entry` field generalizes it: a package
  whose entry is a `.css` tree path gets the same behavior from the
  map, no hardcoded list. Nothing to build.
- **`?dev` mode.** Their pattern worth keeping for later: dev is a
  VARIANT IN THE FILENAME (`react.development.mjs`), so dev and
  prod artifacts never share a cache key, and dev implies the
  `development` export condition + NODE_ENV define + no minify. Our
  serving has no dev/prod split yet (we serve unminified always).
  When Boxel wants one — e.g. `@glimmer/env` DEBUG builds,
  assertion-bearing card API — adopt variant-in-identity, not a
  header or a mutable flag.
- **HMR (their #7) — the architecture lesson.** esm.sh keeps the
  registry immutable and puts ALL liveness in a separate dev
  handler that instruments modules only in dev and picks the
  refresh runtime from the import map. This validates the Boxel
  volatile-execution plan exactly: the registry/at-rest layer stays
  as built; vibe-coding HMR (Capsule/Sandbox with vite-like reload
  during edit sessions) is a separate surface that consumes the
  live tree, never the published versions. The borrowable shape:
  well-known dev-runtime paths (their `/@hmr`, `/@refresh`) and
  import-map-driven selection of the refresh strategy — for us,
  "which renderer rehydration strategy" could be chosen per app
  area the same way.
- **SFC loaders (Vue/Svelte).** The `.gts` transpile is our SFC
  loader. Their discipline to adopt WHEN toolchain versioning
  lands (the (sourceHash, toolchainVersion) keying already in the
  design notes): compiler version is part of artifact identity and
  is chosen from the package's own declarations, with a minimum
  supported floor (they reject svelte<4, vue<3). Also their
  execution posture: compilers run fenced (Deno, no permissions,
  timeout) — matches our BXL-boundary instinct.
- **npm_replacements.** Not applicable; our corpus is ESM-native.

Net: no hardcoded package names belong in our server. The two
concrete adoptions are `baseApiVersion` in records/`?meta` (small,
at-rest, when convenient) and variant-in-filename if a dev mode
ever ships. The HMR split is confirmation of a decision already
made, not new work.

## 3. Testing techniques to borrow (the strongest material)

esm.sh's integration harness (`test/bootstrap.ts`, 154 lines) is
the best test design in either codebase:

1. **Build the real binary, run it, poll a status endpoint** for
   readiness (100ms poll on `/status.json` until `version`
   appears). The status endpoint doubles as the ops dashboard
   (build-queue snapshot, disk state, uptime).
2. **Wipe storage before every run** — every test run exercises
   cold builds, so cache-warming bugs cannot hide.
3. **One directory per GitHub issue** (~100 `issue-NNNN/` dirs),
   each a tiny test against the running server, in two styles:
   HTTP-level (fetch a URL, assert status + body shape) and
   import-level (actually `import` the served module in a real
   runtime and assert behavior — the strongest assertion class).
   Plus feature dirs (one per query flag) and framework smoke dirs
   (React 17/18 SSR rendered THROUGH the CDN).
4. **A checked-in scaffold** (`test/.template/` + documented
   `cp -r` workflow + `make test/server dir=name`) so writing a
   regression test costs one minute.
5. **`deno test --reload=<server> --check`** — the quiet
   masterstroke: `--reload` scoped to the server under test forces
   fresh fetches every run, and `--check` means every served module
   must also TYPE-CHECK, so the types pipeline is validated
   implicitly by every single test.
6. **Retry each dir once** (absorbs cold-build 408 latency flakes
   without masking real failures — a second failure fails the run).
7. **Heap-profile epilogue**: after the whole corpus, pprof-top the
   still-running server — a built-in leak smoke test.
8. Go unit tests are dominated by SECURITY REGRESSIONS (tarball
   traversal/symlink/hardlink/oversize, auth-stripping on
   redirects, dependency-name escaping) and codec round-trips.

Mapping to us:

- We already have the import-level idiom (the consumption proof: an
  instance adopts from a versioned URL and must index with zero
  error rows). Keep leaning on it — it is their strongest pattern
  and ours.
- **Adopt the issue-dir + scaffold shape** as the registry test
  suite grows: one small scenario file per regression, a template
  to copy, a make target to run one dir. Our current style (few
  large scenario tests) is fine at 6 scenarios and will not be at
  40.
- **Our `--check` analog**: run served source through `boxel parse`
  (or glint) in the consumption tests, so type-level breakage of
  served modules is caught the way Deno's --check catches theirs.
- **Cold-start discipline**: our endpoint tests already boot a
  fresh realm per fixture; keep the property that caches start
  empty (worth one explicit test that clears the in-process
  transpile/map caches and re-serves).
- The corpus+classification idea from unpkg's docs and this harness
  are the same philosophy; esm.sh shows the mechanics.

## 4. Server-side techniques to borrow

Ranked by relevance to us.

1. **Build-queue dedup with bounded client wait** — keyed by
   resolved artifact path; N identical concurrent requests share
   one build via per-caller buffered channels; the HTTP handler
   waits up to 30s then returns **408 + `must-revalidate` "still
   building — retry"** while the build continues; result delivery
   is non-blocking (waiters may have timed out); both path aliases
   are cleaned from the dedup map. Our transpile is fast enough to
   skip this today; adopt the pattern the day any expensive
   artifact appears (tree-wide integrity in `?meta`, bundles, dts).
   The 408-still-building idiom is worth keeping regardless.
2. **Failure caching tiered by PERMANENCE**: immutable 404/400 for
   structurally-invalid URLs (can never become valid), registry-TTL
   404 for not-found-yet, 1h 403 for policy blocks, UNCACHED 500s,
   must-revalidate 408s. Our L6 negative caching is single-tier
   (60/300); the refinement worth taking: a structurally-invalid
   spec (not semver-shaped, invalid name) could be cached long —
   its invalidity is a property of the grammar. Cheap follow-up.
3. **aliasKey double-write memoization**: resolving `pkg@^18` once
   stores the answer under BOTH the range key and the resolved
   exact key, so the exact request that follows the 302 is warm.
   Directly applicable to the future bookmark-list/resolution
   cache.
4. **Meta/artifact split-brain self-healing**: metadata present but
   artifact missing → delete metadata, rebuild; undecodable
   metadata → delete, treat as absent. Relevant when we add any
   derived-artifact store (transpile cache is in-process today, so
   trivially coherent — the rule matters at the first persistent
   layer).
5. **`os.OpenRoot`-style rooted extraction** (plus: only regular
   files, per-file and per-stream size caps, extension allowlist,
   symlinks/hardlinks silently dropped). Not needed for serving —
   we have no tarballs — but this is the checklist for CARDPACK ZIP
   OPENING when that lands. Lexical path cleaning is explicitly
   insufficient (pre-planted symlinks).
6. **Credential discipline on redirects**: attach auth only
   same-origin, and strip Authorization in the redirect hook when
   leaving the trusted origin (npm tarballs redirect to third-party
   object storage). Adopt verbatim for cross-realm fetches with
   realm JWTs at catalog-intake time: a realm JWT must never follow
   a redirect off-realm.
7. **Fenced execution as last resort**: static analysis first (Rust
   cjs lexer); only ~15 allowlisted stubborn packages get actually
   imported — under Deno with `--no-prompt` and `--deny-env=<the
   server's own secret vars>`. The posture (deny your own
   credentials to your own subprocesses) is worth copying anywhere
   we shell out on behalf of realm content.
8. **UA sniffing is a warning, not a model**: their UA-based target
   negotiation requires `Vary: User-Agent`, and their own hosting
   guide admits Cloudflare ignores Vary, so the CDN recipe bypasses
   edge cache for non-browser UAs. We are deterministic (no UA
   branching) — stay that way.
9. Smaller notes: disk eviction by statfs threshold + atomic
   rename-then-delete of the whole store; `/status.json` as
   ops+readiness; stack-trace-friendly URL handling (strip
   `:line:col` so pasted error locations resolve); no client rate
   limiting at all — admission control is allowlist/banlist plus
   immutable caching, everything else is the CDN's job.
10. **They do NOT verify npm's tarball integrity** (TLS-only trust,
    same as unpkg) — the second mirror-grade system with this gap.
    As the source of truth we don't inherit it; noted so catalog
    intake (which DOES fetch across realms) verifies by
    contentHash, per the existing intake design.

## 5. Follow-up status (server items APPLIED as deck/07, 2026-08-07)

Built and tested as `deck/07-server-maturity` (9acf1d5906):

1. **Bookmark-list cache** — per-realm-dir, caches the in-flight
   promise (concurrent misses share one jj call — the aliasKey/
   singleflight lesson), event-invalidated immediately after each
   bookmark write by the only two writers (publish, dist-tag move),
   30s TTL backstop, rejections self-evict. This was the efficiency
   ladder's step 1, previously awaiting a go.
2. **Two-tier negative caching** — new `invalid` resolution kind: a
   grammar-invalid spec 404s (`invalid-version-spec`) with
   IMMUTABLE caching; well-formed misses keep 60/300.
3. **Transpile singleflight** — concurrent requests for the same
   `changeId:path` share one compile; shared rejections self-evict.
4. **`baseApi`** — an optional field on `boxel.packages[<name>]`
   (sealed with the tree, like everything in the map), surfaced in
   `?meta`. Alignment as DATA on the package; no package names in
   the server.

Remaining notes (deliberately not built now):

- Test-suite shape (issue-dir corpus + scaffold + single-dir make
  target; `boxel parse`-as-`--check` in consumption tests) — adopt
  as the suite grows past its current 6 scenarios.
- Filed for other tracks: rooted cardpack extraction checklist; JWT
  redirect-stripping at catalog intake; HMR stays outside the
  registry (volatile-execution plan confirmed); variant-in-filename
  if a dev mode ships; compiler-version floors when toolchain
  versioning lands; 408-still-building build queue when any
  expensive artifact class appears.
