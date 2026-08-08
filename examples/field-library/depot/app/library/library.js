// The field library page.
//
// It imports six field decks by name. It does not import a single library
// directly — every library on this page arrives because some field asked for
// it, inside that field's own scope. The page then reads its OWN import map
// back out of the document and reports what actually resolved, so none of
// the numbers below are narration.
import { field as auditStamp } from 'fields/audit-stamp';
import { field as brandSwatch } from 'fields/brand-swatch';
import { field as dueDate } from 'fields/due-date';
import { field as handle } from 'fields/handle';
import { field as meetingSlot } from 'fields/meeting-slot';
import { field as swatch } from 'fields/swatch';
import { installPillStyles, legend, pill } from 'ui/pills';

const FIELDS = [
  { deck: 'fields/due-date', field: dueDate },
  { deck: 'fields/swatch', field: swatch },
  { deck: 'fields/brand-swatch', field: brandSwatch },
  { deck: 'fields/meeting-slot', field: meetingSlot },
  { deck: 'fields/handle', field: handle },
  { deck: 'fields/audit-stamp', field: auditStamp },
];

installPillStyles();

const shelf = await (await fetch('./shelf.json')).json();
const map = JSON.parse(
  document.querySelector('script[type="importmap"]').textContent,
);

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const urlOf = (s) => (s ? s.replace(/^\/[a-z0-9-]+\//, '') : '');

// ── What resolved, per library ──────────────────────────────────────────
// One row per (specifier, resolved URL). Two rows for one specifier means
// two versions are live in this document at once.
let bySpecifier = new Map();
for (let [scope, table] of Object.entries(map.scopes ?? {})) {
  for (let [specifier, target] of Object.entries(table)) {
    if (specifier.endsWith('/')) continue;
    let key = specifier;
    let seen = bySpecifier.get(key) ?? new Map();
    let holders = seen.get(target) ?? [];
    holders.push(scope);
    seen.set(target, holders);
    bySpecifier.set(key, seen);
  }
}

// ── Module identity ─────────────────────────────────────────────────────
// The consequence of the table above, measured at runtime. Every field
// exports the namespace objects it imported; if two fields resolved one
// specifier to one URL, the browser gives them the identical object.
let identity = [];
for (let [specifier, byUrl] of bySpecifier) {
  let objects = new Set();
  let holders = [];
  for (let { deck, field } of FIELDS) {
    let ns = field.modules?.[specifier];
    if (ns) {
      objects.add(ns);
      holders.push(deck);
    }
  }
  if (holders.length === 0) continue;
  identity.push({
    specifier,
    holders,
    urls: [...byUrl.keys()],
    instances: objects.size,
  });
}
identity.sort((a, b) => b.holders.length - a.holders.length);

// The bug this prevents, stated as code: a schema built by one deck's zod,
// checked against another deck's zod.
const zodShared =
  dueDate.schema instanceof handle.modules.zod.ZodType &&
  auditStamp.schema instanceof swatch.modules.zod.ZodType;

// ── The two chromas, asked the same question ────────────────────────────
const RAMP_INPUT = { hex: '#6638ff', label: 'boxel purple' };
const rampNew = swatch.ramp(RAMP_INPUT);
const rampOld = brandSwatch.ramp(RAMP_INPUT);
const rampsAgree = rampNew.join() === rampOld.join();

// ── Render ──────────────────────────────────────────────────────────────
const READER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function rowsFor({ deck, field }) {
  return field.examples
    .map((example) => {
      let parsed = field.schema.safeParse(
        field.name === 'Handle'
          ? field.mint(example)
          : field.name === 'AuditStamp'
            ? field.stamp(example)
            : example,
      );
      let extra = '';
      if (field.css) {
        let { background, foreground } = field.css(example);
        extra = `<span class="chip" style="background:${background};color:${foreground}">${esc(example.label ?? example.hex)}</span>`;
      }
      if (field.inZone) {
        extra = `<span class="quiet">${esc(field.inZone(example, READER_ZONE))} for you</span>`;
      }
      if (field.tone) {
        extra = `<span class="tone ${field.tone(example)}">${field.tone(example)}</span>`;
      }
      return `<tr>
        <td class="src"><code>${esc(JSON.stringify(example))}</code></td>
        <td class="out">${esc(field.format(example))}</td>
        <td class="ex">${extra}</td>
        <td class="ok">${parsed.success ? '✓' : `<span class="bad">${esc(parsed.error.issues[0].message)}</span>`}</td>
      </tr>`;
    })
    .join('');
}

let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
<header class="masthead">
  <div class="crumb">deck · example</div>
  <h1>A field library</h1>
  <p class="lede">
    Six card fields, each its own deck, each declaring the npm libraries it
    wants by the bare specifier its source already writes. Nothing on this
    page imports a library directly — every one of them arrives because a
    field asked for it, resolved inside that field's own scope.
  </p>
  <div class="namekey">
    ${legend()}
    <p class="namenote">
      Three registers, and this page uses all three. ${pill('npm', 'zod@3.25.76')}
      is what the registry published; ${pill('deck', 'lib/zod@3.25.76')} is where
      this depot serves it from; a ${pill('github', 'colinhacks/zod')} is where
      the source lives. The shelf table below shows the first two side by side,
      which is the whole point of vendoring: one artifact, one address, and a
      recorded link between them.
    </p>
  </div>

  <div class="stats">
    <div><b>${shelf.decks}</b><span>decks in the depot</span></div>
    <div><b>${shelf.libraries.reduce((n, l) => n + l.modules, 0)}</b><span>vendored modules</span></div>
    <div><b>${shelf.store.objects}</b><span>objects in the store</span></div>
    <div><b>${shelf.store.wouldBe}</b><span>if each field carried its own copies</span></div>
  </div>
</header>

<section>
  <h2>The fields</h2>
  ${FIELDS.map(
    (entry) => `
    <article class="field">
      <div class="fhead">
        <h3>${esc(entry.field.name)}</h3>
        ${pill('deck', `${entry.deck}@1.0.0`)}
        <span class="lib">${esc(entry.field.library)}</span>
      </div>
      <p class="summary">${esc(entry.field.summary)}</p>
      <table>
        <thead><tr><th>value</th><th>rendered</th><th></th><th>valid</th></tr></thead>
        <tbody>${rowsFor(entry)}</tbody>
      </table>
    </article>`,
  ).join('')}
</section>

<section>
  <h2>One specifier, one URL — or two, on purpose</h2>
  <p class="note">
    Read out of this document's own import map. A specifier that resolves to
    one URL is loaded once by the browser, so every deck that imported it
    holds the <em>identical</em> module object. A specifier that resolves to
    two URLs is two libraries, deliberately.
  </p>
  <table class="wide">
    <thead><tr><th>specifier</th><th>decks that import it</th><th>resolved to</th><th>module objects</th></tr></thead>
    <tbody>
      ${identity
        .map(
          (row) => `<tr class="${row.instances === row.urls.length ? 'same' : 'diff'}">
        <td><code>${esc(row.specifier)}</code></td>
        <td>${row.holders.length}<span class="quiet"> · ${row.holders.map((d) => esc(d.replace('fields/', ''))).join(', ')}</span></td>
        <td>${row.urls.map((u) => pill('deck', urlOf(u), { wrap: true })).join('<br />')}</td>
        <td class="count">${row.instances}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <p class="verdict ${zodShared ? 'good' : 'bad'}">
    ${
      zodShared
        ? '<code>dueDate.schema instanceof handle.modules.zod.ZodType</code> → <b>true</b>. A schema built by one deck validates under another deck\'s zod, because there is only one zod. With two copies this is false, and the failure is famously baffling.'
        : 'zod is NOT shared — two copies are loaded, and cross-deck <code>instanceof</code> is broken.'
    }
  </p>
</section>

<section>
  <h2>Two chromas, same question</h2>
  <p class="note">
    <code>fields/swatch</code> is on chroma-js ${esc(shelf.chroma.current)};
    <code>fields/brand-swatch</code> is pinned to ${esc(shelf.chroma.pinned)}.
    Both were asked for a five-step Lab ramp from
    <code>${esc(RAMP_INPUT.hex)}</code> to white.
  </p>
  <div class="ramps">
    <div>
      <span class="rlabel">chroma-js ${esc(shelf.chroma.current)}</span>
      <div class="ramp">${rampNew.map((hex) => `<i style="background:${hex}" title="${hex}"></i>`).join('')}</div>
      <code class="rhex">${rampNew.join(' ')}</code>
    </div>
    <div>
      <span class="rlabel">chroma-js ${esc(shelf.chroma.pinned)}</span>
      <div class="ramp">${rampOld.map((hex) => `<i style="background:${hex}" title="${hex}"></i>`).join('')}</div>
      <code class="rhex">${rampOld.join(' ')}</code>
    </div>
  </div>
  <p class="verdict ${rampsAgree ? 'good' : 'warn'}">
    ${
      rampsAgree
        ? 'The two versions agree on this ramp today. They are still two different libraries, loaded from two URLs, and the pinned deck is not obliged to move when the other one does.'
        : 'The two versions disagree — which is exactly why the brand deck pinned one of them, and exactly what a flat import map would have hidden by silently picking a winner.'
    }
  </p>
</section>

<section>
  <h2>The shelf</h2>
  <p class="note">
    Vendored from npm <em>source</em>, not a CDN bundle: the module tree npm
    published, sealed into this depot. Nothing on this page reaches the
    network at runtime.
  </p>
  <table class="wide">
    <thead><tr><th>deck</th><th>from npm</th><th>modules</th><th>imported by</th></tr></thead>
    <tbody>
      ${shelf.libraries
        .map(
          (lib) => `<tr>
        <td>${pill('deck', `${lib.deck}@${lib.version}`)}</td>
        <td>${pill('npm', lib.npm)}</td>
        <td class="count">${lib.modules}</td>
        <td class="quiet">${lib.consumers.map((c) => esc(c.replace('fields/', ''))).join(', ')}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>
</section>

<section>
  <h2>The map this page was resolved with</h2>
  <p class="note">
    Injected by the server from <code>app/library</code>'s own sealed
    <code>importmap.json</code>. The top-level pins name the six field decks;
    each scope carries one field deck's libraries, which is why
    <code>chroma-js</code> can mean two things at once.
  </p>
  <pre>${esc(JSON.stringify(map, null, 2))}</pre>
</section>
`;

let style = document.createElement('style');
style.textContent = `
:root{
  --ink:#272330;--ink-body:#5a586a;--ink-quiet:#8b8b93;--ink-meta:#a2a2ab;
  --stage:#f7f8fa;--surface:#fff;--shelf:#fafbfc;--track:#eef0f4;
  --border:#e2e8f0;--hairline:#eceef1;
  --interactive:#0c9d7c;--accent:#00ffba;--attention:#d97706;--broken:#ff5050;
  --shadow:0 2px 8px rgba(28,28,50,.05);
  --sans:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--stage);color:var(--ink);font-family:var(--sans);line-height:1.5}
#app{max-width:60rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
#app.loading{color:var(--ink-quiet)}
code{font-family:var(--mono);font-size:.86em}
.crumb{font:600 11px var(--sans);letter-spacing:.11em;text-transform:uppercase;color:var(--ink-meta)}
h1{margin:.4rem 0 .6rem;font-size:1.9rem;letter-spacing:-.02em}
h2{margin:2.5rem 0 .5rem;font-size:1.05rem;letter-spacing:-.01em}
h3{margin:0;font-size:.95rem}
.lede{margin:0 0 1.5rem;max-width:44rem;color:var(--ink-body)}
.note{margin:0 0 .9rem;max-width:46rem;color:var(--ink-body);font-size:.9rem}
.namekey{margin:0 0 1.25rem;padding:.85rem 1rem;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow)}
.namenote{margin:.6rem 0 0;font-size:.85rem;color:var(--ink-body);max-width:52rem;line-height:1.7}
.stats{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))}
.stats div{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.85rem .95rem;box-shadow:var(--shadow)}
.stats b{display:block;font-size:1.6rem;font-weight:600;letter-spacing:-.02em}
.stats span{color:var(--ink-quiet);font-size:.76rem}
.field{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1rem 1.1rem;margin-bottom:.85rem;box-shadow:var(--shadow)}
.fhead{display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap}
.deck{color:var(--interactive)}
.lib{margin-left:auto;font-size:.74rem;color:var(--ink-quiet);background:var(--track);border-radius:999px;padding:.15rem .55rem}
.summary{margin:.35rem 0 .8rem;color:var(--ink-body);font-size:.88rem}
table{width:100%;border-collapse:collapse;font-size:.85rem}
table.wide{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow)}
th{text-align:left;font:600 10.5px var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-meta);padding:.5rem .7rem;border-bottom:1px solid var(--hairline)}
td{padding:.5rem .7rem;border-bottom:1px solid var(--hairline);vertical-align:middle}
tr:last-child td{border-bottom:none}
.src code{color:var(--ink-quiet)}
.out{font-variant-numeric:tabular-nums}
.ok{text-align:right;color:var(--interactive);font-weight:600}
.bad{color:var(--broken);font-weight:400}
.count{text-align:right;font-variant-numeric:tabular-nums}
.quiet{color:var(--ink-quiet)}
.chip{display:inline-block;border-radius:999px;padding:.1rem .6rem;font-size:.76rem;font-weight:600}
.tone{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.tone.overdue{color:var(--broken)}.tone.soon{color:var(--attention)}.tone.ok{color:var(--ink-meta)}
tr.diff{background:#fffaf3}
.verdict{margin:.9rem 0 0;padding:.7rem .9rem;border-radius:10px;font-size:.86rem;line-height:1.55}
.verdict.good{background:#f0fbf7;border:1px solid #cfeee2;color:#12241e}
.verdict.warn{background:#fff9f2;border:1px solid #f4e6d4;color:#7a4a10}
.verdict.bad{background:#fff1f1;border:1px solid #f6d6d6;color:#7a1010}
.ramps{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))}
.ramps>div{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.9rem;box-shadow:var(--shadow)}
.rlabel{font-size:.78rem;color:var(--ink-quiet)}
.ramp{display:flex;height:2.4rem;border-radius:8px;overflow:hidden;margin:.5rem 0;border:1px solid var(--hairline)}
.ramp i{flex:1}
.rhex{font-size:.72rem;color:var(--ink-meta)}
pre{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.9rem 1rem;overflow:auto;font-family:var(--mono);font-size:.74rem;line-height:1.5;box-shadow:var(--shadow)}
`;
document.head.append(style);
