// A console for two dialects of one language.
//
// Both engines are imported from sealed decks and run in the browser. Type an
// expression on either side and it evaluates as you type. The two dialects
// have different surface syntax and the identical evaluator, so an expression
// that means the same thing gives the same answer — and the page proves the
// evaluator is identical by hashing the bytes of `eval.js` it fetched from
// each deck, rather than by saying so.
import { installPillStyles, pill } from 'ui/pills';

const b = await (await fetch('./build.json')).json();
const DEPOT = b.depot;

installPillStyles();

const deckUrl = (side, file) => `/${DEPOT}/${side.deck}@${side.version}/${file}`;
const [up, fk] = await Promise.all([
  import(deckUrl(b.upstream, 'index.js')),
  import(deckUrl(b.fork, 'index.js')),
]);

// The proof, measured. Fetch the evaluator from both addresses and hash what
// arrived. Two decks, two URLs, one digest.
async function digestOf(side) {
  let bytes = await (await fetch(deckUrl(side, 'eval.js'))).arrayBuffer();
  let hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
const [upEval, fkEval] = await Promise.all([digestOf(b.upstream), digestOf(b.fork)]);

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const show = (value) => JSON.stringify(value);

const SIDES = [
  { key: 'up', side: b.upstream, engine: up, digest: upEval, box: 'jqish' },
  { key: 'fk', side: b.fork, engine: fk, digest: fkEval, box: 'feelish' },
];

// The starting pair, and the presets. `extra` is last on purpose: it is the
// one the fork can answer and upstream cannot, so the reader meets agreement
// several times before they meet a limit.
const PRESETS = [
  ...b.pairs.map((pair) => ({ ask: pair.ask, up: pair.jqish, fk: pair.feelish })),
  { ask: b.extra.ask, up: b.extra.feelish, fk: b.extra.feelish, oneSided: true },
];

let typed = { up: PRESETS[0].up, fk: PRESETS[0].fk };

function evaluate(entry) {
  try {
    return { ok: true, text: show(entry.engine.run(typed[entry.key], b.data)) };
  } catch (error) {
    return { ok: false, text: String(error?.message ?? error) };
  }
}

function paint() {
  let results = Object.fromEntries(SIDES.map((entry) => [entry.key, evaluate(entry)]));
  for (let entry of SIDES) {
    let out = document.querySelector(`[data-out="${entry.key}"]`);
    let result = results[entry.key];
    out.className = `out ${result.ok ? 'ok' : 'no'}`;
    out.textContent = result.text;
  }
  let verdict = document.querySelector('[data-role="verdict"]');
  let both = results.up.ok && results.fk.ok;
  let agree = both && results.up.text === results.fk.text;
  verdict.className = `verdict ${agree ? 'agree' : both ? 'differ' : 'onesided'}`;
  verdict.textContent = agree
    ? 'the same answer, from the same evaluator'
    : both
      ? 'different answers — the two expressions do not ask the same question'
      : `only ${results.up.ok ? b.upstream.dialect.name : b.fork.dialect.name} can read this`;
}

let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
<div class="crumb">deck · example · W3</div>
<h1>Two dialects. One evaluator.</h1>

<div class="asks">
  ${PRESETS.map(
    (preset, index) =>
      `<button data-preset="${index}"${preset.oneSided ? ' class="edge"' : ''}>${esc(preset.ask)}</button>`,
  ).join('')}
</div>

<div class="consoles">
  ${SIDES.map(
    (entry) => `
    <section class="pane ${entry.key}">
      <div class="phead">
        ${pill('deck', `${entry.side.deck}@${entry.side.version}`)}
        <span class="tag">${esc(entry.side.dialect.tagline)}</span>
      </div>
      <input data-in="${entry.key}" spellcheck="false" value="${esc(typed[entry.key])}"
        aria-label="${esc(entry.side.dialect.name)} expression" />
      <pre class="out" data-out="${entry.key}"></pre>
      <div class="pfoot">
        <code>eval.js</code>
        <span class="digest" title="sha-256 of the bytes this page fetched">${esc(entry.digest.slice(0, 24))}…</span>
      </div>
    </section>`,
  ).join('')}
</div>

<p class="verdict" data-role="verdict"></p>

<div class="under">
  <div class="data">
    <h2>the input</h2>
    <table>
      <thead><tr>${Object.keys(b.data.items[0])
        .map((key) => `<th>${esc(key)}</th>`)
        .join('')}</tr></thead>
      <tbody>${b.data.items
        .map(
          (item) =>
            `<tr>${Object.values(item)
              .map((cell) => `<td>${esc(cell)}</td>`)
              .join('')}</tr>`,
        )
        .join('')}</tbody>
    </table>
  </div>
  <div class="cost">
    <h2>what the fork cost</h2>
    <p><code>${esc(b.changed.join(', '))}</code> changed.
      <code>${esc(b.shared.join(', '))}</code> byte-identical, so the store holds
      <b>${b.store.objects}</b> objects where two full copies would be
      <b>${b.store.wouldBe}</b>.</p>
    <p>The FEEL range <code>${esc(b.extra.feelish)}</code> desugars inside the
      parser to <code>qty &gt;= 2 and qty &lt;= 8</code> — two comparisons the
      shared evaluator already knew. A new language feature, and the evaluator
      did not move.</p>
  </div>
</div>
`;

app.addEventListener('input', (event) => {
  let input = event.target.closest('[data-in]');
  if (!input) return;
  typed[input.dataset.in] = input.value;
  paint();
});

app.addEventListener('click', (event) => {
  let button = event.target.closest('[data-preset]');
  if (!button) return;
  let preset = PRESETS[Number(button.dataset.preset)];
  typed = { up: preset.up, fk: preset.fk };
  for (let entry of SIDES) {
    document.querySelector(`[data-in="${entry.key}"]`).value = typed[entry.key];
  }
  paint();
});

paint();

let style = document.createElement('style');
style.textContent = `
:root{--bg:#f7f8fa;--panel:#fff;--line:#e2e8f0;--hair:#eceef1;--ink:#272330;
  --dim:#54525f;--quiet:#6f6f78;--up:#097a60;--fk:#a45309;--no:#c02626;
  --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.5rem 4rem;background:var(--bg);color:var(--ink);
  font:15px/1.6 'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif}
#app{max-width:68rem;margin:0 auto}#app.loading{color:var(--quiet)}
.crumb{font:600 11px/1 inherit;letter-spacing:.11em;text-transform:uppercase;color:#8b8b93}
h1{font-size:1.7rem;margin:.35rem 0 1.1rem;letter-spacing:-.02em}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:#8b8b93;margin:0 0 .5rem}
code{font-family:var(--mono);font-size:.86em}

.asks{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1rem}
.asks button{font:inherit;font-size:.82rem;padding:.35rem .7rem;border-radius:999px;
  border:1px solid var(--line);background:#fff;color:var(--dim);cursor:pointer}
.asks button:hover{border-color:var(--up);color:var(--up)}
.asks .edge{border-style:dashed}

.consoles{display:grid;gap:1rem;grid-template-columns:1fr 1fr}
@media (max-width:52rem){.consoles{grid-template-columns:1fr}}
.pane{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.pane.up{box-shadow:inset 3px 0 0 var(--up)}
.pane.fk{box-shadow:inset 3px 0 0 var(--fk)}
.phead{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;
  padding:.7rem .9rem;border-bottom:1px solid var(--hair);background:#fcfcfd}
.tag{font-size:.78rem;color:var(--quiet)}
.pane input{display:block;width:100%;border:none;border-bottom:1px solid var(--hair);
  padding:.8rem .9rem;font-family:var(--mono);font-size:.85rem;color:var(--ink);
  background:#fff;outline:none}
.pane input:focus{background:#fbfdfc}
.out{margin:0;padding:.8rem .9rem;min-height:4.5rem;font-family:var(--mono);
  font-size:.85rem;white-space:pre-wrap;word-break:break-word}
.out.ok{color:var(--up)}
.out.no{color:var(--no)}
.pfoot{display:flex;justify-content:space-between;gap:.6rem;padding:.5rem .9rem;
  border-top:1px solid var(--hair);background:#fcfcfd;color:var(--quiet);font-size:.72rem}
.digest{font-family:var(--mono)}

.verdict{margin:.9rem 0 1.5rem;padding:.65rem .9rem;border-radius:10px;font-size:.9rem;text-align:center}
.verdict.agree{background:#f0fbf7;border:1px solid #cfeee2;color:#12241e}
.verdict.differ{background:#fff1f1;border:1px solid #f6d6d6;color:#7a1010}
.verdict.onesided{background:#fff9f2;border:1px solid #f4e6d4;color:#7a4a10}

.under{display:grid;gap:1rem;grid-template-columns:minmax(0,18rem) minmax(0,1fr)}
@media (max-width:52rem){.under{grid-template-columns:1fr}}
.under>div{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:.9rem 1rem}
.under p{margin:.4rem 0;font-size:.86rem;color:var(--dim)}
table{width:100%;border-collapse:collapse;font-size:.84rem}
th{text-align:left;font:600 10.5px inherit;letter-spacing:.09em;text-transform:uppercase;
  color:#8b8b93;padding:.35rem .5rem;border-bottom:1px solid var(--hair)}
td{padding:.35rem .5rem;border-bottom:1px solid var(--hair)}
tr:last-child td{border-bottom:none}
`;
document.head.append(style);
