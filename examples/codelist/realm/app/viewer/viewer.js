// The viewer is an ordinary consumer. It knows four URLs and fetches them
// the way any page would — no Deck client library, no SDK. That is the
// point: a sealed deck is just files at an address.
//
// It renders the four states side by side so the *shape* of the merge is
// visible: which keys each state has, who introduced them, and the fact
// that nowhere in the sequence did anyone resolve a conflict.

import { installPillStyles, legend, pill } from 'ui/pills';

const { realm, states } = await (await fetch('./states.json')).json();

installPillStyles();

// Fetch each sealed state. These are immutable URLs — the browser may cache
// them forever, and the server says so.
let loaded = await Promise.all(
  states.map(async (state) => ({
    ...state,
    url: `/${realm}/${state.deck}@${state.version}/currencies.json`,
    codes: await (
      await fetch(`/${realm}/${state.deck}@${state.version}/currencies.json`)
    ).json(),
  })),
);

let [shared, amended, fork, rebased] = loaded;

// Every key that appears anywhere, so the columns line up and an absence is
// as visible as a presence.
let allKeys = [...new Set(loaded.flatMap((s) => Object.keys(s.codes)))].sort();

// Where each key came from, for the legend colour.
let origin = (key) => {
  if (key in shared.codes) return 'base';
  if (key in fork.codes && !(key in amended.codes)) return 'acme';
  return 'added';
};

const ORIGIN_LABEL = {
  base: 'in 1.4.0 already',
  added: 'added upstream in 1.5.0',
  acme: "acme's internal code",
};

let app = document.querySelector('#app');
app.classList.remove('loading');
app.innerHTML = `
  <header>
    <h1>The merge that is not a conflict</h1>
    <p class="lede">
      Two people added different currency codes to the same list at the same
      time. A codelist is a <em>set of keys</em>, so that was never a
      conflict — only a line-based merge would have called it one.
      All four states below are sealed versions at immutable URLs.
      <strong>Nothing on this page required a login or a write endpoint.</strong>
    </p>
  </header>

  <section class="legend">
    ${Object.entries(ORIGIN_LABEL)
      .map(([k, label]) => `<span class="chip ${k}"><i></i>${label}</span>`)
      .join('')}
  </section>

  <section class="namekey">
    ${legend(['deck'])}
    <p class="namenote">
      Every address on this page is a <em>Deck</em> address — this realm's own
      delivery space. Nothing here came from a registry or a repository, which
      is why there is only one pill to learn.
    </p>
  </section>

  <section class="states">
    ${loaded
      .map(
        (s) => `
      <article class="state">
        <div class="strip">
          <span class="dot pinned" title="an exact version — immutable"></span>
          <code class="deck">${s.deck}</code>
          <code class="version">${s.version}</code>
        </div>
        <h2>${s.label}</h2>
        <p class="note">${s.note}</p>
        <p class="count"><strong>${Object.keys(s.codes).length}</strong> keys</p>
        <ul class="keys">
          ${allKeys
            .map((k) =>
              k in s.codes
                ? `<li class="${origin(k)}" title="${s.codes[k].name}">${k}</li>`
                : `<li class="absent">·</li>`,
            )
            .join('')}
        </ul>
        <a class="url" href="${s.url}">${pill('deck', s.url, { wrap: true })}</a>
        <p class="hash" title="tree-hash-v1">${s.hash.slice(0, 24)}…</p>
      </article>`,
      )
      .join('')}
  </section>

  <section class="reading">
    <h3>What to read here</h3>
    <ol>
      <li>
        <strong>1.4.0 → 1.5.0 gained three keys and lost nothing.</strong>
        Two people amended concurrently. Both amendments are present, and
        neither person resolved anything.
      </li>
      <li>
        <strong>The fork kept its three internal codes across the upgrade.</strong>
        Rebasing it onto 1.5.0 absorbed upstream's new keys and left
        <code>XAC</code>, <code>XPT</code> and <code>XVC</code> untouched.
        No <em>data</em> collided, because nobody touched the same key.
      </li>
      <li>
        <strong>Exactly one thing did need a person, and it was the right one.</strong>
        The rebase reported a conflict in <code>importmap.json</code>: the
        fork called itself <code>1.4.0-acme.1</code> and upstream called
        itself <code>1.5.0</code>, so both sides edited the same key. A
        machine can combine two sets of codes, because &ldquo;both&rdquo; is
        well defined. It cannot decide what to <em>name</em> the
        combination — that is a judgement about compatibility, and the merge
        says so rather than guessing.
      </li>
      <li>
        <strong>Every column is still there.</strong> There is no unpublish.
        1.4.0 did not become wrong when 1.5.0 appeared, so a consumer pinned
        to it keeps working forever.
      </li>
    </ol>
    <p class="foot">
      Try the raw addresses — they are the same bytes this page fetched:<br />
      ${loaded.map((s) => `<a href="${s.url}">${pill('deck', `${s.deck}@${s.version}`)}</a>`).join(' ')}
    </p>
  </section>
`;

