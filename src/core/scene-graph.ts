/* Scene graph helpers: construction, timing, addressable paths, mutations, serialization + validation. */
import { z } from "zod";
import type { SceneNode, Scene, VideoDoc, AnimationConfig } from "./types";

export const NODE_TYPES = ["text", "shape", "background", "shader", "particles", "ui", "chart", "device", "image", "logo", "three", "physics", "caption", "group", "effect"] as const;

let counter = 0;
export function uid(prefix = "n") {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function createNode(type: string, props: Record<string, unknown>, o: Partial<Omit<SceneNode, "type" | "props">> & { x?: number; y?: number } = {}): SceneNode {
  const { x, y, ...rest } = o;
  return {
    id: rest.id ?? uid(type.slice(0, 3)),
    type,
    name: rest.name ?? type,
    props,
    transform: rest.transform ?? { x: x ?? 960, y: y ?? 540 },
    timing: rest.timing ?? { start: 0, duration: 150 },
    ...(rest.enter ? { enter: rest.enter } : {}),
    ...(rest.exit ? { exit: rest.exit } : {}),
    ...(rest.loop ? { loop: rest.loop } : {}),
    ...(rest.keyframes ? { keyframes: rest.keyframes } : {}),
    ...(rest.effects ? { effects: rest.effects } : {}),
    ...(rest.children ? { children: rest.children } : {}),
  };
}

export function createScene(name: string, durationInFrames: number, nodes: SceneNode[], o: Partial<Scene> = {}): Scene {
  return { id: o.id ?? uid("sc"), name, type: o.type ?? "custom", durationInFrames, nodes, ...(o.transition ? { transition: o.transition } : {}), ...(o.effects ? { effects: o.effects } : {}) };
}

export function createDoc(o: Partial<VideoDoc> & { scenes: Scene[] }): VideoDoc {
  return { version: 1, id: o.id ?? uid("doc"), name: o.name ?? "Untitled", width: o.width ?? 1920, height: o.height ?? 1080, fps: o.fps ?? 30, theme: o.theme ?? "midnight", scenes: o.scenes, effects: o.effects ?? [], audio: o.audio ?? [], captions: o.captions ?? [], markers: o.markers ?? [], seed: o.seed ?? 7, ...(o.background ? { background: o.background } : {}), ...(o.meta ? { meta: o.meta } : {}) };
}

/* ---------- Timing ---------- */
export type SceneSpan = { scene: Scene; index: number; start: number; end: number; transitionIn: number };
export function sceneSpans(doc: VideoDoc): SceneSpan[] {
  const spans: SceneSpan[] = [];
  let cursor = 0;
  const visible = doc.scenes.filter((s) => !s.hidden);
  visible.forEach((scene, index) => {
    const tIn = index === 0 ? 0 : Math.min(scene.transition?.duration ?? 0, scene.durationInFrames, visible[index - 1].durationInFrames);
    const start = cursor - tIn;
    spans.push({ scene, index, start, end: start + scene.durationInFrames, transitionIn: tIn });
    cursor = start + scene.durationInFrames;
  });
  return spans;
}
export function docDuration(doc: VideoDoc): number {
  const s = sceneSpans(doc);
  return Math.max(1, s.length ? s[s.length - 1].end : 1);
}

/* ---------- Addressable scene graph ---------- */
export class SceneGraph {
  constructor(public doc: VideoDoc) {}
  private sceneKey(s: Scene) { return slug(s.name) || s.id; }
  private nodeKey(n: SceneNode) { return slug(n.name ?? "") || n.id; }
  /** Paths: "scene", "scene.node", "scene.node.child" using slugged names or ids. Also "camera.main" style lookups by name across scenes. */
  get(path: string): Scene | SceneNode | undefined {
    const parts = path.split(".");
    const scene = this.doc.scenes.find((s) => s.id === parts[0] || this.sceneKey(s) === parts[0]);
    if (!scene) return this.findByName(path);
    if (parts.length === 1) return scene;
    let list: SceneNode[] | undefined = scene.nodes;
    let node: SceneNode | undefined;
    for (const p of parts.slice(1)) {
      node = list?.find((n) => n.id === p || this.nodeKey(n) === p);
      if (!node) return undefined;
      list = node.children;
    }
    return node;
  }
  findByName(name: string): SceneNode | undefined {
    const key = slug(name.replace(/\./g, "-"));
    return this.nodes().find((n) => this.nodeKey(n) === key || n.id === name);
  }
  nodes(): SceneNode[] {
    const out: SceneNode[] = [];
    const walk = (l: SceneNode[]) => l.forEach((n) => { out.push(n); if (n.children) walk(n.children); });
    this.doc.scenes.forEach((s) => walk(s.nodes));
    return out;
  }
  paths(): string[] {
    const out: string[] = [];
    for (const s of this.doc.scenes) {
      out.push(this.sceneKey(s));
      const walk = (l: SceneNode[], pre: string) => l.forEach((n) => { const p = `${pre}.${this.nodeKey(n)}`; out.push(p); if (n.children) walk(n.children, p); });
      walk(s.nodes, this.sceneKey(s));
    }
    return out;
  }
  sceneOf(nodeId: string): Scene | undefined {
    return this.doc.scenes.find((s) => JSON.stringify(s.nodes).includes(`"id":"${nodeId}"`));
  }
}

export function mapNodes(doc: VideoDoc, fn: (n: SceneNode, scene: Scene) => SceneNode): VideoDoc {
  const walk = (l: SceneNode[], s: Scene): SceneNode[] => l.map((n) => { const m = fn(n, s); return m.children ? { ...m, children: walk(m.children, s) } : m; });
  return { ...doc, scenes: doc.scenes.map((s) => ({ ...s, nodes: walk(s.nodes, s) })) };
}
export function updateNode(doc: VideoDoc, id: string, patch: (n: SceneNode) => SceneNode): VideoDoc {
  return mapNodes(doc, (n) => (n.id === id ? patch(n) : n));
}
export function updateScene(doc: VideoDoc, id: string, patch: (s: Scene) => Scene): VideoDoc {
  return { ...doc, scenes: doc.scenes.map((s) => (s.id === id ? patch(s) : s)) };
}
export function removeNode(doc: VideoDoc, id: string): VideoDoc {
  const walk = (l: SceneNode[]): SceneNode[] => l.filter((n) => n.id !== id).map((n) => (n.children ? { ...n, children: walk(n.children) } : n));
  return { ...doc, scenes: doc.scenes.map((s) => ({ ...s, nodes: walk(s.nodes) })) };
}
export function cloneWithNewIds<T>(v: T): T {
  const json = JSON.stringify(v);
  const map = new Map<string, string>();
  return JSON.parse(json, (k, val) => {
    if (k === "id" && typeof val === "string") { if (!map.has(val)) map.set(val, uid(val.split("_")[0] || "n")); return map.get(val); }
    return val;
  }) as T;
}
/** Split a node at a scene-local frame into two nodes. */
export function splitNode(doc: VideoDoc, id: string, atFrame: number): VideoDoc {
  let out = doc;
  for (const s of doc.scenes) {
    const idx = s.nodes.findIndex((n) => n.id === id);
    if (idx < 0) continue;
    const n = s.nodes[idx];
    const rel = atFrame - n.timing.start;
    if (rel <= 1 || rel >= n.timing.duration - 1) return doc;
    const a: SceneNode = { ...n, timing: { start: n.timing.start, duration: rel }, exit: undefined };
    const b: SceneNode = { ...cloneWithNewIds(n), name: `${n.name ?? n.type} (2)`, timing: { start: atFrame, duration: n.timing.duration - rel }, enter: undefined };
    const nodes = [...s.nodes];
    nodes.splice(idx, 1, a, b);
    out = updateScene(doc, s.id, (sc) => ({ ...sc, nodes }));
  }
  return out;
}

/* ---------- Security: URL sanitization ---------- */
export function sanitizeUrl(url: unknown): string {
  if (typeof url !== "string") return "";
  const u = url.trim();
  if (!u) return "";
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(u)) return u;
  if (/^data:audio\/(mpeg|wav|ogg|mp4|webm);base64,/i.test(u)) return u;
  if (/^blob:/i.test(u)) return u;
  try {
    const p = new URL(u);
    if (p.protocol === "https:") return p.toString();
  } catch { /* invalid */ }
  return "";
}

