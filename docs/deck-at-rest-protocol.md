# The Deck Protocol, At-Rest Part (v2)

This document tells card authors how to publish and use package
versions in a Boxel realm. It replaces the first version. It now
includes the import map design. It uses ASD-STE100 Simplified
Technical English.

## 0. The name and the vocabulary (ratified 2026-08-07)

The protocol is named **Deck**. The three-way split: **Cardstack**
is the framework. **Boxel Catalog** is a place. **Deck** is the
protocol, built on the realm server.

Why "deck": an npm package is a sealed box — contents fixed,
location fixed. Our packages are not boxes. A package here is an
ARRANGEMENT declared over a shared tree — placement-free, loose in
storage, definite in shape, meaningful as its own being. That is a
deck of cards. The name encodes the differentiator.

The working vocabulary, borrowed from trading-card games:

| Term | Meaning here |
| --- | --- |
| collection | the realm — all your cards, live |
| **deck** | a package: an arrangement from the collection |
| **decklist** | the manifest entry: the exact contents (`boxel.packages` + exports; `?meta` shows it) — the tournament-registered enumeration the gate checks |
| **live tree** | the realm's current state: where editing happens; published versions never read it |
| **sealed deck** | a published version — seal + deck, immutable |
| sideboard | optional exports and extras |
| **cardpack / pack** | the closure carrier ACROSS BOTH PLANES: an archive (file form `.pack.zip` — a plain zip + packlist + per-file hashes) holding instances AND the definitions they need, movable as one artifact |
| reprint | a backport onto an old line |
| the catalog | where you browse other people's cards — Boxel Catalog |

Two planes, ratified 2026-08-07: a **deck** is MOSTLY definitions —
the module plane; consumer instances live outside it. A **cardpack**
walks both planes — instance documents, their relationship closure,
and the definition closure those instances need. The special case:
a cardpack whose content is exactly one decklist (definitions only)
is that sealed deck's TRANSPORT FORM — the npm-tarball analog, same
contentHash, movable as one binary artifact (intake, mirror,
offline, share-in-chat). The at-rest form serves file-by-file; the
cardpack form moves as bits. Recovered cardpack requirements and
the full mapping: `deck-cardpack-requirements.md`.

Live tree → sealed deck is the lifecycle: you edit in the live
tree; publishing seals the deck. Saving is not shipping. A restore
only ever touches the live tree — sealed decks are beyond its
reach. (Ruling 2026-08-07: plain "live tree," no card metaphor for
this slot — the metaphor got in the way.)

Lineage: CatalogJS (2020, see the CatalogJS Workflow Map) put its
intelligence in a build-and-bundle pipeline between author and
consumer. Deck replaces the pipeline with sealed state: the seal,
the import map, and immutable serving do the work. Bundling can
return later as a DERIVED artifact for app dependency sets that
travel together — keyed by (module hash set, bundler version),
never as identity. The natural bundle unit is an app's import-map
scope.

Status note: the at-rest protocol is BUILT AND TESTED through L7
(2026-08-07). The stack is seven commits on branches `deck/01` to
`deck/07`. All 20 unit tests and all 6 endpoint scenarios pass. The
status table in section 8 gives the details. L6 applies the
production lessons from the unpkg comparison
(`deck-unpkg-comparison.md`); L7 applies the esm.sh lessons
(`deck-esmsh-comparison.md`).

## 1. What "at rest" means

The protocol is a set of states, not a set of workflows. A realm is
a package registry when its state has these five parts:

1. **Content.** The realm holds files. Paths are IDs. No placement
   rule exists. Many apps and many packages can share one realm.
2. **The import map.** A plain JSON file, `importmap.json`, at the
   realm root. It is not a card. It declares the realm's packages
   and resolves `@` references. Section 3 gives the syntax.
3. **History.** The history sidecar makes a seal for each save. Each
   seal has a changeId. A changeId points to one full state of the
   realm, and that state includes the map.
4. **Version pointers.** A bookmark `pkg/<name>/<version>` points to
   one changeId. This is a published version. It cannot move. A
   bookmark `tag/<name>/<alias>` is a dist-tag. It can move. The
   bookmarks are the registry. All other data comes from them.
5. **Records (optional).** JSON records in `_registry/` help search
   and audit. The server does not need them to serve content.

