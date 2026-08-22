# The realm download is a Deck Pack with its questions unanswered

**Status: ANALYSIS** (2026-08-09). Companions:
[`deck-pack-equivalence.md`](deck-pack-equivalence.md),
[`deck-cardpack-requirements.md`](deck-cardpack-requirements.md) (the
two-plane model and the recovered rewriting rules),
[`deck-boxel-backport-plan.md`](./plans/deck-boxel-backport-plan.md) (K14).

> **Vocabulary.** This note is about the Boxel construct, so it says **realm**
> throughout and means it.

---

## 0. The claim

Boxel already ships "download this realm as a zip". It is not a rival to Deck
Pack and it is not a coincidence. **It is the degenerate case of one** — the
pack you get when the closure walk is replaced by "copy the directory" and
every question a pack exists to answer is answered by silence.

The export side of that is tidy but minor. The reason it matters is the
**import** side: a pack carrying its provenance can be pushed into a realm at
a different URL and *re-homed mechanically*, because the receiving server
knows what every reference meant where it came from. Without provenance,
intake is prefix-matching over strings and hoping.

So the claim has two halves:

1. The download is Deck Pack in its most degenerate mode.
2. Provenance is not decoration on the export. It is the input to the
   **smart thing the realm server does on import** — and it is the whole
   difference between rewriting an artifact and re-homing it.

---

## 1. What it does today

`packages/realm-server/handlers/handle-download-realm.ts`, one handler, one
call site:

```js
let archive = archiver('zip', { zlib: { level: 9 } });
ctxt.set('content-type', 'application/zip');
archive.pipe(ctxt.res);
archive.directory(realmPath, false);
await archive.finalize();
```

Around that: a two-tier realm lookup that works whether or not the realm is
mounted, an auth path accepting a signed token on the query string so a
browser can navigate straight to it, and a filename built from the realm URL.

The plumbing is good and none of what follows is a criticism of it. But note
what is missing at the other end: **Boxel can write a zip and cannot read
one.** There is no zip reader anywhere in the monorepo. The feature is
export-only, which is exactly why the import questions have never had to be
answered.

---

## 2. Four questions a pack answers

| Question | Deck Pack | Realm download |
| --- | --- | --- |
| **What is this?** | `treeHash` — an identity you can compare, cite and verify | a filename |
| **What does it need?** | the decklist: every dependency, pinned | nothing |
| **Where did it come from?** | provenance: realm, Version, time | nothing |
| **What does the far side already have?** | a prune negotiation | *unrecorded* |

The first three are absences. The fourth is not.

---

## 3. The download already prunes — it just does not say so

A realm's cards reference things outside the realm: `https://cardstack.com/base/*`,
`@cardstack/boxel-ui/*`, sibling realms, and CDN libraries on `esm.sh` and
`esm.run`.

`archive.directory(realmPath, false)` carries none of it. The artifact is not
"everything" — it is **everything minus the entire external closure**, the
most aggressive prune available, taken silently, with no record of what was
dropped or what the recipient must supply.

It works because the recipient is, in practice, another Boxel host on the
same internet. The artifact is not self-sufficient; it is
*ambient-sufficient*. That is L6 hermeticity failing by omission rather than
by violation — nothing reaches out at pack time because nothing was packed.

The download is therefore not "a pack without pruning". It is a pack whose
prune decision is maximal, implicit and unwritten. Making it a pack does not
add a decision. It writes down the one already being made.

---

## 4. Directory-complete, not closure-complete

**What it gets right:** it carries both planes. The two-plane model
(`deck-cardpack-requirements.md` §0) separates the definition plane
(`.gts`/`.ts` modules) from the instance plane (`.json` cards with
`adoptsFrom` and `relationships`). A directory copy takes both without
trying, which is what "share an app with its content" needs; a
definitions-only deck slice would not.

**What it is wrongly credited with:** closure. Cards link across realms. A
card whose `relationships` point into a second realm downloads with a
dangling link and nothing in the artifact says so.

So: **directory-complete, not closure-complete.**

---

## 5. The import direction — what provenance is for

This is the half that pays.

