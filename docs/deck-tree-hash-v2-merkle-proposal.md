# Proposal: `tree-hash-v2` — Merkle directory identity

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

> ## ❌ REJECTED — 2026-08-08
>
> **`tree-hash-v1` is the identity for everything. There is no v2.**
>
> Rejected on three grounds, in order of weight:
>
> 1. **It does not solve the problem.** Both capabilities that justify the
>    Merkle shape — inclusion proofs (§2) and `have`/`want` sync (§2.2) —
>    fail the same measurement, because they are the same walk. A directory
>    node is not a binary Merkle node: recomputing an ancestor needs its
>    entire child list. On `eslint/lib` (384 files, the shape of the vendored
>    three.js `src` at 374) the median proof is **27,377 B against 18,424 B
>    for simply shipping the gzipped manifest**. On a flat package it is
>    larger by construction, because the proof *is* the root listing. §4.12
>    files fat directories as a rare edge case; they are the common case —
>    for published packages *and* for realms, which measure at depth 2–4 with
>    single directories holding 278–659 children.
>
> 2. **It introduces inefficiency.** §3.2 correctly keeps the flat packlist,
>    so this is additive storage, not a replacement: tree nodes measure
>    0.99–1.14× the flat manifest, roughly doubling metadata on disk. And
>    serving stays flat regardless — walking root → `lib` → file would be N
>    reads at depth N on the hot path — so the Merkle side never reaches the
>    path it was supposed to speed up.
>
> 3. **It introduces complexity for it.** A second identity spec string, a
>    golden-root regeneration, invalidated local seals and signature
>    envelopes, a fourth store kind, proof encoding and malleability rules,
>    and a domain-separation question (§4.1) that the proposal answers
>    incorrectly — all to buy a capability that measures worse than the flat
>    list it would replace.
>
> **What was salvaged and acted on separately:**
>
> - The real bug this surfaced: **L1 says nothing about Unicode
>   normalisation**, while the conformance fixture contains a non-ASCII
>   filename. NFC and NFD hash differently, so the golden root is OS-stable
>   by luck rather than by rule. That is a v1 defect and it now matters more,
>   not less, since v1 is permanent.
> - The sync argument this was reaching for is real and is answered by v1:
>   one realm treeHash for “did anything change”, one flat packlist for “what
>   changed”. See `deck-competitive-gaps.md` §2.4.1.
> - The subtree index remains buildable at any time without touching a law,
>   because it is derived data. Nothing currently needs it.
>
> Full analysis with the measurements: **`deck-tree-hash-v2-review.md`**.
>
> The document below is kept unedited as the record of what was proposed and
> why it was reasonable to propose. Do not implement it.

---

**Status: REJECTED** (2026-08-08; proposed the same day). Companions:
`deck-laws.md` (L1 identity), `packages/core/src/tree-hash.ts` (v1),
`packages/core/src/object-store.ts` (blobs + flat tree JSON),
`deck-cas-v2-spec.md` (historical; storage grain already landed).

We have not shipped. That is the reason to do this now: every sealed
`treeHash`, every signature subject, every conformance golden, and every
packlist field can move once. After ship, a hash-function change is a
forever dual-stack.

## 0. Why

`tree-hash-v1` is:

```
treeHash = sha256( sorted lines of `${fileSha256}  ${path}\n` )
```

Correct, checkable with `shasum`, and deliberately **flat**. The store
already content-addresses **files** (`_objects`) and keeps a flat packlist
under `_trees/`. What v1 does not give:

1. **Subtree identity** — “these two decks share the same `lib/`” is not one
   compare; you must walk every path.
2. **Path-local rehash** — one file change rewrites the whole manifest hash
   input (cheap at 10² files; noisy at 10⁴+ and for proofs).
3. **Inclusion proofs** — prove `lib/c.js` is in seal `T` without shipping
   the full packlist.
4. **Directory-node sharing** — blobs already dedupe; identical directories
   across packages do not yet share a named node.

A Merkle directory hash (Git-shaped, not Git-copied) fixes those while
keeping L1’s spirit: identity is still over the logical file tree, never
zip bytes or storage layout.

### Non-goals

