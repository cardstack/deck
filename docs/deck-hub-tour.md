# Hub tour — four stories (read-only)

A walk of the **protocol** through live Hub UI — not a tutorial on using the
Hub. Each chapter is one use case from
[`deck-use-cases.md`](deck-use-cases.md). The UI is the exhibit; the bottom
bar holds the story caption. Highlights are theme-coloured rings, not
overlays that bury the stage.

**In the Hub:** `/start` → **Walk the stories**, or `/start?tour=1`. The
bottom bar owns Next / Prev / Exit. Esc abandons. Nothing in this script
publishes, releases, locks, accepts, or restores.

Companions: [`deck-hub-brief.md`](deck-hub-brief.md),
[`deck-demo-brief.md`](deck-demo-brief.md),
[`deck-use-cases.md`](deck-use-cases.md).

---

## Bring the Hub up

```bash
node apps/hub/setup.mjs          # once — Hub demo packs
# demos under examples/*/ must have been run so their depot/ stores exist
DECKD_URL=http://127.0.0.1:8787 node apps/hub/hub.mjs
```

| App | Question |
| --- | --- |
| `/start` | What is this machine holding right now? |
| `/browse` | What are these bytes? |
| `/run` | What do they do when assembled? |
| `/track` | What changed? |

**Rule:** if a control would write — skip it. Prefer subject, volatility,
Timeline scrub, list browsing, and `?with=` trials. Prefer **live** paths
over brittle `@exact` pins when the tip is enough.

---

## Product behaviour

While the tour is active:

- **Theme highlight** — a cutout plus a pulsing ring. No popover over the UI.
- **Caption in the bottom bar** — chapter · step · story line · exhibit.
- Interactions are *exercised*: **list-browse**, **dropdown**, **scroll**,
  **Timeline scrub**.
- Chapter boundaries navigate with `?tour=1` and session state.

---

## Chapter map

| # | Chapter | Use case | Exhibit |
| --- | --- | --- | --- |
| 1 | Eight desks, one board | §1 swarm | `two-agents` |
| 2 | Two currencies land in the same minute | §2 codelist | `codelist` |
| 3 | Try it before you take it | §3 review-by-running | `contribute-to-codelist` |
| 4 | The hour you abandoned is still an address | §4 high-frequency keep | `vale-sale` |

Within each chapter, flip browse ↔ run ↔ track on the **same subject** —
that flip is the lesson.

---

## Interaction choreography

| Interaction | Where | What the tour does |
| --- | --- | --- |
| **List-browse** | Ch1 — `/browse?at=/two-agents` | Select a desk row (`agent-a` / `charts`) |
| **Dropdown** | Ch2 — currencies `@latest`; Ch4 — vale/sale | Open the version `<select>` |
| **Trial** | Ch3 — picker then `?with=` | Same page, rebound pin in the map |
| **Timeline scrub** | Ch4 — `/run` vale/sale | Click ◀ on the Timeline (same as `[`) |
| **Scroll** | Ch4 — `/track?at=/vale-sale` | Scroll the change feed |

---

## Chapter 1 — Eight desks, one board

**Use case:** swarm-built tool
([§1](deck-use-cases.md#1-the-swarm-built-internal-tool)).

| Beat | Where | Look at | Prepare | Caption |
| --- | --- | --- | --- | --- |
| 1 | `/browse?at=/two-agents` | catalog | list-browse | Each row is a publisher’s desk. The board is this list, composed at load. |
| 2 | `/run?at=/two-agents/app/board/index.html` | stage | — | Review the swarm by watching the board — pins are the composition. |
| 3 | same run | resolved map | — | The resolved map is the merge. Freeze one pin; quarantine one agent. |
| 4 | `/track?at=/two-agents` | feed | — | Every agent save is already a row with an address. |

---

## Chapter 2 — Two currencies land in the same minute

**Use case:** codelists / reference data
([§2](deck-use-cases.md#2-codelists-and-reference-data)).

| Beat | Where | Look at | Prepare | Caption |
| --- | --- | --- | --- | --- |
| 1 | `/run?at=/codelist/app/viewer/index.html` | stage | — | A live exchange board. Amendments move the count from across the room. |
| 2 | `/browse?at=/codelist/std/currencies@latest` | volatility | open-vol | Open version control. Cuts are immutable; `latest` is a tag. |
| 3 | `/browse?at=/codelist/std/currencies@1.5.0` | subject | — | Only the `@segment` moved. Same path, frozen bytes. |
| 4 | `/track?at=/codelist` | feed | — | Amendments land as published rows when they seal. |

---

## Chapter 3 — Try it before you take it

**Use case:** adapters & contribution queue
([§3](deck-use-cases.md#3-adapters-patterns-and-the-automation-you-wrote-for-yourself)).

| Beat | Where | Look at | Prepare | Caption |
| --- | --- | --- | --- | --- |
| 1 | `/run?at=/contribute-to-codelist/app/picker/index.html` | stage | — | Side-by-side boards. “Try this one” is `?with=` — not a checkout. |
| 2 | same + `?with=std/currencies=ana/currencies` | graph | — | Only the rebound specifier moves. A proposal is a runnable URL. |
| 3 | ana vs std in `/browse` | review fold | expand-review | Publisher segment is the fork boundary. Key-level truth. |

---

## Chapter 4 — The hour you abandoned is still an address

**Use case:** skills / high-frequency iteration
([§4](deck-use-cases.md#4-skills-and-agent-capabilities)).

Exhibit is **vale-sale** — visual page, deep `-dev.N` stack, real Timeline.

| Beat | Where | Look at | Prepare | Caption |
| --- | --- | --- | --- | --- |
| 1 | `/browse?at=/vale-sale/vale/sale` | volatility | open-vol | Auto-published `-dev.N` stack. Interesting states live between releases. |
| 2 | `/run?at=/vale-sale/vale/sale/index.html` | stage | — | Past is a URL you can load in this frame. |
| 3 | same run | Timeline | scrub-timeline | Scrub ◀ — iframe follows `/_history/<id>/…`. |
| 4 | `/track?at=/vale-sale` | feed | scroll-feed | Saved rows deep-link into browse. |

---

## What this script deliberately skips

| Skip | Why |
| --- | --- |
| Write path (`publish` / `release` / `lock` / `fork`) | Read-only stories |
| Hub museum / self-orientation | Lenses on demos teach the grammar |
| Extra chapters (three-js, potluck, …) | Same lessons; vale-sale carries VCS + scrub |

Second script later: “edit, seal, publish.”

---

## If something is empty

| Symptom | Likely cause |
| --- | --- |
| Blank demo frames | Sidecar origin down — restart Hub with `DECKD_URL` |
| No Timeline | deckd down — Versions still work |
| Thin volatility / feed | Re-seed demos / re-run example `demo.mjs` |
| Divergent Step | Restart Hub after pulling history fixes |

Still stuck: `/start` live counts. Depots = 0 means you are not on a finished boot.
