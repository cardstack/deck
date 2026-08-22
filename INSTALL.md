# Installing the `deck` CLI

## Nothing is published yet

`@cardstack/deck-cli` is not on npm, and there is no plan to put it there until this
has been thoroughly tested.

**Do not run `npx deck`.** There is a package called `deck` on the public
registry, at version 0.0.4, and it is not this one — it belongs to somebody
else. `npx deck hello` would download and run a stranger's code. Install
from this repository instead.

## Prerequisites

| | | |
| --- | --- | --- |
| **Node** | ≥ 22 | required — the CLI is TypeScript with no build step, and relies on Node's native type stripping |
| **pnpm** | 11 | required to install the workspace's dev dependencies (`packageManager` pins the exact version) |
| **jj** | any recent | optional — History via the jj CLI when no daemon is running |
| **Rust / cargo** | stable | optional — only to build `packages/deckd`, the in-tree History daemon |

Verified on Node v24.17.0, pnpm 11.0.9, jj 0.43.0.

Without `jj` or deckd everything still works and nothing is lost: the store
keeps every settled save as an immutable `-dev.N` version. What you give up
is the states *between* publishes. The CLI says which backend it attached,
every time, rather than pretending.

## Get it

```bash
git clone git@github.com:christse/deck.git
```

```bash
cd deck && pnpm install
```

There is no build step. `pnpm install` fetches dev dependencies and links
the five workspace packages together; the CLI runs the `.ts` sources
directly.

## Three ways to run it

**1 — Straight from the repo.** Nothing to install, nothing on your PATH:

```bash
node packages/cli/bin/deck.js hello ./playground
```

**2 — A symlink on your PATH.** `bin/deck.js` carries a shebang and is
executable, and Node resolves a symlink to the real file before it resolves
imports — so the workspace's dependencies still resolve through it:

```bash
ln -s "$PWD/packages/cli/bin/deck.js" ~/.local/bin/deck
```

**3 — pnpm's global link**, if you would rather pnpm own the linkage:

```bash
pnpm --filter @cardstack/deck-cli link --global
```

Undo either with `rm ~/.local/bin/deck` or
`pnpm --filter @cardstack/deck-cli unlink --global`.

Whichever you pick, the rest of the docs write `deck`; substitute
`node packages/cli/bin/deck.js` if you chose the first.

## Verify the install

Three checks, in increasing strength.

**It runs, and knows what it can do:**

```bash
deck help
```

**It obeys its own contract.** This stands the canonical fixture depot up on
the reference server and measures it against all twelve laws:

```bash
deck conform
```

Expect `49 passed, 0 failed, 3 not applicable` — the three are at-rest laws
that the HTTP half does not cover, and they are checked by the other half of
the same run.

**The whole workspace is sound:**

```bash
pnpm test && pnpm lint
```

Expect 189 core, 22 history, 79 server, 4 conformance, 13 CLI — all
passing — and no lint or type errors.

## Check whether every-save History is active

```bash
deck hello ./playground
```

The banner it prints includes a line naming the history backend it attached
to, or the reason it could not. An attached deckd means every-save History and
a Step per save; anything else means Versions only, which still keeps every
settled save as an immutable version.

## Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `DECK_KEYRING` | `~/.deck/keys` | where `deck keygen` writes private keys. They never leave the machine |
| `JJ_BIN` | `jj` | which `jj` binary to seal with when no daemon URL is set |
| `DECKD_URL` | — | point the History at in-tree **deckd** (`packages/deckd`, default listen `http://127.0.0.1:8787`). Preferred over `DECK_HISTORYD_URL` when both are set |
| `DECK_HISTORYD_URL` | — | legacy alias for an external historyd; same HTTP contract as deckd |

To run Hub with deckd from this clone:

```bash
./scripts/run-hub-with-deckd.sh
```

That builds `packages/deckd` if needed, starts it on `:8787`, and starts Hub
on `:8788` with `DECKD_URL` set. See [`packages/deckd/README.md`](packages/deckd/README.md)
and [`docs/deck-daemon.md`](docs/deck-daemon.md).

## When something is wrong

| What you see | What it means |
| --- | --- |
| `Unknown file extension ".ts"` | Node is older than 22 |
| `Cannot find package '@cardstack/deck'` | `pnpm install` has not run, or you are running a copy of `packages/cli` from outside the workspace |
| `EADDRINUSE` from `deck serve` | the port is taken. `deck hello` walks forward up to ten ports on its own; `serve` does not, because a server you asked to be on 8788 should not quietly be somewhere else |
| `deck: --realm is now --depot` | an old flag. It still works and will keep working; the message is a note, not a failure |
| history reports Versions only | deckd is not running (`DECKD_URL` / `DECK_HISTORYD_URL` point at nothing). The live loop is unaffected |

## Uninstall

Remove the symlink or global link, then delete the clone. A depot is
self-contained — its store and its seals live inside the depot directory —
so nothing the CLI made is left behind anywhere else, except any keys under
`~/.deck/keys`.
