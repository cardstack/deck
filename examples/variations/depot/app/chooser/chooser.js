// The chooser: three variations, side by side, actually running.
//
// Each panel is the SAME sealed page — /site/app/gallery/preview.html — asked
// for with a different `?with=`. No checkout, no build, no branch, and the
// app's own tree is identical in all four frames. What differs is one line of
// import map, computed by the server for that one request.
import { pill, legend, installPillStyles } from 'ui/pills';

installPillStyles();

const state = await (await fetch('/choice.json')).json();
const PREVIEW = '/site/app/preview/preview.html';

const frame = (query) =>
  `<iframe src="${PREVIEW}${query}" loading="lazy" title="preview"></iframe>`;

document.getElementById('page').innerHTML = `
  <header>
    <h1>A, B or C</h1>
    <p class="brief">brief: <b>${state.brief}</b></p>
    <p>
      An agent produced three variations. They are not three drafts of one
      edit — each attacks the brief in a different <em>layer</em>, so choosing
      between them is choosing a blast radius. All three are published,
      immutable, and addressable right now. Exactly one of them is what
      <code>latest</code> names.
    </p>
    ${legend(['deck'])}
  </header>

  <section class="grid">
    <article class="panel base">
      <h2>before</h2>
      <p class="layer">the released 1.0.0</p>
      ${pill('deck', '/site/app/preview/preview.html', { wrap: true })}
      ${frame('?with=std/tokens@1.0.0&with=ui/card@1.0.0&with=app/gallery@1.0.0')}
    </article>
    ${state.variations
      .map(
        (v) => `
      <article class="panel${v.id === state.chosen ? ' chosen' : ''}">
        <h2>${v.id.toUpperCase()} · ${v.title}${v.id === state.chosen ? ' <span class="tag">latest</span>' : ''}</h2>
        <p class="layer">${v.layer} layer — ${v.deck}</p>
        ${pill('deck', v.url.replace(/^\//, ''), { wrap: true })}
        ${frame(`?${v.with.split(',').map((pin) => `with=${encodeURIComponent(pin)}`).join('&')}`)}
        <p class="why">${v.rationale}</p>
        <p class="radius">changes <b>${v.blastRadius}</b></p>
      </article>`,
      )
      .join('')}
  </section>

  <section>
    <h2>What choosing did</h2>
    <p>
      Promoting <b>${state.chosen.toUpperCase()}</b> was a
      <code>deck release</code>: it named a sealed state that already existed,
      so <b>zero bytes were copied</b> and the tag moved.
    </p>
    <pre>${state.command}</pre>
    <table>
      <tr><th>variation</th><th>version</th><th>tags</th><th>still there?</th></tr>
      ${state.variations
        .map(
          (v) => `<tr>
            <td>${v.id.toUpperCase()} · ${v.deck}</td>
            <td><code>${v.version}</code></td>
            <td>${v.tags.length ? v.tags.map((t) => `<code>${t}</code>`).join(' ') : '<span class="quiet">—</span>'}</td>
            <td><a href="${v.url}">yes, at its own URL</a></td>
          </tr>`,
        )
        .join('')}
    </table>
    <p>
      The two you did not pick are not deleted, not stashed, and not on a
      branch. They are immutable published versions with no dist-tag pointing
      at them — which is all "not latest" has ever needed to mean. A
      <code>^1.0.0</code> consumer never sees them, because ranges do not match
      prereleases, so nothing downstream moved when the agent produced them and
      nothing moved when you rejected two.
    </p>
    <p>
      Change your mind in a month: <code>deck release … --from try-a</code>
      again. The bytes are still there, and it is still a pointer move.
    </p>
  </section>
`;

document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
  :root {
    --ink:#272330; --body:#5a586a; --quiet:#8b8b93; --stage:#f7f8fa;
    --surface:#fff; --line:#e2e8f0; --teal:#0c9d7c;
    --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
    --sans:'IBM Plex Sans',system-ui,sans-serif;
  }
  body { margin:0; background:var(--stage); color:var(--ink); font-family:var(--sans); }
  #page { max-width:76rem; margin:0 auto; padding:2rem 1.25rem 4rem; }
  h1 { font-size:1.9rem; letter-spacing:-.02em; margin:0 0 .3rem; }
  h2 { font-size:.98rem; margin:0 0 .2rem; }
  p { color:var(--body); line-height:1.55; max-width:48rem; }
  code { font-family:var(--mono); font-size:.86em; }
  pre { font-family:var(--mono); font-size:.78rem; background:var(--surface);
        border:1px solid var(--line); border-radius:8px; padding:.8rem .9rem; overflow:auto; }
  header { border-bottom:1px solid var(--line); padding-bottom:1.2rem; margin-bottom:1.5rem; }
  .brief { font-size:1rem; color:var(--ink); margin:.2rem 0 .6rem; }
  section { margin:2rem 0; }
  /* Two up, not four. A variation about DENSITY is invisible in a 250px
     frame — C's extra columns only appear once the frame is wide enough for
     auto-fill to give it one, which is exactly the reader's own question. */
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(26rem,1fr)); gap:.9rem; }
  .panel { background:var(--surface); border:1px solid var(--line); border-radius:10px;
           padding:.85rem .9rem; box-shadow:0 2px 8px rgba(28,28,50,.05); }
  .panel.base { background:#f6f7f9; }
  .panel.chosen { border-color:#cfeee2; box-shadow:0 0 0 2px #cfeee2, 0 10px 26px rgba(28,28,50,.11); }
  .tag { font-size:.62rem; text-transform:uppercase; letter-spacing:.08em; color:#0a6d56;
         background:#f0fbf7; border:1px solid #cfeee2; border-radius:999px; padding:.1em .5em; }
  .layer { font-size:.78rem; color:var(--quiet); margin:0 0 .5rem; }
  .why { font-size:.82rem; margin:.6rem 0 .2rem; }
  .radius { font-size:.78rem; color:var(--quiet); margin:0; }
  iframe { width:100%; height:19rem; border:1px solid var(--line); border-radius:8px;
           background:#fff; margin-top:.5rem; }
  table { width:100%; border-collapse:collapse; font-size:.85rem; background:var(--surface);
          border:1px solid var(--line); border-radius:10px; overflow:hidden; margin:1rem 0; }
  th { text-align:left; font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; color:var(--quiet); }
  th, td { padding:.45rem .7rem; border-bottom:1px solid #eceef1; }
  a { color:#0069f9; }
  .quiet { color:var(--quiet); }
  </style>`,
);
