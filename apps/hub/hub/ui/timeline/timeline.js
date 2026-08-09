// The Timeline — a horizontal scrubber over Steps.
//
// Vocabulary from docs/deck-step-version-vocabulary.md: a **Step** is one
// settled save on the depot's every-save tape, a **Version** is an immutable
// published tree, and the **Timeline** is the tape itself.
//
// WHY A SCRUBBER AND NOT A DROPDOWN. A dropdown of 138 change ids answers
// "which one" and refuses to answer the question people actually have, which
// is "how far back". Time is a dimension; it should be laid out as one. A row
// of notches shows density for free — you can see the burst where an agent
// worked for ten minutes, and the flat stretch where nothing happened — and
// stepping becomes one key rather than a search through a list.
//
// SCOPE IS THE INTERESTING PART, and it differs per lens by design:
//
//   browse   steps that touched THIS PATH        you are reading bytes
//   run      steps that touched ANYTHING IN THE  you are watching the
//            PAGE'S CLOSURE                      assembled thing
//
// A palette change is a step on the run timeline for a canvas page — it
// changes what renders — and is not a step on the browse timeline for
// canvas.js, because those bytes never moved. Same depot, same instant, two
// correct answers, and the difference is exactly what the two lenses mean.
//
// Which is why a notch says WHY it is there. If undo jumps and your own file
// did not change, that reads as a skipped beat unless the row names
// `ui/theme · palette.css` — something you depend on moved.

const esc = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

