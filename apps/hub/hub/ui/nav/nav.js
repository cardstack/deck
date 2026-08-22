// <deck-nav app="browse"> and <deck-keys> — the chrome every Hub app carries.
//
// Five apps, five documents, so moving between them is a link and a page
// load. There is no router here and there does not need to be one: the
// browser has always been able to do this part.
//
// This deck exists to prove a claim the Hub makes about itself. It is not
// bundled into the apps, copied between them, or served from a special path
// — it is an ordinary deck at an ordinary address, and the apps import it the
// way any deck imports any other. If that stopped working, the Hub's argument
// would be broken and the Hub would be visibly broken with it.
//
// The shape is borrowed from commitmono.com: the current section is inverse
// rather than underlined, and the keys that work are listed along the bottom
// where you can see them rather than discovered by accident.
//
// `1`…`5` still switch apps. They are not printed beside the names — a row of
// ordinals is noise once the five words are the five words — and the legend
// at the foot of every page carries them instead, which is where every other
// binding is documented anyway.

// FIVE APPS, BUT ONLY THREE OF THEM ARE ADDRESS LENSES.
//
// `start` is about the machine. The other three are three questions about one
// address: what is it, what does it do, what happened to it. That is not a
// naming observation, it is the whole interaction model — an address you have
// found in one of them is an address you want to ask the other two about, so
// it TRAVELS, and the tab strip is a lens selector rather than four doors.
//
// The mechanism is already there and was going unused: all three apps read
// `?at=`. Carrying it across a tab click costs one query string.
const LENSES = new Set(['browse', 'run', 'track']);

const ROUTES = [
  ['start', 'this machine now, and the docs'],
  ['browse', 'the depot at rest'],
  ['run', 'the assembled, executing thing'],
  ['track', 'what changed, and where'],
  ['review', 'proposed changes and merge'],
];

/** The focused address, or ''. The one piece of state the lenses share. */
export function focus() {
  return new URLSearchParams(location.search).get('at') ?? '';
}

/**
 * ZERO EventSources IN HUB CHROME. Live requests must release their socket.
 *
 * An SSE stream is a connection held open forever, and HTTP/1.1 allows six
 * per origin. The nav opens one for the live badge; heat wanted one; /track
 * wanted one. Three is half the budget gone before the page has fetched
 * anything — and /run frames another Hub page inside itself, which doubles
 * it. The symptom was not an error: the inner frame simply sat on `loading…`
 * for ever, because its requests were queued behind connections that never
 * close. Starvation does not throw.
 *
 * One stream per document fixed the iframe case but not five ordinary Hub
 * tabs: five permanent requests still leave one HTTP/1.1 slot for every
 * navigation, module and API response. The fifth tab can sit blank with no
 * error because its redirect is queued behind the live streams.
 *
 * Hub chrome therefore does not use EventSource. It polls a tiny moving
 * sequence at `/_live/state`; requests finish immediately and release their
 * connection. Running pages use the same moving snapshot for HMR, so neither
 * Hub chrome nor a stage holds a connection open.
 */
const liveListeners = new Set();
const liveStatusListeners = new Set();
const LIVE_POLL_MS = 1500;
let livePollTimer;
let livePolling = false;
let liveSequence;
let liveStatus = { state: '?', text: 'live' };

/**
 * A FRAMED PAGE IS A SUBJECT, NOT AN OBSERVER.
 *
 * /run frames Hub pages, because the Hub runs itself. But the
 * framed copy loaded the whole chrome too: its own SSE stream, its own
 * activity poll on every event, its own heat. Two documents on one origin,
 * each holding connections open, against HTTP/1.1's six — and the inner one
 * sits on `loading…` for ever while its requests queue behind streams that
 * never close. Starvation does not throw, so there is nothing in the console
 * to find.
 *
 * Nothing inside a frame needs to watch anything: it is being watched. The
 * parent's chrome already reports what changed, and a stage that reloads
 * itself would fight the person scrubbing it.
 */
const FRAMED = (() => {
  try {
    return window.top !== window.self;
  } catch {
    // Cross-origin parent — still framed, and the throw is the proof.
    return true;
  }
})();

/**
 * COALESCED, because the depot changes faster than a person can read.
 *
 * The watcher publishes one event per settled save, and an agent editing this
 * repo produces them several times a second in bursts. Every listener here
 * re-renders something, so an unthrottled feed means the page is rebuilt
 * under the reader continuously: scroll position gone, selection gone, an
 * expanded diff hunk gone, several times a second, for as long as the agent
 * is working.
 *
 * That is not a hang, but it is indistinguishable from one — the page does
 * not respond to you because it keeps becoming a different page. It was also
 * the hardest failure here to diagnose, because it only happens while
 * somebody is editing, which is never when you are testing.
 *
 * One update per second, on the trailing edge. Fast enough that "live" is
 * still true, slow enough that the page belongs to whoever is reading it.
 */
