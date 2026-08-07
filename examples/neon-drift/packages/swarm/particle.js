/** Ember that orbits vortex cores — born at a rim, dies, respawns. */
export function createEmber(width, height, hubs) {
  let hub = hubs[(Math.random() * hubs.length) | 0];
  let angle = Math.random() * Math.PI * 2;
  let radius = 40 + Math.random() * Math.min(width, height) * 0.28;
  return {
    angle,
    radius,
    hub: hub.id,
    spin: (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.05),
    radial: (Math.random() - 0.5) * 0.4,
    life: 0.4 + Math.random() * 0.6,
    decay: 0.0015 + Math.random() * 0.0035,
    size: 1.1 + Math.random() * 2.2,
    hueBias: Math.random(),
    trail: [],
    x: width * 0.5,
    y: height * 0.5,
  };
}

export function seedEmbers(count, width, height, hubs) {
  let out = [];
  for (let i = 0; i < count; i++) {
    out.push(createEmber(width, height, hubs));
  }
  return out;
}
