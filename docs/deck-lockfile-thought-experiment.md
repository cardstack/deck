# Deck · dependency management thought experiment

**Status: ANALYSIS** (what a versioned catalog inherits from lockfiles;
synthesized with Deck rulings). Companions:
[`deck-package-json-and-depot-lock.md`](deck-package-json-and-depot-lock.md)
(depot lock = authority),
[`deck-unfrozen-mode.md`](deck-unfrozen-mode.md) (skip-the-freeze is per edge),
[`deck-who-may-intervene.md`](deck-who-may-intervene.md) (layers; no silent rewrite),
[`deck-laws.md`](deck-laws.md) (L4: published bytes never change),
[`deck-breaking-ships-its-migration.md`](deck-breaking-ships-its-migration.md)
(instances outlive code),
[`deck-catalog-consumption-modes.md`](deck-catalog-consumption-modes.md)
(remix vs pin vs use),
[`deck-depot-and-realm-backport.md`](deck-depot-and-realm-backport.md)
(depot vocabulary; realm is the embedding word elsewhere),
[`deck-a-package-resolves-through-its-own-map.md`](deck-a-package-resolves-through-its-own-map.md)
(superseded for consumers; still useful on per-importer vs flattened maps).

This note does not introduce a new protocol. It records why a
**per-depot resolution manifest** is the right lockfile-equivalent, which
problems it does *not* solve, how one shared browser runtime complicates
N depot locks, and what to build next — already encoded in standalone
Deck as a depot-root `importmap.json`.

---

## 0. Premise

Each catalog listing becomes a package with a `package.json` declaring
semver ranges for its deps, and publishers ship multiple Versions over
time.

Today’s soft baseline in product UIs is often a **fork** — copy modules
(and instances) into the consuming depot. Vendoring is the most extreme
lockfile there is: perfect reproducibility, zero drift, and no upgrade
path. A versioned catalog trades that staleness for resolution’s drift —
and re-opens most classic lockfile problems, plus some npm never had.

---

## 1. What lockfiles solve in general

A lockfile is a recorded answer to: *given these version ranges, what
exact code am I running?* Six things go wrong without one:

1. **Ranges re-resolve over time.** `^1.2.0` means something different on
   Tuesday than on Friday.
2. **Transitive dependencies float.** Pinning directs still leaves deps’
   deps unbounded.
3. **Machines disagree.** Laptop, teammate, CI each resolve independently.
4. **Diamond dependencies** need one recorded shared answer for overlapping
   ranges of `C`.
5. **Artifacts can be tampered with or republished.** Integrity hashes
   detect byte changes behind a name+version.
6. **Upgrades are invisible** without a diff surface — review, audit,
   advisory checks.

---

## 2. Three lobes: npm-only, shared, Deck-only

### Lockfile-only (npm’s physical install model — not Deck’s)

| Problem | Why it is not ours |
| --- | --- |
| `node_modules` layout / hoisting | Imports are URLs; no disk tree shape |
| Install speed / offline re-resolution | Listing graphs are small; depot-served |
| Platform / optional / peer records | No per-OS binaries or npm peer quirks |

### Shared — inherited the moment listings declare ranges

| Problem | Why it arrives |
| --- | --- |
| Ranges drift over time | Same listing, different week → different deps |
| Transitive deps float | Listing → listing chains |
| Machines disagree | Sibling depots / workspaces “same” listing, different code |
| Diamond deps | Overlapping ranges of a shared dep need one answer |
| Tampered artifacts | Need integrity / immutability |
| Unreviewable upgrades | No pin → no diff → no audit trail |

**This middle region is the case for a lockfile-equivalent in Deck.**

### Deck-only — pinning cannot buy these

| Problem | Why a lockfile is insufficient |
| --- | --- |
| Stored data outlives code | Instances persist; upgrades strand saved data |
| Type identity is persisted | Adoption / field types are module-URL identities; two Versions = two types |
| The registry is editable | A catalog is a depot; publishes can mutate unless policy forbids |
| No single install moment | Live load + in-place edit — when is resolution recorded? |
| Forks never upgrade | Remix diverges on copy; versioning’s job is an upgrade *path*, not only a pin |

