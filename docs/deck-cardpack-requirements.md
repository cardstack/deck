# Cardpack: recovered requirements, and the two-plane model with Deck

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Written 2026-08-07. Source: a full read of the cardpack implementation
on `boxel-cli` branch `origin/feature/cardpack-and-integration-tests`
(~5,000 lines: `src/pack/*`, `src/commands/pack.ts`, `test/pack/*`).
The product requirements were vetted but never written down; the code
and its tests embody them. This document writes them down, and states
how cardpack relates to the Deck protocol.

## 0. The two-plane model (the ruling this doc captures)

The system has two planes:

- **The definition plane** — modules: `.gts`/`.ts` card definitions
  and their imports. **A deck lives here.** A deck is MOSTLY
  definitions; its decklist enumerates modules; the instances that
  use a deck live outside it, in consumer realms, pinned by
  `adoptsFrom`.
- **The instance plane** — documents: `.json` card instances, their
  `adoptsFrom` links into the definition plane, and their
  `relationships` links to each other.

**A cardpack walks BOTH planes.** Its closure starts anywhere,
follows instance relationships AND module imports, and captures a
working set — data with the code the data needs — as one artifact.
That is what makes it the right carrier for "share an app WITH its
seed/example content" and the open-like-a-PDF flow.

Refined relationship (amends the earlier "cardpack = sealed deck as
bits" ruling with the general case):

> The cardpack is the closure carrier across both planes.
> A cardpack whose content is exactly one decklist (definitions
> only) is that sealed deck's transport form — the npm-tarball
> analog. The general cardpack is BIGGER than a deck: it also
> carries instances and their relationship closure.

The merge strategies in the implementation already operationalize
the split: `definitions-only` (= the deck slice), `instance-only`,
`full` (both planes).

## 1. Archive format (as implemented, format 0.2.0)

- A `.cardpack` is a standard ZIP. The internal layout mirrors the
  source realm tree (relative paths, forward slashes). (Ruled
  2026-08-07: the v0.3 file form is **`.pack.zip`** — see
  `deck-pack-equivalence.md`; `.cardpack` is the v0.2 legacy name.)
- Exactly one `manifest.json` at the root, always the FIRST zip
  entry. No manifest → the archive is invalid.
- **The manifest is itself a Boxel card document**: `meta.adoptsFrom
  = {module: '@cardstack/cardpack', name: 'Manifest'}`, with
  attributes: `version` ('0.2.0'), `createdAt`, `createdBy` (from
  the CLI profile, else 'unknown'), `sourceRealm` (from
  `.boxel-sync.json` workspaceUrl, else the directory path),
  optional `description`, and `entries[]`.
- Per entry: `path`, `contentType`, `size`, `hash` (SHA-256 hex of
  the STORED bytes — post-transform), `rule`
  (`copy|reference|exclude|export`), `referenceUrl` (iff reference),
  `transform` (iff export), and a declared-but-never-written
  `sourceRealm` provenance field.
- `exclude`/`reference` entries appear in the manifest with
  `size: 0, hash: ''` and no bytes in the zip.
- **No bundle-level hash or pack id exists** — integrity is per-file
  only. (Gap; see §8.)
- Text-classified files are compressed; binary is stored. A bespoke
  content-type table maps extensions; `.gts` is
  `application/vnd.card+source`.
- Reading validates manifest structure strictly (missing `rule`
  defaults to `copy` — the only 0.1.0 accommodation), but
  manifest-vs-content hash/size validation is WARN-ONLY at extract
  and skipped entirely after URL rewriting.

## 2. Closure walker

BFS from a root file, visited-set for cycles, no depth limit.
Missing referenced files are silently dropped.

What counts as a dependency:

- From `.gts`/`.ts` (definitions): every ES import specifier
  (regex-based), plus `@field x = linksTo|linksToMany|contains|
  containsMany(Type)` declarations resolved through the file's
  import map (with `as`-alias handling). Unimported types are
  assumed local and skipped.
- From `.json` (instances): `meta.adoptsFrom.module` (the bridge
  from instance plane to definition plane), and every
  `relationships.*.links.self`, including numbered `linksToMany`
  keys (`tags.0`, `tags.1`). Malformed JSON is packed but yields no
  further deps.
- Resolution order differs by plane: module specifiers probe
  `.gts → .ts → .js → .json` and `index.*`; instance refs probe
  `ref + '.json'` first — instance links are extensionless
  instance URLs, module imports are extensionless module paths.
- External = specifier starts with `http(s)://`. Externals are
  recorded with reason and referencedBy but NOT packed — and (gap)
  are then DISCARDED when the archive is built, so the manifest
  never records the pack's cross-realm requirements.
- Instances link to definitions; nothing in a definition pulls in
  instances. The planes are asymmetric by construction.

## 3. Rule system

Ordered rules `{pattern, rule, transform?, referenceUrl?}`, CLI form
`glob:rule[:arg]`. First match wins; default is `copy`. Minimal glob:
`*` (all), `*.ext` (suffix anywhere), `Dir/*` (one level), `Dir/**`
(recursive), else exact path.

- `copy` — bytes verbatim.
- `exclude` — manifest entry kept, bytes omitted; never
  materialized on extract/merge.
- `reference` — like exclude plus a recorded `referenceUrl`
  ("lives at that URL instead of in the pack"). Currently
  metadata-only: nothing ever fetches it, and the URL is the raw
  per-rule string, not resolved per file. (Gap.)
- `export` — bytes pass through a named transform; the TRANSFORMED
  bytes are stored and hashed.

## 4. Transforms (all de-facto instance-only)

Three built-ins, each a JSON-tree walk that no-ops on non-JSON (so
module source always passes through unchanged):

1. `sanitize-pii` — emails → `<email>`, US phone numbers →
   `<phone>`, in any string value, including substrings.
2. `default-config` — any string whose KEY is in {apikey, api_key,
   secret, token, password, privatekey, private_key,
   connectionstring, connection_string} (case-insensitive) →
   `"REPLACE_ME"`.
3. `strip-metadata` — deletes `meta.realmInfo`, `meta.realmURL`,
   `meta.lastModified` (PRESERVES `meta.adoptsFrom`), and every
   `_`-prefixed attribute.

All three re-serialize with 2-space indentation (a formatting
normalization side effect).

## 5. URL rewriting (the retargeting mechanism)

Prefix-pair rules `{from, to}`; first match per string wins.
Dispatch by extension:

- `.json`: EVERY string value in the whole tree is a candidate —
  `adoptsFrom.module`, `links.self`, arbitrary attributes, all
  uniformly. Relative refs never match an `https://` prefix and
  pass through.
- `.gts/.ts/.js`: ONLY import-specifier strings inside
  `from '...'` clauses; relative imports and template/body strings
  untouched.
- Everything else: untouched.

The position-independence model: within-pack references stay
relative (walker and rewriter both leave them alone), so a pack is
location-independent by construction; absolute cross-realm URLs are
the retargetable part, rewritten at extract, at merge, or in-place
in the archive (in-place rewrite refreshes manifest hashes and
rebuilds atomically via tmp+rename).

## 6. Merge (unpack into an existing realm)

Per file: skip manifest and exclude/reference entries → filter by
strategy (`full`; `instance-only` = `.json` incl. `.realm.json`;
`definitions-only` = `.gts` only) → apply rewrites → then:
missing target = created; identical content (hash) = ALWAYS skipped
regardless of conflict mode; differing = `skip` (default,
conservative) preserves the target, `overwrite` replaces. `dryRun`
computes the full result without touching disk. Extract, by
contrast, silently overwrites when no conflict mode is set (gap:
inconsistent defaults).

Realm-content skip list at create: `.boxel-history/`,
`.boxel-sync.json`, `.DS_Store`, `.git`, dotfiles — EXCEPT
`.realm.json`, deliberately included. (Gap: the `--root` closure
walk bypasses this list in both directions.)

## 7. Where cardpack concepts map onto Deck

| Cardpack (as built) | Deck protocol (as built/designed) |
| --- | --- |
| manifest-as-card, entries[] | decklist (`boxel.packages` + exports) + `?meta` files listing |
| per-file SHA-256 in manifest | `Content-Digest` on serves; per-file integrity in future `?meta` |
| missing bundle-level hash | the contentHash requirement (identity!) — Deck must supply it |
| closure walker (both planes) | fleet census / consumption modes; the definitions slice ≈ a decklist |
| `reference` rule (metadata-only) | becomes REAL under Deck: a reference IS a versioned URL / RRI the protocol can serve |
| externals discarded (gap) | the decklist's dependency declarations + import-map scopes |
| bare specifiers invisible (gap) | solved outright: `@`-refs resolve through importmap.json |
| URL prefix rewriting | re-homing at intake; RRI mappings make most rewriting unnecessary (reference form is hosting-independent) |
| merge strategies (planes) | install (definitions) vs seed/example content (instances) vs remix (full) |
| format version 0.2.0, no read gate | (sourceHash, toolchain) keying discipline; version gates required |
| strip-metadata / sanitize / default-config | intake sanitize step for share flows — carry over as-is |

The three gaps in the left column are not defects to fix in the old
code — they are exactly the holes the Deck protocol fills. The
cardpack was reaching for a registry it did not have.

## 8. Gap register (recovered debt, for the v0.3 cardpack)

From the code itself: (1) `referenceUrl` never consumed; (2)
walker-discovered external refs discarded at archive build — the
manifest should record cross-realm requirements; (3) bare/RRI
specifiers silently dropped (http(s)-only external test); (4)
`ManifestEntry.sourceRealm` declared, never written; (5) no
format-version gate on read; (6) integrity validation advisory-only
(and merge validates nothing); (7) regex-based import parsing misses
side-effect imports, `export ... from`, dynamic `import()`; (8)
`--root` walk bypasses the skip list (and omits `.realm.json`); (9)
extract's unsafe overwrite default vs merge's safe skip default;
(10) no bundle-level hash/id; (11) latent hash-drift: JSON that
parses is re-serialized pretty-printed even at zero rewrites, but
the manifest hash refreshes only when rewrites > 0; (12) `.cardpack`
extension is convention-only. Plus the earlier note from the esm.sh
pass: extraction must use ROOTED writes (`os.OpenRoot`-style), only
regular files, size caps — the current unzip has none of that.

## 9. What carries forward unchanged (the vetted core)

Worth keeping verbatim in any v0.3: manifest-as-card (the manifest
is itself a Boxel document — self-describing in the system's own
terms); manifest-first zip entry; per-file hash of stored bytes;
exclude/reference entries staying VISIBLE in the manifest (the
shape of what's missing is part of the artifact); the two-plane
closure walker's dependency taxonomy (imports+fields /
adoptsFrom+relationships) and its per-plane resolution orders;
identical-content-always-skips merge semantics; dry-run everywhere;
atomic tmp+rename rebuilds; relative-stays-relative
position-independence; and the three sanitize transforms with
`meta.adoptsFrom` preservation.
