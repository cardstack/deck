# Depot vs realm — vocabulary and backport prep

**Status: RULING** (2026-08-08). Standalone Deck must not say **realm**.
That word is Boxel’s. This note freezes the standalone terms and how they
map when Deck is backported onto a realm server.

Companions: `deck-at-rest.md` (still realm-shaped in places —
historical), `deck-laws.md`, `packages/server` URL grammar,
`deck-core-backport-split.md` (isolate backportable Core vs Tools),
`deck-github-mirror-analysis.md` (depot↔GitHub monorepo mirror + intake),
`deck-in-motion.md` (§3.7 cross-depot offer/rebase + Boxel/Matrix plan).

---

## 0. Why rename

Deck is a **standalone** protocol for versioning, sealing, and serving JS
module trees (and JSON). It must work with no Boxel, no cards, no realm
server. Using “realm” in the reference implementation teaches the wrong
boundary and makes backport sound like a rename instead of an embedding.

| Avoid in standalone Deck | Use instead |
| --- | --- |
| realm (mount / URL slot) | **depot** |
| RealmMount | DepotMount (or equivalent) |
| “the realm’s store” | **the depot’s store** |

Keep **realm** only in backport docs, meaning the Boxel construct.

---

## 1. Standalone vocabulary

```
deck server
  └── depot          ← a place for stuff (mount)
        └── publisher  ← who / namespace (registry-shaped, not git)
              └── package (deck)  ← named module tree
                    ├── @exact / @tag / live
                    └── path…
```

### 1.1 Depot

> A **depot** is a named place on a Deck server: a live tree, a
> content-addressed store, and a URL prefix. It is not a scope, not an
> owner, and not a package.

- URL slot: `/<depot>/<publisher>/<package>[@spec]/<path>`
- On the wire the first segment is the **depot’s name** (e.g. `demo`),
  not the literal string `depot`.
- Many depots may share one server process.
- Semantics: warehouse bay — stuff goes in, sealed decks come out.

### 1.2 Publisher

> A **publisher** is the ownership / fork-boundary segment under a depot.

- Registry language (who issues the deck), not git (`owner` / remote).
- Not the depot. Depot = place; publisher = namespace inside that place.
- Examples: `acme`, `lib`, `you` after a fork.

npm **scope** is a cousin (`@org/name`); Deck does not require `@` in the
path. Do not call the depot a scope.

### 1.3 Package / deck

Unchanged: a **deck** is the named arrangement (package). Sealed versions
are pointers to `treeHash`. Live is the working tree under that name.

### 1.4 Server

The process that mounts depots and serves the read-only HTTP grammar.
Not a place; not in the path.

---

## 2. What a Boxel realm is (and why it is more than a depot)

A **realm** on a Boxel realm server is a **placement-free address space**:

- Paths are IDs; a card or module may sit **anywhere** in the tree.
- Import maps, history, RRIs, and card identity dereference across that
  space — not only under `publisher/package/…`.
- “Collection” in the old TCG vocab meant this live whole, not a warehouse
  layout.

So:

| | **Depot** (Deck standalone) | **Realm** (Boxel) |
| --- | --- | --- |
| Role | A **place** for sealed + live trees | A **dereferenceable** world of files/cards |
| Layout | Convenient `publisher/package` shape | Anything anywhere |
| Store | Depot-local CAS (`_objects` / `_trees` / meta) | Realm machinery + history + … |
| Protocol | Deck serve / publish / lock / pack | Full realm server + (after backport) Deck |

**Depot ⊂ capabilities a realm can offer.** A depot does not need to become
placement-free. A realm does not need to give up placement freedom to speak
Deck.

---

## 3. Backport shape — deck-enabled realm

When Deck is backported:

> A **deck-enabled realm** is a Boxel realm that implements the Deck
> contract (laws + serve grammar + seals/pins/packs) over its existing
> address space.

Mapping:

| Standalone Deck | On a deck-enabled realm |
| --- | --- |
| depot name | realm URL prefix / realm handle (one realm ↔ one Deck mount from the client’s view) |
| publisher/package | **one** way to lay out decks inside the realm — not the only way paths exist |
| `/<depot>/…/@pkg@1.2.3/…` | same serve grammar, rooted at the realm |
| depot store | realm store / bookmarks as today, as long as L1–L12 hold |
| `deck conform` | black-box against the realm’s Deck HTTP surface |

### 3.1 What backport must not do

- Rename Boxel “realm” to “depot” in product UI — realm stays realm there.
- Force every realm file into `publisher/package` placement.
- Teach standalone Deck users that they need a realm.

### 3.2 What backport must do

- Preserve Deck identity (`tree-hash-v1`), immutability, and pin/verify laws.
- Expose the Deck URL grammar (exact / tag / live / pack / digests).
- Allow decks to be addressed even when their files are not under a tidy
  publisher folder — resolution goes through the realm map / decklist, not
  through folder layout alone.

### 3.3 Cross-realm offer / rebase (in-motion on deck-enabled realms)

Standalone Deck’s offer + rebase loop works **inside one depot** today.
Across depots (and therefore across deck-enabled realms) the same three
carriages apply — normative detail in `deck-in-motion.md` §3.7:

1. **Public realm readable by both sides** — ordinary Deck GETs of offer
   tip, upstream Version, digests.  
2. **Out-of-band message of intent** — not wire protocol yet.  
3. **If the tip cannot be public:** a **Deck Pack** attached to that
   message; receiver unpacks, then local offer/rebase.

**Boxel plan for (2):** use **Matrix** as the signal —

| Piece | Role |
| --- | --- |
| Matrix **identity** | who is offering / who may accept |
| Matrix **room** | where the negotiation lives |
| Matrix **message** | message of intent (base Version, treeHash, why) |
| optional **Deck Pack** on the message | case (3) when the offer tip is not world-readable |

Realms stay **depot-shaped** for Deck (one realm ↔ one Deck mount from the
client’s view). Realm **access control** decides who may **issue** an offer
and who may **run rebase / accept** a pointer move; public catalog realms
are case (1). GitHub share/gather remains an interim stand-in until Matrix
negotiation lands (`deck-github-mirror-analysis.md` §5b). Synthesis vs
locus-shift merge philosophy: `deck-in-motion.md` §3.3a.

---

## 4. Doc and code migration (standalone, before backport)

Soft rename first (vocabulary), then identifiers:

1. **Docs** — say depot; mark “realm” in older Deck docs as meaning depot
   unless the sentence is about Boxel.
2. **Comments / HELP** — URL sketches use `/<depot>/…`.
3. **Types** — `RealmMount` → `DepotMount` (or `Depot`) when convenient;
   conformance fixture names follow.
4. **No URL break** — mount **names** stay (`demo`, …); only the word for
   the slot changes.

Do not block features on a big-bang rename. The ruling is: **new prose and
new APIs say depot.**

---

## 5. One-line glossary

| Term | One line |
| --- | --- |
| **server** | Process that mounts depots and serves Deck HTTP |
| **depot** | Named place: live tree + store + URL prefix |
| **publisher** | Namespace / ownership segment under a depot |
| **deck / package** | Named module tree; versions point at treeHashes |
| **realm** | Boxel placement-free world; may become deck-enabled |
| **deck-enabled realm** | Realm that implements the Deck contract |

---

## 6. Summary

Standalone Deck stores and serves from **depots** — places for stuff, with
**publishers** inside them. Boxel **realms** are richer: everything is
dereferenceable, modules and cards are not trapped in a folder schema.
Backport embeds Deck into a realm without renaming Boxel and without
making Depot pretend to be a realm.
