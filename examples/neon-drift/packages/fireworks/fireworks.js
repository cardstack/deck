import { burst, createRocket } from './particle.js';

/** Click-to-launch fireworks with ambient auto-bursts. */
export class Fireworks {
  constructor({ width, height, noise2D }) {
    this.width = width;
    this.height = height;
    this.noise2D = noise2D;
    this.particles = [];
    this.t = 0;
    this.autoTimer = 0;
    this.gravity = 0.055;
    this.launches = 0;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  poke(x, y) {
    let rocket = createRocket(
      x + (Math.random() - 0.5) * 20,
      Math.max(40, y),
      Math.random(),
    );
    rocket.y = this.height + 8;
    let frames = Math.max(18, (rocket.y - rocket.targetY) / -rocket.vy);
    rocket.vx = (x - rocket.x) / frames;
    this.particles.push(rocket);
    this.launches++;
  }

  autoLaunch() {
    let x = this.width * (0.15 + Math.random() * 0.7);
    let y = this.height * (0.12 + Math.random() * 0.4);
    this.poke(x, y);
  }

  step(dt = 1) {
    this.t += dt * 0.01;
    this.autoTimer += dt;
    if (this.autoTimer > 50 + Math.random() * 30) {
      this.autoTimer = 0;
      this.autoLaunch();
      if (Math.random() < 0.3) this.autoLaunch();
    }

    let next = [];
    for (let p of this.particles) {
      if (p.kind === 'rocket') {
        p.trail.push({ x: p.x, y: p.y, life: 1 });
        if (p.trail.length > 14) p.trail.shift();
        for (let t of p.trail) t.life -= 0.08 * dt;
        p.vy += this.gravity * 0.15 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.vy >= -0.4 || p.y <= p.targetY) {
          next.push(
            ...burst(p.x, p.y, p.hueBias, 64 + ((Math.random() * 40) | 0)),
          );
          continue;
        }
        next.push(p);
        continue;
      }
      let n = this.noise2D(p.x * 0.01, p.y * 0.01 + this.t);
      p.vx += n * 0.04 * dt;
      p.vy += this.gravity * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
      p.twinkle += 0.2 * dt;
      if (p.life > 0 && p.y < this.height + 40) next.push(p);
    }
    this.particles = next;
  }

  draw(ctx, theme, sampleAccent) {
    ctx.fillStyle = theme.trail.replace(/[\d.]+\)$/, '0.22)');
    ctx.fillRect(0, 0, this.width, this.height);

    for (let p of this.particles) {
      if (p.kind === 'rocket') {
        for (let [i, t] of p.trail.entries()) {
          ctx.globalAlpha = Math.max(0, t.life) * 0.5;
          ctx.fillStyle = sampleAccent(theme, p.hueBias);
          ctx.beginPath();
          ctx.arc(t.x, t.y, 1.2 + i * 0.05, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff8e8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      let flicker = 0.55 + 0.45 * Math.abs(Math.sin(p.twinkle * 4));
      ctx.globalAlpha = Math.max(0, p.life) * flicker;
      ctx.fillStyle = sampleAccent(theme, p.hueBias + (1 - p.life) * 0.2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.7 + p.life * 0.6), 0, Math.PI * 2);
      ctx.fill();
      if (p.life > 0.55) {
        ctx.globalAlpha = (p.life - 0.55) * 1.4;
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
