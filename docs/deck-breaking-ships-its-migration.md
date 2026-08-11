# A breaking Version ships with its migration

**Status: RULING** (2026-08-11). Companions:
[`deck-version-is-a-proposal.md`](deck-version-is-a-proposal.md) (a Version is
proposed, gated and accepted — this says what a *major* proposal must
additionally carry),
[`deck-step-version-vocabulary.md`](deck-step-version-vocabulary.md) (what a
Version and a Step are),
[`deck-in-motion.md`](deck-in-motion.md) (which half of Deck this lives in —
the unsettled one),
[`deck-multi-package-design.md`](deck-multi-package-design.md) (one realm,
many packages).

---

## 0. The ruling

> **A Version that claims a major must carry a migration for the instances of
> the Versions it breaks, and acceptance is gated on that migration being
> *demonstrated*, not merely present.**

A migration that nobody ran is a file, not a migration.

---

## 1. Why a card package is not a library

For a code library, a breaking change breaks **callers**. Callers are code,
their owners are programmers, and the fix is an edit somebody makes with a
compiler telling them where. That is unpleasant and it is tractable.

For a card package, a breaking change breaks **instances**. Instances are
data at rest. There may be a hundred thousand of them, spread across realms
the publisher cannot enumerate, owned by people who never read the code and
have no idea a version number moved. Nobody edits those by hand and nobody
ever will.

So the two cases need different rules. For a library, "we bumped the major,
read the changelog" is a complete answer. For a card package it is an
abdication: it names a problem and assigns it to people who cannot solve it.

### 1.1 The machine cannot be trusted to notice

This is not a hypothetical. The structural pass in
`deck-version-is-a-proposal.md` §3.1 compares the **exported surface**. Run
it against a real card break — a field renamed from `name` to `person`, every
existing instance now greeting nobody — and it returns **patch**. Correctly,
by its own rules: `export class Greeter` is unchanged. One export before, one
export after, same name.

A card's compatibility lives in its **field schema**, and fields are not
exports. The pass that catches a removed function is nearly blind to the
change that actually breaks a card.

Two things follow. The pass needs a field-schema comparison, not only an
ES-surface one. And — because even a schema comparison will miss the case
where a field keeps its name and changes its meaning — the requirement to
carry a migration is the only point in the process where a human is *forced*
to think about the instances. That is what makes it a rule rather than a
lint.

### 1.2 The pin is why this is survivable rather than an emergency

An instance names a **range**, not a version: `crm@^1`. So the day `crm@2.0.0`
is accepted, nothing breaks. Every existing instance keeps resolving to the
newest 1.x and keeps working, indefinitely, with no action from anyone.

That is worth stating plainly because it changes what the migration is *for*.
The migration is not a rescue. It is what makes upgrading **possible and
reviewable** — an offer the owner of an instance can take when they choose,
not a debt that comes due on release day.

It also sets the real failure mode. Without a migration, a major is not a
disaster; it is a **fork**. Half the instances sit on `^1` forever, the
publisher maintains two lines or abandons one, and the version number stopped
meaning anything. Requiring the migration is how a major stays a step forward
instead of a permanent split.

---

## 2. What a migration is

A migration is **addressed, executable, and proven**.

**Addressed.** It names what it converts and to what: a from-range and a
to-version. `crm@^1 → crm@2.0.0`. A migration with no stated domain cannot be
selected automatically, and selecting it by hand defeats the point.

**Executable by the runner, not by the author.** It runs where the review runs
(§4), against instances the author has never seen. A migration that only works
on the author's machine has not been demonstrated.

**Proven on fixtures the proposal carries.** At minimum: one instance of the
old shape, and the expected instance of the new shape. Those fixtures are
review material — a reader who understands nothing else about the change can
read the before and after and know what will happen to their data.

**Non-destructive.** It produces a new instance; it does not edit one in
place. The old instance remains as a Step, so a migration that turns out to be
wrong is recoverable by the mechanism that already exists rather than by
restore-from-backup. This is not a nicety: a migration is code written against
instances its author could not inspect, and the probability that it is wrong
for *some* instance is not small.

