# Publishing a realm should be a pointer, not a copy

**Status: ANALYSIS** (2026-08-09). Companions:
[`deck-catalog-cdn-delivery.md`](deck-catalog-cdn-delivery.md) (remix as a
map, copy-on-write), [`deck-realm-download-as-pack.md`](deck-realm-download-as-pack.md)
(re-homing and the absolute-reference classification),
[`deck-boxel-backport-plan.md`](./plans/deck-boxel-backport-plan.md) (K1, K2, K8).

---

## 0. What publishing costs today

From `packages/realm-server/handlers/handle-publish-realm.ts`, in order:

```js
await sourceRealm.indexing();            // wait for in-flight indexing to settle
await sourceRealm.flushUpdateEvents();
…
await copy(sourceRealmPath, tempCopyPath);   // every byte
await move(publishedRealmPath, backupPath);  // swap dance
await move(tempCopyPath, publishedRealmPath);
await remove(backupPath);
…
await ensureRealmIndexBoilerplateOptIn(publishedRealmPath);
await clearRealmDefinitions(…);          // DB delete + prerender drop + NOTIFY
clearLocalSourceCachesAndBroadcast();
await enqueueReindexRealmJob(…);         // full reindex → prerender fan-out
```

Three full copies of the same information:

| | Cost | Of content that is… |
| --- | --- | --- |
| **Bytes** | 2× disk per published realm, plus the copy itself | byte-identical to the source |
| **Index** | a full reindex of the copy | identical rows, different `realm_url` |
| **Prerender** | a headless render of every card | identical HTML, different `realm_url` |

Plus a floor on latency: publishing blocks on `sourceRealm.indexing()`, so a
publish can never be faster than the indexing it waits for.

---

## 1. Why it is a copy — identity is positional

None of this is careless. It follows from one thing: **a realm is identified
by its URL, so a second URL requires a second everything.**

The schema says so plainly. `prerendered_html` is keyed:

```
primaryKey: ['url', 'realm_url', 'type']
```

Same bytes at a different `realm_url` are, as far as the database is
concerned, a different row that has never been computed. So it gets computed
again — in a browser, per card.

The filesystem dance says the same thing. Lines 507–528 build a temp copy, a
backup, a swap and a restore-on-failure path, because **directory swaps are
not atomic** and a half-copied realm would be worse than no realm.

Content addressing removes the premise. Bytes named by their own hash can sit
at two URLs without being two things.

---

## 2. The one file that actually differs

Worth noticing, because it changes what kind of operation this is:

```js
await ensureRealmIndexBoilerplateOptIn(publishedRealmPath);
```

The published realm's `/realm.json` gets a flag the source realm does not
have — the opt-in that keeps full prerendered isolated HTML on the index card
for anonymous visitors.

So the published tree is **not** a copy of the source tree. It is the source
tree with **one file overridden.**

Which is exactly the remix shape from `deck-catalog-cdn-delivery.md` §6: a
parent Version plus a small overlay. Publishing already *is* copy-on-write
with a single override — implemented as a full directory copy because there
was no way to express "the same tree, but this one file differs".

**Publishing needs no new mechanism. It needs the mechanism remix needs.**

---

## 3. What it becomes

```
publish   → move the tag `published` to Version 3.2.0, with a one-entry overlay
unpublish → drop the tag
rollback  → move the tag back
```

| | Today | As a pointer |
| --- | --- | --- |
| Bytes written | the whole realm | one tag, one overlay file |
| Atomicity | temp + backup + move + restore-on-failure | a single pointer write — atomic by construction |
| Rollback | re-copy a state you no longer have | move the tag |
| Disk | 2× per published realm | ~0 |
| Latency floor | waits for indexing to settle | publishes a Version already indexed |
| Lineage | none — a fresh directory with no history | "published is 3.2.0, source is 3.4.0, here is the diff" |

That last row is the one that is currently unanswerable and becomes free.
"What is live right now, and how far has the source moved since?" is a
question about two pointers.

The error-handling branch at lines 512–528 disappears with the problem it
solves.

---

