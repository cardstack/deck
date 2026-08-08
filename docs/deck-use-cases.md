# Four things Deck makes possible that GitHub makes painful

A pass at use cases that *necessitate* the protocol rather than merely
benefit from it. Each is in the ES-modules-and-HTML genre, each is something
people build and rebuild constantly, and each breaks in a specific,
nameable way on the GitHub + npm stack — especially once agents are doing
the writing.

---

## 0. What actually breaks, in agentic engineering

Not "git is bad". Git is excellent at what it was built for: a small number
of humans, editing text, deliberately, over days. Every assumption in that
sentence is now false.

| Assumption | What agentic work does |
| --- | --- |
| Changes are expensive to produce | An agent writes a working change in ~30 seconds |
| Review is cheap relative to authoring | Authoring got 10× cheaper; reading did not |
| Few concurrent lines of work | 18 agents means 18 branches that cannot be run together |
| Integration is occasional | It is now the bottleneck, and it is serial |
| The unit of work is a repo | The unit of work is one module, one adapter, one skill |
| Humans hold uncommitted state safely | An agent will `checkout` over your work |

Five concrete bottlenecks, in the order they hurt:

1. **The airlock.** Generation takes seconds; branch → push → CI → review →
   merge → deploy takes tens of minutes at best. The loop that matters runs
   at the speed of the slowest human-scheduled step.
2. **Branches don't compose.** You cannot *run* agent A's work plus agent
   C's work without a human performing a merge first. So you evaluate work
   in isolation and discover interactions at integration time.
3. **Review means reading.** For generated code, reading is the wrong
   instrument — you want to run it. Preview environments exist, but they are
   per-app, per-PR, need CI, and take minutes each.
4. **Publishing is ceremony.** `npm publish` has a floor of minutes and a
   version number a human negotiates. You cannot publish 400 times an hour,
   so the shared thing lags the working thing, so people copy instead of
   depend.
5. **Git is unsafe for agents.** Uncommitted work, force pushes, `reset
   --hard`. The protective habits are human habits.

The rest of this document is four shapes of work where those five turn a
one-hour job into a one-week job.

---

## 1. The swarm-built internal tool

*Genre: the dashboard/admin panel every company rebuilds every two years.*

**What is being built.** An operations dashboard: a filter bar, a table, four
charts, a CSV export, and a data adapter that talks to the warehouse. Eight
agents, one per component, working simultaneously, plus a human steering.

**How it goes today.** Eight branches, or one branch and a queue. If they
share a branch they collide in the same files; if they don't, nobody can see
the *assembled* thing until someone merges. The human reviewing is reading
eight diffs of code they didn't write, trying to imagine the composite. When
chart 3's agent goes off the rails, the whole branch is poisoned, and
rolling back one agent's work means surgery on shared history.

**In Deck.** Each component is a deck under its own publisher:

```
tool/charts/revenue     tool/charts/funnel      tool/data/warehouse
tool/ui/filter-bar      tool/ui/table           tool/app/dashboard
```

The app's decklist points at each of them. Every agent's save auto-publishes
under its own name and is sealed. The app composes them by import map, so
the assembled thing exists continuously — there is no integration step,
because there was never a disintegration.

Then the two moves that don't exist elsewhere:

- **Quarantine one agent without stopping the others.** Chart 3 is producing
  nonsense: change one pin from `live` to `^1.2.0`. That component freezes at
  its last good release while everything around it keeps moving. No branch, no
  revert, no conversation.
- **Dial volatility per dependency.** The parts you are working on are
  `live`; the parts you need to stand on are pinned. The same app, at the
  same moment, is both a laboratory and a stable base — chosen per component
  by the person who cares.

**Why the protocol is necessary.** Composition happens at *load* time through
the import map, so "run these eight in-progress things together" is the
default state rather than a merge. And per-dependency volatility is only
expressible because live, dev, and semver are three different addresses of
the same deck.

