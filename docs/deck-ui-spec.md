# Deck UI — specification and product requirements

Status: specification for design. The protocol, server, and CLI described
here are **built and tested** (151 tests); every endpoint, field, and state
below is real and can be hit today. Nothing in this document is aspirational
unless it says so.

Audience: a designer with no prior Deck context, plus the engineer who will
implement against it.

---

## 1. What Deck is, in one page

Deck is a way to develop, version, publish, and share packages of ES modules
and JSON documents **without npm, GitHub, a build step, or a deploy**.

A **realm** is a directory. Its layout IS its URL space:

```
<root>/site/acme/palette/palette.js        on disk
      /site/acme/palette/palette.js        live  — every save, immediately
      /site/acme/palette@1.1.0/palette.js  sealed — immutable forever
      /site/_history/<changeId>/…          any state it was ever in
```

Four ideas carry the whole product, and the UI exists to make them visible:

1. **The URL is the path.** `ls` and `cat` show the latest of everything.
   Adding `@<version>` reads the same path out of a seal instead.
2. **Every save is captured.** A settled edit auto-publishes an immutable
   prerelease (`1.0.0-dev.7`, tagged `dev`) and is sealed in history — even
   the states that were never published.
3. **Identity is content.** A tree's `treeHash` is its name. Publishing the
   same content twice writes no new bytes; releasing a version is a pointer
   move, not a copy.
4. **A fork is a proposal.** Forking records its base (package + version +
   treeHash), so a machine can keep every proposal merged against upstream
   continuously, and a reviewer can run any proposal by changing a URL.

**Vocabulary** (use these words in the UI, consistently):

| Term | Means |
| --- | --- |
| realm | a directory served at `/<realm>/`; the unit of history |
| publisher | the scope segment; also the **fork boundary** |
| deck | a package: a directory with an `importmap.json` |
| live | the bytes on disk right now; no version in the URL |
| dev | dist-tag on the freshest auto-published prerelease |
| sealed / version | an immutable published state, addressed `@<version>` |
| seal | one point in realm history (`changeId`), published or not |
| pack | a deck as one `.pack.zip`; canonical and verifiable |
| decklist | the declared dependency **ranges** in a deck's map |
| lock | those ranges resolved to exact **pins** in `imports` |
| offer | a fork that records its base — i.e. a proposal / "PR" |
| trial | viewing an app with one or more dependencies swapped (`?with=`) |

Do **not** use: branch, commit, merge request, checkout, staging.

---

## 2. Product requirements

### 2.1 Who this is for

- **P1 — The builder (primary).** Editing decks in a realm, often with
  several agents editing simultaneously. Wants: is it running, what did I
  just change, can I go back, is my dependency stable or moving.
- **P2 — The maintainer.** Owns a deck others depend on. Wants: what is
  proposed against me, does it still merge, does it work when I run it, ship
  it or don't.
- **P3 — The consumer.** Depends on someone else's deck. Wants: which
  version am I on, what changed, is it safe to move.

### 2.2 What must be true (acceptance-level)

- **R1.** A user can tell, at a glance and without reading a URL, whether
  what they are looking at is **live, sealed, or a trial** — and can switch
  between them in one action.
- **R2.** Nothing the UI shows may imply mutability that the protocol does
  not have. A sealed version is immutable; the UI must never offer to "edit
  version 1.1.0".
- **R3.** Every view exposes its **canonical URL**, copyable. The URL is the
  product's core idea; hiding it would hide the thing.
- **R4.** Provenance is always one hop away: this version → its seal → its
  history; this fork → its base; this vendored module → its CDN origin.
- **R5.** A maintainer can go from "somebody proposed something" to "I am
  running it" in **one click**, with no checkout and no build.
- **R6.** Conflicts are the only proposals that demand attention. The UI must
  make 3-needing-a-person legible among 200-that-are-fine.
- **R7.** Destructive-looking actions must show their true cost. Releasing
  copies **zero bytes**; restoring is **undoable**; pruning deletes bytes
  only when nothing points at them. Say so at the moment of action.
- **R8.** The UI updates without a refresh when the filesystem changes (SSE
  is already wired).
