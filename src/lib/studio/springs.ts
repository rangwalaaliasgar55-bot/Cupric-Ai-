/**
 * Closed-form springs and loop-exact noise.
 *
 * Adapted from the motion-launch-videos motion core by Marouane Gazouzi
 * (https://github.com/Kimeur/motion-launch-videos), MIT licensed. The idea we
 * are borrowing is the important one: a spring does not have to be integrated
 * step by step. The damped-harmonic response has a closed form, so you can ask
 * "where is this spring at time tau?" and get the answer directly.
 *
 * That matters here more than it does almost anywhere else, because Cupric's
 * whole contract is that a frame is a pure function of `t` — the preview and
 * the export must agree to the pixel, and scrubbing backwards has to give the
 * same frame as scrubbing forwards. An integrated spring cannot do that: it
 * depends on the frames you happened to visit. A closed-form one can.
 *
 * What you get for it is motion that looks alive. `back-out` is a polynomial
 * pretending to overshoot; a real spring overshoots, rings down and settles,
 * and the eye knows the difference immediately.
 */

/** `[zeta, omega]` — damping ratio and natural frequency (rad/s). */
export type Spring = readonly [number, number]

/**
 * Named springs, tuned for the jobs they are named after.
 *
 * `zeta < 1` is underdamped: it overshoots and rings back. `zeta = 1` is
 * critically damped: it glides in and stops dead, no overshoot.
 */
export const SPRINGS = {
  /** Heavy arrival with a real bounce. Titles, logo slams. */
  slam: [0.6, 30.0],
  /** Confident landing, one small overshoot. The default entrance. */
  land: [0.72, 28.0],
  /** Tight, fast pop. Stickers, icons, emphasis. */
  punch: [0.65, 31.0],
  /** No overshoot at all — for opacity and anything that must not wobble. */
  glide: [1, 32.4],
  /** Slow, deliberate settle. Camera moves and focus pulls. */
  focus: [1, 19.5],
  /** Loose and swingy. Lines drawing on, pendulum motion. */
  sway: [0.8, 15.6],
} as const satisfies Record<string, Spring>

export type SpringName = keyof typeof SPRINGS

export const SPRING_INFO: Record<SpringName, { label: string; hint: string }> = {
  slam: { label: 'Slam', hint: 'Heavy arrival with a real bounce — titles and logo stings.' },
  land: { label: 'Land', hint: 'Confident entrance with one small overshoot. The safe default.' },
  punch: { label: 'Punch', hint: 'Tight and fast — stickers, icons, a word you want felt.' },
  glide: { label: 'Glide', hint: 'Smooth, no overshoot. Use for fades and anything that must not wobble.' },
  focus: { label: 'Focus', hint: 'Slow and deliberate — camera pushes and focus pulls.' },
  sway: { label: 'Sway', hint: 'Loose and swingy, keeps moving a moment longer.' },
}

/** Resolve a name or a raw pair to a spring. */
export function spring(sp: SpringName | Spring): Spring {
  return typeof sp === 'string' ? SPRINGS[sp] : sp
}

/**
 * When the response is within 2e-6 of its target.
 *
 * Past this we return exactly 1 rather than an ever-shrinking remainder, so a
 * value that should be at rest really is — which is what makes a loop
 * bit-exact instead of almost-exact.
 */
export function settle(sp: Spring): number {
  return 16 / (sp[0] * sp[1])
}

/** The spring's response at `tau` seconds after it was kicked. 0 → 1. */
export function springAt(tau: number, sp: SpringName | Spring): number {
  const s = spring(sp)
  const z = s[0], w = s[1]
  if (tau <= 0) return 0
  if (tau >= settle(s)) return 1
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z)
    return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + ((z * w) / wd) * Math.sin(wd * tau))
  }
  return 1 - (1 + w * tau) * Math.exp(-w * tau)
}

/** Rate of change at `tau`, per second. Useful for velocity-driven effects. */
export function springVelocity(tau: number, sp: SpringName | Spring): number {
  const s = spring(sp)
  const z = s[0], w = s[1]
  if (tau <= 0 || tau >= settle(s)) return 0
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z)
    return ((w * w) / wd) * Math.exp(-z * w * tau) * Math.sin(wd * tau)
  }
  return w * w * tau * Math.exp(-w * tau)
}

/**
 * When the move visually lands — the first time it reaches its target.
 *
 * This is what you schedule against. A spring "arrives" long before it has
 * finished ringing, and timing a cut to `settle()` instead of `landT()` is
 * what makes motion graphics feel sluggish.
 */
export function springLand(sp: SpringName | Spring): number {
  const s = spring(sp)
  const z = s[0], w = s[1]
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z)
    return (Math.PI - Math.atan(wd / (z * w))) / wd
  }
  let a = 0, b = settle(s)
  for (let i = 0; i < 40; i += 1) {
    const m = (a + b) / 2
    if (springAt(m, s) < 0.95) a = m
    else b = m
  }
  return b
}

/**
 * A spring as a keyframe easing curve: p 0→1 over the segment.
 *
 * The segment's own length becomes the spring's settle time, so the motion
 * fills exactly the time you gave it and still ends at precisely 1. That keeps
 * springs interchangeable with the existing eases — no keyframe needs to know
 * it is being driven by physics.
 */
export function springEase(name: SpringName): (p: number) => number {
  const sp = SPRINGS[name]
  const span = settle(sp)
  return (p: number) => {
    if (p <= 0) return 0
    if (p >= 1) return 1
    return springAt(p * span, sp)
  }
}

/* ——————————————————— seeded, loop-exact randomness ——————————————————— */

/** Three integers to [0,1), well mixed. A pure stand-in for Math.random. */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul((a | 0) ^ 0x3c6ef372, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13) ^ (b | 0), 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16) ^ (c | 0), 0x27d4eb2f)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const TAU = Math.PI * 2

/**
 * Smooth noise in [-1, 1] that loops *exactly* over `durSec`.
 *
 * Built from three whole harmonics with seeded phases, so the value and its
 * slope match at the seam. This is how you get idle drift, handheld float or a
 * breathing glow that can run forever without a visible jump on the loop —
 * ordinary value noise always ticks at the wrap point.
 */
export function loopNoise(t: number, cyclesPerLoop: number, seed: number, durSec: number): number {
  if (durSec <= 0) return 0
  const cyc = (n: number, phase: number) => TAU * ((n * t) / durSec + phase)
  return (
    Math.sin(cyc(cyclesPerLoop, hash(seed, 1))) +
    0.5 * Math.sin(cyc(2 * cyclesPerLoop + 1, hash(seed, 2))) +
    0.25 * Math.sin(cyc(4 * cyclesPerLoop + 3, hash(seed, 3)))
  ) / 1.75
}

/** Deterministic shuffle — same seed, same order, on every machine. */
export function shuffled<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice()
  let a = seed
  const rand = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}
