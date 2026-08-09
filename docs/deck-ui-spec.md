# Deck UI — product requirements and design directions

> **Vocabulary note.** This document predates the depot ruling and says
> **realm** where standalone Deck now says **depot** — the URL slot holding a
> live tree, a store, and a prefix. Where a sentence is genuinely about the
> Boxel construct, it means that. See
> [deck-depot-and-realm-backport.md](deck-depot-and-realm-backport.md).

Status: for design exploration. The protocol, server, and CLI are **built and
tested** (151 tests); every endpoint, field, and state referenced here is real
and reachable today. What is *not* settled is the product: this document fixes
the requirements and the invariants, and deliberately leaves information
architecture and interaction patterns open, with directions to explore.

Read §1–§6 as constraints. Read §7–§8 as an invitation. Use §9 to check any
design against all four workloads in about twenty minutes.

Companion: [deck-use-cases.md](deck-use-cases.md) — the four workloads in
full, and why they break on git and npm.

---

## 1. The protocol in one page

Deck develops, versions, publishes, and shares packages of ES modules and JSON
**without npm, GitHub, a build step, or a deploy**.

A **realm** is a directory. Its layout IS its URL space:

```
<root>/site/acme/palette/palette.js        on disk
      /site/acme/palette/palette.js        live   — every save, immediately
      /site/acme/palette@1.1.0/palette.js  sealed — immutable forever
      /site/_history/<changeId>/…          any state it was ever in
```

Four ideas carry the product:

1. **The URL is the path.** `ls` shows the latest of everything; `@<version>`
   reads the same path out of a seal.
2. **Every save is captured.** A settled edit auto-publishes an immutable
   prerelease (`1.0.0-dev.7`, tagged `dev`) and is sealed — including states
   never published.
3. **Identity is content.** A tree's `treeHash` is its name. Publishing the
   same content twice writes no bytes; releasing is a pointer move.
4. **A fork is a proposal.** It records its base, so a daemon keeps every
   proposal merged against upstream, and any proposal can be *run* by
   changing a URL.

**Vocabulary** — use consistently; do not introduce branch, commit, merge
request, checkout, or staging.

| Term | Means |
| --- | --- |
| realm | a directory served at `/<realm>/`; the unit of history |
| publisher | the scope segment; also the **fork boundary** |
| deck | a package: a directory with an `importmap.json` |
| live | the bytes on disk right now; no version in the URL |
| dev | dist-tag on the freshest auto-published prerelease |
| sealed / version | an immutable published state, `@<version>` |
| seal | one point in realm history (`changeId`), published or not |
| decklist | a deck's declared dependency **ranges** |
| lock | those ranges resolved to exact **pins** |
| offer | a fork that records its base — a proposal |
| trial | running something with dependencies swapped (`?with=`) |

---

## 2. The four workloads, as the driver

From the use-case pass. These are not personas; they are shapes of work, and
a design that serves all four is the product.

| | **W1 Swarm tool** | **W2 Codelists** | **W3 Adapters** | **W4 Skills** |
| --- | --- | --- | --- | --- |
| What | 8 agents build one dashboard | shared reference data | Zapier-style long tail | prompt + tools bundles |
| Unit | component deck | a JSON list | four strata: adapter / bespoke pattern / generic pattern / instance | one skill |
| Decks in play | ~8, all changing | 1–20, many editors | 100s, mostly static | 10s, one hot |
| Content | ES modules | JSON only | small modules + schema | markdown + JSON |
| Edit cadence | continuous, parallel | bursty amendments | rare per deck, constant across catalog | 200 edits/hour on one |
| "Is it good?" | the assembled app runs | consumers still render | the automation fires | the agent behaves |
| Contribution | internal, trusted | many, shallow | long tail, unknown | fork-and-house-style |
| Privacy | internal | public | **mixed within one workload** | often private |
| Failure today | branches don't compose | JSON conflicts + stale forks | contribution costs 100× the change | iterations are lost |

### 2.1 The finding that should shape IA: four centers of gravity

Each workload wants a *different object at the center*, and any hierarchy that
privileges one will fight the others:

