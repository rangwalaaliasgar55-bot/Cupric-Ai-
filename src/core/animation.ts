/* Node motion evaluation (entrance / exit / loop / keyframes) + engine-agnostic animate() API. */
import { clamp, getEase, hashString, lerp, springValue, SPRING_PRESETS, type SpringConfig } from "./math";
import type { AnimationConfig, SceneNode } from "./types";
import { getMotionPreset, identityState, type MotionState, type PresetOpts } from "@/motion/presets";

let reducedMotion = false;
export function setReducedMotion(v: boolean) { reducedMotion = v; }
export function isReducedMotion() { return reducedMotion; }

function springOf(s: AnimationConfig["spring"]): SpringConfig | undefined {
  if (!s) return undefined;
  return typeof s === "string" ? SPRING_PRESETS[s] : s;
}

export function presetDuration(cfg?: AnimationConfig) {
  if (!cfg) return 0;
  return cfg.duration ?? getMotionPreset(cfg.preset)?.duration ?? 20;
}

/** Evaluate an entrance-type preset at a given local frame. Returns p (can overshoot) and state delta. */
export function entranceProgress(cfg: AnimationConfig, frame: number, fps: number): number {
  const preset = getMotionPreset(cfg.preset);
  if (!preset) return 1;
  const dur = presetDuration(cfg);
  const t = frame - (cfg.delay ?? 0);
  if (t <= 0) return 0;
  const sp = springOf(cfg.spring) ?? (preset.spring ? SPRING_PRESETS[preset.spring] : undefined);
  if (sp) return springValue(t / fps, sp);
  const lin = clamp(t / Math.max(1, dur));
  return getEase(cfg.ease ?? preset.ease)(lin);
}

export function applyDelta(s: MotionState, d: Partial<MotionState>) {
  if (d.x) s.x += d.x;
  if (d.y) s.y += d.y;
  if (d.scale !== undefined) s.scale *= d.scale;
  if (d.scaleX !== undefined) s.scaleX *= d.scaleX;
  if (d.scaleY !== undefined) s.scaleY *= d.scaleY;
  if (d.rotate) s.rotate += d.rotate;
  if (d.rotateX) s.rotateX += d.rotateX;
  if (d.rotateY) s.rotateY += d.rotateY;
  if (d.skewX) s.skewX += d.skewX;
  if (d.opacity !== undefined) s.opacity *= clamp(d.opacity);
  if (d.blur) s.blur += Math.max(0, d.blur);
  if (d.brightness !== undefined) s.brightness *= d.brightness;
  if (d.rgbSplit) s.rgbSplit += d.rgbSplit;
  if (d.glitch) s.glitch = Math.max(s.glitch, d.glitch);
  if (d.clip) s.clip = d.clip;
}

export function presetDelta(cfg: AnimationConfig, p: number, seed: number): Partial<MotionState> {
  const preset = getMotionPreset(cfg.preset);
  if (!preset || preset.kind !== "entrance") return {};
  const o: PresetOpts = { d: cfg.distance ?? 60, i: cfg.intensity ?? 1, seed };
  if (reducedMotion) return { opacity: clamp(p) };
  return (preset.fn as (p: number, o: PresetOpts) => Partial<MotionState>)(p, o);
}

export function loopDelta(cfg: AnimationConfig, frame: number, fps: number, seed: number): Partial<MotionState> {
  if (reducedMotion) return {};
  const preset = getMotionPreset(cfg.preset);
  if (!preset || preset.kind !== "loop") return {};
  const o: PresetOpts = { d: cfg.distance ?? 60, i: cfg.intensity ?? 1, seed };
  const t = ((frame - (cfg.delay ?? 0)) / fps) * (cfg.speed ?? 1);
  return (preset.fn as (t: number, o: PresetOpts) => Partial<MotionState>)(t, o);
}

function keyframeValue(frames: { frame: number; value: number; ease?: string }[], f: number) {
  if (!frames.length) return undefined;
  if (f <= frames[0].frame) return frames[0].value;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (f <= b.frame) return lerp(a.value, b.value, getEase(b.ease ?? "easeInOutCubic")((f - a.frame) / Math.max(1, b.frame - a.frame)));
  }
  return frames[frames.length - 1].value;
}

export type ResolvedNode = MotionState & { visible: boolean; local: number; enterP: number };

