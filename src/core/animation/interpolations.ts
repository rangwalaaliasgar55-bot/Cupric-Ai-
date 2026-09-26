export type EasingFunction = (t: number) => number;

export const Easings = {
  linear: (t: number): number => t,
  easeInQuad: (t: number): number => t * t,
  easeOutQuad: (t: number): number => t * (2 - t),
  easeInOutQuad: (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t: number): number => t * t * t,
  easeOutCubic: (t: number): number => --t * t * t + 1,
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeInQuart: (t: number): number => t * t * t * t,
  easeOutQuart: (t: number): number => 1 - --t * t * t * t,
  easeInOutQuart: (t: number): number =>
    t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t,
  easeInExpo: (t: number): number => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  easeOutExpo: (t: number): number => (t === 1 ? 1 : -Math.pow(2, -10 * t) + 1),
  easeInOutExpo: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    if ((t /= 0.5) < 1) return 0.5 * Math.pow(2, 10 * (t - 1));
    return 0.5 * (-Math.pow(2, -10 * --t) + 2);
  },
  easeInBack: (t: number, s = 1.70158): number => t * t * ((s + 1) * t - s),
  easeOutBack: (t: number, s = 1.70158): number => --t * t * ((s + 1) * t + s) + 1,
  easeInOutBack: (t: number, s = 1.70158): number => {
    const s2 = s * 1.525;
    if ((t /= 0.5) < 1) return 0.5 * (t * t * ((s2 + 1) * t - s2));
    return 0.5 * ((t -= 2) * t * ((s2 + 1) * t + s2) + 2);
  },
  easeOutElastic: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    const p = 0.3;
    const s = p / 4;
    return Math.pow(2, -10 * t) * Math.sin(((t - s) * (2 * Math.PI)) / p) + 1;
  },
  easeOutBounce: (t: number): number => {
    if (t < 1 / 2.75) {
      return 7.5625 * t * t;
    } else if (t < 2 / 2.75) {
      return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    } else if (t < 2.5 / 2.75) {
      return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    } else {
      return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    }
  },
  easeInOutBounce: (t: number): number => {
    if (t < 0.5) return Easings.easeInBounce(t * 2) * 0.5;
    return Easings.easeOutBounce(t * 2 - 1) * 0.5 + 0.5;
  },
  easeInBounce: (t: number): number => 1 - Easings.easeOutBounce(1 - t),
};

export type EasingType = keyof typeof Easings;

export interface SpringConfig {
  stiffness?: number; // tension (e.g. 100)
  damping?: number;   // friction (e.g. 10)
  mass?: number;      // weight (e.g. 1)
  velocity?: number;  // initial velocity
}

/**
 * Deterministic analytic spring evaluation at continuous time `t` (seconds).
 * Frame-safe and reproducible for offline video renderers.
 */
export function evaluateSpring(
  t: number,
  config: SpringConfig = {}
): number {
  if (t <= 0) return 0;
  const { stiffness = 170, damping = 26, mass = 1, velocity = 0 } = config;

  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  if (zeta < 1) {
    // Under-damped (oscillates)
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const a = 1;
    const b = (zeta * w0 - velocity) / wd;
    return (
      1 -
      Math.exp(-zeta * w0 * t) *
        (a * Math.cos(wd * t) + b * Math.sin(wd * t))
    );
  } else if (zeta === 1) {
    // Critically damped
    return 1 - (1 + (w0 - velocity) * t) * Math.exp(-w0 * t);
  } else {
    // Over-damped
    const r1 = -zeta * w0 + w0 * Math.sqrt(zeta * zeta - 1);
    const r2 = -zeta * w0 - w0 * Math.sqrt(zeta * zeta - 1);
    const c1 = (velocity - r2) / (r1 - r2);
    const c2 = 1 - c1;
    return 1 - (c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t));
  }
}

export function interpolate(
  input: number,
  inputRange: [number, number],
  outputRange: [number, number],
  options: {
    easing?: EasingType | EasingFunction;
    extrapolateLeft?: 'clamp' | 'extend' | 'identity';
    extrapolateRight?: 'clamp' | 'extend' | 'identity';
  } = {}
): number {
  const [inMin, inMax] = inputRange;
  const [outMin, outMax] = outputRange;
  const {
    easing = 'linear',
    extrapolateLeft = 'clamp',
    extrapolateRight = 'clamp',
  } = options;

  let progress = (input - inMin) / (inMax - inMin);

  if (progress < 0) {
    if (extrapolateLeft === 'clamp') progress = 0;
    else if (extrapolateLeft === 'identity') return input;
  }
  if (progress > 1) {
    if (extrapolateRight === 'clamp') progress = 1;
    else if (extrapolateRight === 'identity') return input;
  }

  const easeFn =
    typeof easing === 'function' ? easing : Easings[easing] || Easings.linear;
  const eased = easeFn(Math.max(0, Math.min(1, progress)));

  return outMin + (outMax - outMin) * eased;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}
