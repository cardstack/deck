# Deck plans

This directory contains execution plans and Boxel backport working documents.
They record sequencing, migration decisions, and implementation checklists; they
are not the Deck protocol contract.

Start an implementation pass with:

- [Backport for the team](./deck-boxel-backport-for-team.md) — the short handoff.
- [Branch and index backport](./deck-boxel-branch-index-backport.md) — the ratified
  execution decisions and B0–B7 slices.
- [Host publishing with tree identity](./deck-boxel-host-publish-treehash.md) —
  incremental/full publish and cache-fill plan.
- [Core backport split](./deck-core-backport-split.md) — the A0–A3 boundary.

The larger plan, change register, work plan, and changelist mockup remain here
as supporting material. Stable protocol and operator documentation stays one
level up in `docs/` and is what the repository README features.