### 5.1 What actually needs remapping

Grounded in `~/Projects/boxel-catalog`. Here is the catalog's own
`index.json`:

```json
{
  "data": {
    "meta": { "adoptsFrom": { "name": "Catalog", "module": "./catalog-app/catalog" } },
    "relationships": {
      "cardInfo.theme":  { "links": { "self": "./Theme/catalog-storefront" } },
      "featured.0":      { "links": { "self": "./4b6602-wine-cellar-card-definition/CardListing/6152b86e-…" } }
    }
  }
}
```

and its `realm.json`:

```json
{
  "attributes": {
    "backgroundURL": "https://boxel-images.boxel.ai/background-images/background-for-catalog-82x.jpg",
    "iconURL": "https://boxel-images.boxel.ai/icons/Letter-c.png"
  },
  "meta": { "adoptsFrom": { "module": "https://cardstack.com/base/realm-config", "name": "RealmConfig" } }
}
```

Four categories, and only one of them is a rewrite:

| Category | Example | On import |
| --- | --- | --- |
| **Within-realm relative** | `./catalog-app/catalog`, `./Theme/catalog-storefront` | **untouched.** Location-independent by construction |
| **Declared dependency, absolute** | `https://cardstack.com/base/realm-config` | **rebind**, not rewrite — it is a decklist entry |
| **Genuine external data** | `https://boxel-images.boxel.ai/icons/Letter-c.png` | **must not be touched.** It is content, not a reference |
| **Cross-realm card link** | an absolute `links.self` into another realm | the irreducible retargetable part |

The good news, which the catalog demonstrates: **most of a realm is already
relocation-safe**, because it uses relative references. The cardpack design
noted this — within-pack references stay relative, so a pack is
location-independent by construction, and absolute cross-realm URLs are the
retargetable part.

The bad news is the distinction between rows 2 and 3. Cardpack's `.json` rule
is that *every string value in the whole tree* is a rewrite candidate,
matched against `{from, to}` prefix pairs. `backgroundURL` survives today
only because `boxel-images.boxel.ai` happens not to match a rule. That is
luck, not design. A source realm URL that happened to prefix an asset URL
would corrupt data silently.

**Provenance is what turns that guess into a lookup.** With the decklist, the
absolutes that are dependencies are *enumerated*. Anything absolute and not
in the decklist is data, and is left alone — by rule, not by coincidence.

### 5.2 Two strategies: rewrite versus re-home

| | **Rewrite** (cardpack, as built) | **Re-home** (Deck) |
| --- | --- | --- |
| Mechanism | prefix-pair `{from, to}`, first match wins, dispatched by file extension | bind names to addresses in the import map |
| Touches file bytes? | yes — every `.json` string, every `from '…'` clause | no |
| Failure mode | silent over-match on data that looks like a URL | a name with no binding: loud, at import |
| Digests after | invalidated; must be recomputed | unchanged — the files are the same files |
| What it needs | a correct rule list, per import | the decklist that shipped with the pack |

Re-homing is better on every row, and the last one is why: the rules do not
have to be reconstructed at intake, because the pack brought them.

The mapping was already anticipated in `deck-cardpack-requirements.md` §7:
*"re-homing at intake; RRI mappings make most rewriting unnecessary
(reference form is hosting-independent)."* This note is the concrete case for
that line.

Rewriting does not disappear entirely — row 4, genuine cross-realm absolutes,
still needs it. But it shrinks from "every string in the tree" to "a declared,
enumerable set", which is the difference between a heuristic and an
operation.

### 5.3 What the pack must carry for the server to be smart

Concretely, the provenance block:

| Field | Why intake needs it |
| --- | --- |
| **source realm URL** | tells the server which absolute prefix meant *"me"* — the one thing that certainly must be re-pointed |
| **`treeHash`** | have I seen this exact tree before? Decides restore-vs-import before any file is read |
| **decklist, pinned** | separates dependency-absolutes (rebind) from data-absolutes (leave alone), and says which Version each name meant |
| **per-file digests** | identical content is skipped, not rewritten — the merge rule that makes re-import idempotent |
| **prune record** (§3) | what was assumed to be reachable, so intake can check rather than discover at first render |
| **base / toolchain generation** | whether this pack predates the receiving realm's base Version |
| **source Version + time** | the merge base (§5.4) and the audit trail |

