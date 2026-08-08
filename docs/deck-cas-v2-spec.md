# Deck CAS v2: blob store, verified links, signatures on treeHash

Status: **SPEC** (2026-08-08) — design for three coupled workstreams that
harden content addressing without changing `tree-hash-v1` identity.
Companions: `deck-pack-equivalence.md` (homes, carriage, round-trip laws),
`deck-competitive-gaps.md` (G5 signatures, G1 distribution),
`deck-at-rest-protocol.md` (serving rules), `packages/core/src/tree-hash.ts`
(normative v1 algorithm).

## 0. Problem and non-goals

Today the store is content-addressed at **pack grain**:

```
<store>/<publisher>/<name>/packs/<treeHash>.pack.zip
<store>/<publisher>/<name>/meta.json   # version → treeHash (+ file)
```

That correctly makes identity the logical tree (never zip bytes) and makes
`release` a pointer. It does **not**:

1. dedupe shared files across versions (two `-dev.N` packs that differ by one
   file store two full zips);
2. make import-map references **verifiable** claims (expected treeHash on
   remote deps is designed, not enforced end-to-end);
3. prove **who endorsed** a treeHash (G5) — integrity without authorship.

### Non-goals (this spec)

- Replacing `tree-hash-v1` with IPFS CIDs or a directory Merkle DAG.
- P2P / DHT / Bitswap as a transport requirement.
- Chunking every small module (optional later for large binaries only).
- New account systems — signatures reuse Matrix cross-signing material
  where available; a local keyring is an allowed fallback for standalone.
- Unpublishing or deleting sealed bytes.

### Goals

| # | Workstream | One-line outcome |
| --- | --- | --- |
| A | Blob store + pack-as-transport | CAS unit is the file blob; pack is a reproducible projection |
| B | Verified dependency links | Every non-local map value carries a checkable treeHash |
| C | Signatures on treeHash | Endorsement travels with bytes across mirrors and caches |

`treeHash` remains the subject of all three. Semver/tags remain names for
humans; they never become identity.

---

## 1. Workstream A — Blob store; pack as transport

### 1.1 Ruling

> **Identity is still `tree-hash-v1` over the logical file tree.**
> The store MAY persist that tree as a set of content-addressed blobs plus a
> thin tree object. A `.pack.zip` is a **transport and interchange** form of
> the same tree, not the sole CAS unit.

Round-trip laws from pack-equivalence **still hold** for faithful packs.
Serving H1 file-by-file and serving from a reconstructed pack of the same
treeHash MUST yield byte-identical module bodies (law 4).

### 1.2 On-disk layout (normative)

Per realm store root (`<realm>/.deck/store/`):

```
store/
  blobs/
    sha256/
      <aa>/
        <aabbcc…64 hex>          # raw file bytes, one object
  trees/
    <treeHash>/
      tree.json                  # tree object (below)
      signatures.json            # optional; see §3 (may be absent)
  <publisher>/
    <name>/
      meta.json                  # UNCHANGED role: versions + dist-tags
      # packs/<treeHash>.pack.zip  — OPTIONAL cache / export materialization
```

**Blob path:** `blobs/sha256/<first2>/<full64>` avoids huge flat directories.
Blob bytes are exactly the file bytes (no header, no compression). The
object's name IS `sha256(bytes)` lowercase hex; a mismatch on read is
corruption and MUST fail closed.

**Tree object** `trees/<treeHash>/tree.json`:

```json
{
  "spec": "tree-hash-v1",
  "treeHash": "<64 hex>",
  "entries": [
    { "path": "importmap.json", "sha256": "<64 hex>", "size": 241 },
    { "path": "src/app.js", "sha256": "<64 hex>", "size": 4096 }
  ]
}
```

Laws:

1. `treeHashFromEntries(entries).treeHash === tree.treeHash` or refuse.
2. Every `entries[].sha256` MUST exist under `blobs/` before the tree object
   is considered complete (publish is atomic: blobs first, then tree, then
   meta pointer).
3. Entry order in JSON is canonical: UTF-8 byte order of `path` (same as
   tree-hash-v1). Writers MUST emit sorted; readers MUST re-sort before
   hashing.