const LIVE_QUIET_MS = 1000;
let liveTimer;
let liveLatest;

function deliverLive(data) {
  liveLatest = { data };
  if (liveTimer) return;
  liveTimer = setTimeout(() => {
    liveTimer = undefined;
    for (let each of liveListeners) each(liveLatest);
  }, LIVE_QUIET_MS);
}

function deliverLiveStatus(status) {
  if (liveStatus.state === status.state && liveStatus.text === status.text) return;
  liveStatus = status;
  for (let each of liveStatusListeners) each(status);
}

async function pollLive() {
  if (!livePolling || FRAMED) return;
  try {
    let response = await fetch('/_live/state', { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    let snapshot = (await response.json()).data;
    deliverLiveStatus({ state: 'on', text: 'live' });
    // The first answer establishes position. Replaying the last event on
    // every navigation would make a quiet page redraw for old work.
    if (
      liveSequence !== undefined &&
      snapshot.sequence > liveSequence &&
      snapshot.event
    ) {
      deliverLive(JSON.stringify(snapshot.event));
      // Reload the Hub's own module edits from their no-store addresses.
      // Repository/fork events are data, so subscribers repaint them in place.
      if (/^(app|ui|theme)\//.test(snapshot.event.name)) {
        setTimeout(() => location.reload(), 80);
        return;
      }
    }
    liveSequence = snapshot.sequence;
  } catch {
    deliverLiveStatus({ state: 'off', text: 'live: disconnected' });
  }
  if (livePolling) livePollTimer = setTimeout(pollLive, LIVE_POLL_MS);
}

function startLivePolling() {
  if (livePolling || FRAMED) return;
  livePolling = true;
  pollLive();
}

addEventListener('pagehide', () => {
  livePolling = false;
  clearTimeout(livePollTimer);
});

// A document restored from the back-forward cache keeps its subscribers but
// pagehide stopped its timer. Rejoin without subscribing every feature twice.
addEventListener('pageshow', () => {
  if (!livePolling && (liveListeners.size || liveStatusListeners.size)) {
    startLivePolling();
  }
});

export function onLiveChange(listener) {
  if (FRAMED) return () => {};
  liveListeners.add(listener);
  startLivePolling();
  return () => liveListeners.delete(listener);
}

function onLiveStatus(listener) {
  if (FRAMED) return () => {};
  liveStatusListeners.add(listener);
  listener(liveStatus);
  startLivePolling();
  return () => liveStatusListeners.delete(listener);
}

/**
 * Where a lens tab points.
 *
 * With a focus, at that focus. Without one, at the lens's own index. And the
 * ACTIVE tab with a focus points at its own index — clicking the tab you are
 * already on drops the subject and takes you back up.
 *
 * That last rule is the iOS tab bar's, and it is here because it is the one
 * "click it again" convention people already have: tapping the selected tab
 * pops to root. It gives the strip a second job without a second control,
 * and it means the same click always means "show me this lens, plainly".
 */
function lensHref(route, current, at) {
  if (!LENSES.has(route)) return `/${route}`;
  if (!at) return `/${route}`;
  return route === current ? `/${route}` : `/${route}?at=${encodeURIComponent(at)}`;
}

const esc = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

/**
 * Themes are DECKS.
 *
 * `/hub/theme/<name>/palette.css` is an ordinary address holding nothing but
 * custom properties, and switching theme is swapping which one is linked. So
 * a theme can be written, sealed, versioned, endorsed and forked like
 * anything else here, and adding one needs no change to this file beyond a
 * line in the list.
 *
 * CSS custom properties rather than a JSON token file, because JSON
 * needs a program to turn it into styling, and custom properties already ARE
 * styling — cascade, media queries, per-element overrides and all — with
 * nothing in between to ship or to go wrong.
 */
const THEMES = [
  ['mocha', 'mocha'],
  ['latte', 'latte'],
  ['tokyo-night-light', 'tokyo night light'],
];
const THEME_KEY = 'deck.theme';

/**
 * The stored choice, or mocha.
 *
 * Mocha is the Hub default — dark shell, Catppuccin. Latte and Tokyo Night
 * stay available from the theme picker. A stored choice always wins; this
 * only decides what somebody sees before they have had an opinion.
 */
function theme() {
  let stored = localStorage.getItem(THEME_KEY);
  if (stored && THEMES.some(([name]) => name === stored)) return stored;
  return 'mocha';
}

export function applyTheme(name = theme()) {
  localStorage.setItem(THEME_KEY, name);
  let link = document.querySelector('link[data-role="palette"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.role = 'palette';
    document.head.append(link);
  }
  let href = `/hub/theme/${name}/palette.css`;
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  let select = document.querySelector('[data-role="theme"]');
  if (select && select.value !== name) select.value = name;
}

// At import time, before the app renders, so no page flashes an unstyled
// palette while its module graph loads.
applyTheme();

/**
 * THE URL CHANGES WITHOUT THE PAGE CHANGING, AND THE CHROME HAS TO HEAR IT.
 *
 * All three apps navigate with `history.pushState` — they are single
 * documents that re-render, which is the right shape for them. But pushState
 * fires no event. `popstate` only covers going BACK.
 *
 * So the nav read the focus once, at connect, and then kept it for ever.
 * Browse ten directories deep, click `run`, and you were sent to whatever you
 * had been looking at when the page first loaded. The tab strip is supposed
 * to be the thing that carries your place; instead it pinned it. That is
 * navigation that looks stuck, because it is.
 *
 * Wrapping the two methods once, here, is the smallest fix that cannot be
 * forgotten by the next app: every state change now announces itself, and
 * anything that renders from the URL listens.
 */
for (let method of ['pushState', 'replaceState']) {
  let original = history[method];
  history[method] = function patched(...args) {
    let result = original.apply(this, args);
    dispatchEvent(new Event('deck:navigate'));
    return result;
  };
}
addEventListener('popstate', () => dispatchEvent(new Event('deck:navigate')));

export class DeckNav extends HTMLElement {
  connectedCallback() {
    this.render();
    // Re-point the lens tabs at wherever the app has since navigated to.
    // Only the hrefs and titles change, so this is cheap and does not touch
    // the theme picker or tear down the live badge's listener.
    addEventListener('deck:navigate', () => this.#retarget());
  }

  #retarget() {
    let current = this.getAttribute('app') ?? '';
    let at = focus();
    for (let [route] of ROUTES) {
      let link = this.querySelector(`[data-route="${route}"]`);
      if (!link) continue;
      link.setAttribute('href', lensHref(route, current, at));
      if (route === current) link.dataset.inert = at ? '0' : '1';
    }
    this.querySelector('.deck-nav')?.toggleAttribute('data-focused', Boolean(at));
  }

  render() {
    let current = this.getAttribute('app') ?? '';
    let at = focus();
    this.innerHTML =
      `<nav class="deck-nav"${at ? ' data-focused="1"' : ''}>` +
      // The mark is the home button. `/` redirects to whichever app is the
      // front door, so this is one link that never needs updating when the
      // front door moves.
      `<a class="deck-nav-mark" href="/" title="Deck Hub — home">DECK</a>` +
      ROUTES.map(([route, title]) => {
        let href = lensHref(route, current, at);
        if (route === current) {
          // The active tab is still a link, because with a focus it does
          // something: it drops it. Without one it is inert and says so by
          // not offering a pointer.
          return (
            `<a class="deck-nav-here" aria-current="page" data-route="${esc(route)}" ` +
            `href="${esc(href)}" data-inert="${at ? '0' : '1'}" ` +
            `title="${at ? 'clear the subject and show all of ' + route : esc(title)}"` +
            `>${esc(route)}</a>`
          );
        }
        return (
          `<a data-route="${esc(route)}" href="${esc(href)}" ` +
          `title="${esc(title)}">${esc(route)}</a>`
        );
      }).join('') +
      `<span class="deck-nav-gap"></span>` +
      `<select class="deck-nav-theme" data-role="theme" title="theme">` +
      THEMES.map(
        ([name, label]) =>
          `<option value="${esc(name)}"${name === theme() ? ' selected' : ''}>` +
          `${esc(label)}</option>`,
      ).join('') +
      `</select>` +
      `<span class="deck-nav-live" data-live="?">live</span>` +
      // Presence rides beside the live badge because it is the same kind of
      // fact: not what the depot HOLDS, but what is happening to it now.
      `<button class="deck-nav-claims" data-role="claims" hidden></button>` +
      `<div class="deck-claims" data-role="claim-list" hidden></div>` +
      `</nav>`;
    this.querySelector('[data-role="theme"]').addEventListener('change', (event) => {
      applyTheme(event.target.value);
    });
    this.#watchLive();
    this.#watchClaims();
    this.#numberKeys();
    this.querySelector('[data-role="claims"]').addEventListener('click', () => {
      let list = this.querySelector('[data-role="claim-list"]');
      list.hidden = !list.hidden;
    });
    this.querySelector('[data-role="claim-list"]').addEventListener('click', (event) => {
      let release = event.target.closest('[data-role="release-claim"]');
      if (!release) return;
      event.preventDefault();
      event.stopPropagation();
      let actor = release.dataset.actor;
      if (!actor) return;
      release.disabled = true;
      fetch('/_hub/release-claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor }),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`release ${response.status}`);
          return this.#paintClaims?.();
        })
        .catch(() => {
          release.disabled = false;
        });
    });
  }

  /**
   * WHO IS WORKING, AND WHERE — the other half of live.
   *
   * The badge says the depot changed. This says somebody has DECLARED they
   * are about to change something, which is the more useful of the two and
   * the one nothing was showing: a claim with no edits yet is work that has
   * not happened, and it is the only warning anyone gets.
   *
   * Deliberately not a toast that disappears. A claim lasts half an hour and
   * a notification that vanishes in four seconds cannot represent it — you
   * would have to be looking at the moment it arrived. It is a standing
   * count you can open.
   */
  async #watchClaims() {
    let button = this.querySelector('[data-role="claims"]');
    let list = this.querySelector('[data-role="claim-list"]');
    if (FRAMED) return;
    // NEVER TWO AT ONCE.
    //
    // This is driven by the change bus, and while an agent is editing, the bus
    // fires about once a second. `/_activity` walks every depot and takes
    // longer than that under load, so each paint started before the last one
    // came back — and a browser holds only six connections per origin. Five
    // stacked polls plus the SSE stream is the whole budget, and every OTHER
    // request the page wants sits in a queue that never drains. The page looks
    // hung; the server is idle; nothing anywhere throws.
    //
    // A skipped paint costs nothing: the next event repaints, and the one
    // in flight is already fetching the state we would have asked for.
    let painting = false;
    let paint = async () => {
      if (painting) return;
      painting = true;
      let claims = await fetch('/_activity?top=200&grain=package')
        .then((response) => (response.ok ? response.json() : { foci: [] }))
        .then((body) =>
          (body.foci ?? []).flatMap((focus) =>
            (focus.claims ?? []).map((claim) => ({ ...claim, at: focus.id })),
          ),
        )
        .catch(() => [])
        .finally(() => {
          painting = false;
        });
      button.hidden = claims.length === 0;
      if (!claims.length) {
        list.hidden = true;
        return;
      }
      // "1 claim" is the protocol's word wearing a badge. Nobody reading a
      // status bar wants a noun for the record — they want to know somebody is
      // in there right now, which is what "1 active" says. The wire keeps
      // `claims`; the chrome says what it means.
      button.textContent = `${claims.length} active`;
      list.innerHTML = claims
        .map((claim) => {
          let left = Math.max(0, Math.round((claim.until - Date.now()) / 60000));
          return (
            `<div class="deck-claim">` +
            `<b>${esc(claim.actor)}</b> ` +
            `<a href="/browse?at=${esc(claim.at)}">${esc(claim.at)}</a> ` +
            `<span class="dim">${left}m left</span> ` +
            `<button type="button" class="deck-claim-release" ` +
            `data-role="release-claim" data-actor="${esc(claim.actor)}">` +
            `Release</button>` +
            (claim.text ? `<div class="dim">${esc(claim.text)}</div>` : '') +
            `<div class="dim">stops the agent — same as deleting ` +
            `<code>.deck/claims/${esc(claim.actor)}.json</code></div>` +
            `</div>`
          );
        })
        .join('');
    };
    this.#paintClaims = paint;
    await paint();
    onLiveChange(() => paint());
    // Claims expire on a clock nothing announces, so the countdown has to be
    // redrawn rather than waiting for a change that may never come.
    setInterval(paint, 30_000);
  }

  // `1`…`4` go to a section, the way the numbers in the nav imply. Ignored
  // while a field has focus, or the filter box would be unusable.
  //
  // Activate the real tab link (do not assign location.href): cross-document
  // View Transitions only run for user-activated navigations, and a synthetic
  // click on an <a> keeps that activation. Scripted location changes flash.
  #numberKeys() {
    addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      let tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      let index = Number(event.key) - 1;
      let route = ROUTES[index]?.[0];
      if (route && route !== this.getAttribute('app')) {
        let link = this.querySelector(`a[data-route="${route}"]`);
        if (link) link.click();
        else location.href = `/${route}`;
      }
    });
  }

  // The SSE indicator has one job and it is the unglamorous one: be
  // unambiguous when the connection is NOT there. A live badge that looks the
  // same whether or not it is receiving is worse than no badge, because it
  // makes a broken watcher look like a quiet depot.
  #watchLive() {
    let badge = this.querySelector('.deck-nav-live');
    let set = (state, text) => {
      badge.dataset.live = state;
      badge.textContent = text;
    };
    if (FRAMED) {
      set('on', 'framed');
      return;
    }
    onLiveChange((event) => {
      let name = '';
      try {
        name = JSON.parse(event.data).name ?? '';
      } catch {
        // A malformed event is still an event: something changed.
      }
      set('on', name ? `changed: ${name}` : 'changed');
      clearTimeout(this.#settle);
      this.#settle = setTimeout(() => set('on', 'live'), 4000);
    });
    onLiveStatus(({ state, text }) => set(state, text));
  }

  #settle;
  #paintClaims;
}

