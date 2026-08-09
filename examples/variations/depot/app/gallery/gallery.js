// The composition layer. Arranges cards; owns nothing else.
import { tokens } from 'std/tokens';
import { card } from 'ui/card';

const ITEMS = [
  { title: 'Ingest', note: 'warehouse → staging, hourly' },
  { title: 'Reconcile', note: 'two ledgers, one truth' },
  { title: 'Publish', note: 'sealed, immutable, addressable' },
  { title: 'Notify', note: 'only when something changed' },
  { title: 'Archive', note: 'cold storage after 90 days' },
  { title: 'Audit', note: 'who saw what, and when' },
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