/* ---------- Validation schemas (Zod) ---------- */
const num = z.number().finite();
const anim: z.ZodType<AnimationConfig> = z.object({
  preset: z.string().max(64), duration: num.optional(), delay: num.optional(), ease: z.string().max(80).optional(),
  spring: z.union([z.string().max(32), z.object({ stiffness: num.optional(), damping: num.optional(), mass: num.optional(), velocity: num.optional() })]).optional(),
  intensity: num.optional(), distance: num.optional(), speed: num.optional(), stagger: num.optional(),
});
const effect = z.object({ id: z.string().optional(), type: z.string().max(64), params: z.record(z.string(), z.unknown()).optional(), enabled: z.boolean().optional() });
const nodeSchema: z.ZodType<SceneNode> = z.lazy(() =>
  z.object({
    id: z.string().max(80), type: z.enum(NODE_TYPES), name: z.string().max(120).optional(),
    props: z.record(z.string(), z.unknown()),
    transform: z.object({ x: num, y: num, scale: num.optional(), rotate: num.optional(), rotateX: num.optional(), rotateY: num.optional(), opacity: num.optional(), blur: num.optional() }),
    timing: z.object({ start: num, duration: num.positive() }),
    enter: anim.optional(), exit: anim.optional(), loop: anim.optional(),
    keyframes: z.array(z.object({ property: z.enum(["x", "y", "scale", "rotate", "opacity", "blur", "rotateX", "rotateY"]), keyframes: z.array(z.object({ frame: num, value: num, ease: z.string().optional() })) })).optional(),
    effects: z.array(effect).optional(), hidden: z.boolean().optional(), locked: z.boolean().optional(),
    children: z.array(nodeSchema).optional(),
  }),
);
export const docSchema = z.object({
  version: z.literal(1), id: z.string().max(80), name: z.string().max(200),
  width: z.number().int().min(16).max(7680), height: z.number().int().min(16).max(7680), fps: z.number().min(1).max(120),
  theme: z.string().max(64), background: z.string().max(64).optional(),
  scenes: z.array(z.object({
    id: z.string().max(80), name: z.string().max(120), type: z.string().max(32), durationInFrames: z.number().int().positive().max(60 * 60 * 120),
    transition: z.object({ type: z.string().max(64), duration: num.min(0), params: z.record(z.string(), z.unknown()).optional() }).optional(),
    nodes: z.array(nodeSchema), effects: z.array(effect).optional(), hidden: z.boolean().optional(),
  })).max(500),
  effects: z.array(effect).optional(),
  audio: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["music", "voiceover", "sfx"]), src: z.string().optional(), generator: z.object({ type: z.literal("beat"), bpm: num, key: num.optional() }).optional(), start: num, trimStart: num.optional(), duration: num.optional(), volume: num, fadeIn: num.optional(), fadeOut: num.optional(), loop: z.boolean().optional(), muted: z.boolean().optional() })).optional(),
  captions: z.array(z.object({ id: z.string(), style: z.string(), cues: z.array(z.object({ start: num, end: num, text: z.string().max(2000), speaker: z.string().optional() })), props: z.record(z.string(), z.unknown()).optional(), hidden: z.boolean().optional() })).optional(),
  markers: z.array(z.object({ frame: num, label: z.string().max(80), color: z.string().optional() })).optional(),
  seed: num.optional(), meta: z.record(z.string(), z.unknown()).optional(),
});

