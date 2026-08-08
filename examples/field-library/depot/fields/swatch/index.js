// A colour field, on the current chroma-js.
//
// Its twin, `fields/brand-swatch`, is pinned to chroma-js 2.6.0 and is on the
// same page. Both write `import chroma from 'chroma-js'`; each resolves
// inside its OWN scope, so two versions of one library coexist in one
// document. A flat import map cannot express that — one of the two would
// have to lose.
import * as chromaNs from 'chroma-js';
import * as zodNs from 'zod';

const chroma = chromaNs.default;
const { z } = zodNs;

const schema = z.object({
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, '#rrggbb'),
  label: z.string().optional(),
});

export const field = {
  name: 'Swatch',
  summary: 'A colour, with a readable-contrast foreground picked for it.',
  library: 'chroma-js',
  schema,
  modules: { zod: zodNs, 'chroma-js': chromaNs },
  examples: [
    { hex: '#6638ff', label: 'boxel purple' },
    { hex: '#00ffba', label: 'boxel teal' },
    { hex: '#ff5050', label: 'boxel red' },
  ],
  format(value) {
    let color = chroma(value.hex);
    let [l, c, h] = color.oklch();
    return `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${Number.isNaN(h) ? 0 : h.toFixed(0)})`;
  },
  css(value) {
    let color = chroma(value.hex);
    return {
      background: color.hex(),
      foreground: chroma.contrast(color, 'white') > 3.2 ? '#ffffff' : '#141322',
    };
  },
  // The measurable difference between the two chroma versions on this page:
  // a five-step Lab ramp, printed as hex. Whatever it comes out as, both
  // decks compute it with their own copy.
  ramp(value) {
    return chroma
      .scale([value.hex, '#ffffff'])
      .mode('lab')
      .colors(5)
      .map((hex) => hex.toLowerCase());
  },
};
