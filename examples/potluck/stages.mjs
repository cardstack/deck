// Ten intentional Stages for the potluck form Timeline.
// Each Step should read differently: fields, design, language, errors, preview.

const IMPORTMAP = `{
  "imports": {
    "fields/due-date": "/site/fields/due-date@1.0.0/index.js",
    "fields/due-date/": "/site/fields/due-date@1.0.0/",
    "fields/handle": "/site/fields/handle@1.0.0/index.js",
    "fields/handle/": "/site/fields/handle@1.0.0/",
    "fields/meeting-slot": "/site/fields/meeting-slot@1.0.0/index.js",
    "fields/meeting-slot/": "/site/fields/meeting-slot@1.0.0/",
    "prosemirror-model": "/site/lib/prosemirror-model@1.25.11/dist/index.js",
    "prosemirror-state": "/site/lib/prosemirror-state@1.4.4/dist/index.js",
    "prosemirror-view": "/site/lib/prosemirror-view@1.42.2/dist/index.js",
    "prosemirror-keymap": "/site/lib/prosemirror-keymap@1.2.3/dist/index.js",
    "prosemirror-commands": "/site/lib/prosemirror-commands@1.7.2/dist/index.js",
    "prosemirror-history": "/site/lib/prosemirror-history@1.5.0/dist/index.js",
    "prosemirror-schema-basic": "/site/lib/prosemirror-schema-basic@1.2.4/dist/index.js",
    "ui/pills": "/site/ui/pills@1.0.0/pills.js",
    "ui/pills/": "/site/ui/pills@1.0.0/"
  },
  "deck": {
    "packages": {
      "form": { "version": "0.1.0", "entry": "$DECK/form.js" }
    },
    "dependencies": {
      "fields/due-date": "^1.0.0",
      "fields/handle": "^1.0.0",
      "fields/meeting-slot": "^1.0.0",
      "prosemirror-model": "lib/prosemirror-model@^1.25.0",
      "prosemirror-state": "lib/prosemirror-state@^1.4.0",
      "prosemirror-view": "lib/prosemirror-view@^1.42.0",
      "prosemirror-keymap": "lib/prosemirror-keymap@^1.2.0",
      "prosemirror-commands": "lib/prosemirror-commands@^1.7.0",
      "prosemirror-history": "lib/prosemirror-history@^1.5.0",
      "prosemirror-schema-basic": "lib/prosemirror-schema-basic@^1.2.0",
      "ui/pills": "^1.0.0"
    }
  },
  "scopes": {
    "/site/fields/due-date@1.0.0/": {
      "date-fns": "/site/lib/date-fns@4.1.0/index.js",
      "date-fns/": "/site/lib/date-fns@4.1.0/",
      "zod": "/site/lib/zod@3.25.76/v3/index.js",
      "zod/": "/site/lib/zod@3.25.76/"
    },
    "/site/fields/handle@1.0.0/": {
      "nanoid": "/site/lib/nanoid@5.0.9/index.browser.js",
      "nanoid/": "/site/lib/nanoid@5.0.9/",
      "zod": "/site/lib/zod@3.25.76/v3/index.js",
      "zod/": "/site/lib/zod@3.25.76/"
    },
    "/site/fields/meeting-slot@1.0.0/": {
      "luxon": "/site/lib/luxon@3.5.0/src/luxon.js",
      "luxon/": "/site/lib/luxon@3.5.0/",
      "zod": "/site/lib/zod@3.25.76/v3/index.js",
      "zod/": "/site/lib/zod@3.25.76/"
    },
    "/site/lib/prosemirror-commands@1.7.2/": {
      "prosemirror-model": "/site/lib/prosemirror-model@1.25.11/dist/index.js",
      "prosemirror-state": "/site/lib/prosemirror-state@1.4.4/dist/index.js",
      "prosemirror-transform": "/site/lib/prosemirror-transform@1.12.0/dist/index.js"
    },
    "/site/lib/prosemirror-history@1.5.0/": {
      "prosemirror-state": "/site/lib/prosemirror-state@1.4.4/dist/index.js",
      "prosemirror-transform": "/site/lib/prosemirror-transform@1.12.0/dist/index.js",
      "rope-sequence": "/site/lib/rope-sequence@1.3.4/dist/index.js"
    },
    "/site/lib/prosemirror-keymap@1.2.3/": {
      "prosemirror-state": "/site/lib/prosemirror-state@1.4.4/dist/index.js",
      "w3c-keyname": "/site/lib/w3c-keyname@2.2.8/index.js"
    },
    "/site/lib/prosemirror-model@1.25.11/": {
      "orderedmap": "/site/lib/orderedmap@2.1.1/dist/index.js"
    },
    "/site/lib/prosemirror-schema-basic@1.2.4/": {
      "prosemirror-model": "/site/lib/prosemirror-model@1.25.11/dist/index.js"
    },
    "/site/lib/prosemirror-state@1.4.4/": {
      "prosemirror-model": "/site/lib/prosemirror-model@1.25.11/dist/index.js",
      "prosemirror-transform": "/site/lib/prosemirror-transform@1.12.0/dist/index.js"
    },
    "/site/lib/prosemirror-transform@1.12.0/": {
      "prosemirror-model": "/site/lib/prosemirror-model@1.25.11/dist/index.js"
    },
    "/site/lib/prosemirror-view@1.42.2/": {
      "prosemirror-model": "/site/lib/prosemirror-model@1.25.11/dist/index.js",
      "prosemirror-state": "/site/lib/prosemirror-state@1.4.4/dist/index.js",
      "prosemirror-transform": "/site/lib/prosemirror-transform@1.12.0/dist/index.js"
    }
  }
}
`;

