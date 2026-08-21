# Proposal: isolate Deck Core (backportable) from Tools

**Status: PROPOSAL** (2026-08-09). Companion to
[`deck-depot-and-realm-backport.md`](deck-depot-and-realm-backport.md),
[`deck-laws.md`](deck-laws.md), [`deck-at-rest.md`](deck-at-rest.md).

---

## 0. Why

Boxel needs the **Deck contract** — laws, serve grammar, packs/store,
Versions, History (jj), restore — not the Hub UI, teaching demos, or
CLI sugar built to exercise this repo.

Today that contract is mixed with operator chrome in one workspace.
Backport then sounds like “port Deck,” which pulls Hub, examples, and
docs along by accident. Split the repo so the backportable surface is
one named thing with one dependency cone.

---

## 1. Names

| Product name | Meaning |
| --- | --- |
| **Deck Core** | The backportable protocol implementation. What a deck-enabled realm embeds. |
| **Deck Tools** | Everything that *uses* Core to develop, demo, browse, and teach in this repo. |

Package rename (to avoid colliding with today’s `@deck/core` library):

| Today | After |
| --- | --- |
| `@deck/core` (tree/pack/store lib) | folds into **`@deck/protocol`** (or stays as an internal module of Core — see §3) |
| `@deck/server` | part of Core |
| `@deck/history` | part of Core (jj / historyd) |
| `@deck/conformance` | stays with Core (defines “implements Deck”) |
| `@deck/cli` | **Tools** |
| `apps/hub` | **Tools** |
| `examples/*` | **Tools** |
| teaching `deckbook`, store browser chrome | **Tools** (or delete from Core’s serve path) |

**Ruling on the word “core”:** product speak = **Deck Core**. npm scope
for the backportable graph = **`@deck/protocol`** (and friends), so we
never say “import from `@deck/core`” while meaning three different
things. If we keep a fine-grained `@deck/tree` / `@deck/store` later,
they still live only under the Core workspace.

---

## 2. The cut — what is Core

Core is whatever Boxel must reimplement or vendor to pass `deck conform`
and speak the HTTP grammar. Roughly today’s:

```
packages/core/src/          # identity, pack, store, lock, merge, …
packages/server/src/        # serve live / @exact / tag / history / activity
packages/history/src/       # History via jj or historyd; restore
packages/conformance/       # L1–L12 black box
```

**In (~12.5k LOC src, ~20k with tests):**

- L1–L12 and pack equivalence  
- Depot mount, live + sealed serve, digests, gzip, `?meta` (incl. live)  
- Import-map injection / resolution helpers needed to *serve* hermetically  
- Watcher → auto-publish `-dev.N` (realm may replace the watcher; the
  publish/store APIs stay)  
- History: seal list, file-at-step, restore (append-only)
- Activity read path (`GET /_activity`) + claim file layout (writers may
  stay CLI/Tools)  
- `deck conform` suite  

**Out of Core (Tools):**

| Move to Tools | Why |
| --- | --- |
| `apps/hub` | Operator UI; inspiration for Boxel, not a dependency |
| `packages/cli` | Agent/human mouth; Boxel has its own CLI |
| `examples/*` | Transcripts and demos |
| `server` browser-ui, deckbook routes | Teaching chrome on the origin |
| Hub-only `/_hub/*` actions | Local console, not protocol |
| Docs that are Hub/UX vocabulary | Keep laws + serve grammar with Core; Hub brief → Tools |

**Optional trim inside Core before first Boxel drop** (same package,
smaller cone): npm vendor (`vendor-npm`, `npm`), derived minify pipeline,
rebase-daemon if Boxel sync replaces it. Target lean Core ≈ **8–10k LOC**
if those stay Tools-only until needed.

---

## 3. Workspace shape

```
deck/
  core/                         # Deck Core — backportable
    packages/
      protocol/                 # today’s core+relevant server primitives
      serve/                    # HTTP grammar (today’s server, slimmed)
      history/                  # jj / historyd
      conformance/
    README.md                   # “this is what Boxel embeds”
  tools/                        # Deck Tools — this repo’s product
    packages/
      cli/
    apps/
      hub/
    examples/
    docs/                       # hub, land, UX notes (or keep docs/ at root)
```