4. Empty directories are not entries (files only — unchanged from v1).

**meta.json** version record (extends today's shape, backward compatible):

```json
{
  "name": "acme/palette",
  "versions": {
    "1.2.0-dev.4": {
      "treeHash": "<64 hex>",
      "storage": "blobs-v1"
    },
    "1.1.0": {
      "treeHash": "<64 hex>",
      "storage": "pack-v1",
      "file": "packs/<treeHash>.pack.zip"
    }
  },
  "tags": { "dev": "1.2.0-dev.4", "latest": "1.1.0" }
}
```

- `storage: "blobs-v1"` — authoritative materialization is tree object + blobs.
- `storage: "pack-v1"` — legacy / optional pack file (today's layout).
- `file` MAY still name a materialized pack for fast `?format=pack`; it is a
  **cache**, not identity. Missing pack ⇒ rebuild from blobs via
  `canonical-zip-v1` and MAY rewrite the cache.

### 1.3 Publish / release / prune (updated)

**publish(tree):**

1. Walk files → per-file sha256 + sizes (same as today).
2. Compute `treeHash` via `tree-hash-v1`.
3. For each file, write blob if absent (`O_EXCL` / write-temp+rename).
4. Write `trees/<treeHash>/tree.json` if absent.
5. Append version pointer in `meta.json` with `storage: "blobs-v1"`.
6. Optionally materialize `packs/<treeHash>.pack.zip` (policy: lazy on first
   `?format=pack`, or eager for small trees).

**release:** unchanged semantically — new version pointer at an existing
`treeHash`. No blob copies. No pack copies.

**prune:** drop version pointers per existing `-dev.N` policy. Then GC:

- A tree object is deletable when no `meta.json` in the store references its
  `treeHash` and no signature bundle pins it as a verification subject
  still required by policy (default: signatures do not pin; attestations
  live elsewhere — see §3.6).
- A blob is deletable when no remaining tree object lists its sha256.

GC MUST be refcount or mark-sweep over tree objects; never delete a blob
because one pack cache was removed.

### 1.4 Serving

| Request | Behavior |
| --- | --- |
| exact file at `@ver/path` | Resolve version → treeHash → tree.json → blob; serve bytes + `Content-Digest: sha-256=:…:` matching entry sha256 |
| `?format=pack` | Return materialized pack or build canonical zip from tree+blobs; `Content-Digest` of **pack bytes** is not identity; response SHOULD include `x-deck-tree-hash` |
| `?meta` | Include `treeHash`, `storage`, entry inventory (from tree.json), signature summary if present |
| live tree | Unchanged — disk bytes, `no-store`. Auto-publish writes blobs+tree as today it writes packs |

Pack mount `!/` continues to open a pack artifact (H3). If the mounted
object is itself stored as blobs under some treeHash, the server MAY satisfy
`!/` by tree+blob reads without inflating a zip — observationally identical
bytes.

### 1.5 Migration

| Phase | Action |
| --- | --- |
| M0 | Dual-read: if `storage` absent and `file` present, treat as `pack-v1` |
| M1 | New publishes write `blobs-v1`; leave old packs in place |
| M2 | `deck store migrate --realm …` unpacks each pack once into blobs+tree; sets `storage` |
| M3 | Pack files become optional cache; prune-gc may drop caches not packs' identities |

Acceptance: after M2, `treeHash` of every migrated version equals the prior
pack's packlist treeHash; file-by-file GET bodies unchanged.

### 1.6 What we deliberately do not change

- `tree-hash-v1` algorithm and `DEFAULT_IGNORE`.
- Semver immutability and dist-tag rules.
- Canonical zip writer (still required for H2 interchange).

---

## 2. Workstream B — Verified dependency links

### 2.1 Ruling

> **A non-local dependency value in an import map is a claim about bytes.**
> The claim MUST name an expected `treeHash`. Resolution without a matching
> hash is refused in lock/publish/vendor paths; browsers may still fetch, but
> Deck tooling never treats an unverified URL as a pin.

This finishes the pack-equivalence carriage design: reference and vendored
modes both carry canonical identity.

### 2.2 Where the claim lives

Two cooperating records — map for resolution, packlist/deck metadata for
inventory. **One authority per fact:** the map value is what resolves; the
integrity record is what verifies.

#### 2.2.1 Import map value forms (resolution)

Unchanged web shapes for browsers:

```json
{
  "imports": {
    "three": "/site/acme/three@0.160.0/esm.sh/three@0.160.0.mjs",
    "money/": "https://catalog.example/boxel/maria/money@2.1.0/"
  }
}
```

#### 2.2.2 Integrity records (verification)

Under `deck.packages[<name>]` and/or `deck.dependencies` (new, additive):

```json
{
  "imports": {
    "money/": "https://catalog.example/boxel/maria/money@2.1.0/"
  },
  "deck": {
    "packages": {
      "app": {
        "version": "1.0.0",
        "entry": "$REALM/app.js"
      }
    },
    "dependencies": {
      "money/": {
        "mode": "reference",
        "canonical": "https://catalog.example/boxel/maria/money@2.1.0/",
        "treeHash": { "spec": "tree-hash-v1", "hash": "<64 hex>" },
        "publisher": "maria",
        "name": "money",
        "version": "2.1.0"
      },
      "three": {
        "mode": "vendored",
        "canonical": "https://esm.sh/three@0.160.0",
        "treeHash": { "spec": "tree-hash-v1", "hash": "<64 hex>" },
        "vendoredFrom": "https://esm.sh/three@0.160.0",
        "local": "$REALM/vendor/three/"
      }
    }
  }
}
```

Rules:

1. Every `imports` / `scopes` value that is absolute `http(s):` OR points at
   another package's sealed URL MUST have a matching `deck.dependencies`
   entry (by bare specifier key), **or** publish/lock fails.
2. Local `$REALM/<path>/` values that are not vendored carriages need no
   dependency record (they are this tree).
3. `mode: "reference"` — bytes are not in this tree; fetch+verify on lock,
   intake, and first serve-to-cache if the server mirrors.
4. `mode: "vendored"` — bytes are in this tree (path or `!/` pack);
   `treeHash` is the **canonical identity of the vendored deck**, which MUST
   equal `treeHash` of the local subtree or mounted pack.
5. `canonical` + `treeHash` together are the PDF-font model: bytes may be
   local while identity remains remote.

Packlist MAY mirror carriage records for transport (already sketched in
pack-equivalence). If both exist, they MUST agree; packlist is derived from
the tree's import map at pack time, never a second authority.

### 2.3 Verification algorithm

```
verifyLink(dep):
  expected = dep.treeHash.hash
  if dep.mode == "vendored":
    actual = treeHash(localSubtreeOrMountedPack(dep.local))
  if dep.mode == "reference":
    actual = treeHash(fetchProvenDeck(dep.canonical))  # H1 listing or pack
  if actual != expected: FAIL (link-integrity)
```

When to run:

| Verb | Required |
| --- | --- |
| `deck lock` | verify all reference deps before writing pins |
| `deck publish` / auto-publish | verify vendored deps; reference deps must already be recorded |
| `deck vendor` | write dependency record with measured treeHash |
| `deck unvendor` | verify local==canonical treeHash, then flip map value |
| `deck pack` | embed dependency records via the map; packlist carriage mirrors them |
| Server GET of a reference pin | optional mirror: verify once, cache by treeHash in blob store |

Failure codes (JSON errors): `link-integrity`, `link-missing-record`,
`link-fetch-failed`.

### 2.4 Lock interaction

`deck lock` today resolves ranges to exact versions. CAS v2 adds:

1. For each resolved pin, write/update `deck.dependencies[specifier]` with
   `mode: "reference"` (or keep `vendored` if already local), `version`,
   `canonical` URL form the server serves, and **measured** `treeHash`.
2. `--check` fails if any pin lacks a record or fails verify.
3. Cross-realm pins remain refused until G1 exists — but when they exist,
   the record shape is already this one.

### 2.5 Acceptance

- A map with a bare `https://…` import and no dependency record cannot
  publish.
- Changing one byte of a vendored subtree breaks publish with
  `link-integrity`.
- `unvendor` after tampering refuses; after honest vendor round-trip,
  law 3 holds.
- Browser import maps remain standard-shaped (no custom keys inside
  `imports`).

---

## 3. Workstream C — Signatures on treeHash

### 3.1 Ruling

> **`treeHash` proves integrity. A signature proves endorsement.**
> Signatures attach to `treeHash` (and spec), never to a semver string alone.
> Forks and mirrors that preserve bytes inherit every signature over that
> treeHash.

Closes G5. Aligns with competitive-gaps §2.5 / §2.8 Tier 2 attestations;
this spec defines the **minimal content signature** required before richer
attestation types (`verified`, `advisory`, …).

### 3.2 Signed payload

Canonical bytes to sign (UTF-8, no BOM, trailing newline):

```
deck-sig-v1
tree-hash-v1:<treeHash>
```

Only these two lines. No timestamp inside the signed payload (timestamps are
unsigned metadata so signing stays deterministic and re-signable).

Optional future `deck-sig-v2` may add `purpose:` lines; v1 stays minimal.

### 3.3 Signature envelope

Stored at `trees/<treeHash>/signatures.json`:

```json
{
  "spec": "deck-sig-v1",
  "treeHash": { "spec": "tree-hash-v1", "hash": "<64 hex>" },
  "signatures": [
    {
      "alg": "ed25519",
      "keyId": "matrix:device:@alice:example.org/DEVICEID",
      "publicKey": "<base64>",
      "signature": "<base64>",
      "role": "publish",
      "createdAt": "2026-08-08T14:00:00.000Z",
      "publisher": "acme"
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `alg` | `ed25519` required in v1; others are a new sig spec |
| `keyId` | Stable identifier; Matrix device id when using cross-signing |
| `publicKey` | Embedded so offline verify needs no network (trust pins separately) |
| `role` | `publish` (stable release), `dev` (optional auto), `attest` (reserved) |
| `createdAt` | Unsigned metadata for humans; not in signed payload |
| `publisher` | Claimed scope; binding publisher↔key is policy (G6), not crypto |

Multiple signatures allowed (co-maintainers, CI + human). Order: sort by
`keyId` UTF-8 for canonical serialization when hashing the envelope itself
is needed; verification checks each entry independently.

### 3.4 Key material

**Preferred:** Matrix cross-signed device key (gaps §2.5).  
**Standalone fallback:** `deck keygen` writes an ed25519 keypair under
`~/.deck/keys/` (or `$DECK_KEYRING`); `keyId` = `deck:local:<fingerprint>`.

Policy (enforce in CLI, not in hash):

- Auto-publish `-dev.N` MAY be unsigned, or signed with `role: "dev"` using
  an agent-scoped key.
- `deck release` / stable `publish` to a non-prerelease version REQUIRES at
  least one `role: "publish"` signature when `--require-signature` is on
  (default **on** for release once keyring exists; default **off** until
  first key is created, with a printed warning — no surprise brick).

### 3.5 Commands and HTTP

```
deck sign --realm <dir> --publisher <p> --name <n> --version <v>
deck sign --tree-hash <hex> [--key <keyId>]
deck verify-sig --tree-hash <hex> [--require <n>]
deck keygen [--matrix | --local]
```

- `sign` resolves version → treeHash, signs payload, appends envelope entry
  (atomic rewrite of `signatures.json`).
- `verify-sig` reloads tree object (must exist), recomputes nothing about
  files unless `--full`, checks each signature against payload.

HTTP:

- `GET …/@name@ver?meta` includes `signatures: [{ keyId, role, alg }]`
  (public keys optional in meta; full envelope at:)
- `GET /_trees/<treeHash>/signatures` (or under realm:
  `/<realm>/_trees/<treeHash>/signatures`) → `signatures.json`
- Serving file bytes does not require signatures (availability ≠ trust).
  Clients and `lock --check --require-signature` enforce trust policy.

### 3.6 Relationship to attestations

Content signatures (§3) say: **this key endorsed these bytes.**  
Attestations (gaps §2.8) say: **this key claims a fact** (`verified`,
`advisory`, …) about a treeHash, often stored in Matrix room state.

v1 of this spec ships content signatures only. Attestation types SHOULD
reuse the same payload prefix and keyIds:

```
deck-attest-v1
tree-hash-v1:<treeHash>
type:verified
harness:acme/harness@1.0.0
harnessTreeHash:tree-hash-v1:<hex>
```

Out of scope to implement here; the envelope home (Matrix state vs
`trees/…/attestations.json`) is decided there.

### 3.7 Acceptance

- Tampering with any file changes treeHash ⇒ prior signatures do not
  verify for the new tree (they remain valid for the old hash).
- Copying `trees/<hash>/` + `blobs/` to another machine preserves verify.
- A fork at the same treeHash shows the same signatures in `?meta`.
- Unsigned stable release warns or fails per policy flag.

---

## 4. Cross-cutting laws

1. **Identity law:** `tree-hash-v1` unchanged; zip/pack/compression never
   enter the identity function.
2. **Pointer law:** versions and tags name treeHashes; release copies no
   blob and no pack.
3. **Transport law:** pack round-trips remain faithful and canonical;
   packs MAY be rebuilt from blobs at any time.
4. **Link law:** non-local deps are unverifiable without `treeHash` records;
   tooling fails closed.
5. **Endorsement law:** signatures bind keys to treeHashes; names are not
   signed except as unsigned metadata.
6. **Inheritance law:** same treeHash ⇒ same blobs ⇒ same signature set
   (forks inherit endorsements on unchanged bytes).

---

## 5. Build slices

| Slice | Deliverable | Tests |
| --- | --- | --- |
| **A1** | Blob write/read + tree.json; dual-read pack-v1 | publish two versions sharing files → one blob set; GET file via blobs |
| **A2** | Lazy `?format=pack` from blobs; GC | rebuild pack byte-identical to canonical; prune GC |
| **A3** | `deck store migrate` | migrated store serves identical bodies |
| **B1** | `deck.dependencies` schema + publish gate | missing record fails; vendored mismatch fails |
| **B2** | `vendor`/`unvendor` write+verify records | law 3; link-integrity on tamper |
| **B3** | `lock` fills reference treeHashes | `--check` green on honest pins |
| **C1** | Local ed25519 keygen + sign/verify-sig | vector tests for payload bytes |
| **C2** | Store envelope + `?meta` summary | fork same hash shares sigs |
| **C3** | `release --require-signature` policy | stable without sig fails when enabled |
| **C4** | Matrix keyId path (optional) | sign with cross-signed device mock |

Suggested order: **A1 → B1 → C1 → A2 → B2 → C2 → B3 → C3 → A3 → C4**.

---

## 6. API / CLI summary

```
# Store
deck store migrate --realm <dir>
deck store gc --realm <dir>

# Links (flags on existing verbs)
deck vendor …           # writes deck.dependencies + blobs
deck unvendor …         # verifies then flips
deck lock …             # records treeHashes on pins
deck publish / release  # gates on link integrity

# Signatures
deck keygen [--local]
deck sign --realm … --publisher … --name … --version …
deck verify-sig --tree-hash <hex> [--require 1]
```

HTTP additions: tree/blob serving (internal),
`/<realm>/_trees/<treeHash>/signatures`, enriched `?meta`.

---

## 7. Open questions (decide in implementation PRs, not silent drift)

1. **Eager vs lazy pack cache** for auto-publish (disk vs first-download
   latency). Default proposal: lazy.
2. **Whether auto-published `-dev.N` signs** with agent keys by default.
   Default proposal: no; human `release` yes when keyring present.
3. **Trust store for foreign public keys** on `verify-sig` (TOFU file vs
   Matrix walk). Default proposal: TOFU file in `~/.deck/trust.json` plus
   optional `--matrix`.
4. **Blob compression at rest** — out of scope for v1 (raw bytes only);
   transport compression remains zip/HTTPS.

---

## 8. Doc / product follow-through

When slices land:

- Update Deckbook §6 (store) and §14 (status).
- Store browser: show `storage: blobs-v1`, blob counts, signature badges on
  a version.
- `GET /_packages` capability block grows:
  `"cas": { "blobs": true, "verifiedLinks": true, "signatures": "deck-sig-v1" }`.

Until then this document is the contract: **blobs for grain, links for
SRI-of-deps, signatures for endorsement — one treeHash subject for all three.**
