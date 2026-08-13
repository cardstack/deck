# The unfrozen mode is per edge

**Status: RULING** (2026-08-12). Companions:
[`deck-package-json-and-depot-lock.md`](deck-package-json-and-depot-lock.md)
(the lock is the freeze; this document is the opt-out),
[`deck-the-range-is-on-disk.md`](deck-the-range-is-on-disk.md)
(an instance may keep naming a range; that is not this mode),
[`deck-live-autopublish.md`](deck-live-autopublish.md)
(the live URL and the auto-publish that `dev` follows),
[`deck-daemon.md`](deck-daemon.md)
(Timeline backend; Steps are served runnable from their own trees).

---

## 0. The ruling

> **There is no semver "always latest." Skip-the-freeze is a mode, and it
> is per dependency edge.**
>
> Two jobs, one spelling each. Same specifier, this depot's working tree:
> `"ui/nav": "workspace:*"`. This specifier, that deck's working tree:
> `"acme/palette": "you/palette@live"`. The lock writes a versionless URL
> and every save is visible.
>
> Dist-tags (`latest`, `dev`) stay tags in the lock — `/…@latest/…` — so
> the browser 302s and a new publish under that tag is visible without
> `--update`. Ranges (`*`, `^1.0.0`) still freeze to an exact Version
> unless `--continuous` chases them. `?with=` is the same substitution for
> one request. `latest` is a dist-tag on a stable Version; it is not live.
>
> Live pages also inject unfrozen edges (`workspace:*` and dist-tags)
> straight from `package.json` when the lock has no pin for them — less
> indirection for try-it-out. Ranges still require the lock. A Timeline
> Step does the same from **that Step's** trees, rewriting live URLs into
> `/_history/<rev>/…` so siblings bind the Step, not today's working tree.
>
> `live` as a URL, a browse kind, and a read synonym of `workspace:*` is
> fine. `@live` as a bare dependency value is not. A bare deck name is
> omitted-spec, not a fourth word for live.

---

## 1. Why "always latest" is not a convention

Semver versions are immutable names. `*`, `^1.0.0`, and `>=1` are *sets* of
versions. They are resolved once (install / lock) and then frozen. They do
not mean "re-pick on every load."

npm's lookalikes are also install-time:

| You write | What it is | What happens |
| --- | --- | --- |
| `"foo": "latest"` | dist-tag (movable alias) | Resolved at install, then locked. Not a runtime pointer. |
| `"foo": "*"` | range: any stable version | Highest non-prerelease, then locked. |
| `"foo": "workspace:*"` | workspace protocol | Local sibling, whatever it is right now. |

npm discourages `"latest"` in `package.json` because without a lockfile two
installs can disagree. There is no npm flag that means "this instance always
tracks HEAD."

Deck already split that into three volatilities, and `latest` is the
*least* live of the moving ones. Overloading `latest` to mean live head is
the mix-up the Hub copy treats as a bug.

---

## 2. Three levels of volatility

| You write | You get |
| --- | --- |
| `"workspace:*"` | Working tree. Bytes on disk. No version segment. |
| `"dev"` | Dist-tag the auto-publish moves. Newest `-dev.N` seal. |
| `"latest"` | Dist-tag on a **stable** Version. **Not live.** Can never point at a prerelease. |
| `"*"` | Highest stable Version (may differ from whatever is tagged `latest`). |
| `"^1.0.0"` | Highest compatible stable. |

`latest` (npm dist-tag) ≠ live head ≠ highest version. `latest` can lag
behind a higher version if the publisher tagged an older one, and it can
never be a prerelease. `*` is "highest stable." `dev` is "newest
auto-publish." The versionless URL is "bytes on disk right now."

The word `live` belongs to that URL and to the browse kind, not to a
second `package.json` spec.

---

## 3. Canonical write in `package.json`

There is no session-wide "vibe mode" switch. The mode is **per edge**.
Four spellings for the same thing is three too many. They were not four
words for one job — they were two jobs plus two leftovers.

| Job | Write this | Why |
| --- | --- | --- |
| Same specifier, this depot's working tree | `"ui/nav": "workspace:*"` | npm's protocol. Hub already writes it. The lock ruling said not to invent a parallel key. |
| This specifier, *that* deck's working tree | `"acme/palette": "you/palette@live"` | Alias. `deck fork --use-in` already writes this. You need a spec token after `@`. |

```json
{
  "dependencies": {
    "ui/nav": "workspace:*",
    "acme/palette": "you/palette@live",
    "acme/confetti": "dev",
    "acme/confetti": "latest",
    "acme/confetti": "*",
    "acme/confetti": "^1.0.0",
    "three": "npm:three@^0.160.0"
  }
}
```

**Read synonyms, not a second write form:**