/** Resolve a node's absolute animated state at scene-local frame. Pure. */
export function evaluateNode(node: SceneNode, sceneFrame: number, fps: number): ResolvedNode {
  const local = sceneFrame - node.timing.start;
  const s = identityState() as ResolvedNode;
  s.local = local;
  s.visible = !node.hidden && local >= 0 && local < node.timing.duration;
  s.enterP = 1;
  if (!s.visible) return s;
  const seed = hashString(node.id) % 1000;
  const tr = node.transform;
  s.x = tr.x ?? 0; s.y = tr.y ?? 0; s.scale = tr.scale ?? 1; s.rotate = tr.rotate ?? 0; s.rotateX = tr.rotateX ?? 0; s.rotateY = tr.rotateY ?? 0;
  s.opacity = tr.opacity ?? 1; s.blur = tr.blur ?? 0;
  for (const track of node.keyframes ?? []) {
    const v = keyframeValue(track.keyframes as any, local);
    if (v !== undefined) (s as unknown as Record<string, number>)[track.property] = v;
  }
  if (node.enter) {
    const p = entranceProgress(node.enter, local, fps);
    s.enterP = p;
    if (p < 0.9999 || Math.abs(p - 1) > 1e-4) applyDelta(s, presetDelta(node.enter, p, seed));
  }
  if (node.exit) {
    const dur = presetDuration(node.exit);
    const startExit = node.timing.duration - dur;
    if (local >= startExit) {
      const lin = clamp((local - startExit) / Math.max(1, dur));
      const preset = getMotionPreset(node.exit.preset);
      const p = 1 - getEase(node.exit.ease ?? preset?.ease ?? "easeInCubic")(lin);
      applyDelta(s, presetDelta(node.exit, p, seed + 1));
    }
  }
  if (node.loop) applyDelta(s, loopDelta(node.loop, local, fps, seed));
  return s;
}

/* ---------------- Universal animate() with swappable engines ---------------- */
export type AnimateEngine = "native" | "motion";
export type AnimateOptions = {
  target: Record<string, unknown> | HTMLElement;
  property: string;
  from: number;
  to: number;
  duration: number; // seconds
  delay?: number;
  easing?: string;
  spring?: string | SpringConfig;
  repeat?: number;
  repeatType?: "loop" | "reverse" | "mirror";
  engine?: AnimateEngine;
  unit?: string;
  onUpdate?: (v: number) => void;
  onStart?: () => void;
  onComplete?: () => void;
};
export type AnimationControls = { stop: () => void; finished: Promise<void> };

function applyValue(target: AnimateOptions["target"], prop: string, v: number, unit = "") {
  if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement) {
    if (prop in target.style) (target.style as unknown as Record<string, string>)[prop] = `${v}${unit}`;
    else target.style.setProperty(prop, `${v}${unit}`);
  } else (target as Record<string, unknown>)[prop] = v;
}

/** Engine-agnostic animation. Components call this; the backend can be swapped. */
export function animate(o: AnimateOptions): AnimationControls {
  const engine = o.engine ?? "native";
  if (engine === "motion" && typeof window !== "undefined" && typeof HTMLElement !== "undefined" && o.target instanceof HTMLElement) {
    let stopFn = () => {};
    const finished = import("motion").then(async (m) => {
      o.onStart?.();
      const ctl = m.animate(o.target as HTMLElement, { [o.property]: [`${o.from}${o.unit ?? ""}`, `${o.to}${o.unit ?? ""}`] } as never, {
        duration: o.duration, delay: o.delay, repeat: o.repeat, repeatType: o.repeatType,
        ease: o.spring ? undefined : (t: number) => getEase(o.easing)(t),
        ...(o.spring ? { type: "spring", ...(typeof o.spring === "string" ? SPRING_PRESETS[o.spring] : o.spring) } : {}),
      } as never);
      stopFn = () => ctl.stop();
      await ctl;
      o.onComplete?.();
    });
    return { stop: () => stopFn(), finished };
  }
  // Native deterministic engine.
  let raf = 0, stopped = false;
  const finished = new Promise<void>((resolve) => {
    if (typeof window === "undefined") { applyValue(o.target, o.property, o.to, o.unit); resolve(); return; }
    const sp = typeof o.spring === "string" ? SPRING_PRESETS[o.spring] : o.spring;
    const ease = getEase(o.easing);
    const start = performance.now() + (o.delay ?? 0) * 1000;
    let begun = false;
    const iter = (o.repeat ?? 0) + 1;
    const tick = (now: number) => {
      if (stopped) return resolve();
      const t = (now - start) / 1000;
      if (t < 0) { raf = requestAnimationFrame(tick); return; }
      if (!begun) { begun = true; o.onStart?.(); }
      const n = Math.floor(t / o.duration);
      let lt = (t % o.duration) / o.duration;
      if (n >= iter && iter !== Infinity) lt = 1;
      const rev = o.repeatType && o.repeatType !== "loop" && n % 2 === 1;
      const p = rev ? 1 - lt : lt;
      const e = sp ? springValue(p * o.duration, sp) : ease(p);
      const v = lerp(o.from, o.to, e);
      applyValue(o.target, o.property, v, o.unit);
      o.onUpdate?.(v);
      if (n >= iter && iter !== Infinity) { o.onComplete?.(); return resolve(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
  return { stop: () => { stopped = true; if (typeof window !== "undefined") cancelAnimationFrame(raf); }, finished };
}
