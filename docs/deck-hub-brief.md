# Deck Hub — product brief

Status: **decided.** This resolves the information architecture that
[deck-ui-spec.md](deck-ui-spec.md) deliberately left open, and specifies the
four applications to build.

Read that document first for requirements (§3), jobs to be done (§5),
invariants (§4), constraints (§6), scale targets (§11) and the states that
must exist (§12). None of it is repeated here. This brief adds: which
direction won and why, the four apps, the journeys, the shared parts, the
stack, and what has to be built on the server to support it.

Scope note: the nine demos under `examples/` are **out of scope** and are not
modified. They keep their own processes, ports and depots. Hub work is
additive.

---

## 1. The one differentiator

Every package viewer on the internet shows you a file tree and a README.
unpkg shows bytes. npm shows a page about bytes. GitHub shows source that may
or may not be what shipped.

Deck can do a thing none of them can: **serve the running application and the
readable source from the same address space, at a volatility you choose.**
The bytes the browser executes and the bytes the page shows you are provably
the same tree, because identity is `tree-hash-v1` over the content and
nothing else.

So the product is one sentence:

> **Everything in the Hub is runnable, and one control turns any running
> thing into its own source.**

That control — **run / read** — is the spine. It appears in the same place,
looks the same, and means the same thing in every app.

### This answers open question §13.1

The spec asked whether "lenses" are real or four screens in a costume. The
answer: lenses are real, but there are **two**, not four.

- **run** — the thing executing: an iframe, a rendered table, a harness.
- **read** — the thing at rest: files, versions, dependencies, diffs,
  provenance, history.

The spec's *code*, *data* and *timeline* lenses are all readings of the same
at-rest tree, and splitting them into peer modes is what would make it feel
like four products. They become sub-views inside **read**, chosen by content
type, overridable, and never a mode the user has to remember they are in.

A two-position toggle is a control. A four-position one is a mode.

---

## 2. The four apps

One depot named `hub`, four decks under the `app/` publisher. They are not
depots; they are four documents in one depot, which is why they can share
components at ordinary deck addresses.

| route | canonical address | centre of gravity | workloads |
| --- | --- | --- | --- |
| `/start` | `/hub/app/start/` | this machine now, and the docs | all |
| `/browse` | `/hub/app/browse/` | the tree at rest | W2, W3 |
| `/run` | `/hub/app/run/` | the assembled, executing thing | W1, W4 |
| `/track` | `/hub/app/track/` | what changed, and where | W3, W4 |

**`/read` is gone; `/track` replaces it.** Two moves, one reason each.

The docs fold into `/start`, because a docs site is not a fourth thing you
*do* — it is what you read while orienting, and orienting is what `/start`
is for. Splitting them made `/start` thin and `/read` inert.

`/track` is the surface that was missing: **what has changed**, scoped. Seals,
published versions, and open proposals are three renderings of one question,
and the Hub had them scattered — the seal log buried in `/browse`, the offers
queue nowhere. Scoping is the point: not "everything that happened" but
everything that happened *within this subtree, or in the forks related to
it*. A change river with no scope is a feed nobody reads.

An entry in `/track` deep-links into `/browse`'s diff view, which is why
`/browse` takes `?at=` and `?vs=` as plain addresses rather than internal
state — the two apps compose through the URL and share no code path.

Mapped onto the spec's §7 directions: `/run` is Direction B, `/browse` is
Direction A with Direction D's locator demoted from an IA to a *component*,
`/start` is Direction E at low density, and `/read` is new. Direction C
(workspaces by activity) is the shape of the whole, but the four spaces are
named for **what you are looking at**, not what you are doing — which is what
keeps a deck from appearing in four places under four names.

---

### 2.1 `/start` — is it up, and what just happened

The first thing a person sees after `deck serve`. It answers J1, J2, J4.

**Server facts.** Port, protocol (HTTP/1.1 or HTTP/2), TLS on or off, uptime,
and the depots mounted with their honest on-disk paths. The layout *is* the
address space, so showing the path is showing the truth, not a debug detail.

