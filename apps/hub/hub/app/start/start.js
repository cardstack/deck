// /start — this machine now, and the book.
//
// THE FRONT DOOR HAS TO DO TWO JOBS THAT USUALLY FIGHT.
// ════════════════════════════════════════════════════
// A landing page explains. A dashboard reports. Put them on separate pages
// and the explanation is read once and never again, while the dashboard says
// what is happening without ever saying why it matters.
//
// They are one page here because the Hub's whole argument is that the thing
// being explained is the thing you are looking at. Every claim below has a
// live number beside it drawn from THIS server: the vendoring paragraph is
// followed by how many decks this machine actually vendored, the immutability
// paragraph by how many immutable Versions it is actually holding. A sentence
// that could be checked and was not is a sentence nobody has to believe.
//
// WHAT THIS PAGE IS NOT.
// A self-contained tutorial. Every section here is short and ends in a link
// into /browse, /run or /track, because reading about a runnable thing when
// the runnable thing is one click away is the worst of both. The interactive
// protocol stories (ui/tour) launch from the hero — live demos, not a Hub UI tutorial —
// captions live in the bottom bar; it does not replace the live numbers
// or the doctrine below.
//
// The long-form book still exists at /deckbook — captured transcripts, worked
// use cases, the full CLI walkthrough. That page is a document. This one is
// an instrument, and it is the one that has to be true right now.
import 'ui/nav';
import { installNavStyles, wrapTables } from 'ui/nav';
import { mountTourButton, resumeHubTour } from 'ui/tour';
import hljs from 'highlight-js';
import bash from 'highlight-js/es/languages/bash.js';

installNavStyles();

// ONE LANGUAGE, LOADED EAGERLY. /browse loads languages on demand, because it
// can be shown any of 192 of them and must not fetch 2.6 MB to find out which.
// This page contains shell commands and nothing else, so the answer is known
// in advance and a dynamic import is a round trip to learn what is already
// true. Registered under both names, because a reader who writes either is
// not wrong.
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);

/** Colour the command transcripts. Idempotent: coloured blocks are skipped. */
function highlight(root) {
  for (let block of root.querySelectorAll('pre.term code:not([data-lit])')) {
    block.dataset.lit = '1';
    block.innerHTML = hljs.highlight(block.textContent, {
      language: 'bash',
      ignoreIllegals: true,
    }).value;
  }
}

const app = document.getElementById('app');
const keys = document.querySelector('deck-keys');

/** The one breakpoint, named once so the CSS and the markup cannot disagree. */
const WIDE = matchMedia('(min-width: 62rem)');

const esc = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

