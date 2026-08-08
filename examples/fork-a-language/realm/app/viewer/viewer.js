// Both engines, running in the browser, from two sealed decks.
import { installPillStyles, legend, pill } from 'ui/pills';

const b = await (await fetch('./build.json')).json();

installPillStyles();
const url = (s) => `/${b.realm}/${s.deck}@${s.version}/index.js`;
const [up, fk] = await Promise.all([import(url(b.upstream)), import(url(b.fork))]);
const show = (v) => JSON.stringify(v);

let rows = b.pairs
  .map((p) => {
    let a = show(up.run(p.jqish, b.data));
    let c = show(fk.run(p.feelish, b.data));
    return `<tr class="${a === c ? 'same' : 'diff'}">
      <td class="ask">${p.ask}</td>
      <td><code>${p.jqish.replace(/</g, '&lt;')}</code></td>
      <td><code>${p.feelish.replace(/</g, '&lt;')}</code></td>
      <td class="out"><code>${a.replace(/</g, '&lt;')}</code></td>
      <td class="verdict">${a === c ? '=' : '≠'}</td>
    </tr>`;
  })
  .join('');

let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
  <h1>Fork a language. Keep the engine.</h1>
  <p class="lede">
    Two decks. One replaces a single file — the parser — with a
    <strong>FEEL-shaped</strong> surface language instead of a jq-shaped one.
    <code>eval.js</code> is byte-identical between them, so the store keeps
    <strong>one</strong> copy and both dialects are provably running the same
    semantics.
  </p>

  <div class="dialects">
    <div><span class="dot up"></span>${pill('deck', `${b.upstream.deck}@${b.upstream.version}`)}<em>${b.upstream.dialect.tagline}</em></div>
    <div><span class="dot fk"></span>${pill('deck', `${b.fork.deck}@${b.fork.version}`)}<em>${b.fork.dialect.tagline}</em></div>
  </div>

  <div class="namekey">
    ${legend(['deck'])}
    <p class="namenote">
      Both dialects are <em>Deck</em> addresses in this realm — neither is on a
      registry and neither has a repository. A language can be a deck, and a
      dialect of it can be another deck, without either one being a product.
    </p>
  </div>

  <table>
    <thead><tr><th>the question</th><th>jqish</th><th>feelish</th><th>answer</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <section class="added">
    <h3>What the fork added</h3>
    <p><code>${b.extra.feelish}</code> → <code>${b.extra.forkOut}</code></p>
    <p class="dim">
      A FEEL range. Upstream cannot parse one at all —
      <code>${b.rejected.replace(/</g, '&lt;')}</code> — and it did not need
      to learn: the range desugars <em>inside the parser</em> to
      <code>qty &gt;= 2 and qty &lt;= 8</code>, two comparisons the shared
      evaluator already understood. A new language feature, zero evaluator
      change.
    </p>
  </section>

  <section class="facts">
    <div><b>${b.changed.length}</b><span>file changed: <code>${b.changed.join(', ')}</code></span></div>
    <div><b>${b.shared.length}</b><span>files byte-identical: <code>${b.shared.join(', ')}</code></span></div>
    <div><b>${b.store.objects}</b><span>objects in the store, where two full copies would be ${b.store.wouldBe}</span></div>
  </section>
`;

let s = document.createElement('style');
s.textContent = `
/* Boxel light surface tier. Light only — see the note in codelist. */
:root{--bg:#f7f8fa;--panel:#fff;--line:#e2e8f0;--ink:#272330;--dim:#5a586a;--up:#0c9d7c;--fk:#b45309}
*{box-sizing:border-box}
body{margin:0;padding:3rem 1.5rem 5rem;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,system-ui,sans-serif}
#app{max-width:70rem;margin:0 auto}#app.loading{color:var(--dim)}
h1{font-size:1.6rem;margin:0 0 .5rem;letter-spacing:-.01em}
.lede{color:var(--dim);max-width:46rem;margin:0 0 1.5rem}.lede strong{color:var(--ink)}
code{font-family:ui-monospace,Menlo,monospace;font-size:.85em}
.dialects{display:flex;gap:2rem;flex-wrap:wrap;margin-bottom:1rem}
.namekey{margin:0 0 1.5rem;padding:.8rem .95rem;background:var(--panel);border:1px solid var(--line);border-radius:10px}
.namenote{margin:.55rem 0 0;font-size:.82rem;color:var(--dim);max-width:48rem}
.dialects div{display:flex;align-items:center;gap:.5rem;font-size:.88rem}
.dialects em{color:var(--dim);font-style:normal}
.dot{width:.6rem;height:.6rem;border-radius:50%;border:2px solid var(--dim)}
.dot.up{border-color:var(--up)}.dot.fk{border-color:var(--fk)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th{text-align:left;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--dim);padding:.7rem .8rem;border-bottom:1px solid var(--line)}
td{padding:.7rem .8rem;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:none}
.ask{color:var(--dim)}.out code{color:var(--up)}
.verdict{font-size:1.1rem;color:var(--up);text-align:center}
tr.diff .verdict{color:#d92d20}
.added{margin-top:2rem;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1rem 1.2rem}
.added h3{margin:0 0 .5rem;font-size:1rem}
.added p{margin:.3rem 0}.dim{color:var(--dim);font-size:.86rem}
.facts{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));margin-top:1.25rem}
.facts div{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1rem;display:flex;gap:.8rem;align-items:baseline}
.facts b{font-size:1.7rem;color:var(--up)}.facts span{color:var(--dim);font-size:.85rem}
`;
document.head.append(s);
