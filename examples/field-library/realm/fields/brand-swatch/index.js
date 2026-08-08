// The brand team's colour field. Same job as `fields/swatch`, same import —
// `chroma-js` — and a DIFFERENT version behind it.
//
//     fields/swatch        "chroma-js": "lib/chroma-js@^3.1.0"
//     fields/brand-swatch  "chroma-js": "lib/chroma-js@2.6.0"    ← exact
//
// The exact pin is a decision, not an oversight: these ramps were signed off
// against 2.6.0's numbers, so this deck stays on 2.6.0 until someone re-signs
// them. Nothing about that decision leaks: it is one line in one deck's
// decklist, and the rest of the realm moves on.
//
// Both fields render on the same page. That is only possible because each
// deck's dependencies resolve inside its own URL prefix (an import-map
// `scope`) rather than in one flat table where the last writer wins.
import * as chromaNs from 'chroma-js';
import * as zodNs from 'zod';

const chroma = chromaNs.default;
const { z } = zodNs;

const schema = z.object({
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, '#rrggbb'),
  label: z.string().optional(),
});

export const field = {
  name: 'BrandSwatch',
  summary: 'The signed-off brand ramp. Pinned to chroma-js 2.6.0 on purpose.',
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
  ramp(value) {
    return chroma
      .scale([value.hex, '#ffffff'])
      .mode('lab')
      .colors(5)
      .map((hex) => hex.toLowerCase());
  },
};
