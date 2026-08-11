# Who may intervene

**Status: RULING** (2026-08-11). Companions:
[`deck-a-package-resolves-through-its-own-map.md`](deck-a-package-resolves-through-its-own-map.md)
(this answers the security-patch question that document left open),
[`deck-a-package-carries-its-own-name.md`](deck-a-package-carries-its-own-name.md)
(why no layer here may rename anything),
[`deck-the-range-is-on-disk.md`](deck-the-range-is-on-disk.md) (this settles
its "failed resolution" question),
[`deck-breaking-ships-its-migration.md`](deck-breaking-ships-its-migration.md)
(the operator's patcher is one of these),
[`deck-laws.md`](deck-laws.md) (L4: published bytes never change).

---

## 0. The ruling

> **Authority to intervene is layered, and the layers differ in KIND rather
> than in strength.**
>
> - A **publisher** has authority over what their package *means*.
> - A **catalog** has authority over what it will *serve you*.
> - An **operator** has authority over what may *execute on infrastructure it
>   runs*.
>
> **No layer may change bytes, and no layer may change names.** They change
> selection, listing and execution. That is what keeps a pin unambiguous no
> matter who intervened.

---

## 1. Why anything beyond the publisher must exist

A hosting provider running an open-source project for other people has a duty
of care that the package model alone cannot discharge.

Malware does not arrive politely as a published Version with a maintainer who
will answer email. It spreads through messages, through copied tutorials,
through an agent that helpfully pasted something into a realm. It arrives as
packages *and* as raw code. Waiting for a publisher to act is not a plan when
the publisher is the attacker, when the publisher is gone, or when the thing
was never a package at all.

So the answer to "may anyone override a publisher?" is **a layered yes**. What
follows is what each layer may do, and — more importantly — what none of them
may do.

## 2. The three layers

| | authority over | mechanism |
| --- | --- | --- |
| **publisher** | what their package *means* | in-range advisory, republish |
| **catalog** | what it will *serve you* | admission, yank, advisory, policy |
| **operator** | what may *execute here* | deny, opt-in patching |

**The publisher** may advance a sealed pin *within the range their package
already declared*. A pack carries both facts — `dependencies` holds the range,
`imports` holds the lock — so the permission was granted in writing at publish
time. The seal records what was known then; an advisory records what was
learned after. Neither overrides the other in a hierarchy; resolution is a
function of both.

**A catalog** is a depot that curates. npm is one. So is `boxel-catalog`; so
is a `boxel-canary` where untested packages get beta-tested; so is an
`acme-catalog` a company maintains for its staff. These are not three
codebases — they are one mechanism with different **policy rows**: signature
required?, cooldown days, migration-required-on-major?, who may publish. A
depot subscribes to an ordered list of catalogs.

Stating policy as *data* is deliberate: it is what a deterministic workflow
bot may evaluate without ever running realm JS.

**An operator** governs execution, and only on infrastructure it runs. This
layer is security operations rather than package management, and §5 is about
why that distinction earns its keep.

### 2.1 What none of them may do

A catalog that wants a patched build of `money` must **fork and rename**:
`acme/money@3.1.1`, which acme's staff pin explicitly. It may not serve
different bytes under a name it does not own.

Otherwise `money@3.1.1` denotes different things in different catalogs, every
pin becomes ambiguous, and you have reproduced the failure
`deck-a-package-resolves-through-its-own-map.md` exists to prevent — one level
up, and harder to see.

So "the version under a catalog's control" means **which versions it will
carry**, never **which bytes wear which name**.

## 3. Precedence

**Yanks: most restrictive wins.** A depot subscribing to `acme-catalog` and
`boxel-catalog` gets the **union** of their yanks. No catalog can un-yank what
another has yanked.

**Advisories: first match wins**, in subscription order — corporate before
public, so a company's judgement about its own staff's dependencies takes
effect without needing anyone else's agreement.

They differ because they are different kinds of claim. A yank is a **safety
claim**, and more information about danger should mean more restriction, never
less. An advisory is a **preference among valid options**, and order is how a
depot says whose judgement it wants.

The rest of the ladder:

- a **sealed pin** beats the depot's ambient map — the depot has no standing
  to second-guess a package;
- an **in-range advisory** beats the sealed pin — later information, from the
  party with standing, bounded by what the package itself declared;
- an **operator deny** beats everything, because it is not resolution at all
  (§5).

## 4. A security yank stops what is running

A yank normally changes future selection. A yank marked **security** stops
what is live.

That makes a state real that was previously an unresolved edge case:
`deck-the-range-is-on-disk.md` §6 asks what a failed resolution means, and the
answer is now that it is a designed state rather than an error.

> **held** — the instance has its data, it has its stated intent, and the code
> it needs has been withdrawn.

This must read differently from a broken card, in the index and in the
interface. A card that fails to render because somebody shipped a bug and a
card that will not run because it was withdrawn on purpose are different
events, and conflating them means every security yank looks like the platform
broke.

Severity is therefore **policy, not protocol**: a deprecation must not halt
anything, and a security yank must.

## 5. The operator layer is security operations

Two mechanisms, and neither belongs to package management.

### 5.1 Deny by content, not by name

**Denies key on file hashes — the per-file `sha256` the packlist already
records for every entry.**

Names cannot carry this weight. Code pasted out of a tutorial into a realm has
no version, no publisher and no listing, so a name-based list cannot see it —
and renaming defeats one trivially. A content-addressed deny catches the same
bytes wherever they landed: inside a published pack, pasted into a realm,
copied between realms, republished under a fresh name by someone who assumed
that would work.

The limit, stated so nobody over-trusts it: this is **exact match**. Two edited
lines is a different hash. It is a containment tool against copy-paste
propagation — which is the vector it exists for — and it is not a detector.

### 5.2 Opt-in patching is a migration with a different author

An operator's "auto security update" is not new machinery. It is exactly what
`deck-breaking-ships-its-migration.md` already specifies — code that
transforms content, run by the sandboxed runner, proven on fixtures, results
recorded — with a different author and a different consent model.

Because it writes to other people's realms, which is the most dangerous
capability in the system, three things attach:

- **Consent lives in the realm**, not in an operator-side database. The realm
  can then prove what it agreed to, and a realm that is exported or moved
  carries its own answer.
- **Every write seals as a Step**, attributed to the operator. A security
  patch that cannot be undone is worse than the vulnerability for whoever it
  breaks.
- **Operator migrations run in the same sandbox as everyone else's.** The rule
  that the bot orchestrates and the runner executes does not get an exception
  for privileged code; it matters more there, because that code runs across
  thousands of realms at once.

## 6. Publish effects, not the set

A public list of malware hashes tells an attacker precisely what was caught
and, by omission, what was missed.

The reframe that makes this tractable: **you cannot hide from an attacker
whether their own payload is blocked.** They will run it and find out in a
second. Complexity spent on that is spent for nothing. The threat that is real
is **bulk enumeration** — recovering the set to map detection coverage and
learn which samples an operator holds.

### 6.1 Split by what is already public

- **Package denies: publish plainly.** If a package is in a store, its
  existence and its hash are already discoverable by asking the store.
  Denying it discloses nothing. This is a yank with teeth and it should be as
  legible as any other yank — in the catalog, readable, with a reason.
- **Content denies: behind a membership filter.** Hashes of pasted code,
  private realm content and collected samples are the ones where the set is
  itself intelligence, because nobody else can enumerate what was found.

This keeps the common path — a bad package — fully transparent, and reserves
the opaque mechanism for the case that genuinely needs it.

### 6.2 How the filter behaves

A Bloom or cuckoo filter does not store the hashes; it stores bits derived
from them. You can ask, you cannot list. Recovering the set means testing
candidates, and the candidate space is 2²⁵⁶ — so an attacker learns only about
files they already hold, which is what they would learn by running them.

Against shipping the raw list, the specific thing withheld is **correlation**:
a raw list can be joined against public sample corpora, which tells an
adversary exactly which families are known and which are not. A filter cannot
be joined against anything.

**Confirm on hit.** A filter hit triggers one call carrying the full hash,
answering definitively and returning the human-readable reason. This is what
makes the false positive rate a *performance* parameter rather than a
*correctness* one — tune it so confirming calls stay rare, not so the filter
is never wrong. Without it, the mechanism silently breaks legitimate files
forever with no recourse, and gets switched off.

Sizes are not the constraint: ten thousand entries at one-in-ten-thousand is
about 24 KB. The filter is chosen for disclosure, not for space.

### 6.3 Three audiences

| audience | receives | why it is safe |
| --- | --- | --- |
| the affected user | full detail: which file, which realm, what to do | they already hold the bytes |
| the public | class and remedy — what propagated, how, what to check | describes the family, never the set |
| peer operators and catalogs | more detail, signed, not public | trust is explicit and revocable |

The first row is the one that actually fixes anything, and it carries no
disclosure cost at all. Most of the tension here dissolves once *who needs to
know* is separated from *what gets broadcast*.

### 6.4 A block is a Step

When a loader refuses something, that refusal is recorded in the affected
realm's own timeline — attributed to the operator, with its reason, and
reversible through the machinery that already exists.

Operator logs alone are not enough. A user must be able to see what was done
to their realm and why, or this stops being a duty of care and becomes
something done to people.

## 7. What this changes about the build

- **Catalogs need subscription**: an ordered list per depot, and a resolution
  step that consults it.
- **Advisories and yanks want to be instances** in a catalog realm —
  reviewable, searchable, with history. That is the most native form available
  and it needs no new storage.
- **Deny entries need expiry or re-affirmation.** Otherwise the filter only
  grows, false positives accumulate, and nobody remembers why an entry is
  there.

### 7.1 Delivery: a bundled baseline plus a pulled overlay

The loader is the enforcement point, so the filter has to be there whenever
the loader is. **Pulled, never pushed** — a page load already fetches a pile
of dependencies, and one more small static file is cheaper than an always-on
push channel into every running client. Cache it for one to ten minutes.

Split it in two, because the two halves have different failure costs:

- **A baseline filter inside the app bundle** — same deploy artifact, same
  cache lifecycle as the JavaScript. If the app loaded, the baseline loaded.
  There is no such thing as an unprotected cold client, which removes the only
  genuinely bad case rather than deciding how to fail in it.
- **An overlay, pulled on the 1–10 minute cycle**, carrying denies added since
  that build. Losing it costs at most the last few minutes of new entries,
  never the whole set.

**Sign the overlay and verify before merging.** An unsigned overlay is an
injection path directly into the kill switch. On a signature or parse failure,
fall back to last-known-good rather than treating it as empty.

### 7.2 How each failure resolves

The two failures get opposite answers, which follows from their blast radius
rather than from inconsistency.

| failure | behaviour | why |
| --- | --- | --- |
| overlay fetch fails | **open**, on baseline + last-known-good, with loud operator-side telemetry | bounded to recent entries; the likeliest cause is a build pipeline, not an attacker |
| confirm-on-hit fails | **closed** | the suspicion already exists, and failing open lets one blocked URL defeat the mechanism for exactly the case it is for |

The arithmetic on the second: at a one-in-ten-thousand false positive rate and
99.9% endpoint availability, blocking pending confirmation costs about one
spurious refusal in ten million loads. Failing open there costs the whole
control.

A control whose failure mode is "nothing works" gets switched off, and then
protects nothing — which is why the baseline is bundled rather than the
overlay being mandatory.

## 8. Not decided here

- **No appeal path, for now** — a decision rather than an omission. It makes
  confirm-on-hit **load-bearing**: it is the only thing standing between a
  false positive and a permanently blocked file with no explanation and nobody
  to ask. Two things follow. Nobody may simplify the confirm step away later
  as an optimisation. And every block is logged with its hash and its reason,
  user-visible in the realm's timeline (§6.4) and operator-side — without a
  path, the log is the only evidence that a wrong block ever happened, and it
  will be wanted the first time somebody asks why their card stopped working.
- **Whether an out-of-range operator override exists at all.** When the fix is
  a major and an intermediate package is abandoned, the honest options are
  fork it, or let an operator force an untested combination and mark every
  resolution it touches as locally modified. The second must never travel
  beyond the depot that chose it.
- **Whether a catalog may yank a package it does not list.** Saying no is
  clean; it also means a catalog cannot warn about something its members
  reach for directly.
