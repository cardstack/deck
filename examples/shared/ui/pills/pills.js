// Three kinds of name, three pills.
//
// Nearly every confusing sentence about a vendored package is confusing
// because three different names for "the same thing" are spelled the same
// way, in the same font, in the same paragraph:
//
//   leaflet@1.9.4                     what npm publishes
//   @babel/runtime@7.24.0             …and what a SCOPED one looks like
//   Leaflet/Leaflet                   where the source lives
//   /site/lib/leaflet@1.9.4/…         where THIS depot serves it from
//
// Every pill shows its namespace, and the npm pill shows an empty one when
// that is the truth. A github pill always has an `org`; a deck pill always
// has a `<publisher>`; an unscoped npm name has nobody at all in it. That
// asymmetry is not a rendering gap to paper over — it IS the difference,
// and the `<publisher>` segment of a deck address is what closes it.
//
// They are not the same thing, and which one you mean changes what a claim
// means. "Leaflet is 85 modules" is a fact about the npm tarball. "The fork
// cost 2 objects" is a fact about the store. "Fixed in 1.9.5" is a fact
// about the repo. So the demos never print a bare name — they print a pill
// that says which register the name is in.
//
//   deck    OUR delivery and resolution space. A URL this server answers,
//           or the address grammar it answers by. Nothing outside this
//           process decides what it means.
//   npm     the published artifact. A registry name and version — the thing
//           that was fetched, hashed, and vendored.
//   github  the source. An `org/repo`, optionally at a commit, which npm
//           may or may not actually correspond to (see L8, and
//           docs/deck-rebuild-sibling-proposal.md for when it does not).
//
// Deliberately not links. These demos claim they reach nothing at runtime,
// and a page full of outbound anchors invites the reader to test that claim
// against the wrong thing. The pill's job is to disambiguate, not navigate.

export const KINDS = {
  deck: {
    label: 'deck',
    title: 'a Deck address — where this depot serves it from',
  },
  npm: {
    label: 'npm',
    title:
      'a published npm package — the registry it came from, and the artifact that was vendored',
  },
  github: {
    label: 'github',
    title: 'a source repository — org/repo, where the code is written',
  },
};

const esc = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

// `/<depot>/<publisher>/<package>@<version>/<path>` — the version is the part
// a reader most often needs to find, so it is the part that is emphasised.
// A grammar pattern (`/<depot>/…`) has no version to find and falls through
// to plain text.
const DECK_ADDRESS =
  /^(\/?(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9-]*)@([^/\s]+)(\/.*)?$/;

// An npm pill shows whatever namespace the name actually carries, and
// nothing when it carries none — the scope of a scoped package
// (`@babel/runtime`), or a registry host when one is written out
// (`npm.acme.internal/thing@1.0.0`, a different supply chain from the
// public registry and never to be silently relabelled as it).
//
// It does NOT invent one. An unscoped npm name has no owner segment: that
// is a true and load-bearing fact about the registry — anyone could be the
// next publisher of `leaflet` — and printing a synthetic namespace over it
// would hide exactly the gap the `<publisher>` segment of a deck address
// closes. Empty is the honest rendering.
//
// A `<placeholder>` head is the legend's grammar. `npm:` is accepted
// because that is how `deck vendor` spells the same spec.
function npmParts(value) {
  let spec = value.startsWith('npm:') ? value.slice('npm:'.length) : value;
  let slash = spec.indexOf('/');
  let head = slash > 0 ? spec.slice(0, slash) : '';
  if (head && (head.startsWith('@') || head.includes('.') || head.startsWith('<'))) {
    return { namespace: head, spec: spec.slice(slash + 1) };
  }
  return { namespace: '', spec };
}

function decorate(kind, value) {
  if (kind === 'deck') {
    let match = DECK_ADDRESS.exec(value);
    if (match) {
      let [, name, version, rest] = match;
      return `${esc(name)}<b>@${esc(version)}</b>${esc(rest ?? '')}`;
    }
  }
  if (kind === 'npm') {
    let { namespace, spec } = npmParts(value);
    let at = spec.lastIndexOf('@');
    let named =
      at > 0
        ? `${esc(spec.slice(0, at))}<b>@${esc(spec.slice(at + 1))}</b>`
        : esc(spec);
    return namespace
      ? `<span class="dpill-ns">${esc(namespace)}/</span>${named}`
      : named;
  }
  if (kind === 'github') {
    // `org/repo` or `org/repo@<commit>`.
    let at = value.lastIndexOf('@');
    if (at > 0) {
      return `${esc(value.slice(0, at))}<b>@${esc(value.slice(at + 1, at + 13))}</b>`;
    }
  }
  return esc(value);
}

