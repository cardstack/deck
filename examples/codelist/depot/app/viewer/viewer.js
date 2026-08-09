// A reference-data board over four sealed states of one codelist.
//
// The viewer is an ordinary consumer. It knows four URLs and fetches them the
// way any page would — no Deck client library, no SDK. A sealed deck is just
// files at an address.
//
// The four states are shown as one board rather than four columns, because
// the thing worth seeing is a row arriving. Switch between states and the
// rows grow in and out and the count changes. Two people amended this list at
// the same time; both amendments are here, and nobody resolved anything.

import { installPillStyles, pill } from 'ui/pills';

const { depot, states } = await (await fetch('./states.json')).json();

installPillStyles();

let loaded = await Promise.all(
  states.map(async (state) => ({
    ...state,
    url: `/${depot}/${state.deck}@${state.version}/currencies.json`,
    codes: await (
      await fetch(`/${depot}/${state.deck}@${state.version}/currencies.json`)
    ).json(),
  })),
);

let [shared, amended, fork] = loaded;

// Every key that appears in any state, so a row can be absent rather than
// missing. Rows keep their place in the board across a switch.
let allKeys = [...new Set(loaded.flatMap((state) => Object.keys(state.codes)))].sort();
let names = Object.fromEntries(
  allKeys.map((key) => [key, loaded.find((state) => key in state.codes).codes[key]]),
);

const origin = (key) => {
  if (key in shared.codes) return 'base';
  if (key in fork.codes && !(key in amended.codes)) return 'acme';
  return 'added';
};
const ORIGIN_LABEL = {
  base: 'in 1.4.0 already',
  added: 'added upstream in 1.5.0',
  acme: "acme's internal code",
};

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

let at = 0;
let previous = 0;

let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
<div class="crumb">deck · example · W2</div>
<h1>Two amendments. No conflict.</h1>

<div class="switch">
  ${loaded
    .map(
      (state, index) => `<button data-at="${index}"${index === 0 ? ' class="on"' : ''}>
        <b>${esc(state.deck)}@${esc(state.version)}</b>
        <span>${esc(state.label)}</span>
      </button>`,
    )
    .join('')}
</div>

<section class="board">
  <div class="bhead">
    <div class="count"><b data-role="count">0</b><span>codes</span></div>
    <p class="note" data-role="note"></p>
    <div class="key">
      ${Object.entries(ORIGIN_LABEL)
        .map(([kind, label]) => `<span class="chip ${kind}"><i></i>${esc(label)}</span>`)
        .join('')}
    </div>
  </div>
  <ol class="rows">
    ${allKeys
      .map(
        (key) => `<li data-key="${esc(key)}" class="row ${origin(key)}">
          <code>${esc(key)}</code>
          <span class="name">${esc(names[key].name)}</span>
          <span class="minor">${names[key].minor} minor</span>
        </li>`,
      )
      .join('')}
  </ol>
  <div class="bfoot">
    <a data-role="raw" href="">${pill('deck', '', { wrap: true })}</a>
    <code class="hash" data-role="hash"></code>
  </div>
</section>

<section class="reading">
  <h2>What to read here</h2>
  <ol>
    <li><b>1.4.0 → 1.5.0 gained three rows and lost none.</b> Two people
      amended at the same time. A codelist is a set of keys, so that was never
      a conflict — only a line-based merge would have called it one.</li>
    <li><b>The fork kept its three internal codes across the upgrade.</b>
      Rebasing onto 1.5.0 absorbed upstream's new keys and left
      <code>XAC</code>, <code>XPT</code> and <code>XVC</code> alone. No data
      collided, because nobody touched the same key.</li>
    <li><b>One thing did need a person, and it was the right one.</b> The
      rebase reported a conflict in <code>importmap.json</code>: the fork
      called itself <code>1.4.0-acme.1</code> and upstream called itself
      <code>1.5.0</code>. A machine can combine two sets of codes, because
      "both" is well defined. It cannot decide what to name the combination.</li>
    <li><b>Every state is still there.</b> There is no unpublish. 1.4.0 did
      not become wrong when 1.5.0 appeared, so a consumer pinned to it keeps
      working for ever.</li>
  </ol>
