import { editorClass, reviewQueue } from 'acme/editor';
import { theme } from 'acme/theme';

const work = [
  { number: 18, title: 'Unify deployment controls', packages: 3, author: 'Mina', state: 'ready' },
  { number: 17, title: 'Stream audit events', packages: 2, author: 'Theo', state: 'checks' },
  { number: 15, title: 'Retire legacy token flow', packages: 4, author: 'Ada', state: 'draft' },
];

export function dashboard() {
  return `<main class="${theme.surface} ${editorClass()}">
    <header><div><p class="eyebrow">ACME / OPERATIONS</p><h1>Repository workbench</h1></div><button>New review</button></header>
    <section class="metrics"><article><b>3</b><span>open reviews</span></article><article><b>7</b><span>member packages</span></article><article><b>main</b><span>default branch</span></article></section>
    <section class="work"><div class="section-title"><h2>Review queue</h2><span>updated now</span></div>${reviewQueue(work)}</section>
  </main>`;
}
