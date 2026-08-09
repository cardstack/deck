# The catalog is a realm with Deck, behind a CDN — and what that buys

**Status: ANALYSIS** (2026-08-09). Companions:
[`deck-efficient-delivery-spec.md`](deck-efficient-delivery-spec.md) (minify
variants, wire compression, modulepreload over H2/H3),
[`deck-unpkg-comparison.md`](deck-unpkg-comparison.md),
[`deck-boxel-backport-plan.md`](deck-boxel-backport-plan.md) (K2, K5, K8, K9).

---

## 0. The claim

The Boxel catalog is not a new kind of thing. It is:

> a **realm** — placement-free, indexed, searchable, exactly as today —
> that speaks **Deck**, hosted, with a **CDN in front**, the way unpkg sits
> in front of npm.

Nothing about it needs to be special-cased. And the consequence is larger
than "the catalog gets faster": it is a second, independent route for getting
cards and libraries into the browser's cache — **without bundling**, and not
just in code mode. Interact mode too.

Then a consequence of *that*, in §6: once every byte lives at an immutable
URL behind one origin, a **remix stops being a copy of an app and becomes an
import map** — a few hundred bytes that override the entries you changed and
inherit the rest, already cached.

---

## 1. What "no bundling" actually requires

Bundling is usually defended as one thing. It is three, and a CDN alone
supplies only the first.

| Requirement | What it solves | Who supplies it |
| --- | --- | --- |
| **Parallelism** | many files without many connections | H2/H3 — a CDN |
| **Discovery** | knowing every URL *before* parsing reveals it | a **sealed** tree — Deck |
| **Immutability** | repeat visits cost nothing | **exact Versions** — Deck |

The middle row is the one people skip, and it is the one that actually makes
unbundled loading slow. From `packages/server/src/preload.ts`:

> A bundle's real advantage on a cold network is not that it is one file. It
> is that the browser learns every URL at once. Loading `a → b → c` as
> separate modules costs a round trip per LEVEL of the graph, because each
> import is only discovered after its parent parses. Multiplexing does not
> fix that; H2 lets you fetch many things at once but cannot tell you what to
> ask for.

So: HTTP/3 removes the *bandwidth* argument for bundling. It does nothing
about the *latency* argument. `modulepreload` over a computed closure removes
that one — and the closure is computable only because a sealed tree lists
every file and the lexer says what each imports. A live, mutable realm path
cannot promise that; a Version can.

The third row is the same story. Today realm modules go out `public,
max-age=0` (`realm.ts:3298`, `:3773`) or `max-age=60, must-revalidate`
(`:3851`). That is correct — a realm path is mutable, so the browser has to
ask. An exact Version is not mutable, so it can be `immutable` and the
browser never asks again.

**Deck + CDN supplies all three. That is why "no bundling" is a claim rather
than a hope.**

---

## 2. Connection sharing — the part that is invisible until you count

Real numbers from `~/boxel-workspaces`. The corpus imports from five
distinct origins:

```
https://cardstack.com              base fields — 118 card-api, 86 string, …
https://esm.sh                     leaflet, three, three-bvh-csg
https://esm.run                    tone, chess.js, cm-chessboard, three
https://unpkg.com                  (in the tone.js pattern)
https://realms-staging.stack.cards cross-realm imports
```

And individual cards hit several. The Tone.js pattern card alone reaches
**three origins** — `cardstack.com`, `esm.run` and `unpkg.com` — before it
can render.

Three origins means three DNS lookups, three TCP/QUIC handshakes, three TLS
negotiations, three cold congestion windows, three independent failure
modes — all on the critical path of one card. None of that shows up in a
bundle-size budget, and all of it is serial with respect to first paint.

Behind one CDN origin it is **one connection**: one handshake, 0-RTT on
resumption, one congestion window that stays warm across every subsequent
card, no head-of-line blocking under QUIC, and connection migration when the
user's network changes.

### 2.1 What cache sharing does and does not mean

Worth being exact, because the folklore is out of date.

**It does not mean cross-site sharing.** Browsers partition the HTTP cache by
top-level site (Chrome, Safari and Firefox all ship this). The old unpkg
pitch — "everyone already has jQuery cached from another site" — has not been
true for years. Deck must not claim it.

**It does mean sharing within Boxel, which is where it matters.** Under one
top-level site, every realm, every card, the base fields and every vendored
library served from **one origin at immutable URLs** land in one cache
partition and one connection. Open a second card that shares nine-tenths of
its closure and the nine-tenths are already there — not revalidated, *there*,
because `immutable` means the browser does not ask.

That is the compounding effect: the marginal cost of the second card, the
tenth card and the remix of a card all fall towards the size of what is
genuinely new.