## 4. The hard part, staged honestly

Deck does not magic away the index and the prerender. They are keyed by realm
URL, and that is real work to change. Three stages, in increasing order of
both cost and payoff — and the first one needs no Deck at all.

### Stage 1 — copy the derived state instead of recomputing it

Available today, and probably the largest single win in this thread.

The published bytes are identical to the source bytes. Therefore the index
rows and the prerendered HTML are identical too, modulo `realm_url`. Today
they are thrown away (`clearRealmDefinitions`) and recomputed by a prerender
fan-out that launches a browser per card. They could instead be an
`INSERT … SELECT` with a URL rewrite.

That replaces the most expensive step in publishing with a SQL statement.

**The catch, and it is the same catch as pack intake:** rendered HTML
contains absolute URLs, and they are not all the same kind. Re-homing them
needs the classification from `deck-realm-download-as-pack.md` §5.1 —
source-realm absolutes get re-pointed, dependency absolutes rebind, and
genuine external data (`boxel-images.boxel.ai/...`) must be left alone. A
blind string replace over rendered HTML would corrupt content. The
classification is the work; the copy is trivial.

### Stage 2 — publish is a tag

Deck's contribution proper. No byte copy, no swap dance, one-file overlay,
lineage for free (§3). Depends on K1 (Versions behind the realm write path).

### Stage 3 — key derived state by content

Re-key `prerendered_html` from `(url, realm_url, type)` to something rooted in
`(treeHash, path, format)`, so two URLs over one tree share rows outright and
publishing costs nothing — not even a SQL copy.

This is the big one, and its payoff is not limited to publishing. It makes
**remix cheap to render**: a remix that overrides 1 of 200 modules re-renders
only what depends on that module, reusing the parent's HTML for the rest. The
machinery to decide "what depends on that module" already exists — the
`deps` column on `prerendered_html` carries a GIN index for exactly this
containment query.

That is the server-side twin of the browser-cache compounding in
`deck-catalog-cdn-delivery.md` §2: unchanged content is not re-fetched by the
client and not re-rendered by the server, for the same reason in both cases.

---

## 5. Sequencing

Stage 1 is independent and can ship first — it is a publish-path optimisation
that stands on its own merits and does not wait for the backport. It also
forces the absolute-reference classifier into existence early, which pack
intake (K14) then reuses rather than reinventing.

Stage 2 lands with K1, because a tag needs a Version to point at.

Stage 3 is the largest and should follow remix landing, because remix is what
makes the content-keyed cache pay for itself — publishing alone might not
justify the schema change; publishing *plus* every remix in the catalog
does.

---

## 6. What this rules

1. **Publishing is copy-on-write with a single override**, and should use the
   same mechanism as remix rather than a bespoke directory copy.
2. **The copy exists because identity is positional.** Fixing that is a
   schema question (`prerendered_html` keyed by `realm_url`), not a
   publishing question.
3. **Recomputing derived state for byte-identical content is the expensive
   mistake**, and it can be fixed before any of Deck lands.
4. **Atomicity comes free with pointers.** The temp/backup/swap/restore path
   is solving a problem that a tag move does not have.
5. **A published realm should have a lineage.** Publishing is currently
   amnesiac; as a tag it is the most useful pointer in the system.

---

## 7. Open

1. **Where does the overlay live?** The published realm's `/realm.json`
   differs from the source's. As a decklist override, an intake transform, or
   a published-realm-specific config the tree does not carry at all?
2. **Does the published realm get its own History**, or does it borrow the
   source's and mark which Versions were published? The second is smaller and
   probably truer — publishing is an event on the source's history.
3. **Index rows: rewrite or share?** Stage 1 rewrites, Stage 3 shares.
   Whether Stage 1's rewritten rows can later be collapsed into shared ones
   without a migration is worth checking before committing to the rewrite
   shape.
4. **Anonymous-visitor SSR** (the boilerplate opt-in) assumes the published
   realm's index card carries full isolated HTML. Under content-keyed
   prerender, does that opt-in become a render-time decision rather than a
   flag written into the tree?
