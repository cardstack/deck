// The view layer. One product card, rendered from the shared tokens.
//
// It owns the SHAPE of a card and nothing else: how much room a card takes,
// what sits next to what. The numbers come from `std/tokens`, and what is on
// the page comes from whoever calls it. Those are three separate decks and
// three separate places an agent could answer "make it denser" — which is
// what this example is about.
import { tokens } from 'std/tokens';

export const COMPACT = false;

export async function card(item) {
  let t = await tokens();
  return `<article class="card" style="
    --pad: ${t.pad}px;
    padding: var(--pad);
    display: grid;
    gap: calc(var(--pad) / 2);
    border: 1px solid ${t.line};
    border-radius: ${t.radius}px;
    background: ${t.surface};
    color: ${t.ink};
  ">
    <div style="height:${t.pad * 2}px;border-radius:${t.radius}px;background:${item.pot}"></div>
    <h3 style="margin:0;font-size:.95rem">${item.title}</h3>
    <p style="margin:0;color:${t.quiet};font-size:.8rem">${item.light}</p>
    <b style="font-size:.9rem">£${item.price}</b>
  </article>`;
}
