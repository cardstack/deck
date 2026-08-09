// The view layer. One card, rendered from the shared tokens.
import { tokens } from 'std/tokens';

export const COMPACT = false;

export async function card(item) {
  let t = await tokens();
  return `<article class="card" style="
    --pad: ${t.pad}px;
    padding: var(--pad);
    display: grid;
    gap: var(--pad);
    border: 1px solid ${t.line};
    border-radius: ${t.radius}px;
    background: ${t.surface};
    color: ${t.ink};
  ">
    <h3>${item.title}</h3>
    <p style="margin:0;color:${t.quiet};font-size:.85rem">${item.note}</p>
  </article>`;
}
