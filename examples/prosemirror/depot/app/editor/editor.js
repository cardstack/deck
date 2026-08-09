// A real ProseMirror editor, served entirely from this depot — and the
// measurement of what it cost to get here.
//
// Every `import` below is a bare specifier that the server resolved through
// this deck's decklist into an exact-version URL in the local store. Nothing
// on this page reaches npm, unpkg, or any CDN. Type in the box: it is the
// actual editor, running the actual bundles.

import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { EditorView as RuledEditorView } from 'prosemirror-view-ruled';
import { DOMParser, Schema } from 'prosemirror-model';
import { schema as basic } from 'prosemirror-schema-basic';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { installPillStyles, legend, pill } from 'ui/pills';

const build = await (await fetch('./build.json')).json();
installPillStyles();

const { survey, sourceDecks, vendoredDecks, store, viewFork } = build;
const totalMaps = survey.reduce((n, row) => n + row.maps, 0);
const totalSrc = survey.reduce((n, row) => n + row.sources, 0);

let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
  <header>
    <h1>Where per-file vendoring runs out.</h1>
    <p class="lede">
      Leaflet publishes 85 addressable modules. three.js publishes 374. These
      eleven publish <strong>none</strong>, and ship
      <strong>${totalMaps} source maps</strong> between them.
    </p>
    <div class="namekey">
      ${legend(['deck', 'npm', 'github'], {
        deck: `/site/lib/prosemirror-model@${survey[0].version}/dist/index.js`,
        npm: `prosemirror-model@${survey[0].version}`,
        github: 'ProseMirror/prosemirror-model',
      })}
      <p class="note">
        Three names for one library, and on this page they disagree about
        something that matters: the ${pill('github', 'ProseMirror/prosemirror-model')}
        repository is 14 TypeScript modules, the
        ${pill('npm', `prosemirror-model@${survey[0].version}`)} artifact is one
        rolled-up JavaScript file, and the
        ${pill('deck', `lib/prosemirror-model@${survey[0].version}`)} address can
        only serve what npm shipped.
      </p>
    </div>
  </header>

  <section class="editor-wrap">
    <h3>What does work: the bundles, sealed and wired</h3>
    <p class="note">
      A real editor. Bold is <kbd>⌘B</kbd>, italic <kbd>⌘I</kbd>, undo
      <kbd>⌘Z</kbd>. Every module behind it came from this depot.
    </p>
    <div id="editor"></div>
    <p class="note" id="verdict"></p>
  </section>

  <section class="editor-wrap forked">
    <h3>Changing it anyway: the same editor, on a forked rollup</h3>
    <p class="note">
      ${pill('deck', `${viewFork.deck}@${viewFork.version}`, { wrap: true })}
      — one string replaced in
      <code>${viewFork.file}</code>, at offset
      ${viewFork.offset.toLocaleString()} of ${viewFork.bytes.toLocaleString()}.
    </p>
    <pre class="patch"><code>- ${viewFork.needle}
