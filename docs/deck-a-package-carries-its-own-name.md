# A package carries its own name

**Status: RULING** (2026-08-11). Companions:
[`deck-a-package-resolves-through-its-own-map.md`](deck-a-package-resolves-through-its-own-map.md)
(the same instinct applied to resolution),
[`deck-name-derivation-ruling.md`](deck-name-derivation-ruling.md) (how names
are derived when a fold is lossy),
[`deck-multi-package-design.md`](deck-multi-package-design.md) (the design this
corrects), [`deck-laws.md`](deck-laws.md) (paths are IDs).

---

## 0. The ruling

> **A package's name and version live in the package, in its own manifest.
> The depot that holds it does not name it.**
>
> The namespace is **optional**, and a package without one is **depot-local**:
> it may be held and served, and it may not be published where anyone outside
> that depot can pin it.

---

## 1. Identity must not be positional

A depot is a place that holds and serves. A publisher is who stands behind a
name. Conflating them means that moving a package renames it — and since a
pin is a name, every pin breaks on a move that changed nothing about the
bytes.

That is the failure Deck has already ruled against in general: paths are IDs,
identity comes from content, and a name is a resolution key rather than a
location. A package whose namespace is read off its host contradicts all
three.

The concrete version: `experiments/crm` should not be called that *because*
the `experiments` realm published it. It should be called that because its
manifest says so. Copy the directory into another depot and it is still
`experiments/crm` — the same package, in a second place, which is exactly what
a content-addressed system should make cheap.

## 2. Deck already works this way

`discoverDecks` states the model in a comment: *"a directory two levels down
holding an `importmap.json` IS a deck. Nothing registers; nothing is
configured."* Discovery is a scan for manifests. There is no registry in the
depot listing what it contains, because the packages say what they are.

So the per-package manifest is not a new idea to be adopted. It is the
existing model, and a depot-level registry of packages is the deviation.

### 2.1 A tension worth recording

`discoverDecks` derives `publisher` and `package` from the *directory names*
— which is positional identity, the thing §1 argues against. In a standalone
depot with a fixed two-level layout that is a reasonable convention, and it is
cheap because the layout is the depot's own.

The reconciliation: **the manifest is authoritative; the layout is a
convention that should agree with it.** A scan may use position to find
candidates. What a package is called comes from what it says, and a
disagreement between the two is an error to report rather than a precedence
rule to memorise.

## 3. Optional, and optional means local

The store's name grammar already accepts both `<publisher>/<package>` and a
bare `<package>`. The question is what the bare form *means*, and leaving that
unanswered is how two depots end up both publishing `crm` into shared space
and letting arrival order decide.

**A bare name is depot-local.** It resolves inside the depot that holds it and
is not publishable beyond it. No ceremony while a package is nobody else's
business; the namespace is what you add when you want somebody to pin it, and
adding it is the visible moment the thing became public.

Requiring a namespace always taxes every private package for a collision that
cannot occur. Allowing a bare name everywhere trades a small convenience for
an ambiguity that surfaces as somebody else's outage.

## 4. What this changes about the build

- **The depot-level `packages` registry becomes the manifest in each package.**
  `deck-multi-package-design.md` §2 puts it in the depot's `importmap.json`;
  this moves it. That document should be read as superseded on this point.
- **A packer that refuses a package directory carrying its own
  `importmap.json` has it backwards.** The Boxel backport currently refuses
  exactly that (`root-has-own-map`) and generates a manifest instead. The
  refusal inverts into the requirement, and generation becomes validation.
- **Deriving the namespace from the host is wrong.** The backport's
  `storeNameFor(publisher, key)` reads `publisher` out of the realm's map,
  which is the positional identity §1 rejects.
- **Publishing gains a check it did not need before:** that a package about to
  be published beyond its depot has a namespace.

## 5. Not decided here

- **Who guarantees a namespace is yours.** Uniqueness inside one store is
  mechanical; across stores it is a claim, and a claim needs either a registry
  or a signature. The keyring exists; whether a namespace is *endorsed* rather
  than merely asserted is the open question, and it is the same shape as every
  other trust question in the system.
- **Whether local → namespaced is a rename or a new package.** It is probably
  a new package: the name is the identity, so a different name is a different
  thing, and pretending otherwise would let a pin change meaning. But that
  makes promotion more expensive than it looks, which deserves its own
  thought.
- **What a depot does with two packages claiming one name.** Refusing the
  second is obvious and unhelpful when the second is the one you wanted.
