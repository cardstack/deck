import { editorClass, exceptionQueue } from 'acme/editor';
import { theme } from 'acme/theme';

const exceptions = [
  { shipment: 'ACM-2048', customer: 'Northstar Retail', route: 'Penang → Singapore', reason: 'customs inspection', impact: '$184k', delay: '+18h', owner: 'Mina', risk: 'critical', sla: 'breached' },
  { shipment: 'ACM-1987', customer: 'Kanso Labs', route: 'Osaka → Seattle', reason: 'missed connection', impact: '$72k', delay: '+9h', owner: 'Theo', risk: 'high', sla: 'breached' },
  { shipment: 'ACM-2071', customer: 'Forma Casa', route: 'Berlin → Lisbon', reason: 'carrier capacity', impact: '$31k', delay: '+4h', owner: 'Ada', risk: 'watch', sla: 'dueSoon' },
  { shipment: 'ACM-2059', customer: 'Field & Finch', route: 'Austin → Toronto', reason: 'weather hold', impact: '$18k', delay: '+3h', owner: 'Jules', risk: 'watch', sla: 'healthy' },
];

export function dashboard() {
  return `<main class="${theme.surface} ${editorClass()}">
    <header><div><p class="eyebrow">ACME / FULFILLMENT</p><h1>Delivery control</h1></div><div class="header-action"><small>72h recoverable value: $305k</small><button>Create recovery plan</button></div></header>
    <section class="metrics"><article><b>12</b><span>shipments at risk</span></article><article><b>94.2%</b><span>on time this week</span></article><article><b>$305k</b><span>recoverable value</span></article></section>
    <section class="work"><div class="section-title"><h2>Exceptions requiring action</h2><span>ranked by customer impact</span></div>${exceptionQueue(exceptions)}</section>
  </main>`;
}