+ ${viewFork.needle.replace('"ProseMirror"', '"ProseMirror pm-ruled"')}</code></pre>
    <div id="editor-ruled"></div>
    <p class="note">
      It works. That is the uncomfortable part. The class the view puts on its
      editable element is assigned once, mid-rollup, and the only way to reach
      it is a string match against machine output — no module to import, no
      symbol to override, nothing that says what was <em>meant</em>. The next
      release regenerates that file and the patch is gone or, worse, silently
      matches something else.
      <br />
      Compare ${pill('deck', 'me/three@0.160.0-holo')} in the three.js demo:
      one file out of 374, at a path that will still be there next release,
      and a diff a person can review. Same operation, and the only difference
      is whether the boundary survived publishing.
    </p>
  </section>

  <section>
    <h3>1 · The refusal, measured</h3>
    <table class="survey">
      <tr><th>package</th><th>files</th><th>entries (modules each)</th><th>maps</th><th>src/</th></tr>
      ${survey
        .map(
          (row) => `<tr>
            <td>${pill('npm', `${row.name}@${row.version}`)}</td>
            <td>${row.files}</td>
            <td class="entries">${row.entries
              .map((e) => `<code>${e.entry}</code> <b>${e.modules}</b>`)
              .join('<br />')}</td>
            <td class="${row.maps === 0 ? 'zero' : ''}">${row.maps}</td>
            <td>${row.sources || '—'}</td>
          </tr>`,
        )
        .join('')}
    </table>
    <p class="note">
      Every entry resolves to <b>1</b>. A candidate reaching one module is a
      bundle: whatever it was made of, npm did not ship it. And the maps
      column is zero all the way down — source mode has no tree to take, map
      mode has nothing to recover from.
    </p>
  </section>

  <section>
    <h3>2 · What <em>is</em> in the tarball: ${totalSrc} source files that cannot run</h3>
    <p>
      ProseMirror ships <code>src/</code>. The author's code is right there,
      byte-verifiable against the GitHub commit npm recorded — and it is
      TypeScript, so no browser will run it and nothing here transforms it.
    </p>
    <table class="survey">
      <tr><th>deck</th><th>files</th><th>entry</th></tr>
      ${sourceDecks
        .map(
          (deck) => `<tr>
            <td>${pill('deck', `${deck.deck}@${deck.version}`, { wrap: true })}</td>
            <td>${deck.files}</td>
            <td class="none">none declared — the server answers <code>no-entry-module</code></td>
          </tr>`,
        )
        .join('')}
    </table>
    <p class="note">
      That is L11 as a shape rather than a warning: a deck that declared an
      entry it could not honour would be a lie the server repeats on every
      request. Addressable, hashed, diffable, and structurally impossible to
      import.
    </p>
  </section>

  <section>
    <h3>3 · What runs: bundles, aliased to each other</h3>
    <table class="survey">
      <tr><th>deck</th><th>size</th><th>decklist aliases</th></tr>
      ${vendoredDecks
        .map(
          (deck) => `<tr>
            <td>${pill('deck', `${deck.deck}@${deck.version}`, { wrap: true })}</td>
            <td>${deck.kb} KB</td>
            <td class="entries">${
              deck.externals.length
                ? deck.externals.map((x) => `<code>${x}</code>`).join(' ')
                : '<span class="none">—</span>'
            }</td>
          </tr>`,
        )
        .join('')}
    </table>
    <p class="note">
      Each arrow is a decklist alias (L7): the key is the bare specifier the
      bundle imports, the value names the deck that answers to it. The server
      emits one import-map <em>scope</em> per deck, so each bundle's
      dependencies resolve inside its own URL prefix. ${store.objects} objects,
      ${(store.bytes / 1024).toFixed(0)} KB, nothing duplicated.
    </p>
  </section>

  <section class="gap">
    <h3>The gap</h3>
    <p>
      Two decks, same library, same version, and neither is what you want:
    </p>
    <div class="two">
      <div>
        ${pill('deck', `src/prosemirror-model@${survey[0].version}`, { wrap: true })}
        <p>readable, diffable, verifiable — <strong>not runnable</strong></p>
      </div>
      <div>
        ${pill('deck', `lib/prosemirror-model@${survey[0].version}`, { wrap: true })}
        <p>runnable, hermetic, pinned — <strong>not readable</strong>, and you
        cannot change one line of it without owning a megabyte of rollup
        output</p>
      </div>
    </div>
    <p>
      What joins them is a <strong>build</strong>, and a build usually produces
      bytes that do not match the registry tarball. That is the whole problem
      <code>rebuild-v1</code> exists to name: not a fork (nobody intended a
      change) and not the npm tree (different bytes, different identity), but a
      <strong>rebuild sibling</strong> — sealed, pin-able, and honest about
      whether it matched. It is a <strong>proposal</strong>. Nothing in this
      repo implements it, which is why this demo stops here instead of
      pretending.
    </p>
  </section>
`;

// The editor itself.
const schema = new Schema({
  nodes: basic.spec.nodes,
  marks: basic.spec.marks,
});
// Real prose, because an editor full of notes about the editor teaches
// nobody anything about editing. Type in it, select something, hit ⌘B.
const CONTENT = `
  <h3>On the naming of tools</h3>
  <p>A carpenter's plane has a <em>frog</em>, a <em>chipbreaker</em> and a
  <em>tote</em>. None of these words is decorative. The frog is the wedge the
  blade rests on and it is named for the shape, the chipbreaker curls the
  shaving before it can split the grain ahead of the cut, and the tote is
  simply the handle — from the same root as <strong>to tote</strong>, to
  carry.</p>
  <p>You can plane a board without knowing any of them. You cannot
  <em>fix</em> a plane without knowing all of them, because the fault is
  always in a specific part, and a part you cannot name is a part you cannot
  order, describe to anyone, or reason about at three in the afternoon with
  the shaving jamming every fourth stroke.</p>
  <p>Software has the same arrangement and hides it better.</p>