---

## 3. So what (the middle region)

Record the exact Version and content hash of every module a depot
resolved, and **replay until an explicit, diffable upgrade**. That is a
lockfile wearing Deck clothes — the depot-root import map. It covers the
six shared problems outright.

The right lobe still needs:

- **Immutable publishes** (a Version’s bytes never change — L4)
- **Instance migration** when a schema Version moves
- **Type-identity policy** when two Versions of the same definition coexist

Pinning alone buys none of those.

### Encoding: depot-root `importmap.json`

Already the ruling in this repo:

> A package’s `package.json` is a suggestion. The depot’s `importmap.json`
> is the only resolution authority.

The compiled lock is a web import map at depot root — `imports` /
`scopes` / `integrity`, plus optional `deck` metadata. Suggestions come
from each package’s `package.json` (and from whatever tooling can see is
in use). An “upgrade” is a deliberate compile or mutate of that file (a
structured transform language is a good fit), not silent re-resolution on
every load. The map sits in the depot’s Timeline (`jj` / deckd), so
restore of a past Step restores the lock with the tree.

Serve injects **that depot’s** lock into documents it serves. A pack’s
own thin map stays lineage, not consumer authority.

---

## 4. Per-depot lockfiles in one shared runtime

Structural mismatch: a host often frames or composes modules from
**many depots** in **one** browser runtime — one DOM, one loader, one
module graph. Per-depot locks give N answers to “what does this specifier
mean?”; a page-global import map has room for one flattening unless the
loader is scoped.

```
Depot A lock          Depot B lock
person@2.1            person@2.2
kernel@4.0 ⚠          kernel@4.1 ⚠
        \                /
         \              /
      ONE BROWSER · ONE MODULE GRAPH
         person (v2.1)     person (v2.2)   ← two types (costly but coherent)
         kernel ×2         ← catastrophic: identity / links / CE collide
```

Ordinary packages can coexist as duplicate types (at a cost). **Kernel**
packages (shared runtime APIs every graph must agree on) must be a
**host-pinned singleton** that no depot lock may override — the React /
Module Federation `singleton` tier, npm `peerDependencies`, Java EE
parent classloader.

### Seven issue classes

1. **Resolution-context ambiguity** — whose pin applies when A and B both
   import `shared-lib`? Key by the requesting module’s depot (import-map
   `scopes` / nested loaders). Allowing multiple copies creates (2).
2. **Module identity fracture** — two Versions ⇒ two module instances;
   where types are module references, identity *is* type identity. Worst
   case: two kernels. Fix: host-pinned kernel tier.
3. **Cross-depot data interop under skew** — a link typed at `Author@v2`
   vs an instance adopting `Author@v3`. Nominal typing says no. Need
   structural compat, semver-aware rules, or loud link-time errors — and
   the skew is **persisted**, not only in memory.
4. **Global runtime state collisions** — `customElements.define`,
   singletons, caches, polyfills: double or last-writer-wins.
5. **Environment divergence** — indexer / prerender / seal evaluation
   under one depot’s lock in isolation; the browser composes many.
   Dedup/fallback in the host can make index ≠ live by design.
6. **Resource multiplication** — N depots × M pinned Versions of common
   deps: graphs, CSS, heap, boot time.
7. **Same URL, different pinned content** — if lockfiles pin hashes for
   **mutable** URLs, two depots can disagree on bytes for one URL; one
   runtime cannot honor both. Forces **version-addressed or
   content-addressed** URLs — the lock design constrains the URL scheme.

### Shape of the answer

| Need | Mechanism |
| --- | --- |
| Coherent coexistence | Version-addressed (or content-addressed) module URLs |
| Whose pin? | Depot-scoped resolution (import-map scopes / per-depot evaluation context) |
| Kernel | Host-pinned singleton; depot locks cannot override |
| Typed links under skew | Declared compat policy — fail loudly, or ETL / adapters |
| Taxes either way | (5) environment divergence, (6) resource multiplication |

