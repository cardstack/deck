# Skill: Publishing a Boxel Package Version (for AI agents)

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Status (updated 2026-08-10): **partially superseded** for stable Versions by
[`deck-version-is-a-proposal.md`](deck-version-is-a-proposal.md) — cutting a
stable Version is propose → review → accept, not a one-shot
`POST …/publish`. Keep this skill for the at-rest verbs and agent honesty
rules; treat one-shot stable publish steps as the old world. Prerelease /
`dev` auto-publish is unchanged.

The at-rest endpoints (publish, dist-tags, versioned serving) are BUILT — see
`deck-at-rest.md`. The migration steps (3, 5, 7) describe DEFERRED gate
features; today a breaking publish is not blocked, so the honesty rules below
carry the full weight. As built, the manifest is `importmap.json`
(`boxel.packages[<name>].version`), not a `package.json`.

Audience: an AI agent (Claude Code via boxel CLI, or any REST-capable
agent) asked to ship a change to a Boxel package that live users depend
on. Companion: `deck-semver-migration-spec.md` (the rules this skill
follows), `deck-software-lifecycle.md` (the why).

The skill's contract: **you may vibe-code freely; you may never surprise a
pinned user.** Every step below is either reversible or gated.

---

## Step 0 — Orient

- `GET <realm>/_packages/<name>` → current versions, dist-tags, where
  `latest` points.
