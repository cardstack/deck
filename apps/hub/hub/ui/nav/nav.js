// <deck-nav app="browse"> and <deck-keys> — the chrome every Hub app carries.
//
// Four apps, four documents, so moving between them is a link and a page
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
// `1`…`4` still switch apps. They are not printed beside the names — a row of
// ordinals is noise once the four words are the four words — and the legend
// at the foot of every page carries them instead, which is where every other
// binding is documented anyway.

const ROUTES = [
  ['start', 'is it up, and what just happened'],
  ['browse', 'the depot at rest'],
  ['run', 'the assembled, executing thing'],
  ['read', 'the protocol, taught'],
];

const esc = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

export class DeckNav extends HTMLElement {
  connectedCallback() {
    let current = this.getAttribute('app') ?? '';
    this.innerHTML =
      `<nav class="deck-nav">` +
      // The mark is the home button. `/` redirects to whichever app is the
      // front door, so this is one link that never needs updating when the
      // front door moves.
      `<a class="deck-nav-mark" href="/" title="Deck Hub — home">DECK</a>` +
      ROUTES.map(([route, title]) =>
        route === current
          ? `<span class="deck-nav-here" aria-current="page">${esc(route)}</span>`
          : `<a href="/${esc(route)}" title="${esc(title)}">${esc(route)}</a>`,
      ).join('') +
      `<span class="deck-nav-gap"></span>` +
      `<span class="deck-nav-live" data-live="?">live</span>` +
      `</nav>`;
    this.#watchLive();
    this.#numberKeys();
  }

  // `1`…`4` go to a section, the way the numbers in the nav imply. Ignored
  // while a field has focus, or the filter box would be unusable.
  #numberKeys() {
    addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      let tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      let index = Number(event.key) - 1;
      let route = ROUTES[index]?.[0];
      if (route && route !== this.getAttribute('app')) {
        location.href = `/${route}`;
      }
    });
  }

  // The SSE indicator has one job and it is the unglamorous one: be
  // unambiguous when the connection is NOT there. A live badge that looks the
  // same whether or not it is receiving is worse than no badge, because it
  // makes a broken watcher look like a quiet depot.
  #watchLive() {
    let badge = this.querySelector('.deck-nav-live');
    let source = new EventSource('/_live/events');
    let set = (state, text) => {
      badge.dataset.live = state;
      badge.textContent = text;
    };
    source.addEventListener('open', () => set('on', 'live'));
    source.addEventListener('error', () => set('off', 'live: disconnected'));
    source.addEventListener('change', (event) => {
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
  }

  #settle;
}

/**
 * <deck-keys> — the pinned legend.
 *
 * Set `.keys` to an array of `[keys, label]`, where `keys` is one or more
 * key names. Every shortcut the page implements appears here, always, and
 * nothing appears here that the page does not implement. A legend that drifts
 * from the bindings is worse than no legend.
 */
export class DeckKeys extends HTMLElement {
  #keys = [];
  #shown = localStorage.getItem('deck.keys') !== 'hidden';

  set keys(value) {
    this.#keys = value;
    this.render();
  }

  get keys() {
    return this.#keys;
  }

  connectedCallback() {
    this.render();
    // `h` hides and shows, and the choice sticks. Someone who has learned
    // the keys should not have to keep dismissing the reminder, and someone
    // who has not should not have to know it exists to find it — so when it
    // is hidden a single `?` remains, which is a smaller promise than a full
    // bar and still an obvious one.
    addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      let tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (event.key !== 'h' && event.key !== '?') return;
      this.toggle();
    });
    this.addEventListener('click', (event) => {
      if (event.target.closest('[data-role="keys-toggle"]')) this.toggle();
    });
  }

  toggle(next = !this.#shown) {
    this.#shown = next;
    localStorage.setItem('deck.keys', next ? 'shown' : 'hidden');
    this.render();
  }

  render() {
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
.deck-nav-mark {
  font-weight: 600; letter-spacing: .18em; margin-right: 2ch;
  color: var(--a-depot) !important; padding-left: 0 !important;
}
.deck-nav-mark:hover { background: var(--a-depot) !important; color: var(--bg) !important; }
.deck-nav-here { background: var(--a-package); color: var(--bg); font-weight: 600; }
.deck-nav-gap { flex: 1; }
.deck-nav-live { color: var(--dim); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; max-width: 40ch; }
.deck-nav-live::before { content: '● '; }
.deck-nav-live[data-live='on']::before { color: var(--green); }
.deck-nav-live[data-live='off']::before { color: var(--red); }
.deck-nav-live[data-live='?']::before { color: var(--dim); }

.deck-keys {
  position: fixed; left: 0; right: 0; bottom: 0;
  display: flex; flex-wrap: wrap; gap: .2em 2.5ch;
  padding: calc(var(--row, 1.5) * .5em) var(--gut, 2ch);
  background: var(--bg); border-top: 1px solid var(--line);
  font-size: 12px;
}
.deck-keys[data-collapsed] { border-top-color: transparent; background: none; }
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

export function installNavStyles(doc = document) {
  if (doc.querySelector('style[data-deck-nav]')) {
    return;
  }
  let style = doc.createElement('style');
  style.dataset.deckNav = 'v1';
  style.textContent = NAV_CSS;
  doc.head.append(style);
}
