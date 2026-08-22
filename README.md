# Deck

**Version management without the commit.<br>
Package management without the install.<br>
Code collaboration without the clone.<br>
Cloud delivery without the deploy.**

Deck gives files, packages, dependencies, runnable applications, and collaborative
work one content-addressed system. The browser can run the same immutable state
that a reviewer inspected, a release named, and another package imported.

Every settled save is safe without asking the author to make a commit. Intentional
collaboration still has the familiar nouns—repository, branch, fork, Review, and
merge—but those nouns coordinate immutable package state instead of copying a
monorepo between machines.

## The model

```text
bytes ──hash──▶ package tree ──name──▶ Version ──URL──▶ browser
                    │
                    └──────────────▶ History Step (every settled save)

exact package Versions + exact RRI lock ──▶ Repository
                                               │
                                          authored as
                                               ▼
                                           Checkpoint
                                               ▲
                                      branch ──┘  mutable ref

source branch ──exact Checkpoint──┐
                                  ├──▶ Review ──preview──▶ Browse + Run
target branch ──exact Checkpoint──┘       │
                                         └──merge──▶ two-parent Checkpoint
                                                          │
                                                          └──CAS──▶ target branch
```

The layers have deliberately different jobs:

| Layer            | Meaning                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Version**      | An immutable name for one package tree. Settled saves can create Versions automatically; releases add durable semver names without copying bytes.                                                              |
| **History Step** | One ordered every-save state from `deckd`. History is daily safety and does not require commit ceremony.                                                                                                       |
| **Repository**   | An immutable set of exact package Versions plus one exact Realm Resource Identifier (RRI) lock. A mutable package is already an implicit one-package Repository; `repo-init` names a multi-package Repository. |
| **Checkpoint**   | An authored collaboration point that binds a Repository, History head, completed index generation, message, and ordered parent Checkpoints.                                                                    |
| **Branch**       | A mutable compare-and-swap ref inside one owner/Repository. Creating one clones the selected Repository state; unchanged content remains shared in CAS.                                                        |
| **Fork**         | The same storage operation across an ownership boundary. It creates a mutable package in another publisher scope and records ancestry.                                                                         |
| **Review**       | Durable source-to-target metadata bound to exact Checkpoints, with an append-only event history and an exact runnable preview.                                                                                 |
| **Merge**        | A three-way reconciliation of base, target, and source Repositories, followed by one target-branch compare-and-swap and a new two-parent Checkpoint.                                                           |

Imported packages are read-only. To change one, create a branch when you control
its Repository, or fork it into your own publisher scope. A fork of Three.js can
therefore become a Repository too; package and Repository are not competing
containers in Deck.

## The layout is the address

A depot is a directory. Live source has the same shape on disk and over HTTP:

```text
<root>/site/acme/palette/index.js       on disk
       /site/acme/palette/index.js      live — every save, no-store
       /site/acme/palette@1.1.0/index.js
                                        exact Version, immutable forever
       /site/_history/<step>/acme/palette/index.js
                                        an earlier every-save state
```

Canonical identities are RRIs such as `@acme/palette/` and
`@acme/palette@1.1.0/`. Realm URLs are transport projections. Authored locks,
Repositories, Checkpoints, and indexes use RRI identity so moving a realm does
not change what its content means.

Each depot carries its own Deck resources:

```text
site/
├── acme/…                         live authored packages
└── .deck/
    ├── store/                     immutable blobs, trees, Versions, locks,
    │                              Repositories, and Checkpoints
    ├── refs/heads/                mutable branch refs (conditional writes)
    ├── reviews/                   Review openings, heads, and event chains
    ├── history/                   deckd/jj every-save History
    └── indexes/                   immutable completed index generations
```

Agents can inspect this state as ordinary files. Mutations go through Deck APIs
and conditional writes so two writers cannot silently replace one another. A
desktop backend uses the same contracts on a regular filesystem; a hosted realm
can place the realm-contained tree on S3 Files and use S3 conditional writes for
durable refs.

## Run it locally

Prerequisites and install options are in [INSTALL.md](./INSTALL.md).

```bash
pnpm install
./scripts/run-hub-with-deckd.sh
```

Open <http://localhost:8788/>. One port serves the Hub chrome, Browse, Run,
Track, Review, and every demo through `*.localhost:8788` virtual hosts.

The Hub has four working views over the same state:

- **Browse** — files, packages, Versions, branches, exact diffs, and the
  Repository underneath.
- **Run** — a page or a generated harness using an exact Repository projection.
- **Track** — automatic Versions and every-save History Steps.
- **Review** — a queue of durable Reviews, exact package diffs, runnable
  previews, activity, Checkpoints, and merge state.

## The daily loop

```bash
deck serve --root ./work --history deckd
# edit normally; every settled save is addressable and kept in History

deck release --depot ./work/site --publisher acme --name palette \
  --version 1.1.0 --from dev --tag latest
# the Version is a pointer to existing sealed state: zero bytes copied

deck history ./work/site
deck restore ./work/site <step>
# restore replays forward, so the state you leave remains recoverable
```

Volatility is explicit:

| Dependency choice      | Result                                    |
| ---------------------- | ----------------------------------------- |
| `workspace:*` / `live` | Current bytes on disk, `no-store`         |
| `dev`                  | Latest automatically published prerelease |
| `^1.0.0`               | A stable Version satisfying the range     |
| `1.1.0`                | One exact immutable Version               |

`latest` is a dist-tag, not the working tree. Ranges never select prereleases.
The conventional `package.json` suggests ranges; the exact import-map lock
decides what executes.

## Branch, Review, and merge

The CLI exposes the same protocol that the Hub and agents use:

```bash
deck repo-init --depot ./work/site --owner acme --name dashboard \
  --root app/dashboard --member app/dashboard --member acme/editor \
  --member acme/theme --history "$HISTORY_HEAD" --index "$INDEX_HASH"

deck branch --depot ./work/site --repo acme/dashboard \
  --name kim/carrier-routing --from main

# edit the branch's packages, then create an intentional collaboration point
deck checkpoint --depot ./work/site --repo acme/dashboard \
  --branch kim/carrier-routing --message "Route recovery work" \
  --history "$HISTORY_HEAD" --index "$INDEX_HASH"

deck review --depot ./work/site --repo acme/dashboard \
  --source kim/carrier-routing --target main \
  --title "Route recovery work to carrier desks"

deck merge --depot ./work/site --repo acme/dashboard --number 2 \
  --history "$HISTORY_HEAD" --index "$INDEX_HASH"
```

`History` and index values come from the realm services in an integrated host;
the explicit CLI flags keep the protocol boundary visible. The executable
[collaboration replay](./scripts/replay-collaboration.mjs) builds a realistic
multi-party Repository from statements, including vendoring, automatic
Versions, branches, Checkpoints, a realistic Review queue, an approved merge,
and a rejected conflict. Run its assertions with:

```bash
pnpm test:collaboration
```

Temporary `?with=` substitutions remain useful for trying alternate package
Versions. They are preview transport, not Review identity. A Review records the
exact Repository and Checkpoints that were examined.

## Bring a library in-house

```bash
deck vendor https://esm.sh/three@0.160.0 --name three --version 0.160.0 \
  --depot ./work/site --publisher acme --tag latest
```

Deck walks the ESM graph once, rewrites internal references to remain inside the
vendored tree, verifies it, and seals it. Applications then import the reviewed
Version from their own Deck server. Vendoring is hermetic by default: an
unresolved external edge fails instead of hiding a runtime dependency on the
public web.

For npm packages with dependencies of their own, `vendor-tree` brings in the
graph as independently addressable packages. Shared content is stored once.

## Packs and delivery

`deck pack` is transport, backup, cache fill, and interop—not a second package
identity. A canonical `.pack.zip` round-trips to the same tree hash and can be
opened by ordinary ZIP tooling.

Exact content URLs are immutable and safe behind a CDN. Public catalog entries
can use ordinary public caching. Private realms can use an authenticating edge
or signed cookies/URLs while retaining immutable cache keys. The origin remains
authoritative for authorization and mutable refs; the CDN delivers content.

## CLI

[CLI.md](./CLI.md) is the command reference. `deck help` prints the live command
map, and `deck help <command>` explains one command from the same records used by
the dispatcher.

The groups are:

```text
start       hello serve
seal        hash pack unpack list verify
publish     publish tag release prune store derive verify-derivation
depend      vendor vendor-tree lock verify-links
repository  repo-init branch checkpoint review merge
propose     fork offers rebase
endorse     keygen sign verify-sig
recall      history restore
prove       conform
say         claim note
```

The older package-level `fork` / `offers` / `rebase` flow remains a useful
single-package proposal surface. Repository Reviews are the durable multi-package
collaboration surface and are the basis of the Boxel backport.

## Protocol documentation

- **[Deck laws](./docs/deck-laws.md)** — the executable protocol contract.
- **[At rest](./docs/deck-at-rest.md)** — depot layout, storage, addresses, and
  History.
- **[Collaboration protocol](./docs/deck-collaboration-protocol.md)** — RRI-native
  Repository, Checkpoint, branch, Review, and merge objects.
- **[Step, Version, and History](./docs/deck-step-version-vocabulary.md)** — the
  every-save and authored-state vocabulary.
- **[Pack equivalence](./docs/deck-pack-equivalence.md)** — canonical pack laws and
  carriage modes.
- **[Storage backends](./docs/deck-storage-backends.md)** — local filesystem and
  realm-contained S3 Files architecture.
- **[Efficient delivery](./docs/deck-efficient-delivery-spec.md)** — derived trees,
  compression, preload closure, and CDN responsibilities.
- **[Hub tour](./docs/deck-hub-tour.md)** and **[UI requirements](./docs/deck-ui-spec.md)**
  — how to inspect the implementation and judge the product surface.

## Implementation

The packages layer so Deck Core can move into Boxel without importing the
standalone server or tools:

```text
core ← server ← tools ← cli
  └── history contract ← deckd (Rust + jj-lib)
  └── conformance laws
```

- `packages/core` owns tree/pack identity, CAS, RRI locks, vendoring primitives,
  Repository and Checkpoint objects, branch refs, Reviews, and three-way merge.
- `packages/history` is the JavaScript client contract for every-save History.
- `packages/deckd` is the Rust History daemon backed by jj-lib.
- `packages/server` serves live and immutable depot state read-only.
- `packages/tools` contains operating tools such as npm carriage, vendoring,
  derivations, and proposal rebasing.
- `packages/cli` is the mutation and inspection command surface.
- `packages/conformance` runs Deck's laws against an implementation over HTTP.

GitHub Actions gates every pull request with lint, all workspace package tests,
a locked Rust `deckd` build, and the collaboration integration replay through
the exact built daemon artifact.

Run the same confidence suite locally:

```bash
pnpm lint
env DECKD_URL=http://127.0.0.1:1 pnpm run --filter './packages/**' --if-present -r test
cargo build --locked --manifest-path packages/deckd/Cargo.toml
pnpm test:collaboration
```

Deck is standalone and framework-independent. Boxel is its first deep consumer:
the realm server provides canonical hosted authority, indexing, permissions,
jobs, and S3-backed durability while Deck supplies portable content identity,
History, Versions, Repository collaboration, and exact browser execution.