- `"live"` as a bare value — Deck's short word for `workspace:*`. Teaching
  copy still says it. Accept it; do not document it as canonical write.
- A bare deck name (`"you/palette"`) — omitted spec, defaulting to live.
  Same as `"you/palette@live"`. Document the `@live` form; the parse
  default is convenience, not a live keyword.

**Drop:**

- `"@live"` as a bare value — not a dist-tag (`live` is not a tag; tags
  point at Versions). Looks like a scoped package name. One old example.
- Treating every `workspace:` prefix as live. `workspace:^` in pnpm means
  "workspace package, compatible range," not "working tree." Only
  `workspace:*` is this mode.

### What the lock actually does with those

| You write | Lock writes | Floats? |
| --- | --- | --- |
| `workspace:*` / `you/palette@live` | `/hub/ui/nav/nav.js` (no `@version`) | yes — every save |
| `dev` / `latest` | `/hub/acme/confetti@latest/…` | yes — tag URL; browser 302s |
| `*` / `^1.0.0` | `/hub/acme/confetti@1.2.0/…` | no — exact pin |

The live-head bind skips the freeze. A dist-tag **stays a tag** in the
lock so a new publish under that tag is visible without `deck lock
--update`. Ranges still freeze. Putting `"^1.0.0"` in `package.json` and
hoping the lock floats is not skip-the-freeze. The lock's job is to stop
that.

### To make ranges/tags chase without rewriting `package.json`

```bash
deck lock --depot ./work/site --continuous
```

That sets `"deck": { "continuous": true }` on the depot-root
`importmap.json`. The watcher re-runs `--update` on each auto-publish.
Pins stay exact; they just move. Depot-owner pins that beat the
suggestion:

```json
"deck": { "continuous": true, "overrides": { "confetti": "2.0.0" } }
```

`deck.continuous: true` is opt-in, not default. A new publish does not
change what runs until `deck lock --update`, unless this flag is on.

### One request, no lock edit — `?with=`

```
/site/you/app/index.html?with=acme/palette
/site/you/app/index.html?with=acme/palette@latest
/site/you/app/index.html?with=acme/palette@dev
/site/you/app/index.html?with=acme/palette=you/palette
/site/you/app/index.html?with=acme/palette=you/palette@1.4.0-dev.7
```

No version on the right-hand side means the working tree (omitted spec).
Repeat `with=` to swap several. This is the trial override of the depot
lock; it does not write the lock.

### Addresses (what the browser hits)

```
/<depot>/<pub>/<pkg>/file.js          live tree
/<depot>/<pub>/<pkg>@latest/file.js   302 → current latest
/<depot>/<pub>/<pkg>@dev/file.js      302 → current -dev.N
/<depot>/<pub>/<pkg>@1.2.0/file.js    sealed, immutable
```

A tag or range URL already 302s. The lock currently does not write those
floating URLs; it writes exact pins so the browser caches forever. The
word `live` is this versionless address, not a `package.json` spec.

---

## 4. Two different binds, both already spelled

Vibe coding wants both. They are not the same specifier.

1. **Latest published of a library** — `"latest"` or `"dev"` as a floating
   tag URL in the lock (`/…@latest/…`). The browser 302s. Built. Ranges
   (`*`, `^`) still pin; `--continuous` is the chase for those.
2. **Live head of another project** — `"you/palette@live"` (alias) or
   `"workspace:*"` (sibling). That is the working tree, not a tag. Built:
   the lock writes a versionless URL, and live serve injects it from
   `package.json` even with no lock pin.

---

## 5. What is built

**Canonical write and floating tags:**

- Write `workspace:*` for siblings and `you/pkg@live` for forks; drop bare
  `@live`; only `workspace:*` (not every `workspace:` prefix).
- Dist-tags float in the lock as `@latest` / `@dev` URLs.
- Live HTML injects those unfrozen edges from `package.json` without a
  lock pin. Ranges still need the lock.

**Timeline Step identity:**

- A historical HTML page under `/<depot>/_history/<rev>/…` resolves from
  **that Step's** depot lock (if any) plus **that Step's** `package.json`
  unfrozen edges — not today's working tree.
- Versionless targets are rewritten into `/_history/<rev>/…`, so
  `workspace:*` binds the sibling *at that Step*. Dist-tags and exact
  Versions keep store identity (`@latest`, `@1.2.0`).
- No lock file is required: a Step with only `package.json` unfrozen
  edges is still runnable.

Skip-the-freeze is `workspace:*` on siblings and `you/palette@live` on
forks; chase-a-tag is `"latest"` / `"dev"`; chase-a-range is
`--continuous`; try-without-writing is `?with=`; replay-a-moment is
`/_history/<rev>/`.
