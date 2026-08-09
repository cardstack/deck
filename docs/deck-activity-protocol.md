# Activity — one endpoint for agent focus + story

**Status: PROPOSAL** (2026-08-09). **`GET /_activity` replaces `/_heat`**
(and Hub’s `/_hub/heat`). One protocol surface for **where agents are
working** and, when asked, **enough story to watch them** — run URL, code
locator, commentary — without a second focus API.

Companions: `deck-live-autopublish.md`, `deck-hub-brief.md` (`/track`,
`/run`, `/browse`), `deck-land-hostnames.md`, `deck-laws.md`.  
Supersedes: `deck-heat-protocol.md` (folded in here).

---

## 0. Product job — cameras + cut, one door

Observation canvas: run iframes, code/diff portals, commentary. Human
watches **telepresence: agents working on these**.

```
working trees on cloud / local
        │
        ▼
   GET /_activity?top=12&grain=package&story=1
        │
        ▼
   ranked foci, each with score + actors + story bits
        │
        └── canvas lays out portals — a living movie
```

Browse gutters use the **same** endpoint with a cheaper query
(`children=1`, no `story`). One ranking, one module, no second warmth.

---

## 1. Law (unchanged) — activity score \(S\)

\[
w(\Delta t) = e^{-\Delta t / \tau}
\quad(\tau\ \mathrm{default}\ 2\mathrm{h})
\]

Leaf: \(S(p,t) = \sum_i w(t - t_i)\) over change events.  
Prefix: sum of leaves under it.  
Online: EWMA on the node, lazy decay at read, **delta-bubble ancestors**
in \(O(\mathrm{depth})\).

Sparse trie; drop nodes below \(\varepsilon\). Not part of `tree-hash-v1`.
Not CDN traffic. Not Merkle.

**Events** carry optional **`actor`** (agent / session id). Trie keeps
per-prefix `score`, `last`, and `actors[]` (top contributors in-window, or
weighted shares — implementation choice; must be stable enough for UI).

### 1.1 Two signals (do not mix)

| Signal | Meaning | Typical UI |
| --- | --- | --- |
| **Touch** (`score` / `last`) | Bytes actually changed here lately (EWMA / freshness) | Warmth gutter — e.g. green bar, “5m ago” |
| **Claim** (`claims[]`) | An agent **declared** it is working here (intent), with TTL | Different color — e.g. violet / amber pip — “agent-b · claimed” |

A claim without saves is still stage-worthy (agent just said so).  
Saves without a claim still show touch warmth.  
Both can be true at once — **two channels, two colors**, not one blended score.

Claims do **not** increment \(S\). Notes (`story.note`) are commentary text;
a claim is the structured “I am here” bit (optional text allowed).

---

## 2. One endpoint

```
GET /_activity
GET /_activity?prefix=/site/acme&children=1
GET /_activity?top=12&grain=package
GET /_activity?top=12&grain=package&story=1
GET /_activity?prefix=/site/acme/palette&story=1
```

| Query | Role |
| --- | --- |
| `prefix=` | Score (and optional story) for one path |
| `children=1` | Direct children under `prefix` — **gutter / zoom** |
| `top=N` | Ranked foci — **canvas shortlist** |
| `grain=` | `depot` \| `package` \| `file` — camera distance for `top` |
| `story=0` | **Default.** Lean: ranks + actors only (poll-cheap) |
| `story=1` | Attach story pack per returned focus (canvas tick / enter) |

`cache-control: no-store`. Missing endpoint → undecorated UI / empty stage.

### 2.1 Lean focus object (`story=0`)

```json
{
  "now": 1735689600000,
  "tau": 7200000,
  "window": 172800000,
  "foci": [
    {
      "id": "/site/acme/palette",
      "prefix": "/site/acme/palette",
      "grain": "package",
      "score": 12.4,
      "last": 1735689500000,
      "actors": [{ "id": "agent-b", "score": 8.1 }],
      "claims": [
        {
          "actor": "agent-b",
          "since": 1735689400000,
          "until": 1735691200000,
          "text": "merge policy for ZWG"
        }
      ]
    }
  ]
}
```

| Field | Channel |
| --- | --- |
| `score` / `last` | **Touch** — edit EWMA / freshness |
| `actors` | Who contributed to touch score |
| `claims` | **Claim** — active declarations (empty array if none); omit expired |

`id` === canonical prefix (segment-bounded). Canvas uses it as **stable
slot key** across ticks so rank jitter does not remount iframes.

`children=1` response may use a `children` map instead of `foci`; each
child is the same lean shape (plus a relative `name` segment). Gutters
read `claims.length` / `score` separately for the two colors.

**`top=N` ranking:** merge touch and claim — a prefix is eligible if it is
hot **or** has a live claim (so pre-edit intent still gets a camera).
Order: product default = claim-boosted touch (e.g. claimed rows sort above
equal `score`, or a small additive boost that does not rewrite \(S\)).

### 2.2 Story pack (`story=1`) — same objects, richer

Each focus MAY gain:

```json
{
  "id": "/site/acme/palette",
  "prefix": "/site/acme/palette",
  "grain": "package",
  "score": 12.4,
  "last": 1735689500000,
  "actors": [{ "id": "agent-b", "score": 8.1 }],
  "story": {
    "run": "/site/acme/palette/",
    "code": {
      "at": "/site/acme/palette/palette.js",
      "vs": null,
      "browse": "/browse?at=/site/acme/palette/palette.js"
    },
    "track": [
      { "at": 1735689500000, "verb": "sealed", "summary": "M palette.js", "actor": "agent-b" }
    ],
    "note": {
      "text": "wiring merge policy for ZWG",
      "actor": "agent-b",
      "at": 1735689490000
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `run` | Live (versionless) URL for the iframe — HMR-friendly |
| `code.at` | Warmest file under the focus (or package root) |
| `code.vs` | Prior seal / version for diff when known; else null |
| `code.browse` | Hub deep-link into diff/raw (optional if no Hub) |
| `track` | Short scoped river (cap ~5–20); same verbs as `/track` |
| `note` | Latest agent commentary for this prefix, if any |

**Still not in `/_activity`:** full file bytes, iframe HTML, unbounded
history. Those stay ordinary Deck GETs / `/track?scope=` when the human
zooms in.

### 2.3 Why one endpoint (and why `story` is a flag)

| Anti-pattern | Problem |
| --- | --- |
| `/_heat` + `/_focus` | Two rankings drift; canvas and gutters disagree |
| Always-on story | 1 Hz poll × N foci × track slices = cloud bill / lag |
| **`/_activity` + `story=0\|1`** | One law, one trie; poll lean; enrich on cut or slow tick |

Canvas pattern: poll `?top=12&story=0` often; on **enter/rise** or every
~5–10s, request `story=1` for visible ids only
(`?prefix=…&story=1` or `?top=12&story=1` when the stage is small).

---

## 3. Writes

| Source | Channel | Updates |
| --- | --- | --- |
| Seal `filesSummary` | touch | file leaves + bubble; `actor` on seal/meta |
| Publish / live bus | touch | package (+ paths if known) |
| `POST /_activity/claim` | **claim** | set/refresh declaration on prefix; **does not** bump \(S\) |
| `DELETE /_activity/claim` | claim | clear (agent done / moved on) |
| `POST /_activity/note` | story | commentary text; does not bump \(S\); may sit on a claim |
| Mtime walk | touch | bootstrap / reconcile only |

### 3.1 Claim (required for the two-color story)

```http
POST /_activity/claim
{ "prefix": "/site/acme/palette", "actor": "agent-b", "text": "merge policy for ZWG", "ttlSec": 1800 }

DELETE /_activity/claim
{ "prefix": "/site/acme/palette", "actor": "agent-b" }
```

| Rule | |
| --- | --- |
| Default TTL | 30 min if omitted; server clamps (e.g. max 2h) |
| Refresh | Same actor+prefix POST extends `until` |
| One live claim per actor | New prefix moves the claim (or allow many — default **one** so the stage stays honest) |
| Expiry | Dropped from `claims[]` when `now > until`; SSE may emit clear |

### 3.2 Note (optional text)

```json
{ "prefix": "/site/acme/palette", "actor": "agent-b", "text": "…" }
```

Auth = cloud write auth; local Hub may open in dev.

---

## 4. Live (SSE)

Prefer one event type on `/_live/events` (or `/_activity` stream):

```json
{
  "type": "activity",
  "id": "/site/acme/palette",
  "score": 12.4,
  "last": 1735689500000,
  "actors": ["agent-b"],
  "claims": [{ "actor": "agent-b", "until": 1735691200000 }]
}
```

Claim set/clear SHOULD emit as well (`claims` empty = no active claim).

Canvas **cut grammar** (product law, client-enforced):

| Cut | When |
| --- | --- |
| enter | new id in top-N (touch **or** new claim) |
| rise / fall | rank change; keep slot (`id` stable) |
| fade | score cold **and** no live claim |
| exit | left top-N longer than min dwell (e.g. 5–10s) |

On enter/rise: fetch `story=1` for that `id`. Lean events never carry full
story.

---

## 5. Host scope

| Host | `/_activity` |
| --- | --- |
| local / cloud working depots | Yes |
| cdn | No (immutable); do not overload with download popularity |

---

## 6. Client rules

1. Gutters: `?prefix=&children=1` (`story=0`).
2. Canvas: `?top=N&grain=package` lean poll; `story=1` on cut / slow refresh.
3. Slot DOM by `id`, not by array index.
4. Normalise scores per view (e.g. fourth-root vs max on stage).
5. Soft degrade if endpoint missing.
6. One shared client helper (`ui/activity` — today’s `ui/heat` renamed) so
   browse / run / canvas never fork rankings.

**Migration:** `/_hub/heat` and any `/_heat` alias → `301` or dual-mount
`/_activity` with the old leaf-map shape behind `?leaves=1` (capped) for one
release, then remove.

---

## 7. Implementation slices

| Slice | Deliverable |
| --- | --- |
| A0 | Law + trie + actor field on events |
| A1 | `GET /_activity` lean: prefix, children, top, grain; **`claims[]`** |
| A2 | `POST/DELETE /_activity/claim` + TTL; two-color gutter/canvas |
| A3 | `story=1` pack: run, code locators, track cap, note |
| A4 | Hub: replace `/_hub/heat`; gutters + canvas poller |
| A5 | `POST /_activity/note` + SSE `activity` cuts |
| A6 | rebuild-from-seals; conformance; retire heat paths |

**LOC (order of magnitude):** lean A0–A1 ≈ prior H1 (~250–350); story pack
A2 ≈ +150–250; Hub A3 ≈ +100–150; notes+SSE A4 ≈ +100–150. Full A0–A5
roughly **~800–1.3k** LOC — still one protocol, not two services.

---

## 8. One-line summary

> **`GET /_activity` is the only agent-activity door:** touch warmth (\(S\) /
> `last`) plus explicit **claims** (declared work, other color), optional
> `story=1` for run/code/commentary — so a human watches agents at work.
> Replaces `/_heat`. Not identity, not Merkle, not CDN traffic.