</section>
`;

const rows = new Map([...app.querySelectorAll('[data-key]')].map((li) => [li.dataset.key, li]));

function paint() {
  let state = loaded[at];
  let before = loaded[previous];
  for (let [key, li] of rows) {
    let here = key in state.codes;
    li.classList.toggle('off', !here);
    // A row that was not in the state you came from is the news. Flash it,
    // and only it — highlighting everything highlights nothing.
    li.classList.toggle('fresh', here && !(key in before.codes) && previous !== at);
  }
  app.querySelector('[data-role="count"]').textContent = Object.keys(state.codes).length;
  app.querySelector('[data-role="note"]').textContent = state.note;
  let raw = app.querySelector('[data-role="raw"]');
  raw.href = state.url;
  raw.innerHTML = pill('deck', state.url, { wrap: true });
  app.querySelector('[data-role="hash"]').textContent = `${state.hash.slice(0, 24)}…`;
  for (let button of app.querySelectorAll('[data-at]')) {
    button.classList.toggle('on', Number(button.dataset.at) === at);
  }
}

let fade;
app.addEventListener('click', (event) => {
  let button = event.target.closest('[data-at]');
  if (!button) return;
  previous = at;
  at = Number(button.dataset.at);
  paint();
  // The highlight is a flash, not a state. Leaving it on turns "these three
  // are new" into "these three are green", which is a different claim.
  clearTimeout(fade);
  fade = setTimeout(() => {
    for (let li of rows.values()) li.classList.remove('fresh');
  }, 1800);
});

paint();

let style = document.createElement('style');
style.textContent = `
:root{--bg:#f7f8fa;--panel:#fff;--line:#e2e8f0;--hair:#eceef1;--ink:#272330;
  --dim:#54525f;--quiet:#6f6f78;--meta:#8b8b93;
  --base:#94a3b8;--added:#097a60;--acme:#a45309;
  --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.5rem 4rem;background:var(--bg);color:var(--ink);
  font:15px/1.6 'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif}
#app{max-width:62rem;margin:0 auto}#app.loading{color:var(--quiet)}
.crumb{font:600 11px/1 inherit;letter-spacing:.11em;text-transform:uppercase;color:var(--meta)}
h1{font-size:1.7rem;margin:.35rem 0 1.1rem;letter-spacing:-.02em}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--meta);margin:0 0 .6rem}
code{font-family:var(--mono);font-size:.86em}

.switch{display:grid;gap:.5rem;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));margin-bottom:1rem}
.switch button{text-align:left;font:inherit;cursor:pointer;background:#fff;
  border:1px solid var(--line);border-radius:10px;padding:.55rem .75rem;color:var(--ink)}
.switch button b{display:block;font:600 .78rem var(--mono)}
.switch button span{display:block;font-size:.76rem;color:var(--quiet)}
.switch button:hover{border-color:var(--added)}
.switch .on{border-color:var(--added);box-shadow:inset 0 0 0 1px var(--added)}

.board{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.bhead{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;
  padding:.8rem 1rem;border-bottom:1px solid var(--hair);background:#fcfcfd}
.count{display:flex;align-items:baseline;gap:.35rem}
.count b{font-size:1.8rem;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.count span{font-size:.76rem;color:var(--quiet)}
.bhead .note{margin:0;flex:1;min-width:12rem;font-size:.84rem;color:var(--dim)}
.key{display:flex;flex-wrap:wrap;gap:.6rem;font-size:.72rem;color:var(--quiet)}
.chip{display:inline-flex;align-items:center;gap:.3rem}
.chip i{width:.55rem;height:.55rem;border-radius:2px;background:var(--base)}
.chip.added i{background:var(--added)}.chip.acme i{background:var(--acme)}

.rows{list-style:none;margin:0;padding:0}
/* A row leaves by collapsing, so an absence is a gap that opens in front of
   you rather than a cell that was never filled in. */
.row{display:grid;grid-template-columns:4rem minmax(0,1fr) auto;gap:1rem;align-items:center;
  padding:.5rem 1rem;border-bottom:1px solid var(--hair);
  box-shadow:inset 3px 0 0 var(--base);overflow:hidden;
  max-height:3rem;opacity:1;transition:max-height .28s ease,opacity .2s ease,padding .28s ease,background .6s ease}
.row.added{box-shadow:inset 3px 0 0 var(--added)}
.row.acme{box-shadow:inset 3px 0 0 var(--acme)}
.row.off{max-height:0;opacity:0;padding-top:0;padding-bottom:0;border-bottom-width:0}
.row.fresh{background:#e8f7f1}
.row code{font-weight:600}
.name{color:var(--dim);font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.minor{font-size:.74rem;color:var(--meta);font-variant-numeric:tabular-nums}

.bfoot{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;
  padding:.6rem 1rem;border-top:1px solid var(--hair);background:#fcfcfd}
.bfoot a{text-decoration:none}
.hash{font-size:.7rem;color:var(--meta)}

.reading{margin-top:1.5rem;background:var(--panel);border:1px solid var(--line);
  border-radius:12px;padding:1rem 1.2rem}
.reading ol{margin:0;padding-left:1.2rem}
.reading li{margin:.5rem 0;font-size:.88rem;color:var(--dim)}
.reading b{color:var(--ink)}
`;
document.head.append(style);
