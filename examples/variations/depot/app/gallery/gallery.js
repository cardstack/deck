// The composition layer. Arranges cards; owns nothing else.
//
// It decides how many cards fit across, and that is the third place an agent
// could answer "make it denser" — the narrowest of the three, because nothing
// outside this page changes.
import { tokens } from 'std/tokens';
import { card } from 'ui/card';

const ITEMS = [
  { title: 'Monstera deliciosa', light: 'bright, indirect', price: 24, pot: '#3f6f4f' },
  { title: 'Snake plant', light: 'anywhere, honestly', price: 16, pot: '#8a9a5b' },
  { title: 'Fiddle-leaf fig', light: 'bright, fussy', price: 45, pot: '#c08457' },
  { title: 'Pothos', light: 'low light, forgiving', price: 12, pot: '#6b8f71' },
  { title: 'Rubber plant', light: 'medium, steady', price: 28, pot: '#7d5a50' },
  { title: 'ZZ plant', light: 'shade, near-immortal', price: 19, pot: '#4f6457' },
];

export async function gallery() {
  let t = await tokens();
  let cards = await Promise.all(ITEMS.map((item) => card(item)));
  return `<div class="gallery" style="
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: ${t.gap}px;
  ">${cards.join('')}</div>`;
}
