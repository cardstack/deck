# Host publishing from treeHash and branch indexes

**Status: PROPOSAL, RRI-NATIVE AMENDMENT** (2026-08-21). This specializes the
multi-branch Realm backport for Boxel's published host mode.

Companions:
[`deck-boxel-branch-index-backport.md`](./deck-boxel-branch-index-backport.md),
[`deck-storage-backends.md`](../deck-storage-backends.md),
[`deck-laws.md`](../deck-laws.md), and
[`deck-tree-hash-v2-review.md`](../deck-tree-hash-v2-review.md).

---

## 0. Ruling

> Publishing should name an exact source `treeHash`, build a candidate
> published index from the closest completed index, and atomically move the
> published ref only when source, index, rendering, and asset closure are
> ready. Canonical release and asset identities are RRIs. The stable page URL
> is their transport projection and revalidates; every exact projected asset
> URL is immutable.

There are two fast paths:

- **first publish or new destination:** clone the source branch's completed
  index into the published Realm RRI namespace;
- **republish:** use the previous published tree and index as the base, diff
  stored tree manifests, and reindex only the changed dependency closure.

The author may explicitly request a **full publish** from the host UI or CLI.
That rebuilds and verifies the complete index, rendering, delivery tree, and
asset manifest instead of trusting an incremental base. Incremental remains
the default.

```text
source branch
  Checkpoint ──▶ source treeHash ──▶ source completed index
                    │                         │
                    │ tree-manifest diff      │ clone/reuse rows
                    ▼                         ▼
previous release ── base index ─────────▶ candidate published index
                    │                         │
                    └── changed closure ──────┘
                                              │
                                  render + asset manifest complete
                                              │
                                              ▼
published Realm RRI ref ─ atomic CAS ──▶ Release
```

Publishing is not another source copy and it is not a second authoring
history. It is a deployment pointer to an immutable release projection.

## 1. Current Boxel path and why it is slow

The current `handle-publish-realm.ts` path:

1. waits for the source realm to settle;
2. recursively copies the source directory to a temporary directory;
3. swaps that directory into `_published`;
4. clears the destination module and source caches;
5. enqueues a full reindex with `clearLastModified: true`;
6. waits for the destination's full prerender to catch up.

That deliberately recomputes every card and rendering even when one file
changed. The safety is good; the unit of reuse is too coarse.

Boxel already contains most of the mechanism needed for the first fast path:

- `RealmIndexUpdater.copy()` enqueues `copy-index`;
- `IndexWriter.Batch.copyFrom()` clones and rebases structured index rows;
- `copyPrerenderedHtmlFrom()` copies the rendering channel;
- index working tables already provide candidate-then-promote behavior;
- generation guards and readiness checks already prevent incomplete HTML from
  being reported as ready.

The publish handler does not currently use that path. It full-copies and
full-indexes instead, partly because raw prerendered HTML may embed the source
transport URL and must not leak into the published destination.

## 2. treeHash is identity; the tree manifest supplies the diff

`tree-hash-v1` is a flat hash over sorted `(file sha256, path)` entries. The
root proves exact identity, but the root alone cannot say which files changed.
The stored `_trees/<treeHash>.json` packlist supplies that inventory.

Therefore a publish needs:

```text
sourceTreeHash
sourceTreeManifest: path -> blob sha256
lockHash
source Checkpoint
source completed index generation
```

A republish also has the previous release's tree manifest. Comparing the two
manifests costs a scan of hashes, not a read or copy of every file body:

```text
addedPaths
changedPaths
deletedPaths
unchangedPaths
```

If `sourceTreeHash`, `lockHash`, render policy, and toolchain identities are
unchanged, publish is a no-op except for optionally recording who requested
it. Do not create a new deployment merely because the wall clock changed.

## 3. Release object

The stable published Realm RRI ref points to a small immutable Release object;
the public URL is a control-plane transport alias:

```json
{
  "schema": "boxel-host-release-v1",
  "sourceRealmRRI": "@chris/shop/",
  "sourceCheckpointHash": "sha256:…",
  "sourceTreeHash": "sha256:…",
  "lockHash": "sha256:…",
  "publishedRealmRRI": "@chris/shop/",
  "publishedURL": "https://chris.boxel.site/shop/",
  "indexGenerationHash": "sha256:…",
  "deliveryTreeHash": "sha256:…",
  "assetManifestHash": "sha256:…",
  "hostBuildHash": "sha256:…",
  "renderPolicyHash": "sha256:…"
}
```

