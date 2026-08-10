# Deck at rest

Written 2026-08-09. This document describes what a Deck depot looks like on
disk, and what a second implementation must agree with. It uses ASD-STE100
Simplified Technical English.

It replaces `reference/at-rest-protocol-v2.md`, which stays in the repository
without changes because it is the record of the rulings of 2026-08-07.

**What Deck specifies, and what it does not.** Deck is an addressing scheme
and two formats, supplied over HTTP with defined cache behaviour. The address
grammar, the cache rule for each form of address, and the read-only endpoints
are the agreement between two programs. `tree-hash-v1` and the Deck Pack are
formats. The store layout in section 3, the command-line tool and the watcher
are implementation: no law requires a server to store anything this way.

Deck is not a federation protocol. Offers and endorsements addressed by tree
hash are the parts that need two servers, and they are not finished.

**The laws are the contract, not this document.** `docs/deck-laws.md` states
the twelve laws. `packages/conformance` examines them, and it also examines a
broken implementation, to prove that the examination can fail.
Where this document and the laws disagree, the laws are correct. Where the
laws and the conformance suite disagree, the suite is correct.

---

## 1. Vocabulary

The vocabulary changed in `docs/deck-step-version-vocabulary.md`. The
important changes from v2:

| now | was | why |
| --- | --- | --- |
| **Version** | sealed deck, seal | "Seal" was a noun for a published version, a noun for a history checkpoint, and a verb. Three meanings for one word. |
| **Step** | seal, frame, tick | One capture of the working tree. One Step for each save. |
| **Timeline** | history, the tape | The Steps in order. |
| **Deck Pack** | cardpack | The file form is `.pack.zip`. The name `cardpack` belongs to the v0.2 implementation. |
| **depot** | realm, collection | A directory that is also a URL space. |
| **Import / Pin / Entry** | dependency, resolution | What a deck asks for, the exact address that answers, and the module a deck offers. |

Words to avoid: *tier* for a level of history, *frame* or *tick* for a Step,
and *seal* alone. Write *Version*, *Step*, or *to seal*.

---

## 2. The layout

A depot is a directory. The layout of the directory is the URL space that the
server supplies.

```
<depot>/
  <publisher>/<package>/…            the live tree — the files you edit
  .deck/
    store/
      _objects/<aa>/<sha256>         one file's bytes, one time
      _trees/<aa>/<treeHash>.json    one tree's packlist, one time
      <publisher>/<package>/meta.json    Versions and dist-tags
    claims/<actor>.json              declared work in progress
    policy.json                      the cooldown policy
  .jj/                               the Timeline, when a backend attached
```

**Target (deckd):** Timeline moves under `.deck/timeline/` and derived build
cache under `.deck/build/` — **no top-level `.jj`**. See
[`deck-daemon.md`](deck-daemon.md). Until that lands, `.jj/` above remains
the reference layout.

Two rules make this work:

1. **The store path and the URL path have the same shape.** A package at
   `/<depot>/<publisher>/<package>@<version>/<file>` is stored under
   `<depot>/.deck/store/<publisher>/<package>/`. Neither path has to be
   translated into the other.
2. **The machinery is invisible to the tree hash.** `DEFAULT_IGNORE` excludes
   `.deck`, `.jj`, `.git`, `node_modules` and `.DS_Store`. A caller can add to
   that set. A caller cannot remove from it, because two implementations would
   then hash one directory differently.

Copy the directory and you copy the live files, the Versions and the Timeline.

**A depot is close to a monorepo**: many packages in one directory, one
history, one thing to clone, and a change that crosses several packages is
one change. Four differences are worth knowing.

- Each deck has its own version line. A monorepo usually versions everything
  together, or needs a tool so that it does not have to.
- The directory layout *is* the URL space. A consumer imports one module from
  one deck, and no build step extracts it first.
- The publisher segment lets two people hold the same package name in one
  depot. That is a fork inside the repository, and it costs nothing until the
  bytes differ.
- There is no workspace file and no link step. A deck names another deck by
  address, and `deck lock` turns the range into a pin.

---

## 3. The store

The store is **content-addressed for each file**, and the objects belong to
the whole store, not to one package.

- A Version is a **pointer**: a version number, and the tree hash it names.
- A tree is a **packlist**: the paths in the tree, and the hash of each file.
- A file is an **object**: the bytes, stored one time under their hash.

Four results, and all four are deliberate:

- To publish a tree whose bytes are in the store already writes no bytes.
- To change one file in a package of 374 modules costs one object.
- A fork that has no changes costs nothing, across publishers.
- To release a Version from a state that exists is a change to `meta.json`.

The pack is not stored. The server builds it from the objects when a client
asks for it. This is what keeps `pack(unpack(P)) === P` exact to the byte:
canonical-zip-v1 is deterministic, and the packlist fixes the order and the
hashes.

### 3.1 The version record

