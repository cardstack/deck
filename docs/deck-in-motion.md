# Deck in motion

Written 2026-08-09. Companion to `docs/deck-at-rest.md`. It uses ASD-STE100
Simplified Technical English.

---

## 0. Why the split

Deck has two halves, and they are not equally finished. Reading them as one
document made the settled half look provisional and the unsettled half look
decided. Neither is true, and the confusion costs more than the extra file.

**At rest** is what a byte, a tree and a Version *are*. It answers "what is
this, exactly". Its answers do not change with time, with who is asking, or
with what anybody intends to do next. This half is **settled**. Twelve laws
state it, a conformance suite examines it, and a second implementation can be
written against it today. Treat it as fixed. Changing it breaks every stored
artifact.

**In motion** is what people and agents *do* to each other's work over time:
propose, review, merge, declare, comment, watch. It answers "what is
happening, and who is waiting for whom". Its answers change by the minute,
and they involve more than one party. This half is **not settled**. Parts of
it work, parts are sketched, and one part needs two servers that have never
talked to each other.

The dividing question is: **does the answer change if nobody does anything?**
A tree hash does not. A proposal does — it goes stale, it gets rebased, it
is accepted or abandoned.

---

## 1. What is on each side

| | at rest | in motion |
| --- | --- | --- |
| identity | tree hash, packlist, object | — |
| naming | Version, dist-tag, range | — |
| distribution | address grammar, cache rules | — |
| time | Step, Timeline | the live loop that produces them |
| provenance | `vendoredFrom`, publish times | — |
| trust | the signature itself, over a tree hash | how a signature is earned, and whose you accept |
| change | — | offer, rebase, conflict |
| intent | — | claim |
| talk | — | note, reply |
| presence | — | touch score, activity |
| testing | the run record, over a tree hash | running the suite, and who signs the result |

Two entries need their reasons stated, because they look like they belong on
the other side.

**A Step is at rest.** It is one immutable capture with an address, and it
reads the same in a year. The *watcher* that makes Steps is in motion; the
Steps are not.

**A signature is at rest. Signing is in motion.** The signature is a durable
fact: this key stood behind these exact bytes. It reads the same in a year.
The *act* of producing it is a process with people and machines in it, and
Deck defines none of that — see section 3.6.

---

## 2. The at-rest half is closed

Do not add to it without a very good reason. Everything in
`docs/deck-at-rest.md` and `docs/deck-laws.md` is examined by
`packages/conformance`, and a stored artifact from today must still verify
under a reader written next year.

If a new idea can be expressed as data at an address, it belongs in motion,
not at rest. That is how the activity protocol was built: claims are files at
a known path, read by an ordinary `GET`, and they required no change to
identity, naming or serving.

---

## 3. The in-motion half, and how finished each part is

### 3.1 The live loop — works

The watcher observes a save, waits for quiet, hashes the tree, and publishes
`<base>-dev.N` if the hash changed. With a history backend it also records a
Step. A change bus at `/_live/events` tells clients that something moved.

This is the part that runs all day, and it is the reason the at-rest half
gets exercised so heavily: each save is a full publish.

### 3.2 Claims — works, and reads as data

An agent declares where it is about to work by writing one file:

```
<depot>/.deck/claims/<actor>.json
```

The server reads the file. There is no `POST`, because L12 says the
distribution surface is read-only, and a claim is a fact somebody arranged on
disk like every other fact here. A claim has a time limit; the reader
enforces the limit, so an abandoned claim expires without anybody collecting
it.

To ask an agent to stop, delete the file. The agent reads the deletion as the
instruction.

See `docs/deck-activity-protocol.md`, which also defines the touch score:
observed activity, decaying with a two-hour half life, kept separate from
declared claims. Never blend the two. One is what happened, the other is what
somebody says will happen.

### 3.3 Offers and rebase — works within one depot

A fork that records the tree it came from is an offer. An offer is a Version,
so you can run it before you decide anything. This is the part that replaces
the pull request, and it is better than one in exactly one way: you are
looking at the result, not at a description of the result.

The daemon re-merges open offers against newer upstream. Clean merges land.
A conflict is reported, and nothing is written — a machine that damages a
contributor's tree to be helpful is worse than a machine that stops. JSON
merges key by key, so two people who add different keys do not conflict.

