# Deck ⇄ Pack equivalence: the matrix

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Written 2026-08-07 from Chris's design direction: **deck and pack
must be as much the same as possible.** A pack is a zipped-up deck.
The packlist is the decklist plus transport facts. Dependencies can
be referenced (a proven web deck the recipient can reach) or
vendored in (PDF-font-style embedding). A pack can live INSIDE a
deck and be used recursively via a path or a local root alias. Both
directions of the transformation belong in the protocol.

Companions: `deck-at-rest-protocol.md` (the at-rest half),
`deck-cardpack-requirements.md` (the recovered cardpack v0.2 logic
this design supersedes and absorbs).

## 1. One identity, four homes

The unifying rule: **identity is the canonical tree hash, not the
container.**

```
treeHash = sha256 over the sorted list of (path, sha256(bytes))
           for every file in the logical tree
```

This one definition resolves the long-open "canonical bundle
hashing shared by CLI + Worker" question: the realm server computes
it from a seal (fileListAt + fileAt), the CLI computes it from a
zip, and they MUST agree byte-for-byte. The zip's own file hash is
NEVER an identity — two byte-different zips (timestamps, ordering)
can carry the same deck.

With one identity, content can live in four homes and stay the
same thing:

| # | Home | Address form | Served how |
| --- | --- | --- | --- |
| H1 | deck at rest | `<realm>/@name@ver/<path>` | file-by-file, immutable |
| H2 | pack as artifact | a `.pack.zip` file / attachment / download URL | moved as one blob |

