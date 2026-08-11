# The `deck` CLI

Deck has two halves, and the split is not negotiable: **the server is
read-only, and this CLI is the only thing that writes.** The server watches
a directory and distributes what it finds there. Everything that creates,
names, seals, or moves anything happens here — or in your editor, which is
the same thing, because a save IS a write.

Installing: [INSTALL.md](INSTALL.md). Everything below assumes `deck` is on
your PATH; substitute `node packages/cli/bin/deck.js` if it isn't.

## One depot, on your machine

The whole CLI is built around a single topology, and it is the one you
actually work in:

> A **local** Deck server owns your files, watches them, serves your app,
> and seals every save. Third-party libraries come from **npm or unpkg**,
> and they are **vendored in** — pulled down once, rewritten to stay inside
> your own store, and served from your own server from then on.

There is no remote Deck in this picture. Nothing your app loads at runtime
comes from a host you do not control, which is L6 (hermeticity) as a working
arrangement rather than an aspiration. The public registries are something
you *pull from*, deliberately, at a moment you choose — never something your
app depends on being up.

## The shape of it

Eight groups. `deck help` prints this map; `deck help <command>` explains
any one of them in full.

| Group | | Commands |
| --- | --- | --- |
| **start** | stand a depot up and serve it live | `hello` `serve` |
| **seal** | a directory in, a verified pack out | `hash` `pack` `unpack` `list` `verify` |
| **publish** | name sealed states in a depot's store | `publish` `tag` `release` `prune` `store` `derive` `verify-derivation` |
| **depend** | what a deck uses, and which bytes answer to it | `vendor` `vendor-tree` `lock` `verify-links` |
| **propose** | change someone else's deck without a branch | `fork` `offers` `rebase` |
| **endorse** | who stands behind these bytes | `keygen` `sign` `verify-sig` |
| **recall** | every state the depot has been in | `history` `restore` |
| **prove** | the executable contract | `conform` |

The groups are ordered the way the work happens, not alphabetically. Most
days you will use `serve` and nothing else.

## The loop

```bash
deck hello ./work
```

That scaffolds a depot, serves it, and prints a URL. Open it, edit `app.js`,
reload. Then the loop that runs for the rest of the day:

```bash
deck serve --root ./work --history auto
```

`--root` is a directory *of* depots: every child directory becomes one,
named after itself, exactly as it is addressed. What the watcher does on
every save:

1. **Debounce** ~500ms, so a formatter's three writes are one save.
2. **Hash the tree.** Unchanged hash, nothing happens — no version, no
   seal, no noise. Touching a file is not a change.
3. **Auto-publish** `<base>-dev.N`, tagged `dev`. Immutable from that
   instant.
4. **Seal it as a Step** (when `jj`, historyd, or **deckd** is attached) —
   including the saves that did *not* publish, so the states between versions
   exist too. With `DECKD_URL`, deckd’s FS watch owns seals; Hub still
   publishes + HMR.
5. **Announce it** on `/_live/events`, and any page carrying
   `/_live/hmr.js` reloads.

The console says so as it happens:

```
auto-published site/you/app@0.1.0-dev.7 (2f4c8ab19e03) sealed 91c4e0b7aa22
```

Meanwhile the version-less URL — `/site/you/app/app.js` — is your working
directory, served `no-store`, so the browser is physically unable to show
you a stale file. That is the same file `ls` shows. The layout is the
address.

You never named anything to get here, and you cannot lose a save.

## Bringing a library in

Libraries come from npm or a CDN, once:

```bash
deck vendor npm:leaflet@1.9.4 --depot ./work/site --publisher lib --tag latest
```

The module graph is walked, every cross-module reference is rewritten to
stay inside the pack, and it is sealed into your store. From then on your
app imports from your own server. If the graph reaches a host the walker
will not follow, the command **fails** rather than sealing a live external
reference — `--allow-external` and `--allow-host` are the deliberate opt-
outs.