**Delight.** You watch the dashboard change under you while eight agents
work — and when one goes bad, you fix it by changing a single line, and only
that panel stops moving.

---

## 2. Codelists and reference data

*Genre: the shared table of facts. Countries, currencies, tax rates, unit
conversions, ICD codes, product taxonomies, airport codes, holiday
calendars, the LLM model-and-pricing registry.*

**What is being built.** A published set of controlled vocabularies that
dozens of apps import at runtime, amended constantly by many people —
usually by whoever noticed the fact was wrong.

**How it goes today.** This is the worst case for the git+npm stack, for four
compounding reasons:

- **JSON conflicts constantly.** Two people adding two different countries
  touch adjacent lines, and a line-based merge calls that a conflict. It is
  not a conflict; it is two additions.
- **Review is meaningless.** A reviewer reading `+ "XCD": "East Caribbean
  Dollar"` cannot evaluate it. The useful check is *does every consumer still
  render*, which nobody can run.
- **Publishing lags reality.** The data changes weekly; `npm publish`
  ceremony means it changes monthly, so every team keeps a patched copy.
- **Semver for data is undefined in practice.** Adding a code is additive.
  Changing what a code *means* is breaking. Nothing enforces the difference,
  so consumers pin exact and never upgrade.

The end state is universal: everyone has their own stale fork, and the
"canonical" list is canonical in name only.

**In Deck.** The codelist is a deck of JSON. Four things change:

- **JSON merges as data, not as lines.** Two contributors adding different
  keys both land, with no conflict and no review round — this is implemented
  and tested, not aspirational. Only the *same key changed differently* is a
  real disagreement, which is exactly the case that deserves a human.
- **Amendments publish instantly** as `dev` prereleases; ranges never see
  them, so the volatility is opt-in. A curator releases `1.4.0` when a batch
  is right, and that release copies zero bytes.
- **Consumers choose their exposure per list.** `^1.0.0` for the tax table
  you must not have move under you; `dev` for the model registry you want
  fresh; `live` while you are the one editing it.
- **Everyone's fork keeps absorbing upstream.** Your patched copy — with your
  three internal currency codes — is a fork with a recorded base, so the
  rebase daemon merges every upstream amendment into it continuously. You
  keep your patch *and* stay current, forever, without doing anything. That
  is the thing that makes the universal stale fork unnecessary.

**Why the protocol is necessary.** Key-level merge plus content-addressed
versions plus continuous rebase is what turns "everyone forks and rots" into
"everyone forks and stays fresh". Remove any one and the pattern collapses
back to copies.

**Delight.** Two people on different continents add two different currency
codes in the same minute. Both land. Nobody reviewed anything. Nobody's fork
went stale.

---

## 3. Adapters, patterns, and the automation you wrote for yourself

*Genre: the Zapier long tail. But it is not one genre — it is four strata
with completely different physics, and today each is exiled to a different
system.*

### 3.1 The stratum nobody notices

"Slack → Google Doc" sounds like one thing. It is four:

| | What it is | Changes | Consumers | Contains secrets or specifics |
| --- | --- | --- | --- | --- |
| **S1 Adapter** | the Slack client / MCP shim: auth, endpoints, types | when Slack changes — monthly at most | thousands | no |
| **S2a Bespoke pattern** | *my* rule: this channel, tagged `#ship`, into that quarterly doc, formatted my way | hourly while being built, then never | **one** | yes, throughout |
| **S2b Generic pattern** | "message → document", parameterized, configurable | weekly | many | no — the specifics were extracted into a schema |
| **S3 Instance** | the actual binding: channel `C08…`, doc `1aZ…`, every weekday 09:00 | when I tweak it | **one** | yes, maximally |
| *(S4 Runtime data)* | the messages themselves | constantly | — | **never Deck's business** |

