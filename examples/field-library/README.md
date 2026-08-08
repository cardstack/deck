# A field library — aliasing, scopes, and dedupe across many decks

```bash
pnpm --filter @deck/example-field-library demo
# open http://localhost:8793/
```

Six card fields, each in its own deck, sharing a shelf of five npm libraries
vendored from source. This is the first example where enough decks are on one
page for the *resolution* rules to matter, and all three of them show up.

## Aliasing — the specifier is not the deck name

Every field's source writes the specifier npm taught it:

```js
import { format } from 'date-fns/format.js';
import * as zodNs from 'zod';
```

Neither is a deck. The decks are `lib/date-fns` and `lib/zod`, and one line of
the field's decklist connects the two:

```json
"dependencies": { "date-fns": "lib/date-fns@^4.1.0", "zod": "lib/zod@^3.25.0" }
```

The key is the import specifier; the value names the deck that answers to it.
So vendored npm source stays unmodified, and the realm names things its own
way. It is the same substitution `?with=` performs at serve time, made durable
in the lock.

## Scopes — two chroma-js versions in one document

`fields/swatch` wants `chroma-js@^3.1.0`. `fields/brand-swatch` pins `2.6.0`,
because its ramps were signed off against that version's numbers. Both write
`import chroma from 'chroma-js'`. Both render on the same page.

That works because each deck's dependencies resolve inside its own URL prefix:

```json
"scopes": {
  "/site/fields/swatch@1.0.0/":       { "chroma-js": "/site/lib/chroma-js@3.1.2/index.js" },
  "/site/fields/brand-swatch@1.0.0/": { "chroma-js": "/site/lib/chroma-js@2.6.0/index.js" }
}
```

A flat import map has one slot for `chroma-js`. One of the two decks would
have to lose, and nothing would say which.

## Dedupe — an outcome, not a pass

Thirteen dependency edges across six decks collapse to **six** library URLs.
Nothing computes that: identical ranges resolve to identical versions,
identical versions are identical URLs, and identical bytes have identical
names in the store.

```
13 dependency edges → 6 distinct library URLs
  lib/zod@3.25.76       6 consumers
  lib/luxon@3.5.0       2
  lib/nanoid@5.0.9      2
  lib/date-fns@4.1.0    1
  lib/chroma-js@3.1.2   1
  lib/chroma-js@2.6.0   1     ← the deliberate second copy

file slots across every pack: 556
distinct objects:             496
if each field carried its own copies: 639 files
```

The consequence you can feel is in the browser, and the page checks it live:

```js
dueDate.schema instanceof handle.modules.zod.ZodType   // → true
```

One URL is one module instance, so a schema built by one deck validates under
another deck's zod. With two copies that expression is `false`, and the failure
is famously baffling to debug. Nobody arranged for it to be true here.

## What the page does

It imports six field decks and **not one library**, then reads its own injected
import map back out of the DOM and reports what actually resolved — so the
tables are measurements of the page you are looking at, not narration.

## The lock is checked in

`deck lock` writes the resolved pins into each deck's `importmap.json`, in the
tree, where you can read them. Those files are committed, so a clean run
produces no diff. If a library ever resolved differently, the demo says so and
rewrites them rather than pretending.

## Two bugs this example found

Both were in the sealed-document `modulepreload` closure, and both were
invisible — the page worked, the header just never appeared.

- `documentEntries` accepted only an absolute script `src`. The common
  spelling, `src="./library.js"`, dropped out of the walk entirely.
- The sealed route built the document URL from a tree path with no leading
  slash: `…@1.0.0index.html`. Relative resolution then walked out of the
  package and no scope prefix matched.

Fixed, with regression tests in `packages/server/tests/`. The page now
advertises `200/279` — 200 links emitted out of 279 modules reachable, the
rest over the byte budget and reported as clipped rather than hidden.
