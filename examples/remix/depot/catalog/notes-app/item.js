import { theme } from 'notes/theme';

export function item(note) {
  return `<li style="
    background: ${theme.surface};
    border: 1px solid ${theme.accent}33;
    border-left: 4px solid ${theme.accent};
    border-radius: ${theme.radius};
    padding: .6rem .8rem;
    list-style: none;
  ">
    <b style="color:${theme.ink}">${note.title}</b>
    <div style="color:${theme.ink}99;font-size:.85rem">${note.body}</div>
  </li>`;
}
