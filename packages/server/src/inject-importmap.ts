// A deck's import map is a tree file, but a browser only honours an import
// map that is INLINE in the document — an external `<script type="importmap"
// src=…>` is not applied. So the server injects it, the same way the Boxel
// realm server injects into its index.html.
//
// This is a rendering of sealed content, not a change to it: the bytes in
// the pack stay exactly what was sealed (`?format=pack` and the tree hash
// are untouched). The injected map is this depot's lock — the same
// authority live pages use — so an immutable response stays honest about
// what THIS depot runs.

// A whole `<script type="importmap" …>…</script>`, so an external one can be
// replaced rather than left to do nothing.
const IMPORTMAP_TAG =
  /<script[^>]*type\s*=\s*["']importmap["'][^>]*>[\s\S]*?<\/script\s*>/i;
const HAS_SRC = /\ssrc\s*=/i;
const MODULE_TAG = /<script[^>]*type\s*=\s*["']module["'][^>]*>/i;
const HEAD_END = /<\/head\s*>/i;
const BODY_START = /<body[^>]*>/i;

export function injectImportMap(
  html: Buffer,
  imports: Record<string, string>,
  // Scopes carry each vendored deck's own bare specifiers, so tone's
  // `standardized-audio-context` resolves inside tone's URL prefix without
  // becoming a global name the app has to know about. Dropping them here
  // was the difference between a page that loads and one that does not.
  scopes: Record<string, Record<string, string>> = {},
  integrity: Record<string, string> = {},
): { bytes: Buffer; injected: boolean } {
  if (
    Object.keys(imports).length === 0 &&
    Object.keys(scopes).length === 0 &&
    Object.keys(integrity).length === 0
  ) {
    return { bytes: html, injected: false };
  }
  let text = html.toString('utf8');
  let map: Record<string, unknown> = { imports };
  if (Object.keys(scopes).length > 0) {
    map.scopes = scopes;
  }
  if (Object.keys(integrity).length > 0) {
    map.integrity = integrity;
  }
  let tag = `<script type="importmap">${JSON.stringify(map)}</script>`;
  let existing = text.match(IMPORTMAP_TAG);
  if (existing) {
    if (!HAS_SRC.test(existing[0])) {
      // The author wrote their own inline map; theirs wins, and silently
      // merging two would be worse than leaving one.
      return { bytes: html, injected: false };
    }
    // An EXTERNAL import map is inert in a browser — `<script type=importmap
    // src=…>` is not applied. Reading it as "put the deck's map here" turns
    // a tag that does nothing into the one thing it was meant to do.
    return {
      bytes: Buffer.from(
        text.slice(0, existing.index!) +
          tag +
          text.slice(existing.index! + existing[0].length),
        'utf8',
      ),
      injected: true,
    };
  }
  // Before the first module script — an import map must precede any module
  // it resolves for.
  let module = text.match(MODULE_TAG);
  let at =
    module?.index ??
    text.match(HEAD_END)?.index ??
    matchEnd(text, BODY_START) ??
    0;
  return {
    bytes: Buffer.from(text.slice(0, at) + `${tag}\n` + text.slice(at), 'utf8'),
    injected: true,
  };
}

function matchEnd(text: string, pattern: RegExp): number | undefined {
  let match = text.match(pattern);
  return match?.index === undefined ? undefined : match.index + match[0].length;
}
