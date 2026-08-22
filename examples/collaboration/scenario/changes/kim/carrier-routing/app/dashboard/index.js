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
    carrier: 'Meridian Freight',
    desk: 'Trade compliance',
    escalation: 'trade',
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
    carrier: 'Pacific Air Cargo',
    desk: 'Network control',
    escalation: 'network',
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
    carrier: 'Atlas Road',
    desk: 'Capacity desk',
    escalation: 'carrier',
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
    carrier: 'Northline',
    desk: 'Local operations',
    escalation: 'local',
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
    <div class="live-ribbon"><i></i> Live carrier routing <span>4 desks online</span></div>
    <header><div><p class="eyebrow">ACME / NETWORK COMMAND</p><h1>Carrier command center</h1><p class="lede">Every high-value exception now has a route, a desk, and a named owner.</p></div><div class="header-action"><small>72h recoverable value: ${recoverable}</small><button>Open incident room</button></div></header>
    <section class="metrics"><article><b>12</b><span>shipments at risk</span></article><article class="metric-hot"><b>4</b><span>carrier desks engaged</span></article><article><b>${recoverable}</b><span>recoverable value</span></article></section>
    <div class="dispatch-layout">
      <aside class="routing-rail"><p class="eyebrow">Routing map</p><h2>Recovery desks</h2><ol><li><i class="desk-trade"></i><div><b>Trade compliance</b><small>Northstar Retail · ACM-2048</small></div><span>18h</span></li><li><i class="desk-network"></i><div><b>Network control</b><small>Kanso Labs · ACM-1987</small></div><span>9h</span></li><li><i class="desk-carrier"></i><div><b>Capacity desk</b><small>Forma Casa · ACM-2071</small></div><span>4h</span></li><li><i class="desk-local"></i><div><b>Local operations</b><small>Field & Finch · ACM-2059</small></div><span>3h</span></li></ol><footer><span>Next coordination</span><b>09:30 SGT</b></footer></aside>
      <section class="work"><div class="section-title"><div><p class="eyebrow">Dispatch queue</p><h2>Exceptions requiring action</h2></div><span>routed by impact and ownership</span></div>${exceptionQueue(exceptions)}</section>
    </div>
  </main>`;
}