- IPFS CIDs, multibase, multicodec, Bitswap, or a DHT.
- Git object format, modes, or SHA-1 — including using Git’s tree OID as
  `treeHash` (see §0.1).
- Making empty directories meaningful (unless we explicitly reverse that).
- Changing per-file `sha256` of blob bytes.
- Bundling or minify identity (orthogonal; derived trees stay derived).
- Signed tip maps, genesis RIDs, delegate thresholds, COB/op-DAGs, or a
  gossip mesh — Radicle-shaped follow-ons (§0.1); they **consume** a Merkle
  root, they do not redefine it.

### Goal

> Replace `tree-hash-v1` with `tree-hash-v2`: a deterministic Merkle root
> over the same logical files, before any external consumer depends on v1
> hashes.

Keep the **name** `treeHash`. Bump the **spec string**.

### 0.1 Radicle Heartwood — what we learned (and what we do not change)

Read against Heartwood (Radicle’s protocol stack): it is built **on Git**.
Content Merkle identity there *is* Git’s blob/tree/commit model. Collaboration
and trust sit *above* that: identity docs → stable RID, signed ref tip maps
(`rad/sigrefs`), delegate thresholds for canonical branches, COB op-DAGs,
gossip of inventory/tips + Git fetch for objects.

**For this proposal, that confirms the cut rather than rewriting it:**

| Take | Do not take |
| --- | --- |
| Blob → tree → root **shape** | Git tree bytes, modes, SHA-1 / Git SHA-256 OIDs |
| Partial sync wants **named tree nodes** (have/want) | Requiring a `.git` ODB for identity |
| Endorsement subject = content root | Signing only a forge URL / package name |
| Announce tips, fetch objects | Full Noise/gossip mesh in the v2 cutover |

So: **no algorithm change from the Radicle read.** The encoding in §1 stays
Deck-native. What *does* get a stronger recommendation: prefer store option
**B** (persist tree nodes, §3.3) before ship, because that is what makes a
later inventory/`have`/`want` fetch (Radicle’s replication split, over HTTP
first) cheap. Tip-map signing and threshold canonical tags remain separate
docs/PRs that sign the same `treeHash` root L9 already names.

---

## 1. Algorithm (normative sketch)

### 1.1 Objects

| Kind | Id | Payload |
| --- | --- | --- |
| **blob** | `sha256(file bytes)` | raw file bytes (unchanged) |
| **tree** | `sha256(canonical tree encoding)` | sorted child refs |

Only regular files enter the logical tree (same as today: no symlinks, no
empty directories). `DEFAULT_IGNORE` remains part of the walk.

### 1.2 Tree encoding

Each directory is encoded as UTF-8 text (debuggable, language-stable):

```
tree-hash-v2\n
<type> <hex64> <name>\n
<type> <hex64> <name>\n
…
```

- First line is the constant `tree-hash-v2` (domain separation from blob
  hashes and from v1 manifest text).
- `<type>` is `blob` or `tree`.
- `<hex64>` is lowercase sha256 hex of the child object.
- `<name>` is a single path segment (no `/`, no empty, no `.` / `..`, no
  NUL, no `!`).
- Lines sorted by **UTF-8 byte order of `<name>`** (same compare as v1
  paths).
- Exactly one trailing newline on the object; no blank lines.

```
treeHash(root) = sha256( encode(tree(root)) )
```

Example:

```
a.js          → blob A
lib/b.js      → blob B
lib/c.js      → blob C

tree(lib) =
  tree-hash-v2
  blob <B> b.js
  blob <C> c.js

tree(root) =
  tree-hash-v2
  blob <A> a.js
  tree <hash(lib)> lib

treeHash = sha256(tree(root))
```

### 1.3 Why not hash full paths in the root

v1 puts full paths in one list. v2 puts **segments** in each node. That is
the whole point: `lib/` becomes an addressable object. Full paths remain in
the **packlist** for zip transport and HTTP listing; they are a projection
of the Merkle forest, not the identity function.

### 1.4 Equivalence with the logical tree

Two file sets produce the same v2 root iff they have the same
`(path → file sha256)` map under the same ignore rules — same as v1’s
equality, different digest. Conformance must pin a **golden root** for a
fixture directory, not only “self-consistent.”

---

## 2. What we gain (product capabilities)