After hashing, the Release is addressable as an exact Version RRI such as
`@chris/shop@release.<hash>/`. That exact RRI and the source/published Realm
RRIs are canonical. `publishedURL` is routing metadata and is excluded from
portable dependency identity.

The release hash excludes timestamps. Audit metadata can record publisher and
time beside it without changing delivery identity.

The Release object and mutable published ref remain inside the source realm:

```text
<realm>/.deck/releases/objects/<hh>/<releaseHash>.json
<realm>/.deck/refs/published.json
```

On AWS agents may inspect both through S3 Files. Only the realm service writes
them through direct S3 conditional operations.

The published ref moves with compare-and-swap:

```text
expected previous Release hash -> new Release hash
```

A concurrent publish that started from an old release cannot overwrite a newer
one. The old release stays live while the candidate is being built, so
republishing has no half-indexed interval.

## 4. Source materialization

Publishing should stop recursively copying Realm directories. The published
Realm reads an exact tree manifest through a read-only CAS adapter:

```text
path -> tree manifest -> blob sha256 -> CAS bytes
```

Local storage may materialize those references with hardlinks/reflinks. S3
deployment may read the manifest and blobs directly. Both have the same
semantics: unchanged blobs are not copied, and the exact source tree remains
available after the branch advances.

The current publish-only mutation
`includePrerenderedDefaultRealmIndex: true` must not rewrite the copied
`realm.json` after hashing. Move it into `renderPolicyHash`, or make the author
set it before sealing. A published tree that is silently modified is not the
tree named by its `treeHash`.

## 5. Candidate index construction

### 5.1 New destination: clone and rebase

Clone from the exact source branch index only when it proves:

```text
indexed sourceTreeHash == requested sourceTreeHash
indexed lockHash       == requested lockHash
indexer version        == current indexer version
```

The existing copy path already rebases row URLs, aliases, types, dependencies,
search document IDs, Realm metadata, and error documents. Change canonical row
and dependency identity to RRI, rebase Realm-local RRIs, and derive destination
URLs only while rendering/serving. Extend the path to carry the exact source
tree/lock identities and to distinguish origin-neutral from origin-sensitive
derived fields.

Structured index data can normally be rebased. Raw `head_html`,
`isolated_html`, `atom_html`, fitted HTML values, embedded HTML values, and
generated CSS may contain absolute source URLs. They may be cloned only when a
validator proves them origin-neutral; otherwise enqueue those rows for
destination rendering before promotion.

The destination is not exposed until that repair set has rendered and the
index and HTML generations agree.

### 5.2 Republish: previous release as merge base

For an existing published Realm RRI, its current release is the best base
because its index is already in the correct RRI namespace.

1. clone the current published generation into a candidate generation;
2. compare previous and next tree manifests;
3. seed invalidation with added, changed, and deleted paths;
4. add reverse dependents using the base index's dependency graph;
5. add entries affected by `lockHash`, Realm config, render policy, indexer,
   compiler, or host-build changes;
6. update/tombstone only that closure;
7. render only the affected rendering closure;
8. promote the candidate generation with the new Release ref.

This is merge-base indexing: unchanged indexed rows survive from the published
base; changed rows come from the new exact source and its dependency fan-out.
It is not a textual merge of published content. Published releases are
read-only, so the authoring branch is authoritative.

Where the source branch already has a completed index for the exact next tree,
the candidate builder may copy and rebase changed structured rows from it
instead of recomputing them. Destination-sensitive rendering still follows
the rules above.

### 5.3 Invalidations wider than the file diff

The safe invalidation closure is:

```text
changed paths
  + deleted paths
  + transitive reverse dependencies
  + Realm/index-card configuration dependents
  + lock entries whose resolved target changed
  + every compiler output when compiler/toolchain identity changed
  + every rendering when renderer/host-build/render-policy identity changed
```

If the dependency graph is missing, stale, or belongs to a different
tree/lock/indexer identity, fall back to a full candidate index. The fast path
must be an optimization with a provably safe escape hatch.

## 6. Delivery projection

