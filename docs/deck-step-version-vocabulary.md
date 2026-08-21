# Deck UI vocabulary — Version · Step · History · Checkpoint · Import · Pin · Entry

**Status: RULING** (2026-08-09). Product chrome uses these nouns. Eng/impl
words stay out of Hub lists, gutters, and status lines.

Companions: `deck-live-autopublish.md` (historical tier/seal wording),
`deck-laws.md`, `deck-activity-protocol.md`, `deck-depot-and-realm-backport.md`.

Supersedes: `deck-frame-version-vocabulary.md` (Frame → Tick → **Step**),
`deck-tick-version-vocabulary.md` (Tick → **Step**).

---

## 0. Two messes this kills

**History:** unqualified **seal** meant both an immutable store tree and a
jj every-save snapshot; **tier / jj** described impl, not what you see.

**Imports:** tables like “specifier / answered by / path” mixed the _ask_,
the _versioned tree that answers_, and the _file inside it_ under vague
labels (“deck”, “path”, “dependency”).

---

## 1. History — Version · Step

| UI word        | What it is                                                                                | On disk / protocol                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Version**    | One immutable package tree, forever addressable                                           | `.deck/store/…@<version>`; URL `@exact` / tags → exact                                                              |
| **Step**       | One settled **depot** save on the every-save tape                                         | jj change / historyd seal; `/<depot>/_history/<id>/…`                                                               |
| **History**    | The ordered record that holds Steps                                                       | jj repository at **`.deck/history/repo`** via deckd; URL `/<depot>/_history/…` ([`deck-daemon.md`](deck-daemon.md)) |
| **Checkpoint** | Intentional immutable collaboration point binding Repository, History, index, and parents | `.deck/store/_checkpoints/…`                                                                                        |

**Versions** are always on — that is Deck. Standalone/read-only Deck may omit
every-save **History** and show `History: Versions only`. A mutable Boxel realm
is a repository and requires deckd History; it must reject a write clearly if
the save cannot become a Step.

**jj** only in doctor/settings (“History via deckd/jj-lib”).

### 1.1 Mapping (history)

| Avoid in UI                  | Say instead                                            |
| ---------------------------- | ------------------------------------------------------ |
| tier 1                       | **Versions** (only)                                    |
| tier 2                       | **History: Every save**                                |
| jj / historyd (as status)    | **Every-save History**                                 |
| seal (jj snapshot)           | **Step**                                               |
| frame (retired)              | **Step**                                               |
| tick (retired UI word)       | **Step**                                               |
| sealed version / sealed pack | **Version**                                            |
| sealChangeId                 | **step id** (Version → Step)                           |
| “sealed” (ambiguous)         | **published** (→ Version) or **captured** (→ Step)     |
| Revision                     | **Checkpoint**                                         |
| commit object                | **Checkpoint** (CLI may keep a familiar `commit` verb) |

### 1.2 How they relate

```
depot working tree
    │  settled save
    ▼
  Step ──────────────── History (every save)
    ├──── Review/milestone ───────▶ Checkpoint
    └──── auto-publish / publish ─▶ Version
```

- Many Steps may exist between Versions.
- A Version **may** record the Step it was cut from (`step id`).
- A Version is **not** a Step. Restoring a Step does not rewrite Versions.
- A Checkpoint is **not** every save. It freezes exact state for Review,
  milestone, or merge without making authors perform commit ceremony.

### 1.3 Status copy

| State                 | Show                                                |
| --------------------- | --------------------------------------------------- |
| Store only            | `History: Versions only`                            |
| Every-save History on | `History: Every save`                               |
| Detail                | `History: Every save · via deckd` (settings/doctor) |

`/track`: store publishes → **Version**; every-save captures → **Step**.

---

## 2. Imports — Import · Pin · Entry · Leaf · Closure

What the lock / import map is showing when it lists how a page runs.

