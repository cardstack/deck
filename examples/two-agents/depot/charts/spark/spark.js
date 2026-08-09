// Agent B's deck. Same instant, same depot, same server — different files.
export function spark(values, stroke = '#0c9d7c') {
  let max = Math.max(...values, 1);
  let points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / max) * 28}`)
    .join(' ');
  return `<svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" /></svg>`;
}
