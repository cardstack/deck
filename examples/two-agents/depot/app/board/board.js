// The reviewer's page: three token sets that were edited at the same time,
// and the rule that decided each key nobody could agree on.
//
// It imports the two agents' component decks by their bare specifiers. The
// server injects an import map that resolves them to whatever this deck's
// decklist says — `live`, here, so the page is showing exactly what is on
// disk this second.
import { table } from 'ui/table';
import { spark } from 'charts/spark';
import { pill, installPillStyles } from 'ui/pills';

installPillStyles();

const load = async (url) => {
  let response = await fetch(url);
  return response.ok ? response.json() : undefined;
};

const SETS = [
  // `@latest` is a dist-tag, so this follows upstream wherever it goes — one
  // short-TTL hop to whatever exact version it currently names.
  { who: 'std/tokens', label: 'upstream', url: '/site/std/tokens@latest/tokens.json' },
  { who: 'agent-a/tokens', label: 'agent A', url: '/site/agent-a/tokens/tokens.json' },
  { who: 'agent-b/tokens', label: 'agent B', url: '/site/agent-b/tokens/tokens.json' },
];

let [decisions, ...sets] = await Promise.all([
  load('/decisions.json').catch(() => undefined),
  ...SETS.map((set) => load(set.url)),
]);

// A token set is not a table of numbers, it is a look. So the page renders
// one small interface per set, from that set's own values, and an agent's
// edit repaints something you recognise: the corners get rounder, the button
// changes colour, the spacing opens up.
function preview(tokens) {
  if (!tokens) return '<em class="quiet">not served</em>';
  let color = tokens.color ?? {};
  let gap = (tokens.scale ?? [8])[1] ?? 8;
  let pad = (tokens.scale ?? [16])[2] ?? 16;
  let accent = color.accent ?? color.ink ?? '#5a586a';
  return `<div class="theme" style="
      --r:${tokens.radius ?? 4}px; --gap:${gap}px; --pad:${pad}px;
      --ink:${color.ink ?? '#272330'}; --surface:${color.surface ?? '#fff'};
      --accent:${accent}; --muted:${color.muted ?? '#b9b9c0'};">
    <div class="tcard">
      <div class="trow"><span class="tdot"></span><b>${tokens.name ?? '—'}</b></div>
      <div class="tbar"></div>
      <div class="tbar short"></div>
      <div class="tactions">
        <span class="tbtn">Confirm</span>
        ${color.warning ? '<span class="twarn">Check stock</span>' : ''}
      </div>
    </div>
  </div>
  <div class="swatches">${Object.entries(color)
    .map(([name, value]) => `<span class="sw"><i style="background:${value}"></i>${name}</span>`)
    .join('')}</div>`;
}

