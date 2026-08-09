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
    title: 'Two dialects. One evaluator.',
    lede: `A two-pane console over one small filter language. Type an
      expression in either dialect and both evaluate as you type — different
      surface syntax, the same engine, and you can check that yourself.`,
    look: [
      'Both engines run in the page, imported from two sealed decks. Type your own expression: an answer the author never thought of is still the same answer on both sides.',
      'Each pane prints the SHA-256 of the <code>eval.js</code> bytes it fetched. The same digest twice, from two different URLs, is the proof that both dialects run the same semantics.',
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
    title: 'Edit a field. The edit is a Version.',
    lede: `A shipment form built from seven field decks. Six are sealed. The
      seventh is yours: edit its source in the page, and the save becomes an
      immutable Version the form can be pointed at.`,
    look: [
      'Press Save. The watcher hashes the tree and publishes <code>1.0.0-dev.N</code>; the page reloads at <code>?with=you/ship-by@1.0.0-dev.N</code> and the control looks different. Click <code>1.0.0</code> to get the original back, byte for byte.',
      'The editor writes through a <b>separate process</b> on the next port. The deck server answers GET and HEAD and nothing else, so a page cannot ask it to save a file — the bridge does what your editor does, and everything after the write is the ordinary loop.',
      `Every field imports <code>zod</code>, <code>date-fns</code>, <code>luxon</code> — bare npm specifiers. None of those is a deck name: ${pill('npm', 'zod@3.25.76')} is the artifact, ${pill('deck', 'lib/zod@3.25.76')} is the address, and one line of decklist connects them.`,
      `${pill('deck', 'fields/swatch@1.0.0')} is on chroma-js 3.1.2 and ${pill('deck', 'fields/brand-swatch@1.0.0')} is pinned to 2.6.0, and both render on the same page. A flat import map has one slot for <code>chroma-js</code>.`,
      'One URL is one module instance, so <code>dueDate.schema instanceof handle.modules.zod.ZodType</code> is <b>true</b>. The page checks it live.',
    ],
    tries: [
      { label: 'the form at the working tree', path: '/site/app/library@1.0.0/index.html?with=you/ship-by' },
      { label: 'a field deck’s lock', path: '/site/fields/swatch@1.0.0/importmap.json' },
      { label: 'chroma-js 3.1.2', path: '/site/lib/chroma-js@3.1.2/index.js' },
      { label: 'chroma-js 2.6.0, at the same time', path: '/site/lib/chroma-js@2.6.0/index.js' },
    ],
  },
  {
    name: 'two-agents',
    dir: 'two-agents',
    port: 8795,
    workload: 'W1 · concurrent agents',
    title: 'A rule resolves it. No rule refuses.',
    lede: `Two agents editing the same depot in the same minute. Each token
      set is rendered as the interface it describes, so an edit repaints
      something you recognise — and the one key nobody wrote a rule for is the
      loudest thing on the page.`,
    look: [
      'The three sets are drawn as three small interfaces, from their own values. Agent A rounded the corners and picked a green accent; agent B added a warning colour. Nothing on the page chooses those — they come off the JSON.',
      'Both component saves auto-publish and are <b>sealed</b> — this is the demo that runs a Timeline, so every save has a changeId, not just every publish.',
      'Round one: three different keys under one object. Both forks absorb upstream and keep their own addition. Nobody reviewed anything.',
      'Round two: the same two keys, two answers. Reported <code>conflicted</code>, and the fork’s tree hash is byte-identical before and after — a conflicted pass writes nothing at all.',
      'The rules live in <code>merge-policy.json</code>, published by upstream. <code>scale</code> is a set, so <code>union</code> keeps both intentions: 48 was the fork’s, 40 was upstream’s, and both survive.',
      'A key with no rule is not guessed. The resolver abandons the whole resolution and names the key — one person decides one thing instead of three.',
    ],
    tries: [
      { label: 'the queue', path: '/site/_offers' },
      { label: 'the merge rules, sealed', path: '/site/std/tokens@1.3.0/merge-policy.json' },
      { label: 'agent A, live', path: '/site/agent-a/tokens/tokens.json' },
      { label: 'the seal log', path: '/site/_history' },
    ],
  },
  {
    name: 'variations',
    dir: 'variations',
    port: 8796,
    workload: 'W4 · choosing between agent output',
    title: 'A, B or C — and the two you didn’t pick',
    lede: `Asked to make a gallery denser, an agent offers three answers at
      three different layers: the tokens, the card, the gallery. They have
      different blast radii, so a person chooses — and the two rejected
      answers have to stay readable, because in a month one of them will turn
      out to have been right.`,
    look: [
      'Four iframes, one sealed page. Each is <code>/site/app/preview/preview.html</code> with a different <code>?with=</code> — no checkout, no build, no branch.',
      `Each variation is an immutable prerelease: ${pill('deck', 'std/tokens@1.1.0-try.a')}, ${pill('deck', 'ui/card@1.1.0-try.b')}, ${pill('deck', 'app/gallery@1.1.0-try.c')}. Publishing all three moved nothing downstream, because ranges never match prereleases.`,
      'Choosing is <code>deck release --from try-b</code>: a tag moves, the same stored object is named, <b>zero bytes are copied</b>.',
      'The two you rejected are not deleted, stashed, or branched. They are published versions with no <code>latest</code> pointing at them — which is all “not latest” has ever needed to mean.',
      'Re-run with <code>CHOOSE=a</code> or <code>CHOOSE=c</code>. Changing your mind in a month is the same pointer move.',
    ],
    tries: [
      { label: 'variation A, still there', path: '/site/std/tokens@1.1.0-try.a/tokens.json' },
      { label: 'variation C, still there', path: '/site/app/gallery@1.1.0-try.c/gallery.js' },
      { label: 'what latest names now', path: '/site/ui/card@1.1.0/card.js' },
    ],
  },
  {
    name: 'three-js',
    dir: 'three-js',
    port: 8797,
    workload: 'W3 · own the library',
    title: '374 files, and you may edit any of them',
    lede: `three.js publishes both: a real per-file module tree in
      <code>src/</code>, and the same library flattened into one 1.2 MB module
      in <code>build/</code>. Almost every CDN hands you the second. Vendored
      from the first, changing a shader is a text edit.`,
    look: [
      `Two WebGL canvases, one scene definition, run twice. Everything that differs comes from ONE file — a GLSL chunk in ${pill('deck', 'me/three@0.160.0-holo')}.`,
      'The fork is a fresnel rim plus a screen-space scanline. Neither is reachable from a material option: <code>MeshPhongMaterial</code> has ~50 settings and none of them is either.',
      '373 of 375 files are byte-identical, so the fork cost <b>2 objects</b> out of a 376-object store. Two independent copies would be 750.',
      '0 rewritten during vendoring — the tree served IS the tree npm published, verifiable against the recorded GitHub commit.',
      'The page times its own module loading: 374 modules, one request each, per side. That number is the honest cost of per-file delivery and what <code>docs/deck-efficient-delivery-spec.md</code> answers.',
    ],
    tries: [
      { label: 'the one changed file', path: '/site/me/three@0.160.0-holo/src/renderers/shaders/ShaderChunk/opaque_fragment.glsl.js' },
      { label: 'upstream, same path', path: '/site/lib/three@0.160.0/src/renderers/shaders/ShaderChunk/opaque_fragment.glsl.js' },
      { label: 'the provenance record', path: '/site/lib/three@0.160.0/importmap.json' },
    ],
  },
  {
    name: 'prosemirror',
    dir: 'prosemirror',
    port: 8798,
    workload: 'W3 · the honest gap',
    title: 'Where per-file vendoring runs out',
    lede: `Leaflet publishes 85 addressable modules. three.js publishes 374.
      These eleven publish none — every declared entry is one rolled-up
      module — and between them they ship <b>zero</b> source maps, so there is
      nothing to recover either. This demo measures the refusal instead of
      asserting it, and then shows what is left.`,
    look: [
      'The survey table is the measurement: 11 packages, every entry resolving to <b>1</b> module, and a maps column that is zero all the way down.',
      `Source mode has no tree to take; map mode has nothing to recover from. This is the case ${pill('github', 'docs/deck-rebuild-sibling-proposal.md')} was written for.`,
      'ProseMirror ships <code>src/</code> anyway — TypeScript. Sealed as its own deck with <b>no entry declared</b>, so it is addressable, hashed and diffable, and the server structurally refuses to import it. L11 as a shape, not a warning.',
      'The editor is real and hermetic: 11 bundles vendored from npm tarballs and wired to each other by decklist alias, with one import-map scope per deck (L7).',
      'Two decks, same library, same version — one readable and not runnable, one runnable and not readable. What joins them is a build, and <code>rebuild-v1</code> is still a proposal. The demo stops there rather than pretending.',
    ],
    tries: [
      { label: 'readable, not runnable', path: '/site/src/prosemirror-model@1.25.11/src/schema.ts' },
      { label: 'runnable, not readable', path: '/site/lib/prosemirror-model@1.25.11/dist/index.js' },
      { label: "the app's scopes", path: '/site/app/editor/importmap.json' },
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