File form ruling (Chris, 2026-08-07): the pack file is
**`<name>.pack.zip`** — a double extension, like `.tar.gz`. The
`.zip` half is honest: any zip tool on any OS opens it, and no
bespoke MIME type is needed. The `.pack` half marks the format for
tooling to match on. The packlist inside declares the format
version; the extension carries no version. (Supersedes v0.2's
`.cardpack`, which was convention-only and validated nowhere.)
| H3 | pack at rest inside a deck | `<realm>/@name@ver/<packpath>!/<inner>` | file-by-file THROUGH the archive |
| H4 | proven web deck | `@place/publisher/name@ver/<path>` (RRI → some realm's H1) | file-by-file, remote |

H3 is the new home: the `!/` separator marks the archive boundary
(the `jar:...!/entry` and Yarn PnP zip-install precedent — Yarn
resolves modules from inside zips without extraction, in
production, at scale). The server reads the pack bytes at the seal,
opens the central directory, and caches it by the pack's treeHash.
Everything inherits: version addressing, immutable caching,
transpile-on-serve, Content-Digest.

## 2. Carriage modes are import-map values, not new machinery

The three ways a deck or pack can carry a dependency:

| Mode | Meaning | What the map value looks like |
| --- | --- | --- |
| local | the dep is part of this deck | `$DECK/<path>/` |
| **reference** | recipient fetches it from a proven web deck | `https://.../@place/pub/name@ver/` (+ expected treeHash) |
| **vendored** | the bytes ride inside, identity preserved | `$DECK/<vendor-path>/` or `$DECK/<pack>!/` — PLUS a record of the canonical identity |

The insight that keeps deck and pack the same: **the carriage mode
IS the kind of value in the import map.** A web URL is a reference.
A `$REALM` path is local or vendored. Vendoring and unvendoring are
therefore VALUE REWRITES plus byte carriage — the prefix-pair URL
rewriter recovered from cardpack v0.2 is exactly the right tool,
now with a defined job:

- **vendor(dep)**: fetch the dep's files (or its pack), place them
  under a path the packer chooses (placement stays free — the map
  records where), rewrite the map value web→local, and record
  `vendored: {canonical: <RRI>, treeHash}` in the packlist.
- **unvendor(dep)**: verify the local copy's treeHash equals the
  canonical one, rewrite the value local→web, drop the bytes.

Because identity rides along, a recipient can always answer: "this
embedded thing IS @place/maria/money@2.1.0" — dedupe it against a
copy they already have, upgrade it later, or verify it against the
catalog. That is the PDF font model exactly: embedded bytes plus
the canonical name, so a viewer with the real font can substitute.

Rule inherited and hardened from cardpack v0.2: a `reference` entry
MUST carry the expected treeHash (and per-file integrity where
useful). v0.2's referenceUrl was unverifiable metadata; under Deck
it is a verifiable claim — SRI for dependencies.

## 3. Packlist = decklist + transport facts

The pack does not get its own parallel metadata language:

- The realm's `importmap.json` travels INSIDE the pack verbatim —
  it is a file in the tree, so it is already there. Decklists,
  scopes, aliases: unchanged, byte-identical.
- The **packlist** (the pack's manifest) adds ONLY what transport
  needs: the file inventory with per-file hashes and rules
  (copy/exclude/reference/export — v0.2's vocabulary survives),
  carriage records for vendored deps, format version, provenance
  (sourceRealm, sealChangeId, createdBy), and the treeHash.
- Everything the packlist says about CONTENT must be derivable
  from the tree; the packlist may never contradict the map. One
  authority per fact.

So: decklist = what the deck is. Packlist = decklist + how these
particular bits travel. Same schema family, one extension.

## 4. The transformation matrix (both directions, all pairs)

Operations between the four homes:

| From \ To | H1 deck at rest | H2 pack artifact | H3 pack in deck | H4 web deck |
| --- | --- | --- | --- | --- |
| **H1 deck** | publish (seal→bookmark) | **pack()**: canonical zip of a seal (or a live-tree slice) | pack(), then write the artifact into a tree + seal | already is one (serve it) |
| **H2 pack** | **unpack()**: merge into a realm, seal, (re)publish — treeHash preserved ⇒ same identity | re-pack = canonicalize | write the file into a tree; address via `!/` | host the pack; recipients unpack or mount |
| **H3 pack in deck** | unpack in place (materialize into sibling paths) | extract the blob (it already is one) | nest deeper (allowed; discouraged past depth 1) | serve through `!/` — it IS web-addressable already |
| **H4 web deck** | intake/re-home (existing ruling) | **vendor()**: fetch closure → pack | vendor as a pack file into the tree | remap (VN/RRI hosting move) |

Round-trip laws (the protocol's obligations):

1. `treeHash(unpack(pack(D))) = treeHash(D)` — packing is faithful.
2. `pack(unpack(P)) = P` byte-identically, GIVEN canonical zip form
   (sorted entries, zeroed timestamps, fixed compression) — so
   pack() must be reproducible; this is a format requirement, not
   an aspiration.
3. `unvendor(vendor(dep)) = dep` — carriage flips are lossless, and
   each flip is one map-value edit plus verified bytes.
4. Serving `H3` and serving the unpacked `H1` of the same content
   yield byte-identical module responses (same treeHash ⇒ same
   transpile cache keys ⇒ same bytes).

**Faithful vs derived — the one honest exception.** v0.2's `export`
rule (sanitize-pii, default-config, strip-metadata) CHANGES bytes.
A pack containing transformed content is a **derived pack**: it has
a NEW treeHash and must record `derivedFrom: <original treeHash>` +
the transforms applied. The equivalence laws above apply only to
**faithful packs** (copy/reference/vendor rules). Same for
"font-subsetting" — vendoring only the closure-reachable slice of a
dependency: useful, allowed, but it is `subsetOf: <canonical>`, a
derived carriage, never claimed as the canonical identity. Default
is faithful; derivation is always declared.

## 5. Recursive use: pack inside a deck

The cases, concretely:

- **Path use**: `import x from './vendor/money.pack.zip!/accounting/account'`
  — the resolver sees `!/`, asks the archive layer for the inner
  file, and the normal transpile/serve pipeline continues. Works
  identically in the live tree and at a sealed version.
- **Local root alias**: the import map hides the mechanics:
  `"@money/": "$DECK/vendor/money.pack.zip!/"` — consumers write
  `@money/accounting/account` and never see the archive. Flipping
  this ONE VALUE between the `!/` form and a web URL is the
  vendor/unvendor toggle for the whole dependency.
- **Scoped per app**: the same alias can be vendored in one app
  area's scope and referenced in another — scopes already carry
  per-app resolution.
- **Nesting**: `a.pack.zip!/b.pack.zip!/x` composes by construction
  (the resolver is closed over `!/`), but depth >1 is discouraged
  and the tooling should warn — every level adds an opaque layer
  the index cannot see.

Plane rule for H3: a mounted pack serves the MODULE plane in place
(imports, adoptsFrom into the pack). Its INSTANCE plane is not
indexed — packs are opaque blobs to the indexer. To search, render
collections, or link against a pack's instances, unpack (merge)
them into the realm first. This keeps the index out of the archive
business and matches the existing critical-path ruling (module
resolution never depends on the index; now also: the index never
depends on archives).

Security requirements for the archive layer (from the esm.sh
checklist, now normative): rooted reads only — an inner path may
never escape the archive; regular files only; per-file and
per-archive size caps; `!/` parsing happens BEFORE any filesystem
contact; central directories cached by treeHash with a bounded cap.

## 6. What each party must implement

| Capability | Realm server | CLI / packer |
| --- | --- | --- |
| canonical treeHash | from seal (fileListAt+fileAt) | from zip — MUST match |
| canonical zip writer | (optional, for pack-export endpoint) | required |
| `!/` archive resolution | required for H3 | required for local preview |
| vendor/unvendor rewrites | (server never rewrites; serves what is sealed) | required (prefix pairs + carriage records) |
| reference verification | verify treeHash on intake/first fetch | verify on unvendor + on pack open |
| packlist ⇄ decklist checks | publish gate: packlist may not contradict the map | pack(): generate packlist FROM the tree |

Protocol endpoint sketch (future, at-rest-compatible — every one is
a pure function of sealed state):

- `GET <realm>/@name@ver?format=pack` → the canonical pack of that
  sealed deck (derived artifact: build-key caching per L6 rules,
  never `immutable` unless the canonical-zip spec is versioned into
  the key).
- `POST <realm>/_packs/open {path}` → validate + report a pack in
  the tree (packlist, treeHash, derivation status).
- Existing `_history/commit` + publish already cover unpack:
  merge-write the files, seal, publish at the same treeHash.

## 7. Consumption matrix (who can do what, from which home)

| Use | H1 deck | H2 pack file | H3 pack in deck | H4 web deck |
| --- | --- | --- | --- | --- |
| import a module | ✓ | after unpack (or local mount by tooling) | ✓ via `!/` | ✓ |
| adopt (instance → def) | ✓ | ✗ until unpacked | ✓ (adoptsFrom through `!/`) | ✓ |
| index / search instances | ✓ | ✗ | ✗ (opaque) | ✓ (remote's index) |
| install / merge | — | ✓ (strategies: full / instances / definitions) | ✓ (unpack in place) | via intake |
| verify identity | treeHash from seal | treeHash from zip | both, must agree | treeHash from serve |
| carry offline / attach in chat | ✗ | ✓ | ✓ (extract first) | ✗ |

## 8. Rulings on the opens (Chris, 2026-08-07)

1. **Canonical zip: good defaults, versioned.** `canonical-zip-v1`:
   entries sorted by path in byte order; UTF-8 names, forward
   slashes; all timestamps set to the zip epoch (1980-01-01);
   permissions normalized (0644 files, 0755 none — no executables);
   packlist first entry; deflate level 9 via the pinned reference
   deflate. The spec name goes in the packlist AND in the
   `?format=pack` build key, so a constants change is a new spec
   version, never a silent drift. If cross-implementation deflate
   determinism proves fragile in practice, `canonical-zip-v2` falls
   back to STORE (uncompressed entries; HTTP compression covers the
   wire) — the versioning makes that a clean upgrade.
2. **The separator is `!/`** — the jar precedent stands. `!` is
   therefore excluded from legal realm path segments (validators
   updated when H3 lands).
3. **Vendor default prefix is `vendor/`** — a tooling suggestion
   only; placement stays free and the map remains the authority.
4. **`?format=pack` is faithful-only.** Plainly: the server
   endpoint only ever emits an EXACT copy of a sealed deck — same
   treeHash, byte-faithful, no sanitizing, no subsetting. Packs
   that change bytes (sanitized shares, closure subsets) are made
   by TOOLING (CLI), carry a new treeHash plus `derivedFrom`, and
   are never minted by the server. This keeps one invariant simple:
   anything the server hands out under a version IS that version.
