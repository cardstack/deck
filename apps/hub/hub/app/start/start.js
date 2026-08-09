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
// A tour. Every section here is short and ends in a link into /browse, /run
// or /track, because reading about a runnable thing when the runnable thing
// is one click away is the worst of both.
//
// The long-form book still exists at /deckbook — captured transcripts, worked
// use cases, the full CLI walkthrough. That page is a document. This one is
// an instrument, and it is the one that has to be true right now.
import 'ui/nav';
import { installNavStyles, wrapTables } from 'ui/nav';
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

async function now() {
  let [packages, activity] = await Promise.all([
    getJson('/_packages').catch(() => ({ data: [] })),
    getJson('/_activity?top=200&grain=file').catch(() => ({ foci: [] })),
  ]);
  let depots = packages.data ?? [];

  // Steps come per depot and only where a history backend attached. A depot
  // without one is not broken — its Versions ARE its history — so
  // it reports no Timeline rather than zero Steps, which would be a lie
  // about a tape that does not exist.
  //
  // ONE AT A TIME, not `Promise.all`. Twelve depots is twelve requests, a
  // browser allows six per origin, and one of those six is already spent on
  // the SSE stream that makes this page live. Firing them together does not
  // make them finish sooner — they queue in the browser instead of on the
  // server — and it takes every connection the page has, so anything else it
  // needs is stuck behind a fan-out that exists only to fill a table.
  //
  // Sequential is slower in the best case and the only one that cannot starve
  // the page in the worst.
  let timelines = [];
  for (let depot of depots) {
    if (!depot.history) {
      timelines.push({ depot: depot.name, steps: undefined });
      continue;
    }
    let body = await getJson(`/${depot.name}/_history`).catch(() => undefined);
    let steps = body?.data?.map((step) => step.attributes) ?? [];
    timelines.push({
      depot: depot.name,
      steps: steps.length,
      newest: steps[0]?.timestamp,
    });
  }
  let tape = new Map(timelines.map((row) => [row.depot, row]));

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
  let claims = (activity.foci ?? []).flatMap((focus) =>
    (focus.claims ?? []).map((claim) => ({ ...claim, at: focus.id })),
  );
  let steps = timelines.reduce((sum, row) => sum + (row.steps ?? 0), 0);

  return { depots, tape, decks, versions, vendored, live, claims, steps, newestVersion };
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
      .map(
        ([value, label, href]) =>
          `<a class="stat" href="${esc(href)}">` +
          `<b>${value}</b><span>${esc(label)}</span></a>`,
      )
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
              `${tape?.steps ?? 0} Step${tape?.steps === 1 ? '' : 's'}</a>` +
              (tape?.newest ? ` <span class="dim">· ${esc(ago(tape.newest))}</span>` : '')
            : `<span class="dim">Versions only — no Timeline</span>`
        }</td>` +
        `<td><a href="/run?at=/${esc(depot.name)}">run →</a></td>` +
        `</tr>`
      );
    })
    .join('');
  return (
    `<table><thead><tr>` +
    `<th>depot</th><th class="num">decks</th><th class="num">live</th>` +
    `<th>Timeline</th><th></th>` +
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
node packages/cli/bin/deck.js serve --root ./work --history auto</code></pre>

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
     timeline in <b>run</b> prints the number of bytes to show it.`,
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
    'There is one kind of checkpoint',
    `Many systems have three kinds: the undo in the editor, the milestone in
     the tool, and the commit in the version control. Deck has one, and it is
     the Step. To combine work that two people did at the same time, Deck
     merges the two trees against the base tree that both started from. Deck
     merges JSON as data, key by key. Two people who add different keys
     therefore do not make a conflict.`,
    '/track',
    'see a merge',
  ],
  [
    'Install, upgrade, remix and use are four different operations',
    `In most package systems these four become one operation: copy the
     package. The differences appear later, and they are painful. In Deck the
     four stay separate. To use a deck, add one line to an import map. To
     install it, make that line an exact address. To upgrade it, change the
     address. To remix it, fork the deck into your own publisher space; the
     fork records the tree that it came from, so you can offer your changes
     back.`,
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
    `A proposal is a fork that records the tree that it came from. A proposal
     is therefore a Version, and you can run it. You do not have to imagine
     the result of a difference between two files. Deck merges the clean
     proposals. If a merge has a conflict, Deck reports the conflict and
     changes nothing, because a machine that damages the work of a
     contributor is worse than a machine that stops.`,
    '/track?kind=proposed,conflicted',
    'open proposals',
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
     application shows a simple form of this, with a frame and a timeline. A
     system with a true preview surface can do more.`,
    '/run',
    'the running thing',
  ],
  [
    'Review tools can use more than a difference between two files',
    `The protocol records who did the work, what they declared before they
     started, what they wrote afterwards, and which tree each statement is
     about. It identifies the tree by its content, not by the name of a
     branch. A review tool that reads this has more to show than two columns
     of text. This application shows the simple form: a review of several
     files, marks on the words that changed, and hidden lines that you can
     open.`,
    '/browse',
    'a review',
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

const LAWS = [
  ['L1', 'Identity', 'Identity is <code>tree-hash-v1</code> over the logical file tree, and nothing else enters it. Not zip framing, not compression, not the order bytes landed on disk, not the version anybody attached. Paths are Unicode NFC. Two trees with the same files hash the same on every implementation, forever.'],
  ['L2', 'Round trip', 'Packing and unpacking is lossless and byte-exact: <code>pack(unpack(P)) === P</code> for a canonical pack, and the treeHash survives the trip.'],
  ['L3', 'Pointer', 'Versions and dist-tags name treeHashes. Naming a state copies no bytes.'],
  ['L4', 'Immutability', 'A published exact version never changes, and re-publishing one is refused. There is no unpublish. The only way to say a version is bad is to say so <i>about</i> it.'],
  ['L5', 'Volatility', 'A deck has exactly three kinds of address and they are different URLs: no version segment is the working tree (<code>no-store</code>), <code>@&lt;exact&gt;</code> is one sealed state (<code>immutable</code>), and a range or tag is a name that costs one short hop. Ranges never match prereleases.'],
  ['L6', 'Hermeticity', 'A sealed deck resolves every specifier it contains — inside itself, or to a dependency it declares. Nothing reaches the live web at runtime. A deck that would need a CDN to work is refused rather than warned about.'],
  ['L7', 'Resolution', 'Exact before range, tags before ranges, and the same answer on every implementation given the same store.'],
  ['L8', 'Provenance', 'Where bytes came from travels with them, per version, and cannot be edited away by a later publish.'],
  ['L9', 'Endorsement', 'Signatures are about a <b>tree hash</b>, not about a package or a version — so a fork holding the same bytes reads the same endorsements.'],
  ['L10', 'Inheritance', 'A fork inherits what was true of the bytes, because the statements were addressed to the bytes.'],
  ['L11', 'Fail closed', 'An unknown answer is not a safe answer. Unverifiable provenance, an unparsable publish time, a specifier that cannot be resolved: refuse, do not warn and continue.'],
  ['L12', 'Serving', 'The distribution surface is read-only — <code>GET</code> and <code>HEAD</code>. Every write goes through a tool that arranges state on disk; distribution follows. This is why declared activity is read from files rather than posted to an endpoint.'],
];

const PROTOCOL = `
<p class="lede">Deck is a protocol, not a product — the same way Matrix is a
protocol with a reference server. What follows is what a second
implementation has to agree with. It is small: twelve laws, one
hash, three address forms and a handful of read-only endpoints.</p>

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
  ([id, name, text]) =>
    `<tr><td><b class="s-seal">${id}</b></td>` +
    `<td><b>${esc(name)}</b></td><td class="dim">${text}</td></tr>`,
).join('')}
</tbody></table>

