/* Core deterministic math: easing, interpolation, springs, seeded RNG, noise, color.
 * Everything here is a pure function — safe for frame-exact video rendering. */

export type EaseFn = (t: number) => number;

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const mapRange = (v: number, a: number, b: number, c: number, d: number, clampIt = true) => {
  const t = invLerp(a, b, v);
  return lerp(c, d, clampIt ? clamp(t) : t);
};
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/* ---------------- Easing ---------------- */
const pow = Math.pow, sin = Math.sin, cos = Math.cos, PI = Math.PI, sqrt = Math.sqrt;
const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1, c4 = (2 * PI) / 3, c5 = (2 * PI) / 4.5;
const bounceOut: EaseFn = (x) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    for (let i = 0; i < 20 && Math.abs(sx(t) - x) > 1e-5; i++) {
      if (sx(t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export const EASINGS: Record<string, EaseFn> = {
  linear: (x) => x,
  easeInQuad: (x) => x * x,
  easeOutQuad: (x) => 1 - (1 - x) * (1 - x),
  easeInOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - pow(-2 * x + 2, 2) / 2),
  easeInCubic: (x) => x * x * x,
  easeOutCubic: (x) => 1 - pow(1 - x, 3),
  easeInOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2),
  easeInQuart: (x) => x ** 4,
  easeOutQuart: (x) => 1 - pow(1 - x, 4),
  easeInOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - pow(-2 * x + 2, 4) / 2),
  easeInQuint: (x) => x ** 5,
  easeOutQuint: (x) => 1 - pow(1 - x, 5),
  easeInOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - pow(-2 * x + 2, 5) / 2),
  easeInSine: (x) => 1 - cos((x * PI) / 2),
  easeOutSine: (x) => sin((x * PI) / 2),
  easeInOutSine: (x) => -(cos(PI * x) - 1) / 2,
  easeInExpo: (x) => (x === 0 ? 0 : pow(2, 10 * x - 10)),
  easeOutExpo: (x) => (x === 1 ? 1 : 1 - pow(2, -10 * x)),
  easeInOutExpo: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? pow(2, 20 * x - 10) / 2 : (2 - pow(2, -20 * x + 10)) / 2),
  easeInCirc: (x) => 1 - sqrt(1 - x * x),
  easeOutCirc: (x) => sqrt(1 - pow(x - 1, 2)),
  easeInOutCirc: (x) => (x < 0.5 ? (1 - sqrt(1 - pow(2 * x, 2))) / 2 : (sqrt(1 - pow(-2 * x + 2, 2)) + 1) / 2),
  easeInBack: (x) => c3 * x * x * x - c1 * x * x,
  easeOutBack: (x) => 1 + c3 * pow(x - 1, 3) + c1 * pow(x - 1, 2),
  easeInOutBack: (x) => (x < 0.5 ? (pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2 : (pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2),
  easeInElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : -pow(2, 10 * x - 10) * sin((x * 10 - 10.75) * c4)),
  easeOutElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : pow(2, -10 * x) * sin((x * 10 - 0.75) * c4) + 1),
  easeInOutElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? -(pow(2, 20 * x - 10) * sin((20 * x - 11.125) * c5)) / 2 : (pow(2, -20 * x + 10) * sin((20 * x - 11.125) * c5)) / 2 + 1),
  easeInBounce: (x) => 1 - bounceOut(1 - x),
  easeOutBounce: bounceOut,
  easeInOutBounce: (x) => (x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2),
  // Designer curves
  standard: cubicBezier(0.2, 0, 0, 1),
  emphasized: cubicBezier(0.05, 0.7, 0.1, 1),
  cinematic: cubicBezier(0.7, 0, 0.2, 1),
  snappy: cubicBezier(0.3, 1.3, 0.4, 1),
  apple: cubicBezier(0.25, 0.1, 0.25, 1),
  luxury: cubicBezier(0.83, 0, 0.17, 1),
  anticipate: (x) => (x < 0.2 ? -0.15 * sin((x / 0.2) * PI) : EASINGS.easeOutCubic((x - 0.2) / 0.8)),
  overshoot: cubicBezier(0.34, 1.56, 0.64, 1),
  steps4: (x) => Math.floor(x * 4) / 4,
  steps8: (x) => Math.floor(x * 8) / 8,
};
export const EASING_NAMES = Object.keys(EASINGS);

export function getEase(e?: string | EaseFn): EaseFn {
  if (!e) return EASINGS.standard;
  if (typeof e === "function") return e;
  if (EASINGS[e]) return EASINGS[e];
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(e);
  if (m) {
    const p = m[1].split(",").map(Number);
    if (p.length === 4 && p.every((n) => Number.isFinite(n))) return cubicBezier(p[0], p[1], p[2], p[3]);
  }
  return EASINGS.standard;
}

