# deckd

Deck Timeline daemon: **historyd-compatible HTTP** over **jj-lib**, plus a
**watchexec-shaped FS pipeline** (`notify` → filter → per-depot debounce →
jj-lib seal). Design: [`docs/deck-daemon.md`](../../docs/deck-daemon.md).

Lives in the Deck monorepo at `packages/deckd/`. Timeline + watch is the
default binary; optional planes are feature-gated off.

jj-lib path copied closely from boxel-labs
[`jj-historyd`](file:///Users/chris/Projects/boxel-labs/examples/jj-lib-node/rust)
(`HistoryService` + axum + `spawn_blocking`/`pollster`).

Dependency: crates.io `jj-lib = "0.43.0"` (same pin as historyd).

## Features

| Feature | Default | What it enables |
| --- | --- | --- |
| *(none)* | ✓ | jj-lib Timeline + FS watch seals |
| `build` | off | `/ensure-build`, `/artifact-at` (esbuild AMD) |
| `jj-cli` | off | compile unused CLI timeline backend |

```bash
cargo run                         # Timeline + watch
cargo run --features build        # + derived build plane
```

## Source relationship

| Piece | Origin |
| --- | --- |
| Seal / list / file-at / restore-plan | Copied from `jj-historyd` `lib.rs` |
| HTTP + `!Send` isolation | Same pattern as historyd `main.rs` |
| Init | `init_internal_git` (historyd used colocated — Deck forbids depot `.git`) |
| Store layout | `.deck/timeline/repo` + thin `.jj/repo` file pointer |
| `/file-list-at`, seal `actor` | Deck D1 additions historyd lacked |

## Layout after `/ensure`

```text
<depot>/
  …live content…
  .deck/timeline/repo/     # durable jj store
  .jj/
    repo                   # file: "../.deck/timeline/repo"
    working_copy/
```

## Write path (watchexec shape)

1. `POST /ensure { dir }` attaches Timeline **and** registers a recursive FS watch.
2. File changes under `dir` (non-machinery) → in-process note → **one** debounce worker per depot → seal.
3. HTTP `/note` / `/flush` / `/seal` remain as fallbacks.
4. `POST /list` is read-only and uses a **read** lock (does not share the seal write mutex).

When Hub uses `DECKD_URL`, Node watchers publish + HMR only — they do not
`noteMutation`/`flush` (see Deck `watchAndPublish` `sealOnWatch`).

## Concurrency

| Op | Gate |
| --- | --- |
| ensure / seal / restore | per-depot **write** lock |
| list / file-at / file-list-at | per-depot **read** lock (concurrent) |

## Run

```bash
# from packages/deckd
cargo run
./scripts/smoke.sh

# from Deck root — starts deckd + Hub
./scripts/run-hub-with-deckd.sh
```

```bash
export DECKD_URL=http://127.0.0.1:8787
```