/**
 * One pill. `kind` is 'deck' | 'npm' | 'github'.
 * `options.wrap` lets a long address break across lines instead of scrolling.
 */
export function pill(kind, value, options = {}) {
  let meta = KINDS[kind];
  if (!meta) {
    throw new Error(`unknown pill kind: ${kind}`);
  }
  let classes = ['dpill', kind, ...(options.wrap ? ['wrap'] : [])];
  return (
    `<span class="${classes.join(' ')}" title="${esc(options.title ?? meta.title)}">` +
    `<span class="dpill-k">${esc(meta.label)}</span>` +
    `<span class="dpill-v">${decorate(kind, value)}</span>` +
    `</span>`
  );
}

/**
 * The key, shown once per page so the convention teaches itself.
 *
 * `examples` overrides the grammar with the page's OWN three names, which is
 * almost always better: a reader looking at a page about prosemirror-model
 * learns more from the three real names for prosemirror-model than from three
 * slots with angle brackets in them. Pass real ones. The grammar is the
 * fallback for a page that has no single subject.
 */
export function legend(kinds = Object.keys(KINDS), examples = {}) {
  return (
    `<div class="dpill-legend">` +
    kinds
      .map(
        (kind) =>
          `<span class="dpill-legend-item">${pill(kind, examples[kind] ?? EXAMPLE[kind])}` +
          `<em>${esc(MEANS[kind])}</em></span>`,
      )
      .join('') +
    `</div>`
  );
}

// The FALLBACK legend shows the grammar rather than a plausible-looking fake
// address: a made-up concrete example reads as a real URL and invites the
// reader to go looking for something that is not there, while the angle
// brackets say "this slot is a name you choose".
//
// A page that has a real subject should pass real names instead — see the
// `examples` argument above. Every concrete address in these demos is one the
// server actually answers.
const EXAMPLE = {
  deck: '/<depot>/<publisher>/<package>@<version>/<path>',
  npm: '<scope>/<name>@<version>',
  github: '<org>/<repo>',
};
const MEANS = {
  deck: 'served from here',
  npm: 'published to the registry',
  github: 'where the source lives',
};

export const PILL_CSS = `
.dpill {
  display: inline-flex; align-items: baseline; gap: .4em;
  border: 1px solid; border-radius: 999px;
  padding: .08em .6em .12em .35em;
  font-family: var(--dpill-mono, 'IBM Plex Mono', ui-monospace, Menlo, monospace);
  font-size: .8em; line-height: 1.5; white-space: nowrap; max-width: 100%;
  vertical-align: baseline;
}
.dpill.wrap { white-space: normal; word-break: break-all; }
.dpill-k {
  flex: none;
  font-family: var(--dpill-sans, 'IBM Plex Sans', system-ui, sans-serif);
  font-size: .78em; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
  opacity: .75;
}
.dpill-v { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dpill-v b { font-weight: 600; }
/* The namespace is context, not the answer: present, readable, and not
   competing with the package name for the eye. */
.dpill-ns { opacity: .58; }
/* Our own space: the interactive teal, because it is the only one of the
   three this server is authoritative about. */
.dpill.deck   { color: #0a6d56; border-color: #cfeee2; background: #f0fbf7; }
/* The registry: npm's own red, muted for a light surface. */
.dpill.npm    { color: #a3231f; border-color: #f5d6d4; background: #fff5f4; }
/* The source: neutral ink, like the platform it names. */
.dpill.github { color: #3f3d49; border-color: #e2e8f0; background: #f6f7f9; }
.dpill-legend { display: flex; flex-wrap: wrap; gap: .5rem 1.1rem; align-items: center; }
.dpill-legend-item { display: inline-flex; align-items: baseline; gap: .45rem; }
.dpill-legend em {
  font-family: var(--dpill-sans, 'IBM Plex Sans', system-ui, sans-serif);
  font-style: normal; font-size: .78rem; color: #8b8b93;
}
`;

let installed = false;

/** Idempotent: several modules on one page may all ask for the styles. */
export function installPillStyles(doc = document) {
  if (installed && doc === document) {
    return;
  }
  installed = true;
  let style = doc.createElement('style');
  style.dataset.pills = 'v1';
  style.textContent = PILL_CSS;
  doc.head.append(style);
}
