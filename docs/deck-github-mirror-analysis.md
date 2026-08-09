# Deck ↔ GitHub: mirror shape, provenance, and intake

**Status: RULING + IMPLEMENTATION GUIDE** (updated 2026-08-09).  
**Built in this repo: no.** Design only — see §9 for the next agent.

Companions: `deck-depot-and-realm-backport.md`, `deck-laws.md` (L1/L3/L4),
`deck-step-version-vocabulary.md`, `deck-competitive-gaps.md` (G23),
`deck-catalog-consumption-modes.md`, `packages/core/src/merge.ts` (3-way).

Original decisions: Chris, 2026-08-07 (one-way mirror). Extended 2026-08-09
with store-vs-Timeline clarity, monorepo confirmation, provenance carriers,
and a **deterministic merge-back** path when a GitHub repo is allowed to be
read/write — still **without AI**.

---

## 0. Where things live (do not confuse these)

| Deck concept | Where bytes / names live | GitHub? |
| --- | --- | --- |
| **Version** (immutable cut, `@1.2.3`) | `.deck/store/` — `meta.json` → `treeHash` + CAS blobs | Projected as annotated tag + tree on `main` |
| **Dist-tag** (`latest`, `dev`) | store `meta.json` `tags` | Projected as moving branch |
| **Timeline Step** (every save) | `.jj` (Git-compatible under the hood) | Optional `history` branch |
| **Live tree** | depot working directories `publisher/package/…` | Tree inside the monorepo |

**Versions are not stored in jj/git.** The store is the npm+unpkg half.
jj is optional Timeline only. A depot can publish forever with
`History: Versions` and no `.jj` at all.

**GitHub is never the registry.** At best it is a projection (mirror) or
a contribution inbox (intake → new Version). L4 still holds: an exported
tag must not be rewritten when Deck yanks/quarantines — see §1.3.

---

## 1. Decisions (confirmed)

### 1.1 Shape — monorepo per depot (not one-to-one packages)

> **One GitHub repository ↔ one depot.**

Closest to depot structure: same `publisher/package/…` paths, one commit
can touch several decks, forks and catalog events stay atomic.

| Option | Use? |
| --- | --- |
| **Monorepo = depot** | **v1 — yes** |
| One git repo per package | Later optional bot-split (K8s staging); not v1 |
| Monorepo = whole Deck server (many depots) | No — depot is the unit |

Tag convention: annotated `publisher/package@version` or, when publisher
is implied by path, `package@version` — **pick one per mirror and stick
to it.** Prefer `publisher/package@version` for catalogs with many authors.

### 1.2 Fidelity — curated `main` + optional `history`

- **`main`:** one commit per *semantic* event (publish, yank, quarantine,
  migration batch, …). Deterministic rebuild from depot events.
- **`history`:** raw Timeline (colocated jj/git) pushed as-is. Opt-in for
  “share an app”; on for catalog if you want every Step public.
- Readers choose; nothing authoritative lives only on GitHub.

### 1.3 Quarantine / yank

Tombstone commit on `main`; Version tag **stays** (points at burned or
yank-noted tree). Enforcement of “do not serve” is the **depot** (e.g.
451), not deleting git history.

### 1.4 Authorship

Display name + synthetic email `user@<depot-host>`; `Actor:` trailer for
reversibility. No real Matrix IDs or personal emails required on GitHub.

### 1.5 Policy split — authority vs contribution

| Role | GitHub mode | PRs |
| --- | --- | --- |
| **Catalog / authority depot** | **Read-only mirror** | Auto-close; point at depot |
| **App / contributor fork** | Read/write allowed | Intake pipeline (§6) → publish or offer |

Prior art for RO mirrors: Go (googlesource truth / GitHub mirror),
Kubernetes staging bots.

---

## 2. Repository layout (projection of the depot)

```
<depot-mirror>/
  .deck-mirror.json           # provenance cursor (required)
  README.md                   # authority URL + RO/RW policy
  <publisher>/<package>/      # same as live deck roots
    …source…
    importmap.json
  _registry/                  # optional: advisories, PackageVersion records
  _catalog/                   # optional: depot-level infra (Boxel catalogs)
```

Standalone Deck may omit `_registry` / `_catalog` until those exist; the
**minimum** mirror is `.deck-mirror.json` + `publisher/package` trees +
tags for Versions.

### 2.1 Refs