Source `treeHash` identifies authored bytes. A served JavaScript module may be
transpiled, CSS may be extracted, and rendering depends on a host build. Those
bytes cannot use source `treeHash` alone as their immutable cache identity.

Publish therefore builds a derived **delivery tree**:

```text
(sourceTreeHash, lockHash, compilerHash, hostBuildHash, renderPolicyHash)
                                 │
                                 ▼
                         deliveryTreeHash
```

The delivery tree contains or addresses:

- transpiled JS modules;
- generated/scoped CSS;
- static images, fonts, audio, video, and data files;
- exact canonical RRI import map/lock and its derived browser projection;
- publish-time generated browser artifacts.

It records provenance back to the source tree but has its own `treeHash`, as
required whenever derived bytes differ from source bytes.

## 7. Browser and CDN cache contract

The stable URL and exact bytes need different cache classes.

| Response                | URL identity                      | Cache-Control                         | Validator                             |
| ----------------------- | --------------------------------- | ------------------------------------- | ------------------------------------- |
| Published page shell    | stable published URL              | `public, max-age=0, must-revalidate`  | strong ETag from Release + shell hash |
| Release manifest        | exact Release hash                | `public, max-age=31536000, immutable` | Release hash                          |
| Authored raw asset      | exact source tree + path          | `public, max-age=31536000, immutable` | blob sha256                           |
| Derived JS/CSS/asset    | exact delivery tree + path        | `public, max-age=31536000, immutable` | derived blob sha256                   |
| Exact card JSON/render  | Release or exact index derivation | `public, max-age=31536000, immutable` | content hash                          |
| Mutable branch/live URL | branch name                       | `private, max-age=0, must-revalidate` | branch generation ETag                |

All immutable responses should also carry `Content-Digest` and stable content
type. Private exact previews may use `private, max-age=31536000, immutable`;
they must never be stored by a shared cache.

Relative module imports must stay underneath the exact delivery-tree prefix.
Bare imports resolve through the exact RRI lock, then project to immutable tree
URLs. If an exact module resolves to a mutable RRI or URL, the release is not
closed and publish must fail.

The host application's own JS/CSS must also use content-fingerprinted paths.
The shell may point at a new host build, but a browser that already has the
old fingerprinted asset never downloads it again.

## 8. Making “all assets cached” observable

`immutable` means “reuse after fetch”; it does not guarantee that a browser
has fetched every asset. Publish should also emit an immutable asset manifest:

```json
{
  "schema": "boxel-asset-manifest-v1",
  "release": "sha256:…",
  "deliveryTreeHash": "sha256:…",
  "assets": [
    { "url": "/_tree/…/app.js", "sha256": "…", "size": 1234 },
    { "url": "/_tree/…/theme.css", "sha256": "…", "size": 456 }
  ]
}
```

The list is the complete exact runtime closure: host entry assets, delivery
tree assets, import-map targets, generated CSS, and indexed card assets.

The host service worker maintains a Cache Storage namespace keyed by
`(Release hash, hostBuildHash)`:

1. fetch the asset manifest;
2. download missing hashes concurrently with a bounded worker pool;
3. verify response digest/length;
4. mark the release `offlineReady` only after every entry succeeds;
5. atomically activate that cache for new navigations;
6. retain the previous release cache while an open client still uses it;
7. garbage-collect unreferenced release caches later.

This gives two useful states rather than one vague “published” state:

```text
ready         source + index + required first-render assets are live
offlineReady  complete asset manifest is verified in this browser
```

Storage quota or an interrupted background fill must not corrupt a release.
The app continues through immutable HTTP caching, but must not claim
`offlineReady` until the manifest is complete.

For very large media, the manifest may mark an entry `cache: on-demand`; the
product must then say “core app cached” rather than “all assets cached.” The
protocol should not promise offline completeness that the browser quota cannot
provide.

## 9. Atomic publish sequence

```text
1. capture exact source Checkpoint, treeHash, lockHash, completed source index
2. CAS-store missing tree manifest and blobs
3. read expected current published Release
4. build candidate source view from CAS
5. clone source index (new) or clone published base index (republish)
6. apply safe invalidation closure; repair origin-sensitive renderings
7. build delivery tree + complete asset manifest
8. verify source/index/render/delivery identities and publishability
9. atomically CAS published ref + candidate index generation
10. append one Publish event/Step; return Release hash and readiness URLs
```

