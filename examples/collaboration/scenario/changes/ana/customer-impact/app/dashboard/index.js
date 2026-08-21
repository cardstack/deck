import { editorClass, exceptionQueue } from 'acme/editor';
import { theme } from 'acme/theme';
import { formatImpact, impactScore } from 'impact-score';

const exceptions = [
  {
    shipment: 'ACM-2048',
    customer: 'Northstar Retail',
    route: 'Penang → Singapore',
    reason: 'customs inspection',
    value: 184000,
    delay: '+18h',
    owner: 'Mina',
    risk: 'critical',
    sla: 'breached',
  },
  {
    shipment: 'ACM-1987',
    customer: 'Kanso Labs',
    route: 'Osaka → Seattle',
    reason: 'missed connection',
    value: 72000,
    delay: '+9h',
    owner: 'Theo',
    risk: 'high',
    sla: 'breached',
  },
  {
    shipment: 'ACM-2071',
    customer: 'Forma Casa',
    route: 'Berlin → Lisbon',
    reason: 'carrier capacity',
    value: 31000,
    delay: '+4h',
    owner: 'Ada',
    risk: 'watch',
    sla: 'dueSoon',
  },
  {
    shipment: 'ACM-2059',
    customer: 'Field & Finch',
    route: 'Austin → Toronto',
    reason: 'weather hold',
    value: 18000,
    delay: '+3h',
    owner: 'Jules',
    risk: 'watch',
    sla: 'healthy',
  },
]
  .map((item) => ({
    ...item,
    score: impactScore(item),
    impact: formatImpact(item.value),
  }))
  .sort((left, right) => right.score - left.score);

export function dashboard() {
  let recoverable = formatImpact(
    exceptions.reduce((total, item) => total + item.value, 0),
  );
  return `<main class="${theme.surface} ${editorClass()}">
    <header><div><p class="eyebrow">ACME / FULFILLMENT</p><h1>Delivery control</h1></div><div class="header-action"><small>72h recoverable value: ${recoverable}</small><button>Create recovery plan</button></div></header>
    <section class="metrics"><article><b>12</b><span>shipments at risk</span></article><article><b>94.2%</b><span>on time this week</span></article><article><b>${recoverable}</b><span>recoverable value</span></article></section>
    <section class="work"><div class="section-title"><h2>Exceptions requiring action</h2><span>ranked by customer impact</span></div>${exceptionQueue(exceptions)}</section>
  </main>`;
}
