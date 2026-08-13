# A package resolves through its own map

**Status: SUPERSEDED for the consuming depot** (2026-08-12) by
[`deck-package-json-and-depot-lock.md`](deck-package-json-and-depot-lock.md).
A package's `package.json` is a suggestion; the depot-root import map is
the only resolution authority. Same pack, two depots, two programs — that
is the owner's jurisdiction. This file remains the record of the earlier
ruling and still describes sealed-map behaviour for trees that have no
depot lock (dual-lock fallback).

**Status: RULING** (2026-08-11). Companions:
[`deck-multi-package-design.md`](deck-multi-package-design.md) (the map format,
and the design this narrows),
[`deck-a-package-carries-its-own-name.md`](deck-a-package-carries-its-own-name.md)
(where the package's identity lives),
[`deck-depot-and-realm-backport.md`](deck-depot-and-realm-backport.md)
(depot / realm vocabulary).

---

## 0. The ruling

> **A module inside a published Version resolves its imports through that
> Version's own sealed map. The depot's map resolves what is not packaged,
> and nothing else.**
>
> A depot-level entry that a packaged module depends on is an escape hatch. It
> should be rare, and its rarity is a design property rather than a style
> preference.

---

## 1. Why: a Version that resolves differently is not a Version

The whole promise of `crm@2.0.0` is that the name denotes one thing. If a
module inside it asks for `@money/` and the answer comes from the depot
currently hosting it, then the same Version is two different programs in two
different depots. Nobody can reproduce a bug, nobody can trust a pin, and the
seal certifies bytes whose behaviour it does not determine.

A sealed map fixes that. `crm@2.0.0` was published against a specific
`@money/`; that pin travels inside the pack; a consumer who pins `crm@2.0.0`
gets the whole of what was published, not a recombination of it.

This is the same rule as
[`deck-multi-package-design.md`](deck-multi-package-design.md) §5 — "inside a
published version, an `@alias` import resolves through the sealed map, which
pins it" — stated as an invariant rather than as a property of snapshots.

## 2. Why: a depot-wide table is unreadable at the point of use

A module says:

```js
import { pick } from 'palette';
```

Under a depot-wide map, that line tells you nothing about which version you
get. The answer lives in a file somewhere above, applies to every module at
once, and can be changed by someone editing an unrelated part of the depot.
It is a global mutable variable with the ergonomics to match.

Under this ruling, the answer lives in the manifest beside the module, and it
travels with it. The line still says `palette`; the difference is that
"which palette" is now a local question with a local answer.

## 3. What the depot map is still for

It does not disappear, and pretending it could would be wrong:

- **Unpackaged content.** A depot is a working tree. Loose files that belong
  to no package still import things, and they need a resolution context. This
  is the ordinary case and it is not an escape hatch.
- **Deliberate override.** A remix writes a map that `extends` a parent in
  order to change one entry. That is the mechanism working as designed — an
  override that somebody chose, wrote down, and can be read back.
- **Genuine escape.** Forcing a pin across everything, briefly, while
  something is fixed.

The test that separates these from misuse: **could a packaged module's
behaviour change because of this entry?** If yes, and that was not the intent,
the package is mis-scoped and the fix is to seal the dependency rather than to
tune the depot.

## 4. What this changes about the build

- **Resolution is per-depot today, not per-importer.** The realm service
  builds one flattened decklist per realm and hands it to every importer. Per-
  link base resolution already exists for `extends` chains; it is not applied
  to packs-as-importers, which is the gap this ruling names.
- **The gap is why cross-package dependencies do not work yet.** A pack
  carries no lock (the packer emits `packages` and nothing else), and even if
  it did, nothing would consult it. Both halves are needed and neither is
  large.
- **Precedence has to be stated, not discovered.** When a packaged module has
  a sealed answer and the depot has one too, the sealed answer wins. Anything
  else reintroduces exactly the non-reproducibility this ruling exists to
  remove.

## 5. Not decided here

- ~~**Whether a depot may ever override a sealed pin.**~~ **Settled** by
  [`deck-who-may-intervene.md`](deck-who-may-intervene.md). A sealed pin may
  be advanced *within the range the package itself declared* — permission
  granted in writing at publish time, so it is not a depot second-guessing a
  package. Out-of-range remains open there.
- **What a packaged module's *unsealed* imports mean.** A `$DECK/` reference
  is documented as the deliberate live escape hatch; whether a bare specifier
  with no sealed answer should refuse to resolve, or fall through to the
  depot, is open. Refusing is more honest and more annoying.
- **How a depot presents the difference** — a reader looking at a module
  should be able to tell which of its imports are sealed and which are
  ambient, without opening two files.