**Per depot.** Deck count, version count, store object count and size, history
history (a Timeline from jj colocated or historyd, or Versions only), and the
most recent seal.

**The river.** `/_live/events` as a stream of change events — deck name,
treeHash, time. Low density: this is peripheral vision, not a feed to read.
An SSE indicator that is unambiguous when the connection drops.

**Refusals.** Fail-closed is a law (L11), so refusals are product content, not
errors to hide. When the server declines something — an unverifiable claim, a
cross-depot dependency, a malformed spec — it appears here with the reason.

**The self-report.** The Hub grades its own decks: which of its dependencies
vendored as a per-file tree and which came in as a bundle. `marked` will show
as a bundle. That is the point — the tool that argues per-file delivery
matters should say out loud where it did not manage it. See §5.3.

**Not here.** No file contents, no version pickers, no diffs. If a fact needs
more than a line, `/start` links to it and stops.

---

### 2.2 `/browse` — the depot at rest

The GitHub-quality surface. J3, J5, J8, J15, J16.

**The listing.** Depot → publisher → deck, with expandable rows, sortable
columns and a filter. Backed by `@tanstack/table-core`, which is a state
machine and renders nothing — the markup stays ours. Targets from spec §11:
hundreds of decks, thousands of files, thousands of versions.

**The volatility control.** The single most important element in the app, and
the one that makes it not-GitHub. L5 says a deck has exactly three kinds of
address, and they are different URLs:

```
live      /hub/app/browse/browse.js              no-store, every save
range/tag /hub/app/browse@^1.0.0/browse.js       one short-TTL hop
exact     /hub/app/browse@1.2.0/browse.js        immutable, forever
```

It is always visible, always says which one you are on, and changing it
changes the URL. A user must never be unsure whether they are looking at a
frozen thing or a moving one — spec §2.2 lists this first among the things all
four workloads agree on.

**The blob view.** `<pre>` with a span per line and CSS-counter line numbers,
highlighted by `highlight.js`. Measured in Chrome 151: 10,000 lines renders in
53 ms and 50,000 in 286 ms, so no virtualization is needed; above ~2,000 lines
the first 500 render immediately and the rest on idle, which is flat at 2.5 ms
regardless of file size. Line anchors are real URLs.

**The raw relationship.** A browse URL is a viewer URL plus the address it is
viewing:

```
/hub/app/browse/?at=/site/lib/three@0.160.0/src/Three.js     the page
           strip ?at=  →  /site/lib/three@0.160.0/src/Three.js     the bytes
```

One prefix apart, by construction. This is *read me ↔ run me* expressed as a
URL transformation and it should be taught, not hidden — the raw link is
adjacent to the file, always.