| Deck | Git ref |
| --- | --- |
| Version `@1.2.3` | annotated tag `publisher/package@1.2.3` |
| Dist-tag `latest` / `dev` | branch `latest` / `dev` (or `tags/latest` — choose one scheme) |
| Timeline Steps | branch `history` (optional) |
| Semantic export tip | branch `main` |

Identity for merges and audit is **`treeHash`**, not `git rev-parse`.
Git commit hashes need not round-trip; Version tags must name the same
tree bytes the store has.

---

## 3. Provenance (carry on every export)

### 3.1 Root manifest — `.deck-mirror.json`

```json
{
  "spec": "deck-mirror-v1",
  "depot": "https://catalog.example/site",
  "layout": "publisher/package",
  "authority": "depot",
  "policy": "read-only",
  "tagScheme": "publisher/package@version",
  "lastExport": {
    "at": "2026-08-09T12:00:00.000Z",
    "changeId": "optional-jj-id",
    "versions": ["acme/palette@1.4.0"]
  }
}
```

`policy`: `read-only` | `intake` (allows §6).

### 3.2 Commit / tag trailers (mechanical)

```
treeHash: <64 hex>
Deck-Version: publisher/package@1.2.3
Base-Version: publisher/package@1.2.0
Change-Id: <jj change id when Timeline on>
Actor: <actor id>
```

- **`treeHash`:** L1 identity of that package tree (required on Version tags).  
- **`Base-Version`:** parent cut when exporting a tip that will accept
  GitHub PRs (required for intake repos).  
- **`Change-Id`:** Step linkage when Timeline exists; omit if Versions-only.

Tag message body may repeat the same fields for humans browsing Releases.

---

## 4. Semantic mapping (export)

| Depot semantic | GitHub carrier |
| --- | --- |
| Continuous Steps + actors | `history` branch |
| Step id | `Change-Id:` trailer |
| Immutable Version | annotated tag + tree on `main` |
| Dist-tag move | force-with-lease update of tag branch |
| Publish | curated `main` commit + tag |
| Yank / quarantine | tombstone commit; tag retained |
| Restore (Timeline) | ordinary commit on `history` (+ `main` if it was also a publish) |

---

## 5. Export bot (Deck → GitHub)

Pure function of depot events → git updates. No LLM.

1. Read new publishes / tag moves / (optional) Steps since
   `.deck-mirror.json` cursor.  
2. For each Version: write `publisher/package/` tree from store
   (or live-at-seal), commit on `main`, create annotated tag with
   trailers.  
3. Update dist-tag branches.  
4. Optionally push `history`.  
5. Advance cursor; push with deploy key.

**Determinism:** same event stream → same trees and tag names. Prefer
fixed committer (`deck-mirror-bot@…`) and event timestamp as author date
if you need reproducible commit hashes; **treeHash is enough** for Deck
correctness.

**RO enforcement:** branch protection, bot-only push, Action that closes
PRs with a link to the depot, README banner.

---

## 5b. Share / gather — cast from legacy boxel-cli

Legacy **boxel-cli** (standalone, not monorepo) already named the human
promise: *share what you are working on via GitHub; gather it back.*
Deck should **keep the verbs**. The implementation must not keep the
failure mode.

### 5b.0 Take — what Deck enables (and what it does not)

**Short version:** Deck makes share/gather *correct and cheap to trust*.
It does **not** by itself make share/gather *social or automatic*. The
hard part of the legacy CLI was never the `gh pr create` chrome — it was
that the bytes moved without a merge base. Deck already has the pieces
that fix that. The GitHub handshake is still work we have not built.

#### Where the system actually helps

