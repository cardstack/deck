# Review: `tree-hash-v2` — what to keep, what to unbundle, what to drop

**Status: REVIEW** (2026-08-08) of `deck-tree-hash-v2-merkle-proposal.md`.
Companions: `deck-laws.md` (L1, L9), `packages/core/src/tree-hash.ts`,
`packages/core/src/object-store.ts`.

The proposal is well argued and the Radicle read in §0.1 is the right kind of
homework. This review does not disagree with its goals. It disagrees with
one thing — that they arrive as a bundle — and it brings measurements the
proposal asks for but does not yet have.

**Summary of the recommendation:**

1. **Do now, with no law change:** persist Merkle *subtree* hashes as an
   index beside the flat packlist. That is proposal slice H3 **without** H1.
2. **Fix now, independently of v2:** a Unicode normalisation hole in L1 that
   already threatens the golden root, and the domain-separation reasoning in
   §4.1, which is incorrect as written.
3. **Do not change the root hash yet.** And if the root ever does change,
   the proposal's structure is the wrong one for the only capability that
   requires the change.

---

## 1. Four of the five gains do not need a new root hash

§2 lists the capabilities. Sorted by what they actually require:

| Capability | Needs the root to *be* a Merkle root? | Actually pays? |
| --- | --- | --- |
| Subtree compare (“these decks share `lib/`”) | **No** | Yes — see §1.1 |
| Subtree vendor / pin | **No** | Yes, if wanted as a feature |
| Directory-node dedup, GC refcounts, “N packages share this tree” | **No** | Yes |
| Partial `?meta` / browse by directory node | **No** | Marginal |
| Federation `have`/`want` on subtree ids | **No** | **No — §2.2** |
| **Inclusion proof against the sealed `treeHash`** | **Yes** | **No — §2** |

Every “no” in the middle column is satisfied by *computing and persisting*
directory hashes as an index alongside the existing flat root, while
`treeHash` remains exactly what L1 says it is today. Only the last row needs
L1 to change, because a proof must terminate in the thing that was signed.

So the proposal bundles **one law change** with **five pieces of additive
storage work**. That alone is a reason to split the PR — but the third
column is the more important finding, and it is why this review recommends
building much less than the proposal asks for.

### 1.1 What the index is, precisely

A fourth kind of thing in the store, beside the three that exist:

```
_objects/<aa>/<sha256>          one file's bytes            (exists)
_trees/<aa>/<treeHash>.json     the packlist, flat          (exists)
<pub>/<pkg>/meta.json           versions → treeHash         (exists)
_nodes/<aa>/<dirHash>           one directory's children    (the index)
```

Each node lists only immediate children — `blob <sha256> <name>` or
`tree <dirHash> <name>` — so a directory acquires a name that can be
compared in one operation.

It needs no law because it is **derived data**. Identity stays
`sha256(flat manifest text)`. `rm -rf _nodes` breaks nothing and rebuilds by
walking packlists. Since nothing resolves through it, it cannot make two
implementations disagree — the only thing L1 exists to prevent.

What it genuinely buys is **local subtree identity**: “is this fork's
`src/math/` byte-identical to upstream's?” as one hex compare rather than a
374-way diff, plus refcounts and dedup accounting at directory granularity.
Those are O(1) local lookups, and the fat-directory problem in §2 does not
touch them.

What it does **not** buy is bytes on the wire (§2.2).

---

## 2. The one gain that needs the change does not pay at package shape

The proposal calls inclusion proofs the payoff. §4.12 files fat directories
as a rare edge case to defer. **That is backwards, and it is load-bearing.**

A directory Merkle node is not a binary Merkle node. To recompute an
ancestor you need that directory's **entire child list**, not one sibling
hash. So a proof costs the sum of the full node encodings along the path —
and published packages are shaped exactly wrong for that: one fat `lib/`,
`dist/`, or `src/` holding dozens to hundreds of siblings.

Measured, on three real trees (script in the review transcript; sizes are
bytes, gzip level 6):

