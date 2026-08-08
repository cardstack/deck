# Breaking vendoring down to the module boundary

*How to vendor three.js and then edit `Vector3.js` — and why that edit is
a pull request against a known upstream commit.*

---

## 0. The problem with what we built

`deck vendor` today pulls from esm.sh. Here is the entry it returns for
three.js, in full:

```js
/* esm.sh - three@0.160.0 */
export * from "/three@0.160.0/es2022/three.mjs";
```

Two lines, pointing at **one 1.21 MB file**. esm.sh's job is to make a
package fast for a browser, and it does that by destroying the module
boundary at build time. So vendoring works, the app runs, nothing touches
a CDN — and there is nothing inside to edit.

The fix is not a better walker. It is **a different carriage source.**

---

## 1. What npm actually ships — measured, not assumed

The npm tarball for `three@0.160.0`, unpacked and walked from `src/Three.js`:

| Measurement | Result |
| --- | --- |
| modules reachable from `src/Three.js` | **374** |
| total source | 1.29 MB |
| file extensions in the graph | `.js` only |
| **bare specifiers** | **none** |
| **unresolved relative imports** | **none** |
| fetch cost | **one** tarball, 9.0 MB, 0.29 s |
| built alternative | `build/three.module.js` — 1.21 MB, **1 file** |

Every import in the tree looks like this:

```js
import * as MathUtils from './MathUtils.js';
import { Quaternion } from './Quaternion.js';
```

Relative, extension-complete, self-contained. **A browser can load this
tree as-is.** Vendoring three from its source needs *no rewriting at all*
— only a graph walk we already have.

And the package invites it. `three`'s own export map contains:

```json
"./src/*": "./src/*"
```

The source tree is a supported entry point, not an accident of packaging.

Cost of the boundary: **374 addresses for 7% more bytes.**

---

## 2. The correlation to GitHub — proven, not inferred

npm records the commit a version was published from:

```
gitHead: d04539a76736ff500cae883d6a38b3dd8643c548
repository: https://github.com/mrdoob/three.js
```

That is a claim. It is checkable, and cheaply: git's blob SHA is
`sha1("blob " + length + "\0" + content)`, and GitHub's tree API returns a
blob SHA per path. So compute one and compare to the other.

Result for `three@0.160.0` `src/` against `mrdoob/three.js@d04539a`:

```
github src blobs:                 374
byte-identical to npm tarball:    374
differing:                          0
in github, absent from tarball:     0
```

**All 374 files, exact.** The vendored tree is not *like* the GitHub
tree — it **is** the GitHub tree, verifiably, in one API call.

That is the whole answer to "correlate to the open-source repo": the npm
tarball is a checkout, and we can prove it.

---

## 3. Four package shapes, and the honest spread

three is close to best case. Measured across a sample:

| Package | What is published | Boundary | Editable how |
| --- | --- | --- | --- |
| **three** 0.160 | true source ESM, `./src/*` exported, 374 modules | **intact, runnable** | directly |
| **zod** 4.4, **lit** 3.3 | per-file JS compiled from TS, mirroring the source layout (`development/` for lit) | **intact, runnable** — but it is compiled output | directly; provenance to the repo is one level removed (`.js` ← `.ts`) |
| **chart.js** 4.5, **preact**, **@tanstack/query-core** | one built bundle | **destroyed at publish** | via the source map — see below |
| **d3** 7.9 | 6 files re-exporting 30 `d3-*` packages | **the boundary is the package graph**, not files | vendor the family |

### 3.1 The bundle case is not hopeless — source maps carry the tree

`chart.js@4.5.1/dist/chart.js.map`:

```
sources:         53
sourcesContent:  53
sample paths:    ../src/core/core.animator.js  ../src/core/core.animation.js …
```

The map carries **both the original module paths and their full
contents**. A bundle can therefore be exploded back into its pre-bundle
module tree, at repo-relative paths.