document.getElementById('board').innerHTML = `
  <header>
    <div class="crumb">deck · example · W1</div>
    <h1>A rule resolves it. No rule refuses.</h1>
    <p>
      Two agents edited at the same moment. On their own decks —
      ${pill('deck', 'ui/table')} and ${pill('deck', 'charts/spark')} — there
      was nothing to merge. On ${pill('deck', 'std/tokens')} there was.
    </p>
  </header>

  <div class="refusal">
    <b>refused</b>
    <p><code>name</code> has no rule in <code>merge-policy.json</code>, so the
      resolver wrote <strong>nothing at all</strong> — not even the keys it
      could have settled. Agent A's tree is byte for byte what it was. A
      resolver that quietly picks a side is worse than none, because you stop
      reading its output.</p>
  </div>

  <section class="sets">
    ${SETS.map(
      (set, i) => `
      <article>
        <h2>${set.label}</h2>
        ${pill('deck', set.url.replace(/^\/site\//, '').replace(/\/tokens\.json$/, ''), { wrap: true })}
        ${preview(sets[i])}
        <p class="nums">radius <b>${sets[i]?.radius ?? '—'}</b> · scale
          <b>${(sets[i]?.scale ?? []).join(' · ') || '—'}</b></p>
      </article>`,
    ).join('')}
  </section>

  <section>
    <h2>What the policy decided</h2>
    <p>
      Nothing generic can resolve two different answers to one key, because
      nothing generic knows that <code>scale</code> is a set and
      <code>radius</code> is a scalar with a house rule. The rules are
      published data, in upstream's own sealed tree, so the resolution is a
      pure function of three values and a rule anyone can read.
    </p>
    ${
      decisions?.length
        ? `<table class="decisions">
            <tr><th>key</th><th>base</th><th>upstream</th><th>agent A</th><th>rule</th><th>resolved</th></tr>
            ${decisions
              .map(
                (d) => `<tr>
                  <td><code>${d.key}</code></td>
                  <td>${JSON.stringify(d.base)}</td>
                  <td>${JSON.stringify(d.upstream)}</td>
                  <td>${JSON.stringify(d.fork)}</td>
                  <td><b>${d.rule}</b></td>
                  <td><b>${JSON.stringify(d.resolved)}</b></td>
                </tr>`,
              )
              .join('')}
          </table>`
        : '<p class="quiet">no decisions recorded</p>'
    }
  </section>

  <section>
    <h2>The two components, live</h2>
    <p>Rendered right now from whatever is on disk in each agent's deck.</p>
    <div class="live">
      ${table([
        { label: 'radius', value: sets[1]?.radius ?? '—' },
        { label: 'steps', value: (sets[1]?.scale ?? []).length },
      ])}
      ${spark(sets[1]?.scale ?? [1, 2, 3], sets[1]?.color?.accent ?? '#0c9d7c')}
    </div>
  </section>
`;

document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
  :root {
    --ink: #272330; --body: #5a586a; --quiet: #8b8b93;
    --stage: #f7f8fa; --surface: #fff; --line: #e2e8f0; --teal: #0c9d7c;
    --mono: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    --sans: 'IBM Plex Sans', system-ui, sans-serif;
  }
  body { margin: 0; background: var(--stage); color: var(--ink); font-family: var(--sans); }
  #board { max-width: 62rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.8rem; letter-spacing: -.02em; margin: 0 0 .4rem; }
  h2 { font-size: 1.05rem; margin: 0 0 .6rem; }
  p { color: var(--body); line-height: 1.55; max-width: 46rem; }
  code { font-family: var(--mono); font-size: .86em; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 1.2rem; margin-bottom: 1.6rem; }
  section { margin: 2rem 0; }
  .sets { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: .9rem; }
  .sets article {
    background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
    padding: .9rem 1rem; box-shadow: 0 2px 8px rgba(28,28,50,.05);
  }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .1rem .7rem; margin: .8rem 0 .6rem; font-size: .88rem; }
  dt { color: var(--quiet); }
  dd { margin: 0; font-family: var(--mono); }
  .crumb { font: 600 11px var(--sans); letter-spacing: .11em; text-transform: uppercase; color: var(--quiet); }
  .refusal { display: flex; gap: .9rem; align-items: flex-start; margin: 0 0 1.6rem;
    background: #fff1f1; border: 1px solid #f0c9c9; border-left: 5px solid #c02626;
    border-radius: 10px; padding: .85rem 1rem; }
  .refusal b { font: 600 .72rem var(--sans); letter-spacing: .1em; text-transform: uppercase;
    color: #c02626; padding-top: .18rem; }
  .refusal p { margin: 0; font-size: .88rem; color: #6b1a1a; }
  .refusal strong { color: #c02626; }
  /* The preview paints itself from the set's own tokens. Nothing here picks a
     colour or a radius — every value below comes off the JSON. */
  .theme { margin: .8rem 0 .6rem; }
  .tcard { background: var(--surface); color: var(--ink); border: 1px solid #e2e8f0;
    border-radius: var(--r); padding: var(--pad); display: grid; gap: var(--gap); }
  .trow { display: flex; align-items: center; gap: .5rem; font-size: .9rem; }
  .tdot { width: .7rem; height: .7rem; border-radius: var(--r); background: var(--accent); }
  .tbar { height: .5rem; border-radius: var(--r); background: var(--muted); opacity: .45; }
  .tbar.short { width: 60%; }
  .tactions { display: flex; gap: var(--gap); align-items: center; }
  .tbtn { background: var(--accent); color: #fff; border-radius: var(--r);
    padding: .3rem .7rem; font-size: .78rem; }
  .twarn { color: #d97706; font-size: .78rem; }
  .nums { margin: .3rem 0 0; font-size: .78rem; color: var(--quiet); }
  .nums b { color: var(--body); font-family: var(--mono); }
  .swatches { display: flex; flex-wrap: wrap; gap: .4rem; font-size: .76rem; color: var(--body); }
  .sw { display: inline-flex; align-items: center; gap: .3rem; }
  .sw i { width: .8rem; height: .8rem; border-radius: 3px; border: 1px solid var(--line); }
  table.decisions {
    width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: .8rem;
    background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
  }
  .decisions th { text-align: left; font-family: var(--sans); font-size: .7rem; text-transform: uppercase;
    letter-spacing: .05em; color: var(--quiet); }
  .decisions th, .decisions td { padding: .45rem .6rem; border-bottom: 1px solid #eceef1; }
  .live { display: flex; gap: 1.5rem; align-items: center; background: var(--surface);
    border: 1px solid var(--line); border-radius: 10px; padding: 1rem; }
  .live table { border-collapse: collapse; font-size: .85rem; }
  .live td { padding: .2rem .8rem .2rem 0; }
  .live svg { width: 12rem; height: 3rem; }
  .quiet { color: var(--quiet); }
  </style>`,
);
