# deckd

Deck History daemon: **historyd-compatible HTTP** over **jj-lib**, plus a
**watchexec-shaped FS pipeline** (`notify` → filter → per-depot debounce →
jj-lib seal). Design: [`docs/deck-daemon.md`](../../docs/deck-daemon.md).

Lives in the Deck monorepo at `packages/deckd/`. History + watch is the
default binary; optional planes are feature-gated off.

jj-lib path copied closely from boxel-labs
[`jj-historyd`](file:///Users/chris/Projects/boxel-labs/examples/jj-lib-node/rust)
(`HistoryService` + axum + `spawn_blocking`/`pollster`).

Dependency: crates.io `jj-lib = "0.46.0"`, which needs rustc 1.97.1;
`rust-toolchain.toml` pins the compiler, so run cargo from this directory.

## Features

| Feature  | Default | What it enables                               |
| -------- | ------- | --------------------------------------------- |
| _(none)_ | ✓       | jj-lib History + FS watch captures            |
| `build`  | off     | `/ensure-build`, `/artifact-at` (esbuild AMD) |

```bash
cargo run                         # History + watch
cargo run --features build        # + derived build plane
```

## Source relationship

| Piece                                | Origin                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Seal / list / file-at / restore-plan | Copied from `jj-historyd` `lib.rs`                                        |
| HTTP + `!Send` isolation             | Same pattern as historyd `main.rs`                                        |
| Init                                 | `init_internal_git` (historyd used colocated — Deck forbids depot `.git`) |
| Store layout                         | `.deck/history/repo` + thin `.jj/repo` file pointer                       |
| `/file-list-at`, seal `actor`        | Deck D1 additions historyd lacked                                         |

## Layout after `/ensure`

```text
<depot>/
  …live content…
  .deck/history/repo/      # durable jj store
  .jj/
    repo                   # file: "../.deck/history/repo"
    working_copy/
```

In standalone Deck, `dir` is a depot. In the Boxel backport, `dir` is the
selected branch workspace projected as a realm root. Its durable History still
appears at `/.deck/history/repo`; the host may physically keep non-default
branches under the owning realm's `.deck/branches/<id>/`. Hosted Boxel places
that realm tree on S3 Files. deckd never writes collaboration refs or
Checkpoints through direct S3; realm-server owns those conditional operations.

## Write path (watchexec shape)

1. `POST /ensure { dir }` attaches History **and** registers a recursive FS watch.

`/ensure` migrates the legacy `.deck/timeline/` directory to
`.deck/history/` when it is the only history store present. It refuses to
choose when both exist. 2. File changes under `dir` (non-machinery) → in-process note → **one** debounce worker per depot/branch workspace → seal. 3. HTTP `/note` / `/flush` / `/seal` remain as fallbacks. 4. `POST /list` is read-only and uses a **read** lock (does not share the seal write mutex).

When Hub uses `DECKD_URL`, Node watchers publish + HMR only — they do not
`noteMutation`/`flush` (see Deck `watchAndPublish` `sealOnWatch`).

## Concurrency

| Op                            | Gate                                     |
| ----------------------------- | ---------------------------------------- |
| ensure / seal / restore       | per-workspace **write** lock             |
| list / file-at / file-list-at | per-workspace **read** lock (concurrent) |
| commit / outcome              | per-repo **file** lock (cross-process)   |

## Explicit commits

`/commit`, `/outcome`, `/head` and `/tree-hash` record a revision from content
the caller staged, never from a working copy. A writer such as realm-server
can then record each write exactly once, even when deckd's response is lost.

Each call names `repo`, the absolute path of one history directory (for
example `<realm>/.history`). The directory's parent must exist; deckd creates
the directory and a bare jj repo inside it on first use. When `DECKD_REPO_ROOT`
is set, `repo` must resolve, symlinks followed, to a directory inside it;
deployments should set it to the realms directory.

```text
<repo>/
  jj/                       # jj repo, internal git backend, no working copy
  deckd/HEAD                # recorded HEAD; locked around every call but /tree-hash
  deckd/operations/<opId>   # pending <digest> | committed <revision> <digest> | fenced
```

A revision is the git commit ID (40 hex). HEAD is the repo's single visible
head; an empty repo's HEAD is the root commit, `0000…0000`.

### Guarantees

- **Exactly the listed paths.** A revision is HEAD's tree plus the request's
  `changes`; nothing on disk is read. A change that would turn a file into a
  directory or back is refused, since it would remove paths it doesn't list.
- **Compare-and-swap on HEAD.** A commit whose `parent` isn't HEAD is refused
  with `parent-mismatch` and the current `head`, never re-parented.
- **Idempotent by operation ID.** Committing an ID that already committed
  returns the original revision with `replayed: true` and writes nothing,
  even when the retry's `parent` is now stale. The retry must ask for the
  same thing: an ID that committed a different author, message, trailers or
  changes is refused with `operation-mismatch`.
- **Fencing outcome query.** `/outcome` reports `committed` or `absent`.
  Reporting `absent` fences the ID: a later commit with it is refused with
  `operation-fenced`.
- **Durable, not in-memory.** Outcomes and fences are files under `<repo>`,
  so they survive a restart and are shared by every deckd on the same
  filesystem. Each record and its directory entry are synced before the call
  returns. Record existence is tested with `O_EXCL` creates, which an NFS
  server answers, so a stale negative lookup can't hide one.
- **No-op writes record nothing.** When the changes leave the tree as it was,
  no revision is created; the response returns HEAD with `created: false`.

Correctness doesn't depend on deckd's in-process state:

- **One lock file, never deleted.** An exclusive lock on `deckd/HEAD`
  serializes deckd processes. Deleting a lock file on release lets two NFS
  clients each hold the lock, one on the unlinked inode and one on its
  replacement, so this file stays. Within a process, calls for one repo also
  share a mutex keyed by the directory's device and inode, so a symlinked
  spelling can't bypass it. Both locks share the 30 s `lock-timeout`.
- **A recorded HEAD.** `deckd/HEAD` holds the revision deckd last recorded,
  written just before jj publishes it. Taking an NFS lock revalidates that
  file's cached data, so it is current even when this host's listing of jj's
  operations is stale. jj's HEAD must match it before anything is written.
  - The file holds two checksummed slots, and each write goes to the slot
    without the latest value, so a write torn by a crash leaves the previous
    revision readable.
  - A revision is recorded only after its git objects are synced, so a power
    loss can't leave `deckd/HEAD` naming a commit the store lost.
  - When jj is one commit behind (a crash between recording and publishing, or
    a stale listing), the recorded commit is published, which is idempotent.
  - Any other mismatch is reloaded for a few seconds, then refused with
    `history-unsettled` and nothing written.
- **Fences hold.** A `fenced` record for an operation found committed means
  the lock failed to exclude a writer. It is reported as an error that needs an
  operator, never overwritten.

A writer running on several hosts should still serialize its own commits
(realm-server uses a Postgres advisory lock).

Each commit's message ends with the caller's trailers, then
`Deckd-Operation-Id: <operationId>`, which callers may not set themselves.

### `POST /commit`

```json
{
  "repo": "/realms/acme/.history",
  "parent": "0000000000000000000000000000000000000000",
  "operationId": "01JB8ZQ4T6W3",
  "author": { "name": "Jane", "email": "jane@example.com" },
  "message": "Update Author/jane.json",
  "trailers": [{ "key": "Boxel-Channel", "value": "host" }],
  "changes": [
    { "path": "Author/jane.json", "contentBase64": "eyJuYW1lIjoiSmFuZSJ9" },
    { "path": "Author/old.json", "delete": true }
  ]
}
```

```json
{
  "revision": "6f1c2d8e0a9b4c3d2e1f0a9b8c7d6e5f4a3b2c1d",
  "tree": "9a3e1b7c5d2f4e6a8b0c1d3e5f7a9b1c3d5e7f9a",
  "created": true,
  "replayed": false
}
```

- `operationId`: 1–128 characters from `[A-Za-z0-9._-]`, not starting with `.`.
- `changes`: each entry has `path` plus exactly one of `contentBase64` or
  `delete: true`. A path appears at most once. Paths are relative and may not
  contain empty, `.`, `..` or `.git` segments. No listed path may be inside
  another listed path, inside a file in HEAD, or name a directory in HEAD.
  Deleting an absent path changes nothing. Writing an existing file keeps its
  executable bit.
- `trailers`: optional. Keys match `[A-Za-z0-9-]+`; values are one line.
- `message` is required. `author.name` and `author.email` are required and may
  not contain newlines, `<` or `>`.

### `POST /outcome`

```json
{ "repo": "/realms/acme/.history", "operationId": "01JB8ZQ4T6W3" }
```

```json
{ "state": "committed", "revision": "6f1c2d8e0a9b4c3d2e1f0a9b8c7d6e5f4a3b2c1d" }
```

or `{ "state": "absent" }`, after which the ID is fenced. It is a POST because
it can change state.

### `POST /head`

```json
{ "repo": "/realms/acme/.history" }
```

```json
{
  "revision": "6f1c2d8e0a9b4c3d2e1f0a9b8c7d6e5f4a3b2c1d",
  "tree": "9a3e1b7c5d2f4e6a8b0c1d3e5f7a9b1c3d5e7f9a"
}
```

### `POST /tree-hash`

```json
{
  "repo": "/realms/acme/.history",
  "revision": "6f1c2d8e0a9b4c3d2e1f0a9b8c7d6e5f4a3b2c1d"
}
```

```json
{ "tree": "9a3e1b7c5d2f4e6a8b0c1d3e5f7a9b1c3d5e7f9a" }
```

The tree hash is the git tree ID, so identical content has the same hash in
any repo, whoever committed it and whatever the message. The revision must be
in the repo's history; a commit object that was written but never published
is `revision-not-found`.

### Errors

Every error body is `{ "code", "error" }`, plus fields named below, on every
route, including a request deckd can't parse.

| Status      | `code`               | When                                                                    |
| ----------- | -------------------- | ----------------------------------------------------------------------- |
| 400/415/422 | `invalid-request`    | Unparseable JSON, a missing field, the wrong content type, or bad input |
| 404         | `revision-not-found` | `/tree-hash` for a revision the repo doesn't have                       |
| 409         | `parent-mismatch`    | `parent` isn't HEAD; body has `head`                                    |
| 409         | `operation-fenced`   | The operation ID was reported `absent` by `/outcome`                    |
| 409         | `operation-mismatch` | The operation ID committed a different request; body has `revision`     |
| 413         | `payload-too-large`  | A `/commit` body over 64 MiB; split the change into several commits     |
| 503         | `history-unsettled`  | jj's HEAD didn't match `deckd/HEAD` within a few seconds; retry         |
| 503         | `lock-timeout`       | Other calls held the repo's locks for 30 s                              |
| 500         | `internal`           | jj or filesystem failure, or a fenced operation found committed         |

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
