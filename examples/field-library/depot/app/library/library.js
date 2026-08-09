// A form builder, and one field you can edit.
//
// The form is assembled from seven decks. Six come from the catalogue and
// are sealed. The seventh, `you/ship-by`, is yours: the pane on the right
// writes its source to disk, the watcher publishes the result, and the form
// re-renders at whichever Version you pick.
//
// Two things are worth watching in the URL bar while you use this page.
//
//   ?with=you/ship-by@1.0.0-dev.3   picks a published Version
//   ?with=you/ship-by               picks the working tree, unpublished
//
// `?with=` is not a demo router. The server re-resolves this document's
// import map for one request, using the same rules `deck lock` uses at write
// time, and it reaches inside the scopes as well — so the substitute brings
// its own date-fns and its own zod with it.
import { field as auditStamp } from 'fields/audit-stamp';
import { field as brandSwatch } from 'fields/brand-swatch';
import { field as dueDate } from 'fields/due-date';
import { field as handle } from 'fields/handle';
import { field as meetingSlot } from 'fields/meeting-slot';
import { field as swatch } from 'fields/swatch';
import { installPillStyles, pill } from 'ui/pills';

const shelf = await (await fetch('./shelf.json')).json();
const DEPOT = shelf.depot;
const MINE = 'you/ship-by';
const params = new URLSearchParams(location.search);
// `?with=you/ship-by` with no version means the working tree, which is a
// different answer from "no ?with= at all" and has to stay different.
const asked = params.get('with');
const picked = asked === null ? '1.0.0' : asked === MINE ? 'live' : asked.replace(`${MINE}@`, '');
// Where the editor bridge is listening, asked of the origin this page came
// from. It cannot be guessed: this demo runs standalone on a fixed port and
// inside the Hub on one the kernel chose, and the answer differs. The
// declared port in shelf.json is the fallback for a page opened from a build
// that predates the route.
const BRIDGE = await fetch('/_demo/editor')
  .then((response) => (response.ok ? response.json() : undefined))
  .then((found) => found?.origin)
  .catch(() => undefined)
  ?? `${location.protocol}//${location.hostname}:${shelf.bridgePort ?? Number(location.port) + 1}`;

installPillStyles();

// ── The editable field ──────────────────────────────────────────────────
// Dynamic, and inside a try, for one reason: you are about to edit it. A
// static import of a file with a typo in it takes the whole page down and
// tells you nothing. This way a broken save is a message in the form.
let mine;
let mineError;
try {
  ({ field: mine } = await import('ship-by'));
} catch (error) {
  mineError = error;
}

// ── The form ────────────────────────────────────────────────────────────
// One row per control. The field deck decides how its value reads; the form
// only decides where it sits and what kind of input collects it. That split
// is the whole argument for fields being their own decks.
const ROWS = [
  { deck: 'fields/handle', field: handle, label: 'Reference', key: 'prefix', input: 'text', value: { prefix: 'crate' } },
  { deck: 'fields/swatch', field: swatch, label: 'Label colour', key: 'hex', input: 'color', value: { hex: '#6638ff', label: 'route purple' } },
  { deck: MINE, field: mine, label: 'Ship by', key: 'ship', input: 'date', value: { ship: '2026-09-20' }, mine: true },
  { deck: 'fields/meeting-slot', field: meetingSlot, label: 'Dock slot', key: 'start', input: 'datetime-local', value: meetingSlot.examples[0] },
  { deck: 'fields/due-date', field: dueDate, label: 'Invoice due', key: 'due', input: 'date', value: { due: '2026-10-02', note: 'invoice 3391' } },
  { deck: 'fields/audit-stamp', field: auditStamp, label: 'Booked by', key: null, input: null, value: auditStamp.examples[0] },
];

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const READER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const state = new Map(ROWS.map((row) => [row.deck, structuredClone(row.value)]));