```json
{
  "name": "acme/palette",
  "upstream": "npm:@acme/palette",
  "versions": {
    "1.4.0": {
      "treeHash": "39c5f357…",
      "storage": "blobs-v1",
      "publishedAt": "2026-08-09T07:14:09.686Z",
      "upstreamPublishedAt": "2024-03-01T12:00:00.000Z"
    }
  },
  "tags": { "latest": "1.4.0" }
}
```

- `storage` says how the bytes are materialised. It is recorded and not
  inferred, so a reader never has to guess from which other fields are
  present. `pack-v1` records name an archive and still serve; `blobs-v1`
  records use the objects.
- `publishedAt` is when the Version entered **this** store.
- `upstreamPublishedAt` is when the registry published what was vendored.

The two times are separate because they are years apart for anything
vendored, and a reader that treats either one as "the" publish time sorts the
list wrongly. Neither time is filled in for a record written before the
fields existed. An invented time — the modification time of the file, the
moment it was first read — would make an at-rest store answer differently
depending on when it was asked.

---

## 4. Addresses

```
/<depot>/<publisher>/<package>[@<spec>]/<path>
/<depot>/_history/<changeId>/<publisher>/<package>/<path>
```

The publisher segment is the fork boundary. A path segment that starts with
`_` is reserved for the protocol.

| address | is | cache |
| --- | --- | --- |
| no version segment | the live tree | `no-store` |
| `@<exact>` | one Version | `immutable` |
| `@<range>` or `@<tag>` | a name for a Version | one redirect to the exact address |
| `/_history/<changeId>/…` | one Step | `immutable` |

A range never matches a prerelease. `latest` is a dist-tag on a stable
Version, and `latest` is not live.

---

## 5. The Timeline

A depot has one of two answers, and the server **reports** which one. It does
not pretend. Do not number these, and do not call them tiers: the two answers
have names.

- **Versions only.** Each settled save becomes an immutable `-dev.N` Version.
  The Versions are the history. Always available.
- **A Timeline.** Each save also becomes a Step, at
  `/<depot>/_history/<changeId>/…`, and `deck history` and `deck restore`
  work. Available when a history backend is attached.

A backend that is missing or has stopped leaves the depot with Versions only.
The server prints the reason and does not stop the live loop. `/_packages`
carries the answer for each depot, so a client asks instead of assuming.

---

## 6. Writes

The distribution surface is read-only: `GET` and `HEAD` (L12). Every write
goes through the command-line tool or the watcher, which arrange the state on
disk. Distribution follows.

This is why declared work in progress is a **file** in `.deck/claims/` and not
a `POST`. An agent writes the file; the server reads it; the reader deletes
the file to ask the agent to stop. See `docs/deck-activity-protocol.md`.

---

## 7. Not decided: revocation, warning, incident

**This is the largest hole in the at-rest half. It is written here so that
nobody implements around it by accident.**

A signature over a tree hash lets a person say "I stand behind these exact
bytes". That much is built, and it is what makes the valuable thing possible:
you can let a deck run against sensitive data because somebody you trust
signed the bytes that will run — not a name that could point somewhere else
tomorrow.

A signing system is not finished when it can say yes. It must also say **no,
after the fact**:

- **Revocation.** The signer withdraws the signature. The bytes did not
  change and cannot change, so the withdrawal must be a separate statement
  about the same tree hash.
- **Warning.** Weaker than a revocation. The bytes still work, and there is
  something you should know before you run them.
- **Incident.** A statement by somebody who is not the signer: a report that
  these bytes did something they should not have done.

Three decisions already constrain the answer:

1. **There is no unpublish** (L4). A Version cannot be altered or removed, so
   the only way to say it is bad is to say so *about* it. That is the same
   shape as an endorsement, and it is the correct shape.
2. **A statement is addressed to the tree hash** (L9), so a revocation
   reaches every publisher that holds those bytes, exactly as an endorsement
   does (L10). A revocation that named a package would miss every fork.
3. **Fail closed** (L11). An unknown answer is not a safe answer. This is the
   hard part: "I could not read the revocation list" must not quietly mean
   "not revoked", and it must also not stop a depot that is offline by
   design.

Open questions. None is answered here:

- Who may revoke? Only the signer, or also a named authority?
- How does a reader learn of a revocation? A list beside the tree, a feed, or
  a statement it must go and look for?
- What is the freshness rule, given point 3?
- Does a revocation travel between depots? That part is in motion, and
  section 3.5 of `deck-in-motion.md` says it is not built.

Until this is settled, treat a signature as a positive statement only. Do not
build anything that depends on taking one back.

---

## 8. For a realm server

The parts of this that transfer, and the order to read them:

1. `docs/deck-laws.md`. Twelve laws. An implementation that breaks one will
   not interoperate.
2. `packages/conformance`. Run it against your depot with
   `deck conform <dir>`. This is the definition of agreement, and prose is
   not.
3. This document, for the layout.
4. `docs/deck-step-version-vocabulary.md`, so the same word means the same
   thing in both systems.

`reference/at-rest-protocol-v2.md` is the earlier design and is kept for the
record only. Do not implement from it.
