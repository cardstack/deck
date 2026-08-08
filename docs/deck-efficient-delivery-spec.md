# Deck efficient delivery: minify variants, wire compression, modulepreload over H2/H3

**Status: SPEC** (2026-08-08, amended 2026-08-08) — how sealed decks load
fast **without bundling as identity**. Amendments are marked **[A1]**–**[A9]**
and close open questions 1–3; see §10 for the list. Companions: `deck-at-rest-protocol.md` (immutable serve rules;
bundling as derived), `deck-competitive-gaps.md` (G18 cache/edge, G20
waterfall), `deck-esmsh-comparison.md` (variant-in-filename / `?dev`),
`deck-vendor-source-mode.md` (§6 waterfall measurement),
`packages/server/src/inject-importmap.ts` (injection mechanism already
present).

## 0. Problem

Deck refuses to make a bundler the identity of a package. Consumers load
many ESM modules as prescribed by a decklist / import map. That is correct
for forks, seals, and per-module cache — and expensive on a cold network
when each module is:

1. **unminified** (today the server always serves author bytes);
2. **uncompressed on the wire** (no `Content-Encoding` on the reference
   server);
3. **discovered late** (each `import` reveals the next URL only after
   parse — the G20 waterfall);
4. **served over HTTP/1.1** (`node:http` `createServer`) so many small
   GETs also pay connection and head-of-line cost.

Exact versions already carry the right cache promise:

```
Cache-Control: public, max-age=31536000, immutable
Content-Digest: sha-256=…
```

Once a module is at an edge, it never needs invalidation. The remaining
work is **first-paint bytes** and **first-paint fan-out**, not identity.

### Non-goals

- Bundling as the sealed identity of a package (ruled out by at-rest).
- HTTP/2 Server Push (removed from browsers; do not design around it).
- Changing `tree-hash-v1` or lying about `Content-Digest`.
- Minifying `/live/…` or `-dev.N` by default (editability and HMR win).
- Replacing import maps with a custom loader.

### Goals

| # | Workstream | One-line outcome |
| --- | --- | --- |
| A | Release minify variants | Prod consumers get smaller **derived** trees; source seals stay honest |
| B | Wire compression | gzip/br on text responses; identity unchanged |
| C | Closure preload + H2/H3 | Decklist fan-out behaves like a bundle without becoming one |

---

## 1. Ruling (identity vs delivery)

> **Identity is the sealed source tree.** Delivery MAY project that tree
> into smaller bytes (minify) and smaller packets (Content-Encoding), and
> MAY advertise the module closure early (`modulepreload`). None of those
> projections become the package's `treeHash` unless the publisher sealed
> them as their own tree.

This matches the at-rest lineage note: bundling (and by extension minify
of a whole graph) can return as a **derived** artifact keyed by
`(module hash set, toolchain version)`, never as identity. The natural
unit of a derived projection is an **app import-map scope** or a **package
export condition** — not a silent rewrite of `@1.2.3`.

**Honesty rules:**