The honest caveat, and it must be stated in the UI: **a reconstructed tree
does not necessarily run.** It is pre-bundle source — it may be TypeScript,
it may rely on build-time substitutions. It is excellent for reading,
diffing and producing a PR; it is not a drop-in replacement for the
bundle. Treat `map` mode as *provenance and editing*, not *execution*.

### 3.2 Detection needs no per-package configuration

One measurement separates every case above:

> **Count the modules reachable from a candidate entry. If the answer is
> 1, the boundary is gone. If it is N, you have a tree.**

That is mechanical, needs no allowlist, and works on packages nobody has
looked at. `deck vendor --probe <pkg>` should report the count for each
candidate entry and let a person choose.

---

## 4. The design

### 4.1 `deck vendor --mode`

| Mode | Source | Yields | Runs in a browser | Use for |
| --- | --- | --- | --- | --- |
| `bundle` *(today)* | esm.sh | 1–few opaque modules | yes | consumers who will never edit |
| `source` *(new)* | npm tarball | the published module tree | yes, when it is real ESM | **editing, forking, contributing** |
| `map` *(new)* | bundle + `.map` | the pre-bundle tree with contents | no | reading, diffing, PRs |
| `repo` *(later)* | git tarball at `gitHead` | the true source incl. tests | needs a build | deep upstream work |

Same command, same package name, same store. **A mode is a carriage
choice, not a different deck** — which is exactly the carriage-mode idea
already ruled in [deck-pack-equivalence.md](deck-pack-equivalence.md).

### 4.2 Entry selection for `source` mode

In order, stopping at the first that yields more than one module:

1. `exports["./src/*"]` is present → the source tree is an advertised
   entry point. (three)
2. An unminified per-module tree exists — `development/`, `esm/`, `es/`.
   (lit)
3. `exports["."].import` or `module`, **if** it reaches N modules. (zod)
4. Otherwise the package is bundle-only → offer `map`, else `bundle`.

### 4.3 Rewriting rules

| Specifier | Action |
| --- | --- |
| relative, with extension | **leave alone** — browser-native (all of three) |
| relative, extensionless | resolve against the tarball's real file list and rewrite; exact, because we hold every file |
| bare | map to another vendored deck, else fail hermetically (existing rule) |
| `node:` builtin | refuse, or shim explicitly |
| `.json` | convert to a JS module, or use an import attribute |
| conditional `exports` | resolve with the browser condition |

### 4.4 `vendoredFrom` grows a provenance block

```json
"vendoredFrom": {
  "registry": "https://registry.npmjs.org",
  "name": "three",
  "version": "0.160.0",
  "integrity": "sha512-DLU8lc0zNIPkM7rH5/e1Ks1Z8tWCGRq6g8mPowdDJpw1CFBJMU7UoJjC6PefXW7z//SSl0b2+GCw14LB+uDhng==",
  "mode": "source",
  "entry": "src/Three.js",
  "subtree": "src",
  "repo": "https://github.com/mrdoob/three.js",
  "commit": "d04539a76736ff500cae883d6a38b3dd8643c548",
  "repoVerified": { "matched": 374, "total": 374 }
}
```

`repoVerified` is the line that earns its keep. It is one GitHub API call
and a SHA-1 per file, and it turns "npm says this came from that commit"
into a checked fact. For newer packages, npm's **provenance attestation**
(`dist.attestations`, present on lit, zod, preact, @tanstack/query-core)
gives the same link signed by a workflow, and should be preferred when
available.

---

## 5. What this unlocks

Three payoffs, and the third is the one that matters.

**1 — Edit an internal bit.**
`deck fork --from acme/three --as you/three`, change
`src/geometries/SphereGeometry.js`, and the app picks it up on the next
save. No build, no `patch-package`, no publish, and the pinned original
keeps serving the bytes it always served.

The fork is free while it is undiverged, and **nearly free once it
diverges**: the store addresses content per FILE, store-wide, so an edited
revision costs only the files it changed. Measured on three: two edits
across two auto-published revisions cost **2,821 bytes**, against the
438 KB per revision the earlier one-zip-per-tree store charged (§8.1).

