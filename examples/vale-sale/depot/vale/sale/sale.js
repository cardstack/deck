import { breathe, reveal } from 'vale/ui';

document.documentElement.dataset.deck = 'vale/sale';

const hero = document.querySelector('[data-role="hero-media"]');
breathe(hero, { scale: 1.03, ms: 20000 });

document.querySelectorAll('[data-reveal]').forEach((el, i) => {
  reveal(el, { delay: Math.min(i * 70, 280), y: 16 });
});

// teach: breathe pass