/**
 * <deck-subject> — what all three lenses are pointed at.
 *
 * This replaces the `deck browse ❯ ~/…` prompt each app used to print, and it
 * replaces it for two reasons.
 *
 * The prompt repeated the tab name back at you, and it opened with `~`, which
 * meant "clear the subject" to nobody who had not been told. Worse, it was
 * three separate prompt lines that happened to look alike, so nothing on
 * screen said the subject was SHARED — switching tabs looked like leaving.
 *
 * One bar, drawn once, sitting directly under the strip and joined to the
 * active tab, is the whole affordance: the bar does not move or change when
 * you switch lenses, only the content below it does. You watch the subject
 * stay put, and that is the lesson.
 *
 * The app supplies the trail, because only /browse knows that a segment is a
 * publisher rather than a package and colours it accordingly. Everything else
 * here — the clearing, the keys, the joinery — is the same in all three.
 */
export class DeckSubject extends HTMLElement {
  #trail = '';
  #fact = '';

  /** HTML for the address itself. The app owns this; the frame does not. */
  set trail(value) {
    this.#trail = value ?? '';
    this.render();
  }

  /** One short fact appropriate to the current lens, or ''. */
  set fact(value) {
    this.#fact = value ?? '';
    this.render();
  }

  connectedCallback() {
    this.render();
    // The app sets `.trail` as part of its own render, but it does not set
    // one when it has nothing focused — so the bar has to notice the focus
    // going away by itself, or it keeps displaying the address you just left.
    addEventListener('deck:navigate', () => {
      if (!focus()) {
        this.#trail = '';
        this.#fact = '';
      }
      this.render();
    });
    addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !focus()) return;
      let tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      this.clear();
    });
    this.addEventListener('click', (event) => {
      if (!event.target.closest('[data-role="clear-subject"]')) return;
      event.preventDefault();
      this.clear();
    });
  }

  /**
   * Drop the subject, stay in this lens.
   *
   * A full navigation rather than a pushState: each app reads `?at=` at the
   * top of its own render, and going through the URL means the three apps
   * need no shared clearing protocol between them.
   */
  clear() {
    // Same as number-keys: prefer a real navigation so View Transitions run.
    let here = document.querySelector('deck-nav a[aria-current="page"]');
    if (here && here.getAttribute('data-inert') === '0') {
      here.click();
      return;
    }
    location.href = location.pathname;
  }

  render() {
    let at = focus();
    if (!at) {
      this.innerHTML = '';
      return;
    }
    this.innerHTML =
      `<div class="deck-subject">` +
      `<span class="deck-subject-trail">${this.#trail || esc(at)}</span>` +
      (this.#fact ? `<span class="deck-subject-fact">${this.#fact}</span>` : '') +
      `<span class="deck-nav-gap"></span>` +
      `<button class="deck-subject-clear" data-role="clear-subject" ` +
      `title="clear the subject (esc)"><kbd>esc</kbd> clear</button>` +
      `</div>`;
  }
}

