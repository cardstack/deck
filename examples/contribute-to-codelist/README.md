# Contribute to a codelist — fork, amend, offer, review

```bash
pnpm --filter @deck/example-contribute-to-codelist demo
# open http://localhost:8794/
```

[`codelist`](../codelist/) shows the merge as a finished fact: four sealed
states at immutable URLs. This one shows how a proposal gets **made**, kept
mergeable, and reviewed — with no branch, no patch queue, and nothing checked
out.

## A contribution is a tree that exists

`deck fork` copies the sealed upstream tree into the contributor's own
publisher scope and records what it forked, in the fork's own import map:

```json
"forkedFrom": {
  "package": "std/currencies",
  "version": "1.4.0",
  "treeHash": "0561c77c6c18…",
  "actor": "ana"
}
```

That single recorded hash is the third input a three-way merge needs, and it
is **exact** — not inferred from a commit graph. So `/site/_offers` can answer
"does this still merge?" at any moment, for every open proposal, by re-merging
on read.

Note what is *not* in the depot: `std/currencies` has no directory here. It is
somebody else's published deck. A contributor never checks it out.

## What the demo runs

```
1) std/currencies@1.4.0 — 10 codes
2) app/picker@1.0.0, pinned to /site/std/currencies@1.4.0/index.js
3) two forks
   ana/currencies   + XCD, SRD
   kim/currencies   + ZWG, and a rename of JPY
4) the queue, before upstream moves
   ana/currencies   current
   kim/currencies   current
5) std/currencies@1.5.0
   + ZWG            ← Kim added the same entry: agreement, not conflict
   ~ JPY "Yen (Japan)"  ← Kim wrote "Japanese Yen": one key, two answers
   ana/currencies   rebased
   kim/currencies   conflicted   ← currencies.json
6) the daemon, for real
   ana/currencies  12 → 13 codes; absorbed ZWG and the JPY rename
   kim/currencies  untouched, byte for byte
   1 rebased on the first pass, 0 on the second.
```

Three properties the demo asserts rather than narrates, and fails on:

- **the conflict is in the data, not the manifest.** Both sides changed
  `JPY.name`. Everything else — including ZWG, which both added identically —
  merges silently. JSON is merged by key, so a neighbouring line is never a
  conflict.
- **a conflicted merge writes nothing.** Kim's working tree is compared byte
  for byte before and after the daemon pass. A machine must never damage a
  contributor's tree.
- **the loop converges.** A second pass rebases zero trees. An unattended
  daemon that keeps finding work would publish itself forever.

## Reviewing is a different resolution of one import

The app imports `std/currencies` once and knows nothing about forks. Four
views, one sealed page:

| URL | what resolves |
| --- | --- |
| `…/index.html` | `std/currencies@1.4.0` — immutable, `x-deck-preload: 2/2` |
| `?with=std/currencies@1.5.0` | another version |
| `?with=std/currencies=ana/currencies` | a fork, **live** — every save |
| `?with=std/currencies=kim/currencies` | the conflicted one, still readable |

A trial is `cache-control: no-store` and carries `x-deck-with`, because it is
not the sealed representation and must never be mistaken for it.

The page labels itself with `import.meta.url` of the module it actually got —
not with what the query string asked for — and diffs it against
`/site/std/currencies@1.4.0/currencies.json`, fetched directly, which `?with=`
cannot move. That is what makes the `+1 ~1 −0` honest.

It also renders `/site/_offers` inline, so the review console is the app
itself. The forks are live working trees: edit
`depot/kim/currencies/currencies.json` and reload.
