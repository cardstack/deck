import { item } from 'notes/item';

const NOTES = [
  { title: 'Buy oat milk', body: 'the barista kind, not the blue carton' },
  { title: 'Call the framer', body: 'the Hokusai, 40cm mount' },
  { title: 'Water the fig', body: 'Thursdays. It sulks otherwise.' },
];

export function list() {
  return `<ul style="display:grid;gap:.5rem;padding:0;margin:0">
    ${NOTES.map(item).join('')}
  </ul>`;
}
