# Catalog Consumption Modes: remix, install, use, import, browse, try

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Companion to `deck-semver-migration-spec.md` (§0a naming, §4 pinning),
`deck-github-mirror-analysis.md` (catalog layout), and the use-case
ladder. Written 2026-08-07. Today's app supports exactly one verb —
**remix** (a copy) — and loses lineage doing it. This doc defines the
full verb set; all are to be supported.

## 0. The axes (why these are different verbs at all)

Every consumption mode is a position on five axes:

| Axis | Values |
|---|---|
| Code | copy into my realm / reference the catalog (versioned RRI) / none |
| Data | copy / reference (`linksTo`) / create fresh / none |
| Version coupling | none (snapshot) / exact pin / range via manifest / live |
| Upgrade story | none / offered per-doc / fleet migrations / automatic |
| Ceremony | zero / one action / manifest-managed |

The punchline up front: **all six verbs are compositions of five
already-designed primitives** — copy-with-provenance, exact pin
(escape hatch), manifest+shim, `linksTo`, and index search. No new
machinery beyond build Slices 1–3 plus one addition: provenance
recording on copy.

## 1. The verb set

### Remix — "make it mine" (exists today; gains provenance)

Copy the package's code + examples into my realm. No version coupling;
I own and diverge freely. **The one change from today's remix: record
lineage.** The copy's Package/instance records get the same `origin`
block as catalog intake (`{catalogURL, publisher/name, version,
changeId, contentHash}`). Costs nothing, buys three things: (a)
attribution survives; (b) "your remix is based on gym-board@1.4.2 —
2.0.0 is out" nudges become possible; (c) **advisory census can find
derived copies** by `origin.contentHash` match — today a vulnerable
remix is invisible to everyone. A future `rebase remix` op (three-way
diff against the recorded origin version) is enabled but not v1.

- API: `POST /_catalog/remix { package, version?, dest }` → tree copy +
  origin block, sealed in the destination realm.
- Upgrades: none automatic, nudges only. Security: census-visible via
  provenance hash, fix is manual.
- Graduation: a matured remix can publish back to the catalog as the
  remixer's own package (`origin` intact — the fork lineage is public).

### Install — "manage it" (the flagship Deck mode)

An AppDef manifest entry + generated shim; code stays in the catalog,
referenced at a resolved exact version within my declared range; my
instances adopt the version-free shim path. Everything in the spec
applies in full: one-line non-breaking upgrades, gated breaking
upgrades with fleet migrations, exception pins, exclusion policy.

- API: edit AppDef (card save or REST — same thing) → reconciler
  regenerates shims, sealed by `policy-reconciler`.
- Upgrades: the whole §4/§2 machinery. Security: first-class advisory
  census, yank-aware resolution, consumer-side exclusion.

### Use — "create an instance and yolo" (zero ceremony, still safe)

One action: create an instance in my realm whose `adoptsFrom` is an
**exact pin** at whatever the catalog's `latest` resolves to right now
(`@<catalog>/chris/gym-board@2.1.3/gym-shift-board`). The per-instance
escape hatch as the *entry* path. No manifest, no shim, no ceremony —
and still safe forever, because the pin is immutable: yolo never means
"changes under me."

- API: ordinary card-create; the "Use" button is sugar that resolves
  `latest` → exact and stamps the pin.
- Upgrades: offered per-doc ("2.2.0 available — bump this instance?"),
  single-doc migration chains on demand for breaking jumps.
- Graduation: when yolo instances accumulate, **promote to install** —
  generate a manifest from the observed pins, rewrite instances to the
  shim path, one sealed batch. (Same shape as TransformCard→migration:
  the casual artifact graduates into the managed one.)

### Import — "depend on it from code" (semver-locked)

My card defs import modules from the catalog as dependencies:
`import { formatCurrency } from '<shim>/money'` with the AppDef
declaring `chris/money: ^2.1.0`. This is install's module-granularity
face — same manifest + shim machinery, but the consumer is my *code*
rather than my instances. When my package is itself published, my
dependency resolution is recorded on my PackageVersion
(shrinkwrap-at-publish): my consumers get the exact dep tree my
fixtures were verified against.

- API/CLI: `boxel add chris/money@^2.1` → AppDef entry + shim; imports
  target the shim path.
- Upgrades: manifest bumps; breaking dep upgrades are *my* code
  changes (compiler surfaces them), not data migrations.
- Security: census-visible via manifest; exclusion policy applies.

### Browse — "the catalog as an instance chooser" (reference data)

The catalog's *instances* are the value here: themes, country flags,
icon sets, category taxonomies. The chooser UI is index search over
catalog instances (the existing `_search`/prerendered-card machinery —
no new query surface). Picking has two sub-modes:

- **Link** (default for reference data): my document `linksTo` the
  catalog instance **at a published version** — example instances ship
  inside package versions, so the link target
  `@<catalog>/chris/flags@3.0.0/Flag/nz` is immutable. Stable forever,
  zero copies, census-visible (index query over linksTo URLs).
  A deliberate variant links the *unversioned* live instance for
  data that SHOULD flow (e.g. an org-wide theme the catalog curates)
  — live-follow is opt-in, never default.
- **Copy**: clone the single instance into my realm with an `origin`
  block — a one-instance remix, for data I'll customize (a theme I'm
  about to tweak).

- Upgrades: pinned links get "bump link" offers; live links follow
  automatically; copies get remix-style nudges.

