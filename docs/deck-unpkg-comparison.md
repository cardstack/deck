# Deck vs. unpkg (modern rewrite): what a production ES-module registry teaches us

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Status: APPLIED 2026-08-07 — P1.1–P1.5, P2.1–P2.4 are built and
tested as the `deck/06-serving-hardening` stacked commit (003536b952);
P3.x remain adoption notes for when their subsystems arrive. Error
codes landed kebab-case (matching the existing gate-refusal codes),
not SCREAMING_CASE. Originally written 2026-08-07 from a full source
read of
`~/Projects/unpkg` (Cloudflare Workers monorepo: unpkg-www file CDN,
unpkg-esm transformer, unpkg-files Fly.io origin, unpkg-worker shared
lib, plus the 891-line `docs/esm-unpkg-spec.md`). Compared against the
Deck at-rest implementation on the `deck/*` stacked branches
(HEAD cc0be4c532). Companion: `deck-at-rest-protocol.md`.

The two systems differ in **sourcing** and agree in **delivery**:

|                | unpkg                                   | Deck |
|----------------|------------------------------------------|-----|
| Source of truth| npm registry (mirror; trusts upstream)   | the realm itself (jj seals; registry IS the truth) |
| Origin storage | none — re-streams tarballs every miss    | jj repo (sidecar) |
| Version unit   | npm tarball                              | sealed tree at a changeId |
| Manifest       | package.json (npm's)                     | importmap.json (`boxel.packages`) |
| Immutability   | trusted from npm; not enforced locally   | enforced at publish (`bookmarkCreate` refuses duplicates) |
| Cross-pkg deps | rewritten URLs (esm) / import maps (external mode) | import map scopes; relative imports resolve inside the snapshot |

The load-bearing shared insight, stated best by unpkg's design:
**immutability is a property of the URL grammar, not of storage.** The
unpkg origin accepts only exact canonical versions
(`semver.clean(v) === v` or 404); all range/tag mutability lives in
short-TTL redirects at the edge. We arrived at the same split
independently (exact = long cache, spec = 302). That architecture is
validated.

---

## 1. Where we match unpkg already (parity — no action)

- Two URL classes: friendly (range/tag, short TTL redirect) vs.
  versioned artifact (long cache). Same design in both systems.
- `semver.maxSatisfying` with npm prerelease exclusion, and the
  exact-version check running **before** range matching (so
  `1.0.0-beta.1` in a URL matches directly even though a bare range
  would exclude it). unpkg: `pkg-version.ts:14`. Ours: `resolveVersionSpec`.
- Decode-then-parse of the pathname (`%5E18` ≡ `^18`).
- Dist-tags as movable pointers over immutable versions.
- Bare specifiers left bare for import maps: unpkg's `?external`
  mode exists precisely to support import-map workflows. Our whole
  system is that mode by default — the import map is the primary
  mechanism, not the escape hatch. Strong validation of the
  importmap.json direction.
- Relative-import version consistency: unpkg-esm bundles
  package-internal files to keep them consistent; we serve a whole
  sealed tree at a version, which is stronger (no bundling needed).
- Path traversal refused in map values (`treePathFromMapValue`);
  unpkg actually has a traversal GAP in its tar extraction
  (`withPackageFileDirectory` joins entry names without `..`
  sanitization) — trusting npm. Not applicable to us; we have no
  tarball ingest.
- No execution of package code during serving/builds (their security
  rule; our BXL boundary rule — server never runs realm JS).

## 2. Where we are ahead (keep; do not regress)

- **Publish-side immutability enforcement.** unpkg inherits it from
  npm and never verifies npm's own tarball integrity. We enforce it
  ourselves (duplicate bookmark refused) and identity is a jj
  changeId — the registry cannot silently change bytes.
- **Sealed manifest travels with the version.** unpkg re-derives
  everything from package.json inside the tarball; we do the same from
  importmap.json at the changeId — parity of mechanism — but ours also
  carries per-app `scopes`, which npm/unpkg cannot express.
- **Actor-attributed audit log** (jj seals). No unpkg equivalent.
- **Multi-package-per-realm with arbitrary paths.** npm's model is
  one package = one tarball root. Ours is a superset.

## 3. Borrow list — gaps unpkg exposes in our implementation

Ranked. P1 = correctness bugs in what we built; P2 = protocol surface
we should add while the design is fresh; P3 = ops discipline to adopt
when we harden.

### P1.1 — Transpiled output must not be `immutable` (correctness bug)

unpkg's hard rule, stated in the spec and held everywhere in code:
**build artifacts must not use `immutable` cache semantics because the
output also depends on the transformer implementation.** Their
transformed responses get `public, max-age=60, s-maxage=300`; their
build key hashes the options **plus a service-version string**
(`"esm-build-service-v1"`) so a transformer upgrade invalidates
everything at once (`X-UNPKG-Build-Key`).

Ours: `handle-package-serve.ts` serves transpiled `.gts` with
`public, max-age=31536000, immutable`. The in-repo comment argues
"historical bytes transpile byte-identical" — true only for the
*current* transpiler. Upgrade Babel or the loader plugin and every
browser that cached transpiled output keeps stale semantics for up to
a year, with no purge handle.

Fix options (pick one):
a. Split the promise: raw source (`Accept: application/vnd.card+source`)
   stays `immutable, 1y` (bytes are sealed — genuinely immutable);
   transpiled output drops to `max-age=60, s-maxage=<hours>` +
   `X-Boxel-Build-Key: sha256(changeId, path, transpilerVersion)`.
b. Keep 1y on transpiled but put the transpiler version in the cache
   identity (a `?tv=<hash>` param the loader appends, or a
   Cache-Tag-style purge path). More moving parts.
Option (a) is the unpkg-proven shape and costs one constant.

### P1.2 — 302 + `immutable` is self-contradictory; use 301 for canonical-form redirects

unpkg encodes mutability in the redirect status itself:
- **301** when the URL's version was already exact and only the *form*
  changes (extensionless → real path, entry resolution, alias) —
  permanent, because the answer can never change.
- **302 + `max-age=60, s-maxage=300`** only when a range or tag was
  resolved — the answer can move.

Ours: bare-form → entry and alias → path are **302 with
`immutable, 1y`** — a temporary status with a permanent cache header.
Browsers treat cached 302s inconsistently. Change the exact-version
entry/alias redirects to **301** (they derive from a sealed map — the
answer is frozen forever), keep 302 + short TTL for range/tag. One-line
status changes.

### P1.3 — One-hop canonicalization

unpkg resolves tag/range AND entry in a single redirect:
`/react@latest` → one 302 → `/react@18.2.0/index.js` (entry resolution
runs *before* the version-canonicalization redirect). Check our chain
for `@name@latest` (bare form): if it is 302-to-exact-bare then
302-to-entry, collapse to one hop. Redirect-chain length is a designed
property, and every hop is a round trip for the browser loader.

### P1.4 — Negative caching for resolution misses

unpkg-esm marks 404s (unknown package, unknown version) cacheable JSON
at `max-age=60, s-maxage=300` — deliberate short negative caching so a
storm of requests for a missing version does not hammer resolution.
Ours: 404s carry no cache header. Add the short TTL to
`_packages` and serve-path 404s. (unpkg-www leaves 404s uncacheable —
the two philosophies coexist there; for us the registry is also the
origin, so negative caching pays directly.)

### P1.5 — HEAD = GET minus body, at the outermost layer

unpkg implements HEAD by running the full GET path and returning
`new Response(null, response)` at the outer edge — HEAD never has a
separate code path to drift, and never poisons a cache. Verify Koa
gives us this for the serve handler; if not, one wrapper.

### P2.1 — A `?meta` / listing surface (files + integrity at a version)

unpkg's `?meta` returns, for an exact version:
`{package, version, files: [{path, size, type, integrity}]}` —
flat recursive list, per-file SRI (`sha256-<base64>`), 1-year cached.
The esm variant adds: resolved version, canonical module URL, types
URL, export subpaths, build options, and an artifact-level `sha384`
integrity.

We have no machine-readable "what is in this version" endpoint. It is
the missing enabler for: the GitHub mirror (walk a version without N
requests), install/import consumption modes, import-map generation
tooling, and future SRI. Shape for us:

```
GET <realm>/@<name>@<exact>?meta
→ { name, version, changeId, entry, exports,
    files: [{path, size, type, integrity}] }
```

Derivable entirely from the sealed tree + map cache; immutable
cacheable; no new state.

### P2.2 — Content-Digest (RFC 9530) on exact-version responses

unpkg computes a streaming per-file SRI hash once at the origin and
*transports* it as `Content-Digest: sha256=:<hash>:`; workers parse it
back rather than rehashing. Borrow both halves: emit `Content-Digest`
on our exact-version raw responses (compute at first serve, cache
beside the transpile cache), and let any future mirror/CDN layer carry
it forward instead of recomputing. This is also the seed of SRI-ready
import maps (`integrity` attributes) and of the catalog's
trust-by-contentHash story.

### P2.3 — Error taxonomy: coded JSON, stable codes

unpkg-esm errors are JSON `{"error": {"code", "message", ...context}}`
with a small closed set of codes (`PACKAGE_NOT_FOUND`,
`PACKAGE_VERSION_NOT_FOUND`, `INVALID_QUERY`, `UNSUPPORTED_TARGET`,
422 for untransformable, 415 for unsupported source type, 504 for
upstream timeout). Agents consume these; prose 404 bodies rot into
string-matching. Adopt the shape for `_packages` and serve errors:
`PACKAGE_NOT_FOUND`, `VERSION_NOT_FOUND`, `NOT_IN_MANIFEST`
(our "no boxel.packages entry"), `MANIFEST_MISMATCH` ("declares
x@y"), `TRANSPILE_FAILED` (keep 422 — same status unpkg chose).

### P2.4 — Reserved-path collision policy, stated

unpkg reserves the exact path `/run` and lets `/run@1.0.0` fall through
to package resolution; tests pin the boundary. Our `_packages`/
`_registry`/`_history` prefixes are safely underscore-namespaced, but
the serve grammar (`@name@spec`) could in principle match a real realm
file whose path contains that shape. Add one test that a literal file
named like `@foo@1.0.0/x` behaves per our chosen rule, and state the
rule in the protocol doc (recommend: serve grammar wins; the pattern is
reserved).

### P3.1 — Corpus + failure-classification discipline

The strongest idea in their docs is not code: a **version-pinned
scenario corpus** (packages chosen to cover the rough edges, not the
top-100 easy cases), run against the service, with **every failure
classified** into a named bucket (resolver mismatch, interop, timeout,
intentional exclusion...) and stored as diffable JSON. Their launch
gates are corpus numbers, not feature checklists. Our analog: a corpus
of realm shapes (multi-package, scoped apps, prerelease lines, alias
exports, deep trees, weird-but-legal paths) exercised against the
serve/registry endpoints as one test file, with classified expected
outcomes. This composes with our fixture rules for migrations — same
philosophy, one level up.

### P3.2 — Timeout taxonomy with a distinct status

Their origin wraps upstream fetch + untar in one 30s `AbortSignal`
and classifies it as a dedicated error → **504**, distinguished from
404 and 500, with careful AbortError-vs-TimeoutError discrimination.
When we grow the jj-lib read path or any cross-realm fetch, give
timeouts their own typed error and status from day one.

### P3.3 — Purge handles on behavior-dependent responses

unpkg puts `Cache-Tag: meta` / `js-module` on the two 1-year-cached
response classes whose bytes depend on *code* (listing renderer, import
rewriter) so a logic change can be purged at the CDN without touching
immutable raw files. Whenever we add a CDN in front of the realm
server, our transpiled and `?meta` responses need the same tag-or-key
purge story (P1.1's build key already covers most of it).

### P3.4 — Edge-cache admission rules

Their worker caches only `GET` + `200` + has-`Cache-Control`, writes
via `waitUntil`, and strips `Set-Cookie` before caching. Small,
battle-tested rules to copy verbatim into any future caching layer
(bookmark-list cache, CDN worker).

## 4. Ideas noted, deliberately NOT borrowed

- **CJS→ESM synthesis, Node-builtin polyfills, bundling modes** — the
  bulk of unpkg-esm's complexity exists because npm's corpus is CJS
  and Node-shaped. Our corpus is ESM-native `.gts`/`.ts` by
  construction; importing this machinery would be solving npm's
  problem. (If Deck ever ingests npm packages, unpkg-esm is the
  reference implementation to wrap, not rewrite.)
- **`&flag/` path-query syntax** — exists because import-map prefix
  keys cannot carry `?`. We put options in the map's *values* and have
  none of these per-request flags yet. Revisit only if serve options
  (e.g. `?raw` as a query instead of Accept) appear.
- **`?deps`/`?alias` overrides** — consumer-side version overrides at
  request time. Our answer is editing the consumer realm's import map
  (scopes), which is durable and sealed rather than per-URL. Better fit.
- **Case-insensitive file matching** — unpkg's UX nicety over npm's
  case-chaos. Realm paths are IDs; case-sensitivity is the contract.
  Keep exact matching; do not import the nicety.
- **User-Agent-independent default target** (`es2022`) — good
  principle (determinism over sniffing), already our behavior since we
  have no targets.

## 5. Implementation status (applied as deck/06)

All of P1 and P2 landed in one stacked commit (`deck/06-serving-hardening`,
003536b952), tested end to end:

- P1.1 — transpiled responses: short TTL + `x-boxel-build-key`
  (hash incl. `TRANSPILE_SERVICE` version) + etag/304; raw bytes keep
  `immutable, 1y`.
- P1.2 — 301 for exact-version form redirects (bare→entry, alias);
  302 short-TTL only for range/tag resolution.
- P1.3 — one-hop canonicalization (version + entry/alias in a single
  redirect); the query string survives redirects.
- P1.4 — coded JSON 404s with short negative caching (serve + registry).
- P1.5 — HEAD rides the GET path (koa strips the body).
- P2.1 — `?meta` on the bare exact form: entry, exports, changeId,
  full file listing (new `fileListAt` on the CLI history backend).
  Per-file integrity in the listing is future work; per-response
  `Content-Digest` covers the current need.
- P2.2 — `Content-Digest` (RFC 9530, sha-256) on raw and transpiled
  responses.
- P2.3 — stable kebab-case error codes in the existing
  `errors: [{code, detail}]` shape.
- P2.4 — reserved-grammar rule stated in the handler and pinned by a
  test (a literal `@name@spec`-shaped file is shadowed by the route).

P3.1–P3.4 (corpus discipline, timeout taxonomy, purge handles,
edge-cache admission rules) remain adoption notes for when their
subsystems arrive.

None of these touch the descope ruling: no workflows, no
authorization, no migration gate — all remain at-rest properties of
serving and state.
