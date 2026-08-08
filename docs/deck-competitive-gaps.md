# What is missing to replace git + GitHub + npm + unpkg

A gap ledger, reconciled against what the Boxel realm server and CLI have
already built, and classified by who supplies each answer.

---

## 0. The headline, and the correction to it

**Deck is a single-machine system. All four incumbents are multi-machine,
multi-party systems.** The local half is complete — content identity,
versions, seals, forks, three-way merge, offers, live serving. The
distributed half is nearly absent.

That was the first answer, and it is half wrong. The correction, found by
reading the monorepo rather than the docs:

| Assumed missing | Actually already built, in Boxel |
| --- | --- |
| authentication | `MatrixBackendAuthentication` — OpenID token verified through the Matrix **federation** endpoint, then a realm-minted JWT |
| authorization | `RealmPermissionChecker` — `read \| write \| realm-owner \| assume-user`, per-user, per-`users`, per-`*` |
| the write path | `boxel realm push \| pull \| sync \| watch`, `boxel file read/write/delete/list` |
| publish and lifecycle | `boxel realm create \| publish \| unpublish \| archive \| remove \| milestone \| history \| restore` |
| cross-realm discovery | `/_federated-search` |
| a real-time event bus | `app.boxel.realm-event` over Matrix, already emitted by `node-realm` |
| multi-server awareness | `app.boxel.realm-servers` in user account data |

So the honest framing is not "Deck lacks the distributed half." It is:

> **Boxel has the distributed half and no immutability. Deck has
> immutability and no distribution. The merge is the product.**

And the exchange runs both ways. One measurement makes this concrete: the
realm server serves content with `cache-control: public, max-age=0` — it
tells every cache to keep nothing, because nothing it serves is
addressable as unchanging. Deck's `@version` addresses are the thing that
makes a CDN possible at all.

---

## Part 1 — The ledger

### 1.1 Deliberate omissions — do not build these

Half a flat gap list is the design working. Kept separate so it is never
mistaken for a backlog.

| Not built | Traded for |
| --- | --- |
| a staging area / partial commits | auto-publish; every save is already kept |
| branches | the publisher segment as the fork boundary |
| commit messages | seals need no ceremony; milestones name the ones that matter |
| bundling and minification | the whole web platform, no build step |
| `node_modules` as the runtime | late binding over URLs |
| unpublish / delete | content addressing; you deprecate, you do not erase |

The cost of each is real and should be stated when someone asks: no
staging means you cannot say "this half is ready"; no bundling means the
module-graph waterfall is yours to answer (G20).

### 1.2 Unbuilt necessities

Numbered for the classification in Part 3.

**Distribution**

- **G1 — No second machine.** No push, pull, clone, or remote resolution
  between deck servers. `vendor` imports from the web one way. Everything
  below about catalogs, cross-realm dependencies and contribution across
  a trust boundary is downstream of this.
- **G10 — No transitive resolution.** `lock` resolves one deck's own
  ranges. No graph walk, and no rule for two dependents wanting different
  majors of a third. Import maps can legitimately carry both — which
  beats npm — but the rules are unwritten.
- **G11 — No offline story.** Late binding puts the network on the
  critical path of *running*, not just installing. npm leaves bytes on
  disk; Deck leaves a URL.

**Identity and trust**

- **G2/G3 — Authn and authz.** Solved in Boxel, absent in Deck.
- **G4 — No authorship.** A seal does not record who caused it. jj has an
  author field; the historyd backend declares no actor. Blame is
  therefore impossible.
- **G5 — No signature over content.** `treeHash` proves the bytes did not
  change. It does not prove **acme** made them. A JWT authorizes a
  *request*; it does not attest *bytes*, so a pack that travels — a zip, a
  mirror, a cache — carries no proof of origin.
- **G6 — No name ownership.** Publisher = whoever holds the directory.
  No claim, no transfer, no squat protection.
- **G26 — No credential strength policy.** Nothing distinguishes an
  agent's ambient token from a human's deliberate act.

