# Multi-Package Realms and the Import Map (Design, Current State)

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Status: IMPLEMENTED, 2026-08-07. Commit `cc0be4c532` on the branch
`deck/05-package-map`. All tests pass. This file stays as the design
record. The current protocol description is
`deck-at-rest.md`. This file uses ASD-STE100 Simplified
Technical English.

## 1. The rules this design follows

1. A realm has no file placement rules. A realm is not a real file
   system. Paths are IDs. They cannot change.
2. A reference is relative (`../accounting/account`), unless it
   starts with `@`. Then a resolver maps it.
3. `$DECK/` is the realm-root token. It comes from the RRI work
   (the branch `@cardstack/base-rris-everywhere-cs-10750` renamed
   `$thisRealm` to `$REALM`). The `$` sigil marks tokens. The `@`
   sigil marks scoped names. They cannot collide.
4. Assume many apps in one realm, at different versions, from mixed
   sources: some local, some pinned, some from a catalog.
5. Module resolution must not depend on the index or on card
   compute. The critical path is a raw file read.

## 2. The file: `importmap.json`

One plain JSON file at the realm root. It is not a card. The name
follows the web standard for the mechanism (JSPM `importmap.json`,
Deno `import_map.json`, Rails `importmap.rb`). The combined
manifest-plus-pins precedent is `go.mod`: one authored file with the
module's identity and its exact pins. This is not a lockfile. A lock
name means "derived output, do not edit". This file is authored
truth.

```json
{
  "imports": {
    "@ui/": "$DECK/lib/ui/"
  },
  "scopes": {
    "$DECK/crm/": {
      "@money/":   "https://catalog.example/@boxel/maria/money@2.1.0/",
      "@contact/": "$DECK/@crm@1.2.0/contact/"
    },
    "$DECK/gym/": {
      "@money/":    "https://catalog.example/@boxel/maria/money@3.0.0/",
      "@schedule/": "$DECK/gym/schedule/"
    }
  },
  "boxel": {
    "packages": {
      "crm": {
        "version": "1.2.0",
        "entry": "$DECK/crm/app",
        "exports": { "./account": "$DECK/crm/account" }
      },
      "gym": { "version": "3.1.0", "entry": "$DECK/gym/app" }
    }
  }
}
```

Syntax rules:

- **`imports` and `scopes` keep the exact import-map standard
  shape.** A browser could load this file, and the resolution part
  works. The spec's `integrity` member is a future hook for
  contentHash.
- **All Boxel additions live under the one vendor key `boxel`.**
  Future spec members cannot collide. The publish gate reads
  `boxel.packages[<name>].version`.
- **`scopes` gives each app its own alias set.** Two apps hold
  `@money/` at two versions in one realm. The scope key is the app's
  area — a declaration, not an enforcement.
- **Pins live in values, never in keys.** The key is a clean alias
  with a trailing `/`. The value carries the version. Web import
  maps pin CDN versions the same way. A version bump is a one-value
  edit.
- **`$REALM` always means the live realm root.** A value that routes
  through `@name@version` is pinned. A value to a plain tree path
  follows HEAD. The author's choice is visible in each entry.
- **Alias naming guidance:** do not name an alias after a Boxel
  language word. `@field` is the card-api decorator. An alias
  `@field/` or `@fields/` invites confusion. Use nouns for the
  content: `@ui/`, `@money/`, `@contact/`.

The three source kinds, visible in each value:

| Kind | Value form |
| --- | --- |
| Local, live | `$DECK/<path>/` |
| Pinned, own realm | `$DECK/@<name>@<version>/` |
| Catalog | absolute URL with `@<place>/<publisher>/<name>@<version>/` |

## 3. The authoring layer: the RealmConfig card

`realm.json` is already a card (`RealmConfig` in
`packages/base/realm-config.gts`; the server already reads its
fields, for example the host routing rules). The card becomes the
authoring surface for the map:

- Intent fields hold dependency lists, ranges, sources, and app
  scopes.
- Computed fields give previews and warnings: the resolved map, a
  newer version in a range, an alias collision, a yanked pin.
- The save action performs an explicit realm write of
  `importmap.json`. The write is sealed and attributed like any
  write.

The card is a convenience, never a dependency. An agent can write
`importmap.json` directly, and the protocol is satisfied. A broken
card def or a slow index cannot stop module resolution.

Reasons for materialization at save time: the server must never run
realm JS to resolve its own routes (the BXL boundary rule); a
snapshot must carry its literal map; the BSL distinction (§37) — a
default is evaluated at write and then is plain data, and the map is
a default, not a computed.

## 4. Serving and the publish gate

Serving keeps the tree-path space that L3 and L4 built. A version
names a full seal. Any file in the seal serves at the versioned URL.
A relative import resolves inside the same versioned tree, so the
snapshot stays whole. No lint and no import rewriting are necessary.

Two additions:

- **Entry redirect.** `GET <realm>/@crm@1.2.0` reads the sealed map
  at that changeId and sends a 302 redirect to the entry module's
  tree path.
- **Export aliases.** `GET <realm>/@crm@1.2.0/account` finds the
  `exports` alias and sends a 302 redirect to the tree path. Aliases
  give short public paths. The tree path stays the one canonical
  space.

The gate change: the manifest check reads
`boxel.packages[<name>].version` from `importmap.json` at the target
changeId. The name must be a key. The version must equal the
request. All other gate rules stay the same.

The server does not process `scopes`. Loaders and VirtualNetwork
consume them. One seal can carry many package versions. Packages
published from one seal always agree with each other.

## 5. Snapshot semantics

The map is a file in the tree. Each seal carries its own map. Inside
a published version: a relative import resolves in the snapshot; an
`@alias` import resolves through the sealed map, which pins it; a
plain `$DECK/path` import is a deliberate live reference — the
escape hatch, visible in the file.

## 6. Remaining choices (my leans)

1. Version in the map entry, with `package.json` optional metadata —
   lean yes.
2. Export aliases as 302 redirects to tree paths — lean yes.
3. No export restriction at serve time (the seal is public at the
   version; restriction is gate-era work) — lean yes.

## 7. Implementation size

- Gate: one manifest lookup change in the publish endpoint.
- Serve: the entry redirect and the alias redirect.
- Tests: two packages in one seal; the same changeId under two
  version bookmarks; a relative import across app areas resolves
  inside the snapshot; the entry redirect; an alias redirect; a map
  version mismatch refusal.
- Estimate: less than one day on top of the built stack
  (L0–L4, branches `deck/01`–`deck/04`).