/**
 * <deck-keys> — the pinned legend.
 *
 * Set `.keys` to an array of `[keys, label]`, where `keys` is one or more
 * key names. Every shortcut the page implements appears here, always, and
 * nothing appears here that the page does not implement. A legend that drifts
 * from the bindings is worse than no legend.
 *
 * While a Hub tour is running, `.tour` replaces the legend with chapter
 * chrome (Prev / Next / Exit) plus a one-line protocol claim. The bar lights
 * an accent; claims stay here so the exhibit is never covered by a popover.
 */
export class DeckKeys extends HTMLElement {
  #keys = [];
  #shown = localStorage.getItem('deck.keys') !== 'hidden';
  #tour = null;

  set keys(value) {
    this.#keys = value;
    this.render();
  }

  get keys() {
    return this.#keys;
  }

  /** @param {null | {
   *   chapter: string,
   *   chapterIndex: number,
   *   chapters: number,
   *   step: number,
   *   steps: number,
   *   label?: string,
   *   claim?: string,
   *   onPrev?: () => void,
   *   onNext?: () => void,
   *   onExit?: () => void,
   * }} value */
  set tour(value) {
    this.#tour = value;
    this.render();
  }

  get tour() {
    return this.#tour;
  }

  connectedCallback() {
    this.render();
    // `h` hides and shows, and the choice sticks. Someone who has learned
    // the keys should not have to keep dismissing the reminder, and someone
    // who has not should not have to know it exists to find it — so when it
    // is hidden a single `?` remains, which is a smaller promise than a full
    // bar and still an obvious one. Tour mode always shows; `h` is ignored.
    addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      let tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (this.#tour) {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.#tour.onExit?.();
          return;
        }
        if (event.key === 'ArrowRight' || event.key === 'Enter') {
          event.preventDefault();
          this.#tour.onNext?.();
          return;
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          this.#tour.onPrev?.();
          return;
        }
        return;
      }
      if (event.key !== 'h' && event.key !== '?') return;
      this.toggle();
    });
    this.addEventListener('click', (event) => {
      if (event.target.closest('[data-role="keys-toggle"]')) this.toggle();
      if (!this.#tour) return;
      if (event.target.closest('[data-role="tour-prev"]')) this.#tour.onPrev?.();
      if (event.target.closest('[data-role="tour-next"]')) this.#tour.onNext?.();
      if (event.target.closest('[data-role="tour-exit"]')) this.#tour.onExit?.();
    });
  }

  toggle(next = !this.#shown) {
    if (this.#tour) return;
    this.#shown = next;
    localStorage.setItem('deck.keys', next ? 'shown' : 'hidden');
    this.render();
  }

  render() {
    if (this.#tour) {
      let t = this.#tour;
      this.innerHTML =
        `<div class="deck-keys" data-tour="1">` +
        `<div class="deck-tour-row">` +
        `<button type="button" class="deck-keys-item" data-role="tour-prev" ` +
        `${t.step <= 1 && t.chapterIndex <= 1 ? ' disabled' : ''}>` +
        `<kbd>←</kbd><em>prev</em></button>` +
        `<button type="button" class="deck-keys-item" data-role="tour-next">` +
        `<kbd>→</kbd><em>next</em></button>` +
        `<span class="deck-keys-item deck-tour-chapter">` +
        `<em>ch ${t.chapterIndex}/${t.chapters}</em> ` +
        `<b>${esc(t.chapter)}</b></span>` +
        `<span class="deck-keys-item"><em>${t.step}/${t.steps}</em></span>` +
        `<span class="deck-nav-gap"></span>` +
        `<button type="button" class="deck-keys-item" data-role="tour-exit">` +
        `<kbd>esc</kbd><em>exit</em></button>` +
        `</div>` +
        (t.claim
          ? `<div class="deck-tour-claim">` +
            (t.label
              ? `<span class="deck-tour-label">${esc(t.label)}</span>`
              : '') +
            `<b>${esc(t.claim)}</b></div>`
          : '') +
        `</div>`;
      return;
    }
    if (!this.#shown) {
      this.innerHTML =
        `<div class="deck-keys" data-collapsed="1">` +
        `<button class="deck-keys-peek" data-role="keys-toggle" ` +
        `title="show keyboard shortcuts"><kbd>h</kbd><em>keys</em></button></div>`;
      return;
    }
    this.innerHTML =
      `<div class="deck-keys">` +
      this.#keys
        .map(
          ([keys, labelText]) =>
            `<span class="deck-keys-item">` +
            [].concat(keys).map((key) => `<kbd>${esc(key)}</kbd>`).join('') +
            `<em>${esc(labelText)}</em></span>`,
        )
        .join('') +
      `<span class="deck-nav-gap"></span>` +
      `<button class="deck-keys-item" data-role="keys-toggle">` +
      `<kbd>h</kbd><em>hide</em></button>` +
      `</div>`;
  }
}