**The limit: this happens inside one depot.** Both the offer and its upstream
are mounts on the same server.

### 3.4 Notes — designed, not built

An agent that finishes a piece of work should be able to say what it did, and
a person should be able to reply. The shape agreed: notes are records at an
address, addressed to a tree hash rather than to a branch, so a note follows
the bytes it is about into any fork.

`deck note` writes them. `/track` does not read them yet, which is why the
attention band cannot be answered, only set aside.

### 3.5 How a signature is earned — not defined

`deck sign` records that a key stood behind a tree hash. It does not say how
anybody decided to do that, and the question of how you decide is a large one
with more than one good answer:

- **An agent reviews it.** A machine reads the diff and signs if it finds
  nothing. Fast, tireless, and wrong in ways a person is not.
- **A person reviews it.** Slow, and the only method that currently carries
  weight with anybody.
- **A group votes.** A signature that means "enough of us looked". This needs
  a way to count, which needs the between-servers part below.
- **Somebody stakes something.** The signer has something to lose if the
  bytes turn out to be bad. This makes a signature carry risk instead of
  reputation, and it needs revocation to work before it means anything.

These are not alternatives to choose between now. They are different kinds of
signature, and a reader should be able to tell which kind they are looking at
— which means the *kind* is data on the signature, and that part is at rest
and not yet specified.

What Deck does say is narrow, and worth keeping narrow: a signature is over a
tree hash, so it follows the bytes into any fork (L9, L10). Everything about
who signs, why, and what their signature is worth is policy, and policy
belongs to whoever is deciding.

### 3.6 Testing — designed, not built

Automated testing belongs here, and the design is in `docs/deck-testing.md`.
The short version, because it follows the same split as signing:

- A **test suite is a deck**: pinned closure, exact Version, tree hash.
- A **run is a pair** — this suite at this Version, against this tree hash.
  Both sides cannot change, so the result cannot go stale, and the same pair
  is never tested twice.
- **You run it locally**, and local is not the fallback. There is no machine
  in the definition of a run, only two addresses.
- The **result is a statement signed by a person**, addressed to the
  subject's tree hash. No platform key and no bot that speaks for a group. A
  team's confidence is several signatures, and the several are visible.
- **Disagreement between two runs of one pair is the useful signal.** It
  means the suite is not hermetic. A hosted service runs the pair once and
  cannot notice.

### 3.7 Between servers, and the official catalog — not built

This is the gap, and it decides whether "in motion" is a protocol at all.
Nothing here defines how one depot offers a change to a depot on another
machine, how a review travels between them, or how a vote is counted.

The shape it wants is already visible in the offer. **A signature can also be
the record of an accepted proposal into an official catalog.** A catalog is a
depot like any other; what makes it official is that people point at it. So
"this was reviewed and accepted into the catalog" and "somebody signed these
bytes" want to be the same fact, written once:

- The contributor forks, changes one file, and the fork records the tree it
  came from. That is an offer.
- The catalog reviews it, by whichever of the methods above it has chosen.
- Acceptance is a pointer move: the catalog names a tree hash it now holds.
  No bytes are copied, because the store already has them.
- The signature over that tree hash is what the acceptance leaves behind, and
  it travels with the bytes into every fork (L10).

Admission to a catalog then becomes a kind of signature rather than a
separate mechanism — which is worth having, because it means a consumer asks
one question ("who stood behind these bytes, and how") instead of two.

None of this is built. Both parts of it need two depots to talk, and they
never have. Until then, Deck in motion is a set of local conventions with a
good data model, and Deck at rest is the part another implementation can
join.

---

## 4. What this means for the words

- **At rest**: Version, Step, Timeline, tree hash, Deck Pack, depot, deck,
  publisher, Import, Pin, Entry, Leaf, Closure.
- **In motion**: offer, conflict, rebase, claim, note, reply, activity, touch.

A word that appears in both lists is a mistake to be fixed, not a
coincidence. `seal` was such a word — it named a Version, a Step, and the act
of making either — and it is why the vocabulary pass happened.

---

## 5. Reading order

1. `docs/deck-laws.md` — the contract. Almost entirely at rest.
2. `docs/deck-at-rest.md` — layout, store, addresses, Timeline.
3. This document — what moves, and how finished it is.
4. `docs/deck-activity-protocol.md` — claims and touch, in detail.