| Idea behind share/gather | Deck today | Verdict |
| --- | --- | --- |
| “Server is SoT; git is a side channel” | Depot + store are SoT by law; GitHub is explicitly not the registry (§0) | **Enabled** — this is the whole point of the design |
| Share *WIP anytime*, not only a release | Live tree is first-class; Versions optional; Timeline optional | **Enabled in model** — tip can be `live` with `Base-Version` = last publish |
| Bring work back without clobbering | `mergeTrees` + `treeHash` already in Core | **Enabled in model** — gather is “run the merge,” not “copy files” |
| Know what you are merging against | Store holds immutable `@x.y.z`; `?meta` exposes digests (incl. live) | **Enabled** — Base-Version is a real object, not a milestone nickname |
| Package-scoped move (not whole realm dump) | Addressing is already `publisher/package` | **Enabled** — monorepo mirror matches the unit people share |
| Don’t invent a second history for collab | jj/Timeline ≠ Versions; share branches are disposable | **Enabled** — we finally have vocabulary legacy lacked |
| Teammate sees your intent while you work | Claims (`deck claim`) on paths | **Partially** — coordination inside a depot, not a substitute for a PR |
| Review / comment / CI social graph | None in Deck Core | **Not really** — still GitHub’s job (or a future Boxel CR) |
| One command that “just shares” with no repo setup | No mirror, no `deck share` yet | **Not built** — design only |
| Catalog as GitHub replacement for *discovery* | Catalog modes are a different track | **Not this feature** — share/gather assumes an existing GitHub workflow on purpose |

#### Opinion (why this framing)

Legacy share/gather *felt* like collaboration but behaved like **USB stick
over git**: copy out, copy in, hope. Deck’s contribution is not a prettier
USB stick. It is that **every share carries a mechanical base**
(`Base-Version` / `treeHash`) and every gather is the **same 3-way** the
rest of the protocol already believes in. That is the only reason keeping
the verbs is honest.

What Deck does *not* magically enable:

1. **Presence of a team.** If nobody looks at the PR, share did nothing
   social. Claims and Hub heat help *inside* a depot; they do not notify
   a GitHub reviewer.  
2. **Authority without discipline.** A gather that writes live is still a
   write. Provenance stops silent lies; it does not stop a human from
   gathering junk. Policy (`read-only` vs `intake`) and verify-links are
   the brakes.  
3. **“GitHub is optional” for this path.** Realm-native change requests
   (Boxel triage) are a *different* product. This doc’s share/gather
   **leans into** GitHub on purpose — for teams that already live there.
   Pretending Deck Hub replaces that tomorrow would reintroduce the
   awkward split under a new name.  
4. **Mirror bots ≠ share.** Exporting `@latest` to `main` is projection.
   Share is “here is my tip, please look.” Collapsing them again is how
   you get force-pushes to `main` and confused tags.

So: **Deck enables the *integrity* of share/gather; GitHub (still)
enables the *ceremony*.** Ship the integrity first (export + share
trailers + gather/`mergeTrees`). Do not claim the ceremony is solved
until `deck share` / `deck gather` exist and an intake repo has been
used by a real second human.

#### Offers vs install vs GitHub PRs (do not conflate)

These are three different ideas that share English words:

| Concept | Doc / surface | What it is | Relation to a GitHub PR |
| --- | --- | --- | --- |
| **Offer** (`deck fork` / rebase) | in-motion §3.3; CLI **propose** | A fork that records `forkedFrom` (package + Version + treeHash). Runnable before accept. Rebase daemon keeps it merged **inside one depot**. | **Native PR substitute on one server.** Same job (propose change against a base); better in one way — you run the result, not a patch description. |
| **Install** (and use / import / …) | `deck-catalog-consumption-modes.md` (K5) | How a *consumer* pins or shims a catalog package into their app. Not a change proposal. | **None.** Install is adoption, not review. |
| **GitHub PR** via share/gather | this doc §5b / §6 | Outbox/inbox when the other party is **outside** the depot (another machine, community, legacy git workflow). | **Bridge for the gap in-motion §3.7 names:** between-servers offer/accept is not built. Until a signature-as-catalog-admission exists across depots, gather→publish (or gather→live) is how a foreign tip becomes an offer-shaped fact again. |

Pipeline when GitHub is involved:

```text
their tip on GitHub
    → deck gather (mergeTrees + Base-Version)
    → live and/or publish
    → (same depot) that cut can be an offer / fork against upstream
    → rebase daemon / accept = pointer move — the in-motion path
```

Or the inverse for vendored upstream identity
(`deck-vendor-source-mode.md`): a Deck edit against a byte-identical
vendored tree is already a PR-shaped diff; `deck offer --to github`
(not built) is share with the base commit lined up.

**Do not** teach “install” as the PR path. **Do not** teach GitHub PRs
as replacing offers inside one depot — use `fork`/`rebase` there.
**Do** teach share/gather as the temporary *inter-depot* carriage for
the same provenance offers already use (`treeHash` + base Version).

### 5b.1 What legacy actually did

