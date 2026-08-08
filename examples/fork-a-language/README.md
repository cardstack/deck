# Fork a language — keep the engine, replace the syntax

```bash
pnpm --filter @deck/example-fork-a-language demo
# open http://localhost:8792/
```

`lang/jqish` is a small jq-shaped filter language: a parser, an evaluator,
and an entry that wires them together. `me/jqish` replaces **one file** — the
parser — with a FEEL-shaped surface language.

```
jqish     .items | select(.qty > 2 and .tag == "book") | .title
feelish   items[qty > 2 and tag = "book"].title
feelish   items[qty in [2..8]].title          ← ranges, which jqish has no syntax for
```

## The point

`eval.js` is **byte-identical** across both decks, so the store holds one
copy and both dialects are provably running the same semantics. The demo
verifies this rather than asserting it: it hashes the files, then asks the
same question in both dialects and compares answers. If the fork ever
changed behaviour, the demo fails instead of shipping.

```
changed: parse.js
shared:  eval.js, index.js   ← one object each
6 objects in the store for two 4-file decks; two full copies would be 8
```

## The added feature is the interesting part

`qty in [2..8]` is a real FEEL range, and upstream cannot parse one at all.
It did not need to learn: the range **desugars inside the parser** to
`qty >= 2 and qty <= 8`, two comparisons the shared evaluator already
understood.

So the fork adds a language feature with **zero change to the evaluator** —
which is exactly why the two decks can still share it, and why the store
cost of the whole new dialect is a single object.

## Why this generalises

The AST is the contract between syntax and semantics. Any language whose
parser is a separate module can be re-surfaced this way: a policy DSL that
should read like FEEL for one team and like Excel for another, both running
one audited evaluator, both addressable, neither a hard fork of the other.