function page({ title, bodyClass, main }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="./form.css" />
  <script type="importmap">${IMPORTMAP}</script>
  <script type="module" src="/_live/hmr.js"></script>
</head>
<body class="${bodyClass}">
${main}
<script type="module" src="./form.js"></script>
</body>
</html>
`;
}

export const STAGE = [
  // 1 — bare bones, almost no design
  {
    label: '1 bare dish field',
    html: page({
      title: 'potluck',
      bodyClass: 's1',
      main: `<main>
  <h1>potluck</h1>
  <form id="form">
    <label>dish <input name="dish" /></label>
    <button type="submit">send</button>
  </form>
  <p id="status" hidden></p>
</main>`,
    }),
    css: `body.s1 { font-family: system-ui; margin: 2rem; }
body.s1 input { display: block; margin: 0.5rem 0 1rem; }
body.s1 #status { color: green; }`,
    js: `const form = document.getElementById('form');
const status = document.getElementById('status');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  status.hidden = false;
  status.textContent = 'ok: ' + new FormData(form).get('dish');
});
`,
    importmap: IMPORTMAP,
  },

  // 2 — design pass
  {
    label: '2 design: brand + layout',
    html: page({
      title: 'Office Potluck',
      bodyClass: 's2',
      main: `<main class="card">
  <p class="brand">Office Potluck</p>
  <h1>Bring a dish</h1>
  <p class="lede">Sign up so we know what hits the table.</p>
  <form id="form">
    <label>Dish name <input name="dish" placeholder="e.g. lemon bars" /></label>
    <button type="submit">Sign up</button>
  </form>
  <p id="status" class="status" hidden></p>
</main>`,
    }),
    css: `:root { --ink:#1a2332; --paper:#f6f1e8; --accent:#c45c26; --line:#d9d0c3; }
body.s2 { margin:0; min-height:100vh; display:grid; place-items:center;
  background: radial-gradient(80% 60% at 20% 0%, #efe4d4, var(--paper));
  color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; }
body.s2 .card { width:min(28rem,92vw); padding:2rem; border:1px solid var(--line); background:#fffdf8; }
body.s2 .brand { margin:0; font-size:0.8rem; letter-spacing:0.14em; text-transform:uppercase; color:var(--accent); }
body.s2 h1 { margin:0.4rem 0 0.3rem; font-size:2rem; letter-spacing:-0.03em; }
body.s2 .lede { margin:0 0 1.4rem; color:#5c5348; }
body.s2 label { display:grid; gap:0.35rem; font-size:0.95rem; margin-bottom:1rem; }
body.s2 input { font:inherit; padding:0.65rem 0.75rem; border:1px solid var(--line); background:#fff; }
body.s2 button { font:inherit; padding:0.7rem 1.1rem; border:0; background:var(--ink); color:#fff; cursor:pointer; }
body.s2 .status { margin-top:1rem; color:#2f6b3a; }`,
    js: `const form = document.getElementById('form');
const status = document.getElementById('status');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  status.hidden = false;
  status.textContent = 'Signed up: ' + new FormData(form).get('dish');
});
`,
    importmap: IMPORTMAP,
  },

  // 3 — add handle field
  {
    label: '3 add handle field',
    html: page({
      title: 'Office Potluck',
      bodyClass: 's3',
      main: `<main class="card">
  <p class="brand">Office Potluck</p>
  <h1>Bring a dish</h1>
  <p class="lede">Sign up so we know what hits the table.</p>
  <form id="form">
    <label>Your handle <input name="prefix" placeholder="sam" autocomplete="username" />
      <span class="hint" id="handle-hint">We’ll mint a unique id.</span></label>
    <label>Dish name <input name="dish" placeholder="e.g. lemon bars" /></label>
    <button type="submit">Sign up</button>
  </form>
  <p id="status" class="status" hidden></p>
</main>`,
    }),
    css: `:root { --ink:#1a2332; --paper:#f6f1e8; --accent:#c45c26; --line:#d9d0c3; }
body.s3 { margin:0; min-height:100vh; display:grid; place-items:center;
  background: radial-gradient(80% 60% at 20% 0%, #efe4d4, var(--paper));
  color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; }
body.s3 .card { width:min(28rem,92vw); padding:2rem; border:1px solid var(--line); background:#fffdf8; }
body.s3 .brand { margin:0; font-size:0.8rem; letter-spacing:0.14em; text-transform:uppercase; color:var(--accent); }
body.s3 h1 { margin:0.4rem 0 0.3rem; font-size:2rem; letter-spacing:-0.03em; }
body.s3 .lede { margin:0 0 1.4rem; color:#5c5348; }
body.s3 label { display:grid; gap:0.35rem; font-size:0.95rem; margin-bottom:1rem; }
body.s3 .hint { font-size:0.8rem; color:#7a7166; }
body.s3 input { font:inherit; padding:0.65rem 0.75rem; border:1px solid var(--line); background:#fff; }
body.s3 button { font:inherit; padding:0.7rem 1.1rem; border:0; background:var(--ink); color:#fff; cursor:pointer; }
body.s3 .status { margin-top:1rem; color:#2f6b3a; }`,
    js: `import { field as handleField } from 'fields/handle';
const form = document.getElementById('form');
const status = document.getElementById('status');
const hint = document.getElementById('handle-hint');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const minted = handleField.mint({ prefix: data.prefix || 'guest' });
  hint.textContent = 'Your signup id: ' + handleField.format(minted);
  status.hidden = false;
  status.textContent = handleField.format(minted) + ' · bringing ' + data.dish;
});
`,
    importmap: IMPORTMAP,
  },

  // 4 — add due-date
  {
    label: '4 add event date field',
    html: page({
      title: 'Office Potluck',
      bodyClass: 's4',
      main: `<main class="card">
  <p class="brand">Office Potluck</p>
  <h1>Bring a dish</h1>
  <p class="lede">Sign up so we know what hits the table.</p>
  <form id="form">
    <label>Your handle <input name="prefix" placeholder="sam" /></label>
    <label>Event day <input name="due" type="date" /></label>
    <p class="hint" id="date-hint"></p>
    <label>Dish name <input name="dish" placeholder="e.g. lemon bars" /></label>
    <button type="submit">Sign up</button>
  </form>
  <p id="status" class="status" hidden></p>
</main>`,
    }),
    css: `:root { --ink:#1a2332; --paper:#f6f1e8; --accent:#c45c26; --line:#d9d0c3; --soon:#9a6b16; --overdue:#9b2c2c; }
body.s4 { margin:0; min-height:100vh; display:grid; place-items:center;
  background: radial-gradient(80% 60% at 20% 0%, #efe4d4, var(--paper));
  color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; }
body.s4 .card { width:min(30rem,92vw); padding:2rem; border:1px solid var(--line); background:#fffdf8; }
body.s4 .brand { margin:0; font-size:0.8rem; letter-spacing:0.14em; text-transform:uppercase; color:var(--accent); }
body.s4 h1 { margin:0.4rem 0 0.3rem; font-size:2rem; }
body.s4 .lede { margin:0 0 1.4rem; color:#5c5348; }
body.s4 label { display:grid; gap:0.35rem; margin-bottom:0.85rem; }
body.s4 .hint { margin:-0.4rem 0 1rem; font-size:0.85rem; color:#7a7166; }
body.s4 .hint.soon { color:var(--soon); } body.s4 .hint.overdue { color:var(--overdue); }
body.s4 input { font:inherit; padding:0.65rem 0.75rem; border:1px solid var(--line); }
body.s4 button { font:inherit; padding:0.7rem 1.1rem; border:0; background:var(--ink); color:#fff; cursor:pointer; }
body.s4 .status { margin-top:1rem; color:#2f6b3a; }`,
    js: `import { field as handleField } from 'fields/handle';
import { field as dueDate } from 'fields/due-date';
const form = document.getElementById('form');
const status = document.getElementById('status');
const dateHint = document.getElementById('date-hint');
form.due.addEventListener('change', () => {
  if (!form.due.value) { dateHint.textContent = ''; return; }
  const value = { due: form.due.value };
  dateHint.textContent = dueDate.format(value);
  dateHint.className = 'hint ' + dueDate.tone(value);
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const minted = handleField.mint({ prefix: data.prefix || 'guest' });
  status.hidden = false;
  status.textContent = handleField.format(minted) + ' · ' + data.dish +
    (data.due ? ' · ' + dueDate.format({ due: data.due }) : '');
});
`,
    importmap: IMPORTMAP,
  },

  // 5 — language pass
  {
    label: '5 language: warmer copy',
    html: page({
      title: 'Thursday Potluck',
      bodyClass: 's5',
      main: `<main class="card">
  <p class="brand">Thursday Potluck</p>
  <h1>What are you bringing?</h1>
  <p class="lede">One dish per person. We’ll print name tags from your handle.</p>
  <form id="form">
    <label title="drawn by fields/handle">Handle <span class="req">needed</span>
      <input name="prefix" placeholder="lowercase, like mai" /></label>
    <label>Which Thursday?
      <input name="due" type="date" /></label>
    <p class="hint" id="date-hint">Pick the lunch date.</p>
    <label>Dish
      <input name="dish" placeholder="Something shareable — savory or sweet" /></label>
    <button type="submit">Save my spot</button>
  </form>
  <p id="status" class="status" hidden></p>
</main>`,
    }),
    css: `:root { --ink:#1a2332; --paper:#f6f1e8; --accent:#c45c26; --line:#d9d0c3; --soon:#9a6b16; --overdue:#9b2c2c; }
body.s5 { margin:0; min-height:100vh; display:grid; place-items:center;
  background: linear-gradient(160deg, #2a2118 0%, #1a2332 40%, #243044 100%);
  color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; }
body.s5 .card { width:min(30rem,92vw); padding:2.25rem; border:1px solid #fff3; background:#fffdf8;
  box-shadow: 0 24px 60px #0006; }
body.s5 .brand { margin:0; font-size:0.78rem; letter-spacing:0.16em; text-transform:uppercase; color:var(--accent); }
body.s5 h1 { margin:0.45rem 0 0.4rem; font-size:2.1rem; line-height:1.1; }
body.s5 .lede { margin:0 0 1.5rem; color:#5c5348; }
body.s5 label { display:grid; gap:0.35rem; margin-bottom:0.9rem; }
body.s5 .req { justify-self:start; font-size:0.7rem; letter-spacing:0.08em; text-transform:uppercase; color:var(--accent); }
body.s5 .hint { margin:-0.35rem 0 1rem; font-size:0.85rem; color:#7a7166; }
body.s5 .hint.soon { color:var(--soon); } body.s5 .hint.overdue { color:var(--overdue); }
body.s5 input { font:inherit; padding:0.7rem 0.8rem; border:1px solid var(--line); border-radius:2px; }
body.s5 button { font:inherit; padding:0.8rem 1.2rem; border:0; background:var(--accent); color:#fff; cursor:pointer; }
body.s5 .status { margin-top:1rem; color:#2f6b3a; }`,
    js: `import { field as handleField } from 'fields/handle';
import { field as dueDate } from 'fields/due-date';
const form = document.getElementById('form');
const status = document.getElementById('status');
const dateHint = document.getElementById('date-hint');
form.due.addEventListener('change', () => {
  if (!form.due.value) { dateHint.textContent = 'Pick the lunch date.'; dateHint.className='hint'; return; }
  const value = { due: form.due.value };
  dateHint.textContent = dueDate.format(value);
  dateHint.className = 'hint ' + dueDate.tone(value);
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const minted = handleField.mint({ prefix: data.prefix || 'guest' });
  status.hidden = false;
  status.textContent = 'You’re on the list as ' + handleField.format(minted) +
    (data.dish ? ' with ' + data.dish : '') + '.';
});
`,
    importmap: IMPORTMAP,
  },

  // 6 — ProseMirror notes
  {
    label: '6 ProseMirror notes editor',
    html: page({
      title: 'Thursday Potluck',
      bodyClass: 's6',
      main: `<main class="card">
  <p class="brand">Thursday Potluck</p>
  <h1>What are you bringing?</h1>
  <p class="lede">One dish per person. Add allergens or reheating notes below.</p>
  <form id="form">
    <label>Handle <input name="prefix" placeholder="mai" /></label>
    <label>Which Thursday? <input name="due" type="date" /></label>
    <p class="hint" id="date-hint">Pick the lunch date.</p>
    <label>Dish <input name="dish" placeholder="Shareable — savory or sweet" /></label>
    <div class="field" title="drawn by prosemirror, vendored into this depot">
      <span class="flabel">Notes</span>
      <div id="editor" class="editor"></div>
      <p class="hint">Bold ⌘B · Italic ⌘I — powered by ProseMirror in this depot.</p>
    </div>
    <button type="submit">Save my spot</button>
  </form>
  <p id="status" class="status" hidden></p>
</main>`,
    }),
    css: `:root { --ink:#1a2332; --paper:#f6f1e8; --accent:#c45c26; --line:#d9d0c3; --soon:#9a6b16; --overdue:#9b2c2c; }
body.s6 { margin:0; min-height:100vh; display:grid; place-items:center; padding:2rem 0;
  background: linear-gradient(160deg, #2a2118 0%, #1a2332 40%, #243044 100%);
  color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; }
body.s6 .card { width:min(34rem,92vw); padding:2.25rem; border:1px solid #fff3; background:#fffdf8; box-shadow:0 24px 60px #0006; }
body.s6 .brand { margin:0; font-size:0.78rem; letter-spacing:0.16em; text-transform:uppercase; color:var(--accent); }
body.s6 h1 { margin:0.45rem 0 0.4rem; font-size:2.1rem; }
body.s6 .lede { margin:0 0 1.5rem; color:#5c5348; }
body.s6 label, body.s6 .field { display:grid; gap:0.35rem; margin-bottom:0.9rem; }
body.s6 .flabel { font-size:0.95rem; }
body.s6 .hint { margin:-0.2rem 0 0.6rem; font-size:0.82rem; color:#7a7166; }
body.s6 .hint.soon { color:var(--soon); } body.s6 .hint.overdue { color:var(--overdue); }
body.s6 input { font:inherit; padding:0.7rem 0.8rem; border:1px solid var(--line); }
body.s6 .editor { min-height:7rem; border:1px solid var(--line); background:#fff; padding:0.6rem 0.75rem; }
body.s6 .ProseMirror { outline:none; min-height:5.5rem; }
body.s6 .ProseMirror p { margin:0 0 0.5rem; }
body.s6 button { font:inherit; padding:0.8rem 1.2rem; border:0; background:var(--accent); color:#fff; cursor:pointer; }
body.s6 .status { margin-top:1rem; color:#2f6b3a; }`,
    js: `import { field as handleField } from 'fields/handle';
import { field as dueDate } from 'fields/due-date';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';

const form = document.getElementById('form');
const status = document.getElementById('status');
const dateHint = document.getElementById('date-hint');
const scrubbing = /\\/_history\\//.test(location.pathname);

const view = new EditorView(document.getElementById('editor'), {
  state: EditorState.create({
    schema,
    plugins: [
      history(),
      keymap({
        'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo,
        'Mod-b': toggleMark(schema.marks.strong),
        'Mod-i': toggleMark(schema.marks.em),
      }),
      keymap(baseKeymap),
    ],
  }),
  editable: () => !scrubbing,
});

form.due.addEventListener('change', () => {
  if (!form.due.value) { dateHint.textContent = 'Pick the lunch date.'; dateHint.className='hint'; return; }
  const value = { due: form.due.value };
  dateHint.textContent = dueDate.format(value);
  dateHint.className = 'hint ' + dueDate.tone(value);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const minted = handleField.mint({ prefix: data.prefix || 'guest' });
  const notes = view.state.doc.textContent.trim();
  status.hidden = false;
  status.textContent = 'You’re on the list as ' + handleField.format(minted) +
    (data.dish ? ' with ' + data.dish : '') +
    (notes ? ' — notes saved (' + notes.length + ' chars)' : '') + '.';
});
`,
    importmap: IMPORTMAP,
  },

  // 7 — error handling
  {
    label: '7 inline validation errors',
    html: page({
      title: 'Thursday Potluck',
      bodyClass: 's7',
      main: `<main class="card">
  <p class="brand">Thursday Potluck</p>
  <h1>What are you bringing?</h1>
  <p class="lede">One dish per person. Fields marked needed can’t be empty.</p>
  <form id="form" novalidate>
    <label title="drawn by fields/handle">Handle <span class="req">needed</span>
      <input name="prefix" placeholder="mai" aria-describedby="err-prefix" />
      <span class="error" id="err-prefix" hidden></span></label>
    <label>Which Thursday? <span class="req">needed</span>
      <input name="due" type="date" aria-describedby="err-due" />
      <span class="error" id="err-due" hidden></span></label>
    <p class="hint" id="date-hint">Pick the lunch date.</p>
    <label>Dish <span class="req">needed</span>
      <input name="dish" placeholder="Shareable — savory or sweet" aria-describedby="err-dish" />
      <span class="error" id="err-dish" hidden></span></label>
    <div class="field" title="drawn by prosemirror, vendored into this depot">
      <span class="flabel">Notes <span class="opt">optional</span></span>
      <div id="editor" class="editor"></div>
    </div>
    <button type="submit">Save my spot</button>
  </form>
  <p id="status" class="status" hidden></p>
</main>`,
    }),
    css: `:root { --ink:#1a2332; --paper:#f6f1e8; --accent:#c45c26; --line:#d9d0c3; --danger:#9b2c2c; --soon:#9a6b16; }
body.s7 { margin:0; min-height:100vh; display:grid; place-items:center; padding:2rem 0;
  background: linear-gradient(160deg, #2a2118 0%, #1a2332 40%, #243044 100%);
  color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; }
body.s7 .card { width:min(34rem,92vw); padding:2.25rem; border:1px solid #fff3; background:#fffdf8; box-shadow:0 24px 60px #0006; }
body.s7 .brand { margin:0; font-size:0.78rem; letter-spacing:0.16em; text-transform:uppercase; color:var(--accent); }
body.s7 h1 { margin:0.45rem 0 0.4rem; font-size:2.1rem; }
body.s7 .lede { margin:0 0 1.5rem; color:#5c5348; }
body.s7 label, body.s7 .field { display:grid; gap:0.35rem; margin-bottom:0.9rem; }
body.s7 .req, body.s7 .opt { font-size:0.68rem; letter-spacing:0.08em; text-transform:uppercase; }
body.s7 .req { color:var(--accent); } body.s7 .opt { color:#8a8074; }
body.s7 .hint { margin:-0.2rem 0 0.6rem; font-size:0.82rem; color:#7a7166; }
body.s7 .hint.soon { color:var(--soon); } body.s7 .hint.overdue { color:var(--danger); }
body.s7 .error { color:var(--danger); font-size:0.85rem; }
body.s7 input { font:inherit; padding:0.7rem 0.8rem; border:1px solid var(--line); }
body.s7 input.invalid { border-color:var(--danger); background:#fff8f6; }
body.s7 .editor { min-height:7rem; border:1px solid var(--line); background:#fff; padding:0.6rem 0.75rem; }
body.s7 .ProseMirror { outline:none; min-height:5.5rem; }
body.s7 button { font:inherit; padding:0.8rem 1.2rem; border:0; background:var(--accent); color:#fff; cursor:pointer; }
body.s7 .status { margin-top:1rem; color:#2f6b3a; }`,
    js: `import { field as handleField } from 'fields/handle';
import { field as dueDate } from 'fields/due-date';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';

const form = document.getElementById('form');
const status = document.getElementById('status');
const dateHint = document.getElementById('date-hint');
const scrubbing = /\\/_history\\//.test(location.pathname);
const view = new EditorView(document.getElementById('editor'), {
  state: EditorState.create({
    schema,
    plugins: [history(), keymap({
      'Mod-z': undo, 'Shift-Mod-z': redo,
      'Mod-b': toggleMark(schema.marks.strong),
      'Mod-i': toggleMark(schema.marks.em),
    }), keymap(baseKeymap)],
  }),
  editable: () => !scrubbing,
});

function showError(name, message) {
  const input = form.elements[name];
  const err = document.getElementById('err-' + name);
  if (!err) return;
  if (message) {
    err.hidden = false; err.textContent = message;
    input?.classList.add('invalid');
  } else {
    err.hidden = true; err.textContent = '';
    input?.classList.remove('invalid');
  }
}

form.due.addEventListener('change', () => {
  if (!form.due.value) { dateHint.textContent = 'Pick the lunch date.'; dateHint.className='hint'; return; }
  const value = { due: form.due.value };
  const parsed = dueDate.schema.safeParse(value);
  if (!parsed.success) {
    showError('due', parsed.error.issues[0].message);
    return;
  }
  showError('due');
  dateHint.textContent = dueDate.format(value);
  dateHint.className = 'hint ' + dueDate.tone(value);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  status.hidden = true;
  let ok = true;
  const data = Object.fromEntries(new FormData(form));
  const handle = handleField.schema.safeParse(handleField.mint({ prefix: data.prefix || '' }));
  if (!data.prefix?.trim()) { showError('prefix', 'Add a short handle so we can print a name tag.'); ok = false; }
  else if (!handle.success) { showError('prefix', handle.error.issues[0].message); ok = false; }
  else showError('prefix');
  if (!data.due) { showError('due', 'Choose which Thursday.'); ok = false; }
  else {
    const d = dueDate.schema.safeParse({ due: data.due });
    if (!d.success) { showError('due', d.error.issues[0].message); ok = false; }
    else showError('due');
  }
  if (!data.dish?.trim()) { showError('dish', 'Tell us what you’re bringing.'); ok = false; }
  else showError('dish');
  if (!ok) return;
  const minted = handleField.mint({ prefix: data.prefix });
  status.hidden = false;
  status.textContent = 'You’re on the list as ' + handleField.format(minted) + ' with ' + data.dish + '.';
});
`,
    importmap: IMPORTMAP,
  },

  // 8 — meeting slot + better errors
  {
    label: '8 meeting-slot + clearer errors',
    html: page({
      title: 'Thursday Potluck',
      bodyClass: 's8',
      main: `<main class="card">
  <p class="brand">Thursday Potluck</p>
  <h1>What are you bringing?</h1>
  <p class="lede">Reserve your slot. Times are in the zone you pick.</p>
  <form id="form" novalidate>
    <label title="drawn by fields/handle">Handle <span class="req">needed</span>
      <input name="prefix" placeholder="mai" />
      <span class="error" id="err-prefix" hidden></span></label>
    <label title="drawn by fields/due-date">Lunch day <span class="req">needed</span>
      <input name="due" type="date" />
      <span class="error" id="err-due" hidden></span></label>
    <p class="hint" id="date-hint">Pick the lunch date.</p>
    <fieldset class="slot" title="drawn by fields/meeting-slot">
      <legend>Arrival window <span class="req">needed</span></legend>
      <label>Start <input name="start" type="time" value="12:00" /></label>
      <label>Minutes <input name="minutes" type="number" min="15" max="180" value="45" /></label>
      <label>Zone
        <select name="zone">
          <option value="America/New_York">America/New_York</option>
          <option value="America/Los_Angeles">America/Los_Angeles</option>
          <option value="Europe/London">Europe/London</option>
        </select>
      </label>
      <p class="hint" id="slot-hint"></p>
      <span class="error" id="err-slot" hidden></span>
    </fieldset>
    <label>Dish <span class="req">needed</span>
      <input name="dish" />
      <span class="error" id="err-dish" hidden></span></label>
    <div class="field" title="drawn by prosemirror, vendored into this depot">
      <span class="flabel">Notes <span class="opt">optional</span></span>
      <div id="editor" class="editor"></div>
    </div>
    <button type="submit">Save my spot</button>
  </form>
  <p id="status" class="status" hidden></p>
</main>`,
    }),
    css: `:root { --ink:#1a2332; --accent:#c45c26; --line:#d9d0c3; --danger:#9b2c2c; --soon:#9a6b16; }
body.s8 { margin:0; min-height:100vh; display:grid; place-items:center; padding:2rem 0;
  background: linear-gradient(160deg, #2a2118 0%, #1a2332 45%, #1f3d2e 100%);
  color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; }
body.s8 .card { width:min(36rem,94vw); padding:2.25rem; border:1px solid #fff3; background:#fffdf8; box-shadow:0 24px 60px #0006; }
body.s8 .brand { margin:0; font-size:0.78rem; letter-spacing:0.16em; text-transform:uppercase; color:var(--accent); }
body.s8 h1 { margin:0.45rem 0 0.4rem; font-size:2.1rem; }
body.s8 .lede { margin:0 0 1.5rem; color:#5c5348; }
body.s8 label, body.s8 .field { display:grid; gap:0.35rem; margin-bottom:0.85rem; }
body.s8 .slot { border:1px solid var(--line); padding:0.9rem 1rem 0.4rem; margin:0 0 1rem; display:grid; gap:0.6rem; grid-template-columns:1fr 1fr; }
body.s8 .slot legend { padding:0 0.35rem; }
body.s8 .slot .hint, body.s8 .slot .error { grid-column: 1 / -1; }
body.s8 .req, body.s8 .opt { font-size:0.68rem; letter-spacing:0.08em; text-transform:uppercase; }
body.s8 .req { color:var(--accent); } body.s8 .opt { color:#8a8074; }
body.s8 .hint { margin:0; font-size:0.82rem; color:#7a7166; }
body.s8 .hint.soon { color:var(--soon); } body.s8 .hint.overdue { color:var(--danger); }
body.s8 .error { color:var(--danger); font-size:0.85rem; }
body.s8 input, body.s8 select { font:inherit; padding:0.65rem 0.75rem; border:1px solid var(--line); }
body.s8 input.invalid, body.s8 select.invalid { border-color:var(--danger); background:#fff8f6; }
body.s8 .editor { min-height:6.5rem; border:1px solid var(--line); background:#fff; padding:0.6rem 0.75rem; grid-column:1/-1; }
body.s8 .ProseMirror { outline:none; min-height:5rem; }
body.s8 button { font:inherit; padding:0.8rem 1.2rem; border:0; background:var(--accent); color:#fff; cursor:pointer; }
body.s8 .status { margin-top:1rem; color:#2f6b3a; }`,
    js: `import { field as handleField } from 'fields/handle';
import { field as dueDate } from 'fields/due-date';
import { field as meetingSlot } from 'fields/meeting-slot';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';

const form = document.getElementById('form');
const status = document.getElementById('status');
const dateHint = document.getElementById('date-hint');
const slotHint = document.getElementById('slot-hint');
const scrubbing = /\\/_history\\//.test(location.pathname);
const view = new EditorView(document.getElementById('editor'), {
  state: EditorState.create({
    schema,
    plugins: [history(), keymap({
      'Mod-z': undo, 'Shift-Mod-z': redo,
      'Mod-b': toggleMark(schema.marks.strong),
      'Mod-i': toggleMark(schema.marks.em),
    }), keymap(baseKeymap)],
  }),
  editable: () => !scrubbing,
});

function showError(name, message) {
  const err = document.getElementById('err-' + name);
  const input = form.elements[name];
  if (!err) return;
  err.hidden = !message;
  err.textContent = message || '';
  input?.classList.toggle('invalid', Boolean(message));
}

function slotValue() {
  if (!form.due.value || !form.start.value) return null;
  return {
    start: form.due.value + 'T' + form.start.value + ':00',
    zone: form.zone.value,
    minutes: Number(form.minutes.value),
  };
}

function refreshSlot() {
  const value = slotValue();
  const err = document.getElementById('err-slot');
  if (!value) { slotHint.textContent = ''; err.hidden = true; return; }
  const parsed = meetingSlot.schema.safeParse(value);
  if (!parsed.success) {
    err.hidden = false;
    err.textContent = parsed.error.issues[0].message;
    slotHint.textContent = '';
    return;
  }
  err.hidden = true;
  slotHint.textContent = meetingSlot.format(value);
}

form.due.addEventListener('change', () => {
  if (!form.due.value) { dateHint.textContent = 'Pick the lunch date.'; return; }
  const value = { due: form.due.value };
  const parsed = dueDate.schema.safeParse(value);
  if (!parsed.success) { showError('due', 'Use a real calendar day (YYYY-MM-DD).'); return; }
  showError('due');
  dateHint.textContent = dueDate.format(value);
  dateHint.className = 'hint ' + dueDate.tone(value);
  refreshSlot();
});
for (const name of ['start', 'minutes', 'zone']) {
  form.elements[name].addEventListener('change', refreshSlot);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  status.hidden = true;
  let ok = true;
  const data = Object.fromEntries(new FormData(form));
  const handle = handleField.schema.safeParse(handleField.mint({ prefix: data.prefix || '' }));
  if (!data.prefix?.trim()) { showError('prefix', 'Handles start with a letter — try “mai”.'); ok = false; }
  else if (!handle.success) { showError('prefix', 'Use lowercase letters, numbers, or hyphens (2–12 chars).'); ok = false; }
  else showError('prefix');
  if (!data.due) { showError('due', 'Which Thursday is this for?'); ok = false; }
  else if (!dueDate.schema.safeParse({ due: data.due }).success) { showError('due', 'That date isn’t valid.'); ok = false; }
  else showError('due');
  const slot = slotValue();
  const slotParsed = slot && meetingSlot.schema.safeParse(slot);
  if (!slotParsed?.success) {
    document.getElementById('err-slot').hidden = false;
    document.getElementById('err-slot').textContent = 'Set a start time and duration (15–180 minutes).';
    ok = false;
  } else document.getElementById('err-slot').hidden = true;
  if (!data.dish?.trim()) { showError('dish', 'Name the dish so nobody doubles up.'); ok = false; }
  else showError('dish');
  if (!ok) return;
  const minted = handleField.mint({ prefix: data.prefix });
  status.hidden = false;
  status.textContent = handleField.format(minted) + ' · ' + data.dish + ' · ' + meetingSlot.format(slot);
});
`,
    importmap: IMPORTMAP,
  },

  // 9 — preview button
  {
    label: '9 preview before submit',
    html: page({
      title: 'Thursday Potluck',
      bodyClass: 's9',
      main: `<main class="layout">
  <section class="card">
    <p class="brand">Thursday Potluck</p>
    <h1>What are you bringing?</h1>
    <p class="lede">Preview the card we’ll post to the kitchen board.</p>
    <form id="form" novalidate>
      <label title="drawn by fields/handle">Handle <span class="req">needed</span>
        <input name="prefix" placeholder="mai" />
        <span class="error" id="err-prefix" hidden></span></label>
      <label title="drawn by fields/due-date">Lunch day <span class="req">needed</span>
        <input name="due" type="date" />
        <span class="error" id="err-due" hidden></span></label>
      <p class="hint" id="date-hint">Pick the lunch date.</p>
      <fieldset class="slot" title="drawn by fields/meeting-slot">
        <legend>Arrival window</legend>
        <label>Start <input name="start" type="time" value="12:00" /></label>
        <label>Minutes <input name="minutes" type="number" min="15" max="180" value="45" /></label>
        <label>Zone
          <select name="zone">
            <option value="America/New_York">America/New_York</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="Europe/London">Europe/London</option>
          </select>
        </label>
        <p class="hint" id="slot-hint"></p>
        <span class="error" id="err-slot" hidden></span>
      </fieldset>
      <label>Dish <span class="req">needed</span>
        <input name="dish" />
        <span class="error" id="err-dish" hidden></span></label>
      <div class="field" title="drawn by prosemirror, vendored into this depot">
        <span class="flabel">Notes</span>
        <div id="editor" class="editor"></div>
      </div>
      <div class="actions">
        <button type="button" data-role="preview">Preview</button>
        <button type="submit" class="primary">Confirm signup</button>
      </div>
    </form>
    <p id="status" class="status" hidden></p>
  </section>
  <aside class="preview" id="preview" hidden>
    <p class="brand">Kitchen board</p>
    <h2>Preview</h2>
    <article id="preview-card"></article>
  </aside>
</main>`,
    }),
    css: `:root { --ink:#1a2332; --accent:#c45c26; --line:#d9d0c3; --danger:#9b2c2c; --soon:#9a6b16; --board:#243528; }
body.s9 { margin:0; min-height:100vh; display:grid; place-items:center; padding:2rem 1rem;
  background: linear-gradient(160deg, #2a2118 0%, #1a2332 45%, #1f3d2e 100%);
  color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; }
body.s9 .layout { width:min(64rem,96vw); display:grid; gap:1.25rem; }
@media (min-width:900px) { body.s9 .layout { grid-template-columns: 1.1fr 0.9fr; align-items:start; } }
body.s9 .card, body.s9 .preview { padding:2rem; border:1px solid #fff3; background:#fffdf8; box-shadow:0 24px 60px #0006; }
body.s9 .preview { background: var(--board); color:#e7efe6; border-color:#3d5a45; }
body.s9 .preview .brand { color:#b7d4a8; }
body.s9 .preview h2 { margin:0.3rem 0 1rem; color:#fff; }
body.s9 .brand { margin:0; font-size:0.78rem; letter-spacing:0.16em; text-transform:uppercase; color:var(--accent); }
body.s9 h1 { margin:0.45rem 0 0.4rem; font-size:2rem; }
body.s9 .lede { margin:0 0 1.3rem; color:#5c5348; }
body.s9 label, body.s9 .field { display:grid; gap:0.35rem; margin-bottom:0.8rem; }
body.s9 .slot { border:1px solid var(--line); padding:0.9rem 1rem 0.4rem; margin:0 0 1rem; display:grid; gap:0.6rem; grid-template-columns:1fr 1fr; }
body.s9 .slot legend { padding:0 0.35rem; }
body.s9 .slot .hint, body.s9 .slot .error { grid-column:1/-1; }
body.s9 .req { font-size:0.68rem; letter-spacing:0.08em; text-transform:uppercase; color:var(--accent); }
body.s9 .hint { margin:0; font-size:0.82rem; color:#7a7166; }
body.s9 .preview .hint { color:#b7d4a8; }
body.s9 .error { color:var(--danger); font-size:0.85rem; }
body.s9 input, body.s9 select { font:inherit; padding:0.65rem 0.75rem; border:1px solid var(--line); }
body.s9 input.invalid { border-color:var(--danger); background:#fff8f6; }
body.s9 .editor { min-height:6rem; border:1px solid var(--line); background:#fff; padding:0.6rem 0.75rem; }
body.s9 .ProseMirror { outline:none; min-height:4.5rem; }
body.s9 .actions { display:flex; flex-wrap:wrap; gap:0.6rem; margin-top:0.4rem; }
body.s9 button { font:inherit; padding:0.75rem 1.1rem; border:1px solid var(--ink); background:transparent; color:var(--ink); cursor:pointer; }
body.s9 button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
body.s9 .status { margin-top:1rem; color:#2f6b3a; }
body.s9 #preview-card { border:1px dashed #6f8f72; padding:1rem; background:#1b291f; }
body.s9 #preview-card h3 { margin:0 0 0.35rem; font-size:1.35rem; color:#fff; }
body.s9 #preview-card p { margin:0.25rem 0; color:#cfe0cb; }
body.s9 #preview-card .tag { display:inline-block; margin-top:0.6rem; padding:0.2rem 0.45rem; background:#c45c26; color:#fff; font-size:0.75rem; letter-spacing:0.06em; text-transform:uppercase; }`,
    js: `import { field as handleField } from 'fields/handle';
import { field as dueDate } from 'fields/due-date';
import { field as meetingSlot } from 'fields/meeting-slot';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';

const form = document.getElementById('form');
const status = document.getElementById('status');
const preview = document.getElementById('preview');
const previewCard = document.getElementById('preview-card');
const dateHint = document.getElementById('date-hint');
const slotHint = document.getElementById('slot-hint');
const scrubbing = /\\/_history\\//.test(location.pathname);
const view = new EditorView(document.getElementById('editor'), {
  state: EditorState.create({
    schema,
    plugins: [history(), keymap({
      'Mod-z': undo, 'Shift-Mod-z': redo,
      'Mod-b': toggleMark(schema.marks.strong),
      'Mod-i': toggleMark(schema.marks.em),
    }), keymap(baseKeymap)],
  }),
  editable: () => !scrubbing,
});

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function showError(name, message) {
  const err = document.getElementById('err-' + name);
  const input = form.elements[name];
  if (!err) return;
  err.hidden = !message; err.textContent = message || '';
  input?.classList.toggle('invalid', Boolean(message));
}
function slotValue() {
  if (!form.due.value || !form.start.value) return null;
  return { start: form.due.value + 'T' + form.start.value + ':00', zone: form.zone.value, minutes: Number(form.minutes.value) };
}
function refreshHints() {
  if (form.due.value && dueDate.schema.safeParse({ due: form.due.value }).success) {
    const value = { due: form.due.value };
    dateHint.textContent = dueDate.format(value);
    dateHint.className = 'hint ' + dueDate.tone(value);
  }
  const slot = slotValue();
  if (slot && meetingSlot.schema.safeParse(slot).success) slotHint.textContent = meetingSlot.format(slot);
}
form.due.addEventListener('change', refreshHints);
for (const name of ['start', 'minutes', 'zone']) form.elements[name].addEventListener('change', refreshHints);

function collect() {
  const data = Object.fromEntries(new FormData(form));
  let ok = true;
  const handle = handleField.schema.safeParse(handleField.mint({ prefix: data.prefix || '' }));
  if (!data.prefix?.trim()) { showError('prefix', 'Handles start with a letter — try “mai”.'); ok = false; }
  else if (!handle.success) { showError('prefix', 'Use lowercase letters, numbers, or hyphens (2–12 chars).'); ok = false; }
  else showError('prefix');
  if (!data.due) { showError('due', 'Which Thursday is this for?'); ok = false; }
  else if (!dueDate.schema.safeParse({ due: data.due }).success) { showError('due', 'That date isn’t valid.'); ok = false; }
  else showError('due');
  const slot = slotValue();
  const slotOk = slot && meetingSlot.schema.safeParse(slot).success;
  document.getElementById('err-slot').hidden = Boolean(slotOk);
  if (!slotOk) { document.getElementById('err-slot').textContent = 'Set a start time and duration (15–180 minutes).'; ok = false; }
  if (!data.dish?.trim()) { showError('dish', 'Name the dish so nobody doubles up.'); ok = false; }
  else showError('dish');
  if (!ok) return null;
  return {
    handle: handleField.mint({ prefix: data.prefix }),
    due: { due: data.due },
    slot,
    dish: data.dish.trim(),
    notes: view.state.doc.textContent.trim(),
  };
}

function renderPreview(payload) {
  preview.hidden = false;
  previewCard.innerHTML =
    '<h3>' + esc(payload.dish) + '</h3>' +
    '<p>' + esc(handleField.format(payload.handle)) + '</p>' +
    '<p>' + esc(dueDate.format(payload.due)) + '</p>' +
    '<p>' + esc(meetingSlot.format(payload.slot)) + '</p>' +
    (payload.notes ? '<p>' + esc(payload.notes) + '</p>' : '<p class="hint">No notes</p>') +
    '<span class="tag">draft card</span>';
}

document.querySelector('[data-role="preview"]').addEventListener('click', () => {
  status.hidden = true;
  const payload = collect();
  if (payload) renderPreview(payload);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const payload = collect();
  if (!payload) return;
  renderPreview(payload);
  previewCard.querySelector('.tag').textContent = 'confirmed';
  status.hidden = false;
  status.textContent = 'Posted to the kitchen board as ' + handleField.format(payload.handle) + '.';
});
`,
    importmap: IMPORTMAP,
  },

  // 10 — polish + success + history-safe
  {
    label: '10 polish: success state',
    html: page({
      title: 'Thursday Potluck',
      bodyClass: 's10',
      main: `<main class="layout">
  <section class="card" id="form-panel">
    <p class="brand">Thursday Potluck</p>
    <h1>What are you bringing?</h1>
    <p class="lede">Preview the card, then confirm.</p>
    <form id="form" novalidate>
      <label title="drawn by fields/handle">Handle <span class="req">needed</span>
        <input name="prefix" placeholder="mai" />
        <span class="error" id="err-prefix" hidden></span></label>
      <label title="drawn by fields/due-date">Lunch day <span class="req">needed</span>
        <input name="due" type="date" />
        <span class="error" id="err-due" hidden></span></label>
      <p class="hint" id="date-hint">Pick the lunch date.</p>
      <fieldset class="slot" title="drawn by fields/meeting-slot">
        <legend>Arrival window</legend>
        <label>Start <input name="start" type="time" value="12:15" /></label>
        <label>Minutes <input name="minutes" type="number" min="15" max="180" value="60" /></label>
        <label>Zone
          <select name="zone">
            <option value="America/New_York">America/New_York</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="Europe/London">Europe/London</option>
          </select>
        </label>
        <p class="hint" id="slot-hint"></p>
        <span class="error" id="err-slot" hidden></span>
      </fieldset>
      <label>Dish <span class="req">needed</span>
        <input name="dish" placeholder="Kimchi fried rice" />
        <span class="error" id="err-dish" hidden></span></label>
      <div class="field" title="drawn by prosemirror, vendored into this depot">
        <span class="flabel">Notes for the table</span>
        <div id="editor" class="editor"></div>
      </div>
      <div class="actions">
        <button type="button" data-role="preview">Preview</button>
        <button type="submit" class="primary">Confirm signup</button>
      </div>
    </form>
  </section>
  <aside class="preview" id="preview">
    <p class="brand">Kitchen board</p>
    <h2 id="preview-title">Waiting for a preview</h2>
    <article id="preview-card" class="empty">Fill the form, then hit Preview.</article>
    <p id="status" class="status" hidden></p>
  </aside>
</main>`,
    }),
    css: `:root { --ink:#142018; --accent:#d9772c; --line:#d2c7b6; --danger:#9b2c2c; --soon:#9a6b16; --board:#1e2f24; }
body.s10 { margin:0; min-height:100vh; display:grid; place-items:center; padding:2rem 1rem;
  background:
    radial-gradient(70% 50% at 85% 10%, #3a5a40 0%, transparent 55%),
    linear-gradient(165deg, #211a14, #152018 55%, #1a2c22);
  color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; }
body.s10 .layout { width:min(66rem,96vw); display:grid; gap:1.25rem; }
@media (min-width:900px) { body.s10 .layout { grid-template-columns: 1.05fr 0.95fr; align-items:stretch; } }
body.s10 .card, body.s10 .preview { padding:2rem; border:1px solid #ffffff22; box-shadow:0 28px 70px #0007; }
body.s10 .card { background:#fffaf2; }
body.s10 .preview { background: var(--board); color:#e4f0e2; display:flex; flex-direction:column; }
body.s10 .preview .brand { color:#b8d7a9; }
body.s10 .brand { margin:0; font-size:0.78rem; letter-spacing:0.16em; text-transform:uppercase; color:var(--accent); }
body.s10 h1, body.s10 h2 { margin:0.4rem 0 0.45rem; letter-spacing:-0.02em; }
body.s10 h1 { font-size:2.05rem; } body.s10 h2 { font-size:1.35rem; color:#fff; }
body.s10 .lede { margin:0 0 1.3rem; color:#5c5348; }
body.s10 label, body.s10 .field { display:grid; gap:0.35rem; margin-bottom:0.8rem; }
body.s10 .slot { border:1px solid var(--line); padding:0.9rem 1rem 0.4rem; margin:0 0 1rem; display:grid; gap:0.6rem; grid-template-columns:1fr 1fr; background:#fff; }
body.s10 .slot legend { padding:0 0.35rem; }
body.s10 .slot .hint, body.s10 .slot .error { grid-column:1/-1; }
body.s10 .req { font-size:0.68rem; letter-spacing:0.08em; text-transform:uppercase; color:var(--accent); }
body.s10 .hint { margin:0; font-size:0.82rem; color:#7a7166; }
body.s10 .error { color:var(--danger); font-size:0.85rem; }
body.s10 input, body.s10 select { font:inherit; padding:0.65rem 0.75rem; border:1px solid var(--line); background:#fff; }
body.s10 input.invalid { border-color:var(--danger); background:#fff8f6; }
body.s10 .editor { min-height:6rem; border:1px solid var(--line); background:#fff; padding:0.6rem 0.75rem; }
body.s10 .ProseMirror { outline:none; min-height:4.5rem; }
body.s10 .actions { display:flex; flex-wrap:wrap; gap:0.6rem; }
body.s10 button { font:inherit; padding:0.75rem 1.1rem; border:1px solid var(--ink); background:transparent; cursor:pointer; }
body.s10 button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
body.s10 #preview-card { flex:1; border:1px solid #4d6b52; padding:1.1rem; background:#16241b; }
body.s10 #preview-card.empty { color:#9bb59a; display:grid; place-items:center; text-align:center; min-height:12rem; }
body.s10 #preview-card h3 { margin:0 0 0.4rem; font-size:1.5rem; color:#fff; }
body.s10 #preview-card p { margin:0.3rem 0; color:#cfe3cc; }
body.s10 #preview-card .tag { display:inline-block; margin-top:0.75rem; padding:0.25rem 0.5rem; background:var(--accent); color:#fff; font-size:0.72rem; letter-spacing:0.07em; text-transform:uppercase; }
body.s10 #preview-card.ok { border-color:#8fd19a; box-shadow: inset 0 0 0 1px #8fd19a55; }
body.s10 .status { margin-top:1rem; color:#b8e0b4; font-size:0.95rem; }
body.s10.done #form-panel { opacity:0.55; filter:grayscale(0.2); pointer-events:none; }`,
    js: `import { field as handleField } from 'fields/handle';
import { field as dueDate } from 'fields/due-date';
import { field as meetingSlot } from 'fields/meeting-slot';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';

const form = document.getElementById('form');
const status = document.getElementById('status');
const previewCard = document.getElementById('preview-card');
const previewTitle = document.getElementById('preview-title');
const dateHint = document.getElementById('date-hint');
const slotHint = document.getElementById('slot-hint');
const scrubbing = /\\/_history\\//.test(location.pathname);

const view = new EditorView(document.getElementById('editor'), {
  state: EditorState.create({
    schema,
    doc: schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('Contains peanuts · keep warm')]),
    ]),
    plugins: [history(), keymap({
      'Mod-z': undo, 'Shift-Mod-z': redo,
      'Mod-b': toggleMark(schema.marks.strong),
      'Mod-i': toggleMark(schema.marks.em),
    }), keymap(baseKeymap)],
  }),
  editable: () => !scrubbing,
});

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function showError(name, message) {
  const err = document.getElementById('err-' + name);
  const input = form.elements[name];
  if (!err) return;
  err.hidden = !message; err.textContent = message || '';
  input?.classList.toggle('invalid', Boolean(message));
}
function slotValue() {
  if (!form.due.value || !form.start.value) return null;
  return { start: form.due.value + 'T' + form.start.value + ':00', zone: form.zone.value, minutes: Number(form.minutes.value) };
}
function refreshHints() {
  if (form.due.value && dueDate.schema.safeParse({ due: form.due.value }).success) {
    const value = { due: form.due.value };
    dateHint.textContent = dueDate.format(value);
    dateHint.className = 'hint ' + dueDate.tone(value);
  }
  const slot = slotValue();
  if (slot && meetingSlot.schema.safeParse(slot).success) slotHint.textContent = meetingSlot.format(slot);
}
form.due.addEventListener('change', refreshHints);
for (const name of ['start', 'minutes', 'zone']) form.elements[name].addEventListener('change', refreshHints);

function collect() {
  const data = Object.fromEntries(new FormData(form));
  let ok = true;
  const handle = handleField.schema.safeParse(handleField.mint({ prefix: data.prefix || '' }));
  if (!data.prefix?.trim()) { showError('prefix', 'Handles start with a letter — try “mai”.'); ok = false; }
  else if (!handle.success) { showError('prefix', 'Use lowercase letters, numbers, or hyphens (2–12 chars).'); ok = false; }
  else showError('prefix');
  if (!data.due) { showError('due', 'Which Thursday is this for?'); ok = false; }
  else if (!dueDate.schema.safeParse({ due: data.due }).success) { showError('due', 'That date isn’t valid.'); ok = false; }
  else showError('due');
  const slot = slotValue();
  const slotOk = slot && meetingSlot.schema.safeParse(slot).success;
  document.getElementById('err-slot').hidden = Boolean(slotOk);
  if (!slotOk) { document.getElementById('err-slot').textContent = 'Set a start time and duration (15–180 minutes).'; ok = false; }
  if (!data.dish?.trim()) { showError('dish', 'Name the dish so nobody doubles up.'); ok = false; }
  else showError('dish');
  if (!ok) return null;
  return {
    handle: handleField.mint({ prefix: data.prefix }),
    due: { due: data.due },
    slot,
    dish: data.dish.trim(),
    notes: view.state.doc.textContent.trim(),
  };
}

function renderPreview(payload, confirmed) {
  previewTitle.textContent = confirmed ? 'On the board' : 'Preview';
  previewCard.classList.remove('empty');
  previewCard.classList.toggle('ok', confirmed);
  previewCard.innerHTML =
    '<h3>' + esc(payload.dish) + '</h3>' +
    '<p>' + esc(handleField.format(payload.handle)) + '</p>' +
    '<p>' + esc(dueDate.format(payload.due)) + '</p>' +
    '<p>' + esc(meetingSlot.format(payload.slot)) + '</p>' +
    (payload.notes ? '<p>' + esc(payload.notes) + '</p>' : '<p>No notes</p>') +
    '<span class="tag">' + (confirmed ? 'confirmed' : 'draft card') + '</span>';
}

document.querySelector('[data-role="preview"]').addEventListener('click', () => {
  status.hidden = true;
  document.body.classList.remove('done');
  const payload = collect();
  if (payload) renderPreview(payload, false);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const payload = collect();
  if (!payload) return;
  renderPreview(payload, true);
  document.body.classList.add('done');
  status.hidden = false;
  status.textContent = 'You’re confirmed — ' + handleField.format(payload.handle) + ' is on the kitchen board.';
});
`,
    importmap: IMPORTMAP,
  },
];
