// A plain, framework-free app. The bare specifier 'confetti/' resolves
// through the page's import map to the local Deck server — never a public
// CDN. That is the whole safe-vendor story in one import line.
import { confetti } from 'confetti/confetti.js';

document.querySelector('#go').addEventListener('click', () => {
  let n = confetti(120);
  document.querySelector('#status').textContent =
    `${n} pieces — served immutably from your own Deck server`;
});