### Sticky URLs vs lock — compare specificity (must decide)

Lockfiles do **not** buy correctness for copied instances across depots
that disagree on schema Version. If a document was authored against
`invoice@2.0.0` and lands in a depot whose lock still has `invoice@1.x`,
replaying the lock is the wrong instrument — **if** adoption is sticky
enough to win the compare.

This is a **concept** (how tight the wish is), detected from **syntax** of
the address — not “which Version is newer.” Semver libraries do not ship a
CSS-style specificity sort; Deck defines one.

#### Spec-shape rank (the `@` segment)

| Rank | Concept | Syntax examples |
| --- | --- | --- |
| 3 — exact | One Version | `2.0.0`, `2.0.0-beta.1` |
| 2 — range | Set of Versions | `2`, `2.x`, `^2.0.0`, `~2.0.0`, `>=2 <3`, `*` |
| 1 — tag | Movable name | `latest`, `next`, `dev` |
| 0 — none | No `@` / live tree | `/depot/pub/pkg/…` |

Exact > range > tag. Specificity ≠ highest Version: exact `2.0.0` beats
range `^2` even if `^2` currently selects `2.9.1`.

#### Address kind (outer cascade)

| Rank | Kind | Who usually writes it |
| --- | --- | --- |
| 4 | Absolute URL + `@…` | sticky `adoptsFrom` / ETL copy |
| 3 | Absolute URL, versionless | live working tree |
| 2 | Relative URL | in-depot authoring |
| 1 | Bare specifier | resolved **only** via depot lock |

#### Who wins: lock vs `adoptsFrom`

Compare the **adoption address** to what the lock would bind for that
package (bare → map → URL). Higher cascade rank wins. Tie on kind →
higher spec-shape rank wins. Tie again → normalized URL code-unit order
(same idea as import-map scope sorting). Deterministic; no clock.

| Adoption (`adoptsFrom`) | Lock would give | Winner | Why |
| --- | --- | --- | --- |
| `/cat/acme/invoice@2.0.0/invoice.gts` | `invoice` → `…@1.4.2/…` | **adoption** | kind 4 exact > bare→map |
| `/cat/acme/invoice@2.0.0/…` | `invoice` → `…@2.0.0/…` (same) | either (same URL) | equal after normalize |
| `/cat/acme/invoice@^2/…` | `invoice` → `…@2.0.0/…` | **adoption** | kind 4 > kind 1; lock exact does not rewrite an absolute URL |
| `/cat/acme/invoice@latest/…` | `invoice` → `…@2.0.0/…` | **adoption** | absolute URL; map never rewrites it |
| `invoice` (bare) | `invoice` → `…@1.4.2/…` | **lock** | bare is kind 1; map applies |
| `../invoice` (relative) | (n/a until resolved) | resolve relative first, then compare | after resolve, often becomes absolute±`@` |
| `/cat/acme/invoice/…` (live) | `invoice` → `…@1.4.2/…` | **adoption** | absolute URL still outranks bare→map |

**Runtime:** the browser already implements the important half — import maps
resolve **specifiers**; they do not remint an already-absolute module URL.
So sticky absolute `@exact` adoption is not “overridden” by the lock at
load time.

**Tooling must still compare** when: copying across depots, compiling a
lock, offering “upgrade this desk,” or warning that adoption and lock
disagree. Rule of thumb for product verbs:

- **Final Cut / ETL copy** — rewrite relative → absolute + **exact**;
  adoption wins forever until a migration rewrites it.
- **SaaS desk upgrade** — instances keep bare (or relative) adoption so
  the **lock** wins; `deck lock --update` moves them together.
- Never let the lock silently rewrite an absolute+exact adoption URL.

Metaphor: **SaaS tenant** (lock wins) vs **Final Cut project** (sticky
adoption wins). Different verbs ([consumption modes](deck-catalog-consumption-modes.md)).

