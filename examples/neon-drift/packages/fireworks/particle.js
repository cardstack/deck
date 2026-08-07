export function createRocket(x, targetY, hueBias = Math.random()) {
  let rise = 8 + Math.random() * 4;
  return {
    kind: 'rocket',
    x,
    y: null,
    vx: (Math.random() - 0.5) * 0.6,
    vy: -rise,
    targetY,
    life: 1,
    size: 2.2,
    hueBias,
    trail: [],
  };
}

export function createSpark(x, y, angle, speed, hueBias) {
  return {
    kind: 'spark',
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 0.75 + Math.random() * 0.55,
    decay: 0.012 + Math.random() * 0.018,
    size: 1.4 + Math.random() * 2.2,
    hueBias,
    twinkle: Math.random(),
  };
}

export function burst(x, y, hueBias, count = 70) {
  let sparks = [];
  for (let i = 0; i < count; i++) {
    let angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.2;
    let speed = 2.2 + Math.random() * 4.8;
    if (i % 5 === 0) speed *= 0.45;
    sparks.push(createSpark(x, y, angle, speed, hueBias + (i / count) * 0.15));
  }
  for (let i = 0; i < 24; i++) {
    let angle = Math.random() * Math.PI * 2;
    sparks.push(
      createSpark(x, y, angle, 1.2 + Math.random() * 1.6, hueBias + 0.5),
    );
  }
  return sparks;
}