**Connection coalescing** is the lever that keeps it true as realms multiply.
H2/H3 will reuse one connection across different hostnames when they resolve
to the same address and one certificate covers both. Realms on subdomains,
served through one CDN anycast address under one wildcard certificate,
coalesce. Spreading realms across unrelated origins forfeits it. This is a
deployment decision that quietly decides whether the whole argument holds.

---

## 3. Why this matters in interact mode, not just code mode

Bundling is usually justified as "fine for dev, necessary for production".
Interact mode is production: it is a person using the app.

Three things follow from having no build step there.

**The same bytes serve both modes.** No dev/prod pipeline divergence, so no
class of bug that only appears in the built artifact. What you edited in code
mode is what runs in interact mode, byte for byte, addressable by the same
URL.

**A card can be opened without its app.** Bundles have entry points; a card
is not an entry point. Unbundled modules at stable URLs mean any card is
directly reachable, which is what makes cards linkable, embeddable and
independently cacheable in the first place. Bundling would have to be
undone to get that back.

**The cache survives publishing.** Publish a new Version of one deck and only
that deck's URLs change. Every other entry in the map still points at bytes
the browser already holds. With a bundle, one changed module invalidates the
whole artifact for every user.

The cost side is honest: unbundled means more requests. Over one warm QUIC
connection with a preload closure and `immutable` responses, more requests is
cheap. Over three cold origins with `max-age=0`, it is not — which is exactly
today's shape, and exactly why bundling looks attractive from here.

---

## 4. The shape

```
                    ┌── CDN (HTTP/3, brotli at the edge, one origin) ──┐
browser ────────────┤                                                  │
   one QUIC conn    │   immutable:  /catalog/<pub>/<pkg>@<version>/…    │
   one cache bucket │   short TTL:  /catalog/<pub>/<pkg>  (tag lookup)  │
                    │   no-store:   live / working tree                 │
                    └──────────────────┬───────────────────────────────┘
                                       │  cache miss only
                            ┌──────────┴───────────┐
                            │  catalog realm       │
                            │  = realm + Deck      │
                            │  indexed, searchable │
                            └──────────────────────┘
```

The three cache classes are the whole policy, and they follow from the
protocol rather than from tuning: an exact Version can never change (L4), a
tag can move, live changes constantly.

Origin work stays cheap by design — `compression.ts` already reasons this
way: gzip at the origin because it is cheap and universal, brotli at the
edge, "where it is cached and paid for once". The edge cache *is* the
precompressed store.

---

## 5. What the catalog keeps by still being a realm

Not a rewrite, not a second system:

- **Indexing and search.** The Deck store sits behind the realm file system.
  The indexer keeps reading the live tree.
- **Spec cards, `adoptsFrom`, LibSpec.** `packages/base/spec.gts` already
  carries `ref` and `moduleHref`; a LibSpec is a Spec whose ref points into
  a vendored package. Browsable and searchable with no new card type.
- **Placement freedom.** Cards stay where they are; `publisher/package` is
  one way to lay out a depot, not a requirement.
- **Write path, auth, realm events.** Unchanged.

What is added is a read-only, content-addressed second address space over
sealed trees, and a CDN in front of it. Sealed Versions are not indexed as
instances — they are bytes at an address, which is the right answer.

---

## 6. Remix, rethought: a decklist, not a copy

This is the consequence worth restating, because the current framing
undersells it.

**Today's mental model.** Remix = copy the app into my realm, then edit my
copy. Cost is O(size of app), forever: my copy drifts, upstream fixes do not
reach me, and the bytes are duplicated per remix.

**What it becomes.** A remix is an **import map that inherits**. It names a
parent Version and overrides the entries you actually changed:

```json
{
  "extends": "catalog/blog-app@3.2.0",
  "imports": {
    "blog-app/post-card": "/me/my-blog/post-card@1.0.0/index.js"
  }
}
```

That is the entire artifact. Two hundred modules in the parent, one of them
yours, and the file is a few hundred bytes.

Three things make it work, and all three are already in the plan:

1. **Immutable URLs behind one origin (§2).** The 199 inherited entries
   resolve to URLs the browser very likely already holds. A remix of a large
   app downloads *one file*.
2. **Scopes (Seam A).** Overriding one module means everything that imported
   the old one must now get yours. That is a scope rewrite, and it is exactly
   why `resolveSpecifier` needs the importer. Without scopes, remix-by-map
   does not work — it is the mechanism, not a nicety.
3. **A parent that cannot move (L4).** `@3.2.0` is a tree hash. Inheriting
   from something mutable would make a remix a promise nobody can keep.

### 6.1 You cannot write to the catalog, so an edit *is* a fork

This is the part that makes the model clean rather than merely cheap.

The catalog serves GET and HEAD and nothing else (L12 — the read-only gate
runs before any route). So "remix an app from the catalog, then change
something" has exactly one possible meaning. It cannot mean mutating the
catalog's module, because that operation does not exist. It can only mean:

