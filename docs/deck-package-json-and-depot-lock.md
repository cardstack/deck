# package.json is a suggestion; the depot lock is the authority

**Status: RULING** (2026-08-12). Companions:
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

> **A package's `package.json` is a suggestion. The depot's `importmap.json`
> is the only resolution authority.**
>
> The lock is pnpm's lockfile, encoded as a web import map. Nothing upstream
> — not a new publish, not an AI-fast ecosystem — changes what this depot
> runs until the depot owner asks Deck to update the lock. The same pack in
> two depots may resolve differently. That is intended: the owner has full
> jurisdiction over what executes here (and, after backport, in a realm).

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
Deck borrows that split and encodes the lock in the format the browser
already resolves.

---

## 2. Two files, two jobs

| File | Where | Job |
| --- | --- | --- |
| `package.json` | each package | npm-faithful suggestion: name, version, ranges, exports |
| `importmap.json` | **depot root** | lock: exact pins, scopes, integrity hashes |

A directory two levels down holding a `package.json` is a deck. The
depot-root `importmap.json` is **not** a deck. Discovery stays two
levels down, so the lock cannot be mistaken for a package.

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
  this depot *put* it, not what it is called. Specifiers are npm names
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

## 4. pnpm lock → import map

The lock **file** is a web import map. Copy of the HTML Standard that
defines it: [`reference/html.spec.whatwg.org/import-maps.html`](../reference/html.spec.whatwg.org/import-maps.html)
(snapshot of [§ import maps](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps),
2026-08-12). Formally three members: `imports`, `scopes`, `integrity`.
Any other top-level key is a warning, not a parse failure — `deck` is
legal. A specifier key ending in `/` must map to a value ending in `/`.

pnpm lockfile v9 ideas, encoded so the browser is the resolver:

- **importers** → `scopes` keyed by each deck's URL prefix
- **packages + snapshots** → exact specifier → URL pins
- **overrides** → depot-owner pins that may disagree with a suggestion
- **integrity** → import map `integrity` member (HTML): URL → SRI

```json
{
  "imports": {
    "prosemirror-view": "/site/lib/prosemirror-view@1.42.2/dist/index.js",
    "prosemirror-view/": "/site/lib/prosemirror-view@1.42.2/"
  },
  "scopes": {
    "/site/lib/prosemirror-view@1.42.2/": {
      "prosemirror-model": "/site/lib/prosemirror-model@1.25.11/dist/index.js"
    }
  },
  "integrity": {
    "/site/lib/prosemirror-view@1.42.2/dist/index.js": "sha256-…"
  },
  "deck": {
    "continuous": false,
    "overrides": {}
  }
}
```

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

HTML under a depot is injected with **that depot's** lock, not the
package's map. `?with=` remains a trial override of the depot lock.

A module inside a sealed pack resolves through the host depot's pins.
That is the supersession of
[`deck-a-package-resolves-through-its-own-map.md`](deck-a-package-resolves-through-its-own-map.md)
for consumers. The package still *suggests* ranges; the depot decides.
