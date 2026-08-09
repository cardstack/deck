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
//   A  data          tighter, squarer tokens          every consumer gets denser
//   B  view          a one-line card                  only cards get denser
//   C  composition   more columns in the gallery      only this page gets denser
//
// Picking one is a design decision with different blast radii, which is why a
// person has to make it and why the other two must remain readable afterwards.
//
// The three are also made to LOOK different, on purpose. Three answers that
// a reader cannot tell apart at a glance is a picker with nothing to pick.

export const BRIEF = 'make the gallery denser';

export const VARIATIONS = [
  {
    id: 'a',
    layer: 'data',
    deck: 'std/tokens',
    title: 'Tighter, squarer tokens',
    blastRadius: 'every deck that reads the tokens',
    rationale:
      'Three numbers, in the layer that already exists to hold numbers. Cheapest to write and the widest to land: anything else importing these tokens gets tight square corners too, whether or not it wanted to.',
    file: 'tokens.json',
    edit: (tokens) => ({ ...tokens, gap: 6, pad: 8, radius: 2 }),
  },
  {
    id: 'b',
    layer: 'view',
    deck: 'ui/card',
    title: 'A one-line card',
    blastRadius: 'every page that renders a card',
    rationale:
      'The card decides what a card IS. Here density stops being spacing and becomes shape: the pot colour shrinks to a stripe, and the name and the price share a line. Any page can still choose the roomy card by pinning an older version.',
    file: 'card.js',
    // A different card, not a smaller one. The reader should be able to tell
    // this apart from A across the room.
    edit: (source) =>
      source
        .replace('COMPACT = false', 'COMPACT = true')
        .replace(
          `    padding: var(--pad);
    display: grid;
    gap: calc(var(--pad) / 2);`,
          `    padding: calc(var(--pad) / 2) var(--pad);
    display: flex;
    align-items: baseline;
    gap: calc(var(--pad) / 2);
    border-left: 4px solid \${item.pot};`,
        )
        .replace(
          `    <div style="height:\${t.pad * 2}px;border-radius:\${t.radius}px;background:\${item.pot}"></div>
    <h3 style="margin:0;font-size:.95rem">\${item.title}</h3>
    <p style="margin:0;color:\${t.quiet};font-size:.8rem">\${item.light}</p>
    <b style="font-size:.9rem">£\${item.price}</b>`,
          `    <h3 style="margin:0;font-size:.9rem;flex:1">\${item.title}</h3>
    <b style="font-size:.9rem">£\${item.price}</b>`,
        ),
  },
  {
    id: 'c',
    layer: 'composition',
    deck: 'app/gallery',
    title: 'Twice the columns',
    blastRadius: 'this page only',
    rationale:
      'Nothing shared changes at all. The cards keep their shape and their spacing; there are simply more of them across. The narrowest possible edit, and the one that has to be made again on the next page that wants it.',
    file: 'gallery.js',
    edit: (source) => source.replace('minmax(15rem, 1fr)', 'minmax(8rem, 1fr)'),
  },
];
