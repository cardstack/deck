# Shared across the demos

One source tree, published into every demo's depot.

## `ui/pills` — three kinds of name

Nearly every confusing sentence about a vendored package is confusing because
three different names for "the same thing" are spelled the same way, in the
same font, in the same paragraph:

| | |
| --- | --- |
| `leaflet@1.9.4` | what npm publishes |
| `Leaflet/Leaflet` | where the source lives |
| `/site/lib/leaflet@1.9.4/…` | where **this depot** serves it from |

They are not the same thing, and which one you mean changes what a claim
means. *"Leaflet is 85 modules"* is a fact about the npm tarball. *"The fork
cost 2 objects"* is a fact about the store. *"Fixed in 1.9.5"* is a fact about
the repo.

So no demo prints a bare name. Each one is a pill that says which register the
name is in — **deck** (teal, our delivery and resolution space), **npm** (red,
the published artifact), **github** (neutral, the source). Every page carries
the legend once, so the convention teaches itself.

## How it gets to five depots

It is a deck. Each demo's `demo.mjs` publishes this directory into its own
store from here, and each app declares it as an ordinary dependency:

```json
"dependencies": { "ui/pills": "^1.0.0" }
```

Five separate depots, five separate stores, one source tree — and because
identity is the hash of the tree, `ui/pills@1.0.0` has the **same treeHash in
all five**. Each demo prints it, so you can check.

The hub is not a depot, so it serves this same file statically instead. Same
bytes, different carriage — which is the point of L2/L3.
