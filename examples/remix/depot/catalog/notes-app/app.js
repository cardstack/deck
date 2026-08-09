import { theme } from 'notes/theme';
import { list } from 'notes/list';

// This module is the PARENT's, unmodified, in both pages you can open. It
// renders the notes, and then it reads the import map the server injected
// into this document and reports where each of its own modules came from.
//
// That second part is the demo. Nothing here knows whether it is running
// inside the catalog's app or inside somebody's remix of it — it just prints
// the map it was given, and the map is the only thing that differs.

const injected = JSON.parse(
  document.querySelector('script[type="importmap"]')?.textContent ?? '{}',
);

// "Mine" means "under the prefix this page is served from" — not "has no
// version in the URL". The parent's own modules are sealed and versioned
// too, so a test for `@` would label the catalog's app as inheriting from
// itself.
const ownPrefix = location.pathname.replace(/[^/]*$/, '');
const isOwn = (url) => url.startsWith(ownPrefix);

function provenance() {
  let entries = Object.entries(injected.imports ?? {});
  let rows = entries.map(([name, url]) => {
    let own = isOwn(url);
    return `<tr>
      <td><code>${name}</code></td>
      <td><span class="badge ${own ? 'mine' : 'inherited'}">${
        own ? 'this deck' : 'inherited'
      }</span></td>
      <td><code class="url">${url}</code></td>
    </tr>`;
  });
  let own = entries.filter(([, url]) => isOwn(url)).length;
  let total = entries.length;
  return `
    <p class="count">${
      own === total
        ? `All <b>${total}</b> modules are this deck's own — you are looking at the app itself.`
        : `<b>${total - own}</b> of <b>${total}</b> modules resolve to the parent's
           sealed Version, and no copy of them exists here. <b>${own}</b>
           ${own === 1 ? 'is' : 'are'} this deck's own.`
    }</p>
    <table>
      <tr><th>specifier</th><th>from</th><th>resolves to</th></tr>
      ${rows.join('')}
    </table>`;
}

document.getElementById('app').innerHTML = `
  <header>
    <div class="crumb">deck · example · remix</div>
    <h1>${theme.name}</h1>
    <p class="lede">
      One app, two decks. The second states a parent and one overridden
      entry — and gets a complete import map back.
    </p>
  </header>
  ${list()}
  <section>
    <h2>The map this page was served</h2>
    ${provenance()}
  </section>
`;

document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
  :root { --ink:${theme.ink}; --surface:${theme.surface}; --accent:${theme.accent};
          --stage:${theme.stage}; --radius:${theme.radius};
          --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
          --sans:'IBM Plex Sans',system-ui,sans-serif; }
  body { margin:0; background:var(--stage); color:var(--ink); font-family:var(--sans); }
  #app { max-width:52rem; margin:0 auto; padding:2rem 1.25rem 4rem; }
  h1 { font-size:1.7rem; letter-spacing:-.02em; margin:0 0 .3rem; }
  h2 { font-size:1rem; margin:0 0 .6rem; }
  .crumb { font:600 11px var(--sans); letter-spacing:.11em; text-transform:uppercase;
           color:var(--ink); opacity:.5; }
  .lede { color:var(--ink); opacity:.7; line-height:1.5; max-width:38rem; }
  header { border-bottom:1px solid var(--accent)33; padding-bottom:1rem; margin-bottom:1.4rem; }
  section { margin-top:2rem; }
  table { width:100%; border-collapse:collapse; font-size:.82rem; background:var(--surface);
          border:1px solid var(--accent)33; border-radius:var(--radius); overflow:hidden; }
  th { text-align:left; font-size:.7rem; text-transform:uppercase; letter-spacing:.05em;
       opacity:.55; font-weight:600; }
  th, td { padding:.45rem .6rem; border-bottom:1px solid var(--accent)1a; }
  tr:last-child td { border-bottom:none; }
  code { font-family:var(--mono); }
  .url { opacity:.75; word-break:break-all; }
  .badge { font-size:.68rem; text-transform:uppercase; letter-spacing:.06em;
           padding:.12rem .45rem; border-radius:999px; white-space:nowrap; }
  /* Inherited is the quiet, ordinary case — most of an app should be it.
     What the deck owns is what deserves the ink. */
  .inherited { background:var(--ink)0f; color:var(--ink); opacity:.55; }
  .mine { background:var(--accent); color:var(--surface); }
  .count { font-size:.9rem; opacity:.8; }
  </style>`,
);