- **W1 → composition.** The interesting object is *the assembled app right
  now* and the volatility of each part. Realtime matters. Eight decks, one
  answer.
- **W2 → the data itself.** There is no app to run; the "preview" is the list
  rendered as a table. Diffs are semantic (which keys moved), and the notable
  event is *two additions that did not conflict*.
- **W3 → the catalog and the queue.** Hundreds of siblings. Discovery, search,
  and triage dominate; any individual deck is small and boring.
- **W4 → the timeline.** Versions barely matter; *iterations* do. The core act
  is comparing two moments and going back to one.

A useful way to hold this without four products: **the same deck, read
through different lenses** (code / data / running / timeline). Whether "lens"
is the right construct is a design question — see §7.

### 2.1a The axes underneath: velocity, width, privacy

From [deck-use-cases.md §5](deck-use-cases.md). Every deck sits somewhere on
three correlated axes, and its position determines what the user needs from
it:

- **Velocity** — per-keystroke to per-quarter.
- **Width** — one consumer to thousands.
- **Privacy** — full of my specifics, or free of them.

Fast things are private and have one consumer; wide things are slow and
public. W3 is the workload that contains the *whole* spectrum inside itself:

| Stratum | Velocity | Width | Private | Wants |
| --- | --- | --- | --- | --- |
| adapter (`hub/slack`) | monthly | thousands | no | pinned semver, trust |
| bespoke pattern (`me/ship-notes`) | hourly, then never | **one** | yes | zero ceremony, restore |
| generic pattern (`team/message-to-doc`) | weekly | many | no | a contract + a config schema |
| instance (my binding) | occasional | **one** | **maximally** | to be data, and to hold secret *references* |

Two consequences the design has to carry:

1. **Position on the axes is a property worth showing.** "Frozen and widely
   used" and "moving and mine" should not look the same, even though both are
   decks. This is the same information as volatility, read at the level of a
   whole deck rather than a single dependency.
2. **The promotion path is a product moment.** Bespoke → generic is a fork
   plus an extraction of specifics into a config schema, with the private
   original untouched. It is the transition Zapier cannot do at all, and it
   deserves to feel like an event.

### 2.2 Where all four agree (the shared spine)

- Something is **live** and something is **frozen**, and the user constantly
  chooses which they are looking at.
- The **URL is the handle** for everything, including proposals and trials.
- **Going back** must be cheap and safe, or people won't move fast.
- **Somebody else's version of this** is a first-class, ever-present state —
  not an edge case.

### 2.3 Where they pull apart (design against these)

| Tension | W1/W4 want | W2/W3 want |
| --- | --- | --- |
| Density | one thing, deeply, live | hundreds of things, scannably |
| Time | the timeline is primary | the timeline is audit trail |
| Preview | run the app | render the data / fire the automation |
| Contribution | internal, implicit | external, queued, at volume |
| Diff | line-level code | key-level data |

---

## 3. Product requirements (revised, workload-tagged)

Each requirement names the workloads that demand it. A design may satisfy a
requirement any way it likes.

**R1 — Volatility is always answerable and always changeable.** At any moment
the user can tell whether they are seeing live, a sealed version, or a trial,
and can switch in one action. *(all four)*

**R2 — Nothing implies mutability the protocol lacks.** A sealed version is
immutable; never offer to edit `1.1.0`. *(all four)*

**R3 — Every view exposes its canonical URL, copyable.** The URL is the
product's central idea and the unit of sharing — a review, a trial, a bug
report, and a dependency pin are all URLs. *(all four; W3 most)*

**R4 — Provenance is one hop away.** version → its seal; fork → its base;
vendored module → its origin; pin → the deck it points at. *(W2, W3, W4)*

**R5 — Review is running, not reading.** Getting from "someone proposed
something" to "I am running it" is one action, with no checkout or build.
*(W3 primary, W4 strongly)*

**R6 — The exceptional few must be legible among the healthy many.** 3
conflicted among 200 fine; 1 misbehaving agent among 8. *(W1, W3)*