<h3>What a server MUST answer</h3>
<table><tbody>
<tr><td><code>GET /&lt;depot&gt;/&lt;pub&gt;/&lt;pkg&gt;/&lt;path&gt;</code></td><td class="dim">the live tree, <code>no-store</code></td></tr>
<tr><td><code>GET …@&lt;exact&gt;/&lt;path&gt;</code></td><td class="dim">one sealed state, <code>immutable</code>, with a content digest</td></tr>
<tr><td><code>GET …@&lt;range|tag&gt;/&lt;path&gt;</code></td><td class="dim">exactly one redirect to the exact address</td></tr>
<tr><td><code>GET …@&lt;exact&gt;?format=pack</code></td><td class="dim">the stored pack bytes, byte-exact (L2)</td></tr>
<tr><td><code>GET /_packages</code></td><td class="dim">the catalog, and the capability truth — including whether each depot has a Timeline</td></tr>
</tbody></table>

<h3>What a server MAY answer</h3>
<table><tbody>
<tr><td><code>GET /&lt;depot&gt;/_history[/&lt;changeId&gt;/…]</code></td><td class="dim">the Timeline, when a history backend is attached. Absence means the depot has Versions only. It is not an error.</td></tr>
<tr><td><code>GET /&lt;depot&gt;/_offers</code></td><td class="dim">open proposals with their merge status</td></tr>
<tr><td><code>GET /&lt;depot&gt;/_trees/&lt;treeHash&gt;/signatures</code></td><td class="dim">endorsements, addressed by tree (L9)</td></tr>
<tr><td><code>GET /_activity</code></td><td class="dim">where work is happening, and what anyone declared</td></tr>
<tr><td><code>GET /_live/events</code></td><td class="dim">a change bus</td></tr>
</tbody></table>
<p>A client MUST treat every one of these as optional and degrade rather than
fail. The capability block in <code>/_packages</code> is how it finds out,
and a server MUST NOT report a capability it does not have (L11).</p>

