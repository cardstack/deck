import { createEmber, seedEmbers } from './particle.js';

/**
 * Orbital ember storm — particles whip around moving vortex hubs
 * on long trails. Click births a new hub that steals nearby embers.
 * Totally different feel from the old ambient noise field.
 */
export class Swarm {
  constructor({ width, height, count = 700, noise2D }) {
    this.width = width;
    this.height = height;
    this.noise2D = noise2D;
    this.t = 0;
    this.hubs = this.#makeHubs();
    this.particles = seedEmbers(count, width, height, this.hubs);
    this.maxTrail = 10;
  }

  #makeHubs() {
    return [
      {
        id: 0,
        x: this.width * 0.35,
        y: this.height * 0.45,
        phase: 0,
        strength: 1,
        age: Infinity,
      },
      {
        id: 1,
        x: this.width * 0.65,
        y: this.height * 0.55,
        phase: Math.PI,
        strength: 1,
        age: Infinity,
      },
    ];
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  poke(x, y) {
    let id = this.hubs.length;
    this.hubs.push({
      id,
      x,
      y,
      phase: Math.random() * Math.PI * 2,
      strength: 1.6,
      age: 0,
    });
    // Yank nearby embers onto the new hub and stretch their orbits.
    for (let p of this.particles) {
      let dx = p.x - x;
      let dy = p.y - y;
      if (dx * dx + dy * dy < 120 * 120) {
        p.hub = id;
        p.radius = 20 + Math.random() * 70;
        p.spin *= 1.4;
        p.life = 1;
      }
    }
    // Sprinkle fresh embers at the click.
    for (let i = 0; i < 40; i++) {
      let ember = createEmber(this.width, this.height, this.hubs);
      ember.hub = id;
      ember.radius = 8 + Math.random() * 50;
      ember.life = 1;
      this.particles[(Math.random() * this.particles.length) | 0] = ember;
    }
  }

  step(dt = 1) {
    this.t += dt * 0.016;
    // Drift hubs on slow Lissajous paths; click-hubs fade out.
    for (let hub of this.hubs) {
      hub.age += dt;
      if (hub.age !== Infinity) {
        hub.strength = Math.max(0, 1.6 - hub.age / 160);
      }
      let n = this.noise2D(hub.id * 3.1 + this.t * 0.15, hub.phase);
      if (hub.age === Infinity) {
        let ox = hub.id === 0 ? 0.35 : 0.65;
        let oy = hub.id === 0 ? 0.45 : 0.55;
        hub.x =
          this.width *
          (ox + Math.sin(this.t * 0.7 + hub.phase) * 0.12 + n * 0.04);
        hub.y =
          this.height *
          (oy + Math.cos(this.t * 0.55 + hub.phase) * 0.14 + n * 0.04);
      }
    }
    this.hubs = this.hubs.filter(
      (h) => h.age === Infinity || h.strength > 0.05,
    );

    let hubById = new Map(this.hubs.map((h) => [h.id, h]));

    for (let p of this.particles) {
      let hub = hubById.get(p.hub) ?? this.hubs[0];
      if (!hub) continue;

      // Occasional hub hop when another core is stronger nearby.
      if (Math.random() < 0.002) {
        let nearest = this.hubs[0];
        let best = Infinity;
        for (let h of this.hubs) {
          let d = (p.x - h.x) ** 2 + (p.y - h.y) ** 2;
          let score = d / (h.strength + 0.2);
          if (score < best) {
            best = score;
            nearest = h;
          }
        }
        p.hub = nearest.id;
        hub = nearest;
      }

      p.angle += p.spin * hub.strength * dt;
      p.radius += p.radial * dt;
      let breathe =
        1 +
        this.noise2D(p.hueBias * 8 + this.t, p.angle) * 0.08 * hub.strength;
      let r = Math.max(6, p.radius * breathe);
      if (r > Math.min(this.width, this.height) * 0.42) p.radial = -Math.abs(p.radial);
      if (r < 10) p.radial = Math.abs(p.radial);

      p.trail.push({ x: p.x, y: p.y, life: p.life });
      if (p.trail.length > this.maxTrail) p.trail.shift();
      for (let t of p.trail) t.life -= 0.08 * dt;

      p.x = hub.x + Math.cos(p.angle) * r;
      p.y = hub.y + Math.sin(p.angle) * r * 0.72; // slight ellipse

      p.life -= p.decay * dt;
      if (p.life <= 0) {
        Object.assign(p, createEmber(this.width, this.height, this.hubs));
      }
    }
  }

  draw(ctx, theme, sampleAccent) {
    ctx.fillStyle = theme.bg;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalAlpha = 1;

    // Soft hub glows
    for (let hub of this.hubs) {
      let g = ctx.createRadialGradient(hub.x, hub.y, 0, hub.x, hub.y, 70);
      g.addColorStop(0, sampleAccent(theme, hub.id * 0.2 + this.t * 0.05));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.12 * hub.strength;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 70, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (let p of this.particles) {
      let color = sampleAccent(theme, p.hueBias + this.t * 0.08);
      // Ribbon trail
      if (p.trail.length > 1) {
        ctx.strokeStyle = color;
        ctx.lineWidth = p.size * 0.7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < p.trail.length; i++) {
          let t = p.trail[i];
          ctx.globalAlpha = Math.max(0, t.life) * 0.35 * (i / p.trail.length);
          if (i === 0) ctx.moveTo(t.x, t.y);
          else ctx.lineTo(t.x, t.y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 0.55 + p.life * 0.45;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      // Hot tip
      ctx.globalAlpha = 0.7 * p.life;
      ctx.fillStyle = '#fff6e0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
