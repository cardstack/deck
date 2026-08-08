# Deck → GitHub: the one-way mirror analysis

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Companion to `deck-semver-migration-spec.md`, `deck-publishing-skill.md`,
`deck-software-lifecycle.md`, `deck-realm-development-use-cases.md`.
Written 2026-08-07; the four decisions below were made by Chris this
session. Goal: **read-only visibility of publishing, promotion, and
removal — one-way and mechanical — preserving as much semantic nuance
as possible**, for two use cases: the catalog realm, and "share an app
I'm working on."

## 0. The free win that shapes everything

jj is **colocated**: every realm with the history sidecar already has a
real `.git` store beside `.jj`, and every seal is already a git commit
with a real author (verified live in the playground realm: actor-
attributed commits like "Restored Priya Shah to all four Week 32 yoga
shifts" sit next to bot-authored "save" commits). Exporting is
mechanically `git push`. The design problem is therefore not *how* to
export but **what fidelity and shape** to export — and how each realm
semantic survives translation into git/GitHub vocabulary.

Prior art for the posture: the Go project (go.googlesource.com is
truth; github.com/golang/go is a bot-pushed read-only mirror) and
Kubernetes' staging→published bot mirrors. One-way mirrors are a proven
top-tier-OSS pattern, not an oddity.

## 1. Decisions (Chris, 2026-08-07)

1. **Fidelity: curated `main` + full `history` branch.** `main` carries
   one commit per *semantic event* (publish, migration batch, promotion
   arrival, yank, quarantine) with `Change-Id:` trailers; `history` is
   the raw seal-level colocated history pushed as-is. Readers choose;
   nothing is lost; `git clone` carries both.
2. **Shape: one monorepo per realm, per-package tags.** The mirror
   preserves realm=repo 1:1. Versions are annotated tags in the
   changesets/Lerna convention `name@version` (`gym-board@2.0.0`).
   Cross-package events (catalog-wide migration, promotion) stay atomic
   in one commit. (Bot-split per-package read-only repos remain a
   possible later addition — Kubernetes staging pattern — not v1.)
3. **Quarantine: tombstone commit, tag stays.** A quarantine lands on
   `main` as a commit replacing the version's content with a tombstone
   + advisory pointer; the `name@version` tag persists, now pointing
   into burned content. The mirror stays append-only and mechanical.
   Known cost, accepted: the malicious bytes linger in git history —
   the mirror README states that quarantined versions are never safe to
   dig out, and the authoritative serve route (451) is the enforcement
   point, not the mirror.
4. **Authorship: real display names + synthetic realm-domain emails**
   (`user@<realm-host>`). Attribution survives into blame/contributor
   views; GitHub linking works for anyone who adds the address to
   their account; no real email or matrix ID is published. The
   actor's realm identity rides in an `Actor:` trailer for
   reversibility.

## 2. The semantic mapping table

| Realm semantic | GitHub carrier | Fidelity |
|---|---|---|
| Continuous seals + actors | `history` branch commits, real authors | Native (already true) |
| changeId | `Change-Id:` commit trailer (jj keeps it in metadata; the trailer makes it visible on GitHub) | Good |
| Immutable version bookmark (`create`) | **Annotated tag** `name@version` + GitHub Release — tags don't move | **Perfect fit** |
| Movable dist-tag (`set`) | **Branch** (`latest`, `next`) — branches move | **Perfect fit** |
| Publish event | Curated `main` commit updating the package dir + `_registry/` record, tagged | Good |
| PackageVersion records, advisories, migrations, fixtures, frozen jqxl | Already files — mirror as readable JSON/BXL automatically | Native |
| Advisory | The `_registry/` advisory file commit, **plus** a GitHub Security Advisory (GHSA ingests OSV) | Native + bonus |
| Yank | The registry record's `yanked` flip is itself a `main` commit; Release notes edited to say YANKED | Adequate |
| Deprecation | Severity-`none` advisory (see spec S6) — same carriers as advisory | Native |
| Migration batch applied | One curated commit per batch (message = the seal message, actor = the seal actor) | Good |
| Promotion (dev→staging→prod) | Each realm mirrors separately; the prod mirror only ever *receives* approved versions, so promotion is visible as arrival; Submission cards are files and mirror too | Good |
| Quarantine | Tombstone commit; tag persists; Release edited + GHSA published | Accepted tension |
| Restore | An ordinary commit on both branches (restore is append-only realm-side too) | Native |

The through-line: **because every piece of registry state is realm
data, the mirror carries the entire registry as readable files with
zero extra machinery** — a `git clone` IS a full offline copy of the
catalog, its versions, its advisories, and its migration programs.
That satisfies "users can download the whole git."

## 3. The export bot

A deterministic transform, in BXL's lane (pure function of registry
events → commit graph):