### 5.4 Three intake verbs

Same artifact, three things a realm can do with it, distinguished by what the
provenance says:

- **Restore** — same realm, `treeHash` known. No remapping at all. The
  fast path, and the one that must never rewrite a byte.
- **Import / clone** — new realm URL. Re-home: rebind the decklist against
  this realm's resolution, re-point the source-realm prefix, leave data
  absolutes alone.
- **Merge** — into an existing realm with content. Per file: identical
  digest is *always* skipped regardless of conflict mode; differing content
  resolves by strategy. And here the source Version is not bookkeeping —
  **it is the common ancestor**, which is the same thing `boxel-cli sync`
  lacks today and the reason it can only offer `--prefer-local` /
  `--prefer-remote` / `--prefer-newest` (K4).

That last point is the one to notice. A pack that carries its source Version
makes merge-on-import a three-way merge for free, using the machinery K1 puts
in for other reasons.

---

## 6. The download as a pack mode

If the varying parameter is *what the recipient is assumed to have*, the
download stops being an exception and becomes a named mode:

| Mode | Carries | Assumes the recipient has | Use |
| --- | --- | --- | --- |
| **`bare`** | the realm's own files | base, boxel-ui, the CDNs, sibling realms | today's download; backup, inspection, host-to-host migration |
| **`hermetic`** | the full closure, both planes | nothing but a runtime | archival, air-gap, open-like-a-PDF, L6 |
| **`negotiated`** | the closure minus what the far side already reaches | whatever it declared | the normal case between two live realms |

Every mode carries the same provenance block. That is the point: the modes
differ in **what bytes travel**, never in **what the artifact knows about
itself**. A `bare` pack is still fully re-homeable — it just needs the
receiving realm to already have the externals.

`negotiated` needs design work (K14) because the far side has to state what
it can reach, and that statement is in-motion protocol. `bare` and `hermetic`
are the endpoints and need no conversation, which is why they ship first.

---

## 7. What changes when the button emits a pack

Same gesture, same place in the UI, `.pack.zip` instead of `.zip`:

- **An identity.** `treeHash` names it; two downloads compare without diffing.
- **Byte equivalence.** Two downloads of an unchanged realm are currently
  *not* byte-identical — archiver takes mtimes from the filesystem and orders
  the central directory by append order. A canonical pack fixes the zip
  epoch, zeroes external attributes and sorts entries, so equal content means
  equal bytes. That is what makes the hash mean anything.
- **A decklist**, so intake can classify absolutes instead of guessing.
- **Provenance**, so re-homing is a lookup.
- **Unpack**, which does not exist today in any form.

And one deletion: `archiver` is one dependency at one call site. When the
pack writer takes over, it goes.

---

## 8. Three engineering consequences

**(a) Streaming versus hashing — measured, and it is not the ceiling.**
Archiver streams to the response. Deck's writer is
`writeCanonicalZip(entries): Buffer`, in memory, because the finished bytes
are what gets hashed. `canonical-zip` caps at `MAX_TOTAL_SIZE = 512 MB` and
`MAX_ENTRIES = 10_000`, so a realm that downloads happily today may not be
packable.

The open question was whether identity is what forces the buffering. It is
not. `packages/tools/spikes/streaming-hash.mjs` builds a pack at the cap and
verifies it two ways — 9,999 files, 509 MB logical, 169 MB on disk:

```
  unpack()          1555 ms   peak   967 MB   held   693 MB
  streamed          1774 ms   peak   168 MB   held    25 MB
  (baseline                   peak    85 MB   held    17 MB)

  tree hash agrees:  YES
  arrived sorted:    YES — no buffering needed to reach manifest order
  held over baseline: unpack +676 MB · streamed +8 MB
```

