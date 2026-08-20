# Deck fork, pull request, and merge UX

**Status: UX DIRECTION — protocol-backed.** This document specifies the
familiar collaboration surface Deck should present over the implemented local
Repository, Revision, Ref, and Pull Request protocol. It supersedes the UI rule
that Deck should avoid the words _branch_, _pull request_, and _merge_. Those
words are useful: people already know what they mean.

Companions: [`deck-ui-spec.md`](deck-ui-spec.md),
[`deck-hub-brief.md`](deck-hub-brief.md),
[`deck-version-is-a-proposal.md`](deck-version-is-a-proposal.md), and
[`deck-in-motion.md`](deck-in-motion.md). Protocol facts are defined by
[`deck-collaboration-protocol.md`](deck-collaboration-protocol.md).

---

## 0. Product ruling

> **Use the GitHub grammar people know. Make the result Deck-native.**

Deck should look immediately legible to a GitHub user:

- **Browse** owns repositories, code, branches, Versions, and Activity;
- **Review** owns proposed changes expressed as Pull Requests;
- a person can **Fork**, choose a branch, open a **Pull request**, review
  changes, see checks, and press **Merge**;
- a fork is private until its owner deliberately opens a pull request;
- conflicts and stale reviews have conventional, unmistakable states.

Deck's advantage appears after orientation, not before it:

- every pull request has a **Run this change** action;
- preview means executing the exact proposed Repository, not deploying an
  approximation;
- dependency substitutions are visible;
- a clean merge moves a pointer and copies no content;
- hundreds of agent pull requests collapse to the exceptional few that need
  attention.

The product should not ask a new user to learn _offer_, _trial_, _seal_,
_publisher boundary_, or _locus_ before completing their first contribution.
Those remain useful implementation and research concepts, not primary
navigation.

---

## 1. Familiar outside, Deck inside

| Familiar UI term   | Deck mechanism                                               | What the UI says                                               |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Repository         | named collaboration boundary over one or more package trees  | Repository                                                     |
| Owner              | publisher                                                    | Owner                                                          |
| Branch             | isolated fork ref presented inside the same owner/repository | Branch                                                         |
| Fork               | the same isolated fork primitive under a different owner     | Fork                                                           |
| Commit             | durable Revision                                             | Revision in detail; commit-compatible wording in import/export |
| Pull request       | durable source-ref → target-ref request                      | Pull request                                                   |
| Merge commit       | Revision with target and source parents                      | Merge                                                          |
| Release            | Version pointing at a treeHash and Revision                  | Version / Release                                              |
| Actions/checks     | signed results bound to exact source + target Revisions      | Checks                                                         |
| Deployment preview | exact proposed Repository + lock                             | Preview                                                        |

Two distinctions must remain explicit:

1. A **fork is not a pull request**. People fork to experiment privately.
2. A **merge is not a release**. Merging changes a branch; releasing makes a
   semver promise.

### 1.1 One mechanism, two familiar names

> **Same owner and repository: branch. Different owner: fork.**

Internally, every non-default line of work is a real isolated fork: it has
its own head, ancestry, writable live tree, immutable snapshots, and Version
line. “Branch” is the team-workflow name for a fork that remains inside the
same repository boundary.

```text
VISIBLE TO PEOPLE                         BACKED BY THE SAME PRIMITIVE

acme/currencies:main          ────────▶  ForkRef(owner=acme, repo=currencies)
acme/currencies:add-myr       ────────▶  ForkRef(upstream=…:main)
acme/currencies:next          ────────▶  ForkRef(upstream=…:main)
chris/currencies:add-myr      ────────▶  ForkRef(upstream=acme/…:main)
        ▲                                                ▲
        │                                                │
   called a fork because owner differs       identical isolation semantics
```

This is primarily a naming and presentation rule. It gives teams the
workflow they expect without introducing a weaker shared-directory kind of
branch:

