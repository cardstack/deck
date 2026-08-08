# The demo hub

```bash
pnpm demo
# open http://localhost:8789/
```

One command, one URL, every demo. The hub starts each example as its own
process on its own port — because each one really *is* a separate realm with
its own content-addressed store, and pretending otherwise would be the first
lie — and serves a console that puts three things side by side for each:

- **the explanation** — what is going on and what to look at
- **the app** — the demo's own page, live, in a frame
- **the transcript** — what `node demo.mjs` actually printed while it built
  its store

The transcript is the point. Every demo measures rather than asserts, and its
console output is a better account of what happened than any prose. So the hub
captures stdout per child and shows it.

It also serves the [Deckbook](../../deckbook.html), and each demo's own store
browser is one click away under **Try it yourself**.

| | |
| --- | --- |
| hub | 8789 |
| codelist | 8790 |
| fork-an-app | 8791 |
| fork-a-language | 8792 |
| field-library | 8793 |
| contribute-to-codelist | 8794 |

Ctrl-C stops all of them. The demos that vendor from npm (`fork-an-app`,
`field-library`) take a few seconds on a cold run; the rail shows a pulsing
dot until each one answers, and readiness is "it answers", not "it printed
something".

## Look and feel

Light theme, Boxel tokens — the same surface tier the workspace chrome uses in
`packages/base/workspace.gts`: one stage colour, white surfaces, hairline
borders, a teal interactive, and shadows that stay under the content rather
than announcing themselves. The Deckbook and the store browser were moved onto
the same palette so the whole thing reads as one product.

## A bug this found

`/` was unconditionally the store browser, so the `fallback` option every demo
passes to `createDeckServer` silently did nothing — each demo printed a root
URL that landed on the store browser instead of the app it had just built.
A caller that supplies a fallback has an app to put at the root; `/_browser`
is always the browser, so nothing was lost by moving it out of the way.