function readout(row) {
  let field = row.field;
  let value = state.get(row.deck);
  if (!field) {
    return `<div class="broken">${esc(String(mineError?.message ?? mineError))}</div>`;
  }
  let shaped =
    field.name === 'Handle' ? field.mint(value) : field.name === 'AuditStamp' ? field.stamp(value) : value;
  let checked = field.schema.safeParse(shaped);
  let parts = [`<div class="read">${esc(field.format(value))}</div>`];
  if (field.tone) {
    let tone = field.tone(value);
    parts.push(`<span class="tone t-${esc(tone)}">${esc(tone)}</span>`);
  }
  if (field.css) {
    let { background, foreground } = field.css(value);
    parts.push(
      `<span class="chip" style="background:${esc(background)};color:${esc(foreground)}">${esc(value.label ?? value.hex)}</span>`,
    );
  }
  if (field.inZone) {
    parts.push(`<span class="quiet">${esc(field.inZone(value, READER_ZONE))} for you</span>`);
  }
  // Nothing declares this. A field that grows a `bar` gets a bar, and the
  // form finds out at render time — which is what you see when you apply
  // the third suggested edit.
  if (field.bar) {
    let fill = Math.max(0, Math.min(1, field.bar(value)));
    parts.push(`<div class="bar"><i style="width:${(fill * 100).toFixed(1)}%"></i></div>`);
  }
  if (!checked.success) {
    parts.push(`<span class="invalid">${esc(checked.error.issues[0].message)}</span>`);
  }
  return parts.join('');
}

function formHtml() {
  return ROWS.map((row) => {
    let value = state.get(row.deck);
    let control =
      row.input && row.key
        ? `<input type="${row.input}" value="${esc(value[row.key])}" data-deck="${esc(row.deck)}" data-key="${esc(row.key)}" />`
        : '<span class="auto">stamped automatically</span>';
    // Only the editable row wears its address. The other five are all at
    // 1.0.0 and saying so five times buys nothing — one line under the form
    // covers them, and the eye stays on the row that moves.
    return `<div class="row${row.mine ? ' mine' : ''}">
      <label>${esc(row.label)}</label>
      <div class="control">${control}</div>
      <div class="out" data-out="${esc(row.deck)}">${readout(row)}</div>
      ${
        row.mine
          ? `<div class="by">${pill('deck', picked === 'live' ? `${MINE} · working tree` : `${MINE}@${picked}`)}</div>`
          : ''
      }
    </div>`;
  }).join('');
}

function repaintRow(deck) {
  let row = ROWS.find((candidate) => candidate.deck === deck);
  let cell = document.querySelector(`[data-out="${CSS.escape(deck)}"]`);
  if (row && cell) cell.innerHTML = readout(row);
}

// ── The version rail ────────────────────────────────────────────────────
async function versionsOfMine() {
  // `cache: 'no-store'` matters. /_packages/<depot>/<publisher>/<package> is
  // a name resolution, and the server caches it for a minute — correct for a
  // consumer asking "what version answers to this name", and blinding for a
  // page waiting to see a new one appear. Asking for a fresh answer is the
  // caller's job, because only the caller knows it is polling.
  let response = await fetch(`/_packages/${DEPOT}/${MINE}`, { cache: 'no-store' });
  if (!response.ok) return { versions: {}, tags: {} };
  let { data } = await response.json();
  return { versions: data.attributes.versions ?? {}, tags: data.attributes.distTags ?? {} };
}

function railHtml({ versions, tags }) {
  let order = Object.keys(versions).sort((a, b) => {
    let n = (v) => Number(v.split('-dev.')[1] ?? -1);
    return n(a) - n(b);
  });
  let chips = order.map((version) => {
    let record = versions[version];
    let when = record.publishedAt ? new Date(record.publishedAt).toLocaleTimeString() : '';
    return `<a class="v${version === picked ? ' on' : ''}" href="?with=${MINE}@${version}"
      title="${esc(record.treeHash)}">
      <b>${esc(version)}</b>
      <span>${esc(record.treeHash.slice(0, 8))}${when ? ` · ${esc(when)}` : ''}</span>
    </a>`;
  });
  chips.push(
    `<a class="v live${picked === 'live' ? ' on' : ''}" href="?with=${MINE}">
      <b>working tree</b><span>unpublished · no-store</span></a>`,
  );
  return chips.join('');
}