For a package with dependencies of its own, `vendor-tree` does the whole
graph, one deck per package, so a library two of your decks share is stored
and loaded once:

```bash
deck vendor-tree npm:zod@^3.25.0 --depot ./work/site --publisher lib
```

A version published in the last 30 days is refused by default. That is not
caution about bugs; it is the shape most supply-chain attacks arrive in.
`--min-age-days` moves the dial, `--dry-run` shows the plan and writes
nothing.

Then say what your app depends on, as a range, and pin it:

```bash
deck lock --depot ./work/site --publisher you --name app
```

The pins are written **into** the tree, so `cat importmap.json` is the lock
file, the lock travels inside the pack, and moving a dependency forward is
an ordinary save that auto-publishes and seals like any other.

## Shipping

```bash
deck release --depot ./work/site --publisher you --name app \
  --version 1.0.0 --from dev --tag latest
```

The dev line already holds the bytes. `--from` says which of those states
becomes 1.0.0. **Zero bytes are copied** — a version is a pointer (L3), so
shipping is a metadata edit, and it is instant no matter how large the deck.

## Going back

```bash
deck history ./work/site
deck restore ./work/site <changeId>
```

The state you are leaving is sealed first, so a restore is itself undoable,
and the restored state auto-publishes as the next dev version. Nothing is
rewound: a restore replays forward as ordinary writes. History only grows.

## Refusals are the point

Eleven of the twelve laws are things this CLI will stop you doing. When a
claim cannot be verified, the command exits nonzero with a reason — never a
warning a build scrolls past (L11):

- Re-publishing an existing exact version. There is no unpublish and no
  overwrite (L4).
- Sealing a pack whose graph still reaches the live web (L6).
- `deck lock --check` when the lock is stale, or when a pin names a file
  that no longer exists.
- `deck verify` on a pack with one flipped byte.
- `deck release --require-signature` with no valid publish endorsement (L9).
- `deck verify-derivation` when re-running the recorded derivation does not
  reproduce the tree hash. A derivation nobody can reproduce is decoration.
- `deck rebase` on a conflicted proposal: it reports and writes **nothing**,
  not even the part that merged. A machine never damages a contributor's
  work.

`deck verify-links` and `deck lock --check` are deliberately **offline**. A
publish that silently needs a registry to be reachable is a publish that
fails at 3am.

## Prove it

```bash
deck conform
```

Twelve laws, checked. With `--url` it measures any implementation black-box
over HTTP, which is how the Boxel realm server will eventually show that it
implements Deck. The laws themselves are in
[docs/deck-laws.md](docs/deck-laws.md) — but an implementation implements
Deck by passing the suite, not by reading the file.

## Reading the source

```
packages/cli/src/
  main.ts              the front door: legacy flag, lookup, dispatch
  command.ts           what a command IS, and the eight groups
  registry.ts          every command, in one list
  help.ts              help, rendered from the command records
  support.ts           fail(), depotAt(), port walking, cooldown flags
  commands/
    start.ts           hello, serve
    seal.ts            hash, pack, unpack, list, verify
    publish.ts         publish, tag, release, prune, store, derive, verify-derivation
    depend.ts          vendor, vendor-tree, lock, verify-links
    propose.ts         fork, offers, rebase
    endorse.ts         keygen, sign, verify-sig
    recall.ts          history, restore
    prove.ts           conform
```

A command carries its own usage and explanation, and every help screen is
rendered from the same records the dispatcher looks up — so a command cannot
exist without documenting itself, and the docs cannot describe a command
that isn't there. `packages/cli/tests/cli-test.ts` asserts exactly that.

## Where to go next

- **[Deckbook](deckbook.html)** — the teaching tour, including a
  command-by-command walkthrough of four real workloads. Open it from a
  running server at `/deckbook.html`, or straight off disk.
- **[README.md](README.md)** — what Deck is and why.
- **[docs/deck-laws.md](docs/deck-laws.md)** — the contract.
- **`pnpm demo`** — every example running at once, at
  `http://localhost:8789/`.