| UI word     | What it is                                  | Example                     |
| ----------- | ------------------------------------------- | --------------------------- |
| **Import**  | Bare name the code or map asks for          | `std/currencies`            |
| **Pin**     | Which **Version** answers that import       | `site/std/currencies@1.4.0` |
| **Entry**   | File inside that Version that the pin opens | `index.js`                  |
| **Leaf**    | A pin whose tree adds no further imports    | (no nested pins)            |
| **Closure** | Full set of pins needed to run              | the resolved graph          |

Optional when showing a full URL: **URL** = pin + entry as served  
(`/site/std/currencies@1.4.0/index.js`).

### 2.1 Column headers (canonical)

| Bad                      | Good                                        |
| ------------------------ | ------------------------------------------- |
| specifier                | **Import**                                  |
| answered by              | **Pin**                                     |
| path / deck (ambiguous)  | **Entry** (file) / **Pin** (versioned tree) |
| dependency (unqualified) | **Import** or **Pin**, depending on column  |

### 2.2 Summary lines

| Bad                                                                             | Good                                                      |
| ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 2 specifiers answered by 2 decks, none of which bring dependencies of their own | **2 imports → 2 pins. Both leaves** (no further imports). |
| (same, denser)                                                                  | **Closure: 2 decks · depth 1**                            |

“Deck” in “2 decks” means two **Pins** (two versioned trees), not two
Imports. Prefer **pins** in tight copy when Import and Pin both appear.

### 2.3 Mapping (imports)

| Avoid in UI                                  | Say instead |
| -------------------------------------------- | ----------- |
| specifier                                    | **Import**  |
| answered by                                  | **Pin**     |
| path (when you mean the file in the package) | **Entry**   |
| path (when you mean the served address)      | **URL**     |
| “brings no dependencies”                     | **leaf**    |
| dependency graph / module set                | **closure** |

A **Pin** names a **Version**. Live (versionless) working trees are not
pins in this table — say **live** when the map points at the working tree.

---

## 3. Activity (related nouns)

| UI word   | What it is                                     |
| --------- | ---------------------------------------------- |
| **Touch** | Edit warmth (`score` / `last` on `/_activity`) |
| **Claim** | Declared “working here” (other color; TTL)     |
| **Note**  | Optional prose on a claim / focus              |

Claims are not Steps. See `deck-activity-protocol.md`.

---

## 4. Where things live

| Store                           | Holds                     |
| ------------------------------- | ------------------------- |
| `.deck/store/`                  | **Versions**              |
| `.deck/activity/`               | Claims + activity summary |
| `.deck/history/`                | **History** / **Steps**   |
| `.deck/store/_checkpoints/`     | **Checkpoints**           |
| `.deck/refs/`, `.deck/reviews/` | branch heads and Reviews  |

---

## 5. One-line summaries

> **Version** = immutable package tree. **Step** = one every-save capture in
> **History**. **Checkpoint** = intentional collaboration point. Never call
> these “Revision”; never lead with tier/jj/frame/tick.

> **Import** → **Pin** → **Entry**. **Leaves** mean the **closure** stops.
> Never “answered by” / bare “path” / vague “dependency” in that table.

---

## 6. Hub copy audit (apply these)

Combed `apps/hub` against §§1–3. Code identifiers (`sealCache`, `/_hub/heat`,
CSS classes) may stay until renamed; **readable chrome** must use the
ruled nouns. `/start` is still a stub — no product copy to fix there yet.

### 6.1 Priority order

1. `/run` import table + summary
2. `/browse` history status cells
3. `/browse` step surfaces (lists, facts, diff labels)
4. `/track` auto-publish wording + Version vs Step marks
5. Heat / activity tooltips (Touch; Claim when protocol lands)
6. `hub.mjs` console lines

### 6.2 `/run` — import table (worst offender)

