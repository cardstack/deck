import { riskWeight, slaWeight } from './weights.js';

export function impactScore({ value, risk, sla }) {
  return Math.round(value * (riskWeight[risk] ?? 1) * (slaWeight[sla] ?? 1));
}

export function formatImpact(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 0,
  }).format(value);
}