An agent can put a realm in this state with file writes and two
endpoint calls. Then distribution starts. No review and no approval
are necessary for the at-rest part.

## 2. The reference rules

1. A reference is relative (`../accounting/account`), unless it
   starts with `@`. Then the import map resolves it.
2. `$REALM/` is the realm-root token, from the platform RRI work.
   It always means the live realm root.
3. A pin never comes from the token. A pin comes from the route in
   the value. A value through `@name@version` is pinned. A value to
   a plain tree path follows the live tree.
4. The full cross-realm reference form is
   `@<place>/<publisher>/<name>@<version>/<path>`. The short form
   `@<name>@<version>/<path>` serves inside one realm.

## 3. The import map file

```json
{
  "imports": {
    "@ui/": "$REALM/lib/ui/"
  },
  "scopes": {
    "$REALM/crm/": {
      "@money/":   "https://catalog.example/@boxel/maria/money@2.1.0/",
      "@contact/": "$REALM/@crm@1.2.0/contact/"
    },
    "$REALM/gym/": {
      "@money/": "https://catalog.example/@boxel/maria/money@3.0.0/"
    }
  },
  "boxel": {
    "packages": {
      "crm": {
        "version": "1.2.0",
        "entry": "$REALM/crm/app",
        "exports": { "./account": "$REALM/crm/account" }
      },
      "gym": { "version": "3.1.0", "entry": "$REALM/gym/app" }
    }
  }
}
```

Rules:

- `imports` and `scopes` keep the exact import-map web standard
  shape. A browser could load this file, and the resolution part
  works.
- All Boxel additions live under the one vendor key `boxel`. The
  publish gate reads `boxel.packages[<name>].version`. The map is
  the package manifest. A `package.json` is optional metadata only.
- `scopes` gives each app its own alias set. Two apps can hold
  `@money/` at two different versions in one realm.
- Pins live in values, never in keys. A version bump is a one-value
  edit.
- Do not name an alias after a Boxel language word. `@field` is the
  card-api decorator. Use content nouns: `@ui/`, `@money/`.
- The three source kinds are visible in each value: local live
  (`$REALM/<path>/`), pinned own realm (`$REALM/@<name>@<version>/`),
  and catalog (absolute URL with the full reference form).

The `RealmConfig` card (`realm.json`, already a card) is the
authoring surface. Intent fields hold ranges and sources. Computed
fields give previews and warnings. The save action writes
`importmap.json` as an explicit realm write. The card is a
convenience, never a dependency. Module resolution reads only the
plain file, never the index and never card compute.

## 4. The endpoints

State changes:

| Endpoint | Function |
| --- | --- |
| `POST <realm>/_history/commit` | Write files and make a seal with a message and an actor |
| `POST <realm>/_packages/<name>/publish` | Give a version name to a changeId |
| `POST <realm>/_packages/<name>/dist-tags` | Move a dist-tag to a version |

Publish rules: correct semver; the version must be new (published
versions cannot change); the map at the changeId must declare the
same name and version; each major line ascends separately, so
backports stay legal; `latest` cannot point to a prerelease; a
dist-tag rollback needs an explicit flag and the realm-owner
permission.

Reads and serving:

| Request | Result |
| --- | --- |
| `GET <realm>/_packages/<name>` | The versions and the dist-tags |
| `GET <realm>/@<name>@<version>/<tree-path>` | The file at that version |
| `GET <realm>/@<name>@<version>` | 301 to the entry module |
| `GET <realm>/@<name>@<version>/<export-alias>` | 301 to the tree path |
| `GET <realm>/@<name>@<range-or-tag>/<path>` | 302 to the best exact version, in one hop |
| `GET <realm>/@<name>@<version>?meta` | The version listing: entry, exports, changeId, all files |

Serve rules, the unpkg pattern with the unpkg-comparison hardening:

- **Raw bytes** at an exact version serve with `immutable,
  max-age=1y` and a `Content-Digest` header (RFC 9530). Sealed
  content never changes, so the promise is safe.
- **Compiled output is not immutable.** The compiler is part of the
  result. Compiled `.gts`/`.ts` responses get a short TTL, an
  `x-boxel-build-key` (a hash that includes the compiler service
  version), and an etag. A conditional request gets a 304, so the
  short TTL costs almost nothing. Raw source comes with
  `Accept: application/vnd.card+source`.
