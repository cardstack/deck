# Testing on Deck

Written 2026-08-09. Design, not implementation — nothing here is built. It
uses ASD-STE100 Simplified Technical English.

Testing is **in motion**: it is something people and machines do to work over
time. The record it leaves is **at rest**. That split decides the whole
design, so read `docs/deck-in-motion.md` §0 first.

---

## 1. What is wrong with the current arrangement

A hosted CI service gives you one green mark, and the mark has four problems.

1. **You cannot run it.** The suite runs in an environment described by a
   configuration file, on a machine you do not have. When it fails and your
   machine passes, you debug the difference by pushing commits.
2. **The mark is from the platform.** The check says the service ran
   something. It does not say who is prepared to stand behind the result.
3. **It is attached to a commit, so it does not travel.** Fork the repository
   and the marks do not come with it, although the bytes are identical.
4. **It runs again for no reason.** The same tree, tested by the same suite,
   is tested again on the next branch, in the next fork, in the next
   repository that vendored it.

Each of these has an answer in something Deck already does.

---

## 2. The design

### 2.1 A test suite is a deck

It has a publisher, a name, a version, a tree hash, and an import map that
pins every dependency it uses. It is browsable, forkable and runnable like
everything else here.

This is the part that makes the rest work. A suite with an exact version and
a pinned closure is a suite that runs the same way on any machine, because
"the same way" is now a property of an address rather than a promise in a
configuration file.

### 2.2 A run is a pair, and the pair is immutable

A run is: **this suite, at this exact Version, against this tree hash.**

```
suite   /tools/acme/test-suite@2.1.0     treeHash 4f2a…
subject /site/acme/palette@1.4.0         treeHash 39c5…
```

Both sides are immutable, so the result cannot go stale. If the answer was
"passed" this morning, it is "passed" for ever, because neither the question
nor the thing being asked about can change.

**Nothing is ever tested twice.** A result for a pair is a fact about that
pair, and a second run of the same pair can only agree with the first. This
is the same dividend that makes an exact Version cacheable for ever, applied
to work instead of to bytes.

### 2.3 You run it locally, and local is not the fallback

```
deck test --suite tools/acme/test-suite@2.1.0 --against site/acme/palette@1.4.0
```

The suite is pinned and the subject is immutable, so the command reproduces
what anybody else ran. There is no "works on my machine", because there is no
machine in the definition — only two addresses.

A server can run the same command. It is not privileged when it does.

### 2.4 The result is a statement, signed by a person

The output is a record addressed to the **subject's tree hash**, in the same
shape as an endorsement (L9):

```json
{
  "about": "39c5f357…",
  "suite": { "at": "/tools/acme/test-suite@2.1.0", "treeHash": "4f2a…" },
  "verdict": "passed",
  "ran": "2026-08-09T09:12:44Z",
  "by": "<key id>"
}
```

Two rules, and both are the point.

**A person signs it, not an organisation.** The statement means "I ran this
and I am prepared to say what happened." A key belongs to somebody. There is
no platform key, no bot account that speaks for everybody, and no way for a
service to issue the mark on the group's behalf. If a team wants a team's
confidence, that is several signatures, and the several are visible.

**It follows the bytes.** Because it is addressed to the tree hash, a fork
that did not change those bytes keeps the result (L10). Vendoring a library
brings its test results along. Nothing is re-run to learn what is already
known.

### 2.5 Several runs, and disagreement is the useful part

Any number of people can run the same pair, and each leaves a statement.
Agreement accumulates: five keys that all say `passed` is a stronger claim
than one, and it is stronger in a way a reader can inspect rather than
assume.

**Disagreement is a finding, not an error.** If two runs of one immutable
pair disagree, the suite is not hermetic — it reached the network, read the
clock, depended on a locale, or raced. A hosted service cannot notice this,
because it runs the pair once. Here it is the loudest signal the system
produces, and it says something true and important: *this suite is lying
about being a test.*

That is the largest difference from a green check, and it comes free from
running the same pair in more than one place.

---

## 3. What this does not solve

Stated plainly, because a design note that only lists wins is an
advertisement.

- **A suite can still be wrong.** Nothing here says the tests are good tests.
- **A signature is only worth the care behind it.** See
  `deck-in-motion.md` §3.5: an agent's signature and a person's signature are
  different kinds, and the kind must be recorded.
- **Environment is pinned, not eliminated.** The import map pins the modules.
  It does not pin the Node version, the operating system, or the processor.
  A run record should carry what it can observe about those, so a
  disagreement can be explained.
- **Nobody is required to run anything.** There is no gate. A consumer
  decides what evidence they need, which is the same posture Deck takes
  everywhere else: state the fact, do not state the policy.
- **It needs revocation.** A result that was wrong must be withdrawable, and
  withdrawal is unbuilt — see `deck-at-rest.md` §7.
- **Between servers is unbuilt.** Collecting results from other people needs
  two depots to talk. That is `deck-in-motion.md` §3.6.

---

## 4. What would have to be built

1. `deck test` — resolve two addresses, run the suite against the subject,
   print the verdict.
2. A run record format, addressed by tree hash, beside the signature records
   that already exist.
3. `deck sign` over a run record, so the statement has an author.
4. A reader: `/browse` shows the results for a Version, and disagreement is
   visible rather than buried.
5. Only then, a way to collect run records from another depot.

Steps 1 to 4 are all inside one machine and need nothing that does not exist.
Step 5 needs federation.
