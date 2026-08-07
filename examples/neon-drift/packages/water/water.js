/**
 * Noise-driven water surface with click ripples.
 * Dual-buffer height field + caustic tint from simplex noise.
 */
export class Water {
  constructor({ width, height, noise2D, scale = 4 }) {
    this.noise2D = noise2D;
    this.scale = scale;
    this.t = 0;
    this._tile = null;
    this._tileCtx = null;
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.cols = Math.max(32, Math.ceil(width / this.scale));
    this.rows = Math.max(32, Math.ceil(height / this.scale));
    let n = this.cols * this.rows;
    this.bufA = new Float32Array(n);
    this.bufB = new Float32Array(n);
    this._tile = null;
    this._tileCtx = null;
    this._pixels = null;
  }

  idx(x, y) {
    return y * this.cols + x;
  }

  poke(x, y, strength = 1) {
    let cx = Math.floor((x / this.width) * this.cols);
    let cy = Math.floor((y / this.height) * this.rows);
    let r = 3;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        let px = cx + dx;
        let py = cy + dy;
        if (px <= 0 || py <= 0 || px >= this.cols - 1 || py >= this.rows - 1) {
          continue;
        }
        let d = Math.hypot(dx, dy);
        if (d > r) continue;
        this.bufA[this.idx(px, py)] += strength * (1 - d / r) * 18;
      }
    }
  }

  step(dt = 1) {
    this.t += dt * 0.008;
    let { cols, rows, bufA, bufB } = this;
    let damp = 0.985;
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        let i = y * cols + x;
        let next =
          (bufA[i - 1] + bufA[i + 1] + bufA[i - cols] + bufA[i + cols]) / 2 -
          bufB[i];
        bufB[i] = next * damp;
      }
    }
    for (let y = 1; y < rows - 1; y += 3) {
      for (let x = 1; x < cols - 1; x += 3) {
        let n = this.noise2D(x * 0.05 + this.t, y * 0.05);
        bufB[y * cols + x] += n * 0.1 * dt;
      }
    }
    let tmp = this.bufA;
    this.bufA = this.bufB;
    this.bufB = tmp;
  }

  draw(ctx, theme) {
    let { cols, rows, bufA } = this;
    if (!this._tile || this._tile.width !== cols || this._tile.height !== rows) {
      this._tile = document.createElement('canvas');
      this._tile.width = cols;
      this._tile.height = rows;
      this._tileCtx = this._tile.getContext('2d', { willReadFrequently: true });
      this._pixels = this._tileCtx.createImageData(cols, rows);
    }

    let deep = hexToRgb(theme.bg);
    let hi = hexToRgb(theme.accents[1] ?? theme.accents[0]);
    let foam = hexToRgb(theme.accents[2] ?? '#c4d4ff');
    let data = this._pixels.data;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let i = y * cols + x;
        let hgt = bufA[i];
        let nx =
          bufA[y * cols + Math.min(cols - 1, x + 1)] -
          bufA[y * cols + Math.max(0, x - 1)];
        let ny =
          bufA[Math.min(rows - 1, y + 1) * cols + x] -
          bufA[Math.max(0, y - 1) * cols + x];
        let caustic = this.noise2D(
          x * 0.08 + nx * 0.1,
          y * 0.08 + this.t * 0.7 + ny * 0.1,
        );
        let shade = 0.32 + hgt * 0.045 + caustic * 0.2 - ny * 0.04;
        shade = Math.max(0, Math.min(1, shade));
        let sparkle = Math.max(0, hgt * 0.09 + caustic * 0.55 - 0.32);

        let r = deep[0] + (hi[0] - deep[0]) * shade;
        let g = deep[1] + (hi[1] - deep[1]) * shade;
        let b = deep[2] + (hi[2] - deep[2]) * shade;
        r += (foam[0] - r) * sparkle;
        g += (foam[1] - g) * sparkle;
        b += (foam[2] - b) * sparkle;

        let p = i * 4;
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      }
    }
    this._tileCtx.putImageData(this._pixels, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._tile, 0, 0, this.width, this.height);
  }
}

function hexToRgb(hex) {
  if (!hex || hex[0] !== '#') return [8, 16, 32];
  let n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