- **R9.** Degraded capability is stated, never faked: no jj installed → the
  history surface says tier 1 and how to get tier 2; a backend that cannot
  enumerate a seal says so rather than showing an empty tree.

### 2.3 Non-goals (v1)

- Not a code editor. File contents are read-only in the UI; editing happens
  in the user's editor or by an agent. (A future "quick edit" is possible —
  every save is sealed, so it is safe — but it is not v1.)
- Not a chat/review-comment system. Discussion lives where the team already
  talks. The UI shows state and runs things.
- Not a multi-user permissions surface. Identity arrives with the realm
  server (Matrix); v1 is a local, single-operator tool.

---

## 3. Constraints the design must respect

These are protocol facts, not preferences.

**C1 — The server is read-only.** `GET`/`HEAD` only; every other method
returns 405. All state changes go through the CLI today. See §9 for the
write-channel decision the UI forces.

**C2 — Version-less means live.** There is no "latest" URL that means live.
`latest` is a dist-tag on a *stable release*. Three distinct things the UI
must never blur: `live`, `@dev`, `@latest`.

**C3 — Ranges never match prereleases.** A `^1.0.0` dependency cannot pick
up a dev line. Opting into churn is explicit — the UI should make that
choice feel deliberate, not incidental.

**C4 — A realm's own machinery is not content.** `.deck/` (the store) and
`.jj/` (seals) are never listed or served. They appear in the UI only as
facts *about* a realm ("2 version pointers", "tier 2 history"), never as
files.

**C5 — Trials are not sealed representations.** A `?with=` response is
`no-store` and must be visually marked as temporary.

---

## 4. Object model / information architecture

```
Realm  (directory; unit of history; has a store and optional seals)
 └── Publisher  (scope segment; the fork boundary)
      └── Deck  (package = directory with importmap.json)
           ├── Live tree        files on disk, right now
           ├── Versions         dev.N prereleases + stable releases
           │    └── each: treeHash, pack file, optional sealChangeId
           ├── Dist-tags        dev, latest, …
           ├── Decklist         dependency ranges → resolved pins
           └── Offer (optional) if this deck records a base → it is a proposal

Realm-level:
 ├── Seals       every save, published or not (changeId, time, files, author)
 └── Offers      every deck in the realm that records a base
```

Navigation hierarchy: **Realm → Deck → (Files | Versions | Seals |
Dependencies | Preview)**, with **Offers** as a realm-level peer view.

---

## 5. Core interaction concepts

These four recur on many screens and should be designed once.

### 5.1 The volatility dial

The single most important control. Wherever a deck is shown, the user picks
which of it they are looking at:

```
[ LIVE ]  [ dev ]  [ 1.1.0 ▾ ]        ← one control, three kinds of answer
```

- **LIVE** — bytes on disk. Changes under you. Badge: pulsing dot.
- **dev** — the freshest seal, an immutable prerelease.
- **a version** — pinned, immutable, cacheable forever.

Selecting a value changes the address line (§5.2), the file tree, and the
preview together. This same control appears in the deck header, in the
dependency editor (choosing a spec), and in the trial composer.

### 5.2 The address line

Always visible on any deck/file/seal view: the canonical URL, copyable, with
the version segment visually distinct.

```
/site/acme/palette@1.1.0/palette.js          [copy]
        ▲publisher ▲package ▲version
```

For live: the `@version` segment is absent and the line reads `no-store`.
For a trial: the `?with=…` suffix is shown as a removable chip.

### 5.3 Provenance chips

Small, consistent, clickable. Each navigates to the thing it names.

| Chip | Shows | Goes to |
| --- | --- | --- |
| `#a3f9c2…` | treeHash (12 chars) | the version(s) with this content |
| `seal ktqmqx…` | `sealChangeId` | that seal in history |
| `forked from acme/palette@1.0.0` | base | upstream deck at that version |
| `vendored from esm.sh/three@0.160.0` | `vendoredFrom` | nothing (external, informational) |
| `dev` / `latest` | dist-tag | the version it points at |

### 5.4 Immutability signalling

A consistent visual language, because it is the product's core promise:

