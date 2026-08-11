# A Version is a proposal, not a save

**Status: RULING** (2026-08-10; §5 settled from Boxel propose/accept spike).
Companion to [`deck-step-version-vocabulary.md`](deck-step-version-vocabulary.md),
which says what a Version and a Step *are*. This says **who decides one
exists**, which that document leaves open.

---

## 0. The ruling

> **Cutting a stable Version is a deliberate act with the shape of a pull
> request: proposed, reviewable, gated, and accepted — not a side effect of
> saving.**

Steps stay automatic. Prereleases stay automatic. What becomes deliberate is
the only artifact that carries a promise: a stable Version and its semver.

---

## 1. Why the distinction is not ceremony

A Step is a **fact**: this is what the tree looked like after that save. It
is identified by an opaque change id, nobody decides to make one, and nobody
can depend on one — a Step is not an address another deck may pin.

A Version is a **claim**, and the semver is the claim's content. `2.0.0`
does not mean "later than 1.4.2". It means *I broke you*. `1.5.0` means *this
is safe to take*. Those are statements addressed at other people, about
their code, which they will act on without reading yours.

A claim with no argument attached and no reader is not a claim; it is a
number that happened. Three things follow, and each is a thing Deck cannot
do today.

### 1.1 A Version needs a body

A pull request without a description is a bad pull request. Today a Version
is a semver plus a `treeHash`, and the *why* lives nowhere in the protocol.
The changelog — the sentence that tells a consumer what they are taking on —
is exactly the artifact a proposal has and a save does not.

### 1.2 The bump itself is the reviewable part

Whoever publishes currently decides major-versus-minor alone, and nothing
checks them. That is the single most consequential judgement in the system
and it has no second pair of eyes.

The demo library in this repository is a live example. `palette@1.0.0`
exports `pick(index)`; `2.0.0` exports `pick(name)`. Same name, incompatible
call. Shipping that as `1.1.0` would be a lie that no test in either version
would catch, and every consumer resolving `^1.0.0` would take it silently.
Under this ruling that bump is the reviewable claim, and a reviewer — human
or machine (§3) — can say *you called this minor; you changed the signature*.

### 1.3 The gate becomes a check on a proposal

The publish gate already refuses a breaking release that arrives without a
fixture-proven migration. As a one-shot refusal it fires after someone
believed they were done. As a check on a proposal it is CI: it runs on the
thing being proposed, before anyone has committed to it, and its output is
review material rather than an error.

Same machinery. Different moment, and the moment is the point.

---

## 2. What stays automatic, and why that is not a contradiction

The obvious objection: `deck lock` has a `dev` line that auto-publishes a
prerelease Version per Step. If every Version is deliberate, that is a
contradiction.

It is not, and Git already shows why: **nobody opens a pull request to push a
work-in-progress branch.**

| Level | What it is | Deliberate? |
| --- | --- | --- |
| `live` | my working tree, every save | no — it is the tree |
| `dev` (`@0.2.0-dev.7`) | pushed so a colleague can try it | no — an address, not a promise |
| `^1.0.0` | accepted; others may depend on it | **yes** |

A prerelease is addressable so a teammate or an agent can run your work, and
it is excluded from range matching by the npm rule — so an auto-published dev
line can **never** silently satisfy someone's `^1.0.0`. Automation gets
addresses without anyone accidentally making a promise.

This also gives the three levels a better reading than "how fresh": they are
**my tree**, **pushed**, and **accepted**.

The rule, stated once: *deliberate applies to the artifact you are asking
others to accept, not to every artifact that gets an address.*

---

## 3. Suggesting the bump from the delta

A reviewer who has to derive "is this breaking?" by reading two files will
not do it every time. The proposal should arrive with the bump already
argued, and the argument should come from the code.

### 3.1 What can be decided mechanically

Comparing the **exported surface** of the candidate against the current
Version answers most of it without understanding the code at all:

| Observation in the delta | Implies |
| --- | --- |
| an export removed, or renamed | **major** |
| a required parameter added to an exported function | **major** |
| an exported function's parameter *meaning* changed (arity same) | **major** — undetectable structurally; see §3.2 |
| a new export added, nothing removed | **minor** |
| an optional parameter added at the end | **minor** |
| no change to the exported surface | **patch** |