**Registry duties**

- **G8 — Nothing runs tests.** The largest correctness gap. Auto-publish
  makes unverified bytes the live thing instantly, and eight agents at
  310 saves an hour is precisely where that hurts. A version needs an
  attached **verification status** so `^1.0.0` can mean *passing* rather
  than merely *existing*.
- **G9 — No deprecate or advisory.** No way to say "this version is bad."
  Must be non-destructive: bytes are permanent.
- **G14 — No reject or close** for an offer.
- **G15 — No discovery or ranking.**
- **G17 — No release notes.** A ribbon of seals is not a changelog.

**Collaboration**

- **G12 — No conversation.** Proposals with nowhere to say why.
- **G13 — No content-anchored annotation.** Review-by-running is a strong
  claim, but sometimes you must point at a line.
- **G27 — No attestation, rating, or adoption signal.**

**Delivery**

- **G18 — No cacheability, no edge.** One origin, `max-age=0`.
- **G19 — No bandwidth accounting, abuse control, or availability
  commitment.**
- **G20 — No answer to the module-graph waterfall.** Refusing to bundle
  is defensible; having no answer is not.

**Git duties genuinely missing**

- **G21 — No bisect, no blame, no diff between two seals.** Bisecting an
  auto-published dev line would be *better* than git's — a hundred sealed
  states an hour beats a handful of commits — and it does not exist.
- **G22 — No large-file policy.**

**Adoption**

- **G23 — No import from git or npm, no export to either.**
- **G24 — No Node or bundler consumption.** Runtime is browser ESM only.
- **G25 — CJS and non-ESM languages** get the distribution half only.

---

## Part 2 — Reconciliation

### 2.0 Five collisions the merge must resolve

Before the ten items, the places where Boxel and Deck each already have an
answer and the answers differ. These are the actual work of the backport.

| | Boxel has | Deck has | Ruling I would take |
| --- | --- | --- | --- |
| **T1 publish** | realm-granular: source realm → published realm URL, behind a publishability gate | package-granular semver release, zero bytes copied | Package is the primitive. Realm-publish becomes a bulk release over every deck in the realm, and the publishability gate becomes the **verification status** of G8 |
| **T2 history** | `.boxel-history` checkpoint log + milestones; jj sidecar prior art | seal per settled save, restore replays forward | Deck's seals are the history. `boxel realm milestone` becomes "name this seal" — the same operation, better storage |
| **T3 sync conflicts** | `--prefer-local / --prefer-remote / --prefer-newest` | `mergeTrees` over a recorded base, key-level for JSON | Three-way merge makes the choice unnecessary in the common case. `--prefer-*` survives only as the tiebreak for a genuine same-key disagreement |
| **T4 identity** | JWT authorizes a request | treeHash identifies bytes | Both, and a third: a **signature over the treeHash** so authority travels with the bytes rather than with the connection |
| **T5 caching** | `public, max-age=0` | exact versions are immutable forever | Split the address space by mutability and let the header say the truth (see 2.9) |

---

### 2.1 What the realm-server backport gains us

**Gains, immediately:** Matrix authentication; a four-action permission
model with per-realm ACLs; the entire write path including bidirectional
sync and watch; realm lifecycle; the Postgres index; per-realm and
federated search; prerendering; the card runtime and host app; the
`.boxel-history` checkpoint log; the publishability gate; profiles and
non-interactive CI auth via `--realm-secret-seed`.

That closes **G2, G3, G7, G12** (substrate), **G15** (substrate), **G16**.

**Does not gain:** content-addressed identity, semver, immutable
versions, the live/dev/pinned three-address model, fork-as-proposal,
three-way merge, offers, continuous rebase, packs. Those are exactly what
Deck brings, and none of them exists in the realm server today.

**What Boxel gains in return, and it is not small:** an address space that
is cacheable (T5 → G18), a merge that does not need a conflict policy
(T3), a per-package release granularity finer than a whole realm (T1), and
a history whose restore is provably undoable.

