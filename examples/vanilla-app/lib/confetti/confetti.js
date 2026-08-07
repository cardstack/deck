import { COLORS } from './util/colors.js';

// A stand-in for a vetted third-party library (the "reviewed three.js"
// of the safe-vendor story): served ONLY from your own Deck server.
export function confetti(count = 80) {
  let pieces = [];
  for (let i = 0; i < count; i++) {
    let el = document.createElement('div');
    let size = 6 + Math.random() * 6;
    el.style.cssText = `position:fixed;top:-20px;left:${Math.random() * 100}vw;` +
      `width:${size}px;height:${size}px;` +
      `background:${COLORS[i % COLORS.length]};` +
      `transform:rotate(${Math.random() * 360}deg);z-index:9999;pointer-events:none;`;
    document.body.appendChild(el);
    let fall = el.animate(
      [
        { transform: el.style.transform, top: '-20px' },
        {
          transform: `rotate(${Math.random() * 720}deg)`,
          top: '105vh',
        },
      ],
      { duration: 2500 + Math.random() * 2500, easing: 'ease-in' },
    );
    fall.onfinish = () => el.remove();
    pieces.push(el);
  }
  return pieces.length;
}