`;
const doc = document.createElement('div');
doc.innerHTML = CONTENT;

const parser = DOMParser.fromSchema(schema);
const plugins = () => [
  history(),
  keymap({
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
    'Mod-b': toggleMark(schema.marks.strong),
    'Mod-i': toggleMark(schema.marks.em),
  }),
  keymap(baseKeymap),
];
const stateFrom = (html) => {
  let source = document.createElement('div');
  source.innerHTML = html;
  return EditorState.create({ doc: parser.parse(source), plugins: plugins() });
};

let view = new EditorView(document.querySelector('#editor'), {
  state: EditorState.create({ doc: parser.parse(doc), plugins: plugins() }),
});

// The same editor, from the forked rollup. Same schema, same plugins, same
// content — the only difference in the whole page is which `dist/index.js`
// the view came from.
let ruled = new RuledEditorView(document.querySelector('#editor-ruled'), {
  state: stateFrom(`
    <h3>The same document, a different build</h3>
    <p>This editor is running a <strong>forked</strong> copy of
    prosemirror-view. Everything else about it — the schema, the plugins, the
    key bindings, the text you are reading — is identical to the one
    above.</p>
    <p>The ruled paper is the tell. It comes from a class name that was
    changed inside 242 kilobytes of generated JavaScript, because there was
    nowhere else to change it.</p>
  `),
});
void ruled;
document.querySelector('#verdict').textContent =
  `${vendoredDecks.length} decks, ${vendoredDecks.reduce((n, d) => n + d.kb, 0)} KB, 0 requests off this origin.`;
void view;

let style = document.createElement('style');
style.textContent = `
  :root {
    --bg:#f7f8fa; --panel:#fff; --line:#e2e8f0; --ink:#272330; --dim:#5a586a;
    --accent:#0c9d7c; --warn:#b45309;
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:3rem 1.5rem 5rem; background:var(--bg); color:var(--ink);
         font:15px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  #app { max-width:70rem; margin:0 auto; }
  #app.loading { color:var(--dim); }
  h1 { font-size:1.6rem; margin:0 0 .5rem; letter-spacing:-.01em; }
  h3 { font-size:1rem; margin:0 0 .5rem; }
  .lede { color:var(--dim); max-width:50rem; margin:0 0 1.5rem; }
  .lede strong { color:var(--ink); }
  p { max-width:52rem; }
  code, kbd { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.85em; }
  kbd { border:1px solid var(--line); border-radius:4px; padding:.05em .35em; background:var(--panel); }
  .note { color:var(--dim); font-size:.85rem; }
  section { margin:2.2rem 0; }

  .namekey { margin:0 0 1.5rem; padding:.85rem 1rem; background:var(--panel);
             border:1px solid var(--line); border-radius:10px; }

  .editor-wrap { background:var(--panel); border:1px solid var(--line);
                 border-radius:10px; padding:1.1rem 1.2rem 1.2rem; margin-bottom:1rem; }
  .editor-wrap.forked { border-color:#f4e6d4; box-shadow:0 0 0 2px #fdf3e6; }
  .patch { background:#fffaf3; border:1px solid #f4e6d4; border-radius:8px;
           padding:.6rem .8rem; overflow:auto; font-size:.78rem; margin:.5rem 0 .8rem; }
  .patch code { white-space:pre; }
  /* The forked build stamps this class on its editable element. Nothing but
     the fork can produce it, which is the only reason the page can style it. */
  #editor-ruled .pm-ruled {
    background:
      repeating-linear-gradient(to bottom, #fffdf7 0, #fffdf7 27px, #f0e4cf 27px, #f0e4cf 28px);
    border-left:2px solid #e0b088;
    padding-left:1rem;
  }
  #editor-ruled .pm-ruled::selection { background:#ffe0b2; }
  #editor { border:1px solid var(--line); border-radius:8px; padding:.4rem 1rem;
            margin:.8rem 0 .5rem; background:#fff; min-height:11rem; }
  #editor .ProseMirror { outline:none; }
  #editor h3 { font-size:1.05rem; margin:.8rem 0 .4rem; }
  #editor p { margin:.5rem 0; }

  table.survey { width:100%; border-collapse:collapse; font-size:.85rem; background:var(--panel);
                 border:1px solid var(--line); border-radius:10px; overflow:hidden; margin:.6rem 0; }
  .survey th { text-align:left; font-size:.7rem; text-transform:uppercase;
               letter-spacing:.05em; color:var(--dim); font-weight:600; }
  .survey th, .survey td { padding:.45rem .7rem; border-bottom:1px solid #eceef1; vertical-align:top; }
  .survey .entries b { color:var(--warn); }
  .survey .zero { color:var(--warn); font-weight:600; }
  .survey .none { color:var(--dim); }

  .gap { border-top:1px solid var(--line); padding-top:1.5rem; }
  .two { display:grid; gap:.9rem; grid-template-columns:repeat(auto-fit,minmax(19rem,1fr)); margin:.8rem 0 1rem; }
  .two > div { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:.9rem 1rem; }
  .two p { margin:.5rem 0 0; color:var(--dim); font-size:.85rem; }
  .two strong { color:var(--ink); }
`;
document.head.append(style);