- `GET <realm>/_history` → recent live-tree activity (are you mid-someone-
  else's-edit-session? Park if so — dual-editor write wars are real).
- Identify the version authority: in a production realm, read the AppDef
  manifest / generated shim (`packages/<name>.gts`) — that one line is
  where the fleet's version lives. Documents are version-free.
- Identify the fleet: search the index for instances adopting the shim
  path. Also query for **exception pins** (`adoptsFrom.module` matching
  `@<name>@`) — those docs have deliberately opted out of manifest
  upgrades and are excluded from your migration unless explicitly
  included. Fleet size = blast radius; exception count = docs to report,
  not touch.

## Step 1 — Edit live (the fork that isn't a branch)

Edit the `.gts`/card files in the live tree normally. The jj sidecar
captures every save; pinned instances resolve through immutable bookmarks
and cannot see your edits. Your own workbench instances (relative
`adoptsFrom`) render your work in progress. No branch, no fork, no fear.

## Step 2 — Classify the change (be honest; the gate checks anyway)

- Pure addition / fix, old documents load unchanged → **minor / patch**.
- Any field removed, renamed, retyped, or reinterpreted; any change where
  an existing document would render wrong or fail schema → **major**, or
  minor/patch with `breaking: true`. When unsure, treat as breaking — an
  identity-plus-touch-up migration is cheap; a broken fleet is not.

## Step 3 — If breaking: write the migration BEFORE the publish attempt

1. Author the program — usually by graduating the TransformCards you
   already used in dev (a migration IS a TransformCard exported into
   the package; same artifact). Write `migrations/<from>-to-<to>.bxl`
   against the **loaded card shape** (BXL lowers to source JSON:API for you — never hand-edit
   `meta.fields` or relationship indexes):

   ```bxl
   Members = Staff;
   del(Staff);
   Shifts[].role = "member";
   ```

2. Author fixtures — this is the important part:
   - Pull **real** documents: for each distinct shape in the fleet
     (empty board, dense board, one with every optional field, one with
     none), fetch the instance JSON and save as
     `fixtures/<case>.before.json` (strip nothing).
   - Hand-write (or generate then hand-verify) each `*.after.json`.
   - Minimum: one fixture per distinct fleet shape you found in Step 0,
     plus an empty/minimal document. The gate refuses zero fixtures; you
     should refuse fewer than the fleet's real variety.
3. Write `migrations.json` (entry: `from` range covering the previous
   line, `to` = new version, `engine: "bxl"`, program + fixtures paths).
4. Local check before publishing: run the fixtures through the evaluator
   (`bxl` CLI or the realm's dry-run once published as prerelease).

## Step 4 — Publish a prerelease

```
POST <realm>/_packages/<name>/publish   { "version": "2.0.0-beta.1", "tag": "next" }
```

The gate runs the full pipeline (§2 of the spec) including compile-freeze
and fixture verification. A breaking prerelease without its migration
publishes with a WARNING, not a refusal (betas are opt-in; nothing
downstream can be hurt yet) — but bundle the migration as early as you
can, because Step 5's dry-run needs it. The hard refusal waits at the
stable publish. **A gate refusal is information, not an obstacle** — read the structured error, fix the migration or fixtures,
bump to `-beta.2`, retry. Never work around the gate; it is the safety
property.

## Step 5 — Test with pinned prerelease instances

Point a small set of *test* instances (yours, not users') at the beta
using the per-instance escape hatch, via one `_history/commit` batch:

```
adoptsFrom.module: "@<name>@2.0.0-beta.1/<card>"
```

(Exact-version `adoptsFrom` is legal on any document — it opts that doc
out of manifest control until removed. Test docs and canaries are its
main legitimate use.)

Render them, exercise them, run the single-doc dry-run against real user
documents **without writing anything**:

```
GET <user-instance-url>?migrate-to=@<name>@2.0.0-beta.1
```

Eyeball / snapshot-compare the transformed output for the riskiest real
documents. If a real doc transforms badly: it's a missing fixture — add
it as a `before/after` pair, fix the program, `-beta.2`.

## Step 6 — Publish stable, move `latest`

```
POST <realm>/_packages/<name>/publish     { "version": "2.0.0" }
POST <realm>/_packages/<name>/dist-tags   { "tag": "latest", "version": "2.0.0" }
```

This is where the gate hard-refuses a breaking release whose migration
or fixtures are missing or failing — fix, don't bypass. Nothing has
happened to any user yet — they're behind the manifest. `latest` moving
only affects new instance creation and range-followers at their next
resolution.

## Step 7 — Upgrade the fleet: plan → canary → flip manifest → migrate data

If the release is **non-breaking**: rewrite the manifest/shim line
(`@<name>@2.0.0` → `@<name>@2.1.0`) and you are DONE — zero documents
are touched. This is the payoff of manifest-owned versioning; do not
invent extra steps.

If **breaking**:

1. **Plan**: `POST _migrate/plan {package, toVersion: "2.0.0"}` — the
   fleet's from-version comes from the manifest's current resolution.
   Returns fleet size, chain (should be one hop), exception-pinned docs
   (excluded), and a plan hash. If the chain is >1 hop or any doc is
   unclassifiable, stop and escalate to the human.
2. **Canary**: give 5-10 docs (or ~5%) exception pins to `2.0.0` and
   migrate their data in ONE sealed jj change ("migrate: gym-board 1.x →
   2.0.0 (canary, 8 docs)"). Verify: docs render, index shows no errors
   (`realm indexing-errors` empty), audit log entry present.
3. **Soak** if humans are actively using the canaried docs; otherwise
   proceed.
4. **Migrate the data, pinning as you go**: `_migrate/apply` in batches;
   each batch's seal writes BOTH the transformed attributes and an
   exception pin to `2.0.0` in the same documents (the pin rides free in
   the write the transform already makes). At every instant every doc is
   self-consistent: un-migrated = old manifest + old data; migrated =
   pinned new + new data. Skipped docs simply stay on the old manifest
   version (they keep working) and are reported — every skip needs a
   human decision or a fixture-driven program fix, never a force.
5. **Flip the manifest and clear pins**: when the fleet (minus
   escalations) is migrated, rewrite the shim to `2.0.0` and drop the
   now-redundant exception pins in one final sealed change. Escalated
   stragglers get pins to the OLD version at this point so the flip
   cannot break them.

This ordering — migrate-with-pins first, flip last — is the default
because no document is ever served by code it doesn't match. Only for
trivially small fleets (where the whole migration is one batch) is
flip-then-migrate acceptable, and the plan output must say so
explicitly.

## Step 8 — Verify and report

- Fleet query from Step 0 again: pinned-version histogram should show the
  new version; stragglers should equal the escalation list exactly.
- `GET <realm>/_history` shows the migration seals with your actor.
- Report to the user: versions published, fleet counts before/after,
  canary result, escalations (if any), and the rollback handle (the
  changeId *before* the first migration batch).

## Rollback (any point after Step 7)

`_history/restore` to the pre-migration changeId (restore replays through
the write path and seals a NEW change — history stays append-only), then
move `latest` back via `RollbackDistTag` if needed. Rollback is the same
machinery as the gym-board restore button; nothing bespoke.

## Emergency: a shipped version has a security problem

Escalate in this order; each step is reversible except the last (spec
§6 has the full semantics):

1. **Advisory first** — `POST _packages/<name>/advisories` with an OSV
   document naming the affected range. Costs nothing, breaks nothing,
   and makes exposure queryable: run the index query for manifest/shim
   resolutions and exception pins falling in the range, and report the
   census.
2. **Yank the bad version** — `POST .../yank {version, reason,
   fallback}`. Ranges and dist-tags stop resolving to it (name the
   fallback for any dist-tag pointing at it); every exact reference
   keeps working with a warning. If it turns out to be a false alarm,
   `unyank` — do not hesitate to yank while investigating.
3. **Publish the fix** — patch the current line, and backport a patch
   to every line that has exposed exact references (`1.4.3` for the
   `1.4.x` stragglers). Patches carry no migration requirement, so the
   gate is fast. There is no gate bypass; do not look for one.
4. **Remediate fleets** — owned realms: one shim-line bump each;
   exception-pinned docs: batched pin bumps (`1.4.2`→`1.4.3`) via
   `_history/commit` with an actor and the advisory id in the message.
   Realms you don't own: their operators act on the advisory, or
   protect themselves with consumer-side exclusion policy
   (`exclude`/`substitute` in their AppDef) without waiting for anyone.
5. **Quarantine only for confirmed malware** — realm-owner capability,
   not yours unless you hold that Seat. It stops serving the bytes
   (451 + advisory), burns the version number forever, and *visibly
   breaks* anything still referencing it — which for malware is the
   correct outcome. Never quarantine for a mere bug; that's what steps
   1–4 are for.

## Dev-only realms: none of the above

In a development/vibe-coding realm there is no manifest, no gate, no
fleet: instances point at the live tree (relative `adoptsFrom`) or
`@latest`, and when you change a schema you migrate your own instances
as you go with a **TransformCard** — a card holding a BXL program you
apply ad hoc (ungated `_migrate/apply`; still sealed and restorable).
Keep the TransformCards: publishing exports them as the package's
`migrations/*.bxl` — same artifact, graduated — and the docs you tested
them on become the fixtures the gate demands. The ceremony above exists to protect *other people's
documents*; when all the documents are yours, the jj sidecar alone is
enough safety.

## Hard rules (memorize)

1. Never publish a stable breaking version without fixtures drawn from
   real fleet documents.
2. Never edit a published version; publish the next one.
3. Never migrate without a plan and a canary batch first.
4. Never bypass a gate refusal; fix the cause.
5. Never touch instances you don't own before Step 7, and then only via
   `_migrate/apply` (audited, restorable) — no direct writes to user docs.
6. When unsure whether a change is breaking, it is.
