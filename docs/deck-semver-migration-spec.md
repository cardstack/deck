# Deck Spec: SemVer Version-Bump Protocol & Required Migrations

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Status (updated 2026-08-07): this spec covers the FULL protocol. The
**at-rest subset is BUILT AND TESTED** — stack L0–L5, branches
`deck/01`–`deck/05`; current description in `deck-at-rest-protocol.md`.
**Deferred by Chris's at-rest descope ruling**: the migration gate
(§2 steps 5–9), fleet migrations, security verbs (§6), the shim/AppDef
manifest layer (§4a), capability tiers, promotion, catalog intake.
One built-time change supersedes the text below: **the package
manifest is `importmap.json` (`boxel.packages[<name>]`), not a root
`package.json`** — see `deck-multi-package-design.md`; multi-package
realms with free file placement are supported.
Companion docs: `deck-publishing-skill.md` (the AI playbook), `deck-software-lifecycle.md` (the lifecycle narrative), `deck-at-rest-protocol.md` (what is built).
Repository of record for decisions: `ctse/bpm-architecture` realm on realms-staging.

## 0. Scope and stance

The realm server is one composable system replacing several historically
separate ones: filesystem (working files), search engine (current files),
database (queryable fields), versioning system (jj history sidecar, already
built), build/packaging system (this spec), and delivery system (immutable
versioned serving so live edits never break deployed users).

This spec defines the **version-bump protocol**, the **required-migration
rule**, the **lockfile / PackageVersion design**, and the **REST surface**.
Everything is REST-first; cards are a sugar layer that renders and triggers
the same REST operations, because most publishing will be automated by agents
(Claude Code via boxel CLI), not humans clicking.

Nothing here is invented syntax. Borrowed pieces, by name:

| Piece | Borrowed from |
|---|---|
| `@name@version/path` URL | unpkg / jsdelivr / esm.sh |
| Version-keyed migration manifest in the package | Angular `ng-update` / Nx `migrations.json` |
| Chained, ordered migrations named by target version | Flyway / Rails |
| Publish-time breaking-change gate | cargo-semver-checks |
| Range → exact resolution recorded at publish | npm lockfile semantics |
| Movable alias tags (`latest`, `next`) | npm dist-tags |
| Transform engine + frozen wire format | BXL ≥0.5.2 → jqxl v1 |
| Publish/migrate authorization | BXL OpenFGA-semantics kernel (Party/Seat/Capability/Resource) |
| Yank/unyank (exclude from resolution, keep serving pins) | cargo yank / PyPI PEP 592 / Go retract |
| Advisory schema | OSV (osv.dev) |
| Quarantine tombstones | npm security-holding packages |
| Consumer-side exclusion/substitution | npm overrides / Go exclude |

## 0a. Naming: no global namespace, no reservation system, no hash names

npm needed name reservation because `npm install lodash` resolves
against one flat global table — the name IS the identity, so names must
be globally unique, hence squatting, land grabs, and dispute policy.
Deck never builds that table. Rules (Chris ruling 2026-08-07):

1. **Package identity is `<realm-url>/@name@version/path`.** The name
   is unique only within its realm; the realm URL provides
   decentralized global uniqueness the same way Go module paths
   (domain-rooted, registryless), Deno URL imports, Maven reverse-
   domain groupIds, and Matrix IDs do. Two realms both publishing
   `gym-board` is as unproblematic as two GitHub users both owning a
   repo named `utils`. There is no global resolver to squat.
   **RRI harmonization (Chris-ratified 2026-08-07, amended same day to
   the four-segment form):** the canonical fully-qualified *reference*
   form is the scoped RRI
   **`@<place>/<publisher>/<name>@<version>/<path>`**, where `place` is
   the catalog/registry namespace that assigned the publisher handle.
   The place segment is load-bearing: publisher handles are
   catalog-assigned (point 4), so without it `@chris/gym-board` cannot
   say WHICH catalog's `chris` — and two catalogs' packages could not
   coexist in one consumer realm. It is also consistent with existing
   platform RRIs (`@cardstack/base/card-api` — `cardstack` is the
   place, `base` the resource) and with Go's domain-rooted module
   paths (multi-segment identity before the version is normal, not
   exotic). `place` is an abstract name resolved by
   `VirtualNetwork.addRealmMapping` — hosting stays config, never
   identity. Shorter forms are contextual: `@publisher/name@version/path`
   intra-catalog (place implied), and bare `@name@version/path` as the
   intra-realm HTTP *serving* shorthand (what the serve route
   implements). Documents, shims, and cross-realm references use the
   scoped forms. RRI is the reference layer, the realm
   URL is the serving layer, and only VirtualNetwork translates between
   them. Consequence: most of point 5's `movedTo` mechanism dissolves —
   re-hosting a package is a mapping change in consuming environments,
   not a document rewrite; `movedTo` survives only as a discovery hint.
   Consequence for published history: because published versions are
   immutable, content frozen before the RRI cutover carries legacy
   `https://cardstack.com/base/...` references forever — **the
   VirtualNetwork legacy read-mapping must be permanent**, not a
   temporary compatibility window (flagged to the RRI project).
