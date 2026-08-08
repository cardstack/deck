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

## 3. Adapters and integrations

*Genre: the Zapier long tail. `stripe→slack`, `github→linear`, `shopify→
sheets`, `webhook→anything`. Small, numerous, and written by the person who
needed it at 2am.*

**What is being built.** A catalog of small ES modules with a shared shape —
auth, triggers, actions, a schema — where the value is entirely in the
breadth of the tail, and every adapter has exactly one person who cares
about it deeply for about a week.

**How it goes today.** The economics are absurd and everyone accepts them: to
contribute forty lines to a connector catalog you fork the monorepo, clone
several hundred megabytes, install a toolchain, run a test suite that
exercises 900 adapters you have never heard of, open a PR, sign a CLA, and
wait for a maintainer who has 300 other PRs. Meanwhile the fix you need is
running in your own patched copy, which will never go back upstream — because
the overhead exceeds the contribution by two orders of magnitude.

The maintainer's side is just as bad: 300 open PRs, each of which needs a
rebase the moment anything lands, and each of which they must evaluate by
reading rather than running.

**In Deck.** An adapter is a deck. The whole contribution is:

```bash
deck fork --realm ./hub --from hub/stripe-slack --as you/stripe-slack --use-in you/automations
# edit two files; it is live in your automations before you switch windows
```

Your version is running in your workspace immediately, published under your
name, sealed. Upstream is untouched. Then:

- **The maintainer reviews by running.** One URL — `?with=hub/stripe-slack=
  you/stripe-slack` — runs the real harness with your adapter substituted.
  No checkout, no CI job, no preview deploy. They see it work or they see it
  fail.
- **Nobody rebases 300 proposals.** The daemon keeps them all merged against
  upstream and surfaces only the handful that stopped merging. The queue
  becomes "3 need a person", not "300 need a rebase".
- **Accepting is a pointer move.** Upstream publishes the treeHash your
  proposal already holds. Zero bytes copied. Or they don't accept it, and
  your version keeps working forever, which is a legitimate outcome rather
  than a failure.
- **Adoption is the signal.** Which adapters do other people's decklists
  actually pin? That is measurable, and it beats argument as a ranking for
  what deserves maintainer attention.

**Why the protocol is necessary.** The tail only gets covered if the cost of
contributing is smaller than the cost of the private patch. Publisher-scoped
forks (instant, no permission), review-by-running, and pointer-move
acceptance are what get it below that line.

**Delight.** You fix a webhook adapter, it is live in your automation four
seconds later, and the maintainer merges it two days after by clicking a
button that copies no bytes.

---

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

## 5. What the four have in common

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

## 6. Where these are still weak (honest list)

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