| Verb | Mechanism | Authority after |
| --- | --- | --- |
| `boxel share` | Copy workspace (or a **milestone** from `.boxel-history/`) into a **local git clone**, wipe dest (with a preserve list), commit, force-push branch, optional `gh pr create` | Still Boxel server — share never publishes |
| `boxel gather` | Checkout branch in local clone, copy files into workspace (skip `.realm.json` / sync manifest), optional checkpoint | Still local until `boxel sync --prefer-local` |

Two git models were intentional (and correct):

1. **`.boxel-history/`** — local undo only (Deck: Timeline / jj Steps).  
2. **GitHub share/gather** — team collaboration layer (Deck: this doc).

Source of truth stayed the **server**, not git. That ruling carries over
unchanged: depot / catalog is authority; GitHub is projection or inbox.

### 5b.2 Why it was hard to use (keep these as anti-goals)

From the code (`boxel-cli/src/commands/{share,gather}.ts`) and triage notes:

1. **Copy-overwrite, not merge** — share cleans the dest tree; gather
   overwrites the workspace. No 3-way; last writer wins silently.  
2. **No Base-Version / treeHash** — PR body is a milestone name + file
   count; nothing mechanical to re-apply later.  
3. **Requires a local clone** (`-t` / `-s` paths) — auth, subfolder
   heuristics from workspace URL, and GitHub Desktop as the real push
   path for many users.  
4. **Two-step gather** — gather then remember `sync --prefer-local`;
   easy to leave changes only on disk.  
5. **Force-push feature branches** — `git push --force` after reset to
   default branch.  
6. **Coarse unit** — whole workspace; no package-scoped share, no
   conflict list, limited URL portability (index/cards-grid only).  
7. **Milestone coupling** — “share what I’m working on” defaulted toward
   latest milestone, not *any tip at any time*.

Keep the **promise** (anytime collaboration over existing GitHub PR
workflow). Replace the **transport** with Deck’s merge + provenance.

### 5b.3 Verb cast (keep names)

| Legacy | Deck CLI (Tools) | Meaning |
| --- | --- | --- |
| `boxel share` | **`deck share`** | Project a cut of a deck onto a GitHub feature branch (collaboration outbox) |
| `boxel gather` | **`deck gather`** | Bring a GitHub branch/PR into the depot via **`mergeTrees`** (inbox) |
| (export bot) | `deck mirror push` | Curated RO/authority projection of **Versions** (not WIP) |
| (intake CI) | `deck mirror check-pr` | Automated gather→publish path for `policy: intake` |

`share` / `gather` are the **human anytime** surface. `mirror *` is the
**bot / catalog** surface. Same provenance carriers (§3); different
triggers.

### 5b.4 Anytime share (WIP allowed)

You can share **without** publishing a Version:

```text
deck share <publisher/package> \
  --repo org/depot-mirror \
  --branch share/<actor>/<slug> \
  [--from live | --version x.y.z | --step <change-id>] \
  [--pr]
```

Rules:

1. **Unit is a deck path** (`publisher/package`), not a whole workspace
   guess. Multi-package: repeat or `--paths a,b`. Monorepo layout matches
   depot (§1.1).  
2. **Always stamp provenance** on the share commit (trailers + optional
   `.deck-share.json` under the package or repo root for the PR):

   ```
   treeHash: <live or chosen cut>
   Base-Version: publisher/package@x.y.z   # last published under tip
   Deck-Tip: live | @x.y.z | step:<id>
   Actor: <who>
   ```

   If there is **no** prior Version, `Base-Version` may be omitted only
   when `Base-treeHash` of an empty/base tree is recorded instead —
   gather still has a mechanical base.  
3. **Do not wipe** unrelated packages. Write only granted paths. Preserve
   `.deck-mirror.json`, `README`, `.github`, lockfiles at repo root.  
4. **Push** with `--force-with-lease` on the share branch only — never
   force `main` / Version tags.  
5. **PR body** must repeat `Base-Version` + `treeHash` (template); humans
   can still read the story, CI reads the trailers.  
6. Share is **not** a publish. Dist-tags and `@exact` URLs do not move.

This is the “share with teammates / community anytime” path — same social
shape as legacy, with a base cut that gather can trust.

### 5b.5 Gather (two landings, one merge)

```text
deck gather <publisher/package> \
  --repo org/depot-mirror \
  --branch share/…   # or --pr 123 \
  --into live | publish \
  [--onto latest | --onto @x.y.z]
```