The adapter is the boring, stable part. Everyone talks about it because it is
the part that has a home (npm, an MCP registry). The interesting part — the
pattern and the instance — has no good home at all, which is why Zapier's
actual product is a proprietary database of things you cannot version, fork,
diff, or run anywhere else.

### 3.2 The move that matters: bespoke → generic

The valuable transition is S2a → S2b. You vibe-code something absurdly
specific because that is the fastest way to get it working; then it turns out
four colleagues want it; then it wants a config form instead of hardcoded
IDs.

Today that transition is a **rewrite in a different system**. You cannot
promote your Zap to a shared template; you rebuild it as one. So mostly
nobody does, and the same integration is rebuilt privately a thousand times.

In Deck it is a fork plus an extraction:

```bash
deck fork --realm ./hub --from me/ship-notes --as team/message-to-doc
# pull the hardcoded IDs out into config.schema.json; publish 1.0.0
```

Your private one keeps working, untouched, pinned to whatever it was pinned
to. The generic one has its own version line from birth. Nothing migrated.

And the extraction pays twice: **a pattern that declares a config schema
becomes configurable without any UI work** — the schema generates the form,
and an instance (S3) is just a JSON document validated against it. The
"configure it in a UI" product and the "it's a data deck" product are the
same product.

### 3.3 What each stratum needs, and why one address space

The strata compose — an instance imports a pattern which imports adapters —
so they must be addressable in one space or people will copy instead of
depend. That is the whole argument, and it is worth being concrete:

- **S1 wants immutability and trust.** Pinned semver, bit-identical forever
  (content-addressing proves it), hermetically vendored so it never phones a
  CDN at runtime, and eventually a signature — it is the layer holding
  credentials.
- **S2a wants no ceremony at all.** It is vibe-coded; the point is speed. Every
  save sealed, `live` addressing, restore to twenty minutes ago. No commit
  message, no publish decision, no name negotiation.
- **S2b wants a contract.** Semver, a config schema, a changelog by way of a
  version timeline, and the contribution queue.
- **S3 wants to be data.** Validated, versioned, private, and — critically —
  holding *references* to secrets, never secrets.

The mismatch across strata is the everyday pain: **my hourly-changing pattern
depends on a monthly-changing adapter.** Deck expresses that in one line each:

```json
"dependencies": {
  "hub/slack":  "^2.0.0",   ← frozen; I am not debugging Slack today
  "hub/gdocs":  "^1.4.0",
  "me/format":  "live"      ← mine, moving under me, every save
}
```

Nothing else lets one composition mix "pinned forever" and "every keystroke".
Zapier has no pinning; npm has no `live`.

### 3.4 The catalog and the queue (unchanged, and still the load)

For S1 and S2b, contribution volume is the problem. The economics today are
absurd: to contribute forty lines you fork a monorepo, clone hundreds of
megabytes, install a toolchain, run a test suite over 900 adapters you have
never heard of, open a PR, sign a CLA, and wait for a maintainer with 300
other PRs. Your fix runs in your private copy and never goes back.

In Deck: fork into your own scope (running immediately), the maintainer
reviews by opening one URL that runs the real harness with your adapter
substituted, the daemon keeps all 200 proposals merged so only the genuine
conflicts surface, and acceptance is a pointer move that copies zero bytes.
Adoption count — whose decklists actually pin you — beats argument as a
ranking for what deserves attention.

**Delight.** You fix a webhook adapter and it is live in *your* automation
four seconds later. Two days on, the maintainer clicks a button that copies
no bytes. And the absurdly specific thing you built for yourself last month
becomes the team's configurable template without being rewritten.

## 4. Skills and agent capabilities

*Genre: the prompt-plus-tools bundle. A skill, a system prompt, an eval set,
a house style guide, a tool definition.*

**What is being built.** A library of skills — markdown, JSON schemas, a few
ES modules — that agents load. Every team wants the community skill *but with
their house conventions*, and the only way to know a skill works is to run it
on real work.