---

### 2.2 What Matrix federation across realm servers gains us

This is **G1** — the second machine — and it is the single highest-value
item on the ledger.

**Gains:** cross-server reachability with identity already verifiable.
Federation is how `MatrixBackendAuthentication` verifies an OpenID token
*today*, so a stranger on another homeserver is checkable with no central
registry and no new trust root. `app.boxel.realm-servers` already models a
set of servers per user. On top of that: cross-realm dependencies, remote
forks, offers across a trust boundary, and adoption counts that mean
something because they span servers.

**Does not gain:** naming, durability, or resolution. Federation gives
**reachability and identity**; it gives no answer to who owns the name
`slack`, whether the remote is up, or how to resolve a graph.

**The ruling I would take on G6, and it falls out of federation:**

> **Names are origin-scoped, not global.** `https://hub.example/site/acme/palette`
> — the origin *is* the namespace.

That kills squatting without inventing a central registry, and it is
precisely what npm and unpkg cannot do. A "catalog" then becomes a curated
list of origins someone vouches for — data, not authority — which is the
same shape as the BXL-bot policy-data idea.

---

### 2.3 Vendoring npm packages and making them editable — three.js

Already built and verified end to end against the real esm.sh: hermetic
graph walk, cross-module rewrite so nothing phones a CDN at runtime,
`vendoredFrom` provenance, sealed as a pack.

**What it becomes when composed with fork:** every npm package turns into
a forkable deck. Vendor three.js, `deck fork` it into your scope, patch
it, and your app picks the patch up on the next save — no build, no
`patch-package`, no publishing to npm, no waiting for a maintainer.

This is the most concrete "git + npm killer" demo available and it needs
almost nothing new: `vendor` ✅ + `fork` ✅ + `lock` ✅.

**The one missing piece is worth building on its own:** `vendoredFrom`
should make a vendored deck **upgradeable**. Re-vendor 0.161.0, and the
rebase daemon carries your patch forward by three-way merge — the exact
machinery that already keeps offers merged. That is `patch-package`, made
permanent and automatic, and nothing in the npm world has it.

**Honest limits.** esm.sh serves built output, so "editable three.js" is
editable *built* three.js. A source-level fork wants the upstream repo,
which points straight at G23 (`deck import <git repo>`). And vendoring
directly from an npm tarball — no esm.sh in the path — is unbuilt.

---

### 2.4 The write path: boxel CLI sync and push

Built, and better than expected: bidirectional `sync` with dry-run,
deletion propagation, conflict policy, skills mirroring, Matrix profile
auth, and an administrative seed path for CI.

**What Deck adds is the merge.** Today `sync` reconciles files and picks a
winner. With a recorded base and content-addressed trees, it should
**merge** instead — key-level for JSON, line-level for text — and surface
only the genuine same-key disagreements. `--prefer-*` stops being the
mechanism and becomes the tiebreak.

So the reconciliation is exactly: **Boxel's transport, Deck's merge.**
That is a strict improvement to Boxel independent of anything else here.

Second thing Deck adds: sync should be **seal-grained**, not
snapshot-grained. A push carries the seals, so history survives the wire
and the remote can restore to any of them.

---

### 2.5 Matrix identity for authorship and publisher

Authentication and authorization exist. The missing half is **attribution
and attestation**, in three parts.

**Authorship (G4) — cheap, high payoff.** Every seal records the Matrix ID
that caused it. jj already has an author field; the historyd backend
declares no actor and should. Blame becomes real, and in a swarm it
answers "which agent did this" without a convention.

**Publisher ownership (G6) — reuse what exists.**

> **A publisher scope is owned by a Matrix room.** Its members holding
> `write` may publish under it.

Orgs, co-maintainership, transfer, and revocation all come from machinery
that is already running and already federated. No new ACL system, no new
account model.

**Attestation over bytes (G5) — the highest-leverage single move.** A JWT
authorizes a connection; it says nothing about a pack sitting in a cache.
Matrix already has device keys and **cross-signing**, so do not invent a
keypair:

```
signature = sign(treeHash, cross-signed Matrix device key)
```

Verifiable by anyone federated, travels with the bytes, survives mirrors
and caches, and turns a mirror into a *verifiable* cache rather than a
trusted one. This is the precondition for 2.8 and 2.9 both.

---

### 2.6 Real-time Matrix rooms for collaboration

The substrate is running: `node-realm` already emits
`app.boxel.realm-event`.

**The design ruling: one room per deck, not per realm.** The room is the
deck's discussion, and because a fork records its base, a fork's room can
point at its origin's.

What that gives, mostly for free:

- **A live changelog (G17).** Every auto-published dev version arrives as
  a timeline event carrying its treeHash. The changelog gap is solved by
  something already emitting.
- **Conversation (G12).** Comments, proposals and reviews are ordinary
  messages; threads give per-topic review.
- **Presence.** Which humans and agents are inside a deck right now —
  exactly what the swarm workload wants and cannot get from git.
- **Storage for attestations (2.8).** Room **state events** are
  replicated, federated, ACL'd and ordered. That is the right home for a
  signed claim, and it costs no new infrastructure.

**What must be designed: the anchor (G13).** A comment on a line needs
`{treeHash, path, range}` rather than a line number. Because the hash is
content-addressed, the anchor stays valid across rebases, forks and
mirrors — an annotation model git cannot offer stably.

---

### 2.7 What 2FA is actually needed to replace GitHub

The instinct is TOTP. That is the wrong requirement, and npm learned it
publicly: mandatory human 2FA does not protect a CI token, which is why
they moved to **trusted publishing with OIDC provenance**.

The real requirement:

> The publish action must be attributable to a strong credential, and
> that credential must not be a long-lived bearer token sitting in an
> agent's environment.

In priority order:

1. **Matrix cross-signed device keys as the publish credential.** Cutting
   a stable release requires a device the user cross-signed. Already
   federated, already recoverable, no new IdP.
2. **Passkeys, not TOTP, at homeserver login.** TOTP is phishable;
   WebAuthn is not. A passkey IdP in front of Synapse is the pragmatic
   path.
3. **Scoped, short-lived, purpose-bound agent tokens.** An agent gets
   `write` to one publisher scope for an hour, may auto-publish `dev`, and
   **may not cut a stable release**. That split — dev is cheap and
   automated, stable is a human-gated act — is the security boundary the
   whole design already implies; it just has to be enforced.
4. **Provenance on release:** who, which device, which seal, which
   verification status. npm's trusted publishing, strengthened by the fact
   that Deck's subject is a treeHash rather than a tarball name.
5. **Recovery is Matrix's** — key backup and cross-signing reset. Do not
   invent an account-recovery flow; it is where credential systems die.

Two things are needed regardless of credential strength, and neither is
2FA: **rate limits and abuse controls (G19)**, and **the ability to say
"this version is bad" (G9)** — because you can never delete.

---

### 2.8 Attestation, comment, rating, "I use this" / "don't use this"

The design principle:

> **The strongest signals are facts the system already holds, not
> opinions people volunteer.**

Three tiers, weakest last.

**Tier 1 — Observed. Free, and expensive to fake.**
Derivable from every decklist the server can see, with no user action:

- **Adoption** — who pins me.
- **Persistence** — how long they have kept the pin.
- **Depth** — pinned by something that is itself widely pinned.

That is PageRank over lockfiles. It is the true "I use this," and unlike a
star it costs something to manufacture. Federation makes it span servers.

**Tier 2 — Attested. Signed, structured, about a `treeHash`.**
Stored as Matrix room state events (2.6), signed with a cross-signed
device key (2.5):

| Claim | Means |
| --- | --- |
| `verified` | "I ran the harness at this treeHash and it passed" — names the harness deck and version |
| `reviewed` | "I read this and it does what it says" |
| `deployed` | "this ran in my production realm for 30 days" |
| `advisory` | "this version has a problem" — the G9 channel: non-destructive, signed, revocable by its issuer |

