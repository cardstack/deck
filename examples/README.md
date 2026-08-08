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
into its own store — never a CDN at runtime. Which libraries can be vendored
that way is a property of what they publish, and it is worth knowing before
you design around one. Measured with `deck vendor --probe`:

| Package | Result |
| --- | --- |
| `three@0.160.0` | **374 modules, 0 externals, 0 rewrites** — true source ESM, the best case |
| `leaflet@1.9.4` | **85 modules, 0 externals**, 83 relative imports extension-completed |
| `chart.js@4.5.0` | needs `@kurkle/color` — vendorable, but as a *tree*, not alone |
| `tone@15.0.4` | needs `standardized-audio-context` and `tslib` — same |
| `d3@7.9.0` | six files re-exporting 30 `d3-*` packages: the boundary is the package graph |
| `@tanstack/table-core@8.20.5` | ships one built bundle — source only via its source map (map mode) |

The last three are not failures of vendoring, they are facts about the
packages, and Deck refuses rather than pretending: a deck that would have to
reach the live web at runtime is not sealed (L6). See
[docs/deck-vendor-source-mode.md](../docs/deck-vendor-source-mode.md) for how
the module boundary is recovered, and how a vendored `three` is verified
blob-for-blob against `mrdoob/three.js` at the commit npm recorded.

## Running one

```bash
pnpm install
pnpm --filter @deck/example-codelist demo
```

The store each demo builds lives under `<example>/realm/.deck/` and is
gitignored — delete it and re-run to rebuild from nothing.
