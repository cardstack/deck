/** Small motion helpers for the sale page — presence, not noise. */

export function prefersReducedMotion() {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Fade + rise in when an element enters the viewport. */
export function reveal(el, { delay = 0, y = 28 } = {}) {
  if (!el) return;
  if (prefersReducedMotion()) {
    el.style.opacity = '1';
    el.style.transform = 'none';
    return;
  }
  el.style.opacity = '0';
  el.style.transform = `translate3d(0, ${y}px, 0)`;
  el.style.transition = `opacity 860ms cubic-bezier(.2,.78,.2,1) ${delay}ms, transform 860ms cubic-bezier(.2,.7,.2,1) ${delay}ms`;
  const show = () => {
    el.style.opacity = '1';
    el.style.transform = 'translate3d(0, 0, 0)';
  };
  if (typeof IntersectionObserver === 'undefined') {
    requestAnimationFrame(show);
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          show();
          io.disconnect();
        }
      }
    },
    { threshold: 0.18 },
  );
  io.observe(el);
}

/** Slow Ken-Burns drift on a full-bleed image wrapper. */
export function breathe(el, { scale = 1.06, ms = 14000 } = {}) {
  if (!el || prefersReducedMotion()) return;
  el.animate(
    [
      { transform: 'scale(1) translate3d(0, 0, 0)' },
      { transform: `scale(${scale}) translate3d(-1.2%, -0.6%, 0)` },
      { transform: 'scale(1) translate3d(0, 0, 0)' },
    ],
    { duration: ms, iterations: Infinity, easing: 'ease-in-out' },
  );
}