async function getJson(url) {
  let response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

/** `4m` · `2h` · `3d`, or '' when there is no honest answer. */
function ago(when) {
  let then = typeof when === 'number' ? when : Date.parse(when ?? '');
  if (!Number.isFinite(then)) return '';
  let seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// THIS MACHINE, NOW
//
// Composed from endpoints that already exist rather than from a new
// `/_status` that only this page would ever call. Three reasons, and the
// third is the one that matters:
//
//   · every number here is one a client could compute, so nothing on this
//     page is a privilege of being the Hub
//   · a summary endpoint is a second place for the truth to live, and the
//     two drift on the day someone changes the store and not the summary
//   · if this page can be built from the protocol, the protocol is enough —
//     which is the claim, and this is the test of it
// ---------------------------------------------------------------------------

/**
 * First paint — `/_packages` only.
 *
 * Activity and per-depot `/_history` used to sit on the critical path and
 * turned this panel into a multi-second wait behind seal-log walks. Claims
 * arrive in `enrichNow`; step totals are no longer fetched here (the History
 * link is enough — counting every seal on start was the expensive lie).
 */
async function now() {
  let packages = await getJson('/_packages').catch(() => ({ data: [] }));
  let depots = packages.data ?? [];
  let tape = new Map(
    depots.map((depot) => [
      depot.name,
      { depot: depot.name, steps: undefined, newest: undefined },
    ]),
  );

  let decks = 0;
  let versions = 0;
  let vendored = 0;
  let live = 0;
  let newestVersion;
  for (let depot of depots) {
    for (let deck of depot.packages ?? []) {
      decks += 1;
      if (deck.live) live += 1;
      if (deck.upstream) vendored += 1;
      for (let record of Object.values(deck.versions ?? {})) {
        versions += 1;
        let when = Date.parse(record.publishedAt ?? '');
        if (Number.isFinite(when) && !(when <= (newestVersion ?? -Infinity))) {
          newestVersion = when;
        }
      }
    }
  }

  return {
    depots,
    tape,
    decks,
    versions,
    vendored,
    live,
    claims: [],
    steps: undefined,
    newestVersion,
  };
}

/** Claims only — after the depot table is already on screen. */
async function enrichNow(state) {
  let activity = await getJson('/_activity?top=200&grain=package').catch(
    () => ({
      foci: [],
    }),
  );
  state.claims = (activity.foci ?? []).flatMap((focus) =>
    (focus.claims ?? []).map((claim) => ({ ...claim, at: focus.id })),
  );
  return state;
}

function statLine(state) {
  if (!state) {
    // The same six slots, holding a dash. Reserving the row means the page
    // does not jump when the numbers land — and a dash reads as "not known
    // yet" where a zero would read as an answer.
    return (
      `<div class="stats" data-role="stats">` +
      ['depots', 'decks', 'Versions', 'Steps', 'vendored', 'active']
        .map(
          (label) =>
            `<span class="stat"><b class="dim">—</b><span>${label}</span></span>`,
        )
        .join('') +
      `</div>`
    );
  }
  // Counts that are also doors. A number nobody can follow is trivia; each of
  // these lands in the lens that can answer the next question about it.
  let cells = [
    [state.depots.length, 'depots', '/browse'],
    [state.decks, 'decks', '/browse'],
    [state.versions, 'Versions', '/track?kind=published,released,vendored'],
    [state.steps, 'Steps', '/track'],
    [state.vendored, 'vendored', '/track?kind=vendored'],
    [state.claims.length, 'active', '/track'],
  ];
  return (
    `<div class="stats" data-role="stats">` +
    cells
      .map(([value, label, href]) => {
        let shown = value === undefined || value === null ? '—' : value;
        return (
          `<a class="stat" href="${esc(href)}">` +
          `<b${value === undefined || value === null ? ' class="dim"' : ''}>${shown}</b>` +
          `<span>${esc(label)}</span></a>`
        );
      })
      .join('') +
    `</div>`
  );
}

function depotTable(state) {
  let rows = state.depots
    .map((depot) => {
      let tape = state.tape.get(depot.name);
      let runnable = (depot.packages ?? []).filter((deck) => deck.live).length;
      return (
        `<tr>` +
        `<td><a class="s-depot" href="/browse?at=/${esc(depot.name)}">${esc(depot.name)}</a></td>` +
        `<td class="num">${(depot.packages ?? []).length}</td>` +
        `<td class="num">${runnable}</td>` +
        `<td>${
          depot.history
            ? `<a class="s-seal" href="/browse?at=/${esc(depot.name)}/_history">` +
              (tape?.steps == null
                ? `History`
                : `${tape.steps} Step${tape.steps === 1 ? '' : 's'}`) +
              `</a>` +
              (tape?.newest
                ? ` <span class="dim">· ${esc(ago(tape.newest))}</span>`
                : '')
            : `<span class="dim">Version history only</span>`
        }</td>` +
        `<td><a href="/run?at=/${esc(depot.name)}">run →</a></td>` +
        `</tr>`
      );
    })
    .join('');
  return (
    `<table><thead><tr>` +
    `<th>depot</th><th class="num">decks</th><th class="num">live</th>` +
    `<th>History</th><th></th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`
  );
}

function activeNote(state) {
  if (!state.claims.length) {
    return `<p class="dim">Nobody has declared work in progress right now.</p>`;
  }
  return (
    `<ul class="plain">` +
    state.claims
      .map(
        (claim) =>
          `<li><b class="s-publisher">${esc(claim.actor)}</b> is in ` +
          `<a href="/browse?at=${esc(claim.at)}">${esc(claim.at)}</a>` +
          (claim.text ? ` <span class="dim">— ${esc(claim.text)}</span>` : '') +
          `</li>`,
      )
      .join('') +
    `</ul>`
  );
}

// ---------------------------------------------------------------------------
// The written half
//
// Every heading below was a section of the standalone Deckbook. What changed
// is not the ideas — they held up — but the vocabulary and the honesty about
// what the page can prove. `seal` used to mean three different things on one
// page; a Version, a Step and the act of sealing are now three words.
// ---------------------------------------------------------------------------

const QUICKSTART = `
<p>Do not install Deck from npm. A different package has that name on the
public registry. The command <code>npx deck</code> starts that other package.
Run Deck from this repository.</p>

<p>Start a new depot, or serve a directory that you have already:</p>

<pre class="term"><code># make a depot and serve it
node packages/cli/bin/deck.js hello ./playground

# or serve a directory that exists
node packages/cli/bin/deck.js serve --root ./work --history deckd</code></pre>

<p>Open the URL that the command prints. Then change a file in a deck
directory. The server does these steps for each change:</p>

<ol>
<li>The server waits for 500 milliseconds of quiet.</li>
<li>The server calculates the tree hash. If the hash is the same, the server
stops here.</li>
<li>The server packs the tree.</li>
<li>The server publishes the tree as a new Version with the name
<code>&lt;base&gt;-dev.N</code>.</li>
<li>If a history backend is available, the server also records a Step.</li>
</ol>

<p>You did not give a name to any of these Versions. No work is lost. To give
a name to a state, use a different command:</p>

<pre class="term"><code>node packages/cli/bin/deck.js release --depot ./work/site \\
  --publisher acme --name palette --version 1.1.0 --from dev --tag latest</code></pre>

<p>This command copies no bytes. The command gives a name to a state that is
already in the store.</p>

<h3>Work together on an ordinary package</h3>

<p>Every mutable package is already a repository. It needs no
<code>repository.json</code> and no initialization ceremony. Create a branch,
edit the package, capture an intentional Revision, open a Review, and merge
it:</p>

<pre class="term"><code>deck branch --depot ./work/site --repo acme/palette \\
  --name fix/contrast --from main

# edit ./work/site/acme/palette, then capture the branch
deck commit --depot ./work/site --repo acme/palette \\
  --branch fix/contrast --message "Improve contrast"

deck review --depot ./work/site --repo acme/palette \\
  --source fix/contrast --target main --title "Improve contrast"

deck merge --depot ./work/site --repo acme/palette --number 1</code></pre>

<p>Browse shows the package, its branches, and its Revision history. Review
shows the exact source and target Revisions, the file differences, a runnable
preview, and the merge result. Both surfaces read the same durable objects
that the CLI writes.</p>

<h3>Fork an imported package before changing it</h3>

<p>An import is immutable input. Deck never gives an upstream package a
writable branch in place. Forking materializes the chosen Version under your
publisher, records its ancestry, and creates a mutable package repository:</p>

<pre class="term"><code>deck fork --depot ./work/site \\
  --from three/three@0.179.1 --as you/three --use-in you/app</code></pre>

<p>A branch and a fork use the same cheap content-addressed ancestry. The
difference is ownership: a branch stays inside one repository; a fork crosses
into another publisher's package and can be reviewed back upstream when it
has mutable upstream lineage.</p>

<h3>Group packages only when they must land together</h3>

<p>Most work stops at the package repository above. When a change to several
packages and the exact import map must be atomic, use
<code>deck repo-init</code>. It writes <code>repository.json</code> to name the
members and roots. This is Deck's monorepo: a Repository Revision points to
several independently addressable package trees and one exact lock.</p>
`;

const SYSTEM = `
<p class="lede">Deck has one content-addressed foundation and two kinds of
state. Files, package trees, Versions, Repositories and Revisions are immutable
objects. Branches, tags and Review heads are small mutable pointers to those
objects. That division is the whole system.</p>

<pre class="term"><code>files on disk
     │
     │ every settled save — automatic; no commit
     ▼
package tree ──hash──┬──▶ Version ──URL──▶ Browse + Run
                     │
                     └──▶ History Step ──▶ inspect · compare · restore
                                            DAILY SAFETY

chosen package tree(s) + exact import-map lock
     │
     │ deck commit — intentional authorship
     ▼
Repository ◀── Revision ◀── branch  (mutable compare-and-swap ref)

source branch ──exact Revision──┐
                                ├──▶ Review ──preview──▶ Browse + Run
target branch ──exact Revision──┘       │
                                       └──merge──▶ new two-parent Revision
                                                        │
                                                        └──CAS──▶ target branch</code></pre>

<table class="stack"><tbody>
<tr><td><b>Package</b></td><td class="says">The independently addressable,
runnable and releasable unit. A mutable package is implicitly a repository.</td></tr>
<tr><td><b>Version</b></td><td class="says">A permanent semver name for one
package tree. Automatic <code>-dev.N</code> Versions preserve every settled
save.</td></tr>
<tr><td><b>Step</b></td><td class="says">An observed filesystem capture in a
depot History. It answers “what happened while work was in progress?”</td></tr>
<tr><td><b>Revision</b></td><td class="says">An intentional authored history
event. It points to one Repository and its parent Revisions.</td></tr>
<tr><td><b>Branch</b></td><td class="says">A named compare-and-swap ref inside
one owner and repository.</td></tr>
<tr><td><b>Fork</b></td><td class="says">The same isolation and ancestry
mechanics across an ownership boundary. Imported packages are read-only until
forked.</td></tr>
<tr><td><b>Review</b></td><td class="says">Durable metadata connecting exact
source and target Revisions, plus append-only review and merge events.</td></tr>
<tr><td><b>Repository</b></td><td class="says">The atomic collaboration state.
Usually it contains one package implicitly. A <code>repository.json</code>
exists only when several packages and their lock must advance together.</td></tr>
</tbody></table>

<p><b>Distribution stays read-only.</b> HTTP serves live and immutable package
addresses. The CLI and daemon author content-addressed objects and move refs.
Local Deck coordinates ref updates with atomic files; an S3-backed Deck uses
conditional object writes. Neither needs a Git object store.</p>

<p><b>The Hub is an inspector for this state.</b> Browse answers what exists
and which repository governs it. Run executes an exact package graph. Track
shows automatic Steps and activity. Review shows proposed Revision-to-Revision
changes and moves the target branch only after a clean merge.</p>
`;

// ─────────────────────────────────────────────────────────────────────────
// THE TWO REGISTERS, KEPT APART ON PURPOSE
//
// One list is what Deck does for any system that has files, versions and
// dependencies. The other is what it would answer for a card-based system in
// particular. They read very differently and mixing them is how a design note
// turns into a sales pitch: the general claims stop being checkable because
// they are entangled with one product's roadmap, and the specific ones start
// sounding like commitments because they are sitting next to shipped work.
//
// So: the first list is present tense and points at mechanisms in this repo.
// The second is conditional, because it is a fit argument about a system this
// repo does not contain, and every item in it is an open question until
// somebody does the work. Nothing below promises a port.
// ─────────────────────────────────────────────────────────────────────────

const ANY_SYSTEM = [
  [
    'You can go back to any earlier state',
    `Version control is below the file system, not beside it. Each save
     becomes a state that does not change, and each state has an address. To
     go back, read a different address. Nothing changes on the disk when you
     do this. You can therefore examine twenty earlier saves in safety, to
     find the save that caused a fault.`,
    '/track',
    'see the saves',
  ],
  [
    'A browser can cache an import for ever',
    `Law 4 says that an exact Version does not change. The server therefore
     marks it <code>immutable</code>, and the browser does not ask about it
     again. A second visit to the page transfers zero bytes. This is not a
     setting that somebody tuned. It is a result of the address, and the
     transfer readout in <b>run</b> prints the number of bytes to show it.`,
    '/run',
    'see 0 KB',
  ],
  [
    'You keep a copy of the libraries that you use',
    `Read the module graph of a library one time. Change its references so
     that they stay inside your own store. Then seal it. After this, the
     browser asks only your server for those modules. A policy can refuse a
     Version that the registry published less than N days ago. The record of
     the origin stays with the bytes. You can read the result in the catalog,
     as you read all other decks.`,
    '/browse',
    'read the catalog',
  ],
  [
    'Automatic history and authored history stay connected',
    `A Step is what the filesystem watcher observed on a save. A Revision is
     what a person or agent intentionally committed to a branch. Both point
     into the same content-addressed store, so review can retain the authored
     story without losing the work between commits. To combine concurrent
     work, Deck merges package trees against the exact base Revision. JSON is
     merged as data, key by key, so two additions at different keys do not
     conflict.`,
    '/track',
    'see the work',
  ],
  [
    'Install, upgrade, remix and use are four different operations',
    `In most package systems these four become one operation: copy the
     package. The differences appear later, and they are painful. In Deck the
     four stay separate. To use a deck, add one line to an import map. To
     install it, make that line an exact address. To upgrade it, change the
     address. To remix an imported package, fork it into your own publisher
     space. The import stays read-only; the fork becomes a mutable package
     repository and records the exact ancestry needed to review changes back.`,
    '/browse',
    'look at a fork',
  ],
  [
    'The server holds the authoritative copy',
    `The state that the server holds and supplies is the correct state. A
     service on the internet can hold a copy of it, but that copy is only a
     copy. This is the opposite of the usual arrangement, in which the running
     system is a product of a repository somewhere else.`,
    '/browse',
    'the depot at rest',
  ],
  [
    'You can run a contribution before you accept it',
    `A Review durably names exact source and target Revisions. Deck prepares
     the same three-way Repository merge for Preview that it will use for
     Merge, then hands the resulting exact package Versions to Run. You do not
     have to infer the assembled result from a diff. If the merge conflicts,
     Deck reports qualified package paths and advances no branch.`,
    '/review',
    'open Reviews',
  ],
  [
    'A fork copies no bytes until it differs',
    `The store keeps one copy of each file, and all decks share those copies.
     A fork that has no changes therefore uses no more space, even under a
     different publisher. A fork that changes one file uses the space of one
     file. To change one module in a library of 374 modules, store one module.`,
    '/browse',
    'a fork of one file',
  ],
  [
    'A Version can be optimised, because it will not change',
    `Work that you do one time on bytes that stay the same is work that you do
     not repeat. <code>deck derive</code> minifies a published Version and
     seals the result as a second Version, <code>&lt;v&gt;-min.0</code>, with
     its own tree hash and the dist-tag <code>production</code>. The source
     Version does not change. The record names the tool and its exact
     options, so <code>deck verify-derivation</code> runs the derivation again
     and compares the hashes. The server then compresses the result as well.
     This library went from 102 KB to 27 KB, and the browser caches it for
     ever.`,
    '/browse?at=/hub/lib/diff@9.0.0-min.0',
    'the minified Version',
  ],
  [
    'One service does the work of a registry and a CDN',
    `Publish, resolve, fetch and pin are parts of one system with one kind of
     address. Three separate services do not have to agree with each other.`,
    '/start',
    '',
  ],
  [
    'Shared definitions arrive in the import map',
    `Distribute the parts that many projects use as decks. Resolve them
     through the import map. The Version that each consumer gets is then a
     result that you can examine in one file. It is not a fact that a build
     step decided and did not record.`,
    '/browse',
    'a resolved map',
  ],
  [
    'You can watch an agent while it works',
    `Each change becomes a Step. An agent can also declare where it intends to
     work. A page that shows the result and a list that shows the changes can
     therefore both move while a person or an agent makes changes. This
     application shows a simple form of this, with a frame and the History
     scrubber. A
     system with a true preview surface can do more.`,
    '/run',
    'the running thing',
  ],
  [
    'Review tools can use more than a difference between two files',
    `A Review retains familiar source and target branch names while binding
     them to exact immutable Revisions. Its event chain records source
     updates, verdicts, merge preparation and completion. The Hub can
     therefore show files, authored history, executable preview, merge state,
     and the canonical objects underneath instead of reconstructing truth
     from two moving branch names.`,
    '/review',
    'inspect a Review',
  ],
];

// ─────────────────────────────────────────────────────────────────────────
// THE PROTOCOL SECTION EXISTS FOR SOMEBODY WHO IS NOT US.
//
// Everything else on this page explains Deck to a reader deciding whether it
// is interesting. This part is for a reader who has decided to implement it,
// and it is written to a different standard: normative, complete enough to
// disagree with, and specific about what is NOT specified.
//
// Two rules borrowed from how a protocol spec earns interoperability:
//
//   · MUST / MAY, and say which. A spec that only describes what the
//     reference implementation happens to do produces one implementation and
//     a set of bug-compatible imitations of it.
//   · The conformance suite is the real contract. Prose can be read two ways
//     and a hash cannot. Anything below that matters is checked by a law in
//     `packages/conformance`, and a second implementation is Deck when that
//     suite passes against it — not when it looks similar.
// ─────────────────────────────────────────────────────────────────────────

// Each law carries which half it governs. Eleven of the twelve are at rest,
// which is the clearest statement of where this system is finished.
const LAWS = [
  [
    'L1',
    'rest',
    'Identity',
    'Identity is <code>tree-hash-v1</code> over the logical file tree, and nothing else enters it. Not zip framing, not compression, not the order bytes landed on disk, not the version anybody attached. Paths are Unicode NFC. Two trees with the same files hash the same on every implementation, forever.',
  ],
  [
    'L2',
    'rest',
    'Round trip',
    'Packing and unpacking is lossless and byte-exact: <code>pack(unpack(P)) === P</code> for a canonical pack, and the treeHash survives the trip.',
  ],
  [
    'L3',
    'rest',
    'Pointer',
    'Versions and dist-tags name treeHashes. Naming a state copies no bytes.',
  ],
  [
    'L4',
    'rest',
    'Immutability',
    'A published exact version never changes, and re-publishing one is refused. There is no unpublish. The only way to say a version is bad is to say so <i>about</i> it.',
  ],
  [
    'L5',
    'rest',
    'Volatility',
    'A deck has exactly three kinds of address and they are different URLs: no version segment is the working tree (<code>no-store</code>), <code>@&lt;exact&gt;</code> is one sealed state (<code>immutable</code>), and a range or tag is a name that costs one short hop. Ranges never match prereleases.',
  ],
  [
    'L6',
    'rest',
    'Hermeticity',
    'A sealed deck resolves every specifier it contains — inside itself, or to a dependency it declares. Nothing reaches the live web at runtime. A deck that would need a CDN to work is refused rather than warned about.',
  ],
  [
    'L7',
    'rest',
    'Resolution',
    'Exact before range, tags before ranges, and the same answer on every implementation given the same store.',
  ],
  [
    'L8',
    'rest',
    'Provenance',
    'Where bytes came from travels with them, per version, and cannot be edited away by a later publish.',
  ],
  [
    'L9',
    'rest',
    'Endorsement',
    'Signatures are about a <b>tree hash</b>, not about a package or a version — so a fork holding the same bytes reads the same endorsements.',
  ],
  [
    'L10',
    'rest',
    'Carry-over',
    'A statement is addressed to a tree hash, so it applies wherever those exact bytes appear. Nothing is derived from a parent: the statement did not move, the content turned up in a second place.',
  ],
  [
    'L11',
    'both',
    'Fail closed',
    'An unknown answer is not a safe answer. Unverifiable provenance, an unparsable publish time, a specifier that cannot be resolved: refuse, do not warn and continue.',
  ],
  [
    'L12',
    'rest',
    'Serving',
    'The distribution surface is read-only — <code>GET</code> and <code>HEAD</code>. Every write goes through a tool that arranges state on disk; distribution follows. This is why declared activity is read from files rather than posted to an endpoint.',
  ],
];

const PROTOCOL = `
<p class="lede">This section is what a second implementation must agree with.
It is small: twelve laws, one hash, three forms of address, and a few
read-only endpoints.</p>

<p><b>Be accurate about the word "protocol".</b> Deck is an addressing scheme
and two formats, supplied over HTTP with defined cache behaviour. It defines
what a URL means, what the bytes at that URL are, and how long a client may
keep them. It does not define how one server talks to another.</p>

<p>The part that is most like a protocol is the <b>address</b>. Two programs
that agree on the grammar below, and on the cache rule for each form of
address, can exchange packages without any other agreement. The
<code>tree-hash-v1</code> algorithm and the Deck Pack are <b>formats</b>, in
the same sense that a tarball and a digest are formats. The store layout, the
command-line tool and the watcher are <b>implementation</b>, and the laws say
so: nothing requires a server to store anything the way this one does.</p>

<h3>Immutable content, durable collaboration</h3>

<p>Deck has two layers with different jobs. To collapse them makes immutable
identity look mutable and collaboration state look less durable than it is.</p>

<p><b>At rest</b> is what a byte, a tree and a Version <i>are</i>. The answer
does not change with time, with who asks, or with what anybody intends to do
next. This half is settled: the twelve laws state it, the conformance suite
examines it, and you can write a second implementation of it today.</p>

<p><b>Collaboration</b> records what people and agents do to work. Repository,
Revision, branch-ref, Pull Request opening and event formats are implemented
and tested locally. The mutable parts are deliberately small: a branch ref, a
Review head, and its event pointer. Everything they name is immutable.</p>

<p>The question that divides them is: <b>is this an object or a pointer?</b> A
tree, Repository, Revision and Review event never change. A branch or numbered
Review ref can move, but only with compare-and-swap against the value its
writer observed.</p>

<table class="stack">
<thead><tr><th></th><th>immutable objects</th><th>mutable coordination</th></tr></thead>
<tbody>
<tr><td>identity</td><td class="says">tree hash, packlist, object</td><td class="says">—</td></tr>
<tr><td>naming</td><td class="says">Version, Repository, Revision</td><td class="says">dist-tag, range, branch ref</td></tr>
<tr><td>distribution</td><td class="says">the address grammar, the cache rules</td><td class="says">—</td></tr>
<tr><td>time</td><td class="says">Step, Revision, Review event</td><td class="says">History head, branch head, Review head</td></tr>
<tr><td>provenance</td><td class="says">where bytes came from, and when</td><td class="says">—</td></tr>
<tr><td>trust</td><td class="says">an endorsement of a tree hash</td><td class="says">whose endorsements you accept</td></tr>
<tr><td>change</td><td class="says">Pull Request opening and events</td><td class="says">branch, fork, Review, merge</td></tr>
<tr><td>intent</td><td class="says">—</td><td class="says">claim</td></tr>
<tr><td>talk</td><td class="says">—</td><td class="says">note, reply</td></tr>
<tr><td>presence</td><td class="says">—</td><td class="says">activity</td></tr>
<tr><td>testing</td><td class="says">the run record, over a tree hash</td><td class="says">running the suite, and who signs the result</td></tr>
</tbody></table>

<p>The same split applies throughout: the record is immutable; the act that
produces it and the ref that selects it are mutable.</p>

<p><b>A Step is at rest.</b> It is one immutable capture with an address, and
it reads the same in a year. The watcher that makes Steps is in motion; the
Steps are not.</p>

<p><b>A signature is at rest. Signing is in motion.</b> The signature is a
durable fact: this key stood behind these exact bytes. Because it is over a
tree hash, it follows the bytes into any fork. How anybody decided to sign is
a different question with several good answers — an agent reviews the
change, a person reviews it, a group votes, somebody stakes something they
can lose, or a catalog accepts the change and the signature is what the
acceptance leaves behind. Deck defines none of those, and it should not.</p>

<p>This is what makes a signature worth having: you can let a deck run
against sensitive data because somebody you trust signed <i>the bytes that
will run</i>, and not a name that could point somewhere else tomorrow.</p>

<p><b>And it is unfinished.</b> A signing system that can only say yes is
half a system. Revocation, warning and incident — three ways of saying "no"
after the fact — are not built. They belong at rest, they must be statements
<i>about</i> a tree hash because there is no unpublish (L4), and the
freshness rule is hard because failing closed (L11) must not turn an
unreachable list into a refusal to run. Do not build anything that depends on
taking a signature back. See <code>docs/deck-at-rest.md</code> §7.</p>

<p><b>The package at-rest half is closed.</b> Do not add to it without a strong
reason: an artifact stored today must still verify under a reader written
next year. If a new idea can be expressed as data at an address, it belongs
in motion. That is how claims were built — files at a known path, read by an
ordinary <code>GET</code>, and no change to identity, naming or serving.</p>

<p><b>The collaboration object model is implemented; hosting is unfinished.</b>
Local Deck has Repository and Revision objects, compare-and-swap branches,
durable Reviews, executable previews, three-way merge, and crash recovery.
Conditional object-store adapters implement the same ref contract for S3.
What remains is production AWS wiring, identity and permissions, policy for
required reviews and checks, and transport between independently administered
servers. Those are origin concerns, not missing package identity.</p>

<p>Notes are written but not yet read back. Signing can say yes and cannot yet
say no. Automated tests as signed statements are designed and not built. See
<code>docs/deck-collaboration-protocol.md</code>,
<code>docs/deck-in-motion.md</code>, and <code>docs/deck-testing.md</code>.</p>

<h3>The shape of an address</h3>
<pre class="term"><code>/&lt;depot&gt;/&lt;publisher&gt;/&lt;package&gt;[@&lt;spec&gt;]/&lt;path&gt;
/&lt;depot&gt;/_history/&lt;changeId&gt;/&lt;publisher&gt;/&lt;package&gt;/&lt;path&gt;</code></pre>
<p>Segments beginning <code>_</code> are reserved for the protocol, which is
what keeps <code>/_packages</code> from colliding with a depot somebody
named. The publisher segment is the fork boundary. <code>&lt;spec&gt;</code>
is an exact semver, a range, or a dist-tag, and which one it is decides the
caching — see L5.</p>

<h3>The twelve laws</h3>
<p>These are normative. An implementation that breaks one is not a slower or
stricter Deck, it is a different system that will not interoperate.</p>
<table class="laws stack"><tbody>
${LAWS.map(
  ([id, half, name, text]) =>
    `<tr><td><b class="s-seal">${id}</b></td>` +
    `<td><b>${esc(name)}</b><br><span class="dim">${half === 'both' ? 'both' : 'at rest'}</span></td>` +
    `<td class="says">${text}</td></tr>`,
).join('')}
</tbody></table>

<h3>What a server MUST answer</h3>
<table><tbody>
<tr><td><code>GET /&lt;depot&gt;/&lt;pub&gt;/&lt;pkg&gt;/&lt;path&gt;</code></td><td class="dim">the live tree, <code>no-store</code></td></tr>
<tr><td><code>GET …@&lt;exact&gt;/&lt;path&gt;</code></td><td class="dim">one sealed state, <code>immutable</code>, with a content digest</td></tr>
<tr><td><code>GET …@&lt;range|tag&gt;/&lt;path&gt;</code></td><td class="dim">exactly one redirect to the exact address</td></tr>
<tr><td><code>GET …@&lt;exact&gt;?format=pack</code></td><td class="dim">the stored pack bytes, byte-exact (L2)</td></tr>
<tr><td><code>GET /_packages</code></td><td class="dim">the catalog, and the capability truth — including whether each depot has every-save History</td></tr>
</tbody></table>

<h3>What a server MAY answer</h3>
<table><tbody>
<tr><td><code>GET /&lt;depot&gt;/_history[/&lt;changeId&gt;/…]</code></td><td class="dim">every-save History, when a history backend is attached. Otherwise the depot still has Version history.</td></tr>
<tr><td><code>GET /&lt;depot&gt;/_offers</code></td><td class="dim">open proposals with their merge status</td></tr>
<tr><td><code>GET /&lt;depot&gt;/_trees/&lt;treeHash&gt;/signatures</code></td><td class="dim">endorsements, addressed by tree (L9)</td></tr>
<tr><td><code>GET /_activity</code></td><td class="dim">where work is happening, and what anyone declared</td></tr>
<tr><td><code>GET /_live/events</code></td><td class="dim">a change bus</td></tr>
</tbody></table>
<p>A client MUST treat every one of these as optional and degrade rather than
fail. The capability block in <code>/_packages</code> is how it finds out,
and a server MUST NOT report a capability it does not have (L11).</p>

<h3>What a collaboration adapter MUST preserve</h3>
<p>The HTTP distribution surface stays read-only. Collaboration writes go
through an authoring adapter, but local files and S3 objects obey the same
contract:</p>
<table class="stack"><tbody>
<tr><td><b>immutable put</b></td><td class="says">Locks, Repositories,
Revisions, Pull Request openings and events are canonical, content addressed,
and write-once.</td></tr>
<tr><td><b>conditional ref update</b></td><td class="says">A branch moves only
when its current Revision equals the writer's expected Revision. Local Deck
uses an atomic rename; S3 uses <code>If-Match</code>.</td></tr>
<tr><td><b>unique allocation</b></td><td class="says">Review numbers, openings
and new event objects use create-if-absent. Concurrent writers reread and
retry allocation; they do not overwrite.</td></tr>
<tr><td><b>recoverable merge</b></td><td class="says">Deck records the prepared
merge Revision before advancing the target branch, then records completion.
Retry completes the same merge rather than creating another.</td></tr>
<tr><td><b>preview parity</b></td><td class="says">Preview and Merge use the
same base, source, target and Repository merge engine, so an unchanged clean
preview names the state that will land.</td></tr>
</tbody></table>

<h3>What is not specified</h3>
<ul>
<li>how a server stores anything — the store layout here is one implementation of L1–L4, not part of the contract</li>
<li>which history backend provides Steps, or whether any does</li>
<li>which authoring transport exposes collaboration writes. The object and conditional-update semantics above are the contract; local CLI and hosted APIs are implementations</li>
<li>authentication and authorisation, which are a deployment’s business</li>
</ul>

<h3>The executable contract</h3>
<p>Prose can be read two ways; a hash cannot. <code>packages/conformance</code>
holds one check per law plus a golden fixture with a published hash, and it is
the definition of agreement. It also runs against an implementation that is
broken on purpose, and fails if that one passes — a suite that approves
everything approves nothing.</p>
<pre class="term"><code>node packages/cli/bin/deck.js conform ./your-depot</code></pre>
`;

const BOOK = [
  [
    'Vocabulary',
    `<p>The names come from trading-card games, because a Deck package is an
     arrangement of a shared collection. It is not a sealed box.</p>

     <p><b>Two kinds of term, and the capital letter tells you which.</b> A
     capitalised term has a Deck meaning that is narrower than the everyday
     word, so <i>Version</i> is not any version and <i>Step</i> is not any
     step. A lowercase term means what it appears to mean.</p>

     <table class="stack"><tbody>
     <tr><td><b>Version</b></td><td class="says">A published tree that does not change. A semver number addresses it.</td></tr>
     <tr><td><b>Step</b></td><td class="says">One capture of the working tree. The server records one Step for each save.</td></tr>
     <tr><td><b>History</b></td><td class="says">All the Steps of one depot, in order.</td></tr>
     <tr><td><b>Repository</b></td><td class="says">The exact package trees and lock that advance atomically. Every mutable package has an implicit one-member Repository.</td></tr>
     <tr><td><b>Revision</b></td><td class="says">An immutable authored history event pointing to one Repository and its parent Revisions.</td></tr>
     <tr><td><b>branch</b></td><td class="says">A named mutable ref to a Revision inside one owner and repository.</td></tr>
     <tr><td><b>fork</b></td><td class="says">A mutable package under a different publisher, with exact source ancestry when available.</td></tr>
     <tr><td><b>Review</b></td><td class="says">A durable proposal from one exact branch Revision to another, with append-only events, preview and merge state.</td></tr>
     <tr><td><b>Import</b></td><td class="says">A specifier that a deck asks for.</td></tr>
     <tr><td><b>Pin</b></td><td class="says">The exact address that answers an Import.</td></tr>
     <tr><td><b>Entry</b></td><td class="says">The module that a deck offers as the way into itself.</td></tr>
     <tr><td><b>Leaf</b></td><td class="says">A deck that imports nothing more.</td></tr>
     <tr><td><b>Closure</b></td><td class="says">Every module that a page reaches, directly or through another module.</td></tr>
     <tr><td><b>Deck Pack</b></td><td class="says">One tree and its packlist in one file. The file form is <code>.pack.zip</code>, and any zip tool opens it.</td></tr>
     <tr><td><b>depot</b></td><td class="says">A directory that is also a URL space.</td></tr>
     <tr><td><b>deck</b></td><td class="says">A package. It is <code>&lt;publisher&gt;/&lt;name&gt;</code>, and it has a <code>package.json</code>.</td></tr>
     <tr><td><b>publisher</b></td><td class="says">The first segment of a deck name. It is the boundary at which a fork occurs.</td></tr>
     <tr><td><b>offer</b></td><td class="says">The older package-level proposal view derived from fork lineage. New team workflows use a durable Review.</td></tr>
     <tr><td><b>tree hash</b></td><td class="says">The identity of a whole tree, calculated from its content. The code calls it <code>treeHash</code>.</td></tr>
     </tbody></table>

     <p>Three words are no longer in use. Write <b>Version</b>, <b>Step</b> or
     <b>to seal</b>, and never <i>seal</i> as a noun: it meant all three at
     once. Write <b>Step</b> and never <i>frame</i> or <i>tick</i>. Write
     <b>every-save History</b> or <b>Version history only</b>, and never <i>tier</i>.</p>`,
  ],
  [
    'The layout is the address',
    `<p>What <code>ls</code> shows and what the URL says are the same shape.
     A depot carries its machinery inside itself and the machinery is invisible
     to the tree hash, so copying the directory takes the live files, the
     published Versions and the History with it.</p>
     <pre class="term"><code>&lt;root&gt;/site/acme/palette/palette.js      on disk
       /site/acme/palette/palette.js     live — every save, no-store
       /site/acme/palette@1.1.0/palette.js
                                         a Version, immutable forever
       /site/_history/&lt;changeId&gt;/acme/palette/palette.js
                                         any Step it was ever in</code></pre>
<p><b>A depot is a package address space, not automatically a monorepo.</b>
     It may contain many unrelated packages, forks and repositories. Each
     mutable package is its own repository unless a <code>repository.json</code>
     explicitly groups several packages so one Revision can advance them and
     their lock atomically.</p>
     <ul>
     <li>A package remains the independently addressable execution and release
     boundary, even when it belongs to a multi-package Repository.</li>
     <li>The directory layout <b>is</b> the URL space, so a consumer can import
     one module from one deck without a build step that extracts it.</li>
     <li>A dependency edge means “needed to run.” Repository membership means
     “allowed to change and land atomically.” They are deliberately different.</li>
     <li>There is no workspace link step. A package depends on another by
     address, and the exact import map is the executable lock.</li>
     </ul>

     <p><b>The publisher segment is an ownership boundary.</b>
     <code>acme/palette</code> and <code>you/palette</code> are different decks
     with different version lines in one depot. That is a fork. A named ref
     such as <code>acme/palette:fix/contrast</code> stays inside the same
     repository and is shown as a branch. Both are cheap because unchanged
     objects are shared by hash.</p>`,
  ],
  [
    'Three levels of volatility',
    `<p>Each level is a value in an import map, or a form of URL. You always
     choose the level. Deck never moves you to a more volatile one.</p>
     <table class="stack"><thead><tr><th>you want</th><th>you write</th><th>you get</th></tr></thead><tbody>
     <tr><td>each save, immediately</td><td><code>"live"</code></td><td>the working tree, <code>no-store</code></td></tr>
     <tr><td>the newest automatic Version</td><td><code>"dev"</code></td><td>a short redirect to the newest <code>-dev.N</code></td></tr>
     <tr><td>a Version that will not change</td><td><code>"^1.0.0"</code></td><td>an exact Version, cached for ever</td></tr>
     </tbody></table>
     <p><code>latest</code> is a dist-tag, and it points at a stable Version.
     <b><code>latest</code> is not live.</b> Live is the bytes on the disk, and
     a live address has no version segment.</p>`,
  ],
  [
    'Versions and ranges, with examples',
    `<p>Deck uses semantic versioning. A version has three numbers and an
     optional prerelease part:</p>
     <pre class="term"><code>1.4.2          major . minor . patch
1.4.2-dev.7    the same, with a prerelease part</code></pre>

     <p>Deck adds two rules to the usual ones, and both rules protect you from
     a Version that you did not ask for.</p>

     <p><b>Rule 1. A range never matches a prerelease.</b> The automatic
     publish makes a <code>-dev.N</code> Version on each save, so a depot
     collects many prereleases. A range that matched them would move a
     consumer onto unfinished work. To use a prerelease, write its exact
     version, or use a dist-tag that points at it.</p>

     <p><b>Rule 2. A prerelease is lower than its release.</b>
     <code>1.4.0-dev.9</code> is lower than <code>1.4.0</code>, because a
     prerelease comes before the release that it prepares.</p>

     <p>These examples use a store that holds six Versions of one deck:</p>
     <pre class="term"><code>1.3.0   1.4.0-dev.1   1.4.0-dev.2   1.4.0   1.5.0-dev.1   2.0.0</code></pre>

     <table class="stack">
     <thead><tr><th>you write</th><th>you get</th><th>why</th></tr></thead>
     <tbody>
     <tr><td><code>1.4.0</code></td><td><code>1.4.0</code></td><td class="says">An exact version. Deck looks for this version and no other.</td></tr>
     <tr><td><code>1.4.0-dev.2</code></td><td><code>1.4.0-dev.2</code></td><td class="says">An exact version matches a prerelease. Rule 1 applies to ranges only.</td></tr>
     <tr><td><code>^1.0.0</code></td><td><code>1.4.0</code></td><td class="says">The highest 1.x that is not a prerelease. <code>2.0.0</code> is a different major version, so the range excludes it.</td></tr>
     <tr><td><code>~1.4.0</code></td><td><code>1.4.0</code></td><td class="says">The highest 1.4.x. The two <code>1.4.0-dev</code> Versions are prereleases, so rule 1 excludes them.</td></tr>
     <tr><td><code>^1.5.0</code></td><td><i>not found</i></td><td class="says">Only <code>1.5.0-dev.1</code> can satisfy this range, and rule 1 excludes it. Deck reports that no Version satisfies the range. Deck does not fall back to <code>1.4.0</code>.</td></tr>
     <tr><td><code>*</code></td><td><code>2.0.0</code></td><td class="says">The highest Version that is not a prerelease.</td></tr>
     <tr><td><code>latest</code></td><td>the tagged Version</td><td class="says">A dist-tag. It can point only at a stable Version, so <code>latest</code> can never be a prerelease.</td></tr>
     <tr><td><code>dev</code></td><td><code>1.5.0-dev.1</code></td><td class="says">A dist-tag that the automatic publish moves. This is how you follow the newest save without a range.</td></tr>
     <tr><td><i>no version</i></td><td>the working tree</td><td class="says">The live address. The bytes on the disk at this moment.</td></tr>
     </tbody></table>

     <p>A request for a range or a tag gets one redirect to the exact address.
     The exact address is the one that the browser caches. You therefore pay
     for the redirect one time, and each request after that is a cache
     hit.</p>

     <p>The automatic publish chooses the next name for you. It reads the
     version in your <code>package.json</code>, and it adds the next number:</p>
     <pre class="term"><code># package.json declares 1.5.0
# the store holds 1.5.0-dev.1 and 1.5.0-dev.2
# the next save publishes:
1.5.0-dev.3</code></pre>
     <p>To make the stable Version from that work, use
     <code>deck release</code>. The stable Version must agree with
     <code>package.json</code>: if it declares <code>1.5.0</code>, you can
     release <code>1.5.0</code>. To release <code>1.6.0</code>, first change
     the file. That change is one line, and it is part of the tree that you
     seal.</p>`,
  ],
  [
    'The store',
    `<p>Content-addressed <i>per file</i>, and store-wide rather than per
     package. A Version is a pointer; the tree names its files; the files are
     shared by everyone. Three consequences, all deliberate:</p>
     <ul>
     <li>publishing a tree whose bytes are already stored writes no new bytes</li>
     <li>editing one file in a 374-module deck costs one object</li>
     <li>an undiverged fork costs nothing, across publishers</li>
     </ul>
     <p>The pack is rebuilt from objects on demand rather than stored, which is
     what keeps <code>pack(unpack(P)) === P</code> byte-exact.</p>`,
  ],
  [
    'History: every save, or Versions only',
    `<p>A depot has one of two answers, and the server <b>reports</b> which
     one. It does not pretend.</p>
     <table class="stack"><tbody>
     <tr><td><b>History: Versions</b></td><td class="says">Each settled save
     becomes an immutable <code>-dev.N</code> Version. The Versions are the
     history. Always available.</td></tr>
     <tr><td><b>History: Every save</b></td><td class="says">Each save also
     becomes a Step, at
     <code>/&lt;depot&gt;/_history/&lt;changeId&gt;/…</code>, and
     <code>deck history</code> and <code>deck restore</code> work. Available
     when a history backend is attached.</td></tr>
     </tbody></table>
     <p>If the backend is absent or has stopped, the depot has Versions only.
     The server prints the reason, and the live loop continues. The depot
     table at the top of this page shows the answer for each depot.</p>`,
  ],
  [
    'Vendoring',
    `<p>Pull a module graph once, rewrite its references to stay inside the
     pack, seal it. Hermetic by default; reaching outside is an explicit
     opt-out. Identity travels as <code>vendoredFrom</code>, which is also
     where the upstream publish date comes from — so a vendored Version can say
     both when the registry published it and when this depot took it.</p>
     <pre class="term"><code>deck vendor https://esm.sh/simplex-noise@4.0.1 \\
  --name simplex-noise --version 4.0.1 \\
  --depot ./work/site --publisher acme --tag latest</code></pre>`,
  ],
  [
    'Fork, branch, Review, preview, merge',
    `<p>Contribution is exact state you can inspect and run.</p>
     <pre class="term"><code>deck fork --depot ./work/site --from acme/palette --as you/palette --use-in you/app
deck lock --depot ./work/site --publisher you --name app
deck branch --depot ./work/site --repo you/palette --name fix/contrast
deck commit --depot ./work/site --repo you/palette --branch fix/contrast --message "Improve contrast"
deck review --depot ./work/site --repo you/palette --source fix/contrast --title "Improve contrast"
deck merge --depot ./work/site --repo you/palette --number 1</code></pre>
     <p>To try another package in your app without creating durable review
     state:</p>
     <pre class="term"><code>/site/you/app/index.html?with=acme/palette=you/palette</code></pre>
     <p>The server rewrites resolution for that one request. No checkout, no
     build, and it is never cached as sealed content.</p>`,
  ],
  [
    'The HTTP surface is read-only',
    `<p>Writes go through the CLI and the watcher; the server distributes. That
     is a law, not a configuration — which is why the activity protocol reads
     claims from disk instead of accepting a POST.</p>
     <table><tbody>
     <tr><td><code>GET /&lt;depot&gt;/&lt;pub&gt;/&lt;pkg&gt;/…</code></td><td>live tree, <code>no-store</code></td></tr>
     <tr><td><code>GET …@&lt;exact&gt;/…</code></td><td>immutable, with a content digest</td></tr>
     <tr><td><code>GET …@&lt;tag|range&gt;/…</code></td><td>one hop to exact</td></tr>
     <tr><td><code>?meta</code></td><td>machine-readable listing</td></tr>
     <tr><td><code>?format=pack</code></td><td>the stored pack bytes</td></tr>
     <tr><td><code>GET /&lt;depot&gt;/_history</code></td><td>the History</td></tr>
     <tr><td><code>GET /_packages</code></td><td>catalog and capability truth</td></tr>
     <tr><td><code>GET /_activity</code></td><td>where the work is, and who declared it</td></tr>
     <tr><td><code>GET /_live/events</code></td><td>the change bus</td></tr>
     </tbody></table>`,
  ],
];

const COMPARE = `
<p class="lede">Deck does not replace all of any tool below. Deck overlaps
each tool in one area. That area is the subject of this table.</p>
<table class="fit stack"><tbody>
<tr><td><b>npm</b></td><td class="dim">A registry names versions and ships
tarballs. Deck names versions too, but the unit that travels is a
<i>tree of files you can address individually</i> — so a consumer can import
one module out of a package, and a fork can differ by one file. Deck has no
install step and no <code>node_modules</code>, because resolution happens in
the import map at request time.</td></tr>
<tr><td><b>a CDN</b></td><td class="dim">esm.sh and unpkg give you any package
at a URL, which is most of what Deck serves. The difference is who holds the
bytes: a CDN is someone else’s server that can change its mind, and vendoring
makes the same graph yours, hermetic, and diffable. Deck can be your CDN;
a CDN cannot be your registry.</td></tr>
<tr><td><b>git</b></td><td class="dim">Both keep every state. Git keeps
<i>commits you author</i> in a repository object graph. Deck keeps automatic
Steps and authored Revisions over the same content-addressed package trees,
and gives every runnable state a URL. Deck now has familiar branches, forks,
Reviews and three-way merge, but does not reproduce Git's staging area,
working-copy checkout or history-rewriting model. Its branch refs select exact
Repositories whose package trees remain directly importable.</td></tr>
<tr><td><b>a bundler</b></td><td class="dim">There isn’t one, and that is
not an omission. If you bundle, the bytes that run are not the bytes you
wrote, and every other claim here depends on those being the same. You can
still transform code. The transform has to run <i>before</i> you seal, as an
ordinary change to a file that you can read.</td></tr>
<tr><td><b>a lockfile</b></td><td class="dim"><code>deck lock</code> does the
same job — turn declared ranges into exact pins — and writes the answer into
the import map the browser already reads, rather than into a file a tool has
to interpret.</td></tr>
</tbody></table>
`;

const CLI = `
<p>Thirty-four commands in ten groups, ordered the way the work happens.
<code>deck help</code> prints this map from the command records themselves, so
it cannot drift from what exists.</p>
<table class="fit stack"><tbody>
<tr><td><b>start</b></td><td class="dim">stand a depot up and serve it live —
<code>hello</code> <code>serve</code></td></tr>
<tr><td><b>seal</b></td><td class="dim">a directory in, a verified pack out —
<code>hash</code> <code>pack</code> <code>unpack</code> <code>list</code>
<code>verify</code></td></tr>
<tr><td><b>publish</b></td><td class="dim">name sealed states —
<code>publish</code> <code>tag</code> <code>release</code> <code>prune</code>
<code>store</code> <code>derive</code> <code>verify-derivation</code></td></tr>
<tr><td><b>depend</b></td><td class="dim">what a deck uses, and which bytes
answer to it — <code>vendor</code> <code>vendor-tree</code> <code>lock</code>
<code>verify-links</code></td></tr>
<tr><td><b>repository</b></td><td class="dim">author durable collaboration
state — <code>repo-init</code> <code>branch</code> <code>commit</code>
<code>review</code> <code>merge</code></td></tr>
<tr><td><b>propose</b></td><td class="dim">materialize someone else's package
under your ownership — <code>fork</code>; inspect older package offers with
<code>offers</code> and <code>rebase</code></td></tr>
<tr><td><b>endorse</b></td><td class="dim">who stands behind these bytes —
<code>keygen</code> <code>sign</code> <code>verify-sig</code></td></tr>
<tr><td><b>recall</b></td><td class="dim">every state the depot has been in —
<code>history</code> <code>restore</code></td></tr>
<tr><td><b>prove</b></td><td class="dim">the executable contract —
<code>conform</code></td></tr>
<tr><td><b>say</b></td><td class="dim">declare work and leave durable context —
<code>claim</code> <code>note</code></td></tr>
</tbody></table>
`;

const STATUS = [
  ['tree hash, canonical zip, pack laws', 'built', 'tested'],
  ['content-addressed store, release-as-pointer, prune', 'built', 'tested'],
  ['live serve and auto-publish', 'built', 'tested'],
  ['vendoring hermetic graphs, with a cooldown policy', 'built', 'tested'],
  ['lock, fork, merge, offers, rebase', 'built', 'tested'],
  [
    'Repository, Revision and compare-and-swap branch refs',
    'built',
    'local and S3 adapters tested',
  ],
  [
    'durable Reviews, exact preview, merge and recovery',
    'built',
    'implemented and tested locally',
  ],
  [
    'single-package implicit repositories',
    'built',
    'no repository.json required',
  ],
  [
    'multi-package repository.json grouping',
    'built',
    'atomic Repository Revision and merge',
  ],
  [
    'Hub Browse and Review projections',
    'built',
    'read the same durable objects as the CLI',
  ],
  ['try-by-URL overrides', 'built', 'tested'],
  ['import-map injection and the change bus', 'built', 'tested'],
  ['history backends — Steps and restore', 'built', 'attaches when available'],
  ['publish times, local and upstream', 'built', 'tested'],
  ['the activity protocol — touch and declared claims', 'built', 'tested'],
  ['signatures on tree hashes', 'built', 'tested'],
  [
    'minified derived Versions, and compression',
    'built',
    'reproducible: verify-derivation re-runs it and compares hashes',
  ],
  [
    'cross-depot dependency pins',
    'not built',
    'lock refuses them rather than guessing',
  ],
  [
    'notes and replies on a tree hash',
    'not built',
    'deck note writes them; /track does not read them',
  ],
  [
    'revocation, warning, incident',
    'not built',
    'a signature can say yes and cannot yet say no — deck-at-rest.md §7',
  ],
  [
    'test runs as signed statements',
    'not built',
    'designed in deck-testing.md',
  ],
  [
    'production S3 credentials and Hub wiring',
    'not built',
    'conditional object-store contracts are tested',
  ],
  [
    'identity, permissions, required checks and review policy',
    'not built',
    'formats exist; enforcement does not',
  ],
  [
    'federation between independently administered servers',
    'not built',
    'no remote Review transport yet',
  ],
];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function section(id, number, title, body) {
  return (
    `<section class="doc" id="${esc(id)}">` +
    `<h2><span class="doc-n">${number}</span>${esc(title)}</h2>` +
    body +
    `</section>`
  );
}

const DECK_MARK = `
██████╗ ███████╗ ██████╗██╗  ██╗
██╔══██╗██╔════╝██╔════╝██║ ██╔╝
██║  ██║█████╗  ██║     █████╔╝ 
██║  ██║██╔══╝  ██║     ██╔═██╗ 
██████╔╝███████╗╚██████╗██║  ██╗
╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝
`.trim();

/**
 * `state` may be undefined, and that is the normal first call.
 *
 * NINE TENTHS OF THIS PAGE IS WRITING, AND WRITING NEEDS NO DATA. Building
 * the whole document behind `await now()` meant thirteen requests had to land
 * before a single word appeared — so any one of them being slow rendered as
 * `loading…` for ever, which is indistinguishable from broken and was in fact
 * how this page spent its first hour.
 *
 * The prose paints immediately. The two things that are genuinely live — the
 * counts and the depot table — arrive when they arrive, and say so meanwhile.
 * A page that is readable in 40ms and complete in two seconds beats one that
 * is nothing at all until everything is ready.
 */
function view(state) {
  let benefit = ANY_SYSTEM.map(
    ([title, body, href, cta]) =>
      `<li class="ben">` +
      `<b>${esc(title)}</b>` +
      `<p>${body}</p>` +
      (cta ? `<a href="${esc(href)}">${esc(cta)} →</a>` : '') +
      `</li>`,
  ).join('');

  let book = BOOK.map(
    ([title, body]) =>
      `<section class="doc-sub"><h3>${esc(title)}</h3>${body}</section>`,
  ).join('');

  let status = STATUS.map(
    ([area, state_, note]) =>
      `<tr><td><b>${esc(area)}</b></td>` +
      `<td class="${state_ === 'built' ? 'ok' : 'todo'}">${esc(state_)}</td>` +
      `<td class="dim">${esc(note)}</td></tr>`,
  ).join('');

  // The sections, declared once. The table of contents is DERIVED from this
  // list rather than written beside it — a hand-kept contents page is a
  // second copy of the structure, and the two disagree the first time
  // somebody adds a section and forgets.
  // HEADINGS SAY WHAT THE SECTION IS.
  //
  // These are read out of context, down the left edge of a contents list, by
  // somebody deciding whether to click. So they describe rather than label —
  // "What is built and what is not" over "Status" — and front-load the
  // distinguishing word, because a contents list is scanned, not read.
  let sections = [
    [
      'now',
      'What this server is running right now',
      `<div data-role="now">${
        state
          ? depotTable(state) + activeNote(state)
          : `<p class="dim">reading the depots…</p>`
      }</div>`,
    ],
    ['system', 'How the whole Deck system fits together', SYSTEM],
    [
      'quickstart',
      'Quickstart: run, branch, review and merge',
      QUICKSTART +
        // Said here, not in a closing section, because this is the paragraph
        // a reader has their hands on the keyboard for.
        `<p class="lede"><b>Deck is not on npm.</b> A different package has
         that name. There is no <code>npx</code> command for Deck, and there
         will not be one. Install Deck from this repository, as
         <code>INSTALL.md</code> describes.</p>`,
    ],
    [
      'any',
      'What Deck gives any system',
      `<p class="lede">Each item below is a mechanism in this repository. No item
       is a plan. Each link goes to the place where you can examine the
       item.</p>` + `<ul class="bens">${benefit}</ul>`,
    ],
    ['protocol', 'The protocol: content, collaboration and hosting', PROTOCOL],
    ['compare', 'How Deck differs from npm, CDNs, git and bundlers', COMPARE],
    ['book', 'Reference: vocabulary, addressing, storage, history', book],
    ['cli', 'Command reference', CLI],
    [
      'status',
      'What is built, and what is not',
      `<p class="lede">This table shows what is built and what is not. A test or
       the conformance suite examines each item that this page says is
       built.</p>` +
        `<table class="fit stack"><tbody>${status}</tbody></table>`,
    ],
  ];

  let toc = sections
    .map(
      ([id, title], index) =>
        `<a href="#${esc(id)}" data-toc="${esc(id)}">` +
        `<i>${index + 1}</i>${esc(title)}</a>`,
    )
    .join('');

  return (
    // TWO COLUMNS ON A WIDE SCREEN, ONE EVERYWHERE ELSE.
    //
    // A contents rail is the right control for a page this long — it says how
    // much there is, which is the thing a scrollbar on a 4000px document tells
    // you far too late. But it is a convenience, not the content, so on a
    // narrow screen it collapses into a disclosure rather than eating a third
    // of the width or turning into a horizontal scroller nobody scrolls.
    //
    // `<details>` and not a scripted menu: it opens without JavaScript, it is
    // focusable and announced by a screen reader for free, and the browser
    // already knows how to draw the state.
    // Same lattice as browse / run / track — one face, one size, no prose scale.
    `<div class="start">` +
    // OPEN BY DEFAULT ON A WIDE SCREEN, AND IT HAS TO BE THE ATTRIBUTE.
    //
    // A closed `<details>` hides its children in the browser's own shadow
    // layout — `display: flex` on the `<nav>` does not bring them back, which
    // is why the rail rendered as an empty 26ch gutter. The open state is the
    // attribute or it is nothing.
    //
    // So the width decides the initial state: open where there is room for a
    // rail, closed where it would push the content off the first screen. It
    // stays a disclosure either way, so a phone reader can still get the
    // contents and a desktop reader can still collapse it.
    `<details class="toc" data-role="toc"${WIDE.matches ? ' open' : ''}>` +
    `<summary>contents</summary>` +
    `<nav>${toc}` +
    `<a class="toc-out" href="/deckbook">deckbook</a>` +
    `</nav>` +
    `</details>` +
    `<main class="start-main" data-role="main">` +
    `<header class="hero">` +
    `<p class="prompt"><span class="prompt-mark">hub</span>start</p>` +
    `<pre class="deck-mark" role="img" aria-label="DECK">${DECK_MARK}</pre>` +
    `<h1>version management without the commit<br>` +
    `package management without the install<br>` +
    `code collaboration without the clone<br>` +
    `cloud delivery without the deploy</h1>` +
    `<div class="doors">` +
    `<a class="here" href="/deckbook">deckbook</a>` +
    `<button type="button" data-role="tour">walk the stories</button>` +
    `</div>` +
    `<p class="lede"><b>Every save is kept.</b> After a short quiet period,
     Deck gives the package tree an immutable automatic Version. When a
     every-save History is attached, the same save is also an ordered Step: the exact
     depot state, when it happened, and which files changed. You can inspect,
     run, compare and restore work that was never committed. A later
     <code>deck commit</code> does a different job: it turns chosen package
     state into an authored Repository Revision for branch and Review
     history.</p>` +
    // The unifying assumption, before any mechanism. Four claims that each
    // sound like a separate trick are one claim said three times, and a
    // reader who does not get that in the second paragraph reads the rest as
    // a feature list.
    `<p class="lede">One foundation makes all four true: files and package
     trees are named by their content and reachable at URLs. Versions,
     Repositories and Revisions name immutable state above those trees.
     Branches, tags and Review heads are the small mutable pointers. Execution,
     distribution and collaboration therefore share one address space instead
     of copying code through a repository, package registry and deployment
     system that each names it differently.</p>` +
    // The same claim again, in the reader's own vocabulary. The grouping is
    // The argument is the separation between immutable objects and the small
    // mutable refs that select them. Familiar workflow nouns stay distinct,
    // even when they share content-addressed mechanics underneath.
    `<dl class="isjust">` +
    [
      [
        'Every settled save becomes',
        'an immutable automatic Version and—when attached—an ordered Step in History.',
      ],
      [
        'A commit becomes',
        'an authored immutable Revision pointing to exact Repository state.',
      ],
      [
        'A version, a tag, a release, a staging environment are just',
        'pointers to one of those hashes. Moving a pointer copies nothing.',
      ],
      [
        'An import, an install, a lockfile, <code>node_modules</code> are just',
        'an address in an import map, written into a file you can read.',
      ],
      [
        'A mutable package is',
        'already a one-package repository. No initialization file is required.',
      ],
      ['A branch is', 'a named ref inside the same owner and repository.'],
      [
        'A fork is',
        'a mutable package under another publisher, sharing unchanged objects' +
          ' and recording exact ancestry when the source is mutable.',
      ],
      [
        'A Review is',
        'durable source-to-target metadata bound to exact Revisions and an' +
          ' append-only event history.',
      ],
      [
        'A preview is',
        'the exact proposed Repository projected into package Versions and run' +
          ' through the ordinary resolver. <code>?with=</code> remains the' +
          ' temporary substitution mechanism, not Review identity.',
      ],
      [
        'A merge is',
        'a three-way merge of base, target and source Repositories, followed by' +
          ' one compare-and-swap move of the target branch.',
      ],
      [
        'A revert, a rollback, a checkout are just',
        'reading a different address. Nothing on disk changes.',
      ],
      [
        'A build, a bundle, a deploy, a CDN are just',
        'absent — except the bundle, which is another version derived from the' +
          ' first, at its own address.',
      ],
    ]
      .map(([term, is]) => `<dt>${term}</dt><dd>${is}</dd>`)
      .join('') +
    `</dl>` +
    `<p class="lede">The workflow nouns remain useful because they express
     ownership, intent and mergeability. Deck unifies their storage mechanics,
     not their meaning. A branch and a fork are both cheap refs over shared
     content, but only a fork crosses ownership. A Review uses runnable content,
     but it remains durable coordination rather than a query parameter.</p>` +
    `<p class="lede">What Deck specifies is small: the grammar of the address,
     the bytes that the address supplies, and how long a client may keep them.
     Twelve laws state it, and a test suite examines them. This server and its
     command-line tool are one implementation. If a different implementation
     obeys the test suite, that implementation is also Deck.</p>` +
    `<p class="lede">The four working views ask different questions about the
     same state. Browse asks what exists and who governs it. Run asks what an
     exact graph does. Track asks what happened while it changed. Review asks
     what is proposed, what exact state was examined, and whether it merged.
     The views are decks supplied from the store they inspect.</p>` +
    statLine(state) +
    `</header>` +
    sections
      .map(([id, title, body], index) => section(id, index + 1, title, body))
      .join('') +
    `</main></div>`
  );
}

/**
 * Mark the section you are in, the way the nav marks the app you are in.
 *
 * `rootMargin` pulls the observation band up to just under the sticky header,
 * so the heading that is actually at the top of the readable area is the one
 * that lights — not whichever section happens to intersect the viewport
 * somewhere, which on a long page is usually three of them at once.
 */
function trackSections() {
  let links = new Map(
    [...app.querySelectorAll('[data-toc]')].map((a) => [a.dataset.toc, a]),
  );
  if (!links.size) return;
  let seen = new Set();
  let observer = new IntersectionObserver(
    (entries) => {
      for (let entry of entries) {
        if (entry.isIntersecting) seen.add(entry.target.id);
        else seen.delete(entry.target.id);
      }
      let first = [...links.keys()].find((id) => seen.has(id));
      for (let [id, link] of links) {
        link.dataset.here = id === first ? '1' : '0';
      }
    },
    { rootMargin: '-15% 0px -70% 0px' },
  );
  for (let id of links.keys()) {
    let target = document.getElementById(id);
    if (target) observer.observe(target);
  }
}

/** The document. Synchronous, no network, first paint. */
function paint() {
  app.innerHTML = view(undefined);
  trackSections();
  wrapTables(app);
  highlight(app);
  keys.keys = [
    [['1', '4'], 'apps'],
    ['g', 'top'],
    ['t', 'theme'],
  ];
}

/**
 * The live half, patched into the two places that hold it.
 *
 * Replacing the whole document would throw away the reader's scroll position
 * every fifteen seconds — on a page this long, that is the difference between
 * a dashboard and a page that fights you. Two `innerHTML` writes into two
 * known slots, and everything else on screen is left exactly where it was.
 */
async function fillNow() {
  let state;
  try {
    state = await now();
  } catch (error) {
    let slot = app.querySelector('[data-role="now"]');
    if (slot) {
      slot.innerHTML = `<div class="err"><b>error</b> — ${esc(error.message)}</div>`;
    }
    return;
  }
  let paint = () => {
    let stats = app.querySelector('[data-role="stats"]');
    if (stats) stats.outerHTML = statLine(state);
    let slot = app.querySelector('[data-role="now"]');
    if (slot) slot.innerHTML = depotTable(state) + activeNote(state);
    wrapTables(app);
  };
  // Packages first — table on screen — then claims without blocking.
  paint();
  try {
    await enrichNow(state);
    paint();
  } catch {
    // Claims are decoration; the table already answered "what is mounted".
  }
}

addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  let tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (event.key === 'g') scrollTo({ top: 0 });
});

