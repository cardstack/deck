# Every module is a visual item

*A UX thesis. The package name is not the thing.*

---

## 0. What was wrong with the last brief

The UI spec treated a deck as a **record about a module**: a name, a
version, a dependency count, an offer badge. That is npm's package page,
and no amount of layout skill makes it delightful, because the content is
bookkeeping. A designer handed that brief can only arrange metadata.

The correction: in Boxel a module **is data**, and a format is how data
appears. So a deck is a card, and:

> **A deck authors its own fitted format.**
> The catalog is not a list of names. It is a wall of running things.

Everything below follows from that one move.

Four consequences worth stating before the diagrams:

1. **Review-by-running stops being a link you click.** `?with=` was a
   query parameter you had to know about. If every tile is the module
   rendering itself, running *is* the resting state of the UI.
2. **The protocol becomes chrome.** Version, volatility, adoption, offer
   state — a fixed badge vocabulary in fixed positions, learned once, on
   every card whatever the card is. Never the content.
3. **Fitted is a contract with the container, not a size.** The container
   says how much room there is; the card decides what survives. The same
   card is a dependency row, a catalog tile, and a workbench panel.
4. **It is cards all the way down.** A codelist entry is a field. A
   pattern step is a field. A secret reference is a field. Fields have
   `fitted` and `atom` too, so a pattern's fitted is composed of its
   steps' fitteds.

---

## 1. The three sizes used throughout

Real specs from Boxel's `FITTED_FORMATS`. Three rungs are enough to prove
a design; the rest interpolate.

| Rung | Spec | Size | Where it appears |
| --- | --- | --- | --- |
| **Strip** | `single-strip` | 250×40 | dependency lists, search results, timelines, queues |
| **Tile** | `regular-tile` | 250×170 | the catalog wall, grids, pickers |
| **Card** | `full-card` | 400×275 | workbench panels, comparison, pinned items |

ASCII scale below: **1 char ≈ 6px wide, 1 row ≈ 16px tall.** A strip is
44 chars × 3 rows, a tile is 44 × 11, a card is 70 × 17.

### 1.1 The fallback ladder (the general rule)

Every concept in this document degrades the same way. This is the single
most portable idea here, and it is what makes "apply the use case" trivial:

```
   space              what the card shows
   ─────────────────  ──────────────────────────────────────────────
   Card    400×275    RENDER    the module actually running
   Tile    250×170    SHAPE     a compressed picture of what it is
   Strip   250×40     EVIDENCE  proof it works, right now
   Badge   150×40     IDENTITY  name + volatility dot
   Atom    inline     MARK      one glyph and a version
```

Content falls off the top of that list as space shrinks. **Chrome never
falls off** — the volatility dot survives to the atom.

---

## 2. Protocol as chrome: the badge vocabulary

The organizing principle, not the subject. Fixed glyphs, fixed positions.

| Glyph | Means | Position | Metric behind it |
| --- | --- | --- | --- |
| `●` filled, pulsing | **live** — bytes on disk, moving | top-right, first | — |
| `◐` half | **dev** — freshest seal | top-right, first | prerelease number |
| `○` hollow | **pinned** — an exact semver | top-right, first | the version |
| `1.4.0` | version chip | top-right, after the dot | — |
| `◆` / `◇` | private realm / shared realm | top-right, last | — |
| `▁▂▅█▃` | **velocity** spark | footer, left | saves per hour |
| `↳312` | **width** — who pins me | footer, middle | adoption count |
| `⑂47` | forks of me | footer, middle | — |
| `⇢2` | proposals waiting | footer, right | — |
| `⚠` | a proposal stopped merging | footer, right, red | conflict count |
| `⚿ NAME` | a secret **reference** | body, never chrome | — |
| `↻ 2m` | last change | footer, left | — |

**What never appears on a fitted:** treeHash, changeId, seal id, pack
format, store path. Those are plumbing. They live in a details drawer that
a person opens twice a year.

**Two chrome rules that carry real information:**

