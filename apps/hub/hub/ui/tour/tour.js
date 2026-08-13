// ui/tour — Hub protocol stories (driver.js highlight + bottom-bar caption).
//
// Implements docs/deck-hub-tour.md. The exhibit stays visible: driver.js
// cuts a stage and paints a theme-coloured ring. The story lives on
// <deck-keys>. Next / Prev / Exit are the bar (and ← → esc).
//
// Beats may `prepare` a real interaction: list-browse, open volatility,
// scrub Timeline, scroll a feed, expand a review fold — show, don't narrate.
import { driver } from 'driver.js';

const STORAGE = 'deck.hub.tour';
const TOUR_PARAM = 'tour';

/** @typedef {'none' | 'list-browse' | 'dropdown' | 'scroll' | 'scrub'} Interaction */
/** @typedef {'open-vol' | 'expand-review' | 'scroll-feed' | 'list-browse' | 'scrub-timeline'} Prepare */

/** @typedef {{
 *   chapter: number,
 *   title: string,
 *   page: string,
 *   element?: string,
 *   go: string,
 *   label: string,
 *   claim: string,
 *   interaction?: Interaction,
 *   prepare?: Prepare,
 * }} TourStep */

/** Four stories — one use case each. Live paths over brittle @pins. */
const CHAPTERS = [
  {
    title: 'Eight desks, one board',
    steps: /** @type {TourStep[]} */ ([
      {
        chapter: 1,
        title: 'Eight desks, one board',
        page: 'browse',
        element: 'main table tbody, main table, main',
        go: '/browse?at=/two-agents',
        label: 'catalog',
        claim:
          'Each row is a publisher’s desk — agent-a, charts, ui, app. The board is not a branch; it is this list, composed at load.',
        interaction: 'list-browse',
        prepare: 'list-browse',
      },
      {
        chapter: 1,
        title: 'Eight desks, one board',
        page: 'run',
        element: '[data-tour="stage"], [data-role="stage"], .stagewrap',
        go: '/run?at=/two-agents/app/board/index.html',
        label: 'board',
        claim:
          'Review the swarm by watching the board. Pins across those desks are the composition — no integration step, because there was never a disintegration.',
      },
      {
        chapter: 1,
        title: 'Eight desks, one board',
        page: 'run',
        element: '[data-tour="graph"], .runsplit-under',
        go: '/run?at=/two-agents/app/board/index.html',
        label: 'resolved map',
        claim:
          'The resolved map is the merge. Freeze one pin and you quarantine one agent; the rest keep moving.',
      },
      {
        chapter: 1,
        title: 'Eight desks, one board',
        page: 'track',
        element: '[data-tour="feed"], ul.feed, main',
        go: '/track?at=/two-agents',
        label: 'feed',
        claim:
          'Every agent save is already a row with an address. The assembled thing existed the whole time those rows were written.',
      },
    ]),
  },
  {
    title: 'Two currencies land in the same minute',
    steps: /** @type {TourStep[]} */ ([
      {
        chapter: 2,
        title: 'Two currencies land in the same minute',
        page: 'run',
        element: '[data-tour="stage"], [data-role="stage"], .stagewrap, main',
        go: '/run?at=/codelist/app/viewer/index.html',
        label: 'exchange board',
        claim:
          'A live exchange board, not a JSON table. When amendments land, rows appear and the count moves — a merge you can see from across the room.',
      },
      {
        chapter: 2,
        title: 'Two currencies land in the same minute',
        page: 'browse',
        element: '[data-tour="vol"], select[data-role="vol"], .vol',
        go: '/browse?at=/codelist/std/currencies@latest',
        label: 'version',
        claim:
          'Open the version control. @1.4.0 and @1.5.0 are immutable cuts; latest is a tag on a Version — never “whatever is on disk.”',
        interaction: 'dropdown',
        prepare: 'open-vol',
      },
      {
        chapter: 2,
        title: 'Two currencies land in the same minute',
        page: 'browse',
        element: 'deck-subject, [data-tour="facts"], main',
        go: '/browse?at=/codelist/std/currencies@1.5.0',
        label: 'frozen cut',
        claim:
          'Only the @segment moved. Same package path, frozen bytes forever. Consumers choose exposure per list.',
      },
      {
        chapter: 2,
        title: 'Two currencies land in the same minute',
        page: 'track',
        element: '[data-tour="feed"], ul.feed, main',
        go: '/track?at=/codelist',
        label: 'feed',
        claim:
          'Amendments show up as published rows when they seal. Publishing ceremony is not what forces every team to keep a patched copy.',
      },
    ]),
  },
  {
    title: 'Try it before you take it',
    steps: /** @type {TourStep[]} */ ([
      {
        chapter: 3,
        title: 'Try it before you take it',
        page: 'run',
        element: '[data-tour="stage"], [data-role="stage"], .stagewrap, main',
        go: '/run?at=/contribute-to-codelist/app/picker/index.html',
        label: 'picker',
        claim:
          'Ana and Kim each patched the list. Side-by-side boards — “Try this one” is ?with= for one request, not a checkout.',
      },
      {
        chapter: 3,
        title: 'Try it before you take it',
        page: 'run',
        element: '[data-tour="graph"], .runsplit-under, main',
        go: '/run?at=/contribute-to-codelist/app/picker/index.html&with=std/currencies=ana/currencies',
        label: 'trial map',
        claim:
          'Only the rebound specifier moves. Everything else stays on its pins. A proposal is already a runnable URL.',
      },
      {
        chapter: 3,
        title: 'Try it before you take it',
        page: 'browse',
        element: 'section.review, [data-role="fold"], main',
        go:
          '/browse?at=/contribute-to-codelist/ana/currencies@1.5.0-dev.1&vs=/contribute-to-codelist/std/currencies@1.4.0',
        label: 'fork diff',
        claim:
          'Publisher segment is the fork boundary. Expand the row: key-level truth, not a line conflict over two different additions.',
        interaction: 'list-browse',
        prepare: 'expand-review',
      },
    ]),
  },
  {
    title: 'The hour you abandoned is still an address',
    steps: /** @type {TourStep[]} */ ([
      {
        chapter: 4,
        title: 'The hour you abandoned is still an address',
        page: 'browse',
        element: '[data-tour="vol"], select[data-role="vol"], .vol',
        go: '/browse?at=/vale-sale/vale/sale',
        label: 'versions',
        claim:
          'A real page, auto-published as -dev.N on every save. Open the stack — the interesting states live between releases.',
        interaction: 'dropdown',
        prepare: 'open-vol',
      },
      {
        chapter: 4,
        title: 'The hour you abandoned is still an address',
        page: 'run',
        element: '[data-tour="stage"], [data-role="stage"], .stagewrap',
        go: '/run?at=/vale-sale/vale/sale/index.html',
        label: 'sale',
        claim:
          'Past is not a backup — it is a URL you can load in this frame. Watch the page; the tape is underneath.',
      },
      {
        chapter: 4,
        title: 'The hour you abandoned is still an address',
        page: 'run',
        element: '[data-role="timeline"], .tl',
        go: '/run?at=/vale-sale/vale/sale/index.html',
        label: 'timeline',
        claim:
          'Scrub back one seal. The iframe follows /_history/<id>/…. Going back is reading and running an address.',
        interaction: 'scrub',
        prepare: 'scrub-timeline',
      },
      {
        chapter: 4,
        title: 'The hour you abandoned is still an address',
        page: 'track',
        element: '[data-tour="feed"], ul.feed, main',
        go: '/track?at=/vale-sale',
        label: 'saved rows',
        claim:
          'Saved rows deep-link into browse. The hour you abandon is sealed too — in case you were wrong.',
        interaction: 'scroll',
        prepare: 'scroll-feed',
      },
    ]),
  },
];