Soft first step (no big-bang move): **pnpm workspace groups** and a
dependency lint rule — Tools may depend on Core; Core must not depend on
Tools. Physical `core/` / `tools/` directories can follow once imports are
clean.

```
@deck/protocol
@deck/serve          # or merge into protocol if one package is simpler
@deck/history
@deck/conform

@deck/cli            # tools
@deck/hub            # tools (app)
```

Prefer **one publishable Core tarball** for Boxel (`@deck/protocol` meta
package exporting serve + history) over five deep imports — Boxel wants
a contract, not a package archaeology dig.

---

## 4. Dependency law

1. **Core → nothing in Tools.** CI fails the build if `core/**` imports
   `tools/**` or `apps/hub/**`.
2. **Tools → Core only via public exports.** No reaching into
   `server.ts` private helpers from Hub.
3. **Conformance runs against Core alone.** Hub is not required to say
   “this implements Deck.”
4. **jj is a Core peer:** `@deck/history` documents `jj` (or historyd)
   as a runtime peer; absence means Versions-only (History off), which
   is already the product rule.

---

## 5. What Boxel actually vendors

```
Boxel realm server
  └── Deck Core
        ├── store / pack / tree-hash (Versions)
        ├── serve grammar (live / @exact / tag / ?meta / digests)
        ├── History adapter (jj or Boxel’s history sidecar)
        └── conform suite (CI gate on the realm)
```

Hub, examples, and `deck claim` UX stay here as **reference clients**.
Boxel builds Run / Track / Catalog on Core’s HTTP + files, not on Hub
components.

---

## 6. Migration steps (standalone repo)

1. **Inventory imports** Hub/CLI/examples → server/core/history; list
   accidental Core→Tools edges (expect few).
2. **Extract teaching routes** from `@deck/server` (`browser-ui`,
   `deckbook`) into Tools or a `@deck/serve-extras` that Core does not
   load by default.
3. **Rename packages** toward `@deck/protocol` / `@deck/serve` /
   `@deck/history`; keep shims so this repo’s scripts keep working.
4. **Workspace split** (`core/*`, `tools/*`) + eslint
   `no-restricted-imports`.
5. **Document the Boxel drop:** one README in `core/` with laws pointer,
   serve grammar, history peer, conform command.
6. **Optional lean pass:** move npm-vendor and demo-only server bits to
   Tools.

No URL break for mounted depots. No law change. This is packaging and
dependency direction, not a protocol revision.

---

## 7. Size (today’s tree, approx.)

| Slice | Src LOC | With tests |
| --- | ---: | ---: |
| Core (core + server + history) | ~12.5k | ~20k |
| + conformance | +1.3k | — |
| Lean Core (trim vendor/demo chrome) | ~8–10k | — |
| Tools (hub + cli + examples excl. depots) | ~20k | — |
| Docs | ~13k | mostly Tools + design |

Disk for Core sources today: on the order of **~0.5 MB** (not counting
`node_modules` or example depots).

---

## 8. Success criteria

- [ ] A clean checkout of **only** the Core workspace builds and
      `deck conform` (or `pnpm --filter @deck/conform`) passes against
      a Core-only server.
- [ ] Boxel can depend on one Core package entry without pulling Hub or
      examples.
- [ ] README one-pager: “Deck Core vs Deck Tools” with the table in §2.
- [ ] Hub still runs from Tools against Core exactly as today.

---

## 9. Open choices (decide when implementing)

1. **One package vs three** under Core (`@deck/protocol` umbrella vs
   protocol + serve + history).
2. **Keep `@deck/core` name** as the lib and call the product “Deck
   Core” only in prose — simpler rename, weaker clarity.
3. **CLI claim/note/publish:** thin wrappers in Tools over Core APIs, or
   a minimal `@deck/bin` shipped inside Core for agents. Prefer Tools
   wrappers; Core exports functions, not a full CLI UX.
4. **Where docs live:** laws + serve grammar travel with Core; Hub brief
   and land hostnames stay Tools.

---

## 10. Summary

Split the monorepo so **Deck Core** is the only thing Boxel backports —
serve grammar, store/packs, History/jj, conformance — and **Deck Tools**
holds Hub, CLI, and examples. Same protocol; clearer boundary; ~12k LOC
(or ~8–10k lean) instead of “the whole Deck repo.”