| Source                  | New work line                 | UI calls it      | Why                        |
| ----------------------- | ----------------------------- | ---------------- | -------------------------- |
| `acme/currencies:main`  | `acme/currencies:add-myr`     | branch           | same owner/repository      |
| `acme/currencies:main`  | `chris/currencies:main`       | fork             | owner changed              |
| `chris/currencies:main` | `chris/currencies:experiment` | branch in a fork | same fork owner/repository |

The implementation must not make internal branches share one mutable live
directory. Each branch gets the same isolation, ancestry, merge behavior,
and zero-copy starting state as an external fork.

---

## 2. The repository in Browse

Repository identity is part of Browse, not a second site-wide shell. This is
what keeps the package tree, branch selection, Versions, and the Repository
that lands them together in one place.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ DECK                                      Search or jump to…        +   ◉ CS │
├──────────────────────────────────────────────────────────────────────────────┤
│ acme / currencies                                      main ▾    Review 12  │
├──────────────────────────────────────────────────────────────────────────────┤
│ package tree, Version controls, and content                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

Design rules:

- Owner and repository name are the strongest locator.
- Branch selection is a quiet address control beside package identity, not a
  loud tab or repository dashboard.
- The selector's **New…** section offers **Branch here** and **Fork to my
  scope**. They share one isolation primitive; ownership determines the noun.
- Imported packages are read-only. They show **Fork** only; the new package is
  mutable and gains `main`, branches, commits, and Reviews.
- Branch/Version volatility remains visible without duplicating the Version
  control below it.
- **Run** and **Code** form Deck's persistent two-way lens.
- `treeHash`, storage savings, and canonical URLs are one click away, never
  the headline a newcomer must decode.

### Route shape

```text
/browse?at=/<depot>/<publisher>/<package>        Repository / package code
/browse?at=<exact-branch-Version>                branch package tree
/review                                          proposed-change list
/review?repository=<owner>/<repository>&number=N Pull Request
/track?at=<Repository-member-address>            ref and Revision activity
```

These are Hub viewer routes. Raw ESM continues to use the existing Deck URL
grammar. The chrome never steals the canonical module address.

---

## 3. Repository home / Code

```text
┌─ acme / currencies ──────────────────────────────────────────────────────────┐
│ [ Code ]  Branches 3  Versions 34  Activity          [ Review 12 ] [ Fork ]│
├──────────────────────────────────────────────────────────────────────────────┤
│ main ▾    latest: 2.4.1    dev: 2.5.0-dev.18             [ Run repository ] │
│                                                                              │
│ acme merged #418 from kim/add-myr                              12 min ago    │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Name                         Last change                      Updated     │ │
│ │ data/                        Add MYR currency                 12m         │ │
│ │ index.js                     Export currencyByCode            3d          │ │
│ │ package.json                 Prepare 2.5 line                 3d          │ │
│ │ README.md                    Document formatter               8d          │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ README                                                     [ Preview data ] │
│ A maintained ISO currency list…                                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

The branch selector understands the three Deck address promises but presents
them without mixing them:

```text
┌─ Switch branch or version ──────────────────────────────┐
│ Find…                                                   │
│                                                        │
│ BRANCHES                                               │
│ ● main                              updated 12m ago     │
│   next                              updated 2h ago      │
│   agent/fix-symbols                 updated 5h ago      │
│                                                        │
│ VERSIONS — immutable                                   │
│   2.4.1  latest                     released 8d ago     │
│   2.4.0                             released 3w ago     │
│                                                        │
│ DEVELOPMENT — immutable snapshots                      │
│   2.5.0-dev.18  dev                 captured 12m ago   │
└────────────────────────────────────────────────────────┘
```

Branches move. Versions do not. Development snapshots do not. The grouping
teaches that distinction without inventing a new control.

### 3.1 Create a team branch

The branch selector contains the familiar action:

```text
┌─ Create a branch ────────────────────────────────────────────────────────────┐
│ Branch name     add-myr                                                     │
│ Branch from     main at 31c72d8 ▾                                           │
│                                                                              │
│ This creates an isolated work line inside acme/currencies.                   │
│ It starts from the same content and uses no additional source storage.       │
│                                                                              │
│                                               [ Cancel ] [ Create branch ]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

