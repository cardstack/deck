// What the hub shows, and why.
//
// One entry per demo: the process to run, the port it listens on, and the
// prose that goes above it. The explanations live here rather than in the
// page so that the page stays a renderer and the copy stays reviewable as
// text.
//
// `pill()` is the same module the demos publish as `ui/pills`; Node imports
// it directly, the browser gets it from /pills.js, the depots serve it as a
// deck. One definition of what a name means, three carriages.
import { pill } from '../shared/ui/pills/pills.js';

export const DEMOS = [
  {
    name: 'codelist',
    dir: 'codelist',
    port: 8790,
    workload: 'W2 · shared reference data',
    title: 'The merge that is not a conflict',
    lede: `A currency codelist is a SET OF KEYS. Two people adding different
      codes are not in conflict however close together the lines happen to
      sit — but a line merge cannot know that, so it invents one. Deck merges
      JSON by key, and the disagreement disappears because it was never
      there.`,
    look: [
      'Both amendments land in 1.5.0 with zero conflicts. Nobody resolved anything.',
      'The fork rebases onto 1.5.0 and keeps its three internal codes.',
      'The one conflict reported is <code>importmap.json</code> — both sides renamed the version. A machine can combine two sets of codes; it cannot decide what to CALL the combination.',
      'Every state is at rest at its own immutable URL. There is no write endpoint in this demo at all.',
    ],
    tries: [
      { label: 'the shared list', path: '/site/std/currencies@1.4.0/currencies.json' },
      { label: 'after both amendments', path: '/site/std/currencies@1.5.0/currencies.json' },
      { label: 'the fork, rebased', path: '/site/acme/currencies@1.5.0-acme.1/currencies.json' },
    ],
  },
  {
    name: 'contribute-to-codelist',
    dir: 'contribute-to-codelist',
    port: 8794,
    workload: 'W2 · the write side',
    title: 'Contribute, and review without checking out',
    lede: `A contribution is not a diff and not a branch. It is a tree that
      exists, in your own publisher scope, which records the exact tree it
      forked. That one hash is the third input a three-way merge needs, so a
      machine can keep every open proposal merged against upstream and a
      maintainer only ever looks at the ones that stopped.`,
    look: [
      'Two forks of 1.4.0. Upstream then ships 1.5.0 that AGREES with one of them about ZWG and disagrees about JPY — one key, two answers.',
      'The queue reports one <b>rebased</b> and one <b>conflicted</b>, re-merged on read rather than stored.',
      'The daemon writes the clean one back and leaves the conflicted tree byte-for-byte untouched.',
      'The four view buttons are the same sealed page, resolved differently for one request. Nothing is checked out.',
      'A trial comes back <code>cache-control: no-store</code> with <code>x-deck-with</code> — it is not the sealed representation and must never be cached as one.',
    ],
    tries: [
      { label: 'the queue', path: '/site/_offers' },
      { label: "ana's live proposal", path: '/site/ana/currencies/currencies.json' },
      { label: 'the released list', path: '/site/std/currencies@1.4.0/currencies.json' },
    ],
  },
  {
    name: 'fork-an-app',
    dir: 'fork-an-app',
    port: 8791,
    workload: 'W3 · adapters and forks',
    title: 'Take all of it, change the part you disagree with',
    lede: `Leaflet publishes real per-file ESM — 85 modules, nothing pointing
      outside the package. Vendoring it from npm source keeps the module
      boundary intact, so “change one file” means changing one file, not
      patching a 140 KB bundle or maintaining a downstream build.`,
    look: [
      `Two maps on one page, from two decks: ${pill('deck', 'lib/leaflet@1.9.4')} and ${pill('deck', 'me/leaflet@1.9.4-mine.0')}. The right one is a fork with a patched zoom control.`,
      `89 objects in the store for two 87-file packages — the fork cost 2, and one of those is the manifest. That is a fact about the store, not about ${pill('npm', 'leaflet@1.9.4')}, which is 85 modules.`,
      'Both maps draw vector layers only. There is no tile server, so nothing on the page reaches the network at runtime (L6).',
      `The fork inherits no endorsements, because it announces a different lineage and is therefore a different tree (L10). Provenance survives it: the deck still records ${pill('npm', 'leaflet@1.9.4')} and ${pill('github', 'Leaflet/Leaflet')}.`,
    ],
    tries: [
      { label: 'upstream', path: '/site/lib/leaflet@1.9.4/src/control/Control.Zoom.js' },
      { label: 'the fork of that one file', path: '/site/me/leaflet@1.9.4-mine.0/src/control/Control.Zoom.js' },
      { label: 'the provenance record', path: '/site/lib/leaflet@1.9.4/importmap.json' },
    ],
  },
  {
    name: 'fork-a-language',
    dir: 'fork-a-language',
    port: 8792,
    workload: 'W3 · bespoke to generic',
    title: 'Fork a language, keep the engine',
    lede: `Two decks implement one small filter language. One replaces a
      single file — the parser — with a FEEL-shaped surface syntax instead of
      a jq-shaped one, and adds a feature the original has no syntax for.`,
    look: [
      'Every question is asked in both dialects and the answers are compared. If the fork ever changed behaviour, the demo fails instead of shipping.',
      '<code>eval.js</code> is byte-identical across the two decks, so the store holds one copy — which is the proof that both dialects run the same semantics.',
      'The FEEL range <code>qty in [2..8]</code> desugars inside the parser into two comparisons the shared evaluator already understood. A new language feature, zero evaluator change.',
      '6 objects for two 4-file decks; two full copies would be 8.',
    ],
    tries: [
      { label: 'the jq-shaped parser', path: '/site/lang/jqish@1.0.0/parse.js' },
      { label: 'the FEEL-shaped one', path: '/site/me/jqish@1.0.0-feel.0/parse.js' },
      { label: 'the shared evaluator', path: '/site/lang/jqish@1.0.0/eval.js' },
    ],
  },
  {
    name: 'field-library',
    dir: 'field-library',
    port: 8793,
    workload: 'W4 · patterns and fields',
    title: 'A field library — aliasing, scopes, dedupe',
    lede: `Six card fields, each its own deck, over five npm libraries
      vendored from source. Enough decks on one page for the resolution rules
      to matter — and all three of them show up at once.`,
    look: [
      `Every field imports <code>zod</code>, <code>date-fns</code>, <code>luxon</code> — bare npm specifiers. None of those is a deck name: ${pill('npm', 'zod@3.25.76')} is the artifact, ${pill('deck', 'lib/zod@3.25.76')} is the address, and one line of decklist connects them.`,
      `${pill('deck', 'fields/swatch@1.0.0')} is on chroma-js 3.1.2 and ${pill('deck', 'fields/brand-swatch@1.0.0')} is pinned to 2.6.0, and both render on the same page. A flat import map has one slot for <code>chroma-js</code>.`,
      '13 dependency edges collapse to 6 library URLs. Nothing computed that — identical ranges resolve to identical versions, and identical bytes have identical names.',
      'One URL is one module instance, so <code>dueDate.schema instanceof handle.modules.zod.ZodType</code> is <b>true</b>. The page checks it live.',
      'The page reads its own injected import map back out of the DOM, so the tables are measurements of the page you are looking at.',
    ],
    tries: [
      { label: 'a field deck’s lock', path: '/site/fields/swatch@1.0.0/importmap.json' },
      { label: 'chroma-js 3.1.2', path: '/site/lib/chroma-js@3.1.2/index.js' },
      { label: 'chroma-js 2.6.0, at the same time', path: '/site/lib/chroma-js@2.6.0/index.js' },
    ],
  },
];