**How it goes today.** Skills live in dotfiles, gists, and repo folders,
copied by hand. There is no version, no provenance, no way to try someone
else's before adopting it, and no way to keep your customized copy current
with theirs. Prompt work is also uniquely iterative — a good skill is 200
tiny edits — and git treats each of those as a commit you must author,
message, and push, so people just don't, and the good intermediate versions
are gone.

Worse: evaluating a skill by reading it is nearly useless. The only real
evaluation is running the harness against it.

**In Deck.** A skill is a deck of markdown and JSON.

- **Every iteration is kept without ceremony.** The 200 tiny edits are 200
  seals and a growing dev line, none of which needed a commit message. When
  version 40 was better than version 60, you can find it and go back — and
  going back is forward-only, so it is itself undoable.
- **A/B two skills by opening two links.** `?with=skills/reviewer=
  you/reviewer-strict` runs your harness with the variant swapped. Two tabs,
  two behaviours, same everything else.
- **Fork-and-house-style is the norm, and it stays fresh.** Your fork of the
  community reviewer skill — with your conventions in it — absorbs every
  upstream improvement automatically, and only tells you when your change and
  theirs actually collide.
- **Provenance survives.** A skill records what it was forked from and which
  seal each published version was cut from, so "where did this prompt come
  from and what changed" is answerable months later.

**Why the protocol is necessary.** Prompt iteration is the highest-frequency,
lowest-ceremony editing there is; anything with a commit step loses the
intermediate states, which are the ones you want back. And skills are
evaluated by execution, so review-by-URL is not a nicety.

**Delight.** You tune a skill for an hour, decide the version from 40
minutes ago was better, find it by scrubbing a timeline, and restore it —
knowing the hour you are abandoning is also sealed, in case you were wrong.

---

## 5. Velocity, width, and privacy — the three axes

The adapter strata expose an axis system that runs through all four
workloads, and it explains what Deck is actually for better than any feature
list.

### 5.1 The axes

- **Velocity** — how often it changes. Per-keystroke (a bespoke pattern, a
  skill under tuning) to per-quarter (a currency list, a Slack adapter).
- **Width** — how many consumers. One (my automation, my house-style skill)
  to thousands (an adapter, a codelist).
- **Privacy** — whether it contains specifics: my IDs, my customers, my
  prompts, my org's rules.

They are not independent. **Velocity and width are inversely correlated, and
privacy tracks specificity.** The fast-changing things are private and have
one consumer; the widely-used things are slow and public.

```
   high velocity ┃  S2a bespoke pattern        skill under tuning
                 ┃  S3 instance                swarm component (W1)
                 ┃
                 ┃         ← the promotion path runs this way ←
                 ┃
    low velocity ┃  S1 adapter    codelist (W2)    S2b generic pattern
                 ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    width = 1                              width = many
                    private                                public
```

### 5.2 What each axis demands, and what Deck answers with

**Velocity → the cost of capturing a change must approach zero at the top of
the axis, and the cost of *changing* must approach infinity at the bottom.**
Those are opposite requirements, and most systems pick one. Git picks
capture-with-ceremony; Zapier picks capture-with-no-history; npm picks
immutable-with-ceremony. Deck answers with **auto-publish plus seals** at the
top (no commit, no message, no decision — and you can still go back to any
moment) and **content-addressed immutability** at the bottom (a pinned
version is bit-identical forever, provably).

**Width → the cost of distribution must be zero at width=1.** This is the one
everybody gets wrong. If publishing is a decision, the private case pays for
a benefit it does not want, so people keep it out of the system entirely —
and then it has no history, no versions, and no path to being shared. Deck
answers by making *everything* published into your own scope automatically.
Width=1 costs nothing: you get a URL, versions, and history, and nobody has
any reason to look. Width grows later, by fork and extraction, with **no
migration** — that is the promotion path, and it is the thing the axis
diagram is really about.