| Capability | How v2 enables it |
| --- | --- |
| **Subtree compare** | Equal `tree` ids ⇒ identical directory contents |
| **Subtree vendor / pin** | “Depend on this directory object” without renaming every file |
| **Inclusion proof** | Path of sibling hashes from blob → root; verify against sealed `treeHash` |
| **Cheaper federation sync** | Negotiate missing **tree** and **blob** ids; skip shared subtrees |
| **Smarter store GC / stats** | Refcount tree nodes; show “N packages share this `vendor/three` tree” |
| **Partial `?meta` / browse** | Return one directory node without materialising the whole packlist |
| **Diff UX** | Highlight changed subtrees first; drill into blob churn second |
| **Stronger mirror story** | Mirror proves a file against the endorsed root without trusting the mirror’s full listing |

Signatures (L9) stay “key binds `treeHash`.” The subject is still one hex
root; proofs make that root *useful* without changing the endorsement model.

---

## 3. How to implement (in this repo)

### 3.1 Code slices

| Slice | Work |
| --- | --- |
| **H1** | `treeHashFromEntries` / `treeHashFromDir` → build Merkle forest; export `TREE_HASH_SPEC = 'tree-hash-v2'` |
| **H2** | Packlist: `treeHash.spec` becomes v2; keep flat `entries[]` (sorted) as today for zip + serve |
| **H3** | Object store: optionally persist tree nodes as `_objects` (or `_trees/nodes/<aa>/<hash>`) keyed by tree id; root pointer stays in meta |
| **H4** | `proofFor(path)` + `verifyProof(root, path, blob, proof)` in core; expose later on `?meta` or `/_trees/<hash>/proof?path=` |
| **H5** | Conformance golden + laws wording: “Identity is `tree-hash-v2`…” |
| **H6** | Wipe or migrate local demo stores; no compatibility with v1 seals |

Suggested order: **H1 → H2 → H5 → H3 → H4 → H6**. Proofs and node
persistence are where the new value shows; identity cutover is the blocker.

### 3.2 Keep the flat packlist

Do **not** replace packlist entries with only a root hash. Rebuild of
`canonical-zip-v1` needs an ordered file list + sizes. Rule:

> Packlist **projects** the Merkle tree to a flat list; the root in
> `treeHash.hash` must equal `merkleRoot(entries)`.

`deck verify` checks both: every entry’s bytes match `sha256`, and
recomputing the Merkle root matches `treeHash.hash`.

### 3.3 Store layout options

**A. Minimal (cutover):** keep `_trees/<aa>/<root>.json` as today’s
packlist JSON; compute Merkle only in memory. Gains identity + proofs from
the flat list; no subtree sharing on disk yet.

**B. Full (recommended before ship if cheap):** store each tree node once
under content address; packlist JSON either embeddable or rebuilt by walk
from root. Gains directory-node dedup and partial fetch.

Propose **A for first green tests, B before calling the store “done”.**
Blob layer already exists; tree nodes are the same pattern with a different
encoding prefix.

### 3.4 API sketch

```ts
treeHashFromEntries(entries): {
  spec: 'tree-hash-v2',
  treeHash: string,          // root
  entries: TreeHashEntry[],  // flat, sorted (packlist projection)
  nodes?: MerkleNode[],      // optional dump for store
}

inclusionProof(entries | nodes, path): MerkleProof
verifyInclusion(treeHash, path, fileSha256, proof): boolean
```

CLI later: `deck prove <store> --name … --version … --path lib/c.js`.

---

## 4. Things to look out for

1. **Domain separation** — Never hash tree encoding with the same shape as
   file bytes without a type tag. The `tree-hash-v2\n` header (or a
   `blob`/`tree` typed pretouch) prevents a file whose contents look like a
   tree object from colliding with a directory id.
2. **Segment vs path validation** — Today `isValidTreePath` allows full
   paths. Tree nodes need **segment** rules; reassemble paths only when
   projecting to packlist.
3. **Sort order** — One compare function (UTF-8 byte order) for segments
   and for flat path projection. Locale sort is a security/compat bug.
4. **Empty directories** — Continue to omit them. If someone later wants them,
   that is a **v3** (identity change). Document the ruling.