**Diff.** Any two addresses of the same deck: live vs sealed, two versions,
a version vs a seal, a fork vs what it forked. The fork's `forkedFrom` gives
the exact merge base, so "vs upstream" is a real answer and not a guess.
Semantic where it can be: JSON diffs by key, because a codelist with two
additions is not in conflict and a line differ says it is (W2's whole point).

**Identity.** `treeHash` and `content-digest` are surfaced, short prefix
inline and full on demand. Spec §13.4 asks how prominent 64 hex characters
should be: the answer is *present everywhere, prominent nowhere* — it is the
proof behind "the fork cost 2 objects", and proofs belong in reach rather
than in the way.

**Provenance and endorsement.** What a vendored deck is a copy of (L8), and
who has signed the tree (L9/L10). A fork inheriting no endorsements is a
state the UI has to show *as correct*, not as missing data.

**History.** When the depot has tier-2 history, the seal log and any file at
any seal. When it does not, that absence is stated, not empty.

**Edge states** from spec §12, all of which must be visibly distinct: binary
content (size, digest, download, no preview), a conflicted proposal, an
invalid spec versus a not-yet-published one, and the never-servable `.deck/`
and `.jj/`.

---

### 2.3 `/run` — the assembled thing, and the toggle

W1's home. J4, J9, J10, J12.

**What is runnable.** Any deck that declares an entry and any HTML page in a
depot, plus the nine demos. A deck with no declared entry — the ProseMirror
`src/` decks are the reference case — appears as **readable, not runnable**,
structurally, because the server refuses to import it. That refusal is L11 as
a shape and belongs in the interface as a state, not a warning.

**The toggle.**

- **run** — the app in an iframe, with its resolved import map alongside.
- **read** — the module graph of *exactly what is executing*: every node, the
  volatility of every edge, and every node a link into `/browse` at the
  address that answered.

The graph is the payoff. On any other package site "what am I actually
running" is an inference; here it is a readout, because the import map the
server injected is the resolution.

**Trials.** `?with=` re-resolves at serve time — swap any node for another
version, a fork, or an open proposal, and run it. No checkout, no branch, no
build. Trials come back `no-store` with `x-deck-with`, and constraint C5 says
they must be visually unmistakable with one action to exit. A banner, not a
badge.

**Compare.** Two frames, one page, two resolutions — which is how the
`variations` demo already works and the pattern that makes A/B/C choosing
possible without a deploy.

**Integration note.** The demos are separate processes on ports 8790–8798.
They currently default to HTTPS with a self-signed leaf, which costs a
click-through per port before an iframe will load. The Hub should launch them
with `DECK_DEMO_HTTP=1` so `/run` works on first load; the HTTP/2 comparison
stays available in `examples/three-js/bench.mjs`, where it is the subject
rather than an obstacle.

---

### 2.4 `/read` — the protocol, with live links

The docs site, and the app with the most product upside.

**The content.** Deckbook (already one self-contained HTML file), the 26
markdown files in `docs/`, and `README.md` / `CLI.md` / `INSTALL.md`.

**Docs become a deck.** `docs/` is currently served by nothing at all — the
Deckbook names `docs/deck-laws.md` six times and links to it zero times,
which is how that gap has stayed invisible. Sealing the docs as `hub/doc/*`
gives them a tree hash, a version, and an address. "Which version of the
contract" becomes a question with an answer.

**The CLI reference is generated.** `packages/cli/src/help.ts` already
generates help from the command registry. `/read` renders the same data
rather than a hand-maintained copy that drifts.

**Pills link.** This is the feature. Every name in prose is already
disambiguated by kind — `deck`, `npm`, `github` — and in the demos those pills
are deliberately inert, because a demo that claims to reach nothing at runtime
should not be full of outbound anchors. **Inside the Hub that contract
inverts.** A `deck` pill links into `/browse` at that exact address. A code
reference in prose links to the file. The docs stop describing the system and
start being an index into the running one.

This needs saying plainly in `pills.js`, because it reverses a decision that
file currently argues for at length. The rule: `github` and `npm` pills stay
inert everywhere (they name things outside this server); `deck` pills link,
but only in the Hub, because only the Hub is authoritative about them.

**Search** across all documents, and the twelve laws as stable anchors that
everything else links to.

---

## 3. Journeys

Each is end to end, uses only what exists, and names the jobs it satisfies.

### J-A · "Did my save land, and does the app still work?" (W1)

Agent edits `app/board.js`. The watcher seals and auto-publishes a
prerelease.

`/start` river shows the change with its new treeHash → click through to
`/run` for `app/board` → **run**: the iframe reloads through HMR → toggle to
**read**: the graph shows `app/board` at *live* and every dependency at a
pinned exact version. One glance answers "is the thing that changed the thing
I changed."

*J2, J4, J8.* Read-only throughout.

### J-B · "What did the other agent do to the shared file?" (W1/W2)

Two agents, one `tokens.json`. `/start` shows both changing.

`/browse` → `std/tokens` → volatility **live** → diff against `@1.3.0`. The
JSON diff shows three keys added under one object, no conflict. Change the
right side to the other fork's address: now two keys have two answers, and
the diff says so at key level rather than line level.

*J3, J5, J15.*

### J-C · "Try someone's proposal without checking it out" (W3)

`/browse` → the depot's offers → a proposal, `conflicted`.

Its `tryWith` value is a URL. Open it in `/run` → the app runs with the
proposal standing in for what it forked, banner up, `no-store`. Toggle to
**read** → the graph shows exactly one substituted node and its scopes.
Decide. Copy the CLI command to take it.

*J11, J12, J13, J14.* Everything up to "take it" is read-only.

### J-D · "A, B or C" (W4)

An agent publishes three prereleases at three layers. Ranges never match
prereleases (C3), so nothing downstream moved.

`/run` → compare → three frames, one sealed page, three `?with=` values.
Choose. `/browse` shows the two rejected ones still present, still addressable,
with no `latest` pointing at them — which is all "not latest" has ever needed
to mean.

*J5, J6, J7.*

### J-E · "What is this, and can I trust it?" (W3)

Paste `/site/lib/three@0.160.0` into the locator.

`/browse` → 374 files, provenance recording the npm artifact and the verified
GitHub commit, endorsements against the treeHash. Switch to the fork:
373 of 375 files identical, 2 objects in the store, and **no inherited
endorsements** — because it announces a different lineage and is therefore a
different tree.

*J15, J16.*

### J-F · "How does any of this work?" (all)

`/read` → the laws → L5 volatility. The three example addresses in the prose
are pills, and they link. Clicking one lands in `/browse` on a real file at
the volatility being described. The explanation and the thing explained are
one click apart.

*Teaching, and the reason `/read` is an app rather than a PDF.*

---

## 4. Shared parts

Four documents, so navigation between them is `<a href>` and a page load.
Everything below is a deck under `hub/ui/`, imported by all four apps at an
ordinary deck address — which is what makes the Hub self-hosting in a way
that means something rather than a way that sounds good.

| component | does |
| --- | --- |
| `<deck-nav>` | four tabs, current context, locator, live indicator |
| `<deck-locator>` | accepts any Deck URL, spec, or name; resolves and goes |
| `<deck-lens>` | the run/read toggle — one implementation, everywhere |
| `<deck-address>` | the volatility control: live / tag / range / exact |
| `<deck-pill>` | `pills.js`, linked for `deck` kind inside the Hub |
| `<deck-hash>` | treeHash: short prefix, full on demand, copy |
| `<deck-tree>` | listings, `table-core`-backed |
| `<deck-file>` | blob view, line numbers, anchors, raw link |
| `<deck-diff>` | two addresses in, semantic where possible |
| `<deck-run>` | iframe plus resolved import map |
| `<deck-live>` | SSE state, honest when disconnected |

Two conventions, both load-bearing:

1. **Every component takes a Deck address, not an object.** A component that
   accepts `/site/lib/three@0.160.0/src/Three.js` composes with the locator,
   with deep links, and with pills, for free. One that takes a parsed object
   needs an adapter at every boundary.
2. **Action affordances are a capability that can be absent** (spec §10). v1
   is read-only and renders the exact CLI command instead of running it. The
   same components must work unchanged when a write channel appears.

---

## 5. Stack

Decided by measurement. `deck vendor --probe` reports how many modules an
entry reaches; one module means the boundary was lost at publish time.

### 5.1 No framework

Custom elements, `innerHTML` writes, CSS counters, and about forty lines of
routing. React publishes no ESM at all. Ember needs a build, which would mean
the deck served is not the deck written — the exact gap the ProseMirror demo
exists to name, and the wrong thing to put at the centre of a product whose
pitch is that reading and running are the same bytes. htmx needs an
application server, and this one has no write endpoint by design.

`<template>` measured identical to `innerHTML` (54.3 ms vs 53.5 ms at 10,000
lines), so it is a fine primitive and not a foundation.

The UI backports to Ember later, in the realm server, where Embroider exists.
What backports is HTML and CSS, which is what this stack produces.

#### The visual language: terminal look, not terminal emulation

The Hub is set in **Commit Mono**, vendored as `hub/type/commit-mono@5.3.0` —
a deck with **no entry declared**, because nothing imports a woff2. L6 makes
this mandatory rather than tasteful: a webfont from a CDN is a runtime reach,
a third party learning every reader's IP and holding the power to change the
bytes.

It looks like a terminal because of what it is. The write channel in v1 is a
copyable CLI command, the addresses are paths, the content is source. Two
things are borrowed and one family is refused:

- **the grid** — every measurement in `ch` and whole rows, so columns line up
  down the page the way `ls` output does and a web table usually does not
- **the palette** — neutral greys for everything, colour only where it carries
  meaning: green added, red removed, amber moving, green frozen
- **none of the costume** — no blinking cursor, no fake prompt that accepts no
  input, no typing animation, no ASCII art, no scanlines. Anything that looks
  interactive is interactive. A tool whose value is not lying should not open
  by lying about being a shell.

From `commitmono.com`: sections are **numbered** and the current one is
inverse, which is what makes `1`–`4` a navigation model rather than an
undiscoverable shortcut; there are almost no rules and no boxes, so structure
comes from alignment; and the keys are shown on screen as keycaps.

#### Keyboard first

`/browse` is a list, and lists are what keyboards have always been best at.
`j`/`k` move, `↵` opens, `u` goes up, `/` filters, `v` picks volatility, `d`
picks the comparison, `y` copies the address, `1`–`4` switch apps, `h` shows
and hides the legend (and the choice persists).

Two rules keep it honest. **Every binding appears in the on-screen legend and
nothing appears there that is not bound** — the legend is derived from the
view, so a page without a filter does not offer `/`. And **while a field has
focus, letters are text**: `/` enters the filter, `Escape` leaves it, and in
between the alphabet belongs to the user.

Where the web is simply better, the web wins: filtering 374 files as you type,
a header pinned while you scroll, a path that hyperlinks to the bytes it
names. Those are real needs, so they are built rather than refused for looking
insufficiently `ls`-like.

### 5.2 Vendored

| deck | source | probe | modified |
| --- | --- | --- | --- |
| `hub/lib/diff@9.0.0` | `diff` `libesm/` | tree, 19 modules, 0 external | no |
| `hub/lib/highlight-js@11.11.1-esm.*` | `highlight.js` | 192 languages | **yes — one line** |
| `hub/type/commit-mono@5.3.0` | `@fontsource/commit-mono` | no entry | no |
| `hub/lib/tanstack-table@9.1.1` | `@tanstack/table-core` | tree, 76 modules, 1 external | not yet vendored |
| `hub/lib/marked@18.0.9` | `marked` | **bundle, 1 module, 42 KB** | not yet vendored |

#### The highlight.js finding — and a gap in `--probe`

The brief originally recorded `highlight.js` as "tree, 2 modules" on the
strength of `deck vendor --probe`. That report is **true and useless**: the
second module is CommonJS.

```
es/core.js     import HighlightJS from '../lib/core.js'   ← ESM shim
lib/core.js    module.exports = highlight;                ← CJS
```

Node resolves that through dual-package interop. A browser cannot — importing
a file containing `module.exports` throws. So the package as published is not
usable from a browser at all, and **`--probe` cannot say so, because it counts
modules and not module systems.** That is a real gap in the tooling and it
belongs on the list: a `--probe` that reported *CJS* alongside *tree* and
*bundle* would have caught this before anything was sealed.

What makes it worth fixing rather than abandoning: `lib/core.js` is 2,597
lines and contains **exactly one** CommonJS construct, on line 2595. No
`require()`, no `exports.`, no `__dirname`.

```
-  module.exports = highlight;
+  export default highlight;
```

One line, one file, and a package that could not run in a browser runs in a
browser. This replaces the diff renderer as the Hub's "with modification"
story, because it is load-bearing rather than decorative — without it the Hub
cannot highlight anything.

The 192 language definitions need no patch: each is already self-contained
ESM with zero imports. They are loaded **on demand by file extension**, so
"universal highlighting" costs one 12 KB core plus one ~10 KB language module
per language actually looked at, against 2.6 MB for the set. A bundle would
have to decide in advance which languages the Hub is allowed to understand.

`marked` remains a bundle with no per-file alternative that does not drag in
twelve packages. It gets vendored anyway and **labelled as a bundle in
`/start`'s self-report** — a tool that argues for module boundaries and then
hides the one place it accepted a bundle is worth less than one that points
at it.

### 5.3 Routing

`/hub/app/<name>/` are the canonical addresses. The short paths work because
`/browse` only matches the depot grammar if a depot named `browse` exists —
none does, so it falls through to the server's existing `fallback` hook,
which the Hub process owns. Four redirects, no server change, and if someone
ever creates a depot named `browse` the depot wins, which is the correct
precedence.

Inside `/browse` and `/run`, state lives in `?at=` and `?with=` rather than
path segments, so no catch-all rule is needed and any static host can serve
the Hub. `popstate` plus a click delegate is the whole router.

`/read` and `/start` need no client routing at all.

---

## 6. What has to be built on the server

Small, and none of it changes the protocol surface.

1. **`GET /_server`** — port, protocol, TLS, uptime, mounted depots with
   paths. `/start` currently has no way to state a fact about the server
   itself. *(new, ~40 lines)*
2. **Docs as a deck.** Seal `docs/` and the root markdown as `hub/doc/*` at
   Hub start. No server change — it is an ordinary depot directory. Resolves
   the "docs are served by nothing" gap.
3. **Module counts for the self-report.** `moduleClosure` already exists in
   `preload.ts`; expose the count per deck so `/start` can grade tree vs
   bundle without re-probing npm. *(small addition to `?meta`)*
4. **Demo aggregation.** The Hub already polls the nine demo processes for
   `/api/demos`. Keep it; `/run` consumes it.
5. **`tree` on `?meta` — done.** `files` was a list of paths, which answers
   *added* and *removed* and cannot answer *changed*. `tree` is the packlist
   verbatim (path, size, sha256), so a comparison is one request per side
   instead of a recursive walk or two whole packs. It is what makes "2 of 375
   files differ, 373 byte-identical" a computation rather than a claim.
6. **`--probe` should report module SYSTEM, not just module count.** See §5.2:
   a CommonJS file behind an ESM shim reports as a tree and cannot run in a
   browser. *(not yet built)*
7. **`deck lock` derives the depot name from the directory basename.** A depot
   whose directory name differs from the name it is mounted under gets wrong
   pins written into its own tree, silently — URLs for a depot that does not
   exist. The examples dodge it by locking programmatically with the name
   passed in. Worked around here by naming the directory after the depot;
   the CLI should take `--depot-name` or read it from the mount. *(not yet
   built)*

Everything else — listings, files, versions, tags, history, offers, trials,
signatures, live events — is already reachable. See the endpoint table in
[deck-ui-spec.md](deck-ui-spec.md#appendix--endpoint-reference).

**No write channel in v1.** Every journey in §3 completes read-only except
"freeze this" and "take it", which render their CLI command. Spec §10 option
B stays the recommendation for v2 and the components are built to accept it.

---

## 7. In and out

**In:** the four apps, the shared components, the vendored decks, the docs
deck, `/_server`, run/read on every runnable thing, trials, diff, volatility,
provenance, endorsements, history when present, the self-report.

**Out:** any write endpoint. Authentication. Multi-user. Remote depots.
Editing files. Changing the nine demos. Anything in spec §3's non-goals.

**Deferred, with the spec's open questions they belong to:** where proposals
live (§13.3), whether a data deck is a different kind of thing (§13.5), what
"we looked and said no" is (§13.6), whether a fork declares itself a proposal
(§13.8), and showing a deck's position on the velocity/width/privacy axes
(§13.10). None blocks v1; all get easier with four real surfaces to try them
in.

---

## 8. How we will know it worked

Spec §9.3's four-workload rubric, run against the built Hub, plus three
checks specific to this brief:

1. A person who has never seen Deck can get from `/read`'s explanation of L5
   to a real file at each of the three volatilities, without being told how.
2. Every journey in §3 completes without leaving the Hub and without a
   terminal, except where a CLI command is deliberately the answer.
3. `/start`'s self-report names at least one place the Hub fell short of its
   own standard, and that statement is true.