/* ---------------- Spring (analytical, deterministic) ---------------- */
export type SpringConfig = { stiffness?: number; damping?: number; mass?: number; velocity?: number };
export const SPRING_PRESETS: Record<string, SpringConfig> = {
  gentle: { stiffness: 120, damping: 14 },
  snappy: { stiffness: 400, damping: 30 },
  bouncy: { stiffness: 300, damping: 10 },
  wobbly: { stiffness: 180, damping: 8 },
  stiff: { stiffness: 600, damping: 45 },
  slow: { stiffness: 60, damping: 15 },
  molasses: { stiffness: 40, damping: 20 },
};
/** Position (0→1) of a spring at time t seconds. */
export function springValue(t: number, cfg: SpringConfig = {}): number {
  const k = cfg.stiffness ?? 170, c = cfg.damping ?? 26, m = cfg.mass ?? 1, v0 = -(cfg.velocity ?? 0);
  if (t <= 0) return 0;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const x0 = 1; // displacement from target
  let x: number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + ((zeta * w0 * x0 - v0) / wd) * Math.sin(wd * t));
  } else if (zeta === 1) {
    x = Math.exp(-w0 * t) * (x0 + (w0 * x0 - v0) * t);
  } else {
    const wd = w0 * Math.sqrt(zeta * zeta - 1);
    x = Math.exp(-zeta * w0 * t) * (x0 * Math.cosh(wd * t) + ((zeta * w0 * x0 - v0) / wd) * Math.sinh(wd * t));
  }
  return 1 - x;
}
/** Approximate settle time (seconds) of a spring. */
export function springDuration(cfg: SpringConfig = {}, threshold = 0.001): number {
  for (let t = 0; t < 10; t += 1 / 120) {
    let settled = true;
    for (let s = 0; s < 0.25; s += 1 / 60) if (Math.abs(1 - springValue(t + s, cfg)) > threshold) { settled = false; break; }
    if (settled) return t;
  }
  return 10;
}

/* ---------------- Seeded randomness ---------------- */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ---------------- Value noise (deterministic) ---------------- */
function vhash(x: number, y: number, z: number, seed: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.1234) * 43758.5453;
  return s - Math.floor(s);
}
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const n = (a: number, b: number, c: number) => vhash(xi + a, yi + b, zi + c, seed);
  const x00 = lerp(n(0, 0, 0), n(1, 0, 0), u), x10 = lerp(n(0, 1, 0), n(1, 1, 0), u);
  const x01 = lerp(n(0, 0, 1), n(1, 0, 1), u), x11 = lerp(n(0, 1, 1), n(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}
export function fbm3(x: number, y: number, z: number, octaves = 4, seed = 0): number {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < octaves; i++) { s += a * noise3(x * f, y * f, z * f, seed + i * 17); f *= 2; a *= 0.5; }
  return s;
}

/* ---------------- Color ---------------- */
export type RGBA = { r: number; g: number; b: number; a: number };
export function parseColor(c: string): RGBA {
  if (!c) return { r: 0, g: 0, b: 0, a: 1 };
  if (c.startsWith("#")) {
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p[3] ?? 1 };
  }
  const hs = /hsla?\(([^)]+)\)/.exec(c);
  if (hs) {
    const p = hs[1].split(/[ ,]+/).map((x) => parseFloat(x));
    const [r, g, b] = hslToRgb(p[0], p[1] / 100, p[2] / 100);
    return { r, g, b, a: p[3] ?? 1 };
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}
export const rgbaStr = (c: RGBA) => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+c.a.toFixed(3)})`;
export function withAlpha(c: string, a: number) { const p = parseColor(c); return rgbaStr({ ...p, a: p.a * a }); }
export function mixColor(a: string, b: string, t: number) {
  const x = parseColor(a), y = parseColor(b);
  return rgbaStr({ r: lerp(x.r, y.r, t), g: lerp(x.g, y.g, t), b: lerp(x.b, y.b, t), a: lerp(x.a, y.a, t) });
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
export function toHex(c: string) {
  const p = parseColor(c);
  return "#" + [p.r, p.g, p.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
export function hsl(h: number, s: number, l: number) { const [r, g, b] = hslToRgb(h, s, l); return toHex(`rgb(${r},${g},${b})`); }
export function shiftHue(c: string, deg: number, ds = 0, dl = 0) {
  const p = parseColor(c); const [h, s, l] = rgbToHsl(p.r, p.g, p.b);
  return hsl(h + deg, clamp(s + ds), clamp(l + dl));
}