- A **flat spark on a wide card is a feature**, not an absence. An adapter
  that has not changed in six weeks and has 2,481 consumers should *look*
  boring and solid. Stability is the message.
- **No version chip and no width count means it is data, not a module.**
  That single visual rule answers open question 9 ("is an instance a deck
  at all?") without a label.

### 2.1 The axes are the map

The velocity / width / privacy axes from
[deck-use-cases.md §5](deck-use-cases.md) are not just analysis. They are
the catalog's coordinate system — laying the wall out on them puts every
concept where it belongs with no curation:

```
 high    ┌────────┬────────┬────────┐          ● live, ◆ private,
 velocity│ bespoke│ swarm  │ skill  │            fast spark, ↳1
    ▲    │ pattern│ compo- │ under  │
    │    │        │ nent   │ tuning │          the promotion path
    │    ├────────┼────────┼────────┤          runs down-and-right
    │    │instance│  app   │proposal│          ────────────────▶
    │    ├────────┼────────┼────────┤
    │    │        │generic │adapter │          ○ pinned, ◇ shared,
 low     │        │pattern │codelist│            flat spark, ↳1000s
 velocity└────────┴────────┴────────┘
          width=1 ──────────▶ width=many
          private ──────────▶ public
```

Same cards, one layout rule, and the map teaches the model.

---

## 3. The domain cards

Eight concepts, three sizes each. Every one is a **use-case noun** — a
chart, a list, an adapter, a rule, a skill. None is a protocol noun.

---

### C1 · Component — *the thing an agent is building*

`tool/charts/revenue` (W1, the swarm-built internal tool)

**What the fitted can be — three candidates:**

- **(a) The component, running.** It is a chart; draw a chart. Correct
  whenever output is visual and cheap to produce.
- **(b) A poster.** The last render, captured at seal time. For anything
  too heavy or too data-hungry to run in a grid of forty.
- **(c) A skeleton.** Slots and props with no data. Honest when there is
  nothing to feed it, and it still communicates the shape.

**Recommended:** (a) at Card and Tile, (b) at Strip. And even the Strip
shows *output* — a five-cell sparkline of its own data — rather than a
name. That is the thesis at its smallest.

```
STRIP 250×40
┌──────────────────────────────────────────┐
│ ▁▃▅▂▇ revenue chart     ● live  ↳4  ⇢1   │
└──────────────────────────────────────────┘

TILE 250×170
┌──────────────────────────────────────────┐
│ revenue chart                  ● live  ◆ │
│                                          │
│         ▄                                │
│    ▄    █    ▄          ▄                │
│  ▄ █  ▄ █  ▄ █   ▄  ▄   █                │
│  █ █  █ █  █ █   █  █   █                │
│  J F  M A  M J   J  A   S                │
│                                          │
│ ↻2m  ▁▂▅█▃ 41/hr     ↳4        ⇢1        │
└──────────────────────────────────────────┘

CARD 400×275
┌────────────────────────────────────────────────────────────────────┐
│ revenue chart                        tool/charts    ● live    ◆    │
│ ────────────────────────────────────────────────────────────────── │
│  $2.4M                                                             │
│          ▄                                                         │
│     ▄    █    ▄          ▄        ▄                                │
│   ▄ █  ▄ █  ▄ █   ▄  ▄   █   ▄    █    ▄                           │
│   █ █  █ █  █ █   █  █   █   █    █    █                           │
│   J F  M A  M J   J  A   S   O    N    D                           │
│ ────────────────────────────────────────────────────────────────── │
│ imports   ○ tool/data/warehouse ^2.1    ● me/format live           │
│ used by   ↳ tool/app/dashboard    ↳ ops/weekly-review              │
│                                                                    │
│ ↻ 2m ago    ▁▂▅█▃▂▁ 41 saves/hr    ⑂2    ⇢1 proposal               │
└────────────────────────────────────────────────────────────────────┘
```

**Why this is the W1 delight.** Eight agents are working. You are looking
at eight tiles, each redrawing as its agent saves. Chart 3 goes wrong and
you *see* it go wrong — you do not read a diff about it. The fix is
changing that one tile's dot from `●` to `○`, and only that tile stops
moving.

---

### C2 · App — *the assembled thing*

`tool/app/dashboard` (W1)

**What the fitted can be:**

- **(a) A live thumbnail.** The running app, scaled down.
- **(b) The parts board.** The app portrayed *as its dependencies and
  their volatility*. Nothing else in the industry portrays an application
  this way, and it is the picture that matters when eight agents are
  inside it.
- **(c) A health strip.** Does it boot, are all pins resolvable.

**Recommended:** both — (a) as the body, (b) as a rail that never
disappears. Even at Strip size the parts rail survives as a row of eight
dots. You learn "five parts live, three pinned, one in trouble" in 40
pixels.

```
STRIP 250×40
┌──────────────────────────────────────────┐
│ ▦ dashboard      ●●○●●●○○  8 parts   ⚠1  │
└──────────────────────────────────────────┘

TILE 250×170
┌──────────────────────────────────────────┐
│ dashboard                      ● live  ◆ │
│ ┌──────────────────────────────────────┐ │
│ │ ▤ filter  ▁▃▅▂ revenue  ◔ funnel     │ │
│ │ ──────────────────────────────────── │ │
│ │ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪  │ │
│ └──────────────────────────────────────┘ │
│ parts ● ● ○ ● ● ● ○ ○           ⚠ funnel │
└──────────────────────────────────────────┘

CARD 400×275
┌────────────────────────────────────────────────────────────────────┐
│ dashboard                            tool/app       ● live    ◆    │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │  ▤ filter bar         ▁▃▅▂▇ revenue      ◔ funnel              │ │
│ │  ──────────────────────────────────────────────────────────    │ │
│ │  ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪      │ │
│ │  ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪      │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ── parts ────────────────────────────────────────────── swap ⇄ ──  │
│  ● revenue live    ⚠ funnel ^1.2.0    ● table live    ● filter live│
│  ○ warehouse ^2.1  ● export live      ○ palette 1.1   ○ fmt 0.4    │
│ ────────────────────────────────────────────────────────────────── │
│ ↻ 8s ago    ▁▅█▇█▆█ 310 saves/hr (8 agents)    ⇢3                  │
└────────────────────────────────────────────────────────────────────┘
```

**The parts rail is the import map, made visual.** Dragging another card
onto a slot is `?with=`. Clicking a dot cycles live → dev → pinned. There
is no separate "manage dependencies" screen; the app's own portrait is
the control surface.

---

### C3 · Codelist — *the shared table of facts*

`hub/currencies` (W2)

**What the fitted can be:**

- **(a) The data.** A few rows. Which few is a real design question —
  first, most recently amended, or most referenced.
- **(b) The keyspace.** One mark per key, in a dense grid. 168 codes is a
  legible field of dots; 3,000 ICD codes is still legible as texture.
  Newly added keys light up.
- **(c) The amendment pulse.** Who changed what, when, and whether your
  fork has absorbed it.

**Recommended:** (b) as the body — it scales from 12 keys to 30,000 with
no redesign, and it makes additions *visible as light*. (c) as the footer.

```
STRIP 250×40
┌──────────────────────────────────────────┐
│ ⣿ currencies  168 codes  ◐ dev.7  +2 ✦   │
└──────────────────────────────────────────┘

TILE 250×170
┌──────────────────────────────────────────┐
│ currencies                    ◐ dev.7  ◇ │
│  ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪  │
│  ▪▪▪▪▪▪▪▪▪▪▪▪✦▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪  │
│  ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪  │
│  ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪✦▪▪▪▪▪▪▪▪▪▪▪▪▪  │
│  ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪            │
│                                          │
│ 168 codes  +2 today   ↳312     ⑂47       │
└──────────────────────────────────────────┘

CARD 400×275
┌────────────────────────────────────────────────────────────────────┐
│ currencies                           hub            ◐ dev.7   ◇    │
│ ────────────────────────────────────────────────────────────────── │
│  ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪      │
│  ▪▪▪▪▪▪▪▪▪▪▪▪✦▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪     │
│  ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪✦▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪◆◆◆▪▪▪▪▪▪▪▪     │
│ ────────────────────────────────────────────────────────────────── │
│  ✦ XCD  East Caribbean Dollar      2m ago   maria                  │
│  ✦ SLE  Sierra Leonean Leone       2m ago   tomas                  │
│    ZWG  Zimbabwe Gold             3d ago   maria                   │
│ ────────────────────────────────────────────────────────────────── │
│ your fork  ◆◆◆ +3 private codes · absorbing upstream · clean       │
│ 168 codes    ↳312 apps    ⑂47 forks    ⇢1                          │
└────────────────────────────────────────────────────────────────────┘
```

**The W2 delight, visible.** Two people on two continents add two codes in
the same minute. Two dots light up. Nobody reviewed anything. Your three
private codes are the `◆` cluster at the end of your fork's grid, and the
line that says *absorbing upstream · clean* is the reason your fork will
never go stale.

---

### C4 · Adapter — *the boring, stable, load-bearing part* (S1)

`hub/slack` (W3)

**What the fitted can be:**

- **(a) The capability surface.** The operations it exposes. An adapter's
  self-portrait is its API — there is nothing else to draw.
- **(b) The connection state.** Reachable, authenticated, last probed.
- **(c) The trust panel.** Vendored and hermetic, content hash, signature.

**Recommended:** (a) as the body, (b) as one live line, (c) folded into
chrome. And **let it look inert**: flat spark, hollow dot, high adoption
count. Next to a pulsing bespoke pattern the difference should be
unmistakable before you read a word.

```
STRIP 250×40
┌──────────────────────────────────────────┐
│ ◼ slack   6 ops  ○ 2.3.1   ● ok   ↳2,481 │
└──────────────────────────────────────────┘

TILE 250×170
┌──────────────────────────────────────────┐
│ slack                         ○ 2.3.1  ◇ │
│  ▸ postMessage      ▸ listChannels       │
│  ▸ uploadFile       ▸ onEvent            │
│  ▸ getUser          ▸ setTopic           │
│                                          │
│  ⚿ needs SLACK_TOKEN                     │
│  ● reachable · probed 4m ago             │
│ ▁▁▁▁▁▁ 0.3/wk    ↳2,481    ⑂12    ⇢7     │
└──────────────────────────────────────────┘

CARD 400×275
┌────────────────────────────────────────────────────────────────────┐
│ slack                                hub            ○ 2.3.1   ◇    │
│ ────────────────────────────────────────────────────────────────── │
│  ▸ postMessage(channel, blocks)      ▸ listChannels(cursor)        │
│  ▸ uploadFile(channel, file)         ▸ onEvent(type, handler)      │
│  ▸ getUser(id)                       ▸ setTopic(channel, text)     │
│ ────────────────────────────────────────────────────────────────── │
│  ⚿ SLACK_TOKEN            resolved by host at runtime · not stored │
│  ● reachable · probed 4m ago · p50 180ms                           │
│ ────────────────────────────────────────────────────────────────── │
│  vendored hermetically · no CDN at runtime · sha256 4f2a…c81       │
│ ────────────────────────────────────────────────────────────────── │
│ ▁▁▁▁▁▁▁▁ 0.3 changes/wk    ↳2,481 pin me    ⑂12    ⇢7 proposals    │
└────────────────────────────────────────────────────────────────────┘
```

---

### C5 · Pattern — *the integration itself* (S2a and S2b)

`me/ship-notes` (bespoke) and `team/message-to-doc` (generic), W3

**What the fitted can be:**

- **(a) The flow.** Trigger → transform → sink, as three marks. Universal
  across every automation anyone has ever drawn.
- **(b) The config surface.** For a generic pattern that declares a
  schema, the settings *are* the portrait — and the same schema generates
  the edit form for free.
- **(c) One worked example.** A real input and the output it produced.

**Recommended:** (a) always, and then the design decision that carries the
whole use case:

> **Bespoke shows specifics inline. Generic shows slots.**
> `#ship → Q3 Notes` versus `{channel} → {doc}`.

You can tell S2a from S2b at tile size with no label, no badge, and no
explanation. And **promotion is visible as specifics turning into slots** —
that is the S2a → S2b move, drawn.

```
STRIP 250×40   bespoke                    STRIP 250×40   generic
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│ #ship ▸ Q3 Notes   ● live   ◆ ↳1 │  │ {ch} ▸ {doc}   ○ 1.2.0  ◇  ↳38   │
└──────────────────────────────────┘  └──────────────────────────────────┘

TILE 250×170   bespoke (S2a)              TILE 250×170   generic (S2b)
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│ ship-notes           ● live   ◆  │  │ message-to-doc      ○ 1.2.0   ◇  │
│                                  │  │                                  │
│  #eng-ship                       │  │  {channel}                       │
│      │                           │  │      │                           │
│      ▼  my format                │  │      ▼  {template}               │
│      │                           │  │      │                           │
│      ▼  Q3 Ship Notes            │  │      ▼  {document}               │
│                                  │  │                                  │
│ ▁▅█▇▃ 22/hr      ↳1 (me)         │  │ ⚙ 4 settings   ↳38   ⇢2          │
└──────────────────────────────────┘  └──────────────────────────────────┘

CARD 400×275   generic, with the schema showing
┌────────────────────────────────────────────────────────────────────┐
│ message-to-doc                       team           ○ 1.2.0   ◇    │
│ ────────────────────────────────────────────────────────────────── │
│                                                                    │
│   ┌──────────┐      ┌──────────┐      ┌──────────┐                 │
│   │{channel} │ ───▸ │{template}│ ───▸ │ {document}│                │
│   └──────────┘      └──────────┘      └──────────┘                 │
│    hub/slack ^2       me/format         hub/gdocs ^1.4             │
│      ○ 2.3.1            ● live            ○ 1.4.2                  │
│ ── settings ─────────────────────────────────────────────────────  │
│   channel   ▢ required · slack channel                             │
│   document  ▢ required · gdocs doc id                              │
│   schedule  ▢ cron            trim  ▢ boolean                      │
│ ────────────────────────────────────────────────────────────────── │
│ ⑂ forked from me/ship-notes 0.9.3    ↳38 instances    ⇢2           │
└────────────────────────────────────────────────────────────────────┘
```

Note the mixed volatility on the pattern's own row of dependencies:
`○ 2.3.1` frozen next to `● live`. **One composition, two speeds** — the
thing neither Zapier nor npm can express — is one row of dots.

---

### C6 · Instance — *the binding that actually runs* (S3)

`me/ship-notes · #eng-ship`, W3

**What the fitted can be:**

- **(a) The filled-in slots.** The pattern's shape with real values in it.
  Then an instance and its pattern are visibly the same picture, one blank
  and one filled — which is the correct relationship.
- **(b) The schedule.** Last run, next run, countdown.
- **(c) The last result.** What it did, most recently.

**Recommended:** (a) with (b) folded in. And **deliberately no version
chip and no adoption count**, per §2 — the absence says *this is a record,
not a module*, which is the visual answer to whether an instance is a deck.

```
STRIP 250×40
┌──────────────────────────────────────────┐
│ ✓ #eng-ship ▸ Q3 Notes   ◆  next 3h 12m  │
└──────────────────────────────────────────┘

TILE 250×170
┌──────────────────────────────────────────┐
│ ship-notes · #eng-ship             ◆     │
│                                          │
│  from   #eng-ship                        │
│  to     Q3 Ship Notes                    │
│  when   weekdays 09:00                   │
│                                          │
│  ⚿ SLACK_TOKEN   ⚿ GOOGLE_OAUTH          │
│  ✓ 09:00 · 14 messages · next in 3h      │
└──────────────────────────────────────────┘

CARD 400×275
┌────────────────────────────────────────────────────────────────────┐
│ ship-notes · #eng-ship                              ◆ private      │
│ of  team/message-to-doc ○ 1.2.0                                    │
│ ────────────────────────────────────────────────────────────────── │
│   ┌──────────┐      ┌──────────┐      ┌──────────┐                 │
│   │ #eng-ship│ ───▸ │ shortlist│ ───▸ │ Q3 Notes │                 │
│   └──────────┘      └──────────┘      └──────────┘                 │
│    C08KJ4M2P          trim: on          1aZ…9Qk                    │
│ ── secrets ──────────────────────────────────────────────────────  │
│   ⚿ SLACK_TOKEN       ⚿ GOOGLE_OAUTH     references only           │
│ ── runs ─────────────────────────────────────────────────────────  │
│   ✓ today 09:00   14 messages   1.2s                               │
│   ✓ yesterday     9 messages    0.9s                               │
│   ✓ Tue           22 messages   1.6s        next in 3h 12m         │
└────────────────────────────────────────────────────────────────────┘
```

`⚿ SLACK_TOKEN` appearing where a value would go is the visual form of the
secret-reference rule: the card has a place for a secret, and that place
can only ever hold a name.

---

### C7 · Skill — *the prompt-plus-tools bundle*

`skills/reviewer`, W4

**What the fitted can be:**

- **(a) Behaviour.** One input and the output it produces. A skill is
  defined by what it does, and reading its prompt tells you very little.
- **(b) The eval.** One dot per harness case, pass or fail. The only real
  evaluation is running it, so show the run.
- **(c) The divergence.** What your house version adds to the community
  one — the reason your fork exists.

**Recommended:** (b) as the persistent signal at every size, (a) as the
body from Tile up, (c) in the footer. A skill card must also have an
obvious **compare slot**, because two skills side by side is the W4
delight and it should not require a special screen.

```
STRIP 250×40
┌──────────────────────────────────────────┐
│ ✎ reviewer  ●●●●●●●○●● 8/10  ◐ dev.31 ◆  │
└──────────────────────────────────────────┘

TILE 250×170
┌──────────────────────────────────────────┐
│ reviewer                     ◐ dev.31  ◆ │
│  "flag missing tests, enforce house      │
│   naming, never nitpick formatting"      │
│                                          │
│  harness  ●●●●●●●○●●   8/10              │
│           ▲ was 6/10 an hour ago         │
│                                          │
│ ▂▅█▇▆▃ 61/hr   ⑂ from skills/reviewer1.2 │
└──────────────────────────────────────────┘

CARD 400×275
┌────────────────────────────────────────────────────────────────────┐
│ reviewer                             me             ◐ dev.31  ◆    │
│ ────────────────────────────────────────────────────────────────── │
│  in   "PR: adds retry to the upload path, no tests"                │
│  out  "Missing coverage for the retry branch. Naming: `doUpload`   │
│        should be `uploadWithRetry` per house style. No comment     │
│        on formatting."                                             │
│ ── harness ──────────────────────────────────────────── compare ⇄  │
│   ●●●●●●●○●●  8/10        ▲2 in the last hour                      │
│   ✗ case 8  "flagged formatting on a prettier-managed file"        │
│ ── yours vs skills/reviewer 1.2 ─────────────────────────────────  │
│   + 4 house rules    + 1 exclusion    ~ tone                       │
│   absorbing upstream · clean                                       │
│ ▂▅█▇▆▃▅█ 61 saves/hr    31 sealed moments today                    │
└────────────────────────────────────────────────────────────────────┘
```

---

### C8 · Proposal — *someone else's version of your thing*

`you/palette → acme/palette`, cross-cutting

**What the fitted can be:**

- **(a) Both, running, side by side.** Review by looking. This is the
  whole argument of the contribution model, drawn.
- **(b) Mergeability.** Clean, or exactly which files stopped merging.
- **(c) A domain-language summary.** "+2 tones", "chart now stacks" —
  never "+41 −17 lines".

**Recommended:** (a) as the body, (b) as chrome, (c) as the caption. A
proposal is the one card where the body is **two renders**, so it needs
the pair treatment at every size — even the Strip carries a before/after
mark.

```
STRIP 250×40
┌──────────────────────────────────────────┐
│ ⑂ you/palette  ▨▸▩ +2 tones   clean   ⇢  │
└──────────────────────────────────────────┘

TILE 250×170
┌──────────────────────────────────────────┐
│ you/palette → acme/palette      clean    │
│  now      ▮▮▮▮                           │
│                                          │
│  proposed ▮▮▮▮▮▮                         │
│                                          │
│  +2 tones · dark ramp extended           │
│  by tomas · absorbing upstream · 4m      │
│                            try ▸  accept │
└──────────────────────────────────────────┘

CARD 400×275
┌────────────────────────────────────────────────────────────────────┐
│ you/palette → acme/palette                          clean · 4m ago │
│ ────────────────────────────────────────────────────────────────── │
│        now                        │        proposed                │
│   ┌─────────────────────┐         │   ┌─────────────────────┐      │
│   │ ▮ ▮ ▮ ▮             │         │   │ ▮ ▮ ▮ ▮ ▮ ▮         │      │
│   │                     │         │   │                     │      │
│   │ ▁▃▅▂ in context     │         │   │ ▁▃▅▂ in context     │      │
│   └─────────────────────┘         │   └─────────────────────┘      │
│ ────────────────────────────────────────────────────────────────── │
│  +2 tones · dark ramp extended to 900 · no token renamed           │
│  by tomas · based on 1.1.0 · rebased 6× · never conflicted         │
│ ────────────────────────────────────────────────────────────────── │
│  try in ▸ tool/app/dashboard   ops/weekly-review   (live, no build)│
│                                          accept — copies zero bytes│
└────────────────────────────────────────────────────────────────────┘
```

**The queue that follows from this card.** 200 proposals, all continuously
rebased, means the queue shows 197 tiles that are quiet and 3 with `⚠`.
Sorting by adoption of the fork — who is already running it — beats
sorting by date or by argument.

---

## 4. Supporting cards and field atoms

### Moment — *a state the world was in*

The seal, rendered as a **picture of the app at that instant** plus a
relative time. A history is then a ribbon of posters, and "the version
from forty minutes ago was better" becomes a thing you find by looking.

```
STRIP 250×40   (the ribbon is a row of these at badge size)
┌──────────────────────────────────────────┐
│ ▨ 09:41  "before the stacking change" 22m│
└──────────────────────────────────────────┘

BADGE 150×40 · the ribbon
┌────────┬────────┬────────┬────────┬────────┬────────┐
│ ▨ 41m  │ ▨ 33m  │ ▨ 28m  │ ▧ 22m  │ ▧ 9m   │ ▩ now  │
└────────┴────────┴────────┴────────┴────────┴────────┘
                              ▲ scrub · restore is forward-only
```

### Maker — *who*

Publisher scope as a person or a team. Its fitted is **what they ship and
how fast**, not a profile: avatar, three most-adopted decks, a velocity
spark. Identity is filesystem-level today and becomes Matrix identity in
the realm server, so this card is the one with a known upgrade path.

### Field atoms — *the vocabulary inside the cards*

Fields get `fitted` and `atom` too, which is why the cards above compose
rather than being drawn:

```
Entry       USD · US Dollar          a codelist row
Step        ▸ postMessage            a node in a pattern flow
Binding     #eng-ship → C08KJ4M2P    a filled slot
SecretRef   ⚿ SLACK_TOKEN            a name that can never hold a value
Version     ○ 1.4.0                  chip
Volatility  ●                        dot
Adoption    ↳312                     metric
```

A pattern's fitted is a row of `Step` fitteds. An instance's is a column
of `Binding` fitteds. **Nothing above is bespoke layout** — it is field
formats arranged by the container.

---

## 5. The surfaces that fall out

Four screens, and each is only a different container geometry over the
same cards. That is the test of whether this thesis holds.

```
THE WALL — the catalog, laid out on the axes (§2.1)
┌────────────────────────────────────────────────────────────────┐
│ realm ▾   filter: ● live  ◐ dev  ○ pinned   |  group: velocity │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │
│ │ tile   │ │ tile   │ │ tile   │ │ tile   │ │ tile   │  ← fast │
│ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘         │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │
│ │ tile   │ │ tile   │ │ tile   │ │ tile   │ │ tile   │  ← slow │
│ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘         │
└────────────────────────────────────────────────────────────────┘

THE BENCH — one app, isolated, with its parts rail
┌───────────────────────────────────┬────────────────────────────┐
│                                   │ parts                      │
│   the app, running                │ ┌────────────────────────┐ │
│   (isolated format)               │ │ strip  ● revenue       │ │
│                                   │ ├────────────────────────┤ │
│                                   │ │ strip  ⚠ funnel ^1.2   │ │
│                                   │ ├────────────────────────┤ │
│                                   │ │ strip  ○ warehouse     │ │
│                                   │ └────────────────────────┘ │
│                                   │ drop a card on a slot = ⇄  │
└───────────────────────────────────┴────────────────────────────┘

THE QUEUE — proposals; the quiet ones stay quiet
┌────────────────────────────────────────────────────────────────┐
│ ⚠ 3 stopped merging                          197 clean  ▸      │
│ ┌────────────────────────┐ ┌────────────────────────┐          │
│ │ proposal tile  ⚠       │ │ proposal tile  ⚠       │          │
│ └────────────────────────┘ └────────────────────────┘          │
└────────────────────────────────────────────────────────────────┘

THE RIBBON — moments; scrub to restore
┌────────────────────────────────────────────────────────────────┐
│ ▨ ▨ ▨ ▨ ▧ ▧ ▧ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩ ▩  │
│ 2h                          1h                            now  │
└────────────────────────────────────────────────────────────────┘
```

**Applying a use case is then trivial, which was the requirement:**

| Workload | The screen | The cards on it |
| --- | --- | --- |
| W1 swarm tool | the Bench | C2 app + eight C1 components in the rail |
| W2 codelists | the Wall, one C3 open | C3 codelist + Entry fields + C8 proposals |
| W3 adapters | the Wall on the axes | C4, C5 ×2, C6 — the four strata, visibly different |
| W4 skills | the Ribbon + compare | C7 ×2 side by side + Moment posters |

---

## 6. Directions, not prescriptions — for Claude Design

Open, in rough order of how much the answer would change the product:

1. **Who authors a deck's fitted format?** The deck itself is the honest
   answer, and then a deck without one needs a good generic fallback.
   What does the fallback show — file tree, README, first export?
2. **What runs, and when?** Forty live tiles on a wall is forty running
   modules. Poster-at-seal-time, run-on-hover, run-when-visible, and
   run-always are four different products.
3. **Is a live tile allowed to be interactive?** A chart you can hover in
   a catalog is delightful; a form you can submit in a catalog is a
   hazard.
4. **How does an instance differ visually from a module?** §2 proposes
   "no version chip, no width count". Is that enough, or does data need
   its own container shape?
5. **What does a deck with no visual output look like?** A data adapter, a
   type package, a build helper. Capability surface (C4) is one answer;
   there may be a better one.
6. **Does the axis layout (§2.1) survive contact with 3,000 decks?** It is
   a beautiful map for 40 and possibly meaningless for 3,000.
7. **How is volatility changed?** Clicking a dot to cycle live → dev →
   pinned is the compact answer, and it is also a destructive edit to a
   lock file performed by a single click.
8. **What does a private fork look like before it is offered?** Until the
   fork-to-keep vs fork-to-propose distinction is designed, every fork
   shows up as a proposal, which is wrong for the bespoke stratum.

---

## 7. What would falsify this thesis

Kept short and honest:

- **If most decks cannot render themselves cheaply**, the wall degrades to
  posters and identity, and this is just a nicer package registry.
- **If the chrome vocabulary needs more than about eight glyphs**, nobody
  learns it and the badges become noise.
- **If live tiles plus `no-store` make a wall of forty unusable**, the
  resting state has to be posters, and "review by running" goes back to
  being a click.
- **If the three axes do not actually separate real decks** — if everything
  clusters — then §2.1 is a diagram about a taxonomy rather than a map of
  a corpus.
