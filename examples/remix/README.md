# remix — a fork that copies nothing

```
pnpm --filter @cardstack/deck-example-remix demo
```

Two pages. The same application code renders both.

| | |
| --- | --- |
| `catalog/notes-app@1.0.0` | four modules, published and sealed |
| `you/my-notes` | **two files**, one of which is a six-line theme |

The remix's entire decklist:

```json
{
  "deck": { "extends": "catalog/notes-app@1.0.0" },
  "imports": { "notes/theme": "/site/you/my-notes/theme.js" }
}
```

`app.js`, `list.js` and `item.js` are not copied, not forked, and not
present in the remix. They resolve to the catalog's sealed Version — the
same URLs the parent page uses, which the browser may already hold.

Both pages print the import map the server actually injected. Four entries
on each; three of them identical.

## What to notice

**The remix is smaller than one module of the app it remixes.** Not
"efficiently stored" — the other modules do not exist anywhere but upstream.

**You cannot write to the parent.** The catalog answers GET and HEAD (L12),
so editing a module you remixed cannot mean editing the catalog's copy. It
can only mean the module becomes a file in your own deck. Copy-on-write per
module, enforced by the protocol rather than by convention — and your deck's
file listing is therefore the changeset.

**Upgrading is one line.** When the catalog publishes `1.1.0`, the remix
moves by editing `extends`. The three inherited entries follow. Under a
copy-the-app model the same step is a merge across every file you took.

**The parent has to be an exact Version.** L4 is what makes inheriting safe:
`@1.0.0` cannot change under the remix. A tag could, and every deck built on
it would drift at once — so `extends` refuses tags and ranges.

## Where the mechanism lives

- `@cardstack/deck/inherit` — `parseExtends`, `flattenInheritance`,
  `resolveInheritance`. Pure and browser-safe; the merge is a function of
  the chain and nothing else.
- The server flattens the chain before injecting, so the browser receives
  one ordinary import map and never learns that inheritance happened.
