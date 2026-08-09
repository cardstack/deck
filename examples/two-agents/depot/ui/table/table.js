// Agent A's deck. Nobody else edits this file, so nobody else can collide
// with it — which is the whole point of one deck per component.
export function table(rows) {
  return `<table>${rows
    .map((row) => `<tr><td>${row.label}</td><td class="v">${row.value}</td></tr>`)
    .join('')}</table>`;
}