for (let [name, ctor] of [
  ['deck-nav', DeckNav],
  ['deck-subject', DeckSubject],
  ['deck-keys', DeckKeys],
]) {
  if (!customElements.get(name)) {
    customElements.define(name, ctor);
  }
}

// Shipped with the components rather than duplicated into four apps.
//
// The colours are inherited, never declared: the host page owns the palette,
// so this looks right in whatever scheme it lands in and cannot drift from
// the page around it.
export const NAV_CSS = `
.deck-nav {
  display: flex; align-items: baseline; gap: 0;
  padding: calc(var(--row, 1.5) * .5em) 0;
  font-family: inherit; font-size: 13px;
}
.deck-nav a, .deck-nav-here { padding: 0 1ch; margin-right: 1ch; }
.deck-nav a { color: var(--dim); text-decoration: none; }
.deck-nav a:hover { color: var(--fg); background: var(--sel); }
/* THE WORDMARK IS FIXED. IT IS NOT PART OF THE PALETTE.
   ═════════════════════════════════════════════════════
   This took --a-depot, the cyan that means "depot segment" in an address.
   Two things were wrong with that. The mark is not a depot, so it borrowed a
   colour that already means something else and diluted it; and --a-depot is
   whatever each theme says cyan is, which in Tokyo Night is close enough to
   green to read as a status, not a name.

   So the mark is now specified and does not move:

     face        Commit Mono, the vendored typeface at /hub/type
     case        upper
     weight      700
     tracking    .22em — caps set tight read as one blob; four letters can
                 afford the air, and the extra space is what makes a
                 four-letter word read as a mark rather than as a heading
     colour      the foreground. Full strength, no hue.

   A wordmark in the text colour is the strongest thing on the row without
   claiming to be a status. Hover inverts it, which is the same gesture the
   current tab uses — one convention, two places. */
.deck-nav-mark {
  font-weight: 700; letter-spacing: .22em; margin-right: 2.5ch;
  color: var(--fg) !important; padding-left: 0 !important;
  font-feature-settings: 'ss01' off;
}
.deck-nav-mark:hover {
  background: var(--fg) !important; color: var(--bg) !important;
  text-decoration: none;
}
.deck-nav-here {
  background: var(--a-package); color: var(--bg) !important; font-weight: 600;
}
/* With a subject, the active tab is a control: clicking it drops the subject.
   Without one it is just a label, so it stops offering a pointer — the same
   pixel must not look clickable when it is not. */
.deck-nav-here[data-inert='1'] { cursor: default; }
.deck-nav-here[data-inert='0']:hover {
  background: var(--amber);
}
.deck-nav-gap { flex: 1; }

/* ── The subject bar ───────────────────────────────────────────────────
   Joined to the strip above it, and unchanged when you switch lenses. The
   not-moving is the message: the tabs are three views of THIS, not three
   places to go. */
.deck-subject {
  display: flex; align-items: baseline; gap: 1.5ch;
  padding: calc(var(--row, 1.5) * .35em) 1ch;
  border-top: 1px solid var(--a-package);
  background: var(--sel);
  font-size: 13px;
}
.deck-subject-trail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.deck-subject-trail a { text-decoration: none; }
.deck-subject-trail a:hover { text-decoration: underline; }
.deck-subject-fact { color: var(--dim); white-space: nowrap; }
.deck-subject-clear {
  font: inherit; cursor: pointer; background: none; border: 0;
  color: var(--dim); padding: 0; white-space: nowrap;
}
.deck-subject-clear:hover { color: var(--fg); }
.deck-nav-live { color: var(--dim); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; max-width: 40ch; }
.deck-nav-live::before { content: '● '; }
.deck-nav-live[data-live='on']::before { color: var(--green); }
.deck-nav-live[data-live='off']::before { color: var(--red); }
.deck-nav-live[data-live='?']::before { color: var(--dim); }

.deck-nav-claims {
  font: inherit; cursor: pointer; margin-left: 2ch; padding: 0 1ch;
  background: none; border: 1px solid var(--a-publisher);
  color: var(--a-publisher); border-radius: 0;
}
.deck-nav-claims:hover { background: var(--a-publisher); color: var(--bg); }
.deck-claims {
  position: absolute; right: var(--gut, 2ch); top: 2.4em; z-index: 5;
  max-width: 46ch; padding: .4em 1ch;
  background: var(--bg); border: 1px solid var(--a-publisher);
  font-size: 12px;
}
.deck-claim + .deck-claim { margin-top: .6em; border-top: 1px solid var(--line); padding-top: .6em; }
.deck-claim a { color: var(--fg); }
.deck-claim-release {
  font: inherit; cursor: pointer; margin-left: .5ch; padding: 0 .6ch;
  background: none; border: 1px solid var(--a-publisher);
  color: var(--a-publisher);
}
.deck-claim-release:hover { background: var(--a-publisher); color: var(--bg); }
.deck-claim-release:disabled { opacity: .5; cursor: wait; }

.deck-keys {
  position: fixed; left: 0; right: 0; bottom: 0;
  display: flex; flex-wrap: wrap; gap: .2em 2.5ch;
  padding: calc(var(--row, 1.5) * .5em) var(--gut, 2ch);
  background: var(--bg); border-top: 1px solid var(--line);
  font-size: 12px;
  z-index: 40;
}
.deck-keys[data-collapsed] { border-top-color: transparent; background: none; }
.deck-keys[data-tour="1"] {
  flex-direction: column;
  align-items: stretch;
  gap: .45em;
  z-index: 1000000010; /* above driver.js overlay so the claim stays readable */
  border-top: 2px solid var(--a-live, #df8e1d);
  background: color-mix(in srgb, var(--a-live, #df8e1d) 14%, var(--bg));
  box-shadow: 0 -8px 24px color-mix(in srgb, var(--a-live, #df8e1d) 18%, transparent);
}
.deck-keys[data-tour="1"] .deck-tour-row {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: .2em 2.5ch;
}
.deck-keys[data-tour="1"] .deck-tour-chapter b {
  color: var(--a-live, #df8e1d);
  font-weight: 700;
  letter-spacing: .04em;
}
.deck-keys[data-tour="1"] .deck-tour-claim {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: .35em 1.2ch;
  font-size: 13.5px;
  line-height: 1.4;
  max-width: 96ch;
}
.deck-keys[data-tour="1"] .deck-tour-label {
  flex: 0 0 auto;
  font-family: var(--mono, monospace);
  font-size: 11px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--a-live, #df8e1d);
  opacity: .9;
}
.deck-keys[data-tour="1"] .deck-tour-claim b {
  flex: 1 1 36ch;
  min-width: 0;
  font-weight: 500;
  letter-spacing: .01em;
  white-space: normal;
}
.deck-keys[data-tour="1"] button:disabled {
  opacity: .35; cursor: default;
}
.deck-keys-item, .deck-keys-peek {
  display: inline-flex; align-items: baseline; gap: .6ch;
  background: none; border: 0; padding: 0; font: inherit; color: inherit;
}
button.deck-keys-item, .deck-keys-peek { cursor: pointer; }
.deck-keys em { font-style: normal; color: var(--dim); }
kbd {
  font: inherit; border: 1px solid var(--dim); color: var(--fg);
  padding: 0 .5ch; margin-right: .2ch; line-height: 1.3; display: inline-block;
}
`;

