# Examples

Each one is a **use case from [docs/deck-use-cases.md](../docs/deck-use-cases.md)**,
built to show what the protocol makes possible — not to prove the code runs.
That is what `pnpm test` and `deck conform` are for.

Every example is a **realm directory** (`<publisher>/<package>/…`) served by
the reference server, so the URLs you see in the browser are the protocol's
real address space, not a demo router.

| Example | Workload | Shows |
| --- | --- | --- |
| [codelist](codelist/) | W2 — shared reference data | Two people amend one table concurrently and both land. A fork absorbs upstream and keeps its own codes. Every state is at rest, at an immutable URL. |

## On the libraries

Where an example needs a real dependency it vendors one **from npm source**
into its own store — never a CDN at runtime. Whether that is possible is a
property of what the package publishes, not of Deck, and it is worth knowing
before you design around one.

Probed against the live registry (2026-08-08). **Source mode works — the
tree npm published is intact and runnable:**

| Package | Modules | Note |
| --- | ---: | --- |
| `lucide@0.469.0` | 1549 | one module per icon; a good scale test |
| `three@0.160.0` | 374 | 0 externals, 0 rewrites — the best case in the ecosystem |
| `date-fns@4.1.0` | 304 | ideal for a date field |
| `chroma-js@3.1.2` | 102 | colour field |
| `leaflet@1.9.4` | 85 | 83 relative imports extension-completed |
| `yaml@2.7.0` | 73 | |
| `zod@3.25.76` | 41 | pass `--entry` — the automatic pick lands in `v4/locales` |
| `luxon@3.5.0` | 24 | |
| `uuid@11.0.5` | 21 | |
| `nanoid@5.0.9` | 2 | |
| `highlight.js@11.11.1` | 2 | the ESM entry re-exports a built core |

**Needs its dependency tree** — vendorable, but as a tree rather than alone,
because a deck that would reach the live web at runtime is not sealed (L6):
`chart.js` (`@kurkle/color`), `tone` (`standardized-audio-context`, `tslib`),
`mermaid` (27 references).

**Ships a single built bundle**, so the module boundary is destroyed at
publish and only its source map can recover it (map mode — readable and
diffable, deliberately not runnable): `prosemirror-model` (one 123 KB file),
`@codemirror/state` (144 KB), `@codemirror/view`, `@lezer/common`,
`pdfjs-dist`, `katex`, `dompurify`, `marked`, `fuse.js`, `immer`,
`papaparse`, `mustache`, `dinero.js`, `@tanstack/table-core`. `lit` looks
per-file but its 77 "modules" are ~90-byte re-export shims. `d3` is a third
case again: six files re-exporting 30 `d3-*` packages, so its boundary is the
package graph.

**The honest summary: most of the modern ESM ecosystem ships bundles.**
Source mode is the good case, not the common one — which is the whole
argument for map mode existing, and the reason `three` is worth pointing at
so often. See
[docs/deck-vendor-source-mode.md](../docs/deck-vendor-source-mode.md) for how
the boundary is recovered, and how a vendored `three` is verified
blob-for-blob against `mrdoob/three.js` at the commit npm recorded.

Probing this list also found a real bug: `uuid` has
`export default 'ffffffff-…'`, and the module lexer was reading that string
as a specifier, so the package appeared to depend on something named after a
UUID and failed hermeticity for a reason that did not exist. An `export` only
has a specifier after `from`. Fixed, with the case pinned in
`packages/core/tests/es-lexer-test.ts`.

## Running one

```bash
pnpm install
pnpm --filter @deck/example-codelist demo
```

The store each demo builds lives under `<example>/realm/.deck/` and is
gitignored — delete it and re-run to rebuild from nothing.