### 2.1 What it is not

It is not a schema diff. A rename is expressible as a diff; `fullName` split
into `given` and `family` is not, and the interesting migrations are the
second kind. The migration is code because the transformation is code.

---

## 3. Packages whose instances are the point

Some packages ship instances deliberately — a lookup table, a directory, a set
of worked examples like the ones in `boxel-catalog`. There the instances are
not incidental content that happened to be in the tree; they are the product.

Two consequences.

A breaking change to such a package breaks **its own shipped instances**, and
the migration must cover them like any others. The publisher is in the
unusually good position of being able to test that completely, since those
instances are in the pack.

And the pack root question has an answer: instances inside a package root are
**intentional**, and packing them is correct. What is not correct is a
*consumer's* instances living in a package root by accident. That is a
distinction the author makes, not one the packer can infer — so the packer
packs what the root contains, and the review is where somebody notices that a
customer record got vendored into a library.

---

## 4. Demonstrating it — the in-motion half

This lives in the unsettled half of `deck-in-motion.md`, and the shape it
takes is the one UC-19 already designs for catalog submission: a room, a
proposal in it, a runner, and Seats held by different parties.

The loop:

1. A proposal claiming a major arrives carrying its migration and fixtures.
2. The **runner** applies the migration to the fixtures, and to a sample of
   real instances discovered by search across realms the proposer can read —
   in a scratch space, never in place.
3. Results are posted back into the room: fixtures passed, sample size, per-
   instance failures with the instance's id.
4. Acceptance is available only after a run that covers the fixtures. A run
   with failures does not block acceptance — it is recorded, the same way the
   gate's refusal is recorded — but accepting over failures requires a reason,
   like every other override in `deck-version-is-a-proposal.md` §3.3.

### 4.1 The bot orchestrates; it does not evaluate

**The workflow bot must not run the migration.** The standing rule is that the
bot evaluates policy *data* and never realm JS, and a migration is realm JS
written by whoever proposed it. Handing it to the bot would make the bot's
process the blast radius of every proposal in the system.

So the bot schedules, collects, formats and posts. The migration executes in
the sandboxed execution runtime, which is the thing already built for running
realm code that is not trusted. The room is the surface; the runner is the
engine; the separation is a safety property, not an implementation detail.

### 4.2 Sampling is honest, not exhaustive

The runner cannot see every instance in the world. It should say so — report
the sample size and the scope it searched — rather than implying a clean run
means every instance is safe. A number nobody can justify is worse than a
stated limit.

---

## 5. What this changes about the build

- **The publish gate grows a check it does not have.**
  `deck-version-is-a-proposal.md` §1.3 describes the gate as already refusing
  a breaking release with no fixture-proven migration. In the Boxel backport
  it does not: `checkPublish` validates the name, the version, the treeHash
  and the cooldown, and knows nothing about migrations. That gap is real and
  this ruling is what closes it.
- **The structural pass needs a field-schema comparison** (§1.1), and its
  verdict for a card package should be treated as a floor with a hole in it
  until that lands.
- **The proposal record grows** a migration reference and a run result. Both
  additive.
- **A `major` with no migration is refusable**, and that is the first refusal
  in this system that is about the *future* of data rather than the identity
  of bytes.

## 6. Not decided here

- Whether a migration may be authored by an agent and accepted with no human
  in the chain. Same question `deck-version-is-a-proposal.md` §5 leaves open
  for the Version itself, and it should get the same answer.
- What happens to instances in realms the publisher cannot read. They cannot
  be sampled and they cannot be migrated by the publisher; the migration has
  to be something the *owner* of that realm can run later, which argues for
  migrations being addressable and re-runnable rather than a one-shot event
  at release.
- Whether a minor ever needs one. Making an optional field required is a
  break that the semver rules call a minor if you are careless; the honest
  answer is probably that it is a major, not that minors need migrations.
- How a migration is versioned when the migration itself is wrong and needs a
  fix after some instances have already run it.