After creation, the repository name does not change:

```text
┌─ acme / currencies ──────────────────────────────────────────────────────────┐
│ [ Code ]  Branches 3  Versions 34  Activity          [ Review 12 ] [ Fork ]│
├──────────────────────────────────────────────────────────────────────────────┤
│ add-myr ▾     branched from main · 0 ahead · 0 behind                       │
│                                             [ Contribute ] [ Branch menu ▾ ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

The branch menu contains **Rename branch**, **Compare**, **Sync with main**,
and **Delete branch** according to permissions. “Fork” does not appear in
this internal team workflow even though isolation is implemented by the fork
primitive.

---

## 4. Fork: an ordinary, private action

The primary **Fork** button opens a familiar confirmation rather than
immediately enrolling the fork in an upstream queue.

```text
┌─ Create a fork ──────────────────────────────────────────────────────────────┐
│ A fork is your independent copy of acme/currencies.                         │
│ It will not notify acme until you open a pull request.                       │
│                                                                              │
│ Owner          chris ▾                                                      │
│ Repository     currencies                                                   │
│ Default branch main                                                         │
│                                                                              │
│ Storage        No source bytes copied — both refs point at the same tree.    │
│                                                                              │
│                                                [ Cancel ] [ Create fork ]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

After creation:

```text
┌─ chris / currencies ─────────────────────────────────────────────────────────┐
│ forked from acme/currencies · 0 revisions ahead · 0 behind                  │
│                                                                              │
│ [ Code ]  Branches 1  Versions 0  Activity       [ Review ] [ Sync fork ▾ ]│
│                                                                [ Contribute ]│
└──────────────────────────────────────────────────────────────────────────────┘
```

**Contribute** is the deliberate transition from private work to upstream
proposal. It appears only when the fork differs from upstream.

### Branch versus fork in pull-request labels

The compare control follows the convention people already know:

```text
INTERNAL TEAM BRANCH
base: acme/currencies:main       ←       compare: acme:add-myr

EXTERNAL FORK
base: acme/currencies:main       ←       compare: chris:add-myr
```

The short `owner:branch` label is sufficient when repository names match.
The detail popover carries the full source repository and exact Revision.

---

## 5. Open a pull request

```text
┌─ Open a pull request ────────────────────────────────────────────────────────┐
│ base repository: acme/currencies      base: main ▾                          │
│ head repository: acme/currencies      compare: add-myr ▾                    │
│                                                                              │
│ ✓ Able to merge      2 revisions      3 files      +42 −6                   │
│                                                                              │
│ Title   Add Malaysian Ringgit formatting                                    │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Adds MYR metadata and locale-aware formatting.                          │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ REVIEW THE RUNNING RESULT                                                    │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Preview URL  /run?with=acme/currencies=acme/currencies:add-myr@<rev>   │ │
│ │ [ Run proposed change ]  [ Compare with main ]                          │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ Reviewers  Add…       Draft ☐                         [ Create pull request ]│
└──────────────────────────────────────────────────────────────────────────────┘
```

The exact source Revision is captured when the request opens. A later source
update becomes an explicit pull-request event and makes Revision-bound checks
or approvals stale.

---

## 6. Pull request overview

The page should look conventional at first glance and unmistakably Deck on
the second.

