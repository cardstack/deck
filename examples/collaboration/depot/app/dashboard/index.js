import { editorClass, exceptionQueue } from 'acme/editor';
import { theme } from 'acme/theme';

const exceptions = [
  { shipment: 'ACM-2048', route: 'Penang → Singapore', reason: 'customs inspection', delay: '+18h', owner: 'Mina', risk: 'critical' },
  { shipment: 'ACM-1987', route: 'Osaka → Seattle', reason: 'missed connection', delay: '+9h', owner: 'Theo', risk: 'high' },
  { shipment: 'ACM-2071', route: 'Berlin → Lisbon', reason: 'carrier capacity', delay: '+4h', owner: 'Ada', risk: 'watch' },
  { shipment: 'ACM-2059', route: 'Austin → Toronto', reason: 'weather hold', delay: '+3h', owner: 'Jules', risk: 'watch' },
];

export function dashboard() {
  return `<main class="${theme.surface} ${editorClass()}">
    <header><div><p class="eyebrow">ACME / FULFILLMENT</p><h1>Delivery control</h1></div><button>Create recovery plan</button></header>
    <section class="metrics"><article><b>12</b><span>shipments at risk</span></article><article><b>94.2%</b><span>on time this week</span></article><article><b>3</b><span>carrier escalations</span></article></section>
    <section class="work"><div class="section-title"><h2>Exceptions requiring action</h2><span>ranked by customer impact</span></div>${exceptionQueue(exceptions)}</section>
  </main>`;
}