export const LAWS = [
  ['L1', 'Identity', 'Identity is <code>tree-hash-v1</code> over the logical file tree, and nothing else enters it.'],
  ['L2', 'Round trip', '<code>treeHash(unpack(pack(T))) === treeHash(T)</code> — packing is faithful.'],
  ['L3', 'Pointer', '<code>pack(unpack(P)) === P</code>, byte-identically, so a pack has a canonical form.'],
  ['L4', 'Immutability', 'A published exact version never changes. Re-publishing one is refused.'],
  ['L5', 'Volatility', 'A deck has exactly three kinds of address, and they are different URLs.'],
  ['L6', 'Hermeticity', 'A sealed deck resolves every specifier it contains. Nothing reaches the live web at runtime.'],
  ['L7', 'Resolution', 'A dependency key is the import specifier; an alias value names the deck that answers to it.'],
  ['L8', 'Provenance', 'A deck that is a copy of something else records what it is a copy of, checkably.'],
  ['L9', 'Endorsement', 'A signature binds a key to a treeHash. Names are never the subject.'],
  ['L10', 'Inheritance', 'Same treeHash ⇒ same bytes ⇒ same endorsements.'],
  ['L11', 'Fail closed', 'An unverifiable claim is refused, not warned about.'],
  ['L12', 'Serving', 'The response says what the bytes are.'],
];
