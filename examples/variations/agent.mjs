// The "agent", faked with deterministic code.
//
// Nothing here calls a model. Three variations are produced from a table, so
// the demo prints the same thing on every run — the point being made is about
// what happens to variations after they exist, not about generating them.
//
// What makes them worth choosing between is that they attack the brief at
// DIFFERENT LAYERS. Asked to make a gallery denser, a real agent will offer
// you exactly this spread, and the three are not interchangeable:
//
//   A  data          shrink the spacing scale         every consumer gets denser
//   B  view          a compact card renderer          only cards get denser
//   C  composition   more columns in the gallery      only this page gets denser
//
// Picking one is a design decision with different blast radii, which is why a
// person has to make it and why the other two must remain readable afterwards.

export const BRIEF = 'make the gallery denser';

export const VARIATIONS = [
  {
    id: 'a',
    layer: 'data',
    deck: 'std/tokens',
    title: 'Shrink the scale',
    blastRadius: 'every deck that reads the tokens',
    rationale:
      'One number, in the layer that already exists to hold numbers. Cheapest to write and the widest to land: anything else importing these tokens gets denser too, whether or not it wanted to.',
    file: 'tokens.json',
    edit: (tokens) => ({ ...tokens, gap: 8, pad: 10 }),
  },
  {
    id: 'b',
    layer: 'view',
    deck: 'ui/card',
    title: 'A compact card',
    blastRadius: 'every page that renders a card',
    rationale:
      'The card decides how much room a card takes. Density becomes a property of the component rather than of the palette, so a page can still choose a roomy card by pinning an older version.',
    file: 'card.js',
    edit: (source) =>
      source
        .replace("gap: var(--pad)", "gap: calc(var(--pad) / 2)")
        .replace('<h3>${item.title}</h3>', '<h3 class="tight">${item.title}</h3>')
        .replace('COMPACT = false', 'COMPACT = true'),
  },
  {
    id: 'c',
    layer: 'composition',
    deck: 'app/gallery',
    title: 'More columns',
    blastRadius: 'this page only',
    rationale:
      'Nothing shared changes at all. The narrowest possible edit, and the one that has to be made again on the next page that wants it.',
    file: 'gallery.js',
    edit: (source) => source.replace('minmax(15rem, 1fr)', 'minmax(9rem, 1fr)'),
  },
];