5. **No modes / executables** — Zip already normalises permissions. Do not
   introduce Git-style `100644`/`100755` into the tree encoding; it would
   fork identity on meaningless bit flips.
6. **`packlist.json` stays outside the logical tree** — Unchanged. It
   *describes* the tree; including it would be circular.
7. **Loss of the `shasum` one-liner** — Accept it. Offer
   `deck hash --flat` (print v1-shaped listing) for humans, but **identity
   is v2 only**. Do not dual-publish both roots as authoritative.
8. **Signature / lock churn** — Any pre-cutover local seals and envelopes
   are trash. Fine pre-ship; script `rm -rf **/.deck/store` in the notes.
9. **Derived minify trees** — Still new roots with `derivedFrom`. Merkle
   does not change derivation; proofs work the same on derived roots.
10. **Don’t “borrow” Git’s tree bytes** — Different hash, different
    encoding, no modes. Borrow the *shape* (blob + tree + root), not the
    format.
11. **Proof malleability** — Specify exact proof encoding (sibling hex +
    side). Verify against recomputed parent nodes, not against a trusted
    packlist from the prover.
12. **Large fanout directories** — A directory with 10k children is one fat
    tree object. Rare for ESM packages; if it appears, consider v3
    intermediate “index” nodes later — out of scope now.
13. **Conformance must use a golden root** — Self-consistency alone hides a
    wrong but stable encoder. Fixture locked in `packages/conformance`.
14. **Laws text** — L1 today names `tree-hash-v1`. Update the law and the
    suite together in one commit; do not leave the law lying.

---

## 5. Interaction with existing laws

| Law | Effect |
| --- | --- |
| L1 Identity | Spec string becomes `tree-hash-v2`; still “logical file tree only” |
| L2 Round trip | Unchanged; packlist projection must match root |
| L3 Pointer | Unchanged (`version → treeHash`) |
| L9 Endorsement | Still signs the root hex; proofs hang off that subject |
| L10 Inheritance | Same root ⇒ same bytes ⇒ same endorsements (stronger story with shared subtree nodes) |
| L12 Serving | `Content-Digest` stays per-file; optional proof endpoint is additive |

Storage compression, pack rebuild, and HTTP caching stay non-laws.

---

## 6. Migration plan (pre-ship)

1. Land H1+H2 behind the only code path (no v1 fallback).
2. Regenerate conformance fixture golden.
3. Delete local stores / re-vendor demos (`neon-drift`, hello scaffolds).
4. Update Deckbook + laws status table.
5. Add one measured note: vendored `three`-sized tree — node count, bytes
   of tree objects vs flat packlist, proof size for a deep path.

No dual-read of v1. Dual-read is for post-ship emergencies; we are not
there.

---

## 7. Open questions (decide in the implementation PR)

1. **Persist tree nodes in v1 of this work, or flat packlist only?**
   Recommendation: persist nodes before ship (slice H3) so subtree sync /
   have-want is real, not theoretical (§0.1).
2. **Proof HTTP surface now or later?** Recommendation: core API + CLI
   prove/verify in the cutover PR; HTTP in a follow-up.
3. **Name in packlist JSON** — keep `{ spec, hash }` (yes).
4. **Binary tree encoding later for size?** Text first; binary only if
   measurement says tree objects dominate (unlikely vs blobs).

---

## 8. Success criteria

- [ ] `TREE_HASH_SPEC === 'tree-hash-v2'` everywhere identity is named
- [ ] Same fixture directory → stable golden root on every agent/OS
- [ ] `pack(unpack(P))` and `treeHash` round trips still hold
- [ ] Inclusion proof verifies for a vendored deep path and fails if one
      sibling is altered
- [ ] Laws + `deck conform` green; no v1 hash left as authority
- [ ] Short Deckbook note: what a treeHash is (Merkle root) and what a
      proof is for

---

## 9. Summary

Ship **Merkle directory identity** now, while seals are still disposable.
Keep blobs and packlists; change only how the **root** is computed and
persist **tree** nodes beside blobs. Borrow Git’s (and Radicle’s) shape; do
not copy Git’s format or OIDs. The payoff is subtree compare, inclusion
proofs, and a content root that later tip maps / inventory fetch can hang
off — without this PR trying to become a forge protocol.
