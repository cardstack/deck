# Deck

Deck is a protocol for versioning, publishing, and serving packages
of ES modules and JSON documents from plain state: a file tree, an
import map, seals, and immutable version pointers. A **deck** is a
package — an arrangement declared over a shared tree, not a sealed
box. A **pack** (`<name>.pack.zip`) is the same deck as one portable
artifact. One identity — the canonical treeHash — spans both forms.

Deck is deliberately independent:

- **No framework required.** The protocol serves ANY vanilla JS/HTML
  app. Nothing here depends on `.gts`, card-api, or Boxel — those
  are one consumer.
- **Reference implementation here**: a CLI and a minimal Node
  webserver, developed and tested standalone.
- **The Boxel realm server will IMPLEMENT Deck later**, when this is
  mature. A working at-rest implementation already exists inside the
  realm server (branches `deck/01`–`deck/07` on the
  `jj-history-sidecar` worktree of the boxel monorepo, L1–L7, fully
  tested) — it is prior art and a re-import target, not the home.

## The safe-vendor requirement (noted 2026-08-07)

A Deck server must be able to act as **your own unpkg for a curated
set of third-party packages**: vendor in a specific, reviewed semver
of a library (say, one vetted three.js), seal it, and serve it
immutably by hash. Apps then import ONLY from your Deck server —
never from a public CDN — so the supply chain narrows to versions a
human approved, each verifiable by treeHash/Content-Digest. This
revives the CatalogJS-era idea with modern mechanics: pin + hash +
review, then serve forever. It falls out of the vendoring design
(carriage modes) rather than being a bolt-on.

## Documents

Design set in [docs/](docs/) — start with:

- [deck-at-rest-protocol.md](docs/deck-at-rest-protocol.md) — the
  protocol: state model, endpoints, serving rules, vocabulary.
- [deck-pack-equivalence.md](docs/deck-pack-equivalence.md) — deck ⇄
  pack: four homes, treeHash identity, carriage modes, round-trip
  laws, `!/` mounts, canonical-zip-v1. All opens ruled.
- [deck-cardpack-requirements.md](docs/deck-cardpack-requirements.md)
  — requirements recovered from the cardpack v0.2 implementation
  (preserved verbatim in [reference/cardpack-v0.2](reference/cardpack-v0.2)).
- [deck-unpkg-comparison.md](docs/deck-unpkg-comparison.md) and
  [deck-esmsh-comparison.md](docs/deck-esmsh-comparison.md) —
  production lessons from unpkg and esm.sh, and what was adopted.

The remaining docs cover the semver/migration spec, the publishing
skill, lifecycle, use-case ladder, catalog consumption modes,
multi-package design, and the GitHub mirror analysis.

## Status

Design: ruled and complete for the at-rest half plus pack
equivalence. Code in this repo: none yet — next steps are (1) the
canonical treeHash function with fixture tests, (2) `pack`/`unpack`
in the CLI obeying the round-trip laws, (3) the minimal Node server
(versioned serving, 301/302 rules, `?meta`, `?format=pack`, `!/`
mounts), (4) the safe-vendor flow, proven on a vanilla JS/HTML app
with plain import maps.