| Tree | Files | Flat manifest | gzipped | v2 nodes | Proof (median) | Proofs beating the gzipped manifest |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `eslint/lib` — fat, package-shaped | 384 | 35,761 | 18,424 | 35,547 | **27,377** | 81/384 (21%) |
| `typescript/lib` — flat | 125 | 11,190 | 5,617 | 12,782 | **11,261** | 0/125 (0%) |
| `deck packages/` — deep, balanced | 117 | 10,706 | 5,116 | 11,898 | **1,609** | 117/117 (100%) |

`eslint/lib` was chosen because it is 384 files — the same scale and rough
shape as the vendored `three@0.160.0` `src/` tree at 374 modules.

Read the first two rows. **For package-shaped trees the inclusion proof is
larger than simply shipping the whole gzipped manifest.** For a flat package
it is always larger, by construction: the proof *is* the root listing. The
capability the cutover exists for costs more than the thing it replaces, in
the case Deck actually serves.

The third row is the shape where it works — deep and balanced, which is what
a source repository looks like and what a published package does not.

### 2.2 The same measurement kills `have`/`want` on subtree ids

An earlier draft of this review claimed federation sync was a gain the index
delivers without a law change. Measured, it is not — and the reason is that
it is *the same walk*. Locating a one-file change by descending from the root
and fetching each node whose hash differs costs the full child list of every
fat ancestor, which is the proof cost under another name:

| Tree | Flat packlist, gzipped | Index walk, median | Index cheaper for |
| --- | ---: | ---: | ---: |
| `eslint/lib` | 18,424 | **27,377** | 81/384 (21%) |
| `typescript/lib` | 5,617 | **11,261** | 0/125 (0%) |
| `deck packages/` | 5,116 | **1,609** | 117/117 (100%) |

Identical figures to the proofs table, because it is the identical
computation. For published-package shape the thing that beats the index is
what the store can already do: ship the gzipped packlist in one round trip
and diff it locally.

This matters for how much to build. Stripped of the sync claim, the index
buys **observability and accounting, not bytes** — worth having eventually,
not worth prioritising now, since blob-level dedup already captures the disk
savings. It earns its place when trees are deep and balanced, or if
subtree-level pinning becomes a feature that is actually wanted.

### 2.1 And if you do want proofs, this is the wrong structure

A binary Merkle tree over the sorted manifest lines gives a genuine
`log₂(n)` proof: sibling hashes plus direction bits, no directory nodes at
all.

| Tree | gzipped manifest | directory-Merkle proof | binary-Merkle proof |
| --- | ---: | ---: | ---: |
| `eslint/lib` | 18,424 | 27,377 | **290** |
| `typescript/lib` | 5,617 | 11,261 | **225** |
| `deck packages/` | 5,116 | 1,609 | **225** |

Sixty-three times smaller than the gzipped manifest on the package-shaped
tree, and ninety-four times smaller than the proposal's proof. Uniform
across shapes, because it does not care how fat a directory is.

The conclusion is sharper than “defer v2”:

> A directory Merkle is good at the thing that does not need to be in the
> root (subtree identity) and bad at the only thing that does (proofs).

If both are wanted, they are two structures, not one: subtree hashes as an
index, and — should proofs ever be needed — a binary Merkle over the sorted
manifest as the root. Conflating them buys the weaknesses of each.

---

## 3. The urgency argument is weaker than it reads

> “After ship, a hash-function change is a forever dual-stack.”

Deck already versions this. `TREE_HASH_SPEC` is in every packlist, and L1's
own commentary says a change to these rules “is a new spec version, never
silent drift.” A v1 hash does not become *wrong* when v2 exists — it stays a
correct name for those bytes forever, which is the whole point of content
addressing. Post-ship migration is therefore “seals made under v1 keep their
v1 hashes; new seals are v2,” which is read-support for one legacy spec
string. Git is doing exactly this for SHA-1 → SHA-256 right now.