A failure before step 9 leaves the previous published Release untouched. A
retry with the same identities reuses the candidate artifacts.

Publishing should add one source-branch History event referring to the exact
Release. It must not create a Step for every internal index or asset operation.

## 10. Incremental and full publish modes

Both modes are first-class and use the same publish endpoint, Release object,
validation, readiness gates, and atomic pointer move.

| Mode                      | Reuses                                                           | Rebuilds                                                            | Intended use                                         |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| **Incremental** (default) | previous compatible index/render/delivery base and all CAS blobs | changed dependency/render closure                                   | normal publishing                                    |
| **Full**                  | content-addressed source blobs only                              | complete index, all renderings, delivery projection, asset manifest | repair, verification, derivation upgrades, debugging |

Full publish does **not** mean copying unchanged source bytes again. CAS blobs
are already verified by hash. It means refusing derived-state reuse and
re-deriving everything from the exact source tree and lock.

The server—not the browser or CLI—derives the tree diff, dependency closure,
and base compatibility. The request shape is intentionally small:

```json
{
  "sourceRealmURL": "https://app.boxel.ai/chris/shop/",
  "sourceBranch": "main",
  "publishedRealmURL": "https://chris.boxel.site/shop/",
  "strategy": "incremental",
  "expectedRelease": "sha256:…"
}
```

`strategy` is `incremental` or `full`. `expectedRelease` protects the
published target from a concurrent update. A client does not submit a trusted
changed-path list or index generation.

### 10.1 Safe incremental fallback

Incremental publish automatically becomes a full publish when the server
cannot prove its base is compatible—for example:

- no prior completed release/index exists;
- source tree or lock identity is missing;
- the dependency graph is incomplete;
- index schema/indexer compatibility changed;
- a candidate-resume artifact fails verification.

The response and progress stream report
`requestedStrategy: incremental`, `effectiveStrategy: full`, and a stable
machine-readable reason. Safety must not depend on the user knowing when to
choose Full.

### 10.2 Deterministic convergence

Given the same source tree, lock, host build, compiler, and render policy, a
full and incremental publish must produce the same Release and delivery-tree
hashes. Add a conformance assertion for this.

A full publish of an already-current deterministic Release may rebuild and
verify server artifacts, then leave the published pointer unchanged. It still
records a Publish operation result for audit, including whether repaired
artifacts differed.

Full publish is not cache busting. A browser must continue using an immutable
asset when its URL/hash is unchanged. If regenerated bytes differ, the
delivery tree hash and URL change naturally. Never add a timestamp or random
query parameter to force a redownload.

### 10.3 Host UI

Keep the common action quiet:

```text
┌─────────────────────────────────────────────────────┐
│ Publish                                      [▾]    │
├─────────────────────────────────────────────────────┤
│ Publish changes                                     │
│ Reuses the current release; rebuilds affected work. │
│                                                     │
│ Full publish…                                       │
│ Rebuilds and verifies the complete published app.   │
└─────────────────────────────────────────────────────┘
```

`Publish changes` is the primary action and should normally be labeled simply
**Publish**. `Full publish…` opens a confirmation showing expected work and
explaining that immutable, byte-identical browser assets remain cached.

Before starting, show a server-produced plan:

```text
Publishing main → chris.boxel.site/shop

Mode             incremental
Base             Release 8fd2…
Source           Checkpoint 4ca1… · tree 01be…
Changed          3 files
Index/render      17 affected entries
Browser assets    2 new · 143 reused
```

For Full, replace the affected count with the complete count and state
“source blobs remain content-addressed; this rebuilds derived output.” If an
incremental request falls back, progress visibly changes to **Full publish**
and gives the reason rather than silently doing more work.

### 10.4 CLI

```sh
# default: incremental, with safe automatic fallback
boxel publish --branch main --to https://chris.boxel.site/shop/

# explicitly rebuild all derived publish state
boxel publish --branch main --to https://chris.boxel.site/shop/ --full

# inspect the server-derived strategy and work set without publishing
boxel publish --branch main --to https://chris.boxel.site/shop/ --plan
```

Do not call the option `--force`: full publish does not bypass authorization,
publishability, validation, readiness, or compare-and-swap protection.

Machine-readable automation uses:

```sh
boxel publish --branch main --to "$TARGET" --full --json
```