- **The redirect status shows mutability.** A 301 means only the
  FORM changed at an exact version (bare form to entry, alias to
  tree path) — that answer is frozen. A 302 with a short TTL means a
  range or tag moved — that answer can change.
- **One hop.** A range or tag resolves the version AND the entry or
  alias in a single redirect. The query string survives redirects.
- **Misses are negative-cached, in two tiers by permanence.** An
  unknown package, version, or file returns a coded JSON error
  (`errors: [{code, detail}]`) with a short TTL — someone can
  publish tomorrow. A GRAMMAR-INVALID version spec (not a version,
  a range, or a legal tag shape) returns `invalid-version-spec`
  with IMMUTABLE caching — its invalidity can never change. The
  other codes are stable: `version-not-found`, `file-not-found`,
  `no-entry-module`, `transpile-failed`, `package-not-found`,
  `manifest-missing`, `not-in-manifest`, `manifest-mismatch`.
- A range never matches a prerelease. A specifier without an
  extension finds the `.gts` file. HEAD gives the GET headers with
  no body.
- **The serve grammar is reserved.** A literal realm file with a
  root path shaped like `@<name>@<spec>` is shadowed by the route.

## 5. Why snapshots stay whole

A version names a full seal, and the URL path is the tree path. So a
relative import resolves inside the same versioned tree. An `@alias`
import resolves through the sealed map, which pins it. A plain
`$REALM/path` import is a deliberate live reference — the escape
hatch, visible in the file. Packages published from one seal always
agree with each other. One seal can carry many package versions.

## 6. The three use cases

### Simple: many versions in one realm

Write a card type. Add its entry to the map. Publish `1.0.0`. Point
an important document to `@tier-list@1.0.0/...`. Point test
documents to the live file with a relative path. Your live edits
cannot break the important document. Publish `1.1.0` when ready.

### Medium: many apps, release channels

One realm holds a CRM app and a Gym app, at different versions, with
different pins for the same dependencies — the `scopes` section
carries this. Publish stable versions with the `latest` tag and test
versions with the `next` tag. User documents point to exact
versions; test documents point through `next`. When the test is
good, move `latest` and update documents at your own time.

### Complex: a catalog with many publishers

Each author publishes in the author's own realm. The catalog assigns
publisher handles and lists or copies packages (advertise mode for
durable data realms; re-home mode for personal realms). Consumers
reference `@<place>/<publisher>/<name>@<version>/<path>` and resolve
the location through VirtualNetwork mappings. Identity stays in the
reference; hosting stays in the mapping. (Catalog intake endpoints
are planned work; the state model supports them today.)

## 7. What the at-rest part does not do

Planned, not included: the publish gate with required migrations and
fixtures; fleet migrations; security responses (advisory, yank,
quarantine); AppDef-generated dependency intent; fine authorization
tiers (today: read for GET, write for publish, realm-owner for
rollback). The planned functions do not change the state model.

## 8. Status

| Part | Status |
| --- | --- |
| History sidecar, seals, restore | Built, tested |
| Bookmarks (`pkg/`, `tag/`) | Built, tested (`deck/01`) |
| Registry endpoints, publish rules | Built, tested (`deck/02`) |
| Versioned serving, redirects | Built, tested (`deck/03`) |
| Compiled module serving, consumption | Built, tested (`deck/04`) |
| `importmap.json` as manifest; entry and alias redirects | Built, tested (`deck/05`) |
| Serving hardening: cache split, 301/302 rule, one hop, coded errors, `?meta`, Content-Digest, HEAD | Built, tested (`deck/06`) |
| Server maturity: bookmark-list cache, two-tier negative caching, transpile singleflight, `baseApi` in map + `?meta` | Built, tested (`deck/07`) |
| RealmConfig card authoring layer | Design agreed, not started |
| Catalog intake, migrations, security verbs | Deferred by ruling |

## 9. Where the code is

| Part | File |
| --- | --- |
| Bookmark primitives | `packages/realm-server/lib/realm-history.ts` |
| Publish rules (pure functions) | `packages/realm-server/lib/package-registry.ts` |
| Registry endpoints | `packages/realm-server/handlers/handle-package-registry.ts` |
| Versioned serving | `packages/realm-server/handlers/handle-package-serve.ts` |
| Tests | `packages/realm-server/tests/package-registry-*.ts` |
