# The range is on disk; the resolution is not

**Status: RULING** (2026-08-11). Companions:
[`deck-breaking-ships-its-migration.md`](deck-breaking-ships-its-migration.md)
(what a major must carry — this ruling is what makes that the *only* event
that touches instances),
[`deck-step-version-vocabulary.md`](deck-step-version-vocabulary.md) (Version ·
Pin · range),
[`deck-a-package-carries-its-own-name.md`](deck-a-package-carries-its-own-name.md)
(what a name denotes).

---

## 0. The ruling

> **An instance names a RANGE, and keeps naming it. The type it runs is
> whatever the resolver answers — normally the highest compatible published
> Version. Type identity is computed from the RESOLVED module, never from the
> range as written.**
>
> The consequence, and the point: **nothing on disk changes below a major.**

---

## 1. Why the range, and not the version

An instance could name an exact version. Every compatible release would then
require rewriting every instance that wanted it — a filesystem scan, a
migration script, and a write amplification of one file per instance, for a
change that by definition breaks nothing.

That cost is not theoretical: it is the reason to prefer the range. A patch
release should be free. A minor release should be free. If taking them costs a
scan across every realm holding an instance, nobody takes them, everything
stays pinned at whatever it was born on, and the version numbers become
decoration.

So the range stays in the instance, and it stays *stable*: it is rewritten
only when the range itself must change, which is only when a major arrives.

## 2. Why identity comes from resolution, not spelling

Three instances can name the same type three ways:

```
greeter@^1.0.0/index
greeter@^1/index
greeter@1.1.0/index
```

If type identity is built from the module string as written — which is what
happens today; the key is the resolved *URL* but the range survives into it
verbatim, percent-encoded and all — those are three distinct types. Search by
type finds a third of what it should. A definition cache holds three copies. A
migration that walks "every instance of `greeter@^1`" misses the ones written
`@^1.0.0`.

None of that is a naming problem, and no amount of normalising the spelling
fixes it: `@^1` and `@1.1.0` are genuinely different strings that genuinely
denote the same type. **Resolve first, then key.** All three collapse to
`greeter@1.1.0/index`, which is the module that will actually be evaluated —
and identity should name what runs.

## 3. The consequence, stated plainly

**Type identity becomes time-dependent.** Publish `1.2.0`, and every instance
on `^1` is now an instance of a different type than it was yesterday.

That is correct rather than a defect. Those instances *do* now run different
code. What follows from it is real work and should be named rather than
discovered:

- publishing a compatible Version must **invalidate** the instances whose
  ranges newly resolve to it — they are not stale data, they are running
  something new;
- definitions cached under the previous resolution must be **dropped**, not
  merged;
- "what did this instance actually run?" must be answerable, which means the
  **index records the resolved version** — in the index row, recomputed, never
  written back into the instance file.

That last split is the whole design in one line: **the range is authored, the
resolution is derived.** The file holds intent; the index holds the current
answer; neither pretends to be the other. It is the same split as
`dependencies` (ranges, authored) versus `imports` (pins, derived) one level
up, and it should feel familiar for that reason.

## 4. What this buys

A clean seam, and it is the reason to accept the cost in §3:

| event | files touched | what happens |
| --- | --- | --- |
| patch published | none | instances reindex, run the new code |
| minor published | none | same |
| **major published** | **instances in range** | migration rewrites the range |

A major is the only event that writes to an instance. Which is precisely the
event [`deck-breaking-ships-its-migration.md`](deck-breaking-ships-its-migration.md)
requires a migration for — so the migration's job now has a crisp definition:
it converts the instance's data *and* moves its range, and those are the same
operation because they are the same break.

Below a major, an instance is never opened. That is what makes ranges worth
having.

## 5. What this changes about the build

- **`internalKeyFor` keys on the module as resolved from the code ref**, which
  carries the range through into the identity. Resolution has to happen before
  the key is formed.
- **The index needs somewhere to record the resolved version.** Additive.
- **A module in the package store has no owning realm**, so the definition
  lookup cannot find it at all today: it resolves ownership by realm prefix,
  falls back to probing the URL for a realm header the store does not send,
  and raises "nonexistent type". Ownership for store-hosted modules is a
  prerequisite for any of this, and
  [`deck-a-package-carries-its-own-name.md`](deck-a-package-carries-its-own-name.md)
  argues the owner is the package's declared namespace rather than whichever
  realm happens to be asking.

## 6. Not decided here

- ~~**What a failed resolution means.**~~ **Settled** by
  [`deck-who-may-intervene.md`](deck-who-may-intervene.md) §4: it is **held** —
  data present, intent present, code withdrawn — and a security yank produces
  it on purpose. It must read differently from a broken card, or every
  withdrawal looks like a platform failure.
- **Whether an instance may pin exactly.** A range of one is expressible and
  sometimes right — a fixture that must not move. The question is whether that
  should look different from a range, or whether uniformity is worth more.
- **When resolution is recomputed.** On publish is obvious; on read is
  expensive; the difference is how long an instance can be running code its
  index row does not describe.
- **Whether a range may be narrowed without a migration.** Going from `^1` to
  `~1.2` breaks no instance and touches every file, which sits awkwardly
  against §4's table.