**One pass, no sort, ~8 MB retained for a half-gigabyte tree.** The reason is
structural rather than lucky: `tree-hash-v1` is a manifest over
`(path, sha256)` sorted in UTF-8 byte order, and `canonical-zip-v1` stores
entries in exactly that order after the packlist. A canonical pack therefore
arrives pre-sorted, so each entry can be hashed as it goes past and its
manifest line appended. Nothing is held but the manifest — 9,999 lines, under
a megabyte. The spike asserts the ordering rather than assuming it; if it
were false, every path would have to be resident before anything could be
hashed and the whole idea would collapse.

Two limits on the result, both worth carrying forward:

- **Canonical packs only.** This reads sizes from the LOCAL header, which
  `canonical-zip-v1` always writes. A general zip may defer them to a data
  descriptor, or disagree with the central directory — which is why the
  ordinary reader treats the central directory as the truth. Foreign zips
  still need the buffered path. Fair: a pack we emit is canonical by
  construction.
- **Writing is the expensive half, and it was not solved.** `pack()` took
  44 s and peaked over 1 GB at the cap, almost all of it deflate at level 9
  over a fully materialised tree. Verification streams; production does not.

So the ceiling is the writer, not the identity — which means it is an
implementation limit rather than a protocol one, and raising it does not
touch the laws.

**(b) The canonical writer cannot be archiver.** It wraps `node:zlib` rather
than replacing it, writes non-deterministic bytes by default, and cannot
read. Forcing it to be canonical means controlling every field, at which
point it is `canonical-zip` with an extra dependency underneath.

**(c) Intake is a new subsystem, and it is the larger half.** Export is a
writer swap. Import is a reader, a provenance parser, a classifier over
absolutes, a re-homing pass, and a merge with conflict rules — against
`Realm.write`/`writeMany` (Seam B). Sizing the work as "make the download a
pack" underestimates it by most of the effort.

---

## 9. What this rules

1. **Realm download is Deck Pack in `bare` mode.** Not a parallel format, not
   a legacy path. One writer, one reader, one identity rule.
2. **Every pack declares its prune**, including the one that prunes
   everything. Silent ambient assumptions are the failure mode to design out.
3. **Every pack carries the same provenance block regardless of mode.** Modes
   vary the bytes, never the self-knowledge.
4. **Prefer re-homing to rewriting.** Rewrite only the enumerated cross-realm
   absolutes; never walk every string in the tree. Data that looks like a URL
   is data.
5. **`bare` and `hermetic` before `negotiated`** — endpoints first, no
   protocol conversation needed.
6. **The download's HTTP plumbing survives** — streaming, signed-token auth,
   filename derivation, unmounted-realm lookup. Only byte production changes.

---

## 10. Open

1. ~~**Streaming a hashed artifact.**~~ **Settled (W10).** One pass,
   incremental, no second read and no sort — canonical order IS manifest
   order. Measured at the cap: ~8 MB retained against `unpack`'s 676 MB
   (§8a). What remains open is the *writer*, which still materialises the
   whole tree to deflate it, and the entry cap: the packlist counts as an
   entry and against `MAX_TOTAL_SIZE`, so `MAX_ENTRIES = 10_000` is really
   9,999 tree files, and at that entry count the packlist itself spends
   ~1 MB of the 512 MB budget.
2. **Does `bare` carry a packlist?** It must, to have a `treeHash` — but a
   packlist over realm files alone describes a tree that cannot be fully
   resolved. Honest, and worth confirming that is acceptable rather than
   accidentally implying completeness.
3. **Cross-realm instance links.** Does a `hermetic` pack follow
   `relationships` into a second realm, or record the boundary and stop? The
   two-plane closure walk assumes one realm; this is where that stops being
   true.
4. **Identity of re-homed instances.** A card's own id changes when the realm
   URL changes. Is the imported card the same card (keep a stable identity
   across realms) or a new one (mint fresh ids and record the ancestry)? This
   is the one open question that is a product decision, not an engineering
   one — and remix (K8) leans on the answer.
5. **Where the mode is chosen.** UI affordance, query parameter, or the
   recipient's declaration. Probably the last, once negotiation exists;
   `?mode=bare` is the honest interim.