This is a structural diff, it is deterministic, and it is cheap. It should
run first and it should be the thing the UI shows, because a mechanical
verdict is auditable in a way a generated sentence is not.

### 3.2 What cannot, and why the model earns its place

The `pick(index)` → `pick(name)` break in `palette` is invisible to every
rule in that table. One export, one required parameter, before and after. The
arity is identical. The *meaning* changed, and meaning does not appear in a
signature.

That is the case a language model is actually good at: reading both bodies
and noticing that a parameter went from being indexed into an array to being
looked up as a key. So the division of labour is:

- **The structural pass decides what it can**, and its verdict is a floor —
  if it sees a removed export, the answer is major and no model may argue it
  down.
- **The model raises the floor, never lowers it.** It may say "you called
  this minor, but `pick` now interprets its argument differently"; it may not
  say "this removed export is fine".
- **The model writes the body** (§1.1) — the changelog sentence — which is
  the part it is unambiguously better at than a diff.

Refusing to let the model lower the floor is what makes it safe to have in
the loop at all. A wrong "this is minor" ships a break to everyone on a
caret range; a wrong "this is major" costs one unnecessary bump.

### 3.3 The suggestion is not the decision

The proposal carries a suggested bump, the structural evidence for it, and a
drafted changelog. A person accepts, edits, or overrides. **Overriding
downward should require saying why**, and that reason belongs in the Version
body — it is exactly the sentence a future reader will want when the break
surfaces.

---

## 4. What this changes about the build

- **`deck publish` becomes two-phase**: propose, then accept. A gate built as
  a one-shot refusal has to be rebuilt as a proposal check — review material,
  not a thrown error after someone believed they were done.
- **K7 stops being a later phase.** UC-19 already designs the mechanism:
  Submission cards carrying review state, with `SubmitForReview` and
  `ApproveRelease` as Seats held by different Parties. This ruling promotes
  that from "how promotion works between realms" to **what publishing is**.
- **The Version record grows a body and a proposer.** Both are additive to
  the store's version record.
- **Standalone Deck ships protocol + CLI/server.** Boxel may wrap the same
  doors in cards; the Hub is optional chrome, not a requirement of the
  ruling. A clone of this repo should teach and eventually run propose →
  accept without any Ember host.

## 5. Settled from the Boxel propose/accept spike

Proven in Boxel (`package-proposals` + `semver-delta` on `deck/at-rest-poc`)
and adopted here as the standalone shape:

| Question | Settlement |
| --- | --- |
| Where do proposals live? | Beside the store, not in version records: `<store>/_proposals/<name>/<id>.json`. Never addressable as `@<version>`. |
| Never-accepted proposals? | Stay `open` or `withdrawn` on disk; the served world is untouched. Cheap to propose. |
| Gate at propose time? | Run the publish gate on the proposal; **record** the verdict (including refusals) as review material — do not throw it away. |
| Structural bump? | Compare exported surfaces; verdict is a **floor** (`blindTo` always names meaning-only breaks). Model/reviewer may raise, never lower without `overrideReason`. |
| Claimed bump? | Must follow the suggestion sequentially, or carry `overrideReason` in the Version body. |
| Accept? | Commit the Version **then** mark the proposal `accepted`. Failed publish leaves the proposal open. |
| HTTP surface? | Mutating door is separate from the read-only `/_packages/` (or depot equivalent) grammar so GET cannot reach the gate. |
| Identity? | `proposedBy` / `acceptedBy` come from auth / the CLI actor — not free-typed request body strings. |

Standalone implementation status: **ruling + Core ready; two-phase CLI/server
path still to land** (today `deck publish` remains one-shot). Older playbooks
(`deck-publishing-skill.md`, `deck-semver-migration-spec.md`) describe that
one-shot world and should be read as superseded on the deliberate-stable path.

## 6. Still open (policy, not protocol layout)

- Whether a Version may be proposed by an agent and accepted by another agent
  with no human in the chain. The Seat model permits it; whether the release
  Seat may ever be held by a bot is a policy question.
- Whether a `dev` prerelease can be *promoted* to a stable Version without
  re-cutting, given the bytes are already sealed and identical.