The critical property: **attestations attach to a treeHash, not to a
name.** So they survive forks, mirrors and renames, and **a fork inherits
every attestation about the bytes it did not change.** Nothing in the
git/npm world can do that, and it is the strongest single argument for
content addressing that this system has.

`verified` is also the answer to G8: the verification status is an
attestation, so "only pins that resolve to a verified version" becomes a
policy anyone can enforce locally.

**Tier 3 — Stated. Comments and ratings as ordinary room messages.**
Cheap, human, and explicitly the weakest. Show it last.

**The ranking rule:** *Tier 1 orders, Tier 2 gates, Tier 3 explains.*

**The anti-pattern to refuse:** a five-star average — noise at low N,
unfalsifiable at high N, and gameable at every N.

**"Don't use this" must propagate.** An advisory against a version should
reach every decklist that pins the affected range, and the server can
compute exactly who is affected **because it holds the locks**. npm cannot
do this; it does not have your lockfile.

---

### 2.9 Putting a CDN in front of the realm server

The finding reframes the task. The realm server sends `public, max-age=0`
today — it instructs every cache to keep nothing, because nothing it
serves is addressable as unchanging. So this is not "bolt on a CDN." It is
**Deck giving the realm server an address space worth caching.**

The rules, which are unpkg's, with a signature added:

| Address | Header | Cached |
| --- | --- | --- |
| `…/<pkg>@<exact>/<path>` | `immutable, max-age=31536000` + `Content-Digest` | forever, at every edge |
| range or dist-tag | short-TTL `302` to the exact address | seconds for the hop, forever for the target |
| version-less **live** | `no-store` | never |
| `?with=` trial | `no-store`, rate-limited | never — it is compute wearing a URL |

Four consequences worth planning for:

- **Put live and trial traffic on a distinct hostname or path prefix**, so
  the CDN config can refuse to cache them wholesale instead of trusting a
  header to be right every time.
- **There is nothing to purge** for exact versions — that is the point.
  Only tags need purging, and a tag is one tiny object.
- **With the signature from 2.5, a cache cannot lie**, so you can serve
  from *any* cache, including a peer realm server. Federation plus
  immutability means **a mirror is just a cache that proves itself** — and
  that is how you get availability without owning the edge.
- **G20, the waterfall**, is the remaining delivery problem. The natural
  answer is `modulepreload` injection, and the server already injects
  import maps into HTML, so the mechanism is in place.

What stays unsolved by any of this: bandwidth accounting, abuse controls,
and an availability commitment. Those are money and policy.

---

### 2.10 Getting Node and bundlers onto Deck

Three consumers, three answers, in descending order of purity and
ascending order of adoption.

**Node runtime.** A loader hook via `module.register` that resolves realm
URLs, fetches, verifies the treeHash, and caches into a local
content-addressed store. Node does not honour import maps, so the loader
reads the lock directly. Straightforward on Node ≥ 20.6.

**Bundlers.** One resolver plugin per bundler, sharing the resolution
rules. Vite first — its dev server is already a late binder, so `live`
maps onto it naturally and HMR keeps working. esbuild and Rollup follow.

**The `node_modules` bridge, for the unconvinced.** `deck install`
materializes a pinned dependency set into `node_modules` straight from
packs. Zero runtime buy-in, and it is how a team tries this without
believing in it first. It costs little, because a pack is already a zip
with a manifest.

**The hard boundary is CJS.** A CJS-only package cannot be late-bound.
Vendoring converts some; the rest are out of scope, and saying so plainly
is better than a partial answer.

---

## Part 3 — Classification

Your list was cut off after **A**, so this is the taxonomy I inferred —
say the word if you meant different buckets and I will re-cut it.

- **A — Backport.** The realm server or boxel CLI already built it; Deck
  gains it by merging in.
