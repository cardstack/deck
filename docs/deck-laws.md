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

### One word about the first URL segment

It is a **depot**: a named place on a Deck server — a live tree, a
content-addressed store, and a URL prefix. Standalone Deck does not say
*realm*; that is Boxel's word for something richer, and using it here would
teach the wrong boundary and make the eventual backport sound like a rename
instead of an embedding. See
[deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

No law below depends on the word. A depot's **name** is whatever its operator
chose (`site`, `demo`, …) and appears verbatim in every URL, so the rename
moved no bytes and broke no address.

---

## L1 · Identity

> Identity is `tree-hash-v1` over the logical file tree, and nothing else
> enters it.

Not zip framing, not compression, not the order bytes landed on disk, not
the storage layout, not the version or tag a human attached. Two trees with
the same files have the same hash on every implementation, forever.

`DEFAULT_IGNORE` is part of the algorithm: a depot's own bookkeeping
(`.deck`, `.jj`, `.git`, `node_modules`, `.DS_Store`, `.boxel-history`)
cannot change what a deck IS. A caller may extend that set; it cannot shrink
it, or two implementations could hash one directory differently.

**Paths are Unicode NFC**, and that is part of the algorithm too. They are
hashed as UTF-8 bytes, so `ä` as U+00E4 and as U+0061 U+0308 are different
paths and different trees for the same logical files — and filesystems
disagree about which they hand back. The ruling splits by who chose the
encoding:

- A non-NFC path is **not a valid tree path**. An author who wrote those
  bytes gets a refusal, not a silent rewrite (L11).
- `treeHashFromDir` **normalises as it reads**, because there the OS chose,
  not the author, and nobody should be locked out of sealing by their
  filesystem's convention. Identity is the NFC path; the on-disk spelling is
  carried separately, for reopening files only.
- One tree may not hold both spellings of one name.

### On there being a v2

There will probably be a `tree-hash-v2` eventually. This is a spec string,
not a vow — `TREE_HASH_SPEC` rides in every packlist precisely so a change is
a new version rather than silent drift, and a v1 hash stays a correct name
for its bytes forever, so old seals never become wrong. Anything above that
is *this* version's rule, not a permanent one.

What **is** settled is the direction. A Merkle directory identity was
proposed and rejected on 2026-08-08: it does not solve what it was proposed
for, because a directory node is not a binary Merkle node, so a proof costs
the full child list of every ancestor — and both published packages and
depots are fat and shallow enough that the proof measures larger than
shipping the whole gzipped manifest. See
`deck-tree-hash-v2-merkle-proposal.md` for the rejection and
`deck-tree-hash-v2-review.md` for the numbers.

So a future v2 is open, and it is most likely **not** that. If cheap
inclusion proofs ever become the driver, the measured answer is a binary
Merkle over the sorted manifest, which leaves the logical tree and the flat
list untouched and only changes how the list is folded into a root. Subtree
hashes, meanwhile, are available as **derived** data at any time; identity is
not where they belong.

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

Second corollary: **one deck name is one library.** A range picks a version
out of a deck's list, so every version in that list must come from the same
upstream, and a name derived from somewhere else has to be derived
injectively. Flattening npm's namespace into one segment is lossy —
`@babel/runtime` and `babel-runtime` are both real — so the derivation
carries a digest of the true name wherever the fold loses something, and the
store refuses a version whose upstream disagrees with what the deck already
holds. Nothing in L8 notices this: per-version provenance stays perfectly
truthful while the resolution key quietly means two things.

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

## L10 · Carry-over

> Same treeHash ⇒ same bytes ⇒ same endorsements.

A statement is addressed to a tree hash, so it applies wherever those exact
bytes appear, under any publisher. A fork keeps every attestation about the
bytes it did not change, and loses exactly the ones about bytes it did.
Nothing in the name-based world can do this.

Note what this means for `deck fork`, which records its base in its own
import map: that record is a byte, so the fork is a different tree and
carries **nothing** over. That is the right posture — an endorsement should
not transfer to something announcing a different lineage. Carry-over is for
two publishers holding *genuinely identical* bytes, which is the case content
addressing already collapses to one stored tree.

The name matters. This was called "inheritance", which describes the wrong
mechanism: nothing here is derived from a parent. The statement never moved.
It was addressed to content, and the content turned up in a second place.

## L11 · Fail closed

> An unverifiable claim is refused, not warned about.

An unknown publish date is not a safe date. An unresolvable specifier is not
an acceptable one. A missing provenance record is not a minor omission. Every
one of these is a refusal with a reason and a named way to override it
deliberately — never a log line that a build will scroll past.

`deck verify-links` is the gate, and `deck lock --check` runs it. It is
deliberately **offline**: a publish that silently depends on a registry
being reachable is a publish that fails at 3am. What it checks is what can
be known locally — that every pin still resolves to what its dependency
record implies, that every pin has a record and every record a pin, and
that the files those pins name actually exist.

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
module. What a depot's cooldown policy is set to.

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
| L8 provenance | recorded by `vendor`; `deck conform --at-rest` | ✅ |
| L9 endorsement | `deck sign` / `verify-sig`; `deck conform` | ✅ |
| L10 inheritance | envelope lives with the tree; `deck conform` | ✅ |
| L11 fail closed | `deck verify-links`, `lock --check`, `release --require-signature` | ✅ offline |
| L12 serving | `deck conform --http` | ✅ |

All twelve now have checks that run. What remains is reach rather than
absence:

- **Key material is local.** `deck keygen` writes an ed25519 key under
  `~/.deck/keys`. The intended material is a Matrix cross-signed device key —
  already federated, already recoverable, and bound to an identity other
  people can check. The envelope format does not care which produced it.
- **Trust is not modelled.** A signature verifies; whether you trust the key
  that made it is a question nothing here answers yet.
- **L11 is offline by design.** Re-fetching a tarball to re-check its
  integrity, or asking GitHub whether a commit still matches, are `--online`
  checks that do not exist yet.