**Privacy → the boundary must be structural, not a setting.** And here Deck
is honest about a limitation that is currently an accidental virtue: the
**realm is the boundary**, cross-realm is unbuilt, so isolation is the
default and there is no accidental-sharing mechanism to misconfigure. When
federation lands, "which realm" must remain the privacy decision — not a
per-deck flag, which is the setting everybody forgets to set.

### 5.3 The rule that follows: immutability is hostile to secrets

Every property that makes Deck good for code makes it dangerous for secrets.
Packs are content-addressed and immutable; the store dedups by hash; history
keeps everything; restore is forward-only. **A secret sealed into a pack is a
secret you cannot recall.**

So the rule, and it should be enforced rather than documented: a deck carries
*references* to secrets — a key name the host resolves at runtime — never
values. (Boxel's server-injected-key proxy pattern is the precedent.) The
right shape of enforcement is an open question: scanning on publish, a
declared `secrets` block in the map that is the only legal way to name one,
or both.

### 5.4 The gap this exposes: forking privately

Today `deck fork` records a base, and recording a base is what makes a fork
an **offer**. That is exactly right for S2b and for the adapter catalog.

It is exactly wrong for S2a. Forking `hub/slack` to hack in a workaround for
my own automation should not enqueue a proposal against a maintainer who
never asked. Privacy and contribution are being conflated by a single
mechanism.

The distinction is real and needs a design: *fork to propose* versus *fork to
keep*. Candidates — an explicit flag at fork time; inferring it from whether
an actor was recorded; letting a private realm hold the fork so it is
structurally invisible; or letting the offer exist but requiring the
contributor to *offer* it as a separate act. The last is probably closest to
how people actually work: a fork is private until you point at it.

Related: `?with=` trials let anyone run an app with a substituted dependency.
That is a capability, and in a shared context it needs to be one.

## 6. What the four have in common

The pattern that predicts "Deck is the right tool":

1. **Many small units, not one big one.** The unit of change is a module, a
   list, an adapter, a skill — not a repository.
2. **Edit frequency far above release frequency.** Hundreds of saves per
   release; the interesting states are between the releases.
3. **Evaluated by running, not by reading.** A diff is a poor instrument for
   generated code, reference data, integrations, and prompts alike.
4. **A long tail of contributors with shallow, intense involvement.** One
   person cares enormously for a week and then leaves.
5. **Everyone ends up with a private fork.** The tell that the contribution
   cost exceeds the patch cost — and the thing continuous rebase fixes.

If a workload has all five, the git+npm stack is imposing a cost that has
nothing to do with the work.

---

## 7. Where these are still weak (honest list)

- **Cross-realm is not built.** Every example above assumes one realm. A
  public adapter or codelist catalog spans realms; `deck lock` refuses
  cross-realm dependencies today rather than writing a pin nobody can serve.
  This is the single largest gap for use cases 2 and 3.
- **Identity is filesystem-level.** "Publisher `acme`" means "whoever has the
  directory". Upstream adoption across a trust boundary needs signatures over
  the treeHash — which arrives with Matrix identity in the realm server.
- **No reject/close for an offer.** An unadopted proposal simply stays a fork
  forever. Defensible, but the UI has nothing to show for "we looked and
  said no".
- **Non-ESM languages get the distribution half only.** Identity, versions,
  seals, forks, merge, and offers are just trees and work anywhere. The
  instant half needs late binding over URLs, which is ES modules (and,
  through an import hook, Python). Rust participates as a producer of wasm
  artifacts, not as live source.
- **Discovery is absent.** These use cases assume you know the deck you want.
  Search, ranking by adoption, and a catalog view are unbuilt.
- **No private fork.** Every fork is an offer (§5.4). The bespoke stratum
  needs the opposite default.
- **No secret discipline.** Nothing stops a key being sealed into a pack,
  where it is immutable and content-addressed forever (§5.3).
- **No config schemas yet.** A pattern that declares one becomes configurable
  for free (§3.2); the convention and the form generation are unbuilt.