#### CSS parallel — and forcing a winner (must stay a valid URL)

Whether a document’s type URL (`adoptsFrom`) should override the import
map / lock depends on the **specificity of the semver (and address
kind)**. That is the same shape as CSS: cascade + specificity, not a
boolean “type always wins.” (The JSON document is the instance; the URL
is the **type**.)

Once you have specificity, an opt-in that skips the compare becomes
thinkable — CSS `!important`. **Encoding constraint: the type address
remains a single valid URL** (no parallel JSON boolean, no `!` in the
path). Force is one query param with two values naming **who wins**:

```text
/catalog/acme/invoice@2.0.0/invoice.gts?win=path   → type URL wins (sticky)
/catalog/acme/invoice@2.0.0/invoice.gts?win=map    → import map / lock wins
```

| `win=` | Meaning | Product metaphor |
| --- | --- | --- |
| `path` | This URL (the type path) wins the cascade even if spec-shape is weak | Final Cut — open as authored |
| `map` | Depot import map / lock wins even over absolute+exact | SaaS desk — fleet rebind |
| *(omitted)* | Run the normal compare (kind, then exact > range > tag) | default |

`path` means “this URL,” not “pathname only” (query/hash aside). `map`
means the consumer lock (import map), which is part of Deck — the param
is not named `deck`.

| Rejected spellings | Why |
| --- | --- |
| `?deck=important` | `deck` is the whole system; the contest is path vs map |
| `?instance=important` | Instance is the JSON; this URL is the type |
| `?type=important` | Only forces one side; no symmetric `map` |
| `…!important` in path | Not a clean URL segment |
| Fragment `#…` | Often dropped before fetch / module resolve |

**Rules**

1. Default (no `win`) — specificity cascade; do not sprinkle force.
2. Prefer raising specificity (absolute+exact, or bare so the lock applies)
   over `win=` as the normal path.
3. `win=path` and `win=map` together (or conflicting duplicates) → **fail
   loud** (two `!important`s).
4. Strip `win` when fetching pack bytes so content-addressed identity
   ignores the flag; keep it for the cascade compare and Timeline diffs.
5. Reviewable, never an ambient host default.

---

## 5. Synthesis with rulings already landed

| Thought-experiment claim | Deck standing |
| --- | --- |
| Per-consumer resolution manifest | Depot-root `importmap.json` is the lock ([package.json & depot lock](deck-package-json-and-depot-lock.md)) |
| Suggestions vs authority | `package.json` suggests; lock decides |
| Explicit upgrade surface | `deck lock` / `--update` / `--check`; optional continuous |
| Skip freeze per edge | `workspace:*`, `@live`, tags — not “always latest” ([unfrozen mode](deck-unfrozen-mode.md)) |
| Immutable publishes | L4; catalog may yank/select, never rewrite bytes ([who may intervene](deck-who-may-intervene.md)) |
| Integrity | Import map `integrity` member |
| Transitives compiled in | `scopes` — no runtime re-resolution of downstream wishes |
| Try without rewriting the lock | `?with=` for one request |
| Instances outlive code | Breaking Version ships migration ([breaking ships migration](deck-breaking-ships-its-migration.md)) |
| Timeline restore includes the lock | Lock is an ordinary tree file under seals / Steps |
| Serve injects consumer lock | Not the pack’s own map |
| Remix ≠ versioned use | Consumption modes: copy vs pin vs use |
| Two resolver layers | Semver (wish / URL segment) + import map (compiled pins) — §6 |

Standalone Deck proves the **middle lobe** in a browser. The **right
lobe** (persisted types, multi-depot composition, catalog-as-depot) and
the **seven classes** are what a host that frames many depots must still
answer — including any product that embeds Deck.

---

## 6. Historical prior art (compressed)

Chips refer to the seven classes in §4.

- **Scoped resolution in one runtime** (1, 2) — OSGi, Java EE parent/child
  loaders, import-map scopes. OSGi was complete and largely abandoned for
  complexity cost — cautionary.