**2 — Upgrading keeps your patch.**
Re-vendor `0.161.0` as a new base and the rebase daemon three-way merges
your `Vector3` change forward — the same machinery that keeps offers
merged. That is `patch-package`, made permanent and automatic, and nothing
in the npm world has it.

**3 — Your edit is already a pull request.**
Because the vendored tree is byte-identical to `mrdoob/three.js@d04539a`,
your change is a diff against a known upstream commit, at the same paths,
with no translation. `deck offer --to github` becomes mechanically
possible: the base commit, the file paths and the content all line up.

That is the bridge the ledger called G23, and it turns out to be a
consequence of getting the carriage right rather than a separate feature.

---

## 6. Open questions

1. **The waterfall.** 374 modules is 374 requests. Measured on localhost
   it is 248 requests / 1.13 MB finishing in **102 ms**, so it is not
   catastrophic — but localhost has no latency, which is the entire
   problem. `modulepreload` injection is the answer, and the server
   already injects import maps; it still needs measuring over a real
   network before it is claimed.
1b. ~~Per-file storage.~~ **Done** — see §8.1. The store now keeps one
   compressed object per file, store-wide, and rebuilds the archive on
   demand.
2. **Can one deck hold both carriages** — `src/` for editors and a built
   entry for consumers, chosen by the import map? Elegant, but the bundle
   goes stale the moment someone edits `src/`, and regenerating it needs
   the build step Deck refuses to have. Possibly the honest answer is: edit
   in source mode, distribute in whichever mode the publisher sealed.
3. **How is a reconstructed (`map` mode) tree marked** so nobody expects
   it to run?
4. **d3-shaped packages.** Vendoring a family means N decks and a
   dependency graph between them. That is the right answer, and it is also
   the first real test of transitive resolution (G10).
5. **`repo` mode needs a build**, which is the one thing the protocol has
   no opinion about. Does a deck get to declare a build, or does `repo`
   mode stay a reading tool?

---

## 7. Evidence log

Everything above was measured on 2026-08-08, not inferred.

```
esm.sh entry            curl https://esm.sh/three@0.160.0
                        → 2 lines, re-export of one 1.21 MB build

npm metadata            registry.npmjs.org/three/0.160.0
                        → type: module, exports["./src/*"], gitHead d04539a…,
                          954 files, 31.5 MB unpacked

tarball graph walk      374 modules, 1.29 MB, .js only,
                        0 bare specifiers, 0 unresolved relative

github correlation      api.github.com/repos/mrdoob/three.js/git/trees/
                          d04539a…:src?recursive=1
                        → 374/374 blobs byte-identical

bundle source map       unpkg.com/chart.js@4.5.1/dist/chart.js.map
                        → 53 sources, 53 sourcesContent, repo-relative paths

package shapes          lit 3.3.3 · zod 4.4.3 · chart.js 4.5.1 ·
                        preact 10.29.8 · @tanstack/query-core 5.101.4 · d3 7.9.0
```

---

## 8. Built and run — what the implementation measured

`deck vendor npm:<pkg>@<version>` ships with `--probe`, `--entry`,
`--verify-repo` and `--allow-external`. What it did on three:

```
$ deck vendor npm:three@0.160.0 --probe
three@0.160.0 — 954 published files
  tree    src/Three.js          374 module(s), 1324 KB
  bundle  build/three.js          1 module(s), 1285 KB
  bundle  build/three.module.js   1 module(s), 1243 KB

$ deck vendor npm:three@0.160.0 --verify-repo --realm ./work/site \
    --publisher acme --tag latest
repo check 374/374 blobs identical to github.com/mrdoob/three.js@d04539a767:src
vendored 374 modules from three@0.160.0
  (entry src/Three.js, 0 rewritten — byte-identical to what npm published)
  treeHash 8ddbc3ba8f142209fe27ab2fcba152b7890afb60e048553d8a527876ddf02cc7
published acme/three@0.160.0 tag latest
                                        ← 0.73 s, including the repo check
```

