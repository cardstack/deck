// Heat — one decoration, every list, everywhere.
//
// The Hub is a front end for a thing that is being WORKED ON, usually right
// now, often by an agent that is faster than you are. A list of ten depots
// that reads the same whether one of them was touched four seconds ago or
// four months ago is a list you cannot navigate; you can only search it, and
// searching requires already knowing the answer.
//
// So every list here decorates its rows with heat, and heat means the same
// thing in all of them: how much change has landed here lately, weighted so
// that recent counts more. Follow the warm row down and you arrive at the
// file being edited, without having been told where to look.
//
// WHY THIS IS ONE MODULE AND NOT FOUR IMPLEMENTATIONS. If /browse invented
// its own warmth and /run invented another, the same depot would read hot in
// one and cold in the next, and a reader would stop trusting the colour —
// which costs more than never having had it. It is one function over one
// endpoint, imported by every app at `ui/heat`.
//
// The server (hub.mjs) does the decay; see the note there for why the score
// is a sum. Everything below is the consequence: because it is a sum, rolling
// up to a prefix is `filter + add`, and there is nothing to keep in sync.

let REPORT = { now: Date.now(), scores: {}, last: {} };
let listeners = new Set();

/**
 * Fetch the report. Cheap, uncached on the server, ~5 KB.
 *
 * Never throws: a Hub that cannot report heat should lose the decoration and
 * keep the list. Everything below degrades to zero, which renders as an
 * ordinary undecorated row.
 */
export async function loadHeat() {
  try {
    let response = await fetch('/_hub/heat', { headers: { accept: 'application/json' } });
    if (response.ok) REPORT = await response.json();
  } catch {
    // no decoration this time
  }
  for (let listener of listeners) listener();
  return REPORT;
}

/** Re-fetch whenever the depot changes, so a row warms while you watch it. */
export function onHeatChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The score for one address, INCLUDING everything under it.
 *
 * `/hub` sums every file in the depot; `/hub/app/run` sums that deck;
 * `/hub/app/run/run.js` is the leaf itself. One call, any depth, because the
 * server hands back leaves and addition does the rest.
 *
 * The prefix has to end at a segment boundary or `/hub/app/run` would also
 * claim `/hub/app/runner`, and heat would leak sideways into a deck that is
 * merely spelled similarly.
 */
export function scoreOf(prefix) {
  let clean = String(prefix ?? '').replace(/\/+$/, '');
  if (!clean) return { score: 0, last: 0, files: 0 };
  let score = 0;
  let last = 0;
  let files = 0;
  for (let [path, value] of Object.entries(REPORT.scores ?? {})) {
    if (path !== clean && !path.startsWith(`${clean}/`)) continue;
    score += value;
    files += 1;
    last = Math.max(last, REPORT.last?.[path] ?? 0);
  }
  return { score, last, files };
}

/**
 * Turn scores into the 0…1 the CSS wants, normalised across ONE list.
 *
 * Normalising per view rather than globally is deliberate. The absolute score
 * has no meaning a person could hold — it is a sum of exponentials — and a
 * fixed scale would leave every row pale on a quiet day and every row hot on
 * a busy one. Against the hottest row on screen, the decoration always uses
 * its full range, and the only question it asks the eye is the one the eye is
 * good at: which of these two is warmer.
 *
 * The curve is a fourth root. A linear ramp wastes almost all of its range on
 * the single hottest row, because one deck under active edit outscores nine
 * idle ones by orders of magnitude; the root pulls the quiet-but-not-dead
 * rows up to where they are still visible, which is exactly the population
 * this is for.
 */
export function heatScale(scores) {
  let max = Math.max(0, ...scores);
  if (max <= 0) return () => 0;
  return (score) => (score <= 0 ? 0 : Math.min(1, (score / max) ** 0.25));
}

/** `just now` · `4m` · `2h` · `3d` — the same clock /track speaks. */
export function ago(epochMs) {
  if (!epochMs) return '';
  let seconds = Math.max(0, (Date.now() - epochMs) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * Stamp a row. `<tr>`, `<li>`, anything.
 *
 * `--heat` drives every visual, so a caller chooses nothing about appearance
 * and cannot drift from the other apps. `data-heat` exists so CSS can hide
 * the whole apparatus at zero without a second class to keep in step.
 */
export function decorate(element, heat, detail = {}) {
  element.style.setProperty('--heat', heat.toFixed(3));
  element.dataset.heat = heat > 0.02 ? '1' : '0';
  if (detail.last) element.dataset.when = ago(detail.last);
  if (detail.files) element.dataset.files = String(detail.files);
}

/** The markup for the heat gutter cell. Same glyph in every app. */
export function heatCell(heat, detail = {}) {
  let when = detail.last ? ago(detail.last) : '';
  return (
    `<td class="heat-cell" style="--heat:${heat.toFixed(3)}" ` +
    `data-heat="${heat > 0.02 ? 1 : 0}"${when ? ` title="last change ${when}"` : ''}>` +
    `<span class="heat-bar"></span>` +
    `<span class="heat-when">${when}</span></td>`
  );
}

// The colours are inherited from the page's palette, never declared here, for
// the same reason the nav does it: a theme is a deck, and this has to look
// right in whichever one is linked.
//
// A bar and not a background tint. A tinted row reads as SELECTED — every
// table in the world has taught that — so a busy list would look like it had
// nine things selected in it. A bar in the gutter is a second channel that
// nothing else is using, and it stacks with hover and cursor states instead
// of fighting them.
export const HEAT_CSS = `
.heat-cell {
  width: 1%; white-space: nowrap; padding-right: 1ch;
  vertical-align: baseline;
}
.heat-bar {
  display: inline-block; width: 3px; height: 1.05em;
  vertical-align: text-bottom; border-radius: 1px;
  background: var(--green);
  /* Below ~0.15 the bar is a smudge that reads as a rendering artefact, so
     it starts visible and ramps from there. Zero is handled separately: it
     shows nothing at all rather than a faint something. */
  opacity: calc(0.15 + 0.85 * var(--heat, 0));
}
.heat-cell[data-heat='0'] .heat-bar { background: var(--line); opacity: .5; }
.heat-when {
  display: inline-block; min-width: 5ch; margin-left: .8ch;
  font-size: 11px; color: var(--dim);
  opacity: calc(0.35 + 0.65 * var(--heat, 0));
}

/* The live pulse. Only ever on rows changed within the last minute, and only
   twice — a permanently animating list is a list nobody can read, and the
   signal here is "this just moved", which is over in two seconds. */
@keyframes deck-heat-pulse {
  from { box-shadow: 0 0 0 0 var(--green); opacity: 1; }
  to   { box-shadow: 0 0 0 4px transparent; opacity: calc(0.15 + 0.85 * var(--heat, 0)); }
}
.heat-cell[data-fresh='1'] .heat-bar {
  animation: deck-heat-pulse 1s ease-out 2;
}
@media (prefers-reduced-motion: reduce) {
  .heat-cell[data-fresh='1'] .heat-bar { animation: none; }
}
`;

export function installHeatStyles(doc = document) {
  if (doc.querySelector('style[data-deck-heat]')) return;
  let style = doc.createElement('style');
  style.dataset.deckHeat = 'v1';
  style.textContent = HEAT_CSS;
  doc.head.append(style);
}