```text
┌─ Add Malaysian Ringgit formatting  #418 ──────────────────────── Open ──────┐
│ chris wants to merge 2 revisions into acme:main from acme:add-myr           │
│                                                                              │
│ [ Conversation ]  Changes 3  Preview  Checks 4                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌─ RUNNABLE PULL REQUEST ─────────────────────────────────────────────────┐ │
│ │ This preview executes source revision 9a4f2c1 against main 31c72d8.     │ │
│ │ [ Run proposed change ] [ Side-by-side with main ] [ Copy exact URL ]  │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ chris opened this pull request                                      18m     │
│ Adds MYR metadata and locale-aware formatting.                              │
│                                                                              │
│ deck/check-links        ✓ passed       exact dependency closure             │
│ deck/data-shape         ✓ passed       181 currency records                 │
│ ui/preview              ✓ passed       artifact available                   │
│ amy approved            ✓ approved     source revision 9a4f2c1              │
│                                                                              │
│ ┌─ Ready to merge ────────────────────────────────────────────────────────┐  │
│ │ ✓ All required checks passed                                           │  │
│ │ ✓ Approved by amy                                                      │  │
│ │ ✓ Branch has no conflicts with main                                    │  │
│ │                                                        [ Merge ▾ ]      │  │
│ └─────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### The four tabs

| Tab          | Job                                                             |
| ------------ | --------------------------------------------------------------- |
| Conversation | intent, review events, approvals, ref changes                   |
| Changes      | file and semantic data diff                                     |
| Preview      | exact running result, import substitutions, side-by-side run    |
| Checks       | results bound to source Revision + target Revision + suite tree |

GitHub makes the diff primary because source is what it can show reliably.
Deck should give **Preview** equal rank because running the exact proposal is
its strongest product advantage.

---

## 7. Changes: code and data are both credible

Code diff:

```text
┌─ data/myr.js ─────────────────────────────────────────── +12 −0  Viewed ☐ ─┐
│  1  + export const MYR = {                                               │
│  2  +   code: 'MYR',                                                      │
│  3  +   symbol: 'RM',                                                     │
│  4  +   decimals: 2,                                                      │
│  5  + };                                                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

JSON/data diff:

```text
┌─ currencies.json ───────────────────────── Semantic diff · 1 key added ───┐
│ + MYR                                                                     │
│   code       "MYR"                                                       │
│   name       "Malaysian Ringgit"                                         │
│   symbol     "RM"                                                        │
│   decimals   2                                                           │
│                                                                           │
│ [ View as JSON ] [ View raw diff ]                                        │
└───────────────────────────────────────────────────────────────────────────┘
```

Review comments bind to `(sourceRevision, path, semantic key or line)`. If
the source moves and the location cannot be mapped confidently, the comment
stays visible as **Outdated** rather than floating onto unrelated bytes.

---

## 8. Preview: Deck's signature interaction

```text
┌─ Preview pull request #418 ─────────────────────────────────────────────────┐
│ main 31c72d8                                      pull request 9a4f2c1      │
│ ┌───────────────────────────────┐  ┌─────────────────────────────────────┐ │
│ │                               │  │                                     │ │
│ │        RUNNING MAIN           │  │       RUNNING PULL REQUEST          │ │
│ │                               │  │                                     │ │
│ │  180 currencies              │  │  181 currencies                    │ │
│ │                               │  │  MYR · Malaysian Ringgit · RM      │ │
│ └───────────────────────────────┘  └─────────────────────────────────────┘ │
│                                                                              │
│ Resolution change                                                            │
│ currencies   acme/currencies:main  →  acme/currencies:add-myr@9a4f2c1       │
│ everything else unchanged                                                    │
│                                                                              │
│ [ Open PR source ] [ Inspect dependency closure ] [ Copy exact preview URL ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

The preview banner must always show:

- pull-request number;
- exact source Revision;
- target Revision it was resolved against;
- changed dependency bindings;
- one action to return to the unmodified target.

A preview must never visually masquerade as production or ordinary live.

---

## 9. Conflicts and source updates

Conflicted request:

```text
┌─ Merge blocked ──────────────────────────────────────────────────────────────┐
│ main changed after this branch diverged. Deck found 2 real conflicts.       │
│                                                                              │
│ ✕ package.json                 dependencies.currencies                       │
│ ✕ data/currencies.json         MYR                                           │
│                                                                              │
│ 14 other upstream changes merge cleanly and need no attention.              │
│                                                                              │
│ [ Update branch automatically ]  [ Resolve locally ]                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

