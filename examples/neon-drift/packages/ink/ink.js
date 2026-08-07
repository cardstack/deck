import { THEMES, THEME_NAMES } from './themes.js';

/** Tiny palette helper published as its own Deck package. */
export function listThemes() {
  return THEME_NAMES.map((name) => ({ name, label: THEMES[name].label }));
}

export function resolveTheme(name) {
  return THEMES[name] ?? THEMES.magma;
}

export function sampleAccent(theme, t) {
  let accents = theme.accents;
  let i = Math.floor(((t % 1) + 1) % 1 * accents.length);
  return accents[i];
}

export function mixHex(a, b, t) {
  let pa = parseInt(a.slice(1), 16);
  let pb = parseInt(b.slice(1), 16);
  let ar = (pa >> 16) & 255,
    ag = (pa >> 8) & 255,
    ab = pa & 255;
  let br = (pb >> 16) & 255,
    bg = (pb >> 8) & 255,
    bb = pb & 255;
  let r = Math.round(ar + (br - ar) * t);
  let g = Math.round(ag + (bg - ag) * t);
  let bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r} ${g} ${bl})`;
}
