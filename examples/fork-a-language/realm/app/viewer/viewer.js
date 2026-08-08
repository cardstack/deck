// Both engines, running in the browser, from two sealed decks.
const b = await (await fetch('./build.json')).json();
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
    <div><span class="dot up"></span><code>${b.upstream.deck}@${b.upstream.version}</code><em>${b.upstream.dialect.tagline}</em></div>
    <div><span class="dot fk"></span><code>${b.fork.deck}@${b.fork.version}</code><em>${b.fork.dialect.tagline}</em></div>
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
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--ink:#e6e9ef;--dim:#8b93a7;--up:#3fb950;--fk:#d29922}
@media(prefers-color-scheme:light){:root{--bg:#f6f7f9;--panel:#fff;--line:#e2e5ea;--ink:#1c2028;--dim:#666f80}}
*{box-sizing:border-box}
body{margin:0;padding:3rem 1.5rem 5rem;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,system-ui,sans-serif}
#app{max-width:70rem;margin:0 auto}#app.loading{color:var(--dim)}
h1{font-size:1.6rem;margin:0 0 .5rem;letter-spacing:-.01em}
.lede{color:var(--dim);max-width:46rem;margin:0 0 1.5rem}.lede strong{color:var(--ink)}
code{font-family:ui-monospace,Menlo,monospace;font-size:.85em}
.dialects{display:flex;gap:2rem;flex-wrap:wrap;margin-bottom:1.5rem}
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
tr.diff .verdict{color:#f85149}
.added{margin-top:2rem;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1rem 1.2rem}
.added h3{margin:0 0 .5rem;font-size:1rem}
.added p{margin:.3rem 0}.dim{color:var(--dim);font-size:.86rem}
.facts{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));margin-top:1.25rem}
.facts div{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1rem;display:flex;gap:.8rem;align-items:baseline}
.facts b{font-size:1.7rem;color:var(--up)}.facts span{color:var(--dim);font-size:.85rem}
`;
document.head.append(s);