// ── The editor ──────────────────────────────────────────────────────────
// Three edits, each chosen so that you cannot miss what changed. They are
// plain find-and-replace over the text in the box; type over any of it.
const SUGGESTED = [
  {
    label: 'Warn 45 days out',
    why: 'the status flips',
    find: 'const WARN_DAYS = 7;',
    replace: 'const WARN_DAYS = 45;',
  },
  {
    label: 'Add the countdown',
    why: 'the text changes',
    find: `    let date = parseISO(value.ship);
    return format(date, 'EEE d MMM yyyy');`,
    replace: `    let date = parseISO(value.ship);
    let days = differenceInCalendarDays(date, today);
    let when = days < 0 ? \`\${-days} days late\` : days === 0 ? 'today' : \`in \${days} days\`;
    return \`\${format(date, 'EEE d MMM yyyy')} · \${when}\`;`,
  },
  {
    label: 'Draw the runway',
    why: 'a bar appears',
    find: `  // A fill from 0 to 1 can go here. The form draws a bar when it finds one.
};`,
    replace: `  // A fill from 0 to 1. The form draws a bar when it finds one.
  bar(value, today = new Date()) {
    let days = differenceInCalendarDays(parseISO(value.ship), today);
    return 1 - days / 90;
  },
};`,
  },
];

let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
<header>
  <div class="crumb">deck · example · W4</div>
  <h1>Edit a field. The edit is a Version.</h1>
</header>

<div class="split">
  <section class="pane">
    <div class="phead"><h2>New shipment</h2><span class="quiet">six catalogue fields and one of yours</span></div>
    <div class="form">${formHtml()}</div>
    <p class="drawnby">The other five controls are drawn by
      <code>fields/handle</code>, <code>fields/swatch</code>,
      <code>fields/meeting-slot</code>, <code>fields/due-date</code> and
      <code>fields/audit-stamp</code>, all at <code>1.0.0</code>.</p>
    <div class="rail" data-role="rail"><span class="quiet">reading versions…</span></div>
  </section>

  <section class="pane">
    <div class="phead">
      <h2><code>you/ship-by/index.js</code></h2>
      <span class="quiet" data-role="status">working tree</span>
    </div>
    <textarea spellcheck="false" wrap="off" data-role="source" aria-label="ship-by source"></textarea>
    <div class="tools">
      ${SUGGESTED.map(
        (edit, index) =>
          `<button data-edit="${index}" title="${esc(edit.why)}">${esc(edit.label)}</button>`,
      ).join('')}
      <button data-role="revert" class="ghost">Revert</button>
      <button data-role="save" class="go">Save <kbd>⌘S</kbd></button>
    </div>
  </section>
</div>

<section class="strip">
  <div><b>${shelf.libraries.length}</b><span>vendored libraries</span></div>
  <div><b>${shelf.libraries.reduce((n, l) => n + l.modules, 0)}</b><span>modules behind them</span></div>
  <div><b>${shelf.store.objects}</b><span>objects in the store</span></div>
  <div><b>${shelf.store.wouldBe}</b><span>if every field carried its own copies</span></div>
</section>

<details class="under">
  <summary>What resolved, and why <code>chroma-js</code> means two things here</summary>
  <div class="dcontent" data-role="evidence"></div>
</details>
`;

// ── Wiring ──────────────────────────────────────────────────────────────
const source = app.querySelector('[data-role="source"]');
const status = app.querySelector('[data-role="status"]');
const rail = app.querySelector('[data-role="rail"]');

function say(text, kind = '') {
  status.textContent = text;
  status.className = `quiet ${kind}`;
}

app.addEventListener('input', (event) => {
  let input = event.target.closest('input[data-deck]');
  if (!input) return;
  let value = state.get(input.dataset.deck);
  value[input.dataset.key] = input.value;
  if (input.dataset.key === 'hex') value.label = input.value;
  repaintRow(input.dataset.deck);
});

app.addEventListener('click', async (event) => {
  let apply = event.target.closest('[data-edit]');
  if (apply) {
    let edit = SUGGESTED[Number(apply.dataset.edit)];
    if (!source.value.includes(edit.find)) {
      say(`already applied, or the text moved: ${edit.label}`, 'warn');
      return;
    }
    source.value = source.value.replace(edit.find, edit.replace);
    say('edited — not saved yet', 'warn');
    return;
  }
  if (event.target.closest('[data-role="revert"]')) {
    await guard(async () => {
      let before = await versionsOfMine();
      let result = await fetch(`${BRIDGE}/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'ship-by' }),
      }).then((reverted) => reverted.json());
      source.value = result.text;
      await afterWrite('reverted', before);
    });
    return;
  }
  if (event.target.closest('[data-role="save"]')) await save();
});

