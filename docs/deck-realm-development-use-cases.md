# In-Realm Development Use Cases: vibe coding → enterprise deployment

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Companion to `deck-semver-migration-spec.md` (the rules),
`deck-publishing-skill.md` (the agent playbook), and
`deck-software-lifecycle.md` (the narrative). Written 2026-08-07.

This is the exercise ladder: 23 use cases in 7 tiers, ordered so each
tier adds exactly one concept. Each case names the primitives it
exercises and its acceptance check, so this doubles as the acceptance
matrix for the build slices. **Status** legend: ✅ built and verified
today (jj-history-sidecar branch) · 🔨 Slice N (per the agreed build
order) · 📐 designed, later phase.

STATUS UPDATE (2026-08-07, after the at-rest descope and the L0–L5
build): the at-rest protocol is BUILT — publish, dist-tags, versioned
serving, compiled modules, and the importmap.json manifest (see
`deck-at-rest.md`). The gate, migrations, security verbs, and
the shim layer are DEFERRED by ruling, so their cells below read 📐.
The old 🔨 S-numbers refer to the pre-descope build plan.

| Tier | Concept added | Cases | Status |
|---|---|---|---|
| 1 | History as safety net (no versions) | UC-1..3 | ✅ (UC-3's TransformCard runner 📐) |
| 2 | Naming checkpoints (first versions) | UC-4..5 | ✅ built (L2–L5) |
| 3 | Production in the same realm (manifest) | UC-6..10 | publish/serve ✅; manifest+migrations 📐 deferred |
| 4 | More than one pair of hands | UC-11..13 | UC-11 ✅; UC-12 partial (3 tiers built); UC-13 auth ✅ |
| 5 | Consuming other realms' packages | UC-14..16 | 📐 |
| 6 | Enterprise promotion (multi-realm) | UC-17..19 | 📐 |
| 7 | Incident response | UC-20..23 | 📐 deferred |

---

## Tier 1 — Solo vibe coding: history is the only safety net

*Persona: Sam, building a gym shift board alone in one realm. No
versions, no manifest, no ceremony.*

**UC-1 · The live-edit loop.** Sam edits `gym-shift-board.gts`; their
workbench instances (relative `adoptsFrom`) re-render on save; the jj
sidecar debounce-seals every save with zero action from Sam.
*Exercises:* `noteMutation`/`flush` write-sealer. *Accept:* `_history`
lists a seal per edit burst; no seal is ever lost between rapid saves.
*Status:* ✅ (12-test suite + live tier-maker board round-trip).

**UC-2 · "Undo the last hour."** A refactor went sideways. Sam opens
history, picks the changeId from before the refactor, restores. The
restore replays through the realm write path and seals a NEW change —
history stays append-only; the "bad hour" remains inspectable.
*Exercises:* `restorePlan` → `writeMany`/`deleteAll` → seal.
*Accept:* files byte-identical to the target History Step; a new changeId
at the top of `_history`; nothing force-mutated on disk. *Status:* ✅.

**UC-3 · Schema change, data follows immediately.** Sam renames
`staff` → `members` in the card def, then runs a **TransformCard**
(`Members = Staff; del(Staff);`) over their own instances — ungated,
sealed, restorable. No fixtures, no gate: every document is Sam's own.
*Exercises:* BXL evaluation over card source, ungated `_migrate/apply`.
*Accept:* instances render under the new schema; one seal in `_history`
covering the transform; restore reverses it. *Status:* 🔨 S3 (the BXL
runner); the manual equivalent via `_history/commit` is ✅ today.

## Tier 2 — Naming checkpoints: versions appear, nothing deploys yet

**UC-4 · First publish.** Sam tags the current state `1.0.0`. Publish
names the existing changeId (no new content sealed); a PackageVersion
record lands at `_registry/gym-board/1.0.0.json`, indexed and
searchable. Sam's instances still track HEAD — publishing changed
nothing about their dev loop. *Exercises:* publish gate steps 1–3, 10;
bookmark create; record-before-bookmark ordering. *Accept:*
`GET @gym-board@1.0.0/gym-shift-board.gts` serves the exact tagged
bytes while HEAD moves on; duplicate publish of `1.0.0` refuses.
*Status:* 🔨 S1.

**UC-5 · Prerelease + pinned test instance.** Sam publishes
`1.1.0-beta.1`, pins ONE instance to it via the per-instance escape
hatch, and keeps vibing on HEAD. The pinned instance is a stable demo
that survives any amount of further editing. *Exercises:* prerelease
rules (never matched by ranges, never `latest`), exact-pin serving.
*Accept:* the pinned instance renders beta behavior; HEAD instances
render newer edits; `@gym-board@^1.0.0` resolution ignores the beta.
*Status:* 🔨 S1.

## Tier 3 — Production in the same realm: the magic use case

*Persona: Sam's board now has thousands of user documents — Priya's
gym among them — in the SAME realm Sam vibe-codes in.*

**UC-6 · Deploy without a deploy.** An AppDef manifest + generated shim
(`packages/gym-board.gts` → `@gym-board@1.4.2/...`) becomes the fleet's
single version authority; user documents adopt the version-free shim
path. Sam continues editing HEAD daily. *Exercises:* manifest-owned
pinning, shim serving. *Accept:* user docs render 1.4.2 regardless of
HEAD churn; grep of user JSON finds zero version numbers. *Status:*
📐 (shim reconciler awaits the Phase 00 re-export probe); the
underlying pinned serving is 🔨 S1.

**UC-7 · The one-line upgrade.** `1.5.0` ships (non-breaking). Upgrade
= rewrite one shim line. *Accept:* entire fleet on 1.5.0; **zero user
documents written**; one seal in `_history`. *Status:* 📐 with S1
underneath.

**UC-8 · The breaking release, end to end.** `2.0.0` renames a field.
The gate refuses publish until a fixture-proven migration rides along.
Then: plan (fleet census + hash) → canary behind exception pins → data
batches where each seal carries transform + pin together (every doc
always matches its code) → flip manifest → clear pins. The audit log
on the gym board shows every batch with actor and message; rollback at
any point is restore. *Exercises:* gate steps 4–9 (compile-freeze,
fixture verify, purity), `_migrate/plan|apply`, pin-riding ordering.
*Accept:* a doc mid-migration always renders correctly; a deliberately
broken fixture blocks publish; restore returns the whole fleet to
pre-migration state. *Status:* 🔨 S2 (gate) + S3 (migrate). **This is
the case the whole system exists for.**

**UC-9 · The refusenik document.** Priya declines the 2.0 workflow.
Her board gets an exception pin to `1.4.2` — visible in her JSON,
excluded from fleet migrations, listed in every plan output, working
forever off the immutable bookmark. Later she relents: a single-doc
`_migrate/apply` chains `1.x→2.0→...` as needed. *Exercises:* escape
hatch, straggler exclusion, chain walk. *Accept:* fleet migrations
skip her; her single-doc migration chains correctly. *Status:* 🔨 S3.

**UC-10 · The audit log is real.** The gym board's changelog panel
lists `_history` entries — saves, migrations, restores — with actors,
and a hover-reveal restore button. *Status:* ✅ (built this session on
`ctse/forge-gym-shift-board`; predates the registry but is the UI
pattern all Tier-3 verification reuses).

## Tier 4 — More than one pair of hands

**UC-11 · Who did what.** Multiple actors (humans and bots) write via
`_history/commit`; each seal is attributed to the correct actor —
including the jj author-fixed-at-creation trap, already fixed and
regression-tested. *Status:* ✅ (`prepareActorCommit`, 3 tests).

**UC-12 · Capability-tiered publishing.** Any dev Seat can publish
prereleases; only the release Seat can publish stable or move `latest`;
only the realm owner can quarantine. v1 maps these onto existing realm
permissions (write / realm_owner); the OpenFGA-semantics kernel swaps
in behind the same capability names later. *Exercises:* gate step 1.
*Accept:* a non-release Seat's stable publish returns 403 with the
capability named; the same request from the release Seat succeeds.
*Status:* 🔨 S2 (permission-mapped), 📐 (kernel swap).

**UC-13 · The agent does the whole playbook.** A Claude Code agent
with its own Matrix account runs `deck-publishing-skill.md` end to end:
login → OpenID → realm JWT → classify change → author migration +
fixtures → beta → dry-runs → stable → plan/canary/batches → report.
*Status:* auth round-trip ✅ (7/7 smoke checks); full playbook 🔨 S1–S3.

## Tier 5 — Consuming packages across realms

**UC-14 · Install from another realm.** A consumer realm's AppDef
declares `gym-board: ^2.0.0` from Sam's realm; the reconciler resolves
(`semver.maxSatisfying` over the publisher's PackageVersion records)
and writes the shim — which IS the lock; no lockfile is stored.
*Accept:* consumer instances render off the publisher's immutable
bookmark; the shim line carries the exact version; the computed
resolution view (`_packages/_resolutions`) shows version + contentHash. *Status:* 📐 (needs the Phase 00 cross-origin
re-export probe).

**UC-15 · Range following.** Publisher ships `2.1.0`; consumer's
re-reconcile moves the shim within `^2.0.0` — one line, sealed,
attributable to `policy-reconciler`. `2.x → 3.0` is NOT followed
(range boundary): upgrading a major is always a deliberate act.
*Status:* 📐.

**UC-16 · Self-defense.** An advisory lands on `2.1.0`; the publisher
is slow. The consumer adds `exclude/substitute` policy to their AppDef;
their reconciler re-resolves without any upstream cooperation.
*Status:* 📐.

## Tier 6 — Enterprise: dev / staging / prod with promotion

**UC-17 · Promotion pipeline.** `@gym-board@2.0.0` is promoted
dev → staging → prod as a hash-verified copy of the immutable version
tree; **each realm re-runs the publish gate on ingest** (compiled jqxl
must match byte-for-byte; fixtures must pass locally). Trust badge
carries because contentHash is identical. *Accept:* tampered bytes or
a failing fixture refuse ingest; the version URL serves identically in
all three realms. *Status:* 📐.

**UC-18 · Staging fleet as extended fixtures.** The staging realm's
synthetic documents are migrated first; any staging doc that fails
becomes a new `before/after` fixture pair in `2.0.1`'s migration
before prod ever sees the release. *Accept:* the prod migration's
fixture set provably includes every shape that failed in staging.
*Status:* 📐.

**UC-19 · Submission workflow as cards.** Promotion requests are
Submission card instances in staging (referencing the PackageVersion,
carrying review state); `SubmitForReview` and `ApproveRelease` are
Seats held by different Parties; approval triggers the prod ingest.
Cards render the queue; REST performs the transitions. *Status:* 📐.

## Tier 7 — Incident response

**UC-20 · Advisory + census.** An OSV advisory is filed against
`>=1.2.0 <1.4.3`. The Advisory card's exposure census (two index
queries: manifest/shim resolutions, exception pins) lists every
affected consumer. *Accept:* census matches ground truth exactly; affected
serve responses carry the advisory header. *Status:* 🔨 S4.

**UC-21 · Yank under uncertainty.** Mid-investigation, `1.4.2` is
yanked with `latest` falling back to `1.4.1`. New resolution avoids
it; every exact pin keeps working with a warning. False alarm →
unyank, nothing was ever broken. *Status:* 🔨 S4.

**UC-22 · The 2am backport.** Fix must reach stragglers pinned on
`1.4.x` while HEAD is deep in 2.x: restore HEAD to `1.4.2`'s changeId
(pinned users see nothing — production never reads HEAD), apply fix,
publish `1.4.3`, restore HEAD back; then one-line manifest bumps and
batched pin bumps, advisory id in every seal message. *Accept:* the
whole detour is visible in `_history`; diff between `1.4.2` and
`1.4.3` is exactly the fix. *Status:* 🔨 S1+S4 (uses only existing
primitives plus publish).

**UC-23 · Quarantine.** A version is confirmed malicious. Realm owner
(only) quarantines it: serve answers `451` + advisory, the number is
tombstoned forever, and everything still referencing it breaks
*visibly* — the correct outcome for malware. *Accept:* publisher-tier
Seat gets 403 on the quarantine endpoint; no unquarantine route
exists. *Status:* 🔨 S4.

---

## How to use this ladder

- **As a demo script:** Tiers 1→3 in order is the "vibe code to
  thousands of users in one realm" story told with working software;
  Tier 7's UC-21/22 is the strongest closer.
- **As the acceptance matrix:** each build slice is done when its ✅/🔨
  cells flip — S1 = UC-4, 5, 22(publish half); S2 = UC-8(gate), 12;
  S3 = UC-3, 8(migrate), 9; S4 = UC-20, 21, 22, 23.
- **As a boundary marker:** everything 📐 (Tiers 5–6 + shim reconciler)
  is deliberately behind the Phase 00 cross-origin re-export probe and
  the multi-realm promotion design — no 📐 case blocks any 🔨 case.