const SCRIPT = CHAPTERS.flatMap((ch) => ch.steps);

function ensureCss() {
  if (document.querySelector('link[data-driver-css]')) return;
  let href;
  try {
    href = import.meta.resolve('driver.js/dist/driver.css');
  } catch {
    href = undefined;
  }
  if (!href) return;
  let link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.driverCss = '1';
  document.head.appendChild(link);
}

function ensureTourCss() {
  let existing = document.querySelector('style[data-deck-tour-css]');
  if (existing) {
    existing.textContent = TOUR_CSS;
    return;
  }
  let style = document.createElement('style');
  style.dataset.deckTourCss = '1';
  style.textContent = TOUR_CSS;
  document.head.appendChild(style);
}

function loadState() {
  try {
    let raw = sessionStorage.getItem(STORAGE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState(state) {
  if (!state || !state.active) {
    sessionStorage.removeItem(STORAGE);
    return;
  }
  sessionStorage.setItem(STORAGE, JSON.stringify(state));
}

function clearTourQuery() {
  let url = new URL(location.href);
  if (!url.searchParams.has(TOUR_PARAM)) return;
  url.searchParams.delete(TOUR_PARAM);
  history.replaceState(null, '', url);
}

function withTourParam(href) {
  let url = new URL(href, location.origin);
  url.searchParams.set(TOUR_PARAM, '1');
  return url.pathname + url.search + url.hash;
}

function currentApp() {
  return document.querySelector('deck-nav')?.getAttribute('app') ?? '';
}

function firstSelector(selector) {
  if (!selector) return undefined;
  for (let part of selector.split(',').map((s) => s.trim())) {
    if (document.querySelector(part)) return part;
  }
  return selector.split(',')[0]?.trim();
}

function chapterMeta(absoluteIndex) {
  let step = SCRIPT[absoluteIndex];
  if (!step) return null;
  let chapterSteps = CHAPTERS[step.chapter - 1].steps;
  let stepInChapter = chapterSteps.indexOf(step) + 1;
  return {
    chapter: step.title,
    chapterIndex: step.chapter,
    chapters: CHAPTERS.length,
    step: stepInChapter,
    steps: chapterSteps.length,
    label: step.label,
    claim: step.claim,
  };
}

function keysEl() {
  return document.querySelector('deck-keys');
}

function paintTourBar(absoluteIndex) {
  let meta = chapterMeta(absoluteIndex);
  let el = keysEl();
  if (!el || !meta) return;
  el.tour = {
    ...meta,
    onPrev: () => tourPrev(),
    onNext: () => tourNext(),
    onExit: () => abandonTour(),
  };
}

function clearTourBar() {
  let el = keysEl();
  if (el) el.tour = null;
}

let activeDriver = null;
let tearingDown = false;
let cursor = 0;

function destroyActive() {
  cleanupPrepare();
  if (!activeDriver) return;
  tearingDown = true;
  try {
    activeDriver.destroy();
  } finally {
    tearingDown = false;
    activeDriver = null;
  }
}

function finish() {
  saveState(null);
  clearTourQuery();
  clearTourBar();
  destroyActive();
}

function abandonTour() {
  finish();
}

function revealExhibit(selector) {
  if (!selector) return;
  let el = document.querySelector(selector);
  if (!el || typeof el.scrollIntoView !== 'function') return;
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

/** Undo transient UI the prepare helpers opened. */
function cleanupPrepare() {
  let sel = document.querySelector('select[data-role="vol"][data-tour-open="1"]');
  if (sel) {
    sel.size = 1;
    delete sel.dataset.tourOpen;
    sel.blur();
  }
  for (let row of document.querySelectorAll('tbody tr[data-tour-pick="1"]')) {
    delete row.dataset.tourPick;
    if (row.dataset.here === 'tour') delete row.dataset.here;
  }
}

/**
 * Exercise the interaction named on the step — dropdown open, feed scroll,
 * catalog row pick, review fold expand. Fail soft if the exhibit is thin.
 * @param {Prepare | undefined} kind
 */
function runPrepare(kind) {
  cleanupPrepare();
  if (!kind) return;
  if (kind === 'open-vol') {
    let sel = document.querySelector('select[data-role="vol"]');
    if (!sel) return;
    sel.focus();
    let n = Math.min(sel.options.length, 7);
    if (n > 1) {
      sel.size = n;
      sel.dataset.tourOpen = '1';
    }
    return;
  }
  if (kind === 'scroll-feed') {
    let feed =
      document.querySelector('ul.feed.attention') ||
      document.querySelector('[data-tour="feed"]') ||
      document.querySelector('ul.feed');
    if (!feed) return;
    let entries = [...feed.querySelectorAll('li.entry')];
    if (!entries.length) {
      feed.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    let target =
      entries[Math.min(entries.length - 1, Math.max(1, Math.floor(entries.length * 0.55)))];
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (kind === 'list-browse') {
    let rows = [...document.querySelectorAll('main table tbody tr')];
    if (!rows.length) return;
    let preferred =
      rows.find((row) => /agent-a|charts|ana\b|kim\b/i.test(row.textContent || '')) ||
      rows[Math.min(1, rows.length - 1)];
    preferred.dataset.tourPick = '1';
    preferred.dataset.here = preferred.dataset.here || 'tour';
    preferred.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (kind === 'expand-review') {
    let section = document.querySelector('section.review');
    let fold = section?.querySelector('[data-role="fold"]');
    if (!fold) return;
    if (section.dataset.open !== '1') {
      fold.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    section.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (kind === 'scrub-timeline') {
    let tape = document.querySelector('[data-role="timeline"]');
    if (!tape) return;
    tape.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Click ◀ once the stage has painted — same control as keyboard `[`.
    let back = tape.querySelector('[data-role="step-by"][data-by="-1"]');
    if (!back || back.disabled) return;
    setTimeout(() => {
      if (!document.contains(back) || back.disabled) return;
      back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, 480);
  }
}

/** True when the current URL already carries this step's destination query. */
function hrefMatchesStep(href) {
  let want = new URL(href, location.origin);
  let here = new URL(location.href);
  for (let key of want.searchParams.keys()) {
    if (key === TOUR_PARAM) continue;
    if ((here.searchParams.get(key) ?? '') !== (want.searchParams.get(key) ?? '')) {
      return false;
    }
  }
  // Also require that *extra* significant params on here match when want set them
  // (e.g. clearing `with=` when the next beat has no with).
  for (let key of ['at', 'vs', 'with', 'kind']) {
    let w = want.searchParams.get(key);
    let h = here.searchParams.get(key);
    if (w == null && h != null && key === 'with') return false;
    if (w != null && w !== h) return false;
  }
  return true;
}

function buildHighlight(absoluteIndex) {
  ensureCss();
  ensureTourCss();
  let step = SCRIPT[absoluteIndex];
  if (!step || step.page !== currentApp()) return null;
  let sel = firstSelector(step.element);
  revealExhibit(sel);
  // Prepare after a tick so layout/scroll settle under the cutout.
  requestAnimationFrame(() => runPrepare(step.prepare));
  return driver({
    popoverClass: 'deck-tour-popover',
    showProgress: false,
    allowClose: false,
    overlayOpacity: 0.48,
    overlayClickBehavior: () => {},
    stagePadding: 10,
    stageRadius: 2,
    smoothScroll: false,
    disableActiveInteraction: false,
    steps: [
      {
        element: sel,
        popover: {
          title: '',
          description: '',
          showButtons: [],
          side: 'over',
          align: 'center',
        },
      },
    ],
    onDestroyStarted: (_el, _step, { driver: d }) => {
      if (tearingDown) d.destroy();
    },
  });
}

function showStep(absoluteIndex) {
  if (absoluteIndex < 0 || absoluteIndex >= SCRIPT.length) {
    finish();
    location.href = '/start';
    return;
  }
  cursor = absoluteIndex;
  let step = SCRIPT[absoluteIndex];
  saveState({ active: true, index: absoluteIndex });
  paintTourBar(absoluteIndex);

  if (step.page !== currentApp() || !hrefMatchesStep(step.go)) {
    location.href = withTourParam(step.go);
    return;
  }
  destroyActive();
  activeDriver = buildHighlight(absoluteIndex);
  activeDriver?.drive(0);
}

function tourNext() {
  cleanupPrepare();
  let next = cursor + 1;
  if (next >= SCRIPT.length) {
    finish();
    location.href = '/start';
    return;
  }
  showStep(next);
}

function tourPrev() {
  if (cursor <= 0) return;
  cleanupPrepare();
  showStep(cursor - 1);
}

export function startHubTour() {
  saveState({ active: true, index: 0 });
  location.href = withTourParam(SCRIPT[0].go);
}

export function resumeHubTour(options = {}) {
  let params = new URLSearchParams(location.search);
  let wanted = params.has(TOUR_PARAM) || loadState()?.active;
  if (!wanted) return;

  let state = loadState();
  let index = state?.index ?? 0;
  while (index < SCRIPT.length && SCRIPT[index].page !== currentApp()) {
    index++;
  }
  if (index >= SCRIPT.length) {
    finish();
    return;
  }
  // Same app, wrong subject — snap to this step's URL (showStep navigates).
  saveState({ active: true, index });
  let waitMs = options.waitMs ?? 0;
  let attempt = () => {
    let step = SCRIPT[index];
    if (!hrefMatchesStep(step.go)) {
      location.href = withTourParam(step.go);
      return;
    }
    let sel = firstSelector(step.element);
    if (sel && !document.querySelector(sel) && (options.retries ?? 0) < 40) {
      setTimeout(
        () => resumeHubTour({ ...options, retries: (options.retries ?? 0) + 1 }),
        100,
      );
      return;
    }
    showStep(index);
  };
  if (waitMs) setTimeout(attempt, waitMs);
  else attempt();
}

export function mountTourButton(host) {
  let root = host ?? document;
  let btn = root.querySelector('[data-role="tour"]');
  if (!btn || btn.dataset.bound === '1') return;
  ensureTourCss();
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => startHubTour());
}

const TOUR_CSS = `
/* Caption lives on <deck-keys> — never cover the exhibit with a popover. */
.deck-tour-popover.driver-popover,
.driver-popover.deck-tour-popover {
  display: none !important;
}
.driver-overlay {
  pointer-events: none !important;
}
/* Dim the room enough that the cutout reads as a spotlight. */
body.driver-active .driver-overlay {
  opacity: 0.52 !important;
}

/* Theme-native ring — grammar colours, not driver.js blue. */
@keyframes deck-tour-glow {
  0%, 100% {
    box-shadow:
      0 0 0 2px var(--a-live, #f9e2af),
      0 0 0 7px color-mix(in oklab, var(--a-live, #f9e2af) 28%, transparent),
      0 0 28px color-mix(in oklab, var(--a-package, #89b4fa) 35%, transparent);
  }
  50% {
    box-shadow:
      0 0 0 2px var(--a-package, #89b4fa),
      0 0 0 10px color-mix(in oklab, var(--a-package, #89b4fa) 32%, transparent),
      0 0 36px color-mix(in oklab, var(--a-live, #f9e2af) 40%, transparent);
  }
}
.driver-active-element,
#driver-highlighted-element-stage {
  outline: none !important;
  border-radius: 2px;
  animation: deck-tour-glow 1.5s ease-in-out infinite;
}
/* Opened volatility list during the dropdown beat. */
select[data-role="vol"][data-tour-open="1"] {
  position: relative;
  z-index: 1000000005;
  background: var(--panel, #181825);
  box-shadow:
    0 0 0 2px var(--a-live, #f9e2af),
    0 12px 32px color-mix(in oklab, var(--bg, #000) 55%, transparent);
}
tbody tr[data-tour-pick="1"] {
  box-shadow: inset 3px 0 0 var(--a-live, #f9e2af) !important;
  background: var(--sel, #45475a) !important;
}

/* Room for the multi-line story bar while scrolling exhibits into view. */
body:has(.deck-keys[data-tour="1"]) {
  padding-bottom: 6.5rem;
}
`;
