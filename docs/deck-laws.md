# The Deck laws

The contract. Everything else in [docs/](.) is commentary, design history, or
a record of how something was measured — this file is what an implementation
must obey.

It is deliberately short, and deliberately not a specification. Prescriptive
specs go stale: `deck-cas-v2-spec.md` was overtaken inside one working
session of building against it, not because it was careless but because 550
lines of detail cannot survive contact with real packages. Laws survive
because they say *what must hold*, never *how*.

Each law is checkable, and each is checked by `deck conform`
([packages/conformance](../packages/conformance)). **An implementation
implements Deck by passing that suite**, not by reading this file — the file
exists so a human can tell what the suite is protecting.

---

## L1 · Identity

> Identity is `tree-hash-v1` over the logical file tree, and nothing else
> enters it.

Not zip framing, not compression, not the order bytes landed on disk, not
the storage layout, not the version or tag a human attached. Two trees with
the same files have the same hash on every implementation, forever.

`DEFAULT_IGNORE` is part of the algorithm: a realm's own bookkeeping
(`.deck`, `.jj`, `.git`, `node_modules`, `.DS_Store`, `.boxel-history`)
cannot change what a deck IS.

## L2 · Round trip

> `treeHash(unpack(pack(T))) === treeHash(T)` — packing is faithful.
> `pack(unpack(P)) === P` — byte-identically, so a pack has a canonical form.

A pack may be **rebuilt** from storage rather than stored; L2 is what makes
that safe, and it is why the stored tree object has to carry everything the
archive contained.

## L3 · Pointer

> Versions and dist-tags name treeHashes. Naming a state copies no bytes.

`release` is a metadata edit. Publishing content already stored writes
nothing. An undiverged fork costs nothing, across publishers.

## L4 · Immutability

> A published exact version never changes. Re-publishing one is refused.

There is no unpublish and no delete. The only way to say a version is bad is
to say so *about* it — never by altering or removing it.

## L5 · Volatility

> A deck has exactly three kinds of address, and they are different URLs.

| Address | Means | Cache |
| --- | --- | --- |
| no version segment | the working tree, this instant | `no-store` |
| `@<exact>` | one sealed state, forever | `immutable` |
| range or dist-tag | a name for a state | one short-TTL hop to the exact address |

Ranges never match prereleases. Opting into churn is always explicit.
`latest` is a dist-tag on a stable release; **`latest` is not live**.

## L6 · Hermeticity

> A sealed deck resolves every specifier it contains — to a file inside
> itself, or to a dependency it declares. Nothing reaches the live web at
> runtime.

A deck that would need to fetch from a CDN to work is not sealed, and
sealing it anyway is refused rather than warned about (see L11).

## L7 · Resolution

> A dependency key is the **import specifier**. An alias value names the
> **deck that answers to it**. A deck's own specifiers are confined to its
> own URL prefix.

```json
"dependencies": { "three": "lib/three@0.160.0" }
```

The key is what the source writes; the value is what serves it. This is what
lets a fork stand in for its base without the consumer editing its own
`import` statements, and what lets two decks disagree about a version
without colliding — their specifiers resolve inside their own scopes.

Corollary, and it is not merely an optimisation: when a range permits it, a
dependency resolves to a version **already present** rather than to the
newest. A peer dependency resolved twice is two incompatible copies of the
same library in one document.

## L8 · Provenance

> A deck that is a copy of something else records what it is a copy of, in a
> form that can be checked.

Registry, integrity, entry, and — where the upstream publishes one — the
repository and commit, verifiable blob by blob. A consumer can always answer
"what IS this?" without trusting the name it was filed under.

## L9 · Endorsement

> A signature binds a key to a **treeHash**. Names are never the subject.

Integrity says the bytes did not change. Endorsement says who stands behind
them. They are different claims and only one of them travels with a pack
through a mirror or a cache.

## L10 · Inheritance

> Same treeHash ⇒ same bytes ⇒ same endorsements.

A fork inherits every attestation about the bytes it did not change, and
loses exactly the ones about bytes it did. Nothing in the name-based world
can do this.

## L11 · Fail closed

> An unverifiable claim is refused, not warned about.

An unknown publish date is not a safe date. An unresolvable specifier is not
an acceptable one. A missing provenance record is not a minor omission. Every
one of these is a refusal with a reason and a named way to override it
deliberately — never a log line that a build will scroll past.

## L12 · Serving

> The response says what the bytes are.

- exact version → `immutable`, plus `Content-Digest` matching the file's own
  hash, plus the tree hash
- version-less → `no-store`, always
- range or tag → **one** hop, short TTL
- writes → refused; the server is read-only
- errors → coded JSON, and a permanent error is cached differently from a
  transient one

---

## What the laws deliberately do not say

How bytes are stored. Whether packs are kept or rebuilt. Whether objects are
compressed. What the tree object looks like on disk. Which parser reads a
module. What a realm's cooldown policy is set to.

Those are implementation choices, and the two that were most prescriptive in
the old spec are precisely the two that measurement overturned. If a choice
can be made differently without breaking a law, it is not a law.

---

## Status

| Law | Enforced by | State |
| --- | --- | --- |
| L1 identity | `deck conform --at-rest` | ✅ |
| L2 round trip | `deck conform --at-rest` | ✅ |
| L3 pointer | `deck conform --at-rest` | ✅ |
| L4 immutability | `deck conform --at-rest` | ✅ |
| L5 volatility | `deck conform --http` | ✅ |
| L6 hermeticity | vendor refuses; `deck conform --at-rest` | ✅ |
| L7 resolution | `deck lock`; `deck conform --at-rest` | ✅ |
| L8 provenance | recorded by `vendor`; `deck conform --at-rest` | ✅ recorded |
| L9 endorsement | — | ❌ unbuilt |
| L10 inheritance | — | ❌ follows L9 |
| L11 fail closed | partial: cooldown, hermeticity, CJS, integrity | ⚠️ no verify gate on publish/lock |
| L12 serving | `deck conform --http` | ✅ |

L9 and L10 are the next thing to build. L11 is the one that is half-true
today, which is the most dangerous state for a law to be in: provenance is
*recorded* and never *checked*.