- **B — Federation.** Arrives with Matrix federation across multiple realm
  servers.
- **C — Protocol.** Must be designed and built in Deck. Nobody else
  supplies it.
- **D — Operations and ecosystem.** Not a protocol question: money,
  policy, infrastructure, and consumer adapters.

| # | Gap | Class | Note |
| --- | --- | --- | --- |
| G1 | no second machine | **B** + C | federation gives reach; C supplies the resolution rules |
| G2 | authentication | **A** | Matrix OpenID → realm JWT, built |
| G3 | authorization / ACL | **A** | four actions, per-realm, built |
| G4 | authorship on a seal | **C** | jj has the field; surface it |
| G5 | signature over treeHash | **B** + C | Matrix cross-signing is the key material; C defines the claim |
| G6 | name ownership | **C** | ruling: origin-scoped names; publisher = a Matrix room |
| G7 | write path | **A** | push / pull / sync / watch, built |
| G8 | verification status on a version | **C** | expressed as a Tier-2 attestation |
| G9 | deprecate / advisory | **C** design, **B** storage | non-destructive, signed, propagates via held locks |
| G10 | transitive resolution | **C** | multi-major coexistence is an advantage to specify |
| G11 | offline / pinned cache | **C** | needed the moment anyone ships |
| G12 | conversation | **A** + **B** | rooms exist; one room per deck |
| G13 | content-anchored comments | **C** | `{treeHash, path, range}` |
| G14 | reject / close an offer | **C** | small |
| G15 | discovery and ranking | **A** + C | `/_federated-search` exists; adoption ranking does not |
| G16 | access control / private | **A** | realm is the boundary, enforced |
| G17 | changelog | **B** | the room timeline already carries it |
| G18 | cacheability and edge | **C** unlocks, **D** operates | immutable addresses first, then a CDN |
| G19 | bandwidth, abuse, availability | **D** | money and policy |
| G20 | module-graph waterfall | **C** | `modulepreload` injection, mechanism already present |
| G21 | bisect / blame / seal diff | **C** | cheap; better than git's because seals are denser |
| G22 | large files | **C** + D | policy plus a carriage mode |
| G23 | import/export git and npm | **C** | the adoption ramp |
| G24 | Node loader, bundler plugins | **C** | plus the `node_modules` bridge |
| G25 | CJS and non-ESM | **D** | out of scope; say so |
| G26 | credential strength | **A** + C + D | Matrix devices; C gates release; D sets policy |
| G27 | attestation and adoption | **C** design on **A**+**B** | Tier 1 observed, Tier 2 signed, Tier 3 stated |

### 3.1 Reading of the ledger

**A is larger than expected.** Six gaps are already solved in Boxel, which
means the backport is the cheapest large win available and should come
before anything in C that depends on identity.

**B is small in count and enormous in consequence.** Federation supplies
one thing — the second machine — and it unblocks G1, G5, G12, G15 and G17
at once.

**C is where the work is,** and it divides into three clusters worth
sequencing separately: *trust* (G4, G5, G6, G8, G9, G27), *resolution*
(G10, G11, G20), and *adoption* (G23, G24).

**D should be named and set down.** Availability, bandwidth and abuse are
what actually make unpkg valuable, and they are not solvable by design.

### 3.2 Build order

1. **Backport A.** Identity, ACLs, and the write path, with Deck's merge
   replacing the conflict policy (T3).
2. **Authorship and signatures (G4, G5).** Everything about trust,
   attestation, and caching depends on being able to sign a treeHash.
3. **Federation (G1).** The second machine, with origin-scoped names.
4. **Verification and advisories (G8, G9).** Auto-publish becomes a
   guarantee rather than a liability, and there is finally a way to say
   "bad."
5. **Immutable cache headers, then a CDN (G18).**
6. **The adoption ramp (G23, G24).**

Two cheap wins sit next to machinery that already exists and can be taken
at any point: **bisect over the dev line** (seals are already there) and
**`modulepreload` injection** (import-map injection is already there).
