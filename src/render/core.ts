/* Shared render infrastructure for the deterministic canvas compositor. */
import type { Theme } from "@/themes";
import type { Quality, SceneNode, VideoDoc } from "@/core/types";
import type { ResolvedNode } from "@/core/animation";
import { sanitizeUrl } from "@/core/scene-graph";
import { mixColor, withAlpha } from "@/core/math";

export type Ctx2D = CanvasRenderingContext2D;
export type AudioFeatures = { amplitude: number; bass: number; mid: number; treble: number; beat: number };

export type RenderContext = {
  ctx: Ctx2D;
  doc: VideoDoc;
  theme: Theme;
  w: number;
  h: number;
  fps: number;
  frame: number; // scene-local frame
  globalFrame: number;
  quality: Exclude<Quality, "auto">;
  audio: AudioFeatures;
  requestRedraw: () => void;
};

/** Node renderers draw centered at the origin; the compositor applies transform/opacity/filters. */
export type NodeRenderer = (rc: RenderContext, node: SceneNode, state: ResolvedNode) => void;
export type NodeBounds = (node: SceneNode, rc: { w: number; h: number }) => { w: number; h: number };

const renderers = new Map<string, { draw: NodeRenderer; bounds: NodeBounds; fullscreen?: boolean }>();
export function registerNodeRenderer(type: string, draw: NodeRenderer, bounds: NodeBounds, fullscreen = false) {
  renderers.set(type, { draw, bounds, fullscreen });
}
export function getNodeRenderer(type: string) { return renderers.get(type); }
export function nodeTypes() { return [...renderers.keys()]; }

export const QUALITY_SCALE: Record<Exclude<Quality, "auto">, number> = { low: 0.35, medium: 0.65, high: 1, ultra: 1.5 };
export function resolveQuality(q?: Quality): Exclude<Quality, "auto"> {
  if (!q || q === "auto") {
    if (typeof navigator === "undefined") return "high";
    const cores = navigator.hardwareConcurrency ?? 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    if (cores <= 2 || mem <= 2) return "low";
    if (cores <= 4 || mem <= 4) return "medium";
    return "high";
  }
  return q;
}

/* ---------- Canvas pool ---------- */
const pool = new Map<string, HTMLCanvasElement>();
export function getCanvas(key: string, w: number, h: number): HTMLCanvasElement {
  let c = pool.get(key);
  if (!c) { c = document.createElement("canvas"); pool.set(key, c); }
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  return c;
}
export function ctxOf(c: HTMLCanvasElement): Ctx2D {
  return c.getContext("2d", { willReadFrequently: false }) as Ctx2D;
}

/* ---------- Image cache ---------- */
const images = new Map<string, HTMLImageElement | "error">();
const listeners = new Set<() => void>();
export function onAssetLoaded(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getImage(url: unknown): HTMLImageElement | undefined {
  const u = sanitizeUrl(url);
  if (!u || typeof window === "undefined") return undefined;
  const hit = images.get(u);
  if (hit === "error") return undefined;
  if (hit) return hit.complete && hit.naturalWidth ? hit : undefined;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => listeners.forEach((f) => f());
  img.onerror = () => { images.set(u, "error"); };
  img.src = u;
  images.set(u, img);
  return undefined;
}
export function loadImage(url: string): Promise<void> {
  const u = sanitizeUrl(url);
  if (!u) return Promise.resolve();
  getImage(u);
  const img = images.get(u);
  if (!img || img === "error" || (img.complete && img.naturalWidth)) return Promise.resolve();
  return new Promise((res) => { img.addEventListener("load", () => res(), { once: true }); img.addEventListener("error", () => res(), { once: true }); });
}

/* ---------- Drawing helpers ---------- */
export function rr(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const R = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + R, y);
  ctx.arcTo(x + w, y, x + w, y + h, R);
  ctx.arcTo(x + w, y + h, x, y + h, R);
  ctx.arcTo(x, y + h, x, y, R);
  ctx.arcTo(x, y, x + w, y, R);
  ctx.closePath();
}
export function linearGrad(ctx: Ctx2D, colors: string[], x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const cs = colors.length ? colors : ["#fff"];
  cs.forEach((c, i) => g.addColorStop(cs.length === 1 ? 0 : i / (cs.length - 1), c));
  return g;
}
export function angleGrad(ctx: Ctx2D, colors: string[], cx: number, cy: number, w: number, h: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  const r = Math.hypot(w, h) / 2;
  return linearGrad(ctx, colors, cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
}
export function text(ctx: Ctx2D, s: string, x: number, y: number, o: { size: number; color: string; weight?: number; family?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; alpha?: number; maxW?: number }) {
  ctx.save();
  ctx.font = `${o.weight ?? 500} ${o.size}px ${o.family ?? "Inter, ui-sans-serif, system-ui, sans-serif"}`;
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = o.baseline ?? "middle";
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  let str = s;
  if (o.maxW && ctx.measureText(str).width > o.maxW) {
    while (str.length > 1 && ctx.measureText(str + "…").width > o.maxW) str = str.slice(0, -1);
    str += "…";
  }
  ctx.fillText(str, x, y);
  ctx.restore();
}
export function glowSprite(color: string, size = 64): HTMLCanvasElement {
  const key = `glow_${color}_${size}`;
  const existing = pool.get(key);
  if (existing) return existing;
  const c = getCanvas(key, size, size);
  const g = ctxOf(c);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, withAlpha(color, 0.6));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}
export const pick = <T,>(arr: T[], i: number) => arr[((i % arr.length) + arr.length) % arr.length];
export function p<T>(node: SceneNode, key: string, fallback: T): T {
  const v = node.props[key];
  return (v === undefined || v === null || v === "" ? fallback : v) as T;
}
export function colorsOf(node: SceneNode, theme: Theme, key = "colors"): string[] {
  const v = node.props[key];
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) return v as string[];
  return theme.gradient;
}
export { mixColor, withAlpha };
