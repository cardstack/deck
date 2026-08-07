import { createNoise2D } from 'simplex-noise';
import { resolveTheme, sampleAccent } from 'ink';
import { Swarm } from 'swarm';
import { Fireworks } from 'fireworks';
import { Water } from 'water';

const theme = resolveTheme('aurora');
const noise = createNoise2D();

function bindPanel(canvas, createSim) {
  let ctx = canvas.getContext('2d');
  let sim;
  let dpr = 1;

  function size() {
    let rect = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let w = rect.width;
    let h = rect.height;
    if (!sim) sim = createSim(w, h);
    else sim.resize(w, h);
    return { w, h };
  }

  function localPoint(e) {
    let rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    let { x, y } = localPoint(e);
    sim?.poke(x, y, 1.2);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons !== 1 || !sim?.poke) return;
    // Water feels better with drag ripples; others ignore drag.
    if (sim instanceof Water) {
      let { x, y } = localPoint(e);
      sim.poke(x, y, 0.45);
    }
  });

  size();
  return {
    canvas,
    ctx,
    get sim() {
      return sim;
    },
    size,
    step(dt) {
      sim?.step(dt);
    },
    draw() {
      if (!sim) return;
      if (sim instanceof Water) {
        sim.draw(ctx, theme);
      } else {
        sim.draw(ctx, theme, sampleAccent);
      }
    },
  };
}

const panels = [
  bindPanel(document.getElementById('drift'), (w, h) => {
    let s = new Swarm({
      width: w,
      height: h,
      count: Math.round((w * h) / 1800),
      noise2D: noise,
    });
    ctxFill(document.getElementById('drift'), theme.bg);
    return s;
  }),
  bindPanel(document.getElementById('fireworks'), (w, h) => {
    let f = new Fireworks({ width: w, height: h, noise2D: noise });
    ctxFill(document.getElementById('fireworks'), theme.bg);
    f.autoLaunch();
    f.autoLaunch();
    return f;
  }),
  bindPanel(document.getElementById('water'), (w, h) => {
    let water = new Water({ width: w, height: h, noise2D: noise });
    water.poke(w * 0.5, h * 0.4, 1.4);
    water.poke(w * 0.3, h * 0.55, 0.8);
    return water;
  }),
];

function ctxFill(canvas, color) {
  let ctx = canvas.getContext('2d');
  let rect = canvas.getBoundingClientRect();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, rect.width, rect.height);
}

let last = performance.now();
function frame(now) {
  let dt = Math.min(2.5, (now - last) / 16.67);
  last = now;
  for (let p of panels) {
    p.step(dt);
    p.draw();
  }
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  for (let p of panels) {
    p.size();
    ctxFill(p.canvas, theme.bg);
  }
});

requestAnimationFrame(frame);
