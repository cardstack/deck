# deck.land hostnames — apex, local, cloud, cdn

**Status: RULING** (2026-08-08). `deck.land` is registered for a future
hosted Deck server, unpkg-style delivery, and marketing. This note freezes
the hostname map and how it relates to **hub** (the frontend app) and to
**depots** (storage mounts — a different word).

Companions: `deck-depot-and-realm-backport.md` (depot vocabulary),
`deck-efficient-delivery-spec.md` (CDN / edge delivery), `deck-ui-spec.md`
(product surfaces).

---

## 0. Two naming layers that must not collide

| Layer | Example | What it is |
| --- | --- | --- |
| **App** | `@cardstack/deck-hub` | Shared, forkable frontend. Read / run / browse / start live *inside* it as routes (or sub-apps), not as hostnames. |
| **Host** | `cloud.deck.land` | Where a Deck **server** answers HTTP. |

**Hub is not a hostname role.** Do not use `hub.deck.land` for sync, API, or
CDN — that name is reserved in product language for the UI people fork and
run.

**`/read`, `/run`, `/browse`, `/start` are not depots.** They are routes in
hub: different UIs in front of the same local (or cloud) server. Depots are
mounts the *server* exposes (`/site/…`, etc.).

---

## 1. The map

```
deck.land              marketing + hosted hub entry
├── local.deck.land    this laptop's Deck server (dev)
├── cloud.deck.land    hosted Deck server (sync / your depots in the sky)
└── cdn.deck.land      sealed modules — unpkg-shaped, cache forever
```

| Hostname | Serves | Cache / auth posture |
| --- | --- | --- |
| **`deck.land`** | Marketing site; link into hosted hub | Normal site |
| **`local.deck.land`** | Same protocol as prod, process on the laptop | Dev TLS; often private |
| **`cloud.deck.land`** | Hosted Deck server: depots, publish/sync, JWT if any | Mixed — APIs private; public reads as configured |
| **`cdn.deck.land`** | Immutable sealed trees / exact versions | `public, max-age=…, immutable`; no session cookies |

**Pairing people will say out loud:**

- “Run hub against **local**” → `https://local.deck.land`
- “Push this depot to **cloud**” → `https://cloud.deck.land`
- “Import from **cdn**” → `https://cdn.deck.land/…@1.2.3/…`

---

## 2. Why `cloud` (not remote / hub / sync)

| Candidate | Why not (or why yes) |
| --- | --- |
| **cloud** | **Chosen.** Hosted counterpart to local; plain English; not stolen by the hub app name. |
| remote | Fine, but colder and less product-y. |
| sync | Names one verb; cloud is also where you *browse* hosted depots. |
| hub | **Taken** — frontend app. |
| origin | Easy to confuse with HTTP “origin” and with git upstream. |
| api | Undersells “full Deck server with depots,” oversells JSON-only. |

CDN stays a **separate** hostname so immutable module delivery is never
tangled with hub cookies or sync credentials.

---

## 3. What each host is *for* in the workflow

### 3.1 Local development — `local.deck.land`

- Deck server on the laptop (CLI / hub’s backend).
- Hub opens here so absolute URLs, cookies, and CORS match prod shape.
- DNS: `local.deck.land` (and optionally `*.local.deck.land`) → `127.0.0.1`.
- **DNS does not carry a port.** Either:
  - use `https://local.deck.land:8788` with the server’s own TLS, or
  - put **Caddy / Traefik on the laptop** on `:443` and reverse-proxy to the
    app port (typical “no port in the URL” setup).

Caddy/Traefik are **dev-machine** installs, not something on the
`deck.land` zone by default. Until a proxy exists, `https://localhost:<port>`
with the reference server’s leaf is enough.

### 3.2 Hosted server — `cloud.deck.land`

- Future hosted Deck server: the place depots sync to / from.
- Hub (hosted or local) can target cloud as the remote store.
- Same Deck HTTP grammar as local; different trust and availability.

### 3.3 Module CDN — `cdn.deck.land`

- unpkg-like: exact sealed versions, long-lived cache, edge H2/H3 + brotli
  (see efficient-delivery spec).
- May be the same fleet as cloud with a different vhost and cache policy,
  or a dedicated edge in front of object storage — product choice later.
- Must not be the cookie/session host for hub.

### 3.4 Apex — `deck.land`

- Marketing and onboarding.
- “Open hub” CTA may deep-link to cloud-backed hub or to a download/`deck
  hello` path for local-first users.

---

## 4. Hub on these hosts

Hub is one app. It is **not** four hostnames.

| Surface in hub | Route (example) | Job |
| --- | --- | --- |
| Start | `/` or `/start` | Local status dashboard |
| Read | `/read` | Docs / deckbook / CLI docs as runnable decks |
| Run | `/run` | Choose demos; run ↔ code/diff |
| Browse | `/browse` | Trees, files, versions, seals |

Hosted: hub is served from **`deck.land`** (or a path on cloud) and *talks
to* **`cloud.deck.land`** / **`cdn.deck.land`** for data and modules.

Local: hub is served from **`local.deck.land`** (or localhost) against the
laptop server; sync features aim at **`cloud.deck.land`** when the user is
signed in / has a remote configured.

---

## 5. Sync sketch (hostname-level only)

```
laptop                         deck.land zone
────────                       ──────────────
hub UI ──► local.deck.land       (read/write working depots)
              │
              │  deck sync / publish (future)
              ▼
           cloud.deck.land       (hosted depots, auth)
              │
              ▼
           cdn.deck.land         (optional: public sealed mirrors)
```

Identity and tokens live on **cloud** (or apex auth), never on **cdn**.
Module `<script type="module">` and import maps prefer **cdn** URLs for
anything immutable.

---

## 6. DNS checklist (when we wire it)

| Record | Type | Value | Proxied? |
| --- | --- | --- | --- |
| `local.deck.land` | A/AAAA | `127.0.0.1` / `::1` | **DNS only** (must not orange-cloud) |
| `*.local.deck.land` | A/AAAA | `127.0.0.1` / `::1` | DNS only (optional) |
| `cloud.deck.land` | CNAME/A | hosted LB / tunnel | Edge as desired |
| `cdn.deck.land` | CNAME/A | CDN / same origin different policy | Edge; cache rules aggressive |
| `deck.land` | apex | pages / marketing | Edge |

`local.*` → loopback is a common pattern; every developer’s resolver returns
their own machine. Never put that record behind a reverse proxy at the
registrar.

---

## 7. Out of scope here

- Exact sync protocol and auth (JWT, device login, etc.).
- Whether cloud and cdn share one cluster.
- React hub implementation and vendoring of its four sub-apps.
- Renaming today’s `examples/hub` demo launcher — leave demos as-is for now.

---

## 8. One-line summary

> **Hub** is the app. **Local** is your laptop’s server. **Cloud** is the
> hosted server you sync with. **CDN** is immortal sealed modules.
> **Apex** is the front door. Routes in hub are not depots; depots live
> under the server’s URL space on local or cloud.
