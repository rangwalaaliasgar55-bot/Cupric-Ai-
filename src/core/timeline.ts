/* Deterministic timeline engine. A timeline is a pure function of time: seek(t) writes values into targets.
 * Supports tweens, keyframes, springs, sequences, parallel groups, stagger, nested timelines, repeat,
 * yoyo/mirror, reverse, labels, markers and callbacks (fired when the playhead crosses them). */
import { clamp, getEase, lerp, mixColor, springValue, SPRING_PRESETS, type EaseFn, type SpringConfig } from "./math";

type Target = Record<string, unknown>;
export type TweenVars = {
  from?: number | string;
  to: number | string;
  duration?: number; // seconds
  delay?: number;
  ease?: string | EaseFn;
  spring?: string | SpringConfig;
  onStart?: () => void;
  onComplete?: () => void;
};
export type RepeatType = "loop" | "reverse" | "mirror";
export type TimelineOptions = { repeat?: number; repeatType?: RepeatType; repeatDelay?: number; paused?: boolean; timeScale?: number; onUpdate?: (t: number) => void; onComplete?: () => void };

interface Child {
  start: number;
  duration: number;
  render(localT: number, prevLocal: number): void;
}

class TweenChild implements Child {
  start: number; duration: number;
  private ease: EaseFn; private started = false; private done = false;
  constructor(private target: Target, private prop: string, private v: TweenVars, start: number) {
    this.start = start + (v.delay ?? 0);
    this.duration = v.duration ?? 0.5;
    const sp = typeof v.spring === "string" ? SPRING_PRESETS[v.spring] : v.spring;
    this.ease = sp ? (p: number) => springValue(p * this.duration, sp) : getEase(v.ease);
    if (v.from === undefined) v.from = target[prop] as number | string;
  }
  render(t: number, prev: number) {
    const p = this.duration === 0 ? (t >= 0 ? 1 : 0) : clamp(t / this.duration);
    const e = p === 0 ? 0 : this.ease(p);
    const { from, to } = this.v;
    this.target[this.prop] = typeof to === "string" ? mixColor(String(from), to, clamp(e)) : lerp(Number(from), to, e);
    if (t >= 0 && prev < 0 && !this.started) { this.started = true; this.v.onStart?.(); }
    if (t >= this.duration && prev < this.duration && !this.done) { this.done = true; this.v.onComplete?.(); }
    if (t < 0) this.started = false;
    if (t < this.duration) this.done = false;
  }
}

class CallChild implements Child {
  duration = 0;
  constructor(public start: number, private fn: () => void) {}
  render(t: number, prev: number) { if (t >= 0 && prev < 0) this.fn(); }
}

export class Timeline implements Child {
  start = 0;
  private children: Child[] = [];
  private labels = new Map<string, number>();
  markers: { time: number; label: string }[] = [];
  private cursor = 0;
  private lastLocal = -1e-9;
  private playing = false;
  private raf = 0;
  time = 0;
  constructor(public opts: TimelineOptions = {}) {}

  /** Duration of one iteration. */
  get iterationDuration() { return this.children.reduce((m, c) => Math.max(m, c.start + c.duration), 0); }
  get duration() {
    const r = this.opts.repeat ?? 0;
    if (r === Infinity) return Infinity;
    return this.iterationDuration * (r + 1) + (this.opts.repeatDelay ?? 0) * r;
  }

  private resolvePos(pos?: number | string): number {
    if (pos === undefined) return this.cursor;
    if (typeof pos === "number") return pos;
    const m = /^([<>])?([a-zA-Z_][\w-]*)?([+-]=[\d.]+)?$/.exec(pos);
    if (!m) return this.cursor;
    let base = this.cursor;
    if (m[2] && this.labels.has(m[2])) base = this.labels.get(m[2])!;
    else if (m[1] === "<") base = this.children.length ? this.children[this.children.length - 1].start : 0;
    if (m[3]) base += (m[3][0] === "-" ? -1 : 1) * parseFloat(m[3].slice(2));
    return base;
  }

