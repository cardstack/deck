#!/usr/bin/env node
// Walk the VALE sale page through ~40 Timeline Steps using the same jj seal
// path `deck history` flushes. No releases — live branch only.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHistory } from '@cardstack/deck-history/create';

const here = dirname(fileURLToPath(import.meta.url));
const depot = join(here, 'depot');
const sale = join(depot, 'vale', 'sale');
const ui = join(depot, 'vale', 'ui');
const type = join(depot, 'vale', 'type');

const attachment = await createHistory({
  dir: depot,
  kind: 'jj',
  onError: (error) => console.error(error),
});
if (!attachment.backend) {
  throw new Error(attachment.detail);
}

async function seal(message) {
  let id = await attachment.backend.seal(depot, message);
  if (id) console.log(`${id.slice(0, 12)}  ${message}`);
  else console.log(`(clean)  ${message}`);
}

async function write(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function patch(path, find, replace) {
  let src = await readFile(path, 'utf8');
  if (!src.includes(find)) throw new Error(`patch miss in ${path}: ${find}`);
  await writeFile(path, src.replace(find, replace));
}

// Steps are small, realistic edits — copy, type, motion, layout — each sealed.
const steps = [
  async () => {
    await patch(
      join(sale, 'index.html'),
      '<title>VALE — Sample Sale</title>',
      '<title>VALE Sample Sale</title>',
    );
    await seal('rename the document title');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'One weekend. Past-season samples. No restocks.',
      'One weekend only. Past-season samples. Nothing restocks.',
    );
    await seal('tighten the hero lede');
  },
  async () => {
    await patch(
      join(sale, 'sale.css'),
      '--signal: #c4f542;',
      '--signal: #c8f24a;',
    );
    await seal('nudge the signal green');
  },
  async () => {
    await patch(
      join(sale, 'sale.css'),
      'object-position: 55% 40%;',
      'object-position: 52% 38%;',
    );
    await seal('reframe the hero crop');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'Get the address',
      'See the address',
    );
    await seal('soften the CTA label');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'Saturday 11–6 · Sunday 12–5 · Door opens on the hour. Cash, card,\n          and patience for the fitting mirror.',
      'Saturday 11–7 · Sunday 12–5 · Doors on the hour. Cash or card.\n          Bring patience for the fitting mirror.',
    );
    await seal('extend Saturday hours');
  },
  async () => {
    await patch(
      join(ui, 'tokens.js'),
      "signal: '#c4f542',",
      "signal: '#c8f24a',",
    );
    await seal('keep ui tokens in sync with the page');
  },
  async () => {
    await patch(
      join(sale, 'sale.js'),
      'breathe(hero, { scale: 1.05, ms: 16000 });',
      'breathe(hero, { scale: 1.04, ms: 18000 });',
    );
    await seal('slow the hero breathe');
  },
  async () => {
    await patch(
      join(sale, 'sale.js'),
      'reveal(el, { delay: Math.min(i * 90, 360), y: 22 });',
      'reveal(el, { delay: Math.min(i * 80, 320), y: 18 });',
    );
    await seal('quicken reveal stagger');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'Overcoats, knits, and truncated runs that never made the lookbook.\n            Sizes lean toward sample 4–8. Everything is final sale.',
      'Overcoats, knits, and truncated runs that never made the lookbook.\n            Sample sizes lean 4–8. Everything is final sale.',
    );
    await seal('clarify sample size range');
  },
  async () => {
    await patch(
      join(sale, 'sale.css'),
      'max-width: 40rem;',
      'max-width: 38rem;',
    );
    await seal('narrow hero copy measure');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      '418 Binder Street, 3rd floor<br />\n          Enter under the green lamp. Buzz <b>VALE</b>.',
      '418 Binder Street · 3rd floor<br />\n          Enter under the green lamp. Buzz <b>VALE</b>.',
    );
    await seal('punctuate the address');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'No holds. No returns. Friends welcome if they can stand still in a\n          narrow loft.',
      'No holds. No returns. Friends welcome if they can stand still\n          in a narrow loft.',
    );
    await seal('rebreak the where note');
  },
  async () => {
    await patch(
      join(sale, 'sale.css'),
      'font-size: 1.0625rem;',
      'font-size: 1.075rem;',
    );
    await seal('lift body type a hair');
  },
  async () => {
    await patch(
      join(ui, 'motion.js'),
      'el.style.transition = `opacity 900ms cubic-bezier(.2,.7,.2,1) ${delay}ms, transform 900ms cubic-bezier(.2,.7,.2,1) ${delay}ms`;',
      'el.style.transition = `opacity 820ms cubic-bezier(.2,.75,.2,1) ${delay}ms, transform 820ms cubic-bezier(.2,.75,.2,1) ${delay}ms`;',
    );
    await seal('tune reveal easing');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      '<h2>Made to be handled</h2>',
      '<h2>Built to be handled</h2>',
    );
    await seal('retitle the fabric section');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'Wool, dry cotton, and the odd chartreuse stitch that marks a\n            studio sample. Try it on. If it fits, it leaves with you.',
      'Wool, dry cotton, and the odd chartreuse stitch that marks a\n            studio sample. Try it on. If it fits, it leaves with you today.',
    );
    await seal('emphasize same-day takeaway');
  },
  async () => {
    await patch(
      join(sale, 'sale.css'),
      'letter-spacing: -0.055em;',
      'letter-spacing: -0.06em;',
    );
    await seal('tighten brand tracking');
  },
  async () => {
    await patch(
      join(type, 'fonts.css'),
      "font-display: swap;\n  src: url('./files/syne-latin-800-normal.woff2') format('woff2');\n}",
      "font-display: swap;\n  src: url('./files/syne-latin-800-normal.woff2') format('woff2');\n}\n\n/* display stack preference documented for the sale page */\n",
    );
    await seal('note the display stack in type deck');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      '<h2>What lands on the rack</h2>',
      '<h2>What hits the rack</h2>',
    );
    await seal('sharpen rack headline');
  },
  async () => {
    await patch(
      join(sale, 'sale.css'),
      'padding: 0.85rem 1.25rem;',
      'padding: 0.9rem 1.35rem;',
    );
    await seal('give the CTA more air');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'VALE · sample sale · live deck',
      'VALE · sample sale · one live branch',
    );
    await seal('footer acknowledges the live branch');
  },
  async () => {
    await write(
      join(sale, 'copy.json'),
      JSON.stringify(
        {
          brand: 'VALE',
          event: 'Sample Sale',
          hours: { sat: '11–7', sun: '12–5' },
          address: '418 Binder Street, 3rd floor',
        },
        null,
        2,
      ) + '\n',
    );
    await seal('extract event facts into copy.json');
  },
  async () => {
    await patch(
      join(sale, 'copy.json'),
      '"address": "418 Binder Street, 3rd floor"',
      '"address": "418 Binder Street, 3rd floor",\n  "buzz": "VALE"',
    );
    await seal('add buzz code to copy.json');
  },
  async () => {
    await patch(
      join(sale, 'sale.css'),
      'gap: clamp(3rem, 8vw, 6rem);',
      'gap: clamp(3.25rem, 8vw, 6.5rem);',
    );
    await seal('open section rhythm');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      '<h2>This weekend only</h2>',
      '<h2>This weekend, only</h2>',
    );
    await seal('comma the weekend headline');
  },
  async () => {
    await patch(
      join(ui, 'tokens.js'),
      "mist: 'rgba(14, 18, 16, 0.55)',",
      "mist: 'rgba(14, 18, 16, 0.58)',",
    );
    await seal('deepen mist token');
  },
  async () => {
    await patch(
      join(sale, 'sale.css'),
      'rgba(14, 18, 16, 0.18) 0%, rgba(14, 18, 16, 0.72) 62%, rgba(14, 18, 16, 0.94) 100%',
      'rgba(14, 18, 16, 0.16) 0%, rgba(14, 18, 16, 0.7) 58%, rgba(14, 18, 16, 0.95) 100%',
    );
    await seal('reshape the hero veil');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'See the address',
      'Get directions',
    );
    await seal('CTA becomes Get directions');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'Get directions',
      'Get the address',
    );
    await seal('restore CTA — address is the promise');
  },
  async () => {
    await write(
      join(ui, 'readme.md'),
      '# vale/ui\n\nTiny surface helpers for VALE pages: tokens + reveal/breathe motion.\n',
    );
    await seal('document the ui deck');
  },
  async () => {
    await write(
      join(type, 'readme.md'),
      '# vale/type\n\nVendored Syne + Literata (latin). No font CDN at runtime.\n',
    );
    await seal('document the type deck');
  },
  async () => {
    await patch(
      join(sale, 'sale.css'),
      'text-transform: uppercase;',
      'text-transform: uppercase;\n  opacity: 0.9;',
    );
    await seal('quiet the footer a notch');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'Nothing restocks.',
      'When a size is gone, it is gone.',
    );
    await seal('say the scarcity plainly');
  },
  async () => {
    await patch(
      join(sale, 'copy.json'),
      '"buzz": "VALE"',
      '"buzz": "VALE",\n  "policy": "final sale"',
    );
    await seal('record final-sale policy in copy.json');
  },
  async () => {
    await patch(
      join(sale, 'sale.js'),
      "import { breathe, reveal } from 'vale/ui';\n",
      "import { breathe, reveal } from 'vale/ui';\n\ndocument.documentElement.dataset.deck = 'vale/sale';\n",
    );
    await seal('tag the document for live tooling');
  },
  async () => {
    await patch(
      join(sale, 'sale.css'),
      '.btn:hover {\n  transform: translateY(-2px);\n  background: #d6ff6a;\n}',
      '.btn:hover {\n  transform: translateY(-1px);\n  background: #d6ff6a;\n}',
    );
    await seal('reduce CTA hover lift');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      '<h2>Where</h2>',
      '<h2>Find us</h2>',
    );
    await seal('rename the where section');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      '<h2>Find us</h2>',
      '<h2>Where</h2>',
    );
    await seal('Where reads clearer than Find us');
  },
  async () => {
    await patch(
      join(sale, 'index.html'),
      'One weekend only. Past-season samples. When a size is gone, it is gone.',
      'One weekend. Past-season samples. When a size is gone, it is gone.',
    );
    await seal('final hero lede pass');
  },
];

console.log(`sealing ${steps.length} steps in ${depot}`);
for (let step of steps) await step();
let seals = await attachment.backend.list(depot);
attachment.backend.close();
console.log(`\n${seals.length} seals total (deck history ${depot})`);