**R7 — Actions state their true cost at the moment of action.** Releasing
copies zero bytes; restoring is undoable; pruning frees bytes only when
nothing points at them; adopting copies nothing. *(all four)*

**R8 — Live means live.** The UI updates without refresh when the filesystem
changes; sealed views never change under the user. *(W1 primary)*

**R9 — Degraded capability is stated, never faked.** No jj → say Versions
only and how to get a Timeline; a backend that cannot enumerate → say so, never show an
empty tree. *(all four)*

**R10 — Data decks are first-class, not code decks with JSON in them.** A
deck whose content is data needs a data reading, a key-level diff, and a
"these two additions merged cleanly" story. *(W2; also W4's schemas)*
*(new — this is the largest gap in the previous draft)*

**R11 — Many-deck views must scale before they are pretty.** Hundreds of
sibling decks, thousands of versions, 200 open proposals. *(W3)*
*(new)*

**R12 — Iteration is the unit for some workloads.** Where 200 edits produce
one release, the timeline is the primary object and versions are secondary.
*(W4)* *(new)*

**R13 — Simultaneous authorship is visible.** When several agents edit at
once, the user can see what is moving and what is standing still. *(W1)*
*(new)*

**R14 — A deck that declares a config schema is configurable, for free.** The
schema generates a form; an instance is a JSON document validated against it.
The "configure an integration in a UI" product and the "read a data deck"
product are the same product. *(W3 strata S2b/S3; W2 and W4 schemas)*
*(new)*

**R15 — A fork is private until it is offered.** Forking to hack something for
yourself must not enqueue a proposal against a maintainer who never asked.
Proposing is a separate, deliberate act. *(W3 bespoke stratum; W4 house-style
forks)* *(new — the current implementation conflates these; see §13.8)*

**R16 — Secrets are references, never values, and the UI must make that
visible.** Immutability is hostile to secrets: a key sealed into a pack is
content-addressed forever and cannot be recalled. A config deck names a
secret; the host resolves it at runtime. Show the name, never a value, and
make an unresolved reference a legible state rather than a blank. *(W3
instances; anything with auth)* *(new)*

### Non-goals (v1)

Not a code editor (file contents are read-only; editing happens in the
user's editor or by an agent). Not a discussion system. Not a permissions
surface — identity arrives with the realm server.

---

## 4. Invariants any design must express

Five primitives. The *names and forms below are placeholders* — inventing
better ones is part of the work. What matters is that each concept is
expressible and unambiguous.

1. **Volatility** — live / dev / a version. Three genuinely different
   promises, never blurred. `latest` is a dist-tag on a stable release and is
   **not** live.
2. **Identity** — `treeHash`. Two versions with one hash are the same bytes;
   that is what makes releases free. Sameness should be *visible*, not
   inferred.
3. **Provenance** — where this came from: a seal, a base, a CDN, a fork.
4. **Immutability** — sealed is forever; live changes under you; a trial is
   temporary and must never be mistaken for either.
5. **Proposal state** — current / rebased / conflicted / unresolvable. Only
   one of the four wants attention.

---

## 5. Jobs to be done

Atomic intents, replacing a screen list. A design can distribute these
however it likes; §9's rubric checks that they are all reachable.

**Orient**
- J1 What exists here? *(all)*
- J2 What is changing right now? *(W1, W4)*
- J3 What does this deck contain, at the volatility I choose? *(all)*

**Iterate**
- J4 Is my thing running, and did my last save land? *(W1, W4)*
- J5 What changed between these two moments? *(W2, W4)*
- J6 Go back to how it was. *(W4, W1)*
- J7 Freeze this state as a real version. *(all)*

**Depend**
- J8 What am I depending on, and how exposed am I? *(W1, W2)*
- J9 Move a dependency forward, deliberately. *(W2, W1)*
- J10 Freeze one dependency while everything else keeps moving. *(W1)*

**Contribute**
- J11 Take someone's thing and start changing it. *(W3, W4, W2)*
- J12 Show someone what I did — running. *(W3, W4)*
- J13 What is proposed against me, and what needs me? *(W3)*
- J14 Take it. *(W3)*

**Trust**
- J15 Where did this come from? *(W2, W3, W4)*
- J16 Is this exactly what was published? *(all)*

---

## 6. Non-negotiable constraints

**C1 — The server is read-only.** `GET`/`HEAD` only; everything else 405.
Mutation needs a channel; see §10.

**C2 — Version-less means live.** Three distinct things: `live`, `@dev`,
`@latest`.

**C3 — Ranges never match prereleases.** Opting into churn is explicit.

**C4 — A realm's machinery is not content.** `.deck/` and `.jj/` are never
listed or served; they appear only as facts *about* a realm.

**C5 — Trials are `no-store`** and must be visually unmistakable.

---

## 7. Directions to explore — information architecture

Five organizing principles, each real, each with a cost. **None is
recommended.** The interesting work is probably a hybrid, or a sixth idea.

### Direction A — Strict hierarchy with view modes
`Realm → Publisher → Deck`, and inside a deck, modes for files / versions /
history / dependencies / preview.
*Favors:* W1, W4 (deep single-object work). *Fights:* W3 (a catalog of 300 is
three clicks deep and unsearchable), W2 (data buried under a file tree).
*Question:* can search and a strong locator rescue the catalog case?

### Direction B — The running thing first
The app is the home object; its dependency graph is the navigation; each node
carries a volatility control.
*Favors:* W1 decisively — composition is the screen. *Fights:* W2 (no app to
run), W3 (adapters have no single app).
*Question:* is "the running thing" generalizable — could a codelist's "app"
be its rendered table, and an adapter's be its harness?

### Direction C — Workspaces by activity
Separate top-level spaces: **Build**, **Data**, **Proposals**, **History**.
Each optimized for one center of gravity.
*Favors:* all four, individually. *Fights:* coherence — the same deck appears
in several places, and users must learn which space to be in.
*Question:* are these genuinely different activities, or one activity with
different content?

### Direction D — Locator-first / addressable everything
Minimal chrome. A command bar accepts any Deck URL, spec, or name and
resolves it; the body renders whatever was addressed. Deep links are the
primary navigation, and the UI is a viewer for the address space.
*Favors:* the protocol's own logic, W3 (paste an adapter URL), sharing.
*Fights:* discovery and orientation — you must know what to ask for.
*Question:* is this a mode inside another direction rather than a whole one?

### Direction E — Time as the spine
An activity river: saves, publishes, seals, proposals, adoptions. Objects are
reached through their events.
*Favors:* W4 (iteration is the object), W1 (watch the swarm). *Fights:* W2,
W3 (stable things vanish from a feed).
*Question:* does a feed work as a *secondary* spine everywhere?

### A cross-cutting idea worth testing: lenses
One deck, several readings: **code** (tree + text), **data** (table +
key-diff), **running** (iframe/harness), **timeline** (iterations). The lens
persists as you navigate.
*Attraction:* dissolves the four centers of gravity without four products,
and makes W2 and W4 first-class rather than special cases.
*Risk:* lens-switching becomes a hidden mode; the wrong default makes the
tool feel wrong for a whole workload.
*Question:* is the lens chosen by the user, or inferred from content and
overridable?

---

## 8. Directions to explore — interaction patterns

Eight recurring problems. Each states what must be true, then sketches
possibilities without picking one.

**P1 — Expressing volatility (R1, all workloads).**
Must convey: three kinds of promise; that live changes under you; that pinned
does not. Possibilities: a segmented live/dev/version control; one dropdown
listing everything; a temperature or risk metaphor (hot/warm/frozen); a
slider from "every save" to "pinned forever". *Test it against W1's
per-dependency mixture — some hot, some frozen, in one view.*

**P2 — Making zero-copy legible (R7, invariant 2).**
Must convey: two versions can be the *same bytes*; a release copied nothing.
Possibilities: alias lines linking timeline entries; identicon/color-hash for
treeHash; explicit "same content as 1.0.0-dev.4" text. *Watch for: a
hash-as-decoration that carries no meaning.*

**P3 — Trial mode (R5, C5).**
Must convey: this is not the real state; what is swapped; how to leave; how to
share. Possibilities: a persistent banner; distinct frame chrome; side-by-side
real vs trial; a "tray" of override chips that composes several at once (a
slate). *Test with W3's review flow and W4's A/B of two skills.*

**P4 — Triage at 200 (R6, R11).**
Must convey: the few that need a person, without hiding the many that don't.
Possibilities: conflicted-first list with a single collapsed "197 merging
cleanly"; kanban by proposal state; inbox-zero; a heat strip over the
catalog. *Test: can a maintainer find and act on 3 conflicts in under a
minute?*

**P5 — Reading data decks (R10).**
Must convey: a JSON deck as *data*, and a key-level diff. Possibilities: a
table with added/changed/removed keys; a schema-aware form view; a merge view
that shows "you added 3 keys, they added 2, none collided". *This is
currently unserved and is W2's whole experience.*

**P6 — Scrubbing iterations (R12).**
Must convey: hundreds of unnamed states, findable by time and by what
changed. Possibilities: a video-style scrubber; bisect (better/worse) that
narrows a range; pinning two points for comparison; sparklines of what files
moved. *Test with W4: "the version 40 minutes ago was better."*

**P7 — Simultaneous authorship (R8, R13).**
Must convey: what is moving, who or what is moving it, and what is
deliberately standing still. Possibilities: per-deck heartbeat/pulse;
presence chips; an activity river; a "frozen" badge that reads as a choice
rather than as staleness. *Test with W1's eight agents, including the
quarantine move.*

**P8 — Consequential moments (R7).**
Restore, adopt, release, prune. Must convey the true cost — usually
reassuring, occasionally not. Possibilities: inline confirmation stating the
fact ("0 bytes copied", "the state you are leaving is sealed first");
post-action undo affordance; a receipt. *Avoid generic "Are you sure?" — the
whole point is that these actions are cheaper than they look.*

---

## 9. Making the use cases trivial to apply

Everything below is drop-in. Fixtures are real shapes from live runs.

### 9.1 Scenario cards

Each card: the situation, what the person wants, and what must be visible for
them to decide. Design against the cards; they are the acceptance test.

**W1 — Swarm tool**
- *C1.1* Eight agents editing; the dashboard is open. **Wants:** to see it
  assemble live. **Must see:** which parts moved in the last minute; that the
  app is composed of eight decks.
- *C1.2* Chart 3 has gone wrong. **Wants:** to stop just that. **Must see:**
  chart 3's current volatility, its last good version, and the effect of
  freezing it on everything else (none).
- *C1.3* The filter bar looks right. **Wants:** to freeze it as `1.2.0`.
  **Must see:** which sealed state is being named, and that it copies nothing.
- *C1.4* Something broke twenty minutes ago. **Wants:** to find and restore.
  **Must see:** the states between publishes, what changed in each, and that
  restoring is undoable.

**W2 — Codelists**
- *C2.1* Adding three currency codes. **Wants:** confidence it will not
  conflict. **Must see:** the list as data, their additions as keys, that
  nobody else touched those keys.
- *C2.2* Two people amended simultaneously. **Wants:** to know both landed.
  **Must see:** a merge that reads as *combination*, not as a resolved
  conflict.
- *C2.3* Consuming the list at `^1.0.0`; a `1.4.0` exists. **Wants:** to know
  what changed before moving. **Must see:** a key-level diff, and what moving
  the pin would change.
- *C2.4* Maintaining a fork with three internal codes. **Wants:** to stay
  current without losing the patch. **Must see:** that upstream amendments
  are being absorbed automatically, and when they collide.

**W3 — Adapters**
- *C3.1* 300 adapters in the catalog. **Wants:** the one for Shopify.
  **Must see:** search, and enough per-item signal to choose.
- *C3.2* An adapter is broken. **Wants:** to fix it now. **Must see:** how to
  fork it into their own scope and have it running immediately.
- *C3.3* Maintainer, 200 open proposals. **Wants:** the ones needing them.
  **Must see:** conflicted first; the rest as a single reassuring line.
- *C3.4* Reviewing one proposal. **Wants:** to see it work. **Must see:** one
  action that runs the real harness with this adapter substituted.
- *C3.5* It works. **Wants:** to take it. **Must see:** what version is being
  created, and that it copies zero bytes.
- *C3.6* Vibe-coding a one-off: their Slack rule, hardcoded, for themselves.
  **Wants:** speed, and no publishing decision. **Must see:** that it is
  captured anyway — addressable, versioned, restorable — without having asked
  for any of that, and that it is **not** proposed to anyone.
- *C3.7* Four colleagues want that one-off. **Wants:** to generalize it.
  **Must see:** the promotion path — fork to a new name, extract the
  hardcoded specifics into a config schema, publish — with the private
  original still running, untouched.
- *C3.8* Configuring the generic pattern for a new team. **Wants:** to fill in
  a form, not read code. **Must see:** a form generated from the schema, and
  their instance saved as data.
- *C3.9* An instance needs a Slack token. **Wants:** it to work without the
  token ending up anywhere permanent. **Must see:** a named secret reference,
  never a value, and a clear state when it is unresolved.
- *C3.10* Their pattern depends on a moving thing and a frozen thing.
  **Wants:** to reason about exposure. **Must see:** per-dependency
  volatility in one view — `hub/slack` pinned, `me/format` live.

**W4 — Skills**
- *C4.1* 200 iterations in an hour. **Wants:** not to think about saving.
  **Must see:** ambient confirmation that everything is kept.
- *C4.2* Version from 40 minutes ago was better. **Wants:** to find it.
  **Must see:** a scrubbable history with enough signal to recognize it.
- *C4.3* Comparing two variants. **Wants:** A/B them. **Must see:** two
  addressable runs, side by side or in two tabs.
- *C4.4* Their fork of a community skill. **Wants:** upstream's improvements
  without losing house style. **Must see:** what was absorbed, and when a
  collision needs them.

### 9.2 Fixtures

Realm `site`, tier-2 history (jj). Paste into mocks.

**W1**
```
tool/charts/revenue    live · dev 2.1.0-dev.14 · latest 2.0.0   ← moving
tool/charts/funnel     live · dev 1.4.0-dev.3  · latest 1.4.0
tool/ui/filter-bar     live · dev 0.9.0-dev.22                  ← moving
tool/ui/table          live · dev 3.0.0-dev.7  · latest 2.9.1
tool/data/warehouse    live · latest 1.2.0                      ← frozen by choice
tool/app/dashboard     live · deps: 5 (3 live, 1 ^2.0.0, 1 dev)
```

**W2**
```
std/currencies   latest 1.4.0 · dev 1.5.0-dev.9 · 168 keys
                 1.5.0-dev.9 adds: XCD, SRD, ZWG   (3 contributors, 0 conflicts)
acme/currencies  fork of std/currencies@1.4.0 · +3 internal codes
                 state: rebased (absorbed 1.4.0 → 1.5.0-dev.9 automatically)
```

**W3** — note the four strata coexisting in one realm
```
hub/slack             latest 2.1.0 · 41 dependents · frozen, wide, public
hub/gdocs             latest 1.4.0 · 38 dependents
… 297 more adapters

team/message-to-doc   latest 1.2.0 · 9 dependents · config.schema.json
me/ship-notes         dev 0.1.0-dev.212 · 1 dependent (me) · private fork of
                      team/message-to-doc@1.0.0 · deps: hub/slack ^2.0.0,
                      me/format live
me/ship-notes-config  instance data · secrets: [SLACK_TOKEN, GDOCS_SA] (refs)

offers: 200 open — 197 current/rebased, 3 conflicted
  you/stripe-slack   ← hub/stripe-slack@2.1.0   conflicted: auth.js
  ana/webhook-any    ← hub/webhook-any@1.0.0    rebased
  kim/notion-sync    ← hub/notion-sync@3.2.0    unresolvable (base pruned)
```

**W4**
```
skills/reviewer        latest 4.2.0 · dev 4.3.0-dev.171
you/reviewer-strict    fork of skills/reviewer@4.2.0 · state: current
  seals today: 171 · last: "save: prompt.md" 40s ago
```

**Sample payloads.** `GET /_packages`:

```json
{ "meta": { "history": { "tier": 2, "kind": "sealed-tree", "jj": true,
      "historyd": false, "realms": ["site"] },
    "layout": "<realm>/<publisher>/<package>/ on disk and in the URL; …" },
  "data": [{ "type": "realm", "id": "site", "name": "site",
    "history": "jj", "historyPath": "/site/_history",
    "packages": [{ "type": "package", "id": "site/acme/palette",
      "publisher": "acme", "name": "palette",
      "live": true, "livePath": "/site/acme/palette/",
      "versions": { "1.0.0-dev.1": { "treeHash": "bbbfb346…" },
                    "1.0.0":       { "treeHash": "bbbfb346…" } },
      "distTags": { "dev": "1.2.0-dev.1", "latest": "1.2.0" } }] }] }
```

Note `1.0.0-dev.1` and `1.0.0` share a `treeHash`: that is a release that
copied nothing, and it is the normal case, not a duplicate.

`GET /site/_offers`:

```json
{ "meta": { "realm": "site", "open": 200, "conflicted": 3 },
  "data": [{ "type": "offer", "id": "you/stripe-slack",
    "attributes": { "upstream": "hub/stripe-slack", "state": "conflicted",
      "upstreamVersion": "2.1.0", "conflicts": ["auth.js"],
      "tryWith": "?with=hub/stripe-slack=you/stripe-slack" } }] }
```

`GET /site/_history`:

```json
{ "meta": { "backend": "jj", "tier": 2, "realm": "site" },
  "data": [{ "type": "seal", "id": "wovmruymqrvw…",
    "attributes": { "timestamp": "2026-08-07T20:13:24-0400",
      "description": "save: you/app/app.js",
      "filesSummary": ["M you/app/app.js"],
      "filesUrl": "/site/_history/wovmruymqrvw…" } }] }
```

### 9.3 The four-workload rubric

Run any candidate design against this. It is the fastest way to find a
design that is secretly single-workload.

1. **The quarantine test (W1).** From "chart 3 is broken", how many actions to
   freeze only chart 3? Is it obvious that nothing else stopped?
2. **The two-additions test (W2).** When two people add different keys, does
   the interface communicate *combination* — or does it use conflict-resolution
   language for something that was not a conflict?
3. **The needle test (W3).** With 200 proposals of which 3 are conflicted, how
   long to find and open all three? Do the 197 reassure or clutter?
4. **The scrub test (W4).** With 171 unnamed iterations today, can a user find
   "the one from 40 minutes ago" without reading them all?
5. **The volatility test (all).** Point at any element on screen: can you say
   whether it is live, sealed, or a trial, without clicking?
6. **The share test (all).** Can any state on screen be handed to a colleague
   as a URL that reproduces it?
7. **The honesty test (all).** Does a release say it copied nothing? Does a
   restore say it is undoable? Does a missing jj say Versions only rather than showing
   an empty history?

A design that passes 1–4 is serving all four workloads. 5–7 are the protocol's
character; failing them yields a competent tool for a different product.

---

## 10. The write-channel decision (needs a product call)

The server is read-only by design (C1), but most jobs in §5 mutate. Three
options:

- **A — Read-only UI, copyable commands.** Every action renders the exact CLI
  command. Honest, zero new surface, slowest.
- **B — Local action endpoint (recommended).** `deck serve` gains a small,
  **localhost-only**, non-protocol action API used only by the UI (release,
  lock, fork, restore, adopt, rebase-now). The read-only protocol surface is
  untouched; actions call the CLI's own functions. In the realm server this
  becomes the Matrix-authenticated write path.
- **C — UI writes files directly.** Rejected: bypasses the invariants the CLI
  enforces (manifest agreement, immutability).

Design should assume **B** and treat action affordances as a capability that
can be absent, so the same components work in a read-only or remote context.

---

## 11. Scale targets

| Dimension | Target | Driven by |
| --- | --- | --- |
| decks per realm | 100s | W3 |
| versions per deck | 1000s | W4, W1 |
| seals per realm | 10,000s | W4 |
| open proposals | 200+ | W3 |
| files per deck | 1000s | W1 |
| keys per data deck | 10,000s | W2 |
| concurrent editors | 20 | W1 |

---

## 12. States that must exist somewhere

Each is real and reachable, and each is covered by a test.

- **Empty:** no realms · realm with no decks · deck with no versions · no
  proposals · no seals.
- **Degraded:** tier-1 history (no jj) · backend cannot enumerate a seal's
  tree · cross-realm dependency refused (not yet supported, not an error).
- **Two flavours of miss, and they must not look alike:** *invalid* (a
  malformed spec can never resolve — permanent) vs *not-found-yet* (a legal
  tag nobody has published — transient).
- **Never servable:** `.deck/`, `.jj/`.
- **Binary content:** no preview; size, digest, download.
- **Conflicted proposal:** per file, with the three-sided marker content
  available in a comparison.
- **Trial active:** unmistakable, one action to exit.
- **Unresolvable proposal:** the base tree is gone; needs an explanation, not
  a retry.

---

## 13. Open questions for design

1. Are lenses (§7) real, or four screens wearing a costume?
2. Is the timeline one object with different densities, or genuinely
   different objects for W4 (iterations) and W1 (audit)?
3. Where do proposals live — realm-level board, per-deck inbox on upstream, or
   in the contributor's own space? The data supports all three.
4. How prominent should `treeHash` be? It is the notion of identity and the
   proof behind "zero copies", but it is 64 hex characters.
5. Is a data deck a different *kind of thing* in the IA, or the same thing
   read differently?
6. What does "we looked and said no" look like, given the protocol has no
   reject — an unadopted proposal just stays a fork forever?
7. Should the UI ever show the CLI command it is about to run? (It is a
   teaching surface, and it is the honest answer under option A.)
8. **How does a fork say whether it is a proposal?** (R15.) Candidates: a
   choice at fork time; inferred from whether an actor was recorded; a
   private realm making it structurally invisible; or a fork that is private
   by default and becomes an offer only when someone points at it. The last
   matches how people work, and it changes the offers board from "everything
   anyone forked" to "everything anyone offered".
9. **Is an instance a deck, or a document inside one?** A configured
   automation is data, one-of-a-kind, private, and edited through a form. It
   may not want to look like a package at all.
10. **Should a deck's position on the axes (§2.1a) be shown, and how?** It is
    derivable — velocity from seal frequency, width from dependent count,
    privacy from realm and content — but derived signals can mislead.

---

## Appendix — endpoint reference

| Endpoint | Provides | Cache |
| --- | --- | --- |
| `GET /_packages` | realms, decks, versions, tags, history capability | no-store |
| `GET /_packages/<realm>/<pub>/<pkg>` | one deck's versions/tags/flags | 60s |
| `GET /_browse/<realm>[/<pub>[/<pkg>[@<spec>]]][/path]` | tree listing / file with text preview, size, sha256 | live: no-store; sealed: 60s |
| `GET /<realm>/<pub>/<pkg>/<path>` | live bytes | no-store |
| `GET /<realm>/<pub>/<pkg>@<spec>/<path>` | sealed bytes (302 for tag/range, 301 for form) | immutable |
| `GET /<realm>/<pub>/<pkg>@<v>?meta` | entry, exports, files, `sealChangeId`, treeHash | 60s |
| `GET /<realm>/<pub>/<pkg>@<v>?format=pack` | the pack | immutable |
| `…?with=<spec>` (repeatable) | trial override | no-store |
| `GET /<realm>/_history[/<changeId>[/<path>]]` | seals; tree at a seal; bytes at a seal | log: no-store; seal: immutable |
| `GET /<realm>/_offers` | proposals with state, conflicts, `tryWith` | no-store |
| `GET /_live/events` | SSE change events `{name, treeHash}` | stream |

Headers worth surfacing in a details affordance: `content-digest` (RFC 9530),
`x-deck-tree-hash`, `x-deck-seal`, `x-deck-package`, `x-deck-realm`,
`x-deck-with`, `x-deck-importmap`.