- **Sealed** — solid border, lock affordance, "immutable" in the cache line.
- **Live** — dashed or pulsing edge, "no-store", timestamp of last save.
- **Trial** — a distinctly coloured banner across the whole surface with a
  one-click "exit trial". Never let a user think a trial is the real state.

---

## 6. Screens

Each screen lists: purpose, the endpoint(s) that feed it, primary actions,
and the states that must be designed.

---

### S1 — Realms overview (home)

**Purpose.** Where am I; what exists; what is live right now.

**Data.** `GET /_packages`

```json
{
  "meta": {
    "history": { "tier": 2, "kind": "sealed-tree", "jj": true, "historyd": false,
                 "realms": ["site"], "note": "Every save is sealed. …" },
    "layout": "<realm>/<publisher>/<package>/ on disk and in the URL; …"
  },
  "data": [{
    "type": "realm", "id": "site", "name": "site",
    "dir": "/Users/chris/work/site",
    "storePath": "site/.deck/store/",
    "history": "jj", "historyPath": "/site/_history",
    "packages": [{
      "type": "package", "id": "site/acme/palette",
      "publisher": "acme", "name": "palette",
      "live": true, "livePath": "/site/acme/palette/",
      "storePath": ".deck/store/acme/palette/",
      "versions": { "1.0.0-dev.1": { "treeHash": "bbbfb346…", "file": "packs/bbbfb346….pack.zip" },
                    "1.0.0": { "treeHash": "bbbfb346…", "file": "packs/bbbfb346….pack.zip" } },
      "distTags": { "dev": "1.1.0-dev.1", "latest": "1.1.0" }
    }]
  }]
}
```

**Layout.** Realm cards; inside each, a grid of decks grouped by publisher.
Each deck card: name, live indicator, version count, `dev` and `latest`
chips, and a spark of recent activity.

**Primary actions.** Open deck · Open offers · Copy realm path · New deck
(scaffold) · Open the realm's history.

**Note for design:** two versions pointing at the same `treeHash` (see the
sample above — `1.0.0-dev.1` and `1.0.0`) is the **normal, desirable** case:
that is a release that copied nothing. Show it as an alias, not a duplicate.

**States.** Loading · no realms (onboarding: `deck hello`) · realm with no
decks · tier-1 realm (no seals) · many realms (search/filter).

---

### S2 — Deck detail (the core screen)

**Purpose.** Everything about one deck, at the volatility the user chooses.

**Data.**
- `GET /_packages/<realm>/<pub>/<pkg>` — versions, tags, live flag, history flag
- `GET /_browse/<realm>/<pub>/<pkg>[@spec][/path]` — file tree / file
- `GET /<realm>/<pub>/<pkg>@<version>?meta` — entry, exports, files, `sealChangeId`, `baseApi`, treeHash

**Layout.** Header: deck identity, the volatility dial (§5.1), the address
line (§5.2), provenance chips. Body: five regions, tabbed or panelled.

| Region | Content |
| --- | --- |
| **Files** | tree + file preview; sizes and `sha256` when sealed |
| **Versions** | the timeline (S3) |
| **Seals** | this deck's slice of realm history (S4) |
| **Dependencies** | the decklist: ranges vs pins, lock state (S5) |
| **Preview** | the running app in an iframe (S6) |

**Primary actions.** Switch volatility · Copy URL · Download pack
(`?format=pack`) · Release a version · Fork · Lock dependencies · Open in
preview.

**States.** Live-only (never published) · sealed-only (no live dir) · binary
files (no preview, offer download) · large tree (virtualize) · a deck that
is also an offer (show the offer banner + base chip).

---

### S3 — Version timeline

**Purpose.** What states exist, which are pointers to the same bytes, and
what each was cut from.

**Data.** versions + distTags from S2; `?meta` per version for
`sealChangeId`.

**Layout.** A vertical timeline, newest first. Two visually distinct tracks:

```
  ● 1.1.0            latest        #8c7f1a…   seal wovmru…      [release notes ▾]
  ○ 1.1.0-dev.1      dev           #8c7f1a…   ← same bytes as 1.1.0
  ○ 1.0.0-dev.2                    #4999a4…
  ● 1.0.0                          #bbbfb3…   seal uywsqz…
```