- **`history` branch**: push the colocated repo's branch as-is. No
  transformation. (~free)
- **`main` branch**: for each semantic event, in seal order, build a
  commit whose tree updates the affected package dir(s) +
  `_registry/`; author = mapped actor; committer = mirror bot; commit
  date = seal timestamp (determinism: rebuilding the mirror from
  scratch reproduces identical hashes); trailers: `Change-Id:`,
  `Actor:`, `Advisory:` where applicable. Tag on publish events.
- **Refs**: `refs/tags/name@version` (annotated, message = publish
  message + registry summary), branches for dist-tags, `main`,
  `history`.
- **Trigger**: realm events (publish / migrate-apply / yank /
  quarantine / promotion-ingest) for `main`; per-seal or periodic for
  `history`.
- **One-way enforcement**: bot-only push (deploy key), branch
  protection, an Action that auto-closes PRs with a pointer to the
  realm ("this is a read-only mirror of <realm URL> — changes happen
  there"), README banner, and a `.boxel-mirror.json` manifest at root
  recording source realm URL + last exported changeId (also the bot's
  resume cursor).

## 4. "Share an app I'm working on" variant

Same machinery, different defaults: single realm → single repo,
**curated `main` only** — the `history` branch is opt-in, because a
personal WIP realm's seal history is exactly the vibe-coding
intermediate state most people don't want public. If nothing has been
published yet, "share" exports one curated commit of the current state
(labeled with its changeId) — effectively a snapshot with provenance —
and grows real semantic history as the app starts publishing versions.

## 5. The catalog layout canonicalization (forcing function)

The mirror publishes the file tree verbatim, so the current
`~/Projects/boxel-catalog` organization becomes public — which makes
this the moment to canonicalize. Observed mess: hash-prefixed app dirs
(`04868f-mortgage-calculator`), PascalCase type dirs (`Category`,
`Skill`) beside kebab app dirs (`blog-app`), loose root files
(`cloudflare-image.gts`, `simple-card.gts`), case-duplicates
(`SystemCard` and `system-card`), and infra (`scripts`, `tests`,
`commands`) mixed in at root.

Proposed canonical layout (one dir per package = package root, matching
the spec's package conventions):

```
<catalog-realm>/
  <publisher>/<package-name>/   # publisher = matrix localpart / source
    package.json                # realm — an identity already owned, so
    migrations.json             # same-name packages from different
    *.gts                       # authors never collide and nothing is
    examples/                   # reserved (spec §0a; GitHub owner/repo
                                # shape)
  _registry/                 # PackageVersion records, advisories
  _catalog/                  # realm-level infra: workspace card,
                             # scripts, shared commands/fields
```

Cleanup implied: replace hash prefixes with publisher scoping
(`04868f-mortgage-calculator` → `<publisher>/mortgage-calculator` —
hashes verify, names mean; spec §0a), merge case-duplicates, move loose root defs
into their packages, move `scripts`/`tests`/`commands`/`fields` under
`_catalog/` or into the packages that own them. Once Deck lands, layout
conformance is a publishable lint the gate can enforce — the mess stays
fixed because the gate refuses regressions.

## 6. LOE

- Raw `history` push + one-way apparatus (deploy key, PR auto-closer,
  banner, manifest): ~0.5–1 day.
- Curated `main` builder (event→commit transform, tags, dist-tag
  branches, deterministic rebuild): ~2–3 days.
- GHSA filing + Release management: ~0.5 day.
- Catalog re-organization: content work, independent of code (~1 day of
  moves + reference fixes, then gate-enforced).

Total ~4–5 days, independent of the registry build slices; needs only
Slice 1 (publish events) to have something semantic to mirror. The
`history` push works against TODAY's sidecar with zero new realm-server
code.