- **Singleton kernel** (2, 4) — npm peers, Module Federation
  `singleton: true`, Cargo `links`. Every coexistence system invents this
  tier after “two copies of React / ClassCastException: Foo ≠ Foo.”
- **Version-in-the-name** (2, 7) — Go major in import path; Cargo allows
  multi-version with compile-time fracture. For URL modules, Go’s bet is
  the closest: version-addressed URLs. Its **simplicity is a shining
  beacon** — incompatible majors are simply different names; diamonds
  dissolve by construction. Tempting as a sole strategy. Deck still needs
  **more version interop** than pure version-in-name gives: ranges that
  admit patch/minor movement under a recorded pin, diamonds resolved once
  in a lock, sticky typed URLs alongside bare specifiers, and deliberate
  upgrade of a consumer without renaming every import in every instance.
  Go’s path encoding alone cannot express that flex.
- **Mutable registries** (7) — Deno lock + hashes; npm immutability after
  left-pad; Go checksum DB; Nix/Unison content-addressing.
- **DLL Hell layers** (3, 4) — WinSxS manifests, .NET binding redirects,
  SONAME / symbol versioning.
- **Data outliving code** (3) — Erlang `code_change`, GemStone class
  versions, Avro reader/writer schema resolution.

Composite lesson: coexistence systems invent a singleton kernel; mutable
registries bolt on immutability; systems that age well push version into
the name so the resolver is less clever. OSGi is the upper bound on
resolution flexibility vs complexity.

### Two resolver layers (the bounded middle)

Not one clever resolver — **two stacked, each simple**:

| Layer | Job | Almost… |
| --- | --- | --- |
| **1. Semver** | Names what is compatible; ranges and exact Versions live in suggestions and in version-addressed URLs (`…@1.2.3/…`) | …version-in-name, but with the interop flex majors-in-path refuse: `^` / exact / tags, migration across minors, diamond answers |
| **2. Import map** | Records *this consumer’s* frozen answer — specifier → exact URL (+ scopes, integrity) | …a lockfile; replay until explicit upgrade |

Semver is **almost** Go’s version-in-the-name: the Version segment is in
the URL, coexistence is coherent, the graph stays bounded. The extra
degree of freedom is exactly the interop we need — without OSGi-grade
negotiation. The import map is the second layer: it does not re-invent
semver; it **compiles** a semver-shaped wish into pins for one depot.
That is the right complexity to add; the §7 recommendations already
assume this stack and do not change.

### Go majors-in-path vs Deck semver + import map

Go puts only the **major** in the import path; minor and patch live in
`go.mod` (and the selected module graph), not in the import string:

```text
import "example.com/invoice/v2"          // identity: major 2
require example.com/invoice/v2 v2.3.4    // minor/patch chosen here
```

Within one major path there is one selected Version (MVS). A breaking
major is a new module (`/v3`). That is not the same as Deck/npm
`invoice@2`, which is a **range** (`>=2.0.0 <3.0.0`), not a rename.
Exact pins stay `invoice@2.0.0`.

| | Go (`…/invoice/v2` + `require v2.3.4`) | Deck (same name + semver + lock) |
| --- | --- | --- |
| **Pros** | Diamonds on major dissolve (v2 and v3 are different modules). Import graph shows the breaking line. Resolver stays dumb; MVS only negotiates within one major. Major migration is intentional (change every import path). | One product name across majors; lock records the answer. Interop flex: ranges, tags, deliberate `--update`, sticky exact URLs when needed. “Upgrade the desk” without renaming every adoption. Matches npm-shaped catalogs and two simple layers. |
| **Cons** | Major upgrade is a rename tax across the codebase (and every sticky typed URL). Still needs a lock for minor/patch — version-in-name does not replace it. Poor fit when a consumer should move majors without rewriting instance identity. Awkward if the catalog treats `invoice` as one product across majors. | Diamonds across majors need a recorded choice (lock / scopes). Easy to pretend `invoice@2` is identity when it is a range. Shared runtime still needs kernel singleton + sticky-URL policy. More ways to be clever — and to get skew wrong if the lock is not the authority. |

