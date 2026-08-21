# Deck at rest inside a realm

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

Deck's package-serving laws do not require federation. The first durable
Repository, Checkpoint, and Ref layer is specified separately in
[`deck-collaboration-protocol.md`](deck-collaboration-protocol.md). Its local review
Request workflow and conditional object-store adapters are implemented;
hosted identity, policy, and cross-server discovery remain unfinished.

**The laws are the contract, not this document.** `docs/deck-laws.md` states
the twelve laws. `packages/conformance` examines them, and it also examines a
broken implementation, to prove that the examination can fail.
Where this document and the laws disagree, the laws are correct. Where the
laws and the conformance suite disagree, the suite is correct.

---

## 1. Vocabulary

The vocabulary changed in `docs/deck-step-version-vocabulary.md`. The
important changes from v2:

| now                      | was                    | why                                                                                                                  |
| ------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Version**              | sealed deck, seal      | "Seal" was a noun for a published version, a noun for a history checkpoint, and a verb. Three meanings for one word. |
| **Step**                 | seal, frame, tick      | One capture of the working tree. One Step for each save.                                                             |
| **History**              | timeline, the tape     | The Steps in order.                                                                                                  |
| **Deck Pack**            | cardpack               | The file form is `.pack.zip`. The name `cardpack` belongs to the v0.2 implementation.                                |
| **depot**                | realm, collection      | A directory that is also a URL space.                                                                                |
| **Import / Pin / Entry** | dependency, resolution | What a deck asks for, the exact address that answers, and the module a deck offers.                                  |

Words to avoid: _tier_ for a level of history, _frame_ or _tick_ for a Step,
and _seal_ alone. Write _Version_, _Step_, or _to seal_.

---

## 2. The layout

A mutable Deck repository is rooted in one realm directory. A repository may
contain one package or several member packages, but all of its Deck machinery
is inside that realm. A host may aggregate many realms in one bucket or
process; it must not move their Deck objects into a parallel global tree.

```
<realm>/
  <authored realm tree>/…            default-branch files you edit
  package.json                       conventional package metadata, where applicable
  importmap.json                     optional root resolution input
  apps/<name>/…                      conventional app/package locations
  packages/<scope>/<name>/…          conventional package locations
  .deck/
    repository.json                 optional multi-package authoring manifest
    store/
      _objects/<aa>/<sha256>         one file's bytes, one time
      _trees/<aa>/<treeHash>.json    one tree's packlist, one time
      _locks/<aa>/<lockHash>.json    one composed exact lock, one time
      _repositories/<aa>/<hash>.json one Repository state, one time
      _checkpoints/<aa>/<hash>.json  one authored Checkpoint, one time
      _revisions/<aa>/<hash>.json    legacy V1 objects; read-only
      <publisher>/<package>/meta.json    Versions and dist-tags
    refs/heads/<branch-token>.json   mutable branch heads
    refs/published.json              optional mutable published Release ref
    reviews/
      objects/<aa>/<hash>.json       immutable Review openings
      events/<aa>/<hash>.json        append-only Review events
      numbers/<n>.json               mutable numbered Review refs
      counter.json                   mutable number allocator
    indexes/<aa>/<hash>/…            completed index generations
    releases/
      objects/<aa>/<hash>.json       immutable host Releases
    branches/<opaque-id>/
      source/                        non-default branch materialization
      history/repo/                  branch-local jj History
      transaction/                   prepared recovery records
      index-staging/                 private index build files
    claims/<actor>.json              declared work in progress
    policy.json                      the cooldown policy
    history/
      repo/                          default-branch every-save jj History
  .jj/                               thin jj workspace stub; not durable identity
```

This deliberately keeps the filesystem shape proven by Boxel's
`deck/at-rest-poc`: the default branch is the realm root, not
`branches/main/source` and not a generated checkout. Existing paths remain
valid. The examples above do not require every realm to contain `apps/`,
`packages/`, a root `package.json`, or a root `importmap.json`.

`package.json` and `importmap.json` have different, composable jobs.
`package.json` lives at a conventional package boundary and carries identity,
exports, and dependency suggestions. A root import map and any applicable
nested import maps are authored resolution inputs. Deck resolves their
inheritance and scopes and stores the canonical composed result as the exact
lock object named by `lockHash`. A Checkpoint therefore closes over the
effective lock, not over an assumption that one root file controls the whole
realm.

deckd stores default-branch History under `.deck/history/repo`; its small top-level
`.jj/` workspace stub points there because stock jj discovers that basename.
For a selected non-default branch, the realm view projects that branch's
physical History as `/.deck/history/repo` too. Agents never need the opaque
host path.
Derived build cache lives under `.deck/build/`. See
[`deck-daemon.md`](deck-daemon.md).

Two rules make this work:

1. **The store path and the URL path have the same shape inside its realm.** A
   package at `/<realm>/<publisher>/<package>@<version>/<file>` is stored under
   `<realm>/.deck/store/<publisher>/<package>/`. Neither path has to be
   translated into the other.
2. **The machinery is invisible to the tree hash.** `DEFAULT_IGNORE` excludes
   `.deck`, `.jj`, `.git`, `node_modules` and `.DS_Store`. A caller can add to
   that set. A caller cannot remove from it, because two implementations would
   then hash one directory differently.

Copy the realm directory and you copy its live files, branches, Versions,
Reviews, indexes, and History. Creating a branch is narrower: clone the
authored realm tree while excluding `.deck`, `.jj`, `.git`, and other
implementation directories, then initialize the new branch's History and
index through their owning services.

**A multi-package realm is close to a monorepo**: many packages in one
repository boundary, one default branch, and a Checkpoint that can cross
several packages. Four differences are worth knowing.

The architectural argument for keeping that coherent development experience
while replacing the monorepo as the storage and coordination boundary is in
[`deck-cas-packages-vs-monorepos.md`](deck-cas-packages-vs-monorepos.md).

- Each deck has its own version line. A monorepo usually versions everything
  together, or needs a tool so that it does not have to.
- The directory layout _is_ the URL space. A consumer imports one module from
  one deck, and no build step extracts it first.
- The publisher segment lets two people hold the same package name in one
  depot. That is a fork inside the repository, and it costs nothing until the
  bytes differ.
- There is no separate linking manifest or link step. A deck names another
  deck by address, and `deck lock` turns the range into a pin.

---

## 3. The store

The store is **content-addressed for each file**, and the objects belong to
the realm, not to one package and not to a host-global parallel tree.

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

| address                  | is                   | cache                             |
| ------------------------ | -------------------- | --------------------------------- |
| no version segment       | the live tree        | `no-store`                        |
| `@<exact>`               | one Version          | `immutable`                       |
| `@<range>` or `@<tag>`   | a name for a Version | one redirect to the exact address |
| `/_history/<changeId>/…` | one Step             | `immutable`                       |

A range never matches a prerelease. `latest` is a dist-tag on a stable
Version, and `latest` is not live.

---

## 5. The History

A depot has one of two answers, and the server **reports** which one. It does
not pretend. Do not number these, and do not call them tiers: the two answers
have names.

- **Version history only.** Each settled save becomes an immutable `-dev.N`
  Version. The Versions are coarse-grained history. Always available.
- **Every-save History.** Each save also becomes a Step, at
  `/<depot>/_history/<changeId>/…`, and `deck history` and `deck restore`
  work. Available when a history backend is attached.

A backend that is missing or has stopped leaves the depot with Version history only.
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
   the only way to say it is bad is to say so _about_ it. That is the same
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