| `--into` | Effect |
| --- | --- |
| **`live`** (default for humans) | `mergeTrees(base, ours=PR, theirs=current live)` → write working tree; optional Timeline Step; **claim** may be refreshed/cleared by actor |
| **`publish`** | Same merge, then verify-links → `publishToStore` (new Version). Same as §6 intake success path |

Never: copy-overwrite live; never: move an existing Version tag; never:
`git merge` as identity.

**Conflict:** fail with path list (same as §6.3). Fix on the branch or in
live, re-gather. No AI required for acceptance.

**After gather into live:** there is no separate `sync --prefer-local`.
The depot *is* the working tree + store. If Hub/watchers are up, they see
live immediately.

### 5b.6 Mapping to Boxel / catalog product later

- Catalog authority depot: **`mirror push` only** (`policy: read-only`);
  `share`/`gather` against **forks** or app depots with `policy: intake`.  
- Realm-native change-requests (triage: collaboration *without* GitHub)
  are a **Boxel** product layer on top of the same merge/provenance —
  out of scope for standalone Deck v1, but gather’s merge result is what
  those CRs would apply.  
- Do not revive whole-workspace copy as the collaboration model.

### 5b.7 Acceptance extras (share/gather)

- Share from dirty live with no new Version → branch has `Deck-Tip: live`
  + `Base-Version` of previous `@latest`.  
- Gather that branch after local live moved → clean auto-merge or listed
  conflicts; never silent overwrite.  
- Gather `--into publish` refuses if verify-links fails.  
- Share cannot update `main` or annotated Version tags.  
- Actor without grant on `publisher/package` is refused.

---

## 6. Intake (GitHub → Deck) — safe merge-back without AI

Use only when `policy: intake`. **Never** fast-forward git into live or
move a Version tag because GitHub moved.

**Human path:** `deck gather --into publish` (§5b).  
**Bot path:** merge of PR to default branch → same checks → publish.
Both are gather; CI is gather without a laptop.

### 6.1 Law

> Git proposes bytes. Deck accepts only via **treeHash → verify →
> publish or offer**. `git merge` is not the merge algorithm of record;
> `mergeTrees` / offer rebase is.

### 6.2 PR requirements (CI fails closed)

1. **Base declared:** `Base-Version: publisher/package@x.y.z` (PR
   template or commit trailer).  
2. Diff confined to allowed `publisher/package/` paths.  
3. For each touched package:  
   - `ours` = treeHash of PR tree at that path  
   - `base` = treeHash of `Base-Version` from the **depot store**  
   - `theirs` = treeHash of current `onto` (default: depot `latest` or
     declared target)  
   - Run **`mergeTrees(base, ours, theirs)`** (see
     `packages/core/src/merge.ts`). Conflicts → **CI fail** with paths.  
4. On clean merge result: `verify-links` / lock check (L6/L11).  
5. Green → bot **`deck publish`** (new Version) or open an **offer** in
   the depot; record origin:

```json
{
  "github": { "repo": "org/name", "pr": 123, "commit": "abc…" },
  "baseVersion": "acme/palette@1.4.0",
  "treeHash": "…"
}
```

6. Export bot mirrors the new Version back out (append-only).

### 6.3 Human conflict resolution

Conflicts stay on GitHub: author pushes fixes → CI re-runs. No AI in the
loop. Optional later: surface the same conflict list in Hub; still the
same mergeTrees result.

### 6.4 Refuses

- Missing `Base-Version`  
- Base Version not in depot store  
- Paths outside grant  
- Lock/verify failure  
- Attempt to rewrite an existing Version tag  

---

## 7. Catalog layout note (Boxel)

When the depot is a Boxel catalog, canonicalize to
`publisher/package` (no hash-prefixed roots). Mirror publishes what the
depot is; fix layout in the depot first so GitHub does not fossilize
mess. Details retained from 2026-08-07 catalog cleanup notes:

- Publisher scope replaces hash prefixes  
- Infra under `_catalog/` or `_registry/`  
- Gate refuses layout regressions on publish  

---

## 8. Status vs gaps

| Piece | Status |
| --- | --- |
| Store Versions + dist-tags | **Built** |
| Timeline via jj | **Built** (optional) |
| npm/CDN vendor into store | **Built** (not GitHub) |
| Deck → GitHub export bot | **Not built** (this doc) |
| `deck share` / `deck gather` | **Not built** (§5b; verbs kept) |
| GitHub → Deck intake | **Not built** (this doc; = gather publish) |
| Gap tracker | G23 in `deck-competitive-gaps.md` |