Deck should emphasize the exceptional paths, not display a generic “branch
is out of date” warning. If upstream changed 200 files but only two collide,
show two.

Updating a branch produces durable ancestry. It does not silently rewrite a
working tree:

```text
main ─────── A ───── B
              ╲     ╱
add-myr ─────── C ──M       M = update merge on the fork
```

After a source update:

```text
amy's approval is stale
Approved 9a4f2c1 · current source b71e833               [ Request review ]
```

---

## 10. Merge

```text
┌─ Merge pull request #418 ───────────────────────────────────────────────────┐
│                                                                              │
│ Method       ● Merge commit                                                  │
│              ○ Fast-forward when possible                                   │
│              ○ Squash into one Revision                                     │
│                                                                              │
│ Result       acme/currencies:main                                            │
│ Source       acme/currencies:add-myr at 9a4f2c1                              │
│ Content      3 files changed · pointer update · 0 source bytes copied        │
│                                                                              │
│ Create Version after merge   ☐ Open a release proposal                       │
│                                                                              │
│                                           [ Cancel ] [ Confirm merge ]       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Successful landing:

```text
┌─ Merged ─────────────────────────────────────────────────────────────────────┐
│ amy merged revision e42bc90 into acme/currencies:main just now              │
│                                                                              │
│ [ Run merged result ] [ View merge Revision ] [ Open release proposal ]     │
│                                                        [ Delete branch ]     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Do not make “zero bytes copied” the primary success message. It is valuable
supporting proof, not the user's job. The primary message is that the reviewed
change is now on the target branch and can be run.

---

## 11. Review queue and agent scale

Default list:

```text
┌─ Review · Pull requests ─────────────────────────────────────────────────────┐
│ [ 12 Open ]  184 Closed           Filters ▾       Sort: recently updated ▾  │
│                                                                              │
│ ✓ Add MYR formatting                     acme:add-myr          Ready     18m │
│ ● Refresh ISO numeric codes               agent-41:iso         Review     1h │
│ ✕ Normalize symbols                       agent-09:symbols     Conflict   2h │
│ ◌ Add historic currencies                 kim:historic         Draft      5h │
└──────────────────────────────────────────────────────────────────────────────┘
```

Agent-scale triage view:

```text
┌─ Review · Attention ─────────────────────────────────────────────────────────┐
│ 203 open     187 merge cleanly     9 waiting for checks     7 need people   │
│                                                                              │
│ NEED PEOPLE                                                                  │
│ ✕ #391  same JSON key changed differently       2 conflicts                 │
│ ! #402  required security review missing        opened by agent-14          │
│ ! #417  source changed after approval           re-review                    │
│                                                                              │
│ HEALTHY IN BACKGROUND                                                        │
│ ✓ 187 continuously checked and mergeable                    [ Show all ]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

This is where Deck should depart visually from GitHub. A queue of 200 agent
changes is summarized by state, with the seven exceptional requests expanded.
The product should not render automation success as 187 equally loud rows.

---

## 12. Visual credibility

Deck must look like a production forge, not a protocol inspector.

### Hierarchy

1. Repository and current branch.
2. Work state: open, draft, blocked, ready, merged.
3. Human intent: title, author, reviewers, discussion.
4. Runnable result and checks.
5. Files and semantic changes.
6. Content identity, canonical URLs, storage mechanics.

### Density

- Repository and PR pages use a 1200–1440 px content width.
- Primary reading columns stay approximately 760–880 px.
- Use bordered groups for files, checks, merge state, and preview state—not
  a card around every sentence.
- Tables remain tables. Do not turn repository listings into card grids.
- A single green/red/amber state language is shared across list and detail.

### Color

| State                         | Treatment                                     |
| ----------------------------- | --------------------------------------------- |
| open / neutral                | cool blue or violet accent                    |
| ready / passed / merged       | green                                         |
| waiting / stale / draft       | amber or neutral gray                         |
| failed / conflicted / blocked | red                                           |
| preview / substituted runtime | strong violet banner distinct from production |

Color never carries state alone; icon and text accompany it.

### Typography

- Repository, branch and file names use the product's mono face.
- Titles, descriptions and review prose use the reading face.
- Hashes are shortened to seven characters in ordinary chrome.
- Full hashes and canonical addresses live in copyable detail popovers.

### What not to imitate

- Do not reproduce GitHub's exact chrome, iconography, or color tokens.
- Do not bury Preview under an environment/deployment sidebar.
- Do not call every captured save a commit in the main UI.
- Do not make protocol metadata compete visually with contributor intent.

Credibility comes from complete interaction states and consistent hierarchy,
not from tracing GitHub pixel for pixel.

---

## 13. Build from protocol facts

Build the UX in three slices.

### Slice U0 — Repository fixture

Add static, typed fixtures representing:

- clean pull request;
- draft;
- source updated after review;
- real conflict with paths/JSON keys;
- failed check;
- merged request;
- 200-request agent queue summarized to exceptions.

Build the repository shell, pull-request list, detail, changes, preview, and
merge dialog against `examples/collaboration`. The same validation state must
round-trip through the collaboration implementation; the UI does not own a second
model of repository state.

### Slice U1 — read protocol objects

- Repository member, file, Revision, branch, and Version data from Hub
  endpoints over the protocol store.
- Existing forks and `forkedFrom` records projected as compatibility pull
  requests.
- Existing `mergeTrees` result projected into per-package ready/conflict state.
- the captured Repository and lock power the Preview tab; `?with=` remains a
  temporary trial mechanism, not the pull request identity.
- Existing checks, signatures, and Timeline facts displayed read-only.

This slice proves the product with real Deck content and durable refs before
write actions are enabled.

### Slice U2 — durable pull requests

The local core now has Pull Request openings, append-only events, exact
preview, Repository merge, and crash-recoverable merge completion. Bind those
objects to the Hub. The conditional object-store adapter already covers S3
branch refs, Pull Request numbering, openings, and event heads. Hosted fork,
review, merge, and close actions still require the authenticated origin API.
The visual contract does not change.

The executable terminal tour in
[`deck-repository-tour.md`](deck-repository-tour.md) is the behavioral fixture
for this slice. The visual UI must agree with its hashes and transitions.

---

## 14. Acceptance walkthrough

A first-time GitHub user should complete this without documentation:

1. Open `acme/currencies` and recognize a repository.
2. See that **Fork** and **New branch** are separate, familiar actions, and
   that neither opens a pull request.
3. As a team member, create an `acme/currencies:add-myr` branch; as an
   outside contributor, create `chris/currencies` as a fork.
4. Understand that both work lines have identical isolation even though the
   UI names them differently.
5. Press **Contribute** and compare base/head.
6. Open a pull request.
7. Run the exact proposal beside main.
8. Read code or semantic JSON changes.
9. See checks and approval state.
10. Merge, then run the merged result.
11. Optionally open a separate Version proposal.

An experienced Deck user should additionally be able to prove:

- which exact source and target Revisions were reviewed;
- which Repository hash and member treeHashes executed in Preview;
- which dependency bindings changed;
- why an approval became stale;
- that a merge copied no content bytes;
- that the released Version, if any, points at the merged tree.

If the first journey requires explaining Deck vocabulary, the UX has failed.
If the second journey cannot reach the content-addressed proof, the UX has
become merely a GitHub imitation.
