# Codelist — the merge that is not a conflict

```bash
pnpm --filter @deck/example-codelist demo
# open http://localhost:8790/
```

## The situation

A shared table of currency codes. Two people add different codes at the same
time, neither aware of the other. Somebody else maintains a fork with three
internal codes that must survive every upstream release.

This is workload **W2** in [docs/deck-use-cases.md](../../docs/deck-use-cases.md),
and it is where the git model is actively wrong. A codelist is a **set of
keys**. Two people adding different keys were never in conflict, however
adjacent the lines happen to be — only a line-based merge invents one.

## What the demo does

Four states, sealed in order, each ending up at its own immutable URL:

| Version | Keys | What happened |
| --- | ---: | --- |
| `std/currencies@1.4.0` | 10 | the shared list |
| `std/currencies@1.5.0` | 13 | ana added XCD + SRD, kim added ZWG, merged |
| `acme/currencies@1.4.0-acme.1` | 13 | a fork: base plus three internal codes |
| `acme/currencies@1.5.0-acme.1` | 16 | the fork rebased onto 1.5.0 |

The merges are real — the demo calls `mergeTrees` from `@deck/core`, it does
not stage the result.

## The part worth watching

The rebase reports **one conflict**, and it is the right one.

The *data* merges perfectly: ten base codes, upstream's three, acme's three,
sixteen keys, nobody touched the same key. What collides is
`importmap.json` — the fork calls itself `1.4.0-acme.1`, upstream calls
itself `1.5.0`, and both edited that one key.

That is the honest answer rather than a limitation. A machine can combine two
sets of codes, because "both" is well defined. It cannot decide what to
**name** the combination, because that is a judgement about compatibility.
The merge says so instead of guessing.

## Everything here is at rest

No login, no write endpoint, no merge button. Every state above is a sealed
version at an immutable URL, and the merge already happened when it was
sealed — you are looking at the before and the after, both addressable,
forever. The viewer is an ordinary page that `fetch`es four URLs; there is no
Deck client library involved.

```
/site/std/currencies@1.4.0/currencies.json
/site/std/currencies@1.5.0/currencies.json
/site/acme/currencies@1.4.0-acme.1/currencies.json
/site/acme/currencies@1.5.0-acme.1/currencies.json
```

`1.4.0` did not become wrong when `1.5.0` appeared. There is no unpublish, so
a consumer pinned to it keeps working — which is why the fork could take its
time.

## One law you can watch refuse you

`latest` may only name a **stable** release. The demo tags the `-acme.N` line
with its own dist-tag because the store rejects pointing `latest` at a
prerelease. Try changing it and see: a range must never drift into a
prerelease, and `latest` must never be what drags it there (L5).