// Styling lives here so the demo is two files, not five. A real app would
// ship CSS as another file in the same deck.
let style = document.createElement('style');
style.textContent = `
  /* Boxel light surface tier — one stage colour, white panels, hairline
     borders. Light only: the demo hub frames this page in the same palette,
     and two themes fighting inside one console reads as two products. */
  :root {
    --bg: #f7f8fa; --panel: #fff; --line: #e2e8f0;
    --ink: #272330; --dim: #5a586a;
    --base: #c9ced8; --added: #0c9d7c; --acme: #b45309;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 3rem 1.5rem 5rem;
    background: var(--bg); color: var(--ink);
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  #app { max-width: 74rem; margin: 0 auto; }
  #app.loading { color: var(--dim); }
  h1 { font-size: 1.6rem; margin: 0 0 .5rem; letter-spacing: -0.01em; }
  .lede { color: var(--dim); max-width: 46rem; margin: 0 0 2rem; }
  .lede strong { color: var(--ink); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }

  .legend { display: flex; gap: 1.25rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .chip { display: inline-flex; align-items: center; gap: .45rem; color: var(--dim); font-size: .82rem; }
  .chip i { width: .7rem; height: .7rem; border-radius: 2px; display: inline-block; }
  .chip.base i { background: var(--base); }
  .chip.added i { background: var(--added); }
  .chip.acme i { background: var(--acme); }

  .namekey { margin: 0 0 1.5rem; padding: .8rem .95rem; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
  .namenote { margin: .55rem 0 0; font-size: .82rem; color: var(--dim); max-width: 46rem; }

  .states { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
  .state {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px; padding: 1rem 1.1rem 1.2rem;
  }
  .strip { display: flex; align-items: center; gap: .5rem; margin-bottom: .75rem; }
  .dot { width: .6rem; height: .6rem; border-radius: 50%; flex: none; }
  /* Hollow = pinned, per the badge vocabulary in deck-fitted-thesis.md. */
  .dot.pinned { border: 2px solid var(--dim); }
  .deck { color: var(--dim); }
  .version {
    margin-left: auto; padding: .1rem .45rem; border-radius: 4px;
    background: var(--line); color: var(--ink);
  }
  .state h2 { font-size: .98rem; margin: 0 0 .3rem; }
  .note { color: var(--dim); font-size: .84rem; margin: 0 0 .8rem; min-height: 2.4em; }
  .count { margin: 0 0 .6rem; font-size: .84rem; color: var(--dim); }
  .count strong { color: var(--ink); font-size: 1.15rem; }

  .keys { list-style: none; display: flex; flex-wrap: wrap; gap: .25rem; padding: 0; margin: 0 0 .9rem; }
  .keys li {
    font: 600 .72rem/1 ui-monospace, monospace; padding: .3rem .35rem;
    border-radius: 3px; background: var(--base); color: #fff; min-width: 2.6rem; text-align: center;
  }
  .keys li.added { background: var(--added); color: #fff; }
  .keys li.acme { background: var(--acme); color: #fff; }
  .keys li.absent { background: transparent; color: var(--line); }

  .url { display: block; text-decoration: none; }
  .hash { color: var(--line); font: .7rem ui-monospace, monospace; margin: .4rem 0 0; }

  .reading { margin-top: 2.5rem; border-top: 1px solid var(--line); padding-top: 1.5rem; }
  .reading h3 { font-size: 1rem; margin: 0 0 .75rem; }
  .reading ol { margin: 0; padding-left: 1.2rem; color: var(--dim); max-width: 50rem; }
  .reading li { margin-bottom: .6rem; }
  .reading strong { color: var(--ink); font-weight: 600; }
  .foot { margin-top: 1.5rem; color: var(--dim); font-size: .85rem; }
  .foot a { color: var(--dim); }
`;
document.head.append(style);
