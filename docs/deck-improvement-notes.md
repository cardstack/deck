# Deck improvement notes

Captured while putting the reference implementation through a real
vibe-coding session (2026-08-07): run `deck hello`, vendor a CDN
library, then build and serve `examples/neon-drift` — three local
packages + one hermetic vendored dependency, composed in the browser
with an import map and no bundler.

## Friction that showed up immediately

1. **No root-level `deck` convenience script.** Running the CLI today
   is `node packages/cli/bin/deck.js …`. A workspace script
   (`"deck": "node packages/cli/bin/deck.js"`) or a documented
   `pnpm deck …` alias would make the README's `npx deck hello` claim
   true inside the monorepo.
2. **`deck hello` store naming is surprising.** It creates
   `<appDir>-store` as a sibling. Fine for `/tmp/hello-deck`, awkward
   next to a repo (`./app` → `./app-store`). Prefer
   `<appDir>/.deck-store` (gitignored) or an explicit `--store`.
3. **Multi-package serve is verbose.** Neon Drift needs three
   `--watch/--as` pairs. A directory convention
   (`deck serve --store ./store --watch-tree ./packages`) or a tiny
   `deck.json` / workspace file would match how people actually compose
   modules.
4. **Import-map authoring is hand-rolled.** The browser import map in
   `index.html` is a second, parallel declaration next to each
   package's `importmap.json`. A `deck link` / `deck map` that emits
   the page map from live/sealed/tag choices (`ink → live`,
   `simplex-noise → @4.0.1`) would remove the most error-prone step.
5. **No in-page version HUD helper.** The demo hand-builds a meta
   panel. A tiny optional `/live/_deck/status` or injected bookmarklet
   that lists watched names, latest `-dev.N`, and treeHash prefixes
   would sell the "never lose work" promise without custom UI.
6. **Live HTML can't easily import sealed + live together with
   hot-swap.** Switching an app from `/live/ink` to `/@ink@dev` to
   `/@ink@1.0.0` means editing the HTML import map. A query flag
   (`?deck=live|dev|latest`) or generated map variants would make the
   consumption-mode story tangible in one reload.
7. **Vendor output entry path is opaque.** After
   `deck vendor … --store`, you get "import it as `/@name@version/`",
   but the *bare* form redirects to
   `esm.sh/simplex-noise@4.0.1.mjs`. Printing the resolved entry URL
   (and a ready-to-paste import-map snippet) would save a round trip
   through `deck list` / `?meta`.
8. **No `deck status` / `deck versions`.** Inspecting the store means
   reading `meta.json` or curling `/_packages/<name>`. A CLI listing
   (name, tags, newest dev, treeHash short) belongs next to
   `publish`/`tag`/`release`.
9. **Demo apps aren't discoverable from the root README beyond
   vanilla-app.** Neon Drift should be linked once it lands — it's the
   first example that shows *multi-package* composition, which is the
   interesting half of the protocol.
10. **Watcher feedback was stdout-only — now HMR-lite.** Built
    `GET /_live/events` (SSE) + `GET /_live/hmr.js` (drop-in client).
    Still not true ESM HMR (no module-graph surgery); the client
    reloads the page when an import-mapped `/live/<name>` changes.
    Next step: selective re-import with cache-busted bare specifiers
    for packages that export a `dispose`/`accept` hook.
11. **Watcher does not publish on start.** `watchAndPublish` only
    reacts to filesystem events, so a fresh `deck serve --watch`
    leaves `/_packages/<name>` empty and `/@name@dev` 404 until the
    first save. Neon Drift works around this by seeding a publish in
    `demo.mjs`. The watcher (or `deck serve`) should offer
    `--publish-now` / publish-on-start so `@dev` is real immediately.
    (`deck hello` often "gets lucky" because scaffolding writes files
    around the same time the watcher attaches.)
12. **No first-class `deck revert`.** Restore today is
    `deck unpack <store>/…/<treeHash>.pack.zip --into <dir> --force`
    (or `curl …/@name@version?format=pack`). It works — we used it to
    peel fireworks back to drift — but a
    `deck revert --store … --name swarm --to 0.1.0-dev.2 --into …`
    (and listing "what changed since") would make the never-lose-work
    promise the default gesture instead of a power-user recipe.
13. **Deck browser landed (read-only).** `/` and `/_browser` list
    packages, browse sealed or live trees, switch versions, view files.
    It now advertises history capability truth (`jj: false`,
    `historyd: false`, tier-1 packs only) and shows real store paths
    (`meta.json`, `packs/<treeHash>.pack.zip`, `livePath`). Still
    missing: diff two versions, one-click unpack-to-live, and
    browsing the store directory itself as a raw tree.

## Things that already felt great

- Auto-publish debounce + treeHash dedup: edit storms don't spam the
  store; identical saves are silent.
- Hermetic vendor of `simplex-noise@4.0.1` from esm.sh: two modules,
  rewritten, sealed, served — supply chain collapses to one origin.
- Content-addressed store: release-as-pointer is a real workflow, not
  a slogan (`deck release --from dev` copies nothing).
- `/live/<name>` `no-store` + `Content-Digest` + `x-deck-live` headers
  make the vibe surface inspectable with `curl -I`.
- Ranges ignoring prereleases: vibe versions can't leak into `^`
  consumers. That rule does real product work.

## Bigger product gaps (still design-complete, not built)

- Tier 2 history (`/history/<name>/<changeId>/…`, per-save mulligan)
  — the restore story below debounce granularity.
- `vendor`/`unvendor` *map rewrites* on the consuming deck (today you
  vendor into the store, then hand-edit the app's import map).
- A one-command "share this milestone" that packs the app *and* pins
  the exact dependency treeHashes it resolved against.
- Browser-side pack install (`?format=pack` → drag onto a drop zone →
  unpack into a watched dir) for the "no GitHub" collaboration pitch.

## Tiny quality-of-life

- Root `pnpm test` failed under the default sandbox because a tree-hash
  test writes a fixture `.git/config` under `/tmp` (EPERM). Not a Deck
  bug, but CI/agent runners that sandbox `/tmp` `.git` writes will see
  a false failure — consider writing the ignore fixture as
  `.git/HEAD` via a non-config path, or documenting the need for full
  FS permissions.
- `deck hello`'s scaffolded canvas demo is charming; offer a
  `--template neon|blank|three` once more examples exist.
- CORS is wide open (`*`) on purpose for local demos — call that out
  before anyone puts the reference server on a public host.