Stables are filled; prereleases hollow. **Identical `treeHash` values must be
visually linked** — that is the zero-copy story made visible.

**Primary actions.** Open a version · Compare two (S7) · Release from dev ·
Move a dist-tag · Download pack · Prune old dev versions (with the count of
bytes actually reclaimable, which is often zero).

**States.** No versions yet · hundreds of dev versions (collapse runs) ·
a version whose pack is missing (error, not empty).

---

### S4 — Seals (realm history)

**Purpose.** Every state the realm has been in, including the ones never
published. This is the "you cannot lose work" surface.

**Data.** `GET /<realm>/_history`

```json
{ "meta": { "backend": "jj", "tier": 2, "realm": "site" },
  "data": [{ "type": "seal", "id": "wovmruymqrvw…",
    "attributes": { "changeId": "wovmruymqrvw…", "commitId": "93b2727…",
      "timestamp": "2026-08-07T20:13:24-0400",
      "description": "save: you/app/app.js",
      "filesSummary": ["M you/app/app.js"],
      "author": null,
      "filesUrl": "/site/_history/wovmruymqrvw…" } }] }
```

Then `GET /<realm>/_history/<changeId>` for the file list, and
`/<realm>/_history/<changeId>/<path>` for bytes.

**Layout.** Chronological list; each row: time, description, changed-file
summary, author when there is one. Selecting a seal shows its tree and lets
the user open any file at that moment.

**Primary actions.** Open a file at this seal · **Restore the realm to this
seal** · Copy the seal URL.

**Restore is the moment R7 matters most.** The confirm must say plainly: the
state you are leaving is sealed first, so this is undoable; the restored
state will auto-publish as the next dev version; nothing is rewritten.

**States.** Tier 1 (no history backend) → replace this tab with an
explanation and the one command that enables it, **not** an empty list ·
backend cannot enumerate a seal (`filesAvailable: false`) → say "this
backend cannot list a seal's tree", never show an empty tree · a very long
history (paginate).

---

### S5 — Dependencies (the decklist)

**Purpose.** Choose, per dependency, how much volatility you want — and see
what that resolved to.

**Data.** the deck's `importmap.json`: `deck.dependencies` (ranges) and
`imports` (pins). Lock state comes from running the lock in check mode.

**Layout.** One row per dependency:

```
acme/palette     range: [ ^1.0.0 ▾ ]     → pinned: /site/acme/palette@1.1.0/    ✓ current
three            range: [ 0.160.0 ]      → pinned: /site/acme/three@0.160.0/    vendored
you/palette      range: [ live ▾ ]       → /site/you/palette/                   ⚡ every save
```

The range control is the volatility dial again (§5.1): `live`, `dev`, a
range, an exact version, or a tag.

**Primary actions.** Change a range · **Lock** (resolve + write pins) ·
Preview what locking would change *before* writing · Open the dependency's
deck.

**States.** Out of date (a newer version satisfies the range) — the primary
call to action · already locked (say "nothing to write") · unsatisfiable
range (error naming the range) · a cross-realm dependency (**currently
refused** — must render as an explicit not-yet-supported state, not a
failure) · a dependency pinned `live` (warn that consumers of a published
version should not be on `live`).

---

### S6 — Preview / trial

**Purpose.** Run the thing. This is the review surface and the answer to
"does it work".

**Data.** an iframe of `/<realm>/<pub>/<pkg>/index.html` (or the declared
entry), plus `?with=` overrides. SSE (`/_live/events`) drives reload.

**Layout.** The app in a frame, with a **trial bar** above it:

```
┌ TRIAL ─────────────────────────────────────────────────────────┐
│ acme/palette → you/palette (live)              [x]  [+ add]    │
│ URL: /site/you/app/index.html?with=acme/palette=you/palette     │
│                                        [copy link]  [exit trial]│
└─────────────────────────────────────────────────────────────────┘
```

Each override chip = one `?with=` parameter. Adding several is how a
reviewer tries a **slate** of proposals together.

**Primary actions.** Add/remove an override · Copy the trial link (this is
how review is shared — the link IS the review environment) · Reload · Exit
trial.