  to(target: Target, prop: string, vars: TweenVars, position?: number | string) {
    const at = this.resolvePos(position);
    const tw = new TweenChild(target, prop, vars, at);
    this.children.push(tw);
    this.cursor = Math.max(this.cursor, tw.start + tw.duration);
    return this;
  }
  fromTo(target: Target, prop: string, from: number | string, vars: TweenVars, position?: number | string) {
    return this.to(target, prop, { ...vars, from }, position);
  }
  keyframes(target: Target, prop: string, frames: { t: number; value: number; ease?: string }[], position?: number | string) {
    const at = this.resolvePos(position);
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i];
      this.children.push(new TweenChild(target, prop, { from: a.value, to: b.value, duration: b.t - a.t, ease: b.ease }, at + a.t));
    }
    this.cursor = Math.max(this.cursor, at + (frames[frames.length - 1]?.t ?? 0));
    return this;
  }
  stagger(targets: Target[], prop: string, vars: TweenVars & { each?: number; from?: number | string }, position?: number | string, order: "start" | "end" | "center" | "random" = "start") {
    const at = this.resolvePos(position);
    const each = vars.each ?? 0.05;
    const n = targets.length;
    const idx = targets.map((_, i) => {
      if (order === "end") return n - 1 - i;
      if (order === "center") return Math.abs(i - (n - 1) / 2);
      if (order === "random") return ((i * 7919) % n);
      return i;
    });
    targets.forEach((t, i) => this.to(t, prop, { ...vars, delay: (vars.delay ?? 0) + idx[i] * each }, at));
    return this;
  }
  add(child: Timeline, position?: number | string) {
    child.start = this.resolvePos(position);
    this.children.push(child);
    this.cursor = Math.max(this.cursor, child.start + child.duration);
    return this;
  }
  /** Parallel: nest several timelines starting at the same position. */
  parallel(children: Timeline[], position?: number | string) {
    const at = this.resolvePos(position);
    children.forEach((c) => this.add(c, at));
    return this;
  }
  /** Sequence: nest timelines one after another. */
  sequence(children: Timeline[], gap = 0) {
    children.forEach((c) => this.add(c, this.cursor + gap));
    return this;
  }
  addLabel(name: string, position?: number | string) { this.labels.set(name, this.resolvePos(position)); return this; }
  getLabel(name: string) { return this.labels.get(name); }
  addMarker(label: string, time?: number) { this.markers.push({ label, time: time ?? this.cursor }); return this; }
  call(fn: () => void, position?: number | string) { this.children.push(new CallChild(this.resolvePos(position), fn)); return this; }

  /** Map global time to iteration-local time honoring repeat & yoyo. */
  localTime(t: number) {
    const d = this.iterationDuration;
    if (d <= 0) return 0;
    const rd = this.opts.repeatDelay ?? 0;
    const r = this.opts.repeat ?? 0;
    const cycle = d + rd;
    let iter = Math.floor(t / cycle);
    if (r !== Infinity && iter > r) iter = r;
    let lt = t - iter * cycle;
    if (r !== Infinity && t >= this.duration) { lt = d; iter = r; }
    lt = Math.min(lt, d);
    const type = this.opts.repeatType ?? "loop";
    if ((type === "reverse" || type === "mirror") && iter % 2 === 1) lt = d - lt;
    return lt;
  }

  render(t: number, _prev?: number) {
    const lt = this.localTime(Math.max(0, t));
    const prev = this.lastLocal;
    // Render in start order so later tweens win on the same property.
    const sorted = lt >= prev ? this.children : [...this.children].reverse();
    for (const c of sorted) c.render(lt - c.start, prev - c.start);
    this.lastLocal = lt;
    this.opts.onUpdate?.(t);
  }
  seek(t: number) {
    this.time = t;
    this.render(t);
    return this;
  }
  progress(p: number) { return this.seek(p * (Number.isFinite(this.duration) ? this.duration : this.iterationDuration)); }
  reverse() { this.opts.repeatType = this.opts.repeatType === "reverse" ? "loop" : "reverse"; return this; }

  /* Real-time playback (browser only). Rendering stays deterministic: the clock only picks t. */
  play() {
    if (typeof window === "undefined" || this.playing) return this;
    this.playing = true;
    let last = performance.now();
    const tick = (now: number) => {
      if (!this.playing) return;
      this.time += ((now - last) / 1000) * (this.opts.timeScale ?? 1);
      last = now;
      this.seek(this.time);
      if (this.time >= this.duration) { this.playing = false; this.opts.onComplete?.(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    return this;
  }
  pause() { this.playing = false; if (typeof window !== "undefined") cancelAnimationFrame(this.raf); return this; }
  restart() { this.pause(); this.time = 0; this.lastLocal = -1e-9; this.seek(0); return this.play(); }
  get isPlaying() { return this.playing; }
}

export const timeline = (opts?: TimelineOptions) => new Timeline(opts);

/** Convert between frames and seconds. */
export const toFrames = (s: number, fps: number) => Math.round(s * fps);
export const toSeconds = (f: number, fps: number) => f / fps;

/* --- Additional timeline evaluation functions from ZIP1 --- */
import type { Composition as Zip1Composition, MotionElement as Zip1MotionElement, RenderedNodeState as Zip1RenderedNodeState, EaseName as Zip1EaseName } from '@/core/types';

export function findNode(composition: Zip1Composition, id: string): Zip1MotionElement | null {
  for (const scene of composition.scenes) {
    const search = (nodes: Zip1MotionElement[]): Zip1MotionElement | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
          const found = search(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    const found = search(scene.nodes as any);
    if (found) return found;
  }
  return null;
}

export function getActiveScene(composition: Zip1Composition, frame: number) {
  let current = 0;
  for (const scene of composition.scenes) {
    const start = scene.startFrame ?? current;
    const end = start + scene.durationInFrames;
    if (frame >= start && frame < end) {
      return { scene, localFrame: frame - start };
    }
    current += scene.durationInFrames;
  }
  return { scene: composition.scenes[0], localFrame: 0 };
}

export function evaluateNode(element: any, composition: Zip1Composition, frame: number): Zip1RenderedNodeState {
  const defaultTransform = {
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    opacity: 1,
    blur: 0,
  };
  return {
    transform: { ...defaultTransform, ...(element.transform || {}) },
    style: element.style || {},
    props: element.props || {},
    visible: !element.hidden,
  };
}