| Now                                                                                   | Better                               |
| ------------------------------------------------------------------------------------- | ------------------------------------ |
| headers `specifier` / `answered by` / `path`                                          | **Import** / **Pin** / **Entry**     |
| `N specifier(s) answered by M deck(s), none of which bring dependencies of their own` | **N imports → M pins. Both leaves.** |
| `…bring their own dependencies`                                                       | **…and K scopes add further pins**   |
| denser alternative                                                                    | **Closure: M pins · depth 1**        |
| `resolves nothing — this page imports no decks`                                       | **…has no imports**                  |
| index `where: sealed`                                                                 | **Version** / **published**          |
| `reload the frame`                                                                    | **reload the stage**                 |

Keep: empty/refusal honesty, trial/`?with=`, stage sizes, depot-not-mounted
errors, “not a page → run it inside a page that imports it.” The reverse
import edge is a normal Run handoff; a package with no declared graph consumer
gets an actionable explanation instead of an error.

### 6.3 `/browse` — history status

| Now                                | Better                                                 |
| ---------------------------------- | ------------------------------------------------------ |
| `jj · seals`                       | **History: Every save** (optional detail: `via deckd`) |
| `tier 1`                           | **Versions** / `History: Versions only`                |
| `tier 1 — no seals`                | **Version history only**                               |
| facts `history` → `jj` or `tier 1` | **History: Every save** / **History: Versions only**   |
| `+ sealed` / `sealed only`         | **+ Versions** / **Versions only**                     |

Keep column headers `depot` / `decks` / `history` / `on disk` if cell values are fixed. Keep `·live`, immutable/forever, tag one-hop notes.

### 6.4 `/browse` — step surfaces

| Now                                             | Better                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `N seals` / filter `seals`                      | **N steps**                                                       |
| `changeId`                                      | **step id**                                                       |
| `kind: seal` / fact `seal`                      | **step**                                                          |
| `depot@seal abc…`                               | **depot@step abc…**                                               |
| `{backend} cannot list this seal`               | **History cannot list files for this step**                       |
| `until it is sealed. Pick a published version…` | **until it is published as a Version. Pick a published version…** |
| option note default `'seal'`                    | **`step`**                                                        |

Keep: live vs published Version picker notes, diff `base`/`viewing`, permanence errors, keyboard legends.

### 6.5 `/track`

| Now                                | Better                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `auto-saved` / switch `auto-saves` | **auto-published** / **auto-publishes** (these are **Versions**, not Steps) |
| (no type mark on rows)             | Label or mark: **Version** vs **Step**                                      |

Keep: `published` / `released`, file action verbs (`edited`, `added`, …), `diff →` / `open →`, empty states, sort keys.

### 6.6 Shared — heat / activity (`ui/heat`)

| Now                                            | Better                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| “heat” / `last change {ago}` as the only story | **touched {ago}** (Touch channel)                                    |
| (no claim affordance)                          | When `/_activity` claims exist: second color — **claimed · {actor}** |

Keep: soft degrade when the endpoint is missing; gutter-as-bar (not row tint).

### 6.7 Shared — nav

Keep as-is: lens labels/titles (`start` / `browse` / `run` / `track`), `live` / `changed:` / disconnect, theme names, `DECK` home.

### 6.8 `hub.mjs` (console + stubs)

| Now                                  | Better                                                 |
| ------------------------------------ | ------------------------------------------------------ |
| `saved → … sealed {id}`              | **… step {id}** (or **captured {id}**)                 |
| `sealed as site` / pin names a depot | **published as `site`** (keep **pin** for import pins) |
| `demo frame comes up blank`          | **demo stage** / **demo iframe** comes up blank        |

Keep: not-built stub honesty, port-in-use help, `depots mounted` / `runs at`.

### 6.9 Out of scope for this pass

- Renaming JS identifiers / API fields (`tier: 2`, `backend: jj`) — fix **presentation** first; schema later
- HTML/build-log comments (`setup.mjs` “already sealed”)
- `/start` product copy (not built yet)
- CSS class names (`s-seal`) unless they appear as text

### 6.10 Done when

Hub chrome can be read without the words **tier**, **jj** (except doctor footnote), **frame** (except iframe/stage), **tick** (history sense), or unqualified **seal** — and the /run table says **Import / Pin / Entry**.