**States.** No overrides (plain preview, no banner) · one or more overrides
(banner visible, `no-store`) · an override that cannot be resolved → the
server refuses the request with a reason; show the reason in the bar, never
silently render the un-swapped app · app throws (surface console errors).

---

### S7 — Compare

**Purpose.** What actually changed between two states.

**Data.** two `?meta` file lists + file bytes from each side; any two of
{live, a version, a seal}.

**Layout.** Two-up pickers using the volatility dial, then a changed-file
list with per-file diff. Include added/removed/renamed counts and a
"same treeHash — identical" fast path.

**States.** Identical (say so loudly; it is a common and meaningful answer) ·
binary file (show size delta only) · very large diff (collapse).

---

### S8 — Offers board (the contribution inbox)

**Purpose.** P2's home. Which proposals exist, which still merge, which need
a person.

**Data.** `GET /<realm>/_offers`

```json
{ "meta": { "realm": "site", "open": 1, "conflicted": 1 },
  "data": [{ "type": "offer", "id": "you/palette",
    "attributes": { "offer": "you/palette", "upstream": "acme/palette",
      "state": "conflicted", "upstreamVersion": "1.2.0",
      "conflicts": ["palette.js"], "detail": null,
      "tryWith": "?with=acme/palette=you/palette" } }] }
```

**Layout.** A board or table grouped by state, with the conflicted group
pinned to the top. Each row: proposal → upstream, state chip, base vs
upstream version, conflicted file list, and two buttons: **Try** and
**Adopt**.

The four states, each needing its own visual treatment:

| State | Meaning | What the user should feel |
| --- | --- | --- |
| `current` | nothing published upstream since its base | calm; nothing to do |
| `rebased` | upstream moved; the merge is clean | informational; the machine handled it |
| `conflicted` | both sides changed the same thing | **this is the queue** |
| `unresolvable` | the base tree is not in the store | needs explanation, not a retry button |

**Primary actions.** **Try** (opens S6 with `tryWith` applied) · **Adopt**
(publish the proposal's treeHash under upstream's name — a pointer move;
show "0 bytes copied") · Open the proposal's deck · Open the conflicted file
in Compare.