// NOT ON EVERY CHANGE. This page is the expensive one.
//
// A render here is thirteen-odd requests — the catalog, activity, and one
// History per depot — and `onLiveChange` fires about once a second while
// somebody is editing. Wiring those together meant a render was always in
// progress, the next one queued before it finished, and the page never
// settled: permanently "loading…", server at nothing, nothing thrown. The
// same starvation as before, arriving by a different road.
//
// A dashboard of counts does not need second-by-second truth, and the parts
// that DO move that fast — the live badge, the active list — are the nav's
// job and update on their own. Fifteen seconds, and never two at once.
const REFRESH_MS = 15_000;
let filling = false;

async function refresh() {
  if (filling) return;
  filling = true;
  try {
    await fillNow();
  } finally {
    filling = false;
  }
}

paint();
mountTourButton(app);
resumeHubTour({ waitMs: 120 });
refresh();
setInterval(refresh, REFRESH_MS);

// Crossing the breakpoint changes which state the rail SHOULD start in, and
// the attribute was decided once at paint. Only the default is moved — if the
// reader has opened or closed it themselves, that is their answer and resizing
// a window is not a request to overrule it.
let touched = false;
app.addEventListener(
  'toggle',
  (event) => {
    if (event.target.matches?.('[data-role="toc"]')) touched = true;
  },
  true,
);
WIDE.addEventListener('change', (event) => {
  if (touched) return;
  let toc = app.querySelector('[data-role="toc"]');
  if (toc) toc.open = event.matches;
});