<h3>What is not specified</h3>
<ul>
<li>how a server stores anything — the store layout here is one implementation of L1–L4, not part of the contract</li>
<li>which history backend provides Steps, or whether any does</li>
<li>how writes happen. L12 says the distribution surface is read-only; it does not say what arranges the bytes</li>
<li>authentication and authorisation, which are a deployment’s business</li>
</ul>

<h3>The executable contract</h3>
<p>Prose can be read two ways; a hash cannot. <code>packages/conformance</code>
holds one check per law plus a golden fixture with a published hash, and it is
the definition of agreement. It also examines a broken
implementation is caught, so a suite that passes everything is itself a
failure.</p>
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
     <tr><td><b>Timeline</b></td><td class="says">All the Steps of one depot, in order.</td></tr>
     <tr><td><b>Import</b></td><td class="says">A specifier that a deck asks for.</td></tr>
     <tr><td><b>Pin</b></td><td class="says">The exact address that answers an Import.</td></tr>
     <tr><td><b>Entry</b></td><td class="says">The module that a deck offers as the way into itself.</td></tr>
     <tr><td><b>Leaf</b></td><td class="says">A deck that imports nothing more.</td></tr>
     <tr><td><b>Closure</b></td><td class="says">Every module that a page reaches, directly or through another module.</td></tr>
     <tr><td><b>Deck Pack</b></td><td class="says">One tree and its packlist in one file. The file form is <code>.pack.zip</code>, and any zip tool opens it.</td></tr>
     <tr><td><b>depot</b></td><td class="says">A directory that is also a URL space.</td></tr>
     <tr><td><b>deck</b></td><td class="says">A package. It is <code>&lt;publisher&gt;/&lt;name&gt;</code>, and it has an <code>importmap.json</code>.</td></tr>
     <tr><td><b>publisher</b></td><td class="says">The first segment of a deck name. It is the boundary at which a fork occurs.</td></tr>
     <tr><td><b>offer</b></td><td class="says">A fork that records the tree it came from. You can run an offer.</td></tr>
     <tr><td><b>tree hash</b></td><td class="says">The identity of a whole tree, calculated from its content. The code calls it <code>treeHash</code>.</td></tr>
     </tbody></table>

     <p>Three words are no longer in use. Write <b>Version</b>, <b>Step</b> or
     <b>to seal</b>, and never <i>seal</i> as a noun: it meant all three at
     once. Write <b>Step</b> and never <i>frame</i> or <i>tick</i>. Write
     <b>Timeline</b> or <b>Versions only</b>, and never <i>tier</i>.</p>`,
  ],
  [
    'The layout is the address',
    `<p>What <code>ls</code> shows and what the URL says are the same shape.
     A depot carries its machinery inside itself and the machinery is invisible
     to the tree hash, so copying the directory takes the live files, the
     published Versions and the Timeline with it.</p>
     <pre class="term"><code>&lt;root&gt;/site/acme/palette/palette.js      on disk
       /site/acme/palette/palette.js     live — every save, no-store
       /site/acme/palette@1.1.0/palette.js
                                         a Version, immutable forever
       /site/_history/&lt;changeId&gt;/acme/palette/palette.js
                                         any Step it was ever in</code></pre>
     <p><b>The publisher segment is the fork boundary.</b>
     <code>acme/palette</code> and <code>you/palette</code> are different decks
     with different version lines in one depot, and an undiverged fork costs no
     extra bytes.</p>`,
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
     version in your import map, and it adds the next number:</p>
     <pre class="term"><code># importmap.json declares 1.5.0
# the store holds 1.5.0-dev.1 and 1.5.0-dev.2
# the next save publishes:
1.5.0-dev.3</code></pre>
     <p>To make the stable Version from that work, use
     <code>deck release</code>. The stable Version must agree with the import
     map: if the map declares <code>1.5.0</code>, you can release
     <code>1.5.0</code>. To release <code>1.6.0</code>, first change the map.
     That change is one line, and it is part of the tree that you seal.</p>`,
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
    'History: Versions, or a Timeline',
    `<p>A depot has one of two answers, and the server <b>reports</b> which
     one. It does not pretend.</p>
     <table class="stack"><tbody>
     <tr><td><b>History: Versions</b></td><td class="says">Each settled save
     becomes an immutable <code>-dev.N</code> Version. The Versions are the
     history. Always available.</td></tr>
     <tr><td><b>History: Timeline</b></td><td class="says">Each save also
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
    'Fork, lock, offer, rebase',
    `<p>Contribution is a version you can run.</p>
     <pre class="term"><code>deck fork --depot ./work/site --from acme/palette --as you/palette --use-in you/app