**Scale requirement.** Designed for 200 rows where 197 are fine: conflicted
first, everything else collapsible into a single summary line ("197 merging
cleanly").

**States.** No offers (explain what a fork is and how to make one) · daemon
not running (the board is a snapshot; say when it was computed and offer
"run a pass now") · a proposal whose upstream was deleted.

---

### S9 — Activity stream

**Purpose.** With several agents editing at once, what is happening right
now.

**Data.** SSE `GET /_live/events` — `{ name, treeHash }` per settled change;
enrich from `/_packages`.

**Layout.** A thin, always-available feed: `you/app` saved → published
`0.1.0-dev.4` → sealed. Grouped by deck, collapsing bursts.

**States.** Idle · storm (many agents; collapse aggressively) · disconnected
(reconnect indicator — the SSE stream has heartbeats).

---

### S10 — Action dialogs

Small, high-stakes surfaces. Each states its true cost (R7).

| Dialog | Must show |
| --- | --- |
| **Release** | source (dev/version), target version, "same sealed state; **zero bytes copied**"; refuse if the map does not declare that version, explaining that bumping the version in the tree is the fix |
| **Fork** | source (live or a version), target scope, that the source's versions never move, and the option to repoint a dependent (`--use-in`) at the fork, live |
| **Lock** | the before → after pin for each dependency, and that ranges are kept |
| **Vendor** | the CDN URL, the module count pulled, and any reference that would leave the pack (the command **fails** rather than sealing a live external reference — that refusal is a feature and should read as one) |
| **Prune** | versions dropped and **how many bytes are actually reclaimable** (often zero, because other versions point at the same pack) |
| **Restore** | see S4 |
| **Adopt** | proposal → upstream version being created; zero bytes copied |

---

## 7. Screen flows

Each flow below corresponds to a scenario that exists in the test suite, so
mocks can use real data.

**F1 — "Start something" (P1).**
Home (no realms) → run `deck hello` → realm appears → deck detail, live →
Preview → edit in editor → preview reloads via SSE → version timeline shows
`0.1.0-dev.2` appear on its own.

**F2 — "Ship it" (P1 → P3).**
Deck detail → Versions → Release dialog (from `dev`) → timeline shows the
new stable linked to the same treeHash as the dev it came from → dependents
can now resolve `^1.0.0`.

**F3 — "Get off the volatility" (P3).**
Deck detail → Dependencies → a dependency shows "newer version satisfies
range" → preview the change → Lock → pins update → Preview confirms.

**F4 — "I broke something an hour ago" (P1).**
Deck detail → Seals → scan by time and file summary → open the file at that
seal to confirm → Restore → confirm dialog explains undoability → realm
returns; timeline shows the restored state re-pointing `dev` **without
minting a redundant version** (identical content is already published).

**F5 — "Experiment on someone else's code" (P1).**
Upstream deck detail → Fork → choose scope → optionally repoint my app at it
`live` → my app's Preview now runs the fork → upstream's versions unchanged.

**F6 — "Review a proposal" (P2).** *The flagship flow.*
Offers board → a `rebased` row → **Try** → S6 opens the real app with the
proposal swapped in → it works → **Adopt** → dialog shows zero bytes copied
→ the offer becomes `current` and upstream has a new version.

**F7 — "Triage 200 proposals" (P2).**
Offers board, conflicted-first → 3 rows → open one → Compare shows the
conflicting file → Try to see the behaviour → hand back to the contributor
(v1: copy a link; the UI does not comment).

**F8 — "Bring in a library safely" (P1).**
Deck detail → Dependencies → Vendor → CDN URL → module count → sealed under
your own publisher → the pin now points at your own server, and the
provenance chip records the CDN origin.

**F9 — "What is this thing?" (any).**
Any address line → paste a Deck URL into the UI's locator → it resolves to
the right screen and volatility. The URL is the universal handle.

---

## 8. Real-time behaviour

- Subscribe once to `/_live/events` (SSE, heartbeats every 15s).
- On a change event for a deck currently in view: refresh the file tree, the
  version list, and reload the preview iframe.
- The **live** volatility is the only one that changes under the user;
  sealed views must never silently change. If a *sealed* view's underlying
  data appears to change, that is a bug — do not design for it.
- Auto-publish lags a save by one debounce window (~500ms default). The UI
  should show "saved → publishing…" rather than appearing stuck.

---

## 9. The write-channel decision (needs a product call)

The Deck server is **read-only by design** (C1): an agent arranges at-rest
state, distribution follows. But S3/S5/S8/S10 all mutate. Three options:

- **A — Read-only UI + copyable commands.** Every action renders the exact
  CLI command. Zero new surface, honest, slowest. Good for v0.
- **B — Local action endpoint (recommended).** The `deck serve` process
  gains a small, **localhost-only**, non-protocol action API used solely by
  the UI (release, lock, fork, restore, adopt, rebase-now). The protocol's
  read-only serving surface is untouched; the actions are the CLI's own
  functions. When Deck lands in the realm server, this becomes the
  Matrix-authenticated write path.
- **C — UI writes files directly.** Rejected: it bypasses the invariants
  (manifest agreement, immutability checks) that the CLI enforces.

Design should assume **B**, and mark every action button as belonging to the
"local operator" capability so the same components can be disabled in a
future read-only/remote context.

---

## 10. Scale and performance

| Dimension | Target | Implication |
| --- | --- | --- |
| decks per realm | 100s | grouped, searchable, virtualized |
| versions per deck | 1000s (dev lines grow fast) | collapse runs of dev versions; paginate |
| seals per realm | 10,000s | time-bucketed, paginated |
| open offers | 200+ | conflicted-first; collapse the healthy majority |
| file tree | 1000s of files | virtualized tree; lazy previews |
| file preview | up to ~200KB text | truncate with a "download raw" escape |

---

## 11. Cross-cutting states to design

Every one of these is a real, reachable state (each is covered by a test):

- **Empty:** no realms · realm with no decks · deck with no versions · no
  offers · no seals yet.
- **Degraded capability:** tier-1 history (no jj) · historyd cannot
  enumerate a seal's tree · cross-realm dependency refused.
- **Errors, distinguished by permanence** (the server already distinguishes
  them, and the UI should too): *invalid* (a malformed version spec can
  never resolve — a permanent refusal) vs *not-found-yet* (a legal tag that
  nobody has published — transient). These should not look identical.
- **Not servable:** a realm's `.deck`/`.jj` paths — must never appear.
- **Binary content:** no preview; size + digest + download.
- **Conflicted merge:** per-file, with the three-sided marker content
  available in Compare.
- **Trial active:** unmistakable, one click to exit.

---

## 12. Open questions for design

1. **Is the volatility dial one control or three?** A segmented
   live/dev/version control is compact but makes "version" a second-level
   choice. Alternative: a single dropdown listing `live`, `dev`, `latest`,
   then every version.
2. **Where do offers live?** Realm-level board (as specified) or a per-deck
   inbox on the upstream deck? The data supports both; 200-scale argues for
   the board.
3. **How much history belongs on the deck screen?** Seals are realm-level,
   but users think per-deck. Filtering realm seals by deck path is possible —
   worth it?
4. **Do we show treeHashes prominently, or only on hover?** They are the
   product's notion of identity and the proof behind "zero copies", but they
   are 64 hex characters.
5. **Is Compare a screen or a mode?** It could be an overlay on the file
   view rather than a destination.
6. **What does "adopt" look like when the maintainer disagrees?** There is no
   reject mechanism in the protocol — an unadopted offer simply stays a fork
   forever. Is that a state to display ("open, 47 days"), or is silence fine?

---

## Appendix A — Endpoint reference for mock data

| Endpoint | Feeds | Cache |
| --- | --- | --- |
| `GET /_packages` | S1 | no-store |
| `GET /_packages/<realm>/<pub>/<pkg>` | S2, S3 | 60s |
| `GET /_browse/<realm>[/<pub>[/<pkg>[@<spec>]]][/path]` | S2 files | live: no-store; sealed: 60s |
| `GET /<realm>/<pub>/<pkg>/<path>` | live bytes, preview | no-store |
| `GET /<realm>/<pub>/<pkg>@<spec>/<path>` | sealed bytes | immutable 1y |
| `GET /<realm>/<pub>/<pkg>@<v>?meta` | S3 detail | 60s |
| `GET /<realm>/<pub>/<pkg>@<v>?format=pack` | download | immutable |
| `…?with=<spec>` (repeatable) | S6 trials | no-store |
| `GET /<realm>/_history` | S4 | no-store |
| `GET /<realm>/_history/<changeId>[/<path>]` | S4 | immutable |
| `GET /<realm>/_offers` | S8 | no-store |
| `GET /_live/events` | S9, live reload | SSE |

Useful response headers to surface in a "details" affordance:
`content-digest` (RFC 9530), `x-deck-tree-hash`, `x-deck-seal`,
`x-deck-package`, `x-deck-realm`, `x-deck-with`, `x-deck-importmap`.

## Appendix B — A realistic mock dataset

Realm `site`, tier 2 (jj):

- `acme/palette` — versions `1.0.0-dev.1`, `1.0.0`, `1.0.0-dev.2`,
  `1.1.0-dev.1`, `1.1.0`, `1.2.0`; tags `dev: 1.2.0-dev.1`, `latest: 1.2.0`.
  Live. Note `1.0.0-dev.1` and `1.0.0` share treeHash `bbbfb346…`.
- `you/app` — version `0.1.0-dev.3`; depends on `acme/palette: ^1.0.0`
  pinned to `/site/acme/palette@1.1.0/palette.js`. Live. Has `index.html`,
  `app.js`, `importmap.json`.
- `you/palette` — an **offer**: `forkedFrom { package: "acme/palette",
  version: "1.0.0", treeHash: "bbbfb346…", actor: "@chris:boxel.ai" }`,
  state `conflicted`, conflicts `["palette.js"]`, `tryWith:
  "?with=acme/palette=you/palette"`.
- Seals: `wovmruymqrvw… "save: you/app/app.js"`, `uywsqzrlnyqr… "save"` with
  `["A you/app/app.js", "A you/app/importmap.json", "A you/app/index.html"]`.