Doing it before ship is still *cheaper*. It is not the difference between
possible and impossible, so it should not carry the decision on its own —
especially when §2 says the headline capability does not currently pay.

---

## 4. Two defects to fix regardless of what happens to v2

### 4.1 Domain separation is claimed but not achieved

§4.1 says the `tree-hash-v2\n` header “prevents a file whose contents look
like a tree object from colliding with a directory id.” It does not. Blob
ids stay `sha256(file bytes)` with no prefix — §Non-goals explicitly keeps
it that way — and the header lives *inside* the tree encoding, which an
author of a file can reproduce byte for byte. Authoring a file whose bytes
are a valid tree encoding yields `blobId === treeId`.

Today that is probably not exploitable, because `<type>` in the parent line
means an id is always resolved knowing what it is. But §3.3 offers to store
tree nodes “as `_objects`” — one content-addressed namespace shared with
blobs — and in that layout it becomes real.

Two honest resolutions, and the proposal should pick one normatively:

- prefix blobs too, Git-style (`sha256("blob " + len + "\0" + bytes)`) —
  which contradicts the non-goal of leaving per-file sha256 alone; or
- keep blobs and trees in **separate namespaces** and state that ids are
  only ever resolved with their type known. Then say the header provides
  *encoding* clarity, not collision resistance.

### 4.2 L1 does not specify Unicode normalisation — and the fixture depends on it

§8 promises “same fixture directory → stable golden root on every agent/OS.”
The conformance fixture contains `ä-utf8.txt`, and neither v1 nor v2 says
anything about normalisation. Paths are hashed as UTF-8 bytes, so NFC
(`U+00E4`) and NFD (`U+0061 U+0308`) are different paths and different
roots. APFS preserves what it is given; HFS+ normalises to NFD; archive
tools and platforms vary.

The golden root is stable today by luck, not by rule. This is a **v1 bug**,
it lives in the law rather than in v2, and it should be closed either way —
normalise to NFC before hashing, or refuse non-NFC paths at seal time (which
is more in keeping with L11).

---

## 5. Two smaller notes

**v2 is additive storage, not a replacement.** §3.2 correctly keeps the flat
packlist, so option B stores both. Measured, tree nodes run 0.99–1.14× the
flat manifest, so the metadata roughly doubles. Worth stating plainly in the
proposal rather than leaving it implied.

**Serving stays flat.** `readTreeFile` resolves a path against a flat JSON in
one read. Walking root → `lib` → file would be N reads at depth N on the hot
path. Since §3.2 keeps the packlist, this is fine — but it means the Merkle
side is never on the serving path, which is another argument for it being an
index rather than the identity.

---

## 6. What this leaves

**Land now (no law touched, no seals invalidated):**

- Close the Unicode normalisation hole in L1 and its conformance check.
  This is the only item here that is a *bug*.
- Correct §4.1 and choose a namespace ruling.

**Build when there is a reason, not before:**

- The subtree index (proposal H3, minus H1). It is cheap and it is the right
  shape, but on today's evidence it buys accounting rather than bytes, and
  blob-level dedup already has the disk savings. Deep-balanced trees or a
  subtree-pinning feature are what would make it earn its place.

**Decide later, on evidence:**

- Whether the root changes at all. The trigger is a verifier that both
  *lacks the packlist* and *does not trust the server it is fetching from* —
  the mirror and federation story, which needs Matrix identity and a trust
  model, both still listed as unreached in `deck-laws.md`.
- If that trigger arrives, measure the shapes actually being served. On
  today's evidence the answer would be a binary Merkle over the sorted
  manifest, not a directory Merkle — and that is a smaller change to L1 than
  this proposal, because it leaves the logical tree and the flat manifest
  exactly as they are and only changes how the manifest is folded into a
  root.

**What the proposal gets right and should keep:** identity over the logical
tree and nothing else; no Git bytes, no modes, no SHA-1; keep the flat
packlist as a projection; empty directories stay meaningless; a golden root
rather than mere self-consistency; and the instinct that endorsement should
hang off a content root rather than a name. None of that is in question.