2. **Bare/short names are local aliases with import-map semantics**
   (the browser standard — not invented). A bare name in an AppDef
   means what THAT AppDef maps it to; the shim layer already resolves
   locally-chosen names to absolute versioned URLs. Bare names are
   never resolved globally, so they cannot collide.
3. **No hash prefixes in names — hashes verify, names mean.** Zooko's
   triangle: a single name can't be human-meaningful, decentralized,
   AND secure; short hash prefixes (the old `04868f-mortgage-
   calculator` catalog pattern) sacrifice meaning without gaining
   security (short hashes are forgeable). The layered solution is
   already in the design: realm-scoped petname for meaning +
   `contentHash` on the PackageVersion record for verification (what
   trust badges bind to). UI may show a short hash chip to
   disambiguate same-named packages from different realms in search;
   hashes never appear in names or paths.
4. **Aggregating catalog realms scope by publisher identity, not
   reservation, not hashes.** A catalog imports many authors' packages
   into one realm, so same-name collisions ARE real there. Paths are
   `<publisher>/<name>` (`chris/gym-board`), and the `<publisher>`
   handle is **assigned by the catalog at first intake** (Chris ruling)
   — anchored to the author's full matrix ID on a Publisher record
   (matrix localparts alone can collide across homeservers:
   `@chris:stack.cards` vs `@chris:boxel.ai`). The catalog owns its own
   publisher namespace; the author owns the identity behind it — the
   GitHub-username model, scoped to one catalog rather than global
   — reads like `owner/repo`, and there is still no cross-catalog
   global table to squat. This supersedes hash-prefixed dirs in the canonical
   catalog layout.
   Category/curation labels are **listing metadata, never path
   segments** (Chris ruling, resolving the BSL corpus's 3-segment
   `@publisher/category/name` in favor of 2-segment paths: paths are
   identity, curation moves).
   **Catalog intake has two declared modes** (Chris-ratified):
   **re-home** (default — personal/WIP origin realms; identity
   migrates to the catalog address, next paragraph) and **advertise**
   (durable data realms, e.g. a standards-body directory realm — the
   listing references the data realm, nothing is copied, and consumers
   link to THAT realm's published versions). Each listing declares its
   mode.
   **Catalog intake (re-home mode) is a re-homing, not a pointer**
   (Chris, same day):
   the origin realm where the package was created may be private,
   renamed, or deleted, so its URL is never part of catalog identity —
   canonical identity migrates to the catalog address on sharing. What
   survives re-homing is the publisher identity (why paths scope by
   publisher, not origin realm) and the contentHash; the intake gate
   records `origin: { realmURL?, changeId, contentHash, publisher,
   publishedAt }` on the PackageVersion — `realmURL` is a courtesy
   link while the origin lives, and provenance still VERIFIES via
   contentHash after it dies (same hash-verified-ingest + gate-re-run
   model as realm promotion: trust is local to the accepting realm,
   never dependent on the sender staying up).
5. **Moves/renames**: a `movedTo` field on the Package record; the old
   realm serves a permanent redirect record, resolvers follow it once
   and rewrite the AppDef entry with user consent (Go vanity-import
   semantics; RRI is the future lever for hosting-independent names).

## 1. Versioning model

- **SemVer 2.0.0, strict.** `semver.valid()` or the publish is refused. No
  `v` prefix in stored versions.
- **Published versions are immutable.** A version is a jj bookmark created
  with `jj bookmark create` semantics — it never moves. Re-publishing an
  existing version number is always an error (npm's unpublish lesson:
  there is no unpublish, only deprecate).
- **Dist-tags are movable bookmarks** (`jj bookmark set` semantics):
  `latest`, `next`, and free-form tags. `latest` may only point at a stable
  (non-prerelease) version. Moving `latest` backwards is allowed but is a
  distinct, separately-authorized operation (`RollbackDistTag`), never the
  default path.
- **Prereleases** (`2.0.0-beta.1`) follow SemVer §9: never matched by
  ranges like `^1.2.0` unless explicitly requested; never eligible for
  `latest`. Prereleases are the in-realm staging mechanism.
- **Publish never creates history.** It names an existing jj changeId
  (design decision `publish-decoupled-from-history-capture`). Continuous
  history capture (the sidecar) and deliberate publication are separate
  acts on the same timeline — git commit vs. git tag.

## 2. The version-bump protocol (the gate)

Publishing is a single REST operation that runs a **deterministic gate
pipeline**. Every step is machine-checkable; no step requires human
judgment. A failed step refuses the publish with a structured error naming
the step. Order:

1. **AuthZ** — `checkCapability({party, capability: 'PublishVersion',
   resource: <package>})` via the embedded BXL authorization kernel.
   Prerelease publish and stable publish may be different capabilities
   (`PublishPrerelease` vs `PublishVersion`) so a team can let any dev cut
   betas but require a release Seat for stable.
2. **Version validity** — `semver.valid`, not already published, and
   `semver.gt(new, maxExisting)` unless publishing a backport to an older
   major line (allowed: `1.4.3` after `2.0.0` exists, refused: re-using or
   descending within a line).
3. **Manifest presence** — the tree at the target changeId declares the
   package in `importmap.json` under `boxel.packages[<name>]` with a
   `version` matching the request. (The file is the truth; the request
   must agree with it. As built in L5: the map is the manifest, a
   `package.json` is optional metadata, and file placement is free.)
4. **Breaking-change classification** — the bump is classified
   major/minor/patch from the version delta. Additionally the publisher may
   set `breaking: true` on a minor/patch to opt into the migration
   requirement (honesty escape hatch); the gate can never *downgrade* a
   major to non-breaking.
5. **Required-migration rule** — if breaking (any major bump, or
   `breaking: true`). Enforcement is tiered by release stability: a
   **stable** breaking publish is REFUSED without a covering migration;
   a **prerelease** breaking publish only WARNS — betas are structurally
   opt-in (never matched by ranges, never `latest`), so nothing
   downstream can be hurt yet, and mid-flow betas often precede the
   finished migration. The requirements, hard at stable:
   - `migrations.json` MUST exist and MUST contain at least one entry whose
     `from` range covers the immediately previous release line
     (e.g. publishing `2.0.0` requires an entry with
     `semver.intersects(from, '1.x')` when any `1.x` was ever published;
     a brand-new package's `1.0.0`→ first `2.0.0` still requires `from: "1.x"`).
   - Each entry MUST name a program file present in the tree, an `engine`
     (v1 supports exactly `"bxl"`), and a `fixtures` directory.
6. **Compile freeze** — every migration program's readable BXL source is
   compiled to **jqxl v1** by the gate. Compile error ⇒ refuse. The
   compiled artifact is written into the published tree alongside the
   source (`*.jqxl.json` next to `*.bxl`) so the executed program is frozen
   at publish time — future BXL surface-syntax changes can never
   reinterpret an old migration. The realm always executes the stored
   jqxl artifact, never a recompile.
7. **Fixture verification** — for every migration entry, every
   `fixtures/*.before.json` is run through the compiled program in the BXL
   sandbox and must deep-equal its paired `*.after.json`. Zero fixtures ⇒
   refuse (a migration without evidence is not a migration). Any mismatch
   or sandbox violation ⇒ refuse, with a per-fixture diff in the error.
8. **Chain flow-through** — if a previous major's migrations exist, each
   predecessor's `after` fixtures are additionally run through this
   version's applicable migration (when chained) and must produce valid
   output (parse + schema-shape check). Catches broken chains at publish
   time, not fleet-migration time.
9. **Determinism check** — the sandbox profile for migration programs
   forbids clock, randomness, network, and authorization calls
   (`auth_check/3` is available to *policy* evaluation, not migrations).
   Migration programs are pure functions: source document in, source
   document out.
10. **Effects (atomic intent, ordered for repairability)** —
    a. write the `PackageVersion` record through the normal realm write
       path (so it lands in jj history, gets indexed, and is searchable);
    b. create the immutable version bookmark on the changeId;
    c. optionally move a dist-tag if requested (`tag: "next"`).
    Record-before-bookmark ordering: a crash between (a) and (b) leaves a
    visible record pointing at a changeId with no bookmark — detectable
    and re-runnable; the reverse would leave an invisible published version.

Minor/patch publishes run the same pipeline; steps 5–8 are skipped unless
`breaking: true` or the package ships optional migrations anyway (allowed;
identity migrations are legal and sometimes useful for renames-in-place).

## 3. Migration manifest and program convention

Migrations live in the version being migrated **to** (new code knows its
own history; old code cannot predict the future — Rails' rule).

```
@gym-board@2.0.0/package.json
@gym-board@2.0.0/migrations.json
@gym-board@2.0.0/migrations/1.x-to-2.0.bxl          # readable source (authored)
@gym-board@2.0.0/migrations/1.x-to-2.0.jqxl.json    # frozen compile (gate-written)
@gym-board@2.0.0/migrations/fixtures/priya-board.before.json
@gym-board@2.0.0/migrations/fixtures/priya-board.after.json
```

Discovery is by well-known path: `migrations.json` at the package root,
with no manifest-pointer indirection (Angular needs a `package.json`
pointer because its manifests live at arbitrary paths; ours don't).
`migrations.json`:

```json
{ "migrations": [
    { "from": "1.x",
      "to": "2.0.0",
      "engine": "bxl",
      "program": "./migrations/1.x-to-2.0.bxl",
      "compiled": "./migrations/1.x-to-2.0.jqxl.json",
      "fixtures": "./migrations/fixtures/",
      "description": "shifts[] gains role; staff renamed to members" } ] }
```

Semantics:

- `from` is a **semver range**; a migration applies to a fleet iff
  `semver.satisfies(fleetFromVersion, from)`, where the fleet's
  from-version is the app manifest's pre-bump resolution (§4a) — or, for
  a document carrying an exception pin, that pin.
- `to` is exact and must equal the containing package version (one manifest
  per version describes only how to arrive at *that* version; direct-jump
  entries like `from: ">=1.0.0 <3.0.0"` in `3.0.0` are allowed and
  preferred over chains when present).
- **Chaining** is the Flyway walk: to move a doc from `1.4.2` to `4.0.0`,
  collect applicable entries from each published version in
  `(1.4.2, 4.0.0]`, order by `to` ascending, apply in sequence. Direct
  jumpers short-circuit. Chains longer than 2 majors are legal but
  auto-apply is refused — they escalate to human approval (the BXL-bot
  escalation ladder).
- **Migrations are TYPE-scoped, not document-scoped.** A document's data
  is shaped by more than one package: root `meta.adoptsFrom` names the
  card, but `meta.fields` carries per-path `adoptsFrom` for polymorphic
  contained values, which may come from other packages entirely. So a
  migration entry declares the card/field **type** it migrates, and the
  runner walks root `adoptsFrom` plus every `meta.fields` path, applying
  the program at each occurrence site regardless of nesting (BXL's
  schema-aware planner already understands the recursive `meta.fields`
  shape). Consequences: fleet census for a package's migration is an
  index query over root AND nested `adoptsFrom` — documents that merely
  *embed* one of its field types are in scope — and fixtures MUST
  include nested-occurrence documents, not only root adopters.
- **Programs target the loaded card shape, not raw JSON:API.** BXL ≥0.5.2's
  card-source mutation adapter handles the lowering: recursive
  `meta.fields`, relationship index reindexing, polymorphic `adoptsFrom`
  inserts, and source-preserving commits that keep unknown fields intact.
  A migration reads like the edit it means:

  ```bxl
  # staff renamed to members; every shift gains a default role
  Members = Staff;
  del(Staff);
  Shifts[].role = "member";
  ```

- The runtime (not the program) handles the version pointer: in
  production that means regenerating the shim from the manifest (one
  line, no document writes) and clearing any exception pins; migration
  programs transform document *attributes* only and never touch
  `adoptsFrom`.
- **A migration program IS a graduated TransformCard** — one transform
  artifact concept, two maturity states. In a dev realm the program
  lives as a TransformCard instance and runs ungated against your own
  documents; publishing exports that same program into `migrations/`
  with fixtures and freezes it through the gate. There is no separate
  migration authoring format to learn.
- **Stored migrations are re-verified before every application.**
  Frozen jqxl protects against syntax reinterpretation, but an
  evaluator *behavior* change (a bug fix) could alter output when a
  migration runs long after publish — import chains, straggler
  catch-ups. The runner re-executes the bundled fixtures under the
  CURRENT evaluator immediately before any apply; a mismatch refuses
  and escalates rather than transforming live documents with drifted
  semantics.

## 4. Pinning, lockfile, and PackageVersion records

Governing principle (Chris, 2026-08-07): **version numbers appear in as
few places as possible.** Production realms carry exactly one version
authority per package — the app manifest. Development realms carry zero.
Documents are version-free in both. This reconciles and adopts the
2026-08-06 `shims-are-the-lock` decision: the manifest's executable form
is the generated shim module, and instances adopt the shim's stable local
path, never a versioned URL.

**(a) Production: the manifest owns the pin; documents own nothing.**
Instance JSON says only:

```json
"adoptsFrom": { "module": "../packages/gym-board", "name": "GymShiftBoard" }
```

— a stable, version-free local path that never changes across upgrades.
The path resolves to a generated shim, which is the manifest entry made
executable:

```ts
// packages/gym-board.gts — generated from the AppDef manifest; do not hand-edit
export { GymShiftBoard } from '@boxel/chris/gym-board@2.0.0/gym-shift-board';
```

The shim's specifier is an **RRI** (scoped reference form, §0a), not an
https URL — which splits the two decisions cleanly: **the shim carries
the version pin** (in source, diffable, jj-audited) while **the
VirtualNetwork realm mapping carries the hosting location** (in
environment config). Promotion across dev/staging/prod therefore needs
ZERO consumer-realm rewrites: same shims, different mappings per
environment. The AppDef manifest keeps intent (range, e.g. `^2.0.0`)
and resolution (exact `2.0.0`); shim generation lowers resolution into
source, and the reconciler registers the corresponding realm mapping. The
consequences are the point:

- **Non-breaking upgrade = one shim line rewritten, zero documents
  touched.** Under per-document pinning even a patch bump was a fleet
  rewrite; under manifest pinning minor/patch upgrades never touch user
  data at all.
- **Breaking upgrade = one shim line + the data migration.** The fleet
  "repoint" step disappears entirely; `_migrate/apply` batches change
  document *attributes* only, never `adoptsFrom`.
- **Version applicability is a manifest delta; application sites are a
  per-document meta walk.** Two layers, deliberately: the manifest's
  pre-bump resolution decides WHICH migrations run (documents need no
  version stamp for this), and the type-scoped runner (§3) walks each
  document's root and nested `adoptsFrom` to decide WHERE in the
  document they apply.
- **Per-instance pinning remains possible as a deliberate escape
  hatch.** Any document MAY carry a full RRI-form
  `@chris/gym-board@1.4.2/...` `adoptsFrom` (hosting-independent — a
  pinned document survives realm moves because only VN resolves the
  prefix) — doing so opts it out of the manifest: upgrades and
  fleet migrations skip it (it appears in the plan as "pinned, excluded")
  until the pin is removed or explicitly migrated. Uses: canary batches,
  skip-and-escalate stragglers, a document a user refuses to upgrade, or
  freezing one critical doc during an incident. Pins are visible in the
  JSON and countable via index query — an escape hatch, never hidden
  state, and never the default.
- **Canary needs a temporary exception**: the canary batch gets explicit
  pins to the new version (or a `packages/gym-board-next` shim) for the
  soak window, then the manifest flips and the exceptions are removed.
  This is the one cost of manifest-owned pinning; it is bounded and
  audited like everything else.
- Rollback is unchanged: the shim edit and the migration batches are all
  jj changes; restore covers both.

**(b) Development-only realms: no pins anywhere.** Vibe-coding realms
skip the manifest entirely — instances point at the live tree (relative
`adoptsFrom`) or at `@latest`, and schema evolves in place. Data keeps up
via **TransformCards**: a card wrapping a BXL program that the developer
runs ad hoc against their own instances ("migrate as you go") — the card
UI over `_migrate/apply` in ungated mode (no fixtures required; it's your
own scratch data, and every application is still a sealed, restorable jj
change). Graduation is literal, not metaphorical (§3): publishing
exports the same TransformCard programs into `migrations/`, and the
documents you tested them on become the `before/after` fixtures. Vibe
coding naturally produces exactly the artifacts the publish gate later
demands.

**(c) There is no stored lockfile — the shim set IS the lock.** Intent
(ranges) lives in the AppDef; resolution (exact versions) lives in the
generated shim lines — executable, diffable, indexed source. A
published package's own dependency ranges are resolved at publish time
and recorded in its PackageVersion record (npm shrinkwrap-at-publish
semantics): consumers of a published version get the exact dep tree the
fixtures were verified against, including `contentHash` — which is what
lets a trust badge earned in staging carry to prod. Any JSON "lockfile
view" (`GET /_packages/_resolutions`) is computed on read from AppDef +
shims + PackageVersion records, never authored and never stored —
derived state cannot drift.

**(d) Provenance — "which code version wrote this data?" is derived,
never stored, except at realm boundaries.** No per-document
`schemaVersion`/`createdFrom` stamp exists in steady state, for two
reasons. First, the migration protocol maintains the invariant
*manifest at V ⟺ every non-exception document's data is V-shaped*
(pin-riding batches + flip-last ordering guarantee it), and exception
pins ARE the stamp for the docs that deviate. Second, forensic
provenance is a join of two histories the realm already keeps: the
document's last-write seal against the manifest's version timeline —
always correct, never drifts. A stored stamp would be denormalized
state that CAN drift (a stamp that lies is worse than none) and would
put version numbers back into thousands of documents. `adoptsFrom`
stays a pure forward resolution pointer; it is never overloaded with
provenance.

The exception is **cross-realm import/export, where a document leaves
its history behind** — there the derivation breaks, and a stamp earns
its keep. Borrowed semantics, with their Kubernetes names: the manifest
is the **storage version** (`storage: true`); `meta.createdFrom` plays
`apiVersion` (the per-object stamp), applied only at boundaries;
migrate-on-import is a **conversion webhook**; fleet migration is a
**StorageVersionMigration** (kube-storage-version-migrator); chaining
with direct-jump preference is a loosened **hub-and-spoke** model. One
deliberate divergence: K8s converts on every read/write because its
conversions must be lossless and round-trippable; ours are one-way
(breaking), which is why bulk transform-and-commit is canonical here
and read-time conversion is only ever the dry-run preview. On export,
stamp `meta.createdFrom` with `package@version` per adopted type (or
the def contentHash for unpublished dev-realm shapes). On import, the
receiving realm immediately migrates the document to ITS manifest
version, using the stamp to select the chain entry point; the stamp
then goes inert (retained as provenance, never consulted for
resolution). A document whose stamp names an unpublished shape cannot
chain and escalates to a human or agent instead of importing silently
wrong.

**(e) The PackageVersion record — the registry made of cards.** The publish
gate's step 10a writes an ordinary card instance:

```
_registry/gym-board/2.0.0.json   → PackageVersion card instance
_registry/gym-board/index.json   → Package card (dist-tags live here)
```

Fields: name, version, changeId, commitId, contentHash,
`upstreamVersion` (the external standard's own release name — IANA
`2025a`, Unicode `15.1` — for directory/dataset packages tracking a
standards body; Chris-ratified 2026-08-07), publish actor + timestamp,
dist-tags-at-publish, migration manifest summary, resolved dependency
map, deprecation/yank/quarantine flags (mutable, citing advisories). Because it lands through the normal write path it
is **indexed and queryable** ("which packages have a 2.x?", "what depends
on gym-board 1.x?") with zero registry-specific index machinery — the
database leg of the realm does the work. The card definition renders it;
the REST endpoint is the source of truth and of action.

## 5. REST surface (cards are sugar over this)

```
POST <realm>/_packages/<name>/publish        { version, changeId?, tag? }
GET  <realm>/_packages/<name>                → Package + dist-tags (JSON:API)
GET  <realm>/_packages/<name>/versions      → PackageVersion list
POST <realm>/_packages/<name>/dist-tags     { tag, version }        # MoveDistTag
POST <realm>/_packages/<name>/deprecate     { version, message }
POST <realm>/_packages/<name>/advisories    { <OSV document> }       # §6.1
POST <realm>/_packages/<name>/yank          { version, reason, fallback? }  # §6.2
POST <realm>/_packages/<name>/unyank        { version }
POST <realm>/_packages/<name>/quarantine    { version, advisory }    # §6.3, realm-owner only

GET  <realm>/@<name>@<version>/<path>        # immutable serve (302→exact for ranges/tags)
GET  <realm>/@<name>@^2.0/<path>             # range → semver.maxSatisfying → 302
GET  <realm>/@<name>@latest/<path>           # tag → 302

POST <realm>/_migrate/plan     { package, toVersion, filter? }   → fleet + chain, no writes
GET  <instance-url>?migrate-to=@<name>@<version>                  → dry-run single doc
POST <realm>/_migrate/apply    { package, toVersion, batch?, actor }  → via _history/commit
```

`_migrate/apply` lands each batch as one sealed jj change with message and
actor — the audit log **is** the migration log, and rollback **is** the
existing restore. Skip-and-escalate per document on program error, schema
mismatch, or content-hash drift between plan and apply.

AuthZ: v1 implements exactly THREE permission tiers — **write** (=
prerelease publish, plan, advisory), **release Seat** (= stable
publish, dist-tags, deprecate, yank, apply), **realm owner** (=
quarantine, backwards dist-tag moves). The fine-grained capability
names (`PublishPrerelease`, `PublishVersion`, `MoveDistTag`,
`RollbackDistTag`, `Deprecate`, `PlanMigration`, `ApplyMigration`,
`ApproveEscalation`, plus §6's security set) remain the vocabulary at
every check site, so the OpenFGA-semantics kernel (policy stored as
realm data, exactly like the `bxl-clinical-access` showcase) can
differentiate them later with zero endpoint changes. Do not build 14
capabilities in v1; build 3 tiers behind 14 names.

## 6. Security response: the verb set

Borrowed from a decade of registry incidents (left-pad, event-stream,
colors/faker, node-ipc) and the mechanisms the ecosystem converged on
after them (`cargo yank`, PyPI PEP 592, Go `retract`, npm
security-holding packages, OSV advisories). Nothing invented. Four verbs
in escalating severity, plus the emergency-patch path:

**(1) Advisory — publish knowledge, change nothing.**
`POST _packages/<name>/advisories` with an **OSV-schema** document
(osv.dev — the cross-ecosystem standard; do not invent an advisory
shape). Affected versions are expressed as ranges. Effects: the serve
route adds a warning header on affected versions; PackageVersion records
gain an `advisories` relationship (indexed → "which manifest/shim resolutions
and exception-pinned docs are exposed?" is one query); nothing
stops working. Advisories are append-only records with their own jj
history like everything else. **Deprecation is the same record type**:
`deprecate` is sugar that files a severity-`none` advisory and points
the PackageVersion's mutable `deprecated` field at it — one warn-record
system, three intensities (deprecated / advisory / yank reason), all
citing advisories.

**(2) Yank / Unyank — exclude from resolution, keep serving pins.**
`POST _packages/<name>/yank { version, reason, advisory? }` (PEP
592/cargo semantics). Effects: `semver.maxSatisfying` skips yanked
versions for range and dist-tag resolution; a dist-tag currently
pointing at the yanked version MUST be moved in the same operation (the
request names the fallback, typically the newest un-yanked version);
new manifests cannot resolve to it. But **exact references still
serve** — a manifest shim or exception pin naming the yanked version
keeps working, with the warning header. Nobody's fleet breaks; nobody
new walks in. `unyank` reverses it (publishing a false alarm must be
cheap, or people will hesitate to yank). Yank state lives on the
PackageVersion record (mutable fields: `yanked`, `yankReason`, like
`deprecated`).

**(3) Quarantine — stop serving the bytes (admin-only, terminal).**
For confirmed malware/exfiltration, where continuing to serve pinned
consumers is itself the harm. `POST _packages/<name>/quarantine
{ version, advisory }` — requires the `Quarantine` capability, held by
the realm owner Seat, deliberately NOT by publisher Seats
(colors/faker lesson: the registry must be able to act against the
publisher). Effects: the serve route answers `451` with the advisory
for every path under that version; the version number is burned forever
(the bookmark and PackageVersion record persist as tombstones — npm
security-holding semantics, so the number can never be silently
reused); affected manifests/pins now *break visibly*, which for actual
malware is correct. This is the only verb that ever stops serving a
published version, and it is not an unpublish: history, record, and
number all remain.

**(4) Emergency patch — always a NEW version, never an edit.**
Immutability holds under pressure; the emergency path is fast because
of the design, not exempt from it:

- Patch the current line (`2.3.1`) and/or **backport onto old lines**
  (`1.4.3` after 2.x exists — §2 step 2 already permits line-scoped
  ascending publishes) so that exception-pinned stragglers and
  old-manifest realms have a same-major, migration-free upgrade target.
- Patch releases carry no migration requirement (non-breaking by
  definition), so the gate is already fast — publish latency is fixture
  re-verification only when migrations are bundled. No "emergency
  bypass" flag exists: a gate you can bypass under pressure is a gate
  you don't have (the incident is exactly when a broken migration would
  do the most damage).
- Remediation of owned fleets is the manifest payoff: one shim line per
  realm. Exception-pinned docs get a **pin bump** (`1.4.2` → `1.4.3`,
  same line, batched via `_history/commit`, audited).
- The typical full sequence: advisory → yank bad version (+ dist-tag
  fallback) → backport/patch publish → manifest bumps + pin bumps →
  quarantine only if malware.

**(5) Consumer-side exclusion — protect yourself when the publisher
won't.** npm `overrides` / Go `exclude` semantics, realm-local: an
AppDef policy entry `{ "exclude": ["gym-board@1.4.2"],
"substitute": { "gym-board@1.4.2": "1.4.3" } }` that the resolver
honors when (re)generating shims and resolving ranges. Pure policy
data in the consuming realm — no cooperation from the publishing realm
required. This is the multi-realm story's safety valve: prod realms can
respond to an advisory before (or without) the upstream acting.

New capabilities: `PublishAdvisory`, `Yank`, `Unyank` (publisher-tier),
`Quarantine` (realm-owner only). Yank/quarantine/advisory actions land
through the normal write path — the audit log answers "who yanked what,
when, citing which advisory" for free.

## 6a. Surfaces: how each security verb lands in the API and the card universe

The uniform loop (applies to every verb except consumer-side policy):
the REST endpoint is the **actuator** — it validates, checks the
capability via the embedded BXL kernel, performs the multi-step effect,
and seals ONE jj change; the registry records it writes are the **read
model** (ordinary indexed cards); card UI is **views plus action
buttons that call the actuator**, with buttons rendered conditionally
from `listCapabilities({party, resource})`. Cards never write registry
files directly — the endpoints own the invariants. Live re-render comes
from the existing realm-event subscription; no polling.

### Advisory

```
POST /_packages/gym-board/advisories          # capability: PublishAdvisory
{ "schema_version": "1.6.0",                  # OSV, verbatim
  "id": "BOXEL-2026-0001",
  "summary": "gym-board leaks member emails in fitted view",
  "severity": [{ "type": "CVSS_V3", "score": "7.5" }],
  "affected": [{ "package": { "ecosystem": "Boxel", "name": "gym-board" },
                 "ranges": [{ "type": "SEMVER",
                              "events": [{ "introduced": "1.2.0" },
                                         { "fixed": "1.4.3" }] }] }],
  "references": [{ "type": "ADVISORY", "url": "…" }] }
→ 201  Location: /_registry/gym-board/advisories/BOXEL-2026-0001
```

Endpoint: validates OSV shape + capability → writes
`_registry/gym-board/advisories/BOXEL-2026-0001.json` as an `Advisory`
card instance through the realm write path → seal
(`advisory: BOXEL-2026-0001`, actor) → indexed. Serve route adds
`X-Boxel-Advisories: BOXEL-2026-0001` on every response for versions in
the affected range.

Card universe: `Advisory` card def (id, summary, severity, affected
ranges as containsMany, references). Fitted view = severity badge +
range. The PackageVersion card shows applicable advisories via a
computed search (advisories whose range covers this version), not a
stored link — so a new advisory lights up old version cards with zero
writes. The Advisory card's isolated view carries an **Exposure
census** section: two index queries rendered as linked lists —
AppDef/shim resolutions falling in the range, and exception-pinned
instances. "File advisory" is an action on the
Package card that opens an OSV form and POSTs; the card never writes
the file itself.

### Yank / Unyank

```
POST /_packages/gym-board/yank                # capability: Yank
{ "version": "1.4.2",
  "reason": "email leak — BOXEL-2026-0001",
  "advisory": "BOXEL-2026-0001",
  "fallback": "1.4.1" }                       # REQUIRED iff a dist-tag points at 1.4.2
→ 200 { "yanked": "1.4.2", "distTagsMoved": { "latest": "1.4.1" } }
```

Endpoint, one queued op: version exists and is not quarantined → update
the PackageVersion record's mutable fields
(`yanked: true, yankReason, advisory`) via the write path → for each
dist-tag pointing at the version, require `fallback` (else 409) and
move the jj bookmark + Package record together → single seal
(`yank: gym-board@1.4.2 (BOXEL-2026-0001)`). The range/dist-tag
resolver excludes versions whose record says `yanked`; exact serve
still returns 200 + `X-Boxel-Yanked` header.
`POST /unyank {version}` flips the fields back; it does NOT auto-move
dist-tags forward again (that is an explicit `MoveDistTag`).

Card universe: the PackageVersion card renders a yellow YANKED band
with reason + advisory link; the Package card's version list strikes
through yanked versions and its dist-tag chips re-render from the
record. The "Yank…" button (rendered iff the Party holds `Yank`) opens
a dialog asking reason + fallback, pre-filled with the newest un-yanked
version, and POSTs.

### Quarantine

```
POST /_packages/gym-board/quarantine          # capability: Quarantine (realm-owner Seat)
{ "version": "1.4.2", "advisory": "BOXEL-2026-0001" }   # advisory REQUIRED
→ 200
```

Endpoint: sets `quarantined: true` + advisory on the PackageVersion
record (which implies all yank effects, including demanded dist-tag
fallback), single seal. Serve route: every
`@gym-board@1.4.2/<path>` → `451` with a JSON:API error document
linking the advisory. No unquarantine endpoint — terminal by design;
the record and bookmark persist as tombstones and the version number
is never reusable.

Card universe: tombstone treatment on the PackageVersion card (red,
"QUARANTINED"); the button renders only for the realm-owner Seat and
requires re-typing the version (destructive-action affordance). In
consuming realms, the AppDef card surfaces a broken-resolution error
state linking the advisory — visible breakage is the intended outcome.

### Emergency patch (incl. branchless backport)

No new endpoints — the standard publish flow, twice (current line +
backport lines). The one mechanism worth spelling out is **how to build
backport content in a single-live-tree realm**: the live tree is at
2.x-era HEAD, but `1.4.3`'s tree must be `1.4.2 + fix`. v1 does it with
existing primitives, exploiting "production never reads HEAD":

1. `_history/restore` to `1.4.2`'s changeId (live tree detours; pinned
   users see nothing — they don't read HEAD; dev workbench instances
   flicker, acceptable in an emergency);
2. apply the fix, seal;
3. `POST /_packages/gym-board/publish { "version": "1.4.3" }` — names
   that changeId;
4. `_history/restore` back to the pre-detour changeId.

The detour MUST run as one queued compound operation that holds the
realm's write path for its (seconds-long) duration — otherwise another
editor's autosave can land on the detoured HEAD and get swept into the
backport (the dual-editor write war in a new hat). Every step is a
sealed, audited jj change; the whole detour is self-documenting in
`_history`. v2 can move this off-HEAD with jj workspaces, but nothing
blocks on that.

Remediation is then existing surface: manifest bump = shim rewrite via
`_history/commit` (or the AppDef card's "Upgrade to 1.4.3" banner
action, which appears when a newer same-line version exists with an
advisory on the current one); exception-pin bumps =
`_migrate/apply { package, toVersion: "1.4.3" }`, which for a
patch-level target has an empty migration chain and degenerates to a
pure pin rewrite, batched and sealed.

### Consumer-side exclusion (the one verb that IS card data)

This verb inverts the pattern deliberately: exclusion policy is the
*consumer's own intent document*, so the card (AppDef) is the source of
truth and the **reconciler** is the actuator. The AppDef instance
carries:

```json
"policy": { "exclude": ["gym-board@1.4.2"],
            "substitute": { "gym-board@1.4.2": "1.4.3" } }
```

Editing the AppDef card (or PATCHing the instance via ordinary REST —
same thing) triggers the policy reconciler, which re-resolves ranges
with exclusions/substitutions applied, regenerates the shim modules
through the write path, and seals with actor `policy-reconciler`. The AppDef card renders the resulting resolution
diff ("gym-board: 1.4.2 → 1.4.3 — substituted per policy"). This needs
no cooperation from, or round-trip to, the publishing realm.

## 7. Rock-solid invariants (the checklist any implementation must keep)

1. Published version bookmarks never move; dist-tags always may.
2. The gate executes only frozen jqxl artifacts; readable BXL is for
   humans and diffs.
3. No stable breaking publish without a covering, fixture-proven
   migration; prerelease breaking publishes warn instead of refuse.
4. Zero-fixture migrations do not exist.
5. Migration programs are pure (no clock/random/network/authz).
6. All registry state mutations flow through the realm write path → jj
   history → index. No side-band state.
7. Record-before-bookmark on publish; plan-hash-check on apply.
8. Fleet migration = batched `_history/commit` seals; rollback = restore.
9. Live-tree edits are invisible to any pinned consumer, always.
10. Deprecation instead of unpublish, always. Security escalation is
    advisory → yank → quarantine; yank never breaks an exact reference;
    quarantine is the only serve-stopping verb, is realm-owner-only, and
    tombstones rather than deletes.
11. There is no emergency bypass of the publish gate; the emergency path
    is fast by design (patch = no migration requirement), not by
    exemption.
12. Version numbers live in as few places as possible: production = the
    app manifest (via generated shims) only; development = nowhere;
    documents = only as a deliberate, visible, index-queryable escape
    hatch that opts the document out of manifest-driven upgrades until
    removed.
13. A stored migration is never applied without first re-running its
    bundled fixtures under the current evaluator.
14. The shim set is the lock; no lockfile is ever stored — lock views
    are computed on read.
15. RRI is the reference form, the realm URL is the serving form, and
    only VirtualNetwork translates between them; the legacy
    URL-prefix read-mappings are permanent because published versions
    freeze pre-cutover content forever.