---

## 9. Guidelines for the next agent (implement this)

### 9.1 Scope order (do not skip)

1. **Export RO monorepo** for one example depot (e.g. `examples/vale-sale`
   or Hub’s `hub` depot) — tags + `.deck-mirror.json` + `main`.  
2. **CI Action** that closes PRs on `policy: read-only`.  
3. **`deck share`** (WIP → feature branch + trailers + optional PR) against
   an intake-policy fork — proves the anytime collaboration promise.  
4. **`deck gather --into live`** with `mergeTrees` + conflict paths.  
5. **Intake CI** / `gather --into publish`: Base-Version check +
   `mergeTrees` + verify-links → `publishToStore` + re-export.  
6. Only then: `history` branch push, GHSA, dist-tag branches polish.

Do **not** ship a copy-overwrite share/gather “to match boxel-cli.” If
share lands without Base-Version trailers, delete it and start over.

### 9.2 Code placement (standalone Deck)

Prefer **Tools**, not Core serve path:

| Piece | Suggested home |
| --- | --- |
| Event → git commit/tag | `packages/cli` command `deck mirror push` or `packages/mirror/` |
| Anytime collaboration | `deck share` / `deck gather` in `packages/cli` (same lib as mirror) |
| Intake check | `deck mirror check-pr` (= gather `--into publish` dry-run) |
| GitHub Actions templates | `examples/mirror/` or `tools/mirror/` |

Core already has: `treeHashFromDir`, `publishToStore`, `mergeTrees`,
`readStoreMeta`. **Do not** put GitHub tokens or `git push` inside
`@cardstack/deck-server` request handlers.

Reuse legacy UX flags where they still help (`--branch`, `--pr` /
`--no-pr`, `--dry-run`). Drop: required local-clone-only mode as the
primary path (prefer `gh` + remote URL); drop silent dest wipe; drop
milestone-as-default without an explicit `--from`.

### 9.3 Acceptance tests (mechanical)

- Rebuild export twice from same store cursor → same tag names + same
  `treeHash` trailers (commit hash may differ).  
- RO repo: opened PR is closed by bot within one Action run.  
- Intake: PR without `Base-Version` fails.  
- Intake: conflicting edit on same file vs `onto` fails with path list.  
- Intake: clean PR publishes new Version; old Version tag unchanged;  
  `@exact` URL serves new treeHash.  
- Depot with **no** `.jj` still exports Versions (Timeline optional).

### 9.4 Non-goals for v1

- One GitHub repo per package  
- AI conflict resolution or AI release notes as authority  
- Using git merge result as Version identity without treeHash  
- Mirroring `.deck/store` object dirs as the primary GitHub tree (export
  **package source trees** + tags; CAS can stay depot-local)

### 9.5 LOE (order-of-magnitude)

| Slice | Effort |
| --- | --- |
| RO export + manifest + tag scheme | ~2–3 days |
| PR closer + README policy | ~0.5 day |
| Intake CI (`mergeTrees` + verify) | ~2–3 days |
| Publish-from-intake + re-export | ~1–2 days |
| Optional `history` push | ~0.5–1 day |

---

## 10. Summary

- **Monorepo per depot** matches depot layout; Versions stay in
  `.deck/store`; jj is Timeline only.  
- **Catalog mirrors are read-only**; contribution uses **intake** repos
  with declared `Base-Version` and Deck’s 3-way merge — deterministic,
  no AI.  
- **Provenance** is `treeHash` + Version + optional Change-Id on every
  tag/commit, plus `.deck-mirror.json`.  
- **Keep legacy verbs `share` / `gather`** for anytime GitHub
  collaboration; replace copy-overwrite with Base-Version +
  `mergeTrees`. Mirror bots are the catalog path; share/gather are the
  human path over the same laws.  
- **Take (§5b.0):** Deck enables the *integrity* of share/gather (SoT,
  live tip, treeHash, mergeTrees); it does *not* yet provide the
  *ceremony* (CLI + GitHub social). Do not conflate mirror export with
  WIP share.  
- **Next agent:** export → share → gather-live → gather-publish/intake
  CI (§9.1) — do not teach GitHub as the registry.