const URL_KEYS = new Set(["src", "url", "image", "logo", "model", "screenshot", "avatar"]);
function sanitizeDeep(v: unknown, key = ""): unknown {
  if (typeof v === "string") return URL_KEYS.has(key) ? sanitizeUrl(v) : v.slice(0, 20000);
  if (Array.isArray(v)) return v.slice(0, 5000).map((x) => sanitizeDeep(x));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) { if (k === "__proto__" || k === "constructor" || k === "prototype") continue; if (typeof val === "function") continue; o[k] = sanitizeDeep(val, k); }
    return o;
  }
  return v;
}

export type ImportResult = { ok: true; doc: VideoDoc } | { ok: false; errors: string[] };
/** Validate untrusted JSON (never executes code). */
export function importDoc(input: string | unknown): ImportResult {
  let raw: unknown = input;
  if (typeof input === "string") {
    if (input.length > 5_000_000) return { ok: false, errors: ["File too large (max 5MB)"] };
    try { raw = JSON.parse(input); } catch (e) { return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] }; }
  }
  const candidate = raw && typeof raw === "object" && "doc" in (raw as Record<string, unknown>) ? (raw as Record<string, unknown>).doc : raw;
  const parsed = docSchema.safeParse(sanitizeDeep(candidate));
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`) };
  return { ok: true, doc: parsed.data as VideoDoc };
}
export function exportDoc(doc: VideoDoc, meta?: Record<string, unknown>): string {
  return JSON.stringify({ format: "motionos.template", version: 1, exportedAt: new Date().toISOString(), meta: meta ?? doc.meta ?? {}, doc }, null, 2);
}