deck lock --depot ./work/site --publisher you --name app
deck offers --depot ./work/site
deck rebase --depot ./work/site</code></pre>
     <p>Or try someone else’s deck in your app without checking anything out:</p>
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
     <tr><td><code>GET /&lt;depot&gt;/_history</code></td><td>the Timeline</td></tr>
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
<i>commits you author</i>; Deck keeps <i>saves it observed</i>, automatically,
and gives each one a URL that serves. Nothing here competes with branching and
history rewriting — Deck’s Timeline is a tape of what actually happened, which
is a different and smaller promise.</td></tr>
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
<p>Twenty-seven commands in eight groups, ordered the way the work happens.
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
<tr><td><b>propose</b></td><td class="dim">change someone else’s deck without a
branch — <code>fork</code> <code>offers</code> <code>rebase</code></td></tr>
<tr><td><b>endorse</b></td><td class="dim">who stands behind these bytes —
<code>keygen</code> <code>sign</code> <code>verify-sig</code></td></tr>
<tr><td><b>recall</b></td><td class="dim">every state the depot has been in —
<code>history</code> <code>restore</code></td></tr>
<tr><td><b>prove</b></td><td class="dim">the executable contract —
<code>conform</code></td></tr>
</tbody></table>
`;

const STATUS = [
  ['tree hash, canonical zip, pack laws', 'built', 'tested'],
  ['content-addressed store, release-as-pointer, prune', 'built', 'tested'],
  ['live serve and auto-publish', 'built', 'tested'],
  ['vendoring hermetic graphs, with a cooldown policy', 'built', 'tested'],
  ['lock, fork, merge, offers, rebase', 'built', 'tested'],
  ['try-by-URL overrides', 'built', 'tested'],
  ['import-map injection and the change bus', 'built', 'tested'],
  ['history backends — Steps and restore', 'built', 'attaches when available'],
  ['publish times, local and upstream', 'built', 'tested'],
  ['the activity protocol — touch and declared claims', 'built', 'tested'],
  ['signatures on tree hashes', 'built', 'tested'],
  ['minified derived Versions, and compression', 'built', 'reproducible: verify-derivation re-runs it and compares hashes'],
  ['cross-depot dependency pins', 'not built', 'lock refuses them rather than guessing'],
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
        state ? depotTable(state) + activeNote(state) : `<p class="dim">reading the depots…</p>`
      }</div>`,
    ],
    ['quickstart', 'Quickstart: from nothing to a running deck', QUICKSTART],
    [
      'any',
      'What Deck gives any system',
      `<p class="lede">Each item below is a mechanism in this repository. No item
       is a plan. Each link goes to the place where you can examine the
       item.</p>` +
        `<ul class="bens">${benefit}</ul>`,
    ],
    ['protocol', 'The protocol: laws, addresses, endpoints', PROTOCOL],
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
    [
      'more',
      'Further reading and installation',
      `<p>The <a href="/deckbook">Deckbook</a> contains the material that does
       not belong on this page: complete command transcripts for each use
       case, and a longer description of how to write code on Deck. A real run
       produced each transcript in that book.</p>
       <p><b>Deck is not on npm.</b> A different package has that name. There
       is no <code>npx</code> command for Deck, and there will not be one.
       Install Deck from this repository. Read <code>INSTALL.md</code>.</p>`,
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
    // `.prose` is the documentation type system, defined once in theme.css
    // and specified in docs/deck-hub-typography.md. It governs this page and
    // the Deckbook and touches nothing in the three lens apps.
    `<div class="start prose">` +
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
    `<nav>${toc}</nav>` +
    `</details>` +
    `<main class="start-main" data-role="main">` +
    // WHAT IS THIS. The hero said "Everything here is runnable", which is a
    // true and clever thing to notice about the page and tells a first-time
    // reader nothing about what the project is. A landing page owes the
    // reader the description before the observation.
    `<header class="hero">` +
    // The mark, then the sentence. Only the NAME is the mark — "is" belongs to
    // the sentence and takes the sentence's face, or the mark grows a word.
    `<h1><b>DECK</b> is a protocol to store, to version and to serve code as
     files with addresses.</h1>` +
    `<p class="lede">A directory is also a URL space. Each file in the
     directory has an address. The address shows where the file is. Each save
     becomes a state that does not change. You can go back to any of these
     states.</p>` +
    `<p class="lede">You can also copy a library from a registry into your own
     depot. The server then supplies that library. There is no install step, no
     lockfile and no bundler. The browser runs the bytes that are on the disk.
     An import map gives the address of each byte when the browser asks.</p>` +
    `<p class="lede">Deck is a protocol first. It has twelve laws and a test
     suite that examines them. This server and its command-line tool are the
     reference implementation. If a different implementation obeys the test
     suite, that implementation is also Deck.</p>` +
    `<p class="lede">The three lenses at the top of the page ask three
     questions about one address: what the address is, what it does, and what
     changed. The lenses are decks. This server supplies them from the store
     that they show to you.</p>` +
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
  let stats = app.querySelector('[data-role="stats"]');
  if (stats) stats.outerHTML = statLine(state);
  let slot = app.querySelector('[data-role="now"]');
  if (slot) slot.innerHTML = depotTable(state) + activeNote(state);
  // The depot table is new HTML, so it arrives without a scroll port.
  wrapTables(app);
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
// Timeline per depot — and `onLiveChange` fires about once a second while
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
refresh();
setInterval(refresh, REFRESH_MS);

// Crossing the breakpoint changes which state the rail SHOULD start in, and
// the attribute was decided once at paint. Only the default is moved — if the
// reader has opened or closed it themselves, that is their answer and resizing
// a window is not a request to overrule it.
let touched = false;
app.addEventListener('toggle', (event) => {
  if (event.target.matches?.('[data-role="toc"]')) touched = true;
}, true);
WIDE.addEventListener('change', (event) => {
  if (touched) return;
  let toc = app.querySelector('[data-role="toc"]');
  if (toc) toc.open = event.matches;
});

// IN THE HOUSE STYLE, WHICH MEANS ADDING ALMOST NOTHING.
//
// The theme's rules are one typeface at one size doing every job, colour only
// where colour means something, measurement in `ch` and whole rows, and
// structure from alignment rather than from boxes. A page of prose is exactly
// where those get broken — the reflex is a bigger heading and a bordered code
// block — so this sets no font sizes at all and draws one hairline per
// section. Hierarchy comes from the numbered inverse marker the nav already
// uses, and from the measure.
const START_CSS = `
/* Page-specific layout only. Everything typographic — the two faces, the
   scale, the rhythm, the measure, the tables — lives in the .prose block in
   theme.css and is specified in docs/deck-hub-typography.md. If a rule here
   is about type, it is in the wrong file. */

.hero { padding: var(--s2) 0 var(--s4); }
/* "Deck is" — THE SAME MARK AS THE ONE IN THE NAV.
   The name appeared twice on the first screen in two different typefaces:
   Commit Mono in the corner, the prose sans in the sentence. Two faces for
   one word is two marks, and a reader has to decide whether they refer to
   the same thing. So the name takes the vendored face wherever it appears,
   at the same weight, in full-strength foreground and never in a hue from
   the address palette — those hues mean depot, publisher and package, and
   spending one on the product name makes the name read as a segment.

   Tracking is lighter than the nav's .22em: that value is for four capitals
   at 13px, and the same value at 31px pulls the word apart. */
.hero h1 b {
  font-family: var(--mono); font-weight: 700;
  letter-spacing: .1em; color: var(--fg);
  /* The mark is set in capitals wherever it appears, so the case is a rule
     here and not a decision the copy makes. Tracking sits between the nav's
     .22em and none: that value is tuned for 13px, and the same figure at
     31px pulls four letters into four separate letters. */
  text-transform: uppercase;
  margin-right: .15em;
}
.lede { opacity: .9; }

/* The counts. Doors, so each gets a door's hover; tabular figures so the
   numbers sit in a row rather than jittering as they update. */
.stats {
  display: flex; flex-wrap: wrap; gap: var(--s3);
  padding: var(--s3) 0 0; margin-top: var(--s2);
  border-top: 1px solid var(--line);
}
.stat {
  display: flex; align-items: baseline; gap: .8ch; text-decoration: none;
  font-size: var(--t-small);
}
.stat b {
  color: var(--a-package); font-size: var(--t-h3); font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-family: var(--mono, ui-monospace, monospace);
}
.stat span { color: var(--dim); }
.stat:hover b, .stat:hover span { color: var(--fg); }

/* A section is a band, and the rule is the band's edge — the space above a
   heading does the separating, the rule only confirms it. */
.doc { padding-top: var(--s6); border-top: 1px solid var(--line); }
.doc:first-of-type { border-top: none; }
.doc > h2 { margin-top: 0; }
.doc-n {
  display: inline-block; min-width: 2.4ch; text-align: center;
  background: var(--fg); color: var(--bg);
  font-size: var(--t-micro); font-weight: 600;
  padding: .1em .5ch; margin-right: 1.5ch;
  vertical-align: .25em;
}
.doc-sub { padding-top: var(--s2); }

/* The benefit list: a claim, its explanation, and the place to check it.
   Not a table — each item is a short essay, and a table would force the
   explanation into a cell that wants to be a paragraph. */
.bens { list-style: none; padding: 0; margin: 0; max-width: none; }
.ben {
  padding: var(--s2) 0; border-bottom: 1px solid var(--line);
  max-width: var(--measure);
}
.ben:last-child { border-bottom: none; }
.ben > b { display: block; font-size: var(--t-body); margin-bottom: 4px; }
.ben p { color: var(--fg); opacity: .88; margin: 0 0 var(--s1); }
.ben a { font-size: var(--t-small); color: var(--a-package); }
.todo { color: var(--a-live); font-weight: 600; }
.prose td.ok { color: var(--green); font-weight: 600; }

ul.plain { list-style: none; padding: 0; margin: 0; }
ul.plain li { margin-bottom: 4px; }

/* ── the contents rail ───────────────────────────────────────────────────
   Wide screens get a sticky rail; narrow ones get a disclosure. One element
   doing both, because two would be two states to keep in step and a
   duplicate list for a screen reader to read twice. */
.start { display: block; }

.toc summary {
  cursor: pointer; color: var(--dim); list-style: none;
  padding: var(--s1) 0; font-size: var(--t-small);
}
.toc summary::-webkit-details-marker { display: none; }
.toc summary::before { content: '▸ '; }
.toc[open] summary::before { content: '▾ '; }
.toc nav { display: flex; flex-direction: column; padding-bottom: var(--s2); }
.toc a {
  display: flex; gap: 1.2ch; text-decoration: none; color: var(--dim);
  padding: 5px 0; font-size: var(--t-small); line-height: 1.35;
}
.toc a i {
  font-style: normal; opacity: .55; min-width: 2ch;
  font-variant-numeric: tabular-nums;
  font-family: var(--mono, ui-monospace, monospace);
}
.toc a:hover { color: var(--fg); }
.toc a[data-here='1'] { color: var(--fg); font-weight: 600; }
.toc a[data-here='1'] i { opacity: 1; color: var(--a-package); }

@media (min-width: 62rem) {
  .start {
    display: grid; grid-template-columns: 30ch minmax(0, 1fr); gap: 6ch;
    align-items: start;
  }
  .toc {
    position: sticky; top: var(--s3);
    max-height: 86vh; overflow-y: auto;
  }
  .toc summary { display: none; }
}

@media (max-width: 40rem) {
  .stats { gap: var(--s2); }
  .doc { padding-top: var(--s4); }
}
`;

let style = document.createElement('style');
style.textContent = START_CSS;
document.head.append(style);