### Try — "kick the tires" (no commitment)

Render and interact with a catalog card before any verb above:
an ephemeral instance in a scratch context (the catalog realm's own
example instances already render — try is one step further: a
sandbox instance I can poke that nothing persists). Zero writes to my
realm; the exit doors are Use / Remix / Install.

## 2. The matrix

| Verb | Code | Data | Coupling | Upgrade story | Security visibility | Ceremony |
|---|---|---|---|---|---|---|
| Remix | copy | copy | none (provenance recorded) | nudges only | via origin.contentHash | one action |
| Install | reference | mine, fresh | range→exact via manifest | full fleet machinery | first-class census | manifest |
| Use | reference | mine, fresh | exact pin at creation | per-doc offers | census via pins | zero |
| Import | reference (from code) | n/a | range→exact, shrinkwrapped at my publish | manifest bump, compiler-surfaced | census via manifest | manifest |
| Browse-link | none | reference | version-pinned link (live opt-in) | bump-link offers | census via linksTo query | one action |
| Browse-copy | none | copy | none (provenance) | nudges | via origin.contentHash | one action |
| Try | none | ephemeral | none | n/a | n/a | zero |

Reading the matrix top to bottom is also the commitment gradient:
try → use/browse → remix → install/import. Each verb's exit doors lead
rightward (try→use, use→install, remix→publish-back, copy→link never —
copies diverge by intent).

## 3. Cross-cutting rules

1. **Every copy records provenance.** Remix and browse-copy always
   write the `origin` block. This is what makes diverged copies
   census-visible after an advisory and makes lineage/attribution
   durable. (Today's remix loses this; that's the bug to fix first.)
2. **Every reference is exact unless deliberately live.** Use-pins,
   install-shims, import-resolutions, and browse-links all resolve to
   immutable versioned addresses; live-follow exists only as the
   opt-in browse-link variant. Nothing a consumer holds ever changes
   under them without an act.
3. **Advisory census covers all modes** — manifests (install/import),
   pins (use), linksTo URLs (browse-link), and `origin.contentHash`
   (remix/copy). One advisory, five queries, complete exposure map.
4. **Graduations are batched, sealed operations** like everything
   else: use→install and remix→publish-back land through
   `_history/commit` with actors — auditable, restorable.
5. **The catalog side needs nothing per-verb.** Publisher-scoped
   packages, published versions with example instances inside them,
   and the registry records are sufficient for all six verbs —
   consumption mode is entirely the consumer realm's choice.

## 3a. Directories (BSL §35) ride the same substrate — corpus-checked

Chris's ruling (2026-08-07): catalogs AND directories (country codes,
vendor directories, ISO/IANA datasets) use the same realm history and
packaging. Cross-checked against the BSL corpus
(`surprising-jay/35-directory-system.md`, `64-bsl-versioning-grounded.md`,
`bsl-wiki` Wiki pages): **§35 explicitly deferred its versioning,
breaking-change, and pinning policy "until package-management lands"
— this ruling is that revisit.** The mapping:

| §35 concept | Deck substrate |
|---|---|
| Dataset release (tz `2025a`) | a version publish; upstream release name = metadata on the PackageVersion (per §35's own DirectoryInfo origin fields) |
| `DirectoryEntryProposal` accepted | `_history/commit` merge with proposer as actor (fixes §35's github-pr audit-continuity gap — audit is automatic under jj) |
| Canary → Community tiers | dist-tag / promotion machinery — governing TRUST elevation only (see Capsule note below) |
| `assignedId` "immutable once published" (MVP freeze) | upgraded: renamable via major + bundled type-scoped migration walking `DirectoryMetadata` regime entries |
| Directory chooser fields | the **browse** verb (link sub-mode, version-pinned) |
| Federated search overrides | consumer-realm additions; query federation itself is platform work, out of Deck scope |

Reconciliation flags — ALL RULED by Chris (2026-08-07):
1. **Path shape: category is listing metadata, not path.** Catalog
   paths stay 2-segment `<publisher>/<name>`; the corpus's
   `@publisher/category/name` category segment moves to the listing
   record (paths are identity, curation moves).
2. **Two intake modes ratified**: re-home (default; personal/WIP
   origin realms) vs advertise (durable data realms — listing
   references, no copy). Listings declare which mode they use.
3. **`upstreamVersion` field on PackageVersion ratified** (IANA
   `2025a`, Unicode `15.1` as record metadata beside the semver).

**💊 Capsule is not a tier — it is a sandbox schema** (Chris
correction, superseding §35/§30's three-tier ladder): untrusted code
runs immediately in SES-container or iframe confinement, with **no
submission or review required to run**. The promotion ladder
(Canary → Community, trust badges) governs *trust elevation* —
escaping confinement, gaining capabilities — never runnability.
Consequence for the verbs: **Try and Use work instantly on ANY
package, review or no review**, because capsule confinement makes
untrusted execution safe by construction; review gates what the code
may *do*, not whether you may run it.

## 4. Build notes

- Browse and try are UI over existing surfaces (search + render).
- Use is sugar over card-create + `latest` resolution (Slice 1).
- Install/import are the Slice 1–3 build + the shim reconciler
  (post-Phase-00-probe).
- Remix exists; add the `origin` block (small, high leverage — do
  first). Rebase-remix is future work enabled by it.
- use→install graduation and advisory-census-over-provenance are small
  follow-ons to Slices 3–4.