> that module is now **mine**, it lives as a local file in **my** realm, and
> my map's entry for it points at my copy instead of the parent's.

The fork is **implicit, per-module, and automatic** — copy-on-write at module
granularity, enforced by the protocol rather than by anyone remembering to
follow a convention. There is no "am I editing the original or my copy?"
state to get wrong, and no way to accidentally edit upstream, because the
byte that would have to be written has nowhere to go.

Three consequences fall out.

**Remix is instantaneous.** At remix time nothing is copied. The artifact is
a map that inherits and overrides nothing:

```json
{ "extends": "catalog/blog-app@3.2.0", "imports": {} }
```

Every module resolves to the catalog's immutable URLs, which the CDN is
already serving and the browser may already hold (§2). The app runs
immediately. Remix costs a few hundred bytes and one round trip — or nothing
at all, if the remix is held volatile until the first edit.

**Your realm is the changeset.** It contains exactly the modules you have
touched, and nothing else. Its file listing *is* the diff against upstream —
no comparison pass, no "which of these did I change?" You can read what you
changed by reading `ls`.

**Upgrade stays possible because the surface stayed small.** A remix that
forked three modules out of two hundred rebases onto a new parent by moving
the parent pointer; the other 197 follow. Under the copy model the same
operation is a 200-file merge, which is why forks rot — not because merging
is hard, but because nobody can see which three files were the point.

The same mechanism covers removal: overriding an entry with a stub drops a
module from your app without touching the parent, and it shows up in your
realm as the one file you wrote.

### 6.2 The four verbs are one mechanism

K5 asks for install / upgrade / remix / use as distinct, honest verbs. They
are all operations on a map:

| Verb | The map operation | Cost |
| --- | --- | --- |
| **use** | resolve the parent's map as published | zero — nothing is written |
| **install** | copy the map, pin every entry to exact Versions | one small file; bytes shared |
| **remix** | copy the map, override the entries you changed | one small file + your changed modules |
| **upgrade** | repoint the parent, re-resolve the inherited entries | one edited line |

Upgrade is the one that looks like magic and is not: a remix overriding 1 of
200 entries rebases onto a new parent by changing the parent pointer. The
other 199 follow. Under the copy model that same operation is a merge across
200 files, which is why nobody does it and why forks rot.

### 6.3 Two honest limits

**Remix covers the definition plane.** An app usually wants seed or example
content, and instances are the other plane
(`deck-cardpack-requirements.md` §0). So remix is *map override + optional
instance set*, and the instance half is a copy, not a reference. Worth saying
plainly rather than implying the whole thing is free.

**Overriding a module you did not write is a compatibility claim.** Your
`post-card` must still satisfy what the other 199 modules expect of it.
Nothing in the map checks that. The remix is cheap; keeping it correct across
a parent upgrade is the same work it always was — the difference is that you
now do it for the one module you own, not for two hundred you inherited.

---

## 7. What this rules

1. **The catalog is a realm with Deck plus a CDN.** No new subsystem, no
   special case, no separate registry service.
2. **Three cache classes** — `immutable` for exact Versions, short TTL for
   tags, `no-store` for live — and they come from the protocol, not tuning.
3. **One origin, one certificate, coalesced connections.** A deployment that
   scatters realms across unrelated origins gives up most of the benefit.
4. **Do not claim cross-site cache sharing.** It has not existed for years.
   Claim within-site sharing, which is real and is where the compounding is.
5. **No bundling needs the preload closure**, not just HTTP/3. Multiplexing
   without discovery still pays a round trip per graph level.
6. **Remix is a decklist.** Reframe K8 from "copy less" to "do not copy" —
   and reframe K5's four verbs as four operations on one map.
7. **Read-only serving makes copy-on-write the only available semantics.**
   Because the catalog cannot be written to, an edit to a remixed module can
   only mean "this module is mine now, as a local file". The fork is
   implicit, per-module and automatic — a protocol consequence, not a policy
   anyone has to enforce. A realm's file listing is therefore its changeset.
8. **Remix writes nothing at remix time**, so it is instantaneous. The first
   *edit* creates the first local file.

---

## 8. Open

1. **Cache-key discipline for tags.** A tag lookup at short TTL in front of
   an immutable exact Version is two hops. Worth measuring whether the tag
   hop should be an edge redirect or an edge-computed rewrite.
2. **Preload budget at realm scale.** `preload.ts` caps at 200 links / 1 MB
   and reports what it clipped. A card app's closure may exceed that; the
   cap needs a policy, not a default.
3. **`extends` in a decklist.** §6's inheritance is not implemented — today a
   decklist is flat. Inheritance needs a resolution order, a conflict rule,
   and a depth limit. This is the concrete next protocol question.
4. **Instance-plane remix.** Whether seed content can be referenced rather
   than copied, or whether the instance plane is inherently copy-only.