Then the loop the whole design exists for, verified in a browser:

| Step | Result |
| --- | --- |
| app imports `acme/three` `^0.160.0`, locked to `@0.160.0` | renders — `REVISION 160`, `SphereGeometry defaults 32×16` |
| `deck fork --from acme/three@0.160.0 --as you/three --use-in you/app` | 375 files, **0.16 s** |
| edit `src/geometries/SphereGeometry.js` and `src/constants.js` **inside three** | auto-published `you/three@0.160.0-dev.2`, sealed |
| reload | `REVISION 160-you-forked`, `defaults 6×4`, the sphere is visibly faceted |
| `GET /site/acme/three@0.160.0/src/constants.js` | still `'160'` — the pinned original never moved |

Load cost of the module tree, measured in the page: **248 requests,
1.13 MB, last module at 102 ms** (localhost, so latency-free — see §6).

Store cost, measured: `acme/three` 438,064 bytes for one pack;
`you/three` **438,223 and 438,227** for the two dev revisions after a
two-character edit. That is the per-tree addressing limit, stated plainly.

### 8.1 Per-file storage — the wart, and the fix

The first build charged a whole new 438 KB pack for a two-character edit,
because the store kept one zip per tree and kept it *under the package*, so
even an undiverged fork paid for a second copy.

The store now keeps `_objects/<aa>/<sha256>` and `_trees/<aa>/<treeHash>.json`
at the store ROOT, so bytes are shared across versions *and* across
publishers. Objects are deflate-raw, named for the sha256 of their
uncompressed content. The pack is not stored at all — it is rebuilt, which
is safe because canonical-zip-v1 is deterministic and the packlist fixes
the order and every hash.

Measured on the same three.js loop:

| | Before | After |
| --- | --- | --- |
| vendor three@0.160.0 | 438,064 B (1 pack) | **360,641 B** (374 objects, 1 tree) |
| fork, undiverged | +438 KB (second copy) | **0 B** |
| 2 edits → 2 dev revisions | +876 KB | **+2,821 B** |
| `?format=pack` | stored bytes | rebuilt — 438,064 B, same treeHash, same Content-Digest, `deck verify` passes |

Per-file is *smaller* even for the first copy, because a zip pays a local
header and a central-directory record for each of 375 entries.

Two consequences worth stating. Collection had to become store-wide: an
object is garbage only when no live tree in the whole store names it.
And serving had to become lazy — decoding, or worse re-deflating, 374
modules to answer a request for one of them would have turned a storage
win into a serving loss, so a sealed version now reads its listing from
the tree manifest and each file from its own object, and builds the
archive only when someone asks for `?format=pack`.

Stores written the old way are still read, so nothing has to migrate.

### 8.2 The specifier alias

A dependency key *is* the import specifier, so `--use-in` swapping
`acme/three` for `you/three` used to mean the consumer's own source had to
change `import … from 'acme/three'` to `'you/three'`. For "ask an agent to
fork and edit any part", that is backwards.

A dependency value may now name a different deck:

```json
"dependencies": { "acme/three": "you/three@live" }
```

The key stays the specifier; the value says which deck answers to it —
the same substitution `?with=` performs at serve time, made durable in the
lock. `deck fork --use-in` writes that form, so after a fork:

```
dependencies  { "acme/three": "you/three@live" }
imports       { "acme/three": "/site/you/three/src/Three.js" }
app.js        import * as THREE from 'acme/three';   ← unchanged
```

Verified in a browser: with the app's source untouched, the page renders
`REVISION 160-you-forked · defaults 6×4`, while
`/site/acme/three@0.160.0/src/constants.js` still serves `'160'`.

A bare `you/three` means `live`, which is what a fork wants. An alias that
is not a deck name is refused rather than silently treated as a range.
