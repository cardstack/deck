# The Boxel Software Lifecycle: from playing around to thousands of live users

Status (updated 2026-08-07): the at-rest half of this story (Stages
A–D: play, name, test, release) is BUILT — see
`deck-at-rest-protocol.md`. Stage E's migration machinery and the
manifest/shim layer are deferred design; today documents move by
direct edits or agent batches.

Companion to `deck-semver-migration-spec.md` and `deck-publishing-skill.md`.
Written 2026-08-07.

## Part 1 — One realm, whole lifecycle

The claim: a single realm can carry a card from idle experimentation to a
deployed dependency of thousands of user documents, and back through
breaking changes, without a staging environment, a CI system, a database
migration framework, or a deploy pipeline — because the realm server
already *is* those systems, and the version pin is the isolation boundary.

**Stage A — Play.** You (or your agent) edit `gym-shift-board.gts` in the
live tree. The jj sidecar seals every save; nothing is published; your
workbench instances (relative `adoptsFrom`) track HEAD and re-render as
you type. Users' instances resolve through the app manifest's generated
shim — one line pointing at `@gym-board@1.4.2/...`, an immutable
bookmark — so they *cannot* observe your edits. This is the vibe-coding
guarantee: **the live tree is your scratchpad even in production**,
because production never reads HEAD. There is no "oops I saved and broke
prod" — saving is not shipping.

(In a dev-only realm even the manifest disappears: everything tracks
HEAD or `@latest`, and you migrate your own instances as you go with
TransformCards — ad-hoc BXL transforms, sealed and restorable but
ungated. Publishing later exports those same TransformCards as the
package's migrations — one artifact, graduated — and the fixtures the
gate demands are the docs you already tested them on.)

**Stage B — Name it.** Happy with a checkpoint? Publish `1.5.0-beta.1`.
Publishing seals nothing new — it names the changeId you already have
(git-tag semantics). A breaking beta without its migration publishes
with a warning, not a refusal — betas are opt-in, nothing downstream
can be hurt yet; the hard refusal waits at the stable release (Stage
D). The safety is *in the registry*, not in reviewer discipline.

**Stage C — Test against reality.** Point a handful of test instances at
the beta pin. Better: dry-run the migration against *actual user
documents* (`GET <doc>?migrate-to=...`) with zero writes. The most
dangerous moment of any release — "will real data survive the new
schema?" — becomes a read-only preview.

**Stage D — Release.** Publish `1.5.0` (or `2.0.0`), move `latest` —
this is where the gate hard-refuses a breaking release until a
fixture-proven migration rides along in the package. Still nothing has
changed for a single user — the manifest hasn't moved.

**Stage E — Upgrade deliberately.** Non-breaking: rewrite the manifest's
one shim line; the entire fleet is on `1.5.0` and **zero documents were
written**. Breaking: plan (fleet census + chain + hash), canary (a few
docs behind exception pins, one sealed change), migrate the data in
batches (each seal carries the transform plus a pin, so every doc always
matches its code), then flip the manifest and clear the pins. Every
batch is one jj seal with an actor and message — the audit log the gym
board renders *is* the deployment log. A bad batch is one restore away
from undone. Stragglers skip-and-escalate behind old-version pins;
nothing is forced.

**Stage F — Live with exceptions, not fleets of versions.** The steady
state is one version number per package per realm (the manifest), plus a
short, queryable list of exception-pinned documents — canaries mid-soak,
escalated stragglers, or docs a user deliberately froze. Pinned docs
keep working forever (immutable bookmarks); deprecate (a message, not a
removal) when you want them to converge. "Who is still on 1.x?" is an
index query for exception pins, not an archaeology project.

The whole loop uses five primitives, all already designed or built:
continuous jj capture, immutable version bookmarks, movable dist-tags,
BXL migrations frozen to jqxl at publish, and `_history/commit`-batched
fleet application with restore as rollback.

### What still deserves respect in the single-realm model

- **Blast radius is social, not technical.** The pin protects users from
  your *code*; it does not protect them from a mistaken `_migrate/apply`
  (that's what canary + restore are for) or from index-load of your churn.
- **One authorization domain.** Everyone with write on the realm can
  touch the live tree; capabilities gate publish/migrate, but the
  workbench is shared.
- **One performance domain.** A heavy migration or reindex shares
  resources with live traffic.

## Part 2 — Dev / staging / prod as three realms, same machinery

The multi-realm story is not a different system — it is the same
versioning, packaging, and migration substrate with **promotion**
(a submission workflow) layered on top. The unit that moves between
realms is the published version: an immutable tree addressed by
`@name@version`, identified by contentHash.

(With RRI harmonization, promotion gets lighter still: consumer shims
reference `@publisher/name@version/...` abstractly and VirtualNetwork
mappings pick the hosting realm per environment — so promotion changes
mappings, never consumer documents or shims.)

```
dev realm ──publish──▶ @pkg@2.0.0-beta.N     (gate runs here first)
     │
     └──submit──▶ staging realm  (copy tree + PackageVersion record;
                                  contentHash verified on ingest;
                                  gate re-runs — fixtures re-verified)
                        │  QA against staging fleet; dry-runs; canary
                        └──approve──▶ prod realm (same ingest, same hash;
                                      trust badge carries because the
                                      bytes are identical)
                                          │
                                          └── migrate prod fleet (plan →
                                              canary → batches, as ever)
```

What each layer adds over single-realm:

1. **Isolation of the workbench.** Dev realm HEAD-churn, experiments, and
   broken states never share an index, a jj repo, or a process budget
   with prod. Prod's live tree barely changes at all — its history is
   almost purely publishes and migrations, which makes its audit log
   *legible*.
2. **A real review gate.** Promotion is an authorization boundary with
   OpenFGA semantics: `SubmitForReview` on staging, `ApproveRelease` on
   prod are Seats held by different Parties. The submission workflow is
   an app-store shaped queue — and it's just cards: a Submission card in
   staging referencing the PackageVersion, with review state, rendered by
   ordinary card UI, mutating via the same REST endpoints.
3. **Independent gate re-execution.** Each realm re-runs the publish gate
   on ingest (compile-freeze artifacts must match byte-for-byte;
   fixtures must pass). A compromised or buggy dev realm cannot inject
   an unverified migration into prod — verification is local to the
   accepting realm, trust is in the contentHash + re-run, not in the
   sender.
4. **Environment-specific fleets, one migration author.** The same
   fixture-proven migration migrates staging's synthetic fleet first,
   then prod's real fleet. Staging's fleet *is* the extended fixture set
   — docs that fail there become new fixtures before prod ever sees the
   version.
5. **Graduated dist-tags.** `latest` in dev may race ahead; `latest` in
   prod moves only on approval. Same movable-bookmark mechanism, three
   independent copies — no new concepts.

Because the substrate is identical, the two models compose and
interconvert: a solo builder starts single-realm; the day they add a
teammate or a compliance requirement, they stand up a prod realm, promote
the current published version into it (hash-verified), and repoint users'
realm — the pins, migrations, and history semantics carry over unchanged.
Promotion is a *policy* upgrade, not a platform migration.

### The one-liner

Single realm: **saving is not shipping** (the pin separates them).
Three realms: **shipping is not approving** (promotion separates those) —
and both distinctions ride on the same five primitives.
