# package.json is a suggestion; the composed realm lock is the authority

**Status: RULING, RRI-NATIVE AMENDMENT** (2026-08-21). Companions:
[`deck-a-package-carries-its-own-name.md`](deck-a-package-carries-its-own-name.md)
(identity still lives in the package — now in `package.json`),
[`deck-a-package-resolves-through-its-own-map.md`](deck-a-package-resolves-through-its-own-map.md)
(superseded **for the consuming depot**; a published Version no longer
carries the pins that decide what runs here),
[`deck-who-may-intervene.md`](deck-who-may-intervene.md)
(catalog and operator still do not silently rewrite this depot's lock),
[`deck-the-range-is-on-disk.md`](deck-the-range-is-on-disk.md)
(ranges stay in the package; resolution is computed),
[`deck-unfrozen-mode.md`](deck-unfrozen-mode.md)
(skip-the-freeze is per edge: `workspace:*` / `you/pkg@live`, not `latest`),
[`deck-lockfile-thought-experiment.md`](deck-lockfile-thought-experiment.md)
(what a versioned catalog inherits; per-depot lock vs shared browser runtime).

---

## 0. The ruling

> **A package's `package.json` is a suggestion. The realm's canonical
> composition of RRI-native import maps is the only resolution authority.**
>
> The lock is pnpm's lockfile encoded in import-map shape, with exact RRIs as
> targets and importer RRIs as scope keys. A deterministic projection turns
> it into the URL-valued browser import map for one transport view. Nothing
> upstream — not a new publish, not an AI-fast ecosystem — changes what this
> depot runs until the depot owner asks Deck to update the lock. The same pack
> in two depots may resolve differently. That is intended: the owner has full
> jurisdiction over what executes here (and, after backport, in a realm).

**Implementation gate:** the current reference resolver already proves
importer-aware browser scopes, but its durable inputs are not yet uniformly
RRI-native. Deck work-plan W11/R0 implements this ruling before Boxel A0; the
canonical fixture in `docs/artifacts/backport-remix-decklist.json` is the
target wire shape.

---

## 1. Why the lock is not in the package

A published Version used to resolve through its own sealed map, so
`crm@2.0.0` was the same program in every depot. That promise fights the
thing a depot owner actually needs: a freeze. An AI-assisted package
ecosystem will ship every hour. If each new compatible release rewires
every consumer, the downstream market is churn. The owner chooses when to
upgrade. Tools make that update seamless. Some live cases refresh the lock
continuously; that is opt-in, not default.

pnpm already split the world this way: `package.json` holds ranges;
`pnpm-lock.yaml` holds exact versions; `pnpm update` is a deliberate act.
Deck borrows that split and keeps the browser import-map shape, but uses RRIs
as the canonical address space. The browser receives a derived URL projection,
not a different dependency decision.

---

## 2. Two files, two jobs

| File / result                | Where                                    | Job                                                               |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `package.json`               | each conventional package boundary       | npm-faithful identity, version, ranges, and exports               |
| root `importmap.json`        | optional at the realm root               | realm-wide default exact pins and compatibility with older realms |
| app/package `importmap.json` | beside code under `apps/` or `packages/` | exact pins for that subtree; the more specific statement wins     |
| canonical composed lock      | content addressed by `lockHash`          | effective exact RRI pins, scopes, integrity, and lock policy      |
| browser projection           | generated per transport view             | the same lock resolved to absolute URLs for native ESM            |

A directory holding a `package.json` is a package; an `importmap.json` is
resolution input, not package identity. Boxel discovers app-local maps beneath
`apps/<name>/` and package-local maps beneath
`packages/<scope>/<name>/`. A realm may keep only a root map, only local maps,
or both. When both speak for the same subtree, the map beside that code wins;
realm-wide root imports remain defaults for code that no local map claims.

This repo is a reference implementation with demo data. Historical
sealed packs that used `importmap.json` as the package declaration are
thrown away and replayed with `package.json` in the tree. The Hub store
is cleared and republished; the depot lock is rewritten to the new
versions. Version history stays navigable and diffable in the Hub app.
We do not keep dual-read of the old seal at the expense of a clear
protocol. Serving injects this depot's lock, never a pack's own map.
`forkedFrom` / `vendoredFrom` may still ride in a thin per-pack import
map as lineage, never as identity or ranges.

---

## 3. npm `package.json` — the subset Deck honours

Borrow npm's fields and resolution idiom. Do not invent parallel keys.
An upstream file is stored **byte-identical** to the npm tarball. Extra
keys are preserved and ignored.

**Identity and entry** (npm algorithm, browser conditions `import`,
`browser`, `default`):

- `name`, `version` — what the package is. Layout `lib/three/` is where
  this depot _put_ it, not what it is called. Specifiers are npm names
  (`three`, `prosemirror-view`, `@scope/pkg`).
- `type`
- `exports` if present, else `module`, else `main`
- `dependencies`, `peerDependencies`, `optionalDependencies`,
  `peerDependenciesMeta` — suggestions for the locker, not pins

**Specifier strings, as npm writes them:**

- Semver ranges (`^`, `~`, `>`, `||`, `*`, exact)
- Dist-tags (`latest`, `next`)
- Aliases: `"foo": "npm:bar@^1.2.0"`
- Workspace / live sibling: `"ui/nav": "workspace:*"`
- Alias to another deck's working tree: `"acme/palette": "you/palette@live"`

**Not read in Phase 1:** `devDependencies`, `scripts`, `bin`, `engines`,
`os`/`cpu`, `bundledDependencies`, `imports` (`#internal`), `workspaces`,
`overrides`.

Deck-only provenance (`vendoredFrom`, cooldown, tarball integrity) stays
in store `meta.json`, not stuffed into an upstream `package.json`. A thin
per-pack `importmap.json` may still carry lineage (`forkedFrom`,
`vendoredFrom`, `derivedFrom`); it is not identity, ranges, or the lock.

**Acceptance:** sealed `three@0.160.0` and `prosemirror-view@1.42.2`
contain `package.json` whose bytes equal the npm tarball's file. Deck
reads name, version, dependencies, and exports from that file. No rewrite
of ranges into `lib/prosemirror-model@^1.25.0`.

---

## 4. Authored maps → canonical RRI-native lock

Each authored map follows web import-map structure. Copy of the HTML Standard
that defines the projection:
[`reference/html.spec.whatwg.org/import-maps.html`](../reference/html.spec.whatwg.org/import-maps.html)
(snapshot of [§ import maps](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps),
2026-08-12). The canonical Deck lock keeps the effective `imports`, `scopes`,
`integrity`, and optional `deck`; unlike the browser projection, its values
and scope keys are RRIs. A specifier key ending in `/` must map to a value
ending in `/`.

Composition is deterministic. Resolve inheritance within each authored map,
start with the optional root map, and fold each discovered local map into a
scope over its own package/app RRI. A local map's own `imports` win for that
subtree. Its already-resolved nested scopes remain more specific. Sort keys and
canonicalize JSON before hashing the result. The authored files are merged and
reviewed as normal source; the composed object is the exact lock artifact a
Checkpoint names.

pnpm lockfile v9 ideas, encoded so the browser is the resolver:

- **importers** → `scopes` keyed by each deck's stable RRI prefix
- **packages + snapshots** → exact specifier → versioned RRI pins
- **overrides** → depot-owner pins that may disagree with a suggestion
- **integrity** → canonical lock member: exact RRI → SRI; projection rewrites
  the key to its exact URL for the browser

```json
{
  "imports": {
    "prosemirror-view": "@catalog/prosemirror-view@1.42.2/dist/index.js",
    "prosemirror-view/": "@catalog/prosemirror-view@1.42.2/"
  },
  "scopes": {
    "@catalog/prosemirror-view@1.42.2/": {
      "prosemirror-model": "@catalog/prosemirror-model@1.25.11/dist/index.js"
    }
  },
  "integrity": {
    "@catalog/prosemirror-view@1.42.2/dist/index.js": "sha256-…"
  },
  "deck": {
    "continuous": false,
    "overrides": {}
  }
}
```

An exact RRI names the same immutable Version regardless of host. Before
native ESM runs, Deck/Boxel resolves those RRIs through the Version registry
and the selected realm view:

```text
canonical lock
  @catalog/prosemirror-view@1.42.2/dist/index.js
        │ exact Version claim + selected transport origin
        ▼
browser projection
  https://app.boxel.ai/catalog/prosemirror-view@1.42.2/dist/index.js
```

The projection is derived and cacheable. It is not authored, reviewed, or
merged independently, and it does not get its own dependency semantics. A
Checkpoint closes over the canonical RRI lock hash. A published Release may
also record the projection hash for delivery diagnostics.

URL-form RRIs remain readable for old locks and foreign intake. New Deck and
Boxel authoring writes scoped RRIs. Re-locking or an explicit normalization
operation performs the migration; reads never silently rewrite a durable
Checkpoint.

Create vs update:

- `deck lock --depot <dir>` — if no lock exists, write the newest version
  that satisfies each suggested range (npm/pnpm default; prereleases
  excluded). If a lock exists, keep pins that still satisfy their range
  and fill only new specifiers (install, not update).
- `deck lock --depot <dir> --update` — refresh every pin to the newest
  still in range. The owner may also pin anything they want by editing
  the map or by `deck.overrides`; jurisdiction beats suggestion.
- `deck lock --check` — frozen-lockfile analogue: refuse if the lock
  would change.
- `deck.continuous: true` — opt-in: re-run update on each save/publish.

Changing a `package.json` range does **not** change what runs until lock
or update.

---

## 5. What this changes about serve

HTML under a realm view is injected with **that branch's composed** lock, not
with one package map in isolation. `?with=` remains a trial override of that
effective lock.

A module inside a sealed pack resolves through the host depot's pins.
That is the supersession of
[`deck-a-package-resolves-through-its-own-map.md`](deck-a-package-resolves-through-its-own-map.md)
for consumers. The package still _suggests_ ranges; the depot decides.
