# Fork an app — take all of it, change the one thing you disagree with

```bash
pnpm --filter @deck/example-fork-an-app demo
# open http://localhost:8791/   ← look at the zoom controls
```

## The situation

You want somebody else's library, almost all of it, but two details are
wrong for you. On npm that means a downstream build, a patch file, or a
maintained hard fork. Here it means editing one file.

The subject is **Leaflet**, because it publishes real per-file ESM — 85
modules, nothing pointing outside the package. Vendoring keeps the module
boundary intact, so "change one file" means changing one file rather than
patching a 140 KB bundle.

## What the demo does

1. **Vendors `leaflet@1.9.4` from npm source** into the depot's own store,
   with provenance: registry, integrity, and the repo and commit npm
   declared. Not a CDN bundle — the tree npm published.
2. **Forks it** to `me/leaflet@1.9.4-mine.0` and changes
   `src/control/Control.Zoom.js` — different glyphs, different titles.
3. **Serves both**, side by side in one page. Two decks, two treeHashes,
   two Leaflets in one document, no collision.

## The numbers it prints, measured not asserted

```
2 new objects for the fork — the other 86 files are the same bytes,
so the store keeps one copy.  89 objects, not 174.
```

Content addressing is per file and store-wide, so an undiverged file is one
object however many decks point at it. A fork of a library you did not
change costs nothing.

## Two things worth noticing

**The fork edits two files, not one.** `Control.Zoom.js` is the change you
wanted; `importmap.json` is the fork recording its own lineage. That second
edit is why a fork inherits **no** endorsements — it is a different tree
because it *announces* a different lineage, and a signature about upstream's
bytes should not travel to something claiming to be someone else (L10).

**Nothing on the page reaches the network at runtime.** No tile server: both
maps draw vector layers, and even Leaflet's stylesheet is served from the
deck. That is not politeness, it is L6 — a deck that would need a CDN to
work is not sealed, and Deck refuses to seal it.

## Why Leaflet and not something bigger

Most of the modern ESM ecosystem ships single-file bundles: `prosemirror-model`
is one 123 KB file, `@codemirror/state` is 144 KB, `pdfjs-dist` and `katex`
the same. For those the module boundary is destroyed at publish and only the
source map can recover it — readable and diffable, deliberately not runnable.
See [examples/README.md](../README.md) for the full probe, and
[docs/deck-vendor-source-mode.md](../../docs/deck-vendor-source-mode.md) for
how a vendored tree is checked blob-for-blob against its GitHub commit.