**Short take:** Go wins on simplicity of major coexistence; Deck wins on
version interop and upgrade ergonomics for persisted typed data.
Minor/patch are lockfile work in both.

---

## 7. What Deck should do

Ordered so each step is shippable without boiling the ocean. Much of
**A–B** is already the reference implementation; the rest is host /
catalog / composition work.

### A. Depot lock (encoding) — landed

1. **Depot-root `importmap.json`** as the only consumer resolution
   authority (web import map: `imports`, `scopes`, `integrity`).
2. Package `package.json` holds ranges and identity — suggestions.
3. **Compile or mutate** the lock on explicit upgrade (`deck lock` /
   `--update`; structured transforms for larger edits). No silent
   re-resolve on every GET for ranged edges.
4. Keep the lock in Timeline so restore / scrub includes pins.
5. Serve injects **this depot’s** map into HTML (and per-depot evaluation
   contexts), never a flattened “host sees everything” map as the only
   truth.
6. **Serve shortcut:** when the lock already pins every `workspace:*` /
   dist-tag key from live `package.json` files, skip the unfrozen store
   walk (`unfrozenKeysMissingFromLock`). A compiled Hub lock makes HTML
   injection cheap; gaps still overlay without requiring `--update` first.

### B. URL scheme and catalog policy

6. **Version-addressed** (or content-addressed) module URLs for published
   Versions — coexistence requires (7).
7. **Immutable publishes** in catalog: a Version’s bytes never change;
   edits are new Versions. Hashes detect lying; policy prevents it (L4).
8. Host-pinned **kernel** (agreed shared runtime APIs): one copy; depot
   locks must not override. Document the peer/singleton tier.

### C. Loader / runtime composition

9. **Depot-scoped resolution** when one page composes many depots
   (scopes, iframes, or shadow evaluation contexts) — do not pretend one
   page-global map can honor N disagreeing locks.
10. Prefer **duplicate ordinary packages** over clever dedup that makes
    indexer ≠ browser. Dedup only inside the kernel tier.
11. Treat `customElements` / singletons as kernel concerns or
    version-suffixed registration — document the rule.

### D. Instances, links, copy

12. **Compare specificity** (kind, then exact > range > tag) to decide
    lock vs type URL — §4. Opt-in force on the type URL:
    `?win=path` (sticky) / `?win=map` (lock wins); omit for cascade.
    Tooling must compare on copy/upgrade, not only at runtime.
13. Cross-depot **copy** rewrites relative adoption to absolute+version
    (ETL). Do not expect the destination lock to reinterpret foreign
    instances safely.
14. Ship **migrations** with breaking Versions; acceptance gated on
    demonstrated migration ([ruling](deck-breaking-ships-its-migration.md)).
15. For query / search across skew: treat search JSON / structural
    projections as looser (CQRS); **commands** stay on strict type+Version.
    Optional link adapters for soft references — not a silent weaken of
    write identity.

### E. Product verbs (so lockfile is not skeuomorphic)

16. Keep **remix** (vendored fork) for creative diverge-with-lineage.
17. Add **use / pin** paths that reference catalog Versions through the
    depot lock (operator upgrades) without copying schema code.
18. Make “upgrade this depot” a first-class, reviewable diff of
    `importmap.json` — distinct from “open this artifact as authored.”

### F. What not to build first

- Full OSGi-grade resolution negotiation across all depots in one graph.
- Runtime floating of transitive ranges (compile into the lock instead).
- Lock-driven reinterpretation of sticky typed URLs after cross-depot copy.

---

## 8. One-line summary

**A versioned catalog needs a per-depot lockfile-equivalent (depot-root
import map) for the six inherited problems; it also needs immutable
Versions, migration, sticky typed URLs, a host-pinned kernel, and scoped
composition — because persisted module types compose in one shared
browser, not a `node_modules` tree.**