// Same lattice as the four working views. One face, one size, colour only where it
// means something. The mark is ASCII because this is a terminal; the Deckbook
// door is inverse because that is how this surface says "go here" — the same
// fill as the current nav tab.
const START_CSS = `
.start { display: block; max-width: 108ch; }
.start h2, .start h3 {
  font-size: 1em; font-weight: 600; color: var(--fg);
  margin: calc(var(--row) * 1.2em) 0 calc(var(--row) * .3em);
}
.start h2:first-child, .start h3:first-child { margin-top: 0; }
.start .lede { color: var(--dim); max-width: 88ch; }
.start pre.term {
  background: var(--panel); padding: calc(var(--row) * .4em) 1.5ch;
  overflow-x: auto; margin: calc(var(--row) * .8em) 0;
}
.start td.says, .start td.ok, .start td.todo { white-space: normal; max-width: 64ch; }
.start td.ok { color: var(--green); font-weight: 600; }

.hero { padding: calc(var(--row) * .6em) 0 calc(var(--row) * 1.4em); }
.deck-mark {
  margin: 0 0 calc(var(--row) * .8em);
  font-family: var(--mono); font-size: 15px; line-height: 1.05;
  color: var(--fg); overflow-x: auto; user-select: none;
  white-space: pre;
}
.hero .prompt { padding-top: 0; color: var(--dim); }
.hero h1 {
  font-size: 1em; font-weight: 400; color: var(--fg);
  max-width: none; margin: 0 0 calc(var(--row) * .8em);
  line-height: var(--row);
}

/* Same gesture as .deck-nav-here — filled chip, package hue, no box. */
.doors {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 0;
  margin: 0 0 calc(var(--row) * 1em);
}
.doors .here, .doors button {
  font: inherit; padding: 0 1ch; margin-right: 1ch;
}
.doors .here {
  background: var(--a-package); color: var(--bg); font-weight: 600;
  text-decoration: none;
}
.doors .here:hover {
  background: var(--fg); color: var(--bg); text-decoration: none;
}
.doors button {
  cursor: pointer; background: none; color: var(--dim); border: 0;
}
.doors button:hover { color: var(--fg); background: var(--sel); }

.start .isjust { max-width: 88ch; margin: calc(var(--row) * .8em) 0; }
.start .isjust dt { font-weight: 600; margin-top: calc(var(--row) * .5em); }
.start .isjust dt:first-child { margin-top: 0; }
.start .isjust dd { margin: 0; color: var(--dim); }
@media (min-width: 60rem) {
  .start .isjust {
    max-width: none;
    display: grid;
    grid-template-columns: minmax(0, 42ch) minmax(0, 1fr);
    column-gap: 3ch; align-items: baseline;
  }
  .start .isjust dt, .start .isjust dd {
    margin-top: 0; padding: calc(var(--row) * .2em) 0;
    border-top: 1px solid var(--line);
  }
  .start .isjust dt:first-of-type,
  .start .isjust dt:first-of-type + dd { border-top: none; }
}

.stats {
  display: flex; flex-wrap: wrap; gap: .2em 2.5ch;
  padding: calc(var(--row) * .6em) 0 0; margin-top: calc(var(--row) * .6em);
  border-top: 1px solid var(--line);
}
.stat {
  display: flex; align-items: baseline; gap: .8ch; text-decoration: none;
}
.stat b {
  color: var(--a-package); font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.stat span { color: var(--dim); }
.stat:hover b, .stat:hover span { color: var(--fg); }

.doc { padding-top: calc(var(--row) * 1.6em); border-top: 1px solid var(--line); }
.doc:first-of-type { border-top: none; }
.doc > h2 { margin-top: 0; }
.doc-n {
  display: inline-block; min-width: 2.4ch; text-align: center;
  background: var(--fg); color: var(--bg);
  font-size: .82em; font-weight: 600;
  padding: .1em .5ch; margin-right: 1.5ch;
  vertical-align: .15em;
}
.doc-sub { padding-top: calc(var(--row) * .6em); }

.bens { list-style: none; padding: 0; margin: 0; }
.ben { padding: calc(var(--row) * .6em) 0; border-bottom: 1px solid var(--line); max-width: 88ch; }
.ben:last-child { border-bottom: none; }
.ben > b { display: block; margin-bottom: 4px; }
.ben p { color: var(--dim); margin: 0 0 calc(var(--row) * .3em); }
.ben a { color: var(--a-package); }
.todo { color: var(--a-live); font-weight: 600; }

ul.plain { list-style: none; padding: 0; margin: 0; }
ul.plain li { margin-bottom: 4px; }

.toc summary {
  cursor: pointer; color: var(--dim); list-style: none;
  padding: calc(var(--row) * .3em) 0;
}
.toc summary::-webkit-details-marker { display: none; }
.toc summary::before { content: '▸ '; }
.toc[open] summary::before { content: '▾ '; }
.toc nav { display: flex; flex-direction: column; padding-bottom: calc(var(--row) * .6em); }
.toc a {
  display: flex; gap: 1.2ch; text-decoration: none; color: var(--dim);
  padding: calc(var(--row) * .15em) 0; line-height: 1.35;
}
.toc a i {
  font-style: normal; opacity: .55; min-width: 2ch;
  font-variant-numeric: tabular-nums;
}
.toc a:hover { color: var(--fg); }
.toc a[data-here='1'] { color: var(--fg); font-weight: 600; }
.toc a[data-here='1'] i { opacity: 1; color: var(--a-package); }

/* Same fill as the current nav tab — a destination, not a footnote. */
.toc-out {
  margin-top: calc(var(--row) * .6em);
  padding: 0 1ch !important;
  align-self: start;
  width: max-content;
  background: var(--a-package); color: var(--bg) !important; font-weight: 600;
  border-top: 0;
}
.toc-out:hover {
  background: var(--fg); color: var(--bg) !important; text-decoration: none;
}

@media (min-width: 62rem) {
  .start {
    display: grid; grid-template-columns: 30ch minmax(0, 1fr); gap: 4ch;
    align-items: start; max-width: none;
  }
  .toc {
    position: sticky; top: calc(var(--row) * .8em);
    max-height: 86vh; overflow-y: auto;
  }
  .toc summary { display: none; }
}

@media (max-width: 40rem) {
  .deck-mark { font-size: 10px; }
  .stats { gap: .2em 1.5ch; }
  .doc { padding-top: calc(var(--row) * 1.1em); }
}
`;

let style = document.createElement('style');
style.textContent = START_CSS;
document.head.append(style);