The result includes requested/effective strategy, base and resulting Release
hashes, tree/lock/delivery hashes, counts for reused/rebuilt artifacts,
fallback reason, readiness, and `offlineReady` manifest identity.

## 11. Architecture-forcing fixture

Use the existing publish fixture, but make the second publish non-trivial:

```text
source main tree A
  app.gts -> imports theme.gts and logo.png
  theme.gts -> blue
  logo.png -> hash L1
  untouched-large-video.mp4 -> hash V1

source main tree B
  theme.gts -> coral
  new-font.woff2 -> hash F1
  logo.png unchanged
  untouched-large-video.mp4 unchanged
```

Prove:

1. first publish clones/rebases the source index and repairs destination HTML;
2. published rows contain the published Realm RRI, and derived HTML contains
   its projected transport URL, never the source identity or source URL;
3. republish diffs tree manifests without reading/copying unchanged blobs;
4. only `theme.gts`, its reverse dependents, and the new font enter the index/
   render work set;
5. the video and logo retain identical immutable URLs and are browser cache
   hits;
6. the stable HTML ETag changes with the Release;
7. every exact asset returns one-year `immutable`, digest, and correct MIME;
8. an exact module's complete import closure contains no mutable URL;
9. the old release keeps serving until candidate index and required renderings
   are complete;
10. a stale concurrent publish loses CAS without exposing its candidate;
11. the service worker reports `offlineReady` only after verifying the entire
    cacheable asset manifest;
12. same tree/lock/toolchain publish is a no-op.
13. explicit full publish rebuilds every derived entry but reuses CAS source
    blobs;
14. full and incremental modes converge on the same Release and delivery hash;
15. incompatible incremental base reports a visible fallback to full;
16. full publish does not change immutable asset URLs when their bytes are
    identical.

## 12. Backport slices

| Slice  | Change                                                                            | Main proof                                          |
| ------ | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| **P0** | RRI-native Release/tree/lock/index identity types in Deck Core                    | deterministic Release hash                          |
| **P1** | Seal Boxel branch snapshot into CAS without changing serving                      | current publish output hashes identically           |
| **P2** | Read-only treeHash Realm adapter                                                  | exact snapshot runs without directory copy          |
| **P3** | Harden partial `copy-index` and origin-sensitive render repair                    | first-publish fixture 1–2                           |
| **P4** | Candidate index cloned from previous published generation + manifest diff fan-out | fixture 3–4, 9–10                                   |
| **P5** | Delivery tree and exact immutable serving                                         | fixture 5–8, 12                                     |
| **P6** | Asset manifest and service-worker cache state                                     | fixture 11                                          |
| **P7** | Replace directory-copy/full-reindex publish handler                               | observable publish latency and bytes-read reduction |
| **P8** | Host Publish menu + plan/confirmation and CLI `--full`/`--plan`                   | fixture 13–16 through both clients                  |

Do not begin with the service worker. First make the server's release and
index identities exact; then make every delivered URL immutable; finally add
proactive browser caching.

## 13. Expected performance shape

Current repeat publish is approximately proportional to the whole Realm:

```text
copy all bytes + index all files + render all affected cards pessimistically
```

The target repeat publish is:

```text
scan two small tree manifests
+ read changed blobs
+ index changed paths and reverse-dependent closure
+ render origin/toolchain-affected closure
+ write one Release pointer
```

The protocol does not promise a constant-time publish: one base module change
can legitimately invalidate the whole Realm. It does guarantee that unchanged
content is not copied, indexed, rendered, or downloaded merely because the
Realm was published again.

## 14. Non-negotiable invariants

- `treeHash` identifies authored bytes; derived bytes get a derived treeHash.
- A published Release never refers to a branch/live URL.
- The published pointer never moves before its candidate index and required
  rendering are ready.
- Index reuse is allowed only when source tree, lock, and derivation identities
  prove compatibility.
- New-destination index cloning rebases Realm-local RRIs; URL rewriting is a
  derived rendering/transport concern.
- Repeat publish reuses the published base index and invalidates the safe
  dependency closure.
- Incremental and full publish converge on the same deterministic Release.
- Full publish rebuilds derived state; it never bypasses safety or fabricates a
  cache-busting identity.
- Stable HTML revalidates; exact assets are immutable.
- “All assets cached” is a verified browser state, not a Cache-Control claim.