// One write at a time. Two overlapping saves race the watcher and each other,
// and the second one reports on the first one's Version.
let busy = false;
async function guard(work) {
  if (busy) return;
  busy = true;
  try {
    await work();
  } finally {
    busy = false;
  }
}

addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault();
    save();
  }
});

function save() {
  return guard(write);
}

async function write() {
  // The version list is read BEFORE the write. The watcher can finish its
  // debounce while this function is still awaiting, and a "before" taken
  // afterwards would already contain the new Version — so the page would
  // report that nothing happened, at the exact moment something did.
  let before = await versionsOfMine();
  say('writing the file…');
  let response = await fetch(`${BRIDGE}/write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'ship-by', text: source.value }),
  });
  if (!response.ok) {
    say(`the editor bridge refused: ${(await response.json()).error}`, 'bad');
    return;
  }
  await afterWrite('saved', before);
}

// The only interesting part of the loop. Nothing here asks anybody to
// publish: the file is on disk, and the watcher is what turns that into a
// Version. So the page waits for a new one to appear, and says what
// happened if none does — which is a real outcome, not a timeout, when the
// bytes match a tree that was published before.
async function afterWrite(verb, before) {
  say(`${verb} · waiting for the watcher…`);
  let deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    let now = await versionsOfMine();
    let fresh = Object.keys(now.versions).filter((v) => !(v in before.versions));
    if (fresh.length > 0) {
      location.search = `?with=${MINE}@${fresh[0]}`;
      return;
    }
    if (now.tags.dev && now.tags.dev !== before.tags.dev) {
      say(`these bytes were published before — dev points back at ${now.tags.dev}`, 'warn');
      rail.innerHTML = railHtml(now);
      return;
    }
  }
  // Nothing new appeared, and that is a real answer rather than a failure.
  // Either the file did not change, or its bytes reproduce a tree that is
  // already published. Both cases have the same honest form.
  let now = await versionsOfMine();
  say(`no new Version — these bytes are already published as ${now.tags.dev}`, 'warn');
}

// ── Boot ────────────────────────────────────────────────────────────────
let bridgeFiles = await fetch(`${BRIDGE}/files`)
  .then((response) => response.json())
  .catch(() => undefined);
if (bridgeFiles) {
  source.value = bridgeFiles['ship-by'].text;
  say(`working tree · ${bridgeFiles['ship-by'].path}`);
} else {
  source.value = '// the editor bridge is not running — start the demo with `pnpm demo`';
  source.disabled = true;
  say('editor bridge unreachable', 'bad');
}

rail.innerHTML = railHtml(await versionsOfMine());
if (mineError) say(`the last save does not load: ${mineError.message}`, 'bad');

// ── The evidence, kept out of the way ───────────────────────────────────
// It is still the strongest thing on the page for a reader who wants it, so
// it is one click away rather than three paragraphs up.
const map = JSON.parse(document.querySelector('script[type="importmap"]').textContent);
const zodShared =
  dueDate.schema instanceof handle.modules.zod.ZodType &&
  auditStamp.schema instanceof swatch.modules.zod.ZodType;
const RAMP = { hex: '#6638ff', label: 'route purple' };
const rampNew = swatch.ramp(RAMP);
const rampOld = brandSwatch.ramp(RAMP);

app.querySelector('[data-role="evidence"]').innerHTML = `
<p>Every library on this page arrived because a field asked for it, inside
that field's own scope. Read out of this document's own import map:</p>
<table>
  <thead><tr><th>deck</th><th>from npm</th><th>modules</th><th>asked for by</th></tr></thead>
  <tbody>${shelf.libraries
    .map(
      (lib) => `<tr>
      <td>${pill('deck', `${lib.deck}@${lib.version}`)}</td>
      <td>${pill('npm', lib.npm)}</td>
      <td class="num">${lib.modules}</td>
      <td class="quiet">${lib.consumers.map((c) => esc(c.replace('fields/', ''))).join(', ')}</td>
    </tr>`,
    )
    .join('')}</tbody>
</table>
<p><code>chroma-js</code> is two decks at once: <code>fields/swatch</code> is on
${esc(shelf.chroma.current)}, <code>fields/brand-swatch</code> is pinned to
${esc(shelf.chroma.pinned)}. Both are in this document. A flat import map has one
slot for that name.</p>
<div class="ramps">
  <div><span class="quiet">chroma-js ${esc(shelf.chroma.current)}</span>
    <div class="ramp">${rampNew.map((hex) => `<i style="background:${hex}"></i>`).join('')}</div></div>
  <div><span class="quiet">chroma-js ${esc(shelf.chroma.pinned)}</span>
    <div class="ramp">${rampOld.map((hex) => `<i style="background:${hex}"></i>`).join('')}</div></div>
</div>
<p class="${zodShared ? 'good' : 'bad'}"><code>dueDate.schema instanceof handle.modules.zod.ZodType</code>
→ <b>${zodShared}</b>. Six decks import <code>zod</code>; they resolve to one URL, so
the browser loads one module and a schema built by one field validates under
another. Two copies make that false, and the failure is famously baffling.</p>
<p class="quiet">${Object.keys(map.imports).length} top-level pins,
${Object.keys(map.scopes ?? {}).length} scopes, injected by the server from this
deck's own <code>importmap.json</code>.</p>
`;

// ── Style ───────────────────────────────────────────────────────────────
let style = document.createElement('style');
style.textContent = `
:root{
  --ink:#272330;--body:#54525f;--quiet:#6f6f78;--meta:#8b8b93;
  --stage:#f7f8fa;--surface:#fff;--track:#eef0f4;--border:#e2e8f0;--hair:#eceef1;
  --go:#097a60;--warn:#a45309;--bad:#c02626;
  --shadow:0 2px 8px rgba(28,28,50,.05);
  --sans:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--stage);color:var(--ink);font-family:var(--sans);line-height:1.5}
#app{max-width:74rem;margin:0 auto;padding:2rem 1.25rem 4rem}
code{font-family:var(--mono);font-size:.86em}
.crumb{font:600 11px var(--sans);letter-spacing:.11em;text-transform:uppercase;color:var(--meta)}
h1{margin:.35rem 0 1.25rem;font-size:1.75rem;letter-spacing:-.02em}
h2{margin:0;font-size:.95rem}
.quiet{color:var(--quiet);font-size:.8rem}
.quiet.warn{color:var(--warn)}
.quiet.bad{color:var(--bad)}

.split{display:grid;gap:1rem;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);align-items:start}
@media (max-width:60rem){.split{grid-template-columns:1fr}}
.pane{background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}
.phead{display:flex;align-items:baseline;gap:.75rem;justify-content:space-between;
  padding:.85rem 1rem;border-bottom:1px solid var(--hair);background:#fcfcfd}

.form{padding:.35rem 1rem .85rem}
.row{display:grid;grid-template-columns:6.5rem minmax(7rem,10rem) minmax(0,1fr);
  gap:.35rem 1rem;align-items:center;padding:.7rem 0;border-bottom:1px solid var(--hair)}
@media (max-width:40rem){.row{grid-template-columns:1fr;align-items:start}}
.row:last-child{border-bottom:none}
.row.mine{background:#f6fbf9;margin:0 -1rem;padding-left:1rem;padding-right:1rem;
  box-shadow:inset 3px 0 0 var(--go)}
.row label{font-size:.82rem;color:var(--body);padding-top:.35rem}
.row input{width:100%;font:inherit;font-size:.88rem;padding:.3rem .5rem;
  border:1px solid var(--border);border-radius:7px;background:#fff}
.row input[type=color]{padding:.1rem;height:2rem}
.row .by{grid-column:2/-1;margin-top:.15rem}
@media (max-width:40rem){.row .by{grid-column:1}}
.drawnby{margin:0;padding:0 1rem 1rem;font-size:.78rem;color:var(--quiet);max-width:46rem}
.auto{font-size:.8rem;color:var(--meta)}
.out{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;min-height:2rem;padding-top:.3rem}
.read{font-size:.9rem;font-variant-numeric:tabular-nums}
.tone{font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:600;
  border-radius:999px;padding:.1rem .5rem}
.t-ok{background:var(--track);color:var(--quiet)}
.t-soon{background:#fdf1de;color:var(--warn)}
.t-late,.t-overdue{background:#fdecec;color:var(--bad)}
.chip{border-radius:999px;padding:.1rem .6rem;font-size:.76rem;font-weight:600}
.invalid{font-size:.76rem;color:var(--bad)}
.bar{flex-basis:100%;height:.55rem;border-radius:999px;background:var(--track);overflow:hidden}
.bar i{display:block;height:100%;background:var(--go)}
.broken{font-family:var(--mono);font-size:.76rem;color:var(--bad);white-space:pre-wrap}

.rail{display:flex;flex-wrap:wrap;gap:.4rem;padding:.85rem 1rem;border-top:1px solid var(--hair);background:#fcfcfd}
.v{display:block;text-decoration:none;color:inherit;border:1px solid var(--border);
  background:#fff;border-radius:9px;padding:.35rem .6rem;min-width:6.5rem}
.v b{display:block;font:600 .8rem var(--mono)}
.v span{display:block;font:.68rem var(--mono);color:var(--meta)}
.v.on{border-color:var(--go);box-shadow:inset 0 0 0 1px var(--go)}
.v.live b{font-family:var(--sans)}

/* wrap="off" plus overflow-x keeps source looking like source. A code pane
   that reflows comments mid-sentence reads as prose that went wrong. */
textarea{display:block;width:100%;min-height:27rem;resize:vertical;border:none;
  padding:.9rem 1rem;font-family:var(--mono);font-size:.75rem;line-height:1.6;
  color:var(--ink);background:#fff;outline:none;tab-size:2;
  white-space:pre;overflow:auto}
.tools{display:flex;flex-wrap:wrap;gap:.4rem;padding:.75rem 1rem;
  border-top:1px solid var(--hair);background:#fcfcfd}
.tools button{font:inherit;font-size:.8rem;padding:.35rem .7rem;border-radius:8px;
  border:1px solid var(--border);background:#fff;color:var(--ink);cursor:pointer}
.tools button:hover{border-color:var(--go);color:var(--go)}
.tools .go{margin-left:auto;background:var(--go);border-color:var(--go);color:#fff}
.tools .go:hover{color:#fff;filter:brightness(1.08)}
.tools .ghost{color:var(--quiet)}
kbd{font:inherit;font-size:.72em;opacity:.75}

.strip{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));margin:1rem 0}
.strip div{background:var(--surface);border:1px solid var(--border);border-radius:10px;
  padding:.7rem .9rem;box-shadow:var(--shadow)}
.strip b{display:block;font-size:1.4rem;font-weight:600;letter-spacing:-.02em}
.strip span{color:var(--quiet);font-size:.74rem}

.under{background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow)}
.under summary{padding:.8rem 1rem;cursor:pointer;font-size:.88rem}
.dcontent{padding:0 1rem 1rem;font-size:.86rem;color:var(--body)}
.dcontent p{max-width:56rem}
.dcontent table{width:100%;border-collapse:collapse;font-size:.82rem;margin:.5rem 0 1rem}
.dcontent th{text-align:left;font:600 10.5px var(--sans);letter-spacing:.09em;
  text-transform:uppercase;color:var(--meta);padding:.4rem .6rem;border-bottom:1px solid var(--hair)}
.dcontent td{padding:.4rem .6rem;border-bottom:1px solid var(--hair)}
.num{text-align:right;font-variant-numeric:tabular-nums}
.ramps{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));margin:.5rem 0 1rem}
.ramp{display:flex;height:2rem;border-radius:8px;overflow:hidden;border:1px solid var(--hair);margin-top:.3rem}
.ramp i{flex:1}
.good{color:#12241e}.bad{color:#7a1010}
`;
document.head.append(style);
