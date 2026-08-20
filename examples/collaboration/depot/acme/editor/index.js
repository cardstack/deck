import { theme } from 'acme/theme';

export function reviewQueue(items) {
  return `<ol class="review-queue">${items
    .map(
      (item) => `<li><span class="review-state ${item.state}">${item.state}</span>` +
        `<div><strong>${item.title}</strong><small>${item.packages} packages · ${item.author}</small></div>` +
        `<code>#${item.number}</code></li>`,
    )
    .join('')}</ol>`;
}

export function editorClass() {
  return `editor editor--${theme.density}`;
}
