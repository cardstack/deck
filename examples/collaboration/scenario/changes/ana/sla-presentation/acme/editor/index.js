import { theme } from 'acme/theme';

export function exceptionQueue(items) {
  return `<ol class="exception-queue">${items
    .map(
      (item) =>
        `<li><span class="risk ${item.risk}">${item.risk}</span>` +
        `<div><strong>${item.shipment}</strong><small>${item.customer} · ${item.route}</small>` +
        `<small class="reason">${item.reason} · priority ${item.score}</small></div>` +
        `<span class="impact">${item.impact}</span>` +
        `<span class="delay ${theme.sla[item.sla]}">${item.delay}</span>` +
        `<span class="owner">${item.owner}</span></li>`,
    )
    .join('')}</ol>`;
}

export function editorClass() {
  return `operations operations--${theme.density}`;
}
