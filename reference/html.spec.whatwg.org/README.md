# HTML Standard — import maps (snapshot)

Fetched 2026-08-12 from
[html.spec.whatwg.org/multipage/webappapis.html#import-maps](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps).

This is a local copy of the WHATWG HTML chapter that defines import maps.
It is **not** the living standard. Open the URL above for current text.

| File | What |
| --- | --- |
| [`import-maps.html`](import-maps.html) | Extract: §8.1.4.8 parse results through §8.1.5 (resolution, import maps, processing model) |
| [`webappapis.html`](webappapis.html) | Full `webappapis.html` chapter as downloaded |

Deck's depot lock **is** this format. pnpm lockfile v9 supplies the *rules*
(importers, snapshots, overrides, install-vs-update); the file the browser
resolves is an import map:

- `imports` — module specifier map
- `scopes` — URL prefix → specifier map (longest matching prefix wins)
- `integrity` — URL → SRI metadata
- any other top-level key (`deck`) — spec says warn, do not fail, so
  extensions stay backward-compatible

Resolution, prefix `/` pairing, null-entry blocking, and merge-existing-wins
are in `import-maps.html`. Deck's implementation of specifier lookup is
`packages/core/src/resolve.ts`. The locker that *writes* this shape is
`packages/core/src/lock.ts`.