/** `just now` · `4m` · `2h` · `3d`. */
export function ago(when) {
  let then = typeof when === 'number' ? when : Date.parse(when ?? '');
  if (!Number.isFinite(then)) return '';
  let seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/** The paths a step touched, letters stripped. */
function touched(step) {
  return (step.filesSummary ?? []).map((line) =>
    line.replace(/^[A-Z]\s+/, '').trim(),
  );
}

/**
 * Steps relevant to a set of depot-relative prefixes, newest first.
 *
 * An empty set means the whole depot, which is the honest reading of "no
 * scope" and stays useful on its own: "what did this machine do in the last
 * hour" is a real question, just not the default for either lens.
 */
export function stepsFor(steps, prefixes) {
  let wanted = [...new Set(prefixes.filter(Boolean))];
  if (!wanted.length) return steps.map((step) => ({ ...step, why: [] }));
  return steps
    .map((step) => {
      let why = touched(step).filter((path) =>
        wanted.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
      );
      return { ...step, why };
    })
    .filter((step) => step.why.length > 0);
}

/**
 * Collapse a run of saves by one hand into one hop.
 *
 * Ten consecutive saves to run.js are ten Steps and usually one intention.
 * Undoing them one at a time is twelve keypresses to reverse one change,
 * which is not undo, it is scrubbing with extra steps. Consecutive steps
 * within `gapMs` are folded into a single notch that carries the OLDEST id —
 * the state before the burst began, which is what "undo that" means.
 */
export function foldBursts(steps, gapMs = 90_000) {
  let out = [];
  for (let step of steps) {
    let when = Date.parse(step.timestamp ?? '');
    let last = out.at(-1);
    let lastWhen = last ? Date.parse(last.timestamp ?? '') : undefined;
    // Newest first, so "within the gap" means the previous entry is NEWER.
    if (last && Number.isFinite(when) && Number.isFinite(lastWhen) &&
        lastWhen - when < gapMs) {
      last.folded = (last.folded ?? 1) + 1;
      // Keep the oldest id in the burst: stepping onto this notch should
      // land before the whole burst, not in the middle of it.
      last.changeId = step.changeId;
      last.timestamp = step.timestamp;
      last.why = [...new Set([...(last.why ?? []), ...(step.why ?? [])])];
      continue;
    }
    out.push({ ...step });
  }
  return out;
}

/**
 * The scrubber.
 *
 * Oldest on the left, live on the right, because that is which way time runs
 * and dragging left to go back needs no explanation. `live` is a notch like
 * any other and is the one selected by default — the head of the tape is a
 * position on it, not a separate mode.
 *
 * Notch width is uniform rather than proportional to elapsed time. Real
 * intervals are wildly uneven — forty saves in ten minutes, then nothing for
 * six hours — and a time-proportional axis spends all its pixels on the gap
 * and none on the work. This is an index, not a clock; the clock is printed
 * beside it.
 */
export function timelineHtml({ steps, current, label = 'timeline', busy }) {
  if (!steps.length) {
    return (
      `<div class="tl" data-role="timeline">` +
      `<span class="tl-label">${esc(label)}</span>` +
      `<span class="dim">no steps here yet</span></div>`
    );
  }
  // Oldest first for display; the array arrives newest-first.
  let ordered = [...steps].reverse();
  let index = ordered.findIndex((step) => step.changeId === current);
  let atLive = !current;
  let position = atLive ? ordered.length : index;
  let selected = atLive ? undefined : ordered[index];

  // A POPOVER, NOT A `title`.
  //
  // Scrubbing means moving across notches quickly, and a native tooltip
  // appears after a second of stillness — the one thing scrubbing never
  // does. It also cannot show more than a line, and what a reader wants at
  // each notch is several things at once: when, what moved, who was working,
  // and anything they said about it. That is a panel.
  //
  // The content is carried on the notch rather than looked up on hover, so
  // moving across fifty of them costs no requests and no reflow beyond
  // moving one element.
  let notches = ordered
    .map((step, place) => {
      let summary = JSON.stringify({
        when: step.timestamp ?? '',
        why: step.why ?? [],
        files: touched(step),
        folded: step.folded ?? 1,
        actor: step.author ?? '',
        note: step.note ?? '',
        claim: step.claim ?? '',
        id: step.changeId,
      });
      return (
        `<button class="tl-notch" data-role="step" data-step="${esc(step.changeId)}" ` +
        `data-here="${place === position ? 1 : 0}" ` +
        `data-folded="${step.folded ? 1 : 0}" ` +
        `data-summary="${esc(summary)}"></button>`
      );
    })
    .join('');

  return (
    `<div class="tl" data-role="timeline"${busy ? ' data-busy="1"' : ''}>` +
    `<span class="tl-label">${esc(label)}</span>` +
    `<button class="tl-jump" data-role="step-by" data-by="-10" title="back ten">◀◀</button>` +
    `<button class="tl-jump" data-role="step-by" data-by="-1" title="back one">◀</button>` +
    `<span class="tl-track">${notches}` +
    `<button class="tl-notch tl-live" data-role="step" data-step="" ` +
    `data-here="${atLive ? 1 : 0}" title="live — the working tree"></button>` +
    `</span>` +
    `<button class="tl-jump" data-role="step-by" data-by="1" title="forward one">▶</button>` +
    `<button class="tl-jump" data-role="step-by" data-by="10" title="forward ten">▶▶</button>` +
    `<span class="tl-read">` +
    (atLive
      ? `<b class="tl-now">live</b>`
      : `<b>step ${ordered.length - index}</b> of ${ordered.length} back · ` +
        `${esc(ago(selected?.timestamp))}` +
        (selected?.folded ? ` · ${selected.folded} saves` : '') +
        (selected?.why?.length
          ? ` · <span class="dim">${esc(selected.why.slice(0, 2).join(' · '))}</span>`
          : '')) +
    `</span>` +
    (atLive
      ? ''
      : `<button class="tl-back" data-role="step" data-step="">back to live</button>`) +
    `<span class="tl-timing" data-role="timing"></span>` +
    `<div class="tl-pop" data-role="tl-pop" hidden></div>` +
    `</div>`
  );
}

/**
 * Wire the popover. Call once per render; returns nothing.
 *
 * Pointer events on the track rather than per-notch listeners: fifty notches
 * is fifty listeners to attach and tear down on every render, and one
 * delegated handler cannot leak them.
 */
export function attachScrub(root) {
  let track = root.querySelector('.tl-track');
  let pop = root.querySelector('[data-role="tl-pop"]');
  if (!track || !pop) return;

  let show = (notch) => {
    let raw = notch?.dataset.summary;
    if (!raw) {
      pop.hidden = true;
      return;
    }
    let step = JSON.parse(raw);
    let files = step.files ?? [];
    pop.innerHTML =
      `<div class="tl-pop-head">` +
      `<b>${esc(ago(step.when))}</b>` +
      (step.folded > 1 ? ` <span class="dim">${step.folded} saves</span>` : '') +
      (step.actor ? ` <span class="tl-pop-actor">${esc(step.actor)}</span>` : '') +
      `</div>` +
      (step.claim
        ? `<div class="tl-pop-claim">claimed — ${esc(step.claim)}</div>`
        : '') +
      (step.note ? `<div class="tl-pop-note">${esc(step.note)}</div>` : '') +
      `<div class="tl-pop-files">` +
      files
        .slice(0, 6)
        .map((path) => `<div>${esc(path)}</div>`)
        .join('') +
      (files.length > 6
        ? `<div class="dim">+${files.length - 6} more</div>`
        : '') +
      `</div>` +
      `<div class="dim tl-pop-id">${esc(String(step.id).slice(0, 12))}</div>`;
    // Clamped to the track so a notch at either end does not push the panel
    // off screen — the ends are exactly where people scrub to.
    let box = track.getBoundingClientRect();
    let spot = notch.getBoundingClientRect();
    pop.hidden = false;
    let width = pop.offsetWidth;
    let left = spot.left - box.left + spot.width / 2 - width / 2;
    pop.style.left = `${Math.max(0, Math.min(box.width - width, left))}px`;
  };

  // One update per frame. `show()` reads offsetWidth to centre the panel,
  // which forces layout; doing that on every pointermove event during a drag
  // is a synchronous reflow per mouse sample and makes scrubbing feel like
  // the page has stopped responding — which, for those milliseconds, it has.
  let queued = false;
  let pending;
  let flush = () => {
    queued = false;
    show(pending);
  };
  track.addEventListener('pointermove', (event) => {
    // `elementFromPoint` rather than event.target, so holding the button
    // down and dragging keeps updating: during a drag the target stays
    // pinned to wherever the press started, which is precisely not what
    // scrubbing means.
    let notch = document.elementFromPoint(event.clientX, event.clientY);
    pending = notch?.closest?.('.tl-notch');
    if (queued) return;
    queued = true;
    requestAnimationFrame(flush);
  });
  track.addEventListener('pointerleave', () => {
    pop.hidden = true;
  });
}

/**
 * Where the previous / next notch is.
 *
 * `current` is a change id or '' for live. Walking off the new end returns ''
 * (live) rather than clamping to the newest step, because live is a real
 * position on this tape and the one people expect to come back to.
 */
export function stepBy(steps, current, delta) {
  let ordered = [...steps].reverse();
  let here = current ? ordered.findIndex((step) => step.changeId === current) : ordered.length;
  if (here < 0) here = ordered.length;
  let next = Math.max(0, Math.min(ordered.length, here + delta));
  return next >= ordered.length ? '' : ordered[next].changeId;
}

/**
 * HOW FAST WAS THAT — measured, not claimed.
 *
 * The reason scrubbing a timeline is pleasant rather than painful is that
 * every step address is immutable, so the whole closure is `immutable`-cached
 * after the first visit. That is a real property of the protocol and it is
 * invisible unless somebody prints it, so this prints it: wall clock for the
 * frame, how many modules it pulled, and how many bytes actually crossed the
 * wire. On a re-visited step the third number is zero, which is the whole
 * argument for content addressing in one line of chrome.
 *
 * Resource timings are only readable for a same-origin frame, so a demo
 * running at its own origin reports wall clock alone rather than guessing.
 */
export function measureFrame(frame, into) {
  if (!frame || !into) return;
  let started = performance.now();
  frame.addEventListener(
    'load',
    () => {
      let ms = Math.round(performance.now() - started);
      let detail = '';
      try {
        let entries = frame.contentWindow.performance.getEntriesByType('resource');
        let bytes = entries.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
        detail =
          ` · ${entries.length} module${entries.length === 1 ? '' : 's'} · ` +
          (bytes === 0
            ? `<b class="ok">0 KB over the wire</b>`
            : `${Math.round(bytes / 1024)} KB`);
      } catch {
        // Cross-origin frame: wall clock is all we are allowed to know, and
        // inventing the rest would be worse than a shorter true sentence.
      }
      into.innerHTML = `<b>${ms} ms</b>${detail}`;
    },
    { once: true },
  );
}

export const TIMELINE_CSS = `
.tl {
  display: flex; align-items: center; gap: 1ch;
  padding: calc(var(--row, 1.5) * .3em) 0;
  font-size: 12px;
}
.tl[data-busy] { opacity: .6; }
.tl-label { color: var(--dim); text-transform: lowercase; }
.tl-jump, .tl-back {
  font: inherit; cursor: pointer; background: none; color: var(--dim);
  border: 1px solid var(--line); border-radius: 0; padding: 0 .8ch;
}
.tl-jump:hover, .tl-back:hover { color: var(--bg); background: var(--a-package); }

/* The tape. Notches are uniform width and shrink to fit, so a hundred steps
   still lay out in one row rather than scrolling — the shape of the burst is
   the information, and it is lost the moment it needs a scrollbar. */
.tl-track {
  flex: 1; display: flex; align-items: stretch; justify-content: flex-end;
  gap: 1px; min-width: 12ch; height: 1.1em;
  border-bottom: 1px solid var(--line);
}
/* Capped, so twelve steps read as a tape rather than a bar chart. Without a
   maximum, a short timeline stretches each notch to 80px and the row stops
   looking like time at all. */
.tl-notch {
  flex: 1 1 0; min-width: 2px; max-width: 14px; padding: 0;
  background: var(--line); border: 0; border-radius: 0; cursor: pointer;
}
.tl-notch:hover { background: var(--a-package); }
/* A folded notch is several saves; it reads heavier so density is visible. */
.tl-notch[data-folded='1'] { background: var(--dim); }
.tl-notch[data-here='1'] { background: var(--a-publisher); }
.tl-live { flex: 0 0 1.6ch; background: var(--green); }
.tl-live[data-here='1'] { background: var(--green); box-shadow: inset 0 0 0 1px var(--fg); }

.tl-read { white-space: nowrap; color: var(--dim); }
.tl-now { color: var(--green); }
.tl-timing { white-space: nowrap; color: var(--dim); min-width: 12ch; }
.tl-timing .ok { color: var(--green); }

/* The scrub popover. Positioned against the track, above it, so it never
   covers the notches you are moving through. */
.tl { position: relative; }
.tl-pop {
  position: absolute; bottom: 100%; z-index: 6;
  min-width: 22ch; max-width: 44ch;
  padding: .4em 1ch; margin-bottom: .3em;
  background: var(--bg); border: 1px solid var(--a-publisher);
  pointer-events: none;
}
.tl-pop-head { margin-bottom: .2em; }
.tl-pop-actor { color: var(--a-publisher); }
.tl-pop-claim { color: var(--a-publisher); }
.tl-pop-note { color: var(--fg); margin: .2em 0; }
.tl-pop-files { color: var(--dim); }
.tl-pop-files div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-pop-id { margin-top: .2em; }
`;

export function installTimelineStyles(doc = document) {
  if (doc.querySelector('style[data-deck-timeline]')) return;
  let style = doc.createElement('style');
  style.dataset.deckTimeline = 'v1';
  style.textContent = TIMELINE_CSS;
  doc.head.append(style);
}