/**
 * Give every table its own horizontal scroll port.
 *
 * Call once per render, after the HTML lands. It is a DOM pass rather than a
 * rule in the stylesheet because the two CSS-only ways of doing this both
 * break something else — see the note beside `.scrollx` in theme.css.
 *
 * Idempotent: a table already inside a port is left alone, so calling this
 * twice on the same DOM does not nest wrappers.
 */
export function wrapTables(root = document) {
  for (let table of root.querySelectorAll('table')) {
    if (table.parentElement?.classList.contains('scrollx')) continue;
    let port = document.createElement('div');
    port.className = 'scrollx';
    table.replaceWith(port);
    port.append(table);
  }
}

/**
 * Boot status (`#boot`) is hidden by default (see HTML + boot.js). This only
 * dismisses it once `#app` has real content — it must never re-show the
 * message after a View Transition, or every Hub/tour navigation flashes
 * "connecting…".
 */
function installBoot(doc = document) {
  let boot = doc.getElementById('boot');
  let app = doc.getElementById('app');
  if (!boot || !app || boot.dataset.deckBoot === '1') return;
  boot.dataset.deckBoot = '1';

  let appReady = () => {
    let text = (app.textContent || '').trim();
    return app.childElementCount > 0 || (text.length > 0 && text !== 'loading…');
  };
  let dismiss = () => {
    boot.hidden = true;
    boot.dataset.dismissed = '1';
    app.removeAttribute('aria-busy');
  };
  let sync = () => {
    if (appReady()) dismiss();
  };

  addEventListener('pagereveal', (event) => {
    let vt = event.viewTransition;
    if (!vt) return;
    boot.hidden = true;
    // Stay hidden after the morph — boot.js owns the slow-load reveal.
    vt.finished.finally(() => {
      if (appReady()) dismiss();
      else boot.hidden = true;
    });
  });

  new MutationObserver(sync).observe(app, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  sync();
}

export function installNavStyles(doc = document) {
  let existing = doc.querySelector('style[data-deck-nav]');
  if (existing?.dataset.deckNav === 'v5') return;
  existing?.remove();
  let style = doc.createElement('style');
  style.dataset.deckNav = 'v5';
  style.textContent = NAV_CSS;
  doc.head.append(style);
  installBoot(doc);
}