1. **[A1]** Two digests, because RFC 9530 defines two and they are not
   the same claim:
   - `Content-Digest` digests the **message content as sent** — i.e. AFTER
     any content coding. A brotli response digests the brotli bytes.
   - `Repr-Digest` digests the **representation** — the module bytes,
     encoding aside. This is the one that is stable, the one a client
     verifies after decoding, and the one conformance checks.

   The original rule ("digest before transfer encoding, gzip does not
   change it") described `Repr-Digest` under the name `Content-Digest`.
   That is not pedantry: any edge that re-compresses or decompresses would
   invalidate a `Content-Digest` computed over module bytes, and the
   mismatch would look like corruption. Emit both. Minified body ⇒ both
   digests are over the minified bytes, because that IS the representation
   of the derived tree.
2. `?format=pack` and pack round-trip laws stay about the **sealed
   source** (or the sealed derived tree if that is what was published).
   The server never mint-minifies inside a faithful pack response.
3. Live and trial traffic stay `no-store`. Compression is allowed;
   minify-as-default is not.
4. **[A3]** A signature over the source tree does NOT endorse a derived
   tree. L9 binds a key to a `treeHash`, and a minified projection is a
   different `treeHash` — so `1.2.3` being signed says nothing about
   `1.2.3-min.0`. Without this, a compromised minifier produces bytes that
   inherit trust they were never given. **A derived tree carries its own
   signature**, and `derivedFrom` is what links the two claims.

---

## 2. Workstream A — Minify as a derived sealed variant

### 2.1 Why not minify in place

Minifying `@pkg@1.2.3/foo.js` in the same tree that authors edit would:

- break “fork the bytes you ran”;
- make pack ↔ deck round-trip depend on a toolchain;
- collide with the esm.sh lesson already adopted: **dev and prod must not
  share a cache key**.

So minify is a **variant**, not a header flag on the source URL.

### 2.2 Chosen shape: derived tree + export condition

**Preferred (Deck-native):**

1. Publisher seals source as today → `treeHash_source`, version `1.2.3`.
2. `deck release --minify` (or a post-step) runs a pinned minifier over
   the JS/CSS text files → new tree → `treeHash_min`, version
   **`1.2.3-min.0`**, with dist-tag `production` pointing at it.

   **[A5] Resolves open question 1.** Build metadata is disqualified twice
   over, measured:

   ```
   semver.valid('1.2.3+min')            → '1.2.3'   // stripped; the store rejects it
   semver.compare('1.2.3','1.2.3+min')  → 0         // indistinguishable
   semver.satisfies('1.2.3-min.0','^1.0.0') → false // ranges never pick it up
   ```

   The store requires `semver.valid(v) === v`, so `+min` never publishes;
   and even if it did, it would compare equal to the source version and
   make range resolution nondeterministic. The prerelease form is distinct,
   opt-in only (L5), and satisfies manifest agreement. `latest` cannot point
   at a prerelease under the existing tag rule — which is the behaviour you
   want: prod is an explicit choice, never the default a range drifts into.
3. Meta records provenance:

   ```json
   {
     "derivedFrom": "<treeHash_source>",
     "derivation": {
       "kind": "minify-v1",
       "tool": "terser@<ver>",
       "options": { "…canonically serialized…": true }
     }
   }
   ```

   **[A2] Resolves open question 2: terser, not esbuild.** Minify runs once
   per release, never per request, so esbuild's throughput advantage buys
   nothing here — and it trades compression ratio for speed, which is
   backwards for a workstream whose whole goal is fewer bytes. The argument
   that settles it is reproducibility: **terser is pure JS, so its output
   does not vary by platform.** A native minifier can differ across
   architectures, which would make `derivation` a claim nobody can check.

   **[A4] A derivation that cannot be re-run is a story, not a record.**
   `deck verify-derivation` re-minifies the source tree with the recorded
   tool and options and asserts the result equals `treeHash_min`. Options
   are serialized canonically (sorted keys) so the record is comparable.
   This is L11 applied to derived trees: an unverifiable claim is refused.

4. Consuming **apps** point their prod import map at the min tree’s exact
   URLs. Source / live maps keep pointing at source or `@live`.

**Allowed alternative (esm.sh-compatible):** variant **in the filename**
inside one sealed tree — `foo.js` (source) and `foo.min.js` (min), with
`exports` / import map choosing. Still two byte identities; both listed
in the same packlist. Use when the publisher wants one version number and
two files.

**Rejected:** `?minify=1` on the source URL as the prod default. That is
compiler output wearing a sealed address. If ever offered for demos, it
must use the transpile-style short TTL + build-key pattern already ruled
for `.gts`/`.ts` — never `immutable` for toolchain-shaped bytes.

### 2.3 What gets minified

| Path class | Minify? |
| --- | --- |
| `.js` / `.mjs` / `.css` text modules | yes |
| `.json` (import maps, data) | optional whitespace squeeze only; do not reorder keys if the file is a seal-facing map |
| `.html` | no (injection targets stay stable); optional later |
| binaries, wasm, images, `.map` | no |

Source maps for min trees are encouraged as sibling `.map` files in the
**derived** tree so debugging does not require shipping fat prod modules.

### 2.4 CLI / serve sketch

```
deck release --store … --name ink --from 1.2.3 --minify
# publishes derived tree, tags `production` → that exact version
# (or writes exports["."].production in a derived importmap.json)
```

Serve rules unchanged: exact ⇒ `immutable` + digest of **those** bytes.

---

## 3. Workstream B — Wire compression (gzip / brotli)

### 3.1 Ruling

> **Store bytes stay logical file bytes (or deflate-raw blobs named by
> uncompressed sha256).** Transport MAY apply `Content-Encoding: gzip`
> or `br` based on `Accept-Encoding`. Compression is not part of
> `tree-hash-v1`.

Pack-at-rest deflate and HTTPS compression are different layers. A client
that asks for `@pkg@1.2.3/foo.js` receives the module body; Transfer /
Content encoding is hop packaging.

### 3.2 Behaviour

**[A10] Origin is gzip-only. Brotli, HTTP/2 and HTTP/3 are Cloudflare's
job.** Compressing to brotli at the origin would burn CPU on every cache
miss producing bytes the edge re-encodes anyway; the edge does it once and
caches it closer to the client. Origin does the cheap universal thing.

| Request | Response body encoding |
| --- | --- |
| `Accept-Encoding: gzip` and text type | `gzip` |
| `Accept-Encoding: br` only | identity — the edge adds brotli |
| identity only / binary already compressed | no content encoding |
| body below ~1 KB | no content encoding — the framing costs more than it saves |
| `?format=pack` (application/zip) | identity; a zip is already deflated |

**[A6] `Vary: Accept-Encoding` is mandatory on any response that
negotiated.** Without it a shared cache hands a brotli body to a gzip-only
client, which is the classic compression-behind-a-CDN failure. It was absent
from this document entirely.

Note the tension worth planning for: `Vary` and `immutable` interact poorly
on some CDNs, which is why large edges normalise `Accept-Encoding` to a
small set before it reaches the origin. Precompressed siblings (§3.5) avoid
most of this by making the encoded body a stored object rather than a
per-request computation.

**Reference server today:** no negotiation — gap.

**Edge / CDN:** may compress on the fly or store precompressed siblings
(`foo.js.br`) keyed by the same URL + encoding. Because exact URLs are
immutable, precompression is safe and cheap.

### 3.3 Interaction with the digests

**[A1]** Per §1 rule 1, a compressed response carries both:

```
Repr-Digest:    sha-256=:<digest of the module bytes>:
Content-Digest: sha-256=:<digest of the bytes actually sent>:
Vary:           Accept-Encoding
```

When no coding is applied the two are equal, which is why the uncompressed
case looks unchanged. Clients and conformance verify `Repr-Digest` after
decoding; `Content-Digest` is what a proxy can check without decoding
anything.

### 3.5 ~~[A7] Precompress at seal time~~ — withdrawn by [A10]

Storing `.br` siblings was the right idea against a bare origin. With
Cloudflare in front, **the edge cache IS that store**, and it is closer to
the client than the object directory ever will be. The negotiation keeps a
`precompressed` seam so an origin without an edge could fill it later;
nothing populates it today.

<details><summary>Original A7 text</summary>

### Precompress at seal time, not per request

Compression is currently framed as something the edge may do. For **exact
addresses it should be done once, ever** — they are immutable, so
recompressing them per request per edge is pure waste.

Store the encoded form beside the object it encodes:

```
<store>/_objects/<aa>/<sha256>        the object (deflate-raw, named by
                                      the sha256 of its UNCOMPRESSED bytes)
<store>/_objects/<aa>/<sha256>.br     the brotli encoding of those bytes
```

Properties that make this safe: it is keyed by the object hash, so it
dedupes exactly as objects do; it is **not part of any tree** and therefore
cannot touch `treeHash`; and it is regenerable, so losing it costs CPU and
nothing else. `deck store gc` collects it with its object.

On-the-fly compression then exists only for **live**, where the bytes change
and precomputing is pointless. Brotli at maximum quality is far too slow to
run per request but entirely reasonable once per version — which is the
same shape of argument as choosing terser over esbuild.

</details>

### 3.4 Why this alone is not enough

Gzip/br typically win ~3–5× on JS. They do not reduce request count or
the discovery waterfall. They stack with A and C.

---

## 4. Workstream C — Decklist fan-out without bundling

### 4.1 What bundling actually buys

| Bundle benefit | Deck substitute |
| --- | --- |
| Fewer bytes (DCE + minify + scope sharing) | Workstream A (+ optional later derived bundle for an **app** scope) |
| One request | Not required if fan-out is parallel and cached |
| No discovery waterfall | **`modulepreload` of the sealed closure** |
| One TCP connection | **HTTP/2 or HTTP/3 multiplexing** |

### 4.2 HTTP/2 and HTTP/3 — what they fix

- **HTTP/2:** many module GETs on one connection; ends HTTP/1.1
  connection thrash and head-of-line blocking at the TCP layer for
  parallel streams.
- **HTTP/3 (QUIC):** same multiplexing story; better under loss (mobile).

Neither protocol tells the browser which URLs to fetch next. Without a
preload list, `a → b → c` still costs sequential RTTs of *discovery*.
Multiplexing only helps once the URL set is known.

**Do not use Server Push.** Browsers removed it; `modulepreload` is the
replacement the platform kept.

### 4.3 `modulepreload` injection (the G20 answer)

The server already injects an inline import map into HTML
(`injectImportMap`). Extend that rendering step:

1. Resolve the page’s import map (sealed version’s `importmap.json`, or
   the live map for `/live/…` HTML — live preload is optional and must
   not be cached as immutable).
2. Compute the **static module closure** for the entry module(s) listed
   by the decklist / `boxel.packages` entry / `<script type=module>`.
3. Inject into `<head>`:

   ```html
   <link rel="modulepreload" href="/<realm>/…/@pkg@1.2.3/a.js" crossorigin>
   <link rel="modulepreload" href="/<realm>/…/@pkg@1.2.3/b.js" crossorigin>
   ```

4. **[A8] Budget by BYTES, order breadth-first, and never truncate
   silently.** Count is the wrong unit — 374 tiny modules are cheap and
   twenty large ones are not. Breadth-first from the entry buys the early
   RTT waves, which is the whole point. When the budget clips the list, say
   so: `x-deck-preload: 40/374`. A cap nobody can see reads as "we covered
   it" when we did not. *(Resolves open question 3.)*

**Closure source of truth:** prefer a sealed **decklist lock** or packlist
walk from known entries over runtime heuristics. Dynamic `import()` that
is not statically visible stays out of the preload set (same as bundlers).

**[A8] Resolution must respect scopes.** "Resolve the page's import map" is
no longer sufficient: since aliased dependencies landed (L7), a vendored
dependency's bare specifiers resolve through **its own** records, not the
app's. `three-bvh-csg` importing `three` resolves via the deck that answers
for `three` in *its* map. Walking with the app's map alone produces URLs
nobody will request.

**[A8] A preload that does not match the real request is worse than
none** — the browser fetches twice and the page gets slower. Two rules
follow. `crossorigin` is required, because module fetches are always
CORS-mode and a mismatched credentials mode causes exactly that double
fetch. And the injected `href` must be **byte-identical** to what the
module resolver will ask for, after import-map resolution — not merely
equivalent. §7 gains a check for this.

### 4.4 “As if bundled”

With A + B + C on an edge:

- **Cold visit:** browser opens one H2/H3 connection, fetches the
  preloaded closure in parallel, each body br-compressed (and ideally
  minified). Latency looks like downloading several chunks of one
  bundle; scheduling is the browser’s.
- **Warm / update visit:** immutable per-module cache means only
  changed modules refetch — **strictly better than a monolith bundle**
  when one dependency flips.

That is the product claim to keep: *bundle-like cold path, module-grain
updates.*

### 4.5 Optional derived app bundle (later, still not identity)

If a specific app scope still needs one file for pathological networks,
emit a derived artifact keyed by `(sorted module digests, bundler
version)` and address it as its own sealed tree or attach. Never replace
`@pkg@1.2.3` source identity with that blob. Natural unit = app import-map
scope (at-rest already says this).

---

## 5. Serving matrix (target)

| Address | Minify | Content-Encoding | Cache | Preload eligible |
| --- | --- | --- | --- | --- |
| `/live/…` | no | yes (optional) | `no-store` | optional, short-lived |
| `@tag` / range | n/a (302) | n/a | short | no (follow exact) |
| `@exact` source | no | yes | `immutable` + digest | yes |
| `@exact` min derived | yes (sealed) | yes | `immutable` + digest | yes |
| `?format=pack` | n/a | usually identity | `immutable` | n/a |
| HTML with inject | — | yes | per mutability | inject map + preloads |

---

## 6. Build slices

| Slice | Deliverable | Depends |
| --- | --- | --- |
| B1 | `Accept-Encoding` gzip/br on text routes, `Vary`, `Repr-Digest` | none |
| ~~B2~~ | ~~precompressed `.br` siblings~~ — withdrawn by [A10] | — |
| C1 | `injectModulePreload(html, urls[])` next to import-map inject | none |
| C2 | scope-aware closure walk from entry + packlist / lock | C1 |
| C3 | **[A10]** document that Cloudflare terminates h2/h3 and adds brotli | ops |
| A1 | minify derivation record in meta + `deck release --minify` (terser) | none |
| A2 | `production` tag convention → `1.2.3-min.0` | A1 |
| A3 | **[A4]** `deck verify-derivation` re-runs and compares | A1 |
| M1 | conformance: Repr-Digest after decode; preload matches real requests; derived tree ≠ source tree | A/B/C |
| M2 | **[A9]** WAN measurement before the §4.4 claim is published | B1, C2 |

Order of payoff: **B1 → C1/C2 → C3 → A1**. Compression and preload are
pure server/render wins; minify needs a release UX decision.

Everything above is buildable with **no native binary**: `node:zlib` covers
gzip and brotli, the closure walk reuses the ES tokenizer already in core,
and terser is pure JS.

---

## 7. Conformance / honesty checks

1. Exact source URL body equals pack entry bytes (existing law).
2. Exact min URL body equals **derived** pack entry bytes; digests match
   that body; `derivedFrom` present in meta.
3. **[A1]** A response with `Content-Encoding` verifies `Repr-Digest` on
   the decoded bytes AND `Content-Digest` on the encoded bytes, and carries
   `Vary: Accept-Encoding`.
4. Live HTML never receives `immutable` preloads for live module URLs.
5. Injecting preloads does not change `?format=pack` or treeHash (same
   class of honesty as import-map injection today).
6. **[A8]** Every injected `modulepreload` href appears in the set of URLs
   the page actually requests — a preload nobody uses is a regression, not
   a no-op.
7. **[A3]** A derived tree does not report the source tree's signatures.
8. **[A4]** `verify-derivation` reproduces `treeHash_min` from the source
   tree plus the recorded tool and options.

---

## 8. Open questions

1. ~~Semver shape for min trees~~ — **resolved [A5]:** `1.2.3-min.0` plus a
   `production` dist-tag. Build metadata is rejected by the store and
   compares equal to the source version.
2. ~~Minifier pin~~ — **resolved [A2]:** terser, because it is pure JS and
   therefore reproducible across platforms.
3. ~~Preload budget~~ — **resolved [A8]:** byte budget, breadth-first,
   reported when clipped.
4. **Whether `-dev.N` ever auto-minifies** — default no; agents can opt
   in for demos.
5. **HTTP/2 in-process vs proxy** — reference server may stay h1 for
   simplicity if `deck serve` docs say “put Caddy/nginx/CF in front for
   h2/h3 + br”.
6. **[A9] Is §4.4 true?** "Bundle-like cold path" is an untested claim; the
   only number this repo has is 248 requests in 102 ms on localhost, which
   has no latency and therefore cannot show a waterfall at all. Measure
   cold, throttled, with and without preload, before the claim is published
   anywhere a reader would rely on it. The claim either survives or gets
   rewritten.

---

## 10. Amendments (2026-08-08)

| | Change | Kind |
| --- | --- | --- |
| A1 | `Repr-Digest` for the representation, `Content-Digest` for the wire | correction |
| A2 | terser, not esbuild — pure JS, so reproducible | resolves Q2 |
| A3 | a derived tree needs its own signature; source endorsement does not carry | correction |
| A4 | `deck verify-derivation` re-runs the derivation and compares | addition |
| A5 | `1.2.3-min.0`; build metadata rejected, measured | resolves Q1 |
| A6 | `Vary: Accept-Encoding` is mandatory — was absent entirely | correction |
| A7 | precompress once at seal time into `_objects/<sha>.br` | addition |
| A8 | scope-aware closure; byte budget, breadth-first, reported; preload must match the real request | resolves Q3 |
| A9 | WAN measurement gates the §4.4 claim | addition |
| A10 | origin is gzip-only; brotli + h2/h3 are Cloudflare's, so A7 is withdrawn | ruling |

---

## 9. Honest status (this repo, 2026-08-08)

| Piece | State |
| --- | --- |
| Exact `immutable` + `Content-Digest` | Built & tested |
| Import-map injection | Built & tested |
| Modulepreload injection | **Not built** (specified here) |
| Wire gzip/br | **Not built** |
| Minify derived release | **Not built** |
| HTTP/2 or HTTP/3 on reference server | **Not built** (proxy-OK) |
| Bundling as identity | **Ruled out** |
| Derived app bundle | Optional later; not required for this spec |

Until the slices land, prod efficiency is: pin exact versions, put a
compressing HTTP/2 edge in front of the reference server, and hand-author
`<link rel="modulepreload">` for critical modules. This document is the
contract for making that the server’s job.
