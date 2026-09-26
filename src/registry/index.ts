/* Registers every asset in the ecosystem into the universal registry with schema, defaults, capabilities,
 * performance budget, tags, preview builder and code snippet. This is what the gallery, docs, inspector and
 * AI agents consume. Import once (side effects). */
import { register, registryStats, allAssets } from "@/core/registry";
import { createDoc, createNode, createScene } from "@/core/scene-graph";
import type { AssetDef, AssetKind, PerfBudget, PropSchema, SceneNode, VideoDoc } from "@/core/types";
import { allMotionPresets } from "@/motion/presets";
import { TYPO_PRESETS } from "@/render/text";
import { SHAPES } from "@/render/shapes";
import { BACKGROUNDS } from "@/graphics/backgrounds";
import { SHADERS } from "@/effects/shaders";
import { PARTICLE_PRESETS } from "@/graphics/particles";
import { EFFECTS } from "@/effects/post";
import { TRANSITIONS } from "@/effects/transitions";
import { MATERIALS, LIGHTING, CAMERAS, OBJECTS, ANIMATIONS_3D, PHYSICS_PRESETS } from "@/three/renderer";
import { UI_KINDS, DEVICES } from "@/ui/canvas-ui";
import { CHARTS, CHART_ANIMATIONS } from "@/ui/charts";
import { LOGO_STYLES } from "@/render/nodes-extra";
import { CAPTION_STYLES } from "@/video/captions";
import { TEMPLATES, buildTemplate, setShaderIds, SCENE_BUILDERS, composeStory } from "@/video/templates";
import { allThemes, FONT_PRESETS } from "@/themes";
import { EASING_NAMES } from "@/core/math";
import "@/render/compositor";

setShaderIds(SHADERS);
const cap = (o: Partial<AssetDef["capabilities"]> = {}): AssetDef["capabilities"] => ({ browser: true, video: true, server: false, ...o });
const perf = (cpu: PerfBudget["cpu"], gpu: PerfBudget["gpu"] = "low", memory: PerfBudget["memory"] = "low"): PerfBudget => ({ cpu, gpu, memory });
const ENTRANCES = allMotionPresets().filter((p) => p.kind === "entrance").map((p) => p.id);
const LOOPS = allMotionPresets().filter((p) => p.kind === "loop").map((p) => p.id);
const AUDIO_BANDS = ["none", "amplitude", "bass", "mid", "treble", "beat"];

/* ---------- Node schemas (drive the automatic inspector) ---------- */
export const COMMON_BG: PropSchema = {
  colors: { type: "colors", default: ["#7c8cff", "#38bdf8", "#c084fc"], group: "Appearance" },
  speed: { type: "number", default: 0.6, min: 0, max: 5, step: 0.05, group: "Motion" },
  density: { type: "number", default: 1, min: 0.1, max: 3, step: 0.05, group: "Motion" },
  scale: { type: "number", default: 1, min: 0.2, max: 4, step: 0.05, group: "Appearance" },
  noise: { type: "number", default: 0.2, min: 0, max: 1, step: 0.01, group: "Appearance" },
  intensity: { type: "number", default: 0.8, min: 0, max: 2, step: 0.05, group: "Appearance" },
  opacity: { type: "number", default: 1, min: 0, max: 1, step: 0.01, group: "Appearance" },
  direction: { type: "number", default: 135, min: 0, max: 360, step: 1, group: "Motion" },
  blur: { type: "number", default: 0, min: 0, max: 80, step: 1, group: "Effects" },
  seed: { type: "number", default: 7, min: 0, max: 999, step: 1, group: "Advanced" },
  audioReactive: { type: "select", default: "none", options: AUDIO_BANDS, group: "Audio" },
};
export const NODE_SCHEMAS: Record<string, PropSchema> = {
  text: {
    text: { type: "text", default: "The future of AI.", multiline: true, group: "Typography" },
    animation: { type: "select", default: "wordBlurUp", options: Object.keys(TYPO_PRESETS), group: "Animation" },
    size: { type: "number", default: 96, min: 8, max: 400, step: 1, group: "Typography" },
    fontPreset: { type: "select", default: "SAAS", options: Object.keys(FONT_PRESETS), group: "Typography" },
    role: { type: "select", default: "display", options: ["display", "body", "mono"], group: "Typography" },
    weight: { type: "number", default: 700, min: 100, max: 900, step: 50, group: "Typography" },
    tracking: { type: "number", default: -0.03, min: -0.1, max: 0.5, step: 0.005, group: "Typography" },
    lineHeight: { type: "number", default: 1.05, min: 0.8, max: 2, step: 0.01, group: "Typography" },
    align: { type: "select", default: "center", options: ["left", "center", "right"], group: "Typography" },
    case: { type: "select", default: "none", options: ["none", "upper", "lower", "title"], group: "Typography" },
    fill: { type: "select", default: "solid", options: ["solid", "gradient", "chrome", "gold", "silver", "metallic", "holographic"], group: "Appearance" },
    color: { type: "color", default: "#f4f5f8", group: "Appearance" },
    colors: { type: "colors", default: ["#7c8cff", "#38bdf8", "#c084fc"], group: "Appearance" },
    stagger: { type: "number", default: 3, min: 0, max: 20, step: 0.5, group: "Animation" },
    intensity: { type: "number", default: 1, min: 0, max: 3, step: 0.05, group: "Animation" },
    maxWidth: { type: "number", default: 1500, min: 100, max: 4000, step: 10, group: "Typography" },
    highlightWords: { type: "text", default: "", group: "Typography" },
    audioReactive: { type: "select", default: "none", options: AUDIO_BANDS, group: "Audio" },
    audioTarget: { type: "select", default: "scale", options: ["scale", "rotation", "opacity", "position", "glow", "distortion"], group: "Audio" },
  },
  shape: {
    shape: { type: "select", default: "circle", options: [...SHAPES], group: "Shape" },
    w: { type: "number", default: 300, min: 4, max: 3000, group: "Shape" }, h: { type: "number", default: 300, min: 4, max: 3000, group: "Shape" },
    fillMode: { type: "select", default: "gradient", options: ["gradient", "solid", "none"], group: "Appearance" },
    colors: { type: "colors", default: ["#7c8cff", "#38bdf8"], group: "Appearance" },
    strokeWidth: { type: "number", default: 0, min: 0, max: 60, group: "Appearance" }, stroke: { type: "color", default: "#ffffff", group: "Appearance" },
    glow: { type: "boolean", default: false, group: "Appearance" },
    draw: { type: "select", default: "none", options: ["none", "stroke", "stroke-then-fill"], group: "Animation" }, drawDuration: { type: "number", default: 40, min: 1, max: 300, group: "Animation" },
    morphTo: { type: "select", default: "none", options: ["none", ...SHAPES.filter((s) => s !== "path")], group: "Animation" }, morphDuration: { type: "number", default: 40, min: 5, max: 200, group: "Animation" },
    noise: { type: "number", default: 0, min: 0, max: 0.8, step: 0.01, group: "Animation" }, speed: { type: "number", default: 0.6, min: 0, max: 5, step: 0.05, group: "Animation" },
    dash: { type: "number", default: 0, min: 0, max: 80, group: "Appearance" }, follower: { type: "boolean", default: false, group: "Animation" },
    sides: { type: "number", default: 6, min: 3, max: 16, group: "Shape" }, points: { type: "number", default: 5, min: 3, max: 24, group: "Shape" },
    path: { type: "text", default: "", group: "Shape" },
  },
  background: { variant: { type: "select", default: "mesh", options: Object.keys(BACKGROUNDS), group: "Background" }, ...COMMON_BG },
  shader: { shader: { type: "select", default: "liquid", options: Object.keys(SHADERS), group: "Shader" }, ...COMMON_BG },
  particles: { preset: { type: "select", default: "stars", options: Object.keys(PARTICLE_PRESETS), group: "Particles" }, count: { type: "number", default: 200, min: 1, max: 3000, group: "Particles" }, speed: { type: "number", default: 1, min: 0, max: 5, step: 0.05, group: "Particles" }, gravity: { type: "number", default: 0, min: -3, max: 3, step: 0.05, group: "Particles" }, turbulence: { type: "number", default: 0, min: 0, max: 3, step: 0.05, group: "Particles" }, trails: { type: "number", default: 0, min: 0, max: 1, step: 0.01, group: "Particles" }, glow: { type: "boolean", default: false, group: "Particles" }, colors: { type: "colors", default: ["#ffffff", "#c7d2fe"], group: "Appearance" }, intensity: { type: "number", default: 1, min: 0, max: 2, step: 0.05, group: "Appearance" }, seed: { type: "number", default: 7, min: 0, max: 999, group: "Advanced" }, audioReactive: { type: "select", default: "none", options: AUDIO_BANDS, group: "Audio" } },
  ui: { kind: { type: "select", default: "dashboard", options: Object.keys(UI_KINDS), group: "Component" }, title: { type: "text", default: "", group: "Content" }, brand: { type: "text", default: "Cupric", group: "Content" }, accent: { type: "color", default: "#7c8cff", group: "Appearance" }, speed: { type: "number", default: 1, min: 0.1, max: 4, step: 0.05, group: "Animation" }, animDelay: { type: "number", default: 0, min: 0, max: 300, group: "Animation" } },
  chart: { kind: { type: "select", default: "bar", options: Object.keys(CHARTS), group: "Chart" }, data: { type: "data", default: [12, 19, 14, 25, 22, 31, 28, 38], group: "Data" }, labels: { type: "list", default: [], group: "Data" }, title: { type: "text", default: "", group: "Data" }, animation: { type: "select", default: "stagger", options: [...CHART_ANIMATIONS, "none"], group: "Animation" }, duration: { type: "number", default: 1.6, min: 0.1, max: 10, step: 0.1, group: "Animation" }, colors: { type: "colors", default: ["#7c8cff", "#38bdf8"], group: "Appearance" }, w: { type: "number", default: 700, min: 100, max: 3000, group: "Size" }, h: { type: "number", default: 400, min: 60, max: 3000, group: "Size" }, card: { type: "boolean", default: false, group: "Appearance" }, value: { type: "number", default: 76, min: 0, max: 100000, group: "Data" } },
  device: { device: { type: "select", default: "iphone", options: Object.keys(DEVICES), group: "Device" }, screen: { type: "select", default: "chat", options: ["image", ...Object.keys(UI_KINDS)], group: "Device" }, screenSrc: { type: "url", default: "", group: "Device" }, frameColor: { type: "color", default: "#1c1d22", group: "Appearance" }, reflection: { type: "boolean", default: true, group: "Appearance" }, shadow: { type: "boolean", default: true, group: "Appearance" }, screenGlow: { type: "boolean", default: false, group: "Appearance" } },
  image: { src: { type: "url", default: "", group: "Image" }, w: { type: "number", default: 800, min: 10, max: 4000, group: "Size" }, h: { type: "number", default: 500, min: 10, max: 4000, group: "Size" }, radius: { type: "number", default: 16, min: 0, max: 400, group: "Appearance" }, fit: { type: "select", default: "cover", options: ["cover", "contain"], group: "Image" } },
  logo: { text: { type: "text", default: "Cupric", group: "Logo" }, style: { type: "select", default: "minimal", options: Object.keys(LOGO_STYLES), group: "Animation" }, mark: { type: "select", default: "spark", options: ["spark", "hex", "circle", "ring", "triangle", "diamond", "image", "none"], group: "Logo" }, src: { type: "url", default: "", group: "Logo" }, size: { type: "number", default: 120, min: 10, max: 500, group: "Logo" }, colors: { type: "colors", default: ["#7c8cff", "#38bdf8", "#c084fc"], group: "Appearance" }, tagline: { type: "text", default: "", group: "Logo" }, fontPreset: { type: "select", default: "SAAS", options: Object.keys(FONT_PRESETS), group: "Logo" } },
  three: { object: { type: "select", default: "torusKnot", options: [...OBJECTS], group: "3D" }, material: { type: "select", default: "glass", options: Object.keys(MATERIALS), group: "3D" }, color: { type: "color", default: "#7c8cff", group: "3D" }, lighting: { type: "select", default: "STUDIO", options: [...LIGHTING], group: "3D" }, camera: { type: "select", default: "PRODUCT", options: [...CAMERAS], group: "3D" }, animation: { type: "select", default: "heroFloat", options: [...ANIMATIONS_3D], group: "3D" }, speed: { type: "number", default: 1, min: 0, max: 5, step: 0.05, group: "3D" }, count: { type: "number", default: 1, min: 1, max: 400, group: "3D" }, layout: { type: "select", default: "ring", options: ["ring", "grid", "scatter"], group: "3D" }, envIntensity: { type: "number", default: 1, min: 0, max: 4, step: 0.05, group: "3D" }, ortho: { type: "boolean", default: false, group: "3D" }, floor: { type: "boolean", default: false, group: "3D" }, model: { type: "url", default: "", group: "3D" }, w: { type: "number", default: 900, min: 100, max: 3000, group: "Size" }, h: { type: "number", default: 700, min: 100, max: 3000, group: "Size" } },
  physics: { preset: { type: "select", default: "stack", options: [...PHYSICS_PRESETS], group: "Physics" }, count: { type: "number", default: 40, min: 4, max: 160, group: "Physics" }, material: { type: "select", default: "glossy", options: Object.keys(MATERIALS), group: "Physics" }, lighting: { type: "select", default: "STUDIO", options: [...LIGHTING], group: "Physics" }, w: { type: "number", default: 1000, min: 100, max: 3000, group: "Size" }, h: { type: "number", default: 700, min: 100, max: 3000, group: "Size" } },
};
export const ANIMATION_SCHEMA = { entrances: ENTRANCES, loops: LOOPS, easings: EASING_NAMES };

/* ---------- Preview doc helper ---------- */
export function previewDoc(nodes: SceneNode[], o: { theme?: string; seconds?: number; bg?: string; effects?: VideoDoc["effects"]; w?: number; h?: number } = {}): VideoDoc {
  const w = o.w ?? 1280, h = o.h ?? 720;
  const frames = Math.round((o.seconds ?? 4) * 30);
  const bg = o.bg === "none" ? [] : [createNode("background", { variant: o.bg ?? "radial", colors: ["#1b1f3a", "#0b0d16", "#07080c"], intensity: 0.9 }, { id: "bg", x: w / 2, y: h / 2, name: "background", timing: { start: 0, duration: frames } })];
  const fixed = nodes.map((n, i) => ({ ...n, id: n.id || `n${i}`, timing: { start: n.timing.start, duration: Math.min(n.timing.duration, frames - n.timing.start) } }));
  return createDoc({ id: "preview", name: "Preview", width: w, height: h, fps: 30, theme: o.theme ?? "midnight", scenes: [createScene("Preview", frames, [...bg, ...fixed], { id: "s1" })], effects: o.effects ?? [] });
}
const N = (type: string, props: Record<string, unknown>, extra: Partial<SceneNode> = {}, x = 640, y = 360, frames = 120): SceneNode => createNode(type, props, { id: `${type}_preview`, x, y, timing: { start: 0, duration: frames }, name: type, ...extra });
function reg(kind: AssetKind, category: string, id: string, name: string, description: string, tags: string[], schema: PropSchema, defaults: Record<string, unknown>, preview: () => VideoDoc, capabilities = cap(), performance = perf("low"), code?: string, node?: AssetDef["node"]) {
  register({ id: `${kind}:${id}`, name, kind, category, description, tags, schema, defaults, capabilities, performance, tier: "free", preview, code, node });
}

/* ---------- Registration ---------- */
for (const m of allMotionPresets()) {
  const isLoop = m.kind === "loop";
  const cfg = { preset: m.id, duration: m.duration };
  reg("motion", "motion", m.id, m.name, m.description, [m.kind, ...m.tags], { duration: { type: "number", default: m.duration, min: 1, max: 240 }, delay: { type: "number", default: 0, min: 0, max: 240 }, ease: { type: "select", default: m.ease, options: EASING_NAMES }, intensity: { type: "number", default: 1, min: 0, max: 3, step: 0.05 }, distance: { type: "number", default: 60, min: 0, max: 600 } }, cfg,
    () => previewDoc([N("shape", { shape: "roundedRect", w: 260, h: 260, radius: 48, colors: ["#7c8cff", "#38bdf8"] }, isLoop ? { loop: { preset: m.id } } : { enter: { preset: m.id, delay: 10 }, exit: { preset: m.id, duration: 16 }, timing: { start: 0, duration: 110 } })], { seconds: 4 }),
    cap({ server: true }), perf("low"), isLoop ? `node.loop = { preset: "${m.id}", intensity: 1 }` : `node.enter = { preset: "${m.id}", duration: ${m.duration}, ease: "${m.ease}" }`);
}
for (const t of Object.values(TYPO_PRESETS)) reg("typography", "typography", t.id, t.name, t.description, [t.split, ...t.tags], NODE_SCHEMAS.text, { animation: t.id }, () => previewDoc([N("text", { text: t.special === "counter" ? "2,480,000+" : t.special === "rotator" ? "Built for |teams|founders|creators" : "Motion, precisely.", animation: t.id, size: 104 })], { seconds: 4 }), cap(), perf(t.split === "char" ? "medium" : "low"), `<KineticText text="Motion, precisely." preset="${t.id}" />`);
for (const b of Object.values(BACKGROUNDS)) reg("background", "backgrounds", b.id, b.name, b.description, [b.group, ...b.tags], NODE_SCHEMAS.background, { variant: b.id }, () => previewDoc([N("background", { variant: b.id, colors: ["#7c8cff", "#38bdf8", "#c084fc"] })], { bg: "none" }), cap(), perf(["noise", "fractalNoise", "flowingNoise", "plasma", "metaballs", "voronoi", "topographic", "holographicBg", "iridescent", "checkerWarp", "fluidField"].includes(b.id) ? "high" : "low"), `<Background variant="${b.id}" colors={["#7c8cff","#38bdf8"]} speed={0.6} />`);
for (const s of Object.values(SHADERS)) reg("shader", "backgrounds", s.id, s.name, s.description, ["shader", "webgl", "gpu", ...s.tags], NODE_SCHEMAS.shader, { shader: s.id }, () => previewDoc([N("shader", { shader: s.id, colors: ["#0b0d16", "#7c8cff", "#38bdf8"] })], { bg: "none" }), cap({ webgl: true }), perf("low", "high", "low"), `<ShaderBackground preset="${s.id}" speed={0.6} />`);
for (const p of Object.values(PARTICLE_PRESETS)) reg("particles", "particles", p.id, p.name, p.description, ["particles", p.config.behavior, ...p.tags], NODE_SCHEMAS.particles, { preset: p.id }, () => previewDoc([N("particles", { preset: p.id })], { bg: "radial" }), cap(), perf(p.config.count > 500 || p.config.behavior === "flow" ? "high" : p.config.count > 200 ? "medium" : "low"), `<ParticleField preset="${p.id}" />`);
for (const fx of Object.values(EFFECTS)) reg("effect", "effects", fx.id, fx.name, fx.description, [fx.group, ...fx.tags], Object.fromEntries(Object.entries(fx.defaults).map(([k, v]) => [k, typeof v === "number" ? { type: "number" as const, default: v, min: 0, max: Math.max(1, v * 4), step: v < 2 ? 0.01 : 1 } : { type: "color" as const, default: String(v) }])), fx.defaults, () => previewDoc([N("background", { variant: "mesh" }, {}, 640, 360), N("text", { text: "Post FX", size: 150, animation: "blockFade" }), N("particles", { preset: "bokeh" })], { effects: [{ type: fx.id }] }), cap(), perf(fx.heavy ? "high" : "low"), `doc.effects.push({ type: "${fx.id}", params: ${JSON.stringify(fx.defaults)} })`);
for (const tr of Object.values(TRANSITIONS)) reg("transition", "transitions", tr.id, tr.name, tr.description, [tr.group, ...tr.tags], { duration: { type: "number", default: tr.duration, min: 1, max: 90 }, ease: { type: "select", default: tr.ease, options: EASING_NAMES } }, { duration: tr.duration }, () => { const sA = createScene("A", 60, [N("background", { variant: "mesh", colors: ["#7c8cff", "#1e1b4b"] }), N("text", { text: "Scene A", size: 140, animation: "blockFade" })], { id: "a" }); const sB = createScene("B", 75, [N("background", { variant: "aurora", colors: ["#f472b6", "#fb923c", "#facc15"] }, { id: "bg2" }), N("text", { text: "Scene B", size: 140, animation: "blockFade" }, { id: "t2" })], { id: "b", transition: { type: tr.id, duration: Math.max(14, tr.duration) } }); return createDoc({ id: "preview", name: tr.name, width: 1280, height: 720, fps: 30, theme: "midnight", scenes: [sA, sB] }); }, cap(), perf("medium"), `scene.transition = { type: "${tr.id}", duration: ${tr.duration} }`);
const threePreview = (props: Record<string, unknown>) => () => previewDoc([N("three", { w: 1000, h: 700, ...props })], { bg: "radial" });
for (const m of Object.values(MATERIALS)) reg("material", "3d", m.id, m.name, `${m.name} physically-based material.`, ["material", ...m.tags], NODE_SCHEMAS.three, { material: m.id }, threePreview({ material: m.id, object: m.id === "wireframe" ? "icosahedron" : "torusKnot", lighting: "STUDIO" }), cap({ three: true, webgl: true }), perf("low", "medium", "medium"), `<FloatingProduct object="torusKnot" material="${m.id}" />`);
for (const l of LIGHTING) reg("lighting", "3d", l, `${l.replace("_", " ")} Lighting`, `Reusable ${l.toLowerCase().replace("_", " ")} light rig.`, ["lighting", l.toLowerCase()], NODE_SCHEMAS.three, { lighting: l }, threePreview({ lighting: l, material: "glossy", object: "sphere", floor: true }), cap({ three: true, webgl: true }), perf("low", "medium"), `<Scene3D lighting="${l}" />`);
for (const c of CAMERAS) reg("camera", "3d", c, `${c} Camera`, `Deterministic ${c.toLowerCase()} camera move.`, ["camera", c.toLowerCase()], NODE_SCHEMAS.three, { camera: c }, threePreview({ camera: c, material: "chrome", object: "cube", count: 1 }), cap({ three: true, webgl: true }), perf("low", "medium"), `<Scene3D camera="${c}" />`);
for (const o of OBJECTS.filter((x) => x !== "gltf")) reg("three", "3d", `object-${o}`, `3D ${o}`, `Parametric ${o} object.`, ["3d", "object", o], NODE_SCHEMAS.three, { object: o }, threePreview({ object: o, material: "iridescent", lighting: "PRODUCT", animation: "turntable" }), cap({ three: true, webgl: true }), perf("low", "medium"), `<Model3D object="${o}" material="glass" animation="heroFloat" />`);
for (const a of ANIMATIONS_3D.filter((x) => x !== "none")) reg("three", "3d", `anim-${a}`, `3D ${a}`, `3D animation preset: ${a}.`, ["3d", "animation", a], NODE_SCHEMAS.three, { animation: a }, threePreview({ animation: a, object: a === "wave" || a === "explode" ? "cube" : "torus", count: a === "wave" ? 64 : a === "explode" ? 40 : 1, layout: a === "wave" ? "grid" : "scatter", material: "glossy", camera: a === "wave" ? "TECH" : "PRODUCT" }), cap({ three: true, webgl: true }), perf("medium", "medium"));
for (const ph of PHYSICS_PRESETS) reg("three", "3d", `physics-${ph}`, `Physics: ${ph}`, `Rapier rigid-body simulation (${ph}), deterministic & scrubbable.`, ["physics", "3d", ph], NODE_SCHEMAS.physics, { preset: ph }, () => previewDoc([N("physics", { preset: ph, w: 1100, h: 700 }, {}, 640, 360, 180)], { seconds: 6 }), cap({ three: true, webgl: true, physics: true }), perf("high", "medium", "medium"), `<PhysicsWorld preset="${ph}" />`);
for (const u of Object.values(UI_KINDS)) reg("ui", "components", u.id, u.name, u.description, ["ui", ...u.tags], NODE_SCHEMAS.ui, { kind: u.id }, () => previewDoc([N("ui", { kind: u.id }, { transform: { x: 640, y: 360, scale: Math.min(1100 / u.w, 620 / u.h, 1.6) }, enter: { preset: "saas" } }, 640, 360, 180)], { seconds: 6 }), cap({ server: true }), perf("low"), `<UIMotion kind="${u.id}" mode="video" />`);
for (const d of Object.values(DEVICES)) reg("device", "components", d.id, d.name, `${d.name} mockup that hosts any UI component or image.`, ["device", "mockup", ...d.tags], NODE_SCHEMAS.device, { device: d.id }, () => previewDoc([N("device", { device: d.id }, { transform: { x: 640, y: 360, scale: Math.min(1100 / d.w, 620 / d.h) }, loop: { preset: "levitate" } }, 640, 360, 180)], { seconds: 6 }), cap(), perf("low"), `<Device type="${d.id}"><Dashboard /></Device>`);
for (const c of Object.values(CHARTS)) reg("chart", "charts", c.id, c.name, c.description, ["chart", "data", ...c.tags], NODE_SCHEMAS.chart, { kind: c.id }, () => previewDoc([N("chart", { kind: c.id, w: 760, h: 420, labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Next"], data: [12, 19, 14, 25, 22, 31, 28, 38], title: "Weekly signups" })], { seconds: 4 }), cap({ server: true }), perf("low"), `<Chart kind="${c.id}" data={[12,19,14,25]} animation="stagger" />`);
for (const [id, l] of Object.entries(LOGO_STYLES)) reg("logo", "logos", id, `${l.name} Logo`, l.description, ["logo", ...l.tags], NODE_SCHEMAS.logo, { style: id }, () => previewDoc([N("logo", { style: id, text: "Cupric", size: 120 })], { seconds: 4 }), cap(), perf(id === "particle" ? "medium" : "low"), `<LogoReveal style="${id}" text="Cupric" />`);
for (const [id, c] of Object.entries(CAPTION_STYLES)) reg("caption", "video", `caption-${id}`, `${c.name} Captions`, c.description, ["captions", ...c.tags], { size: { type: "number", default: 48, min: 12, max: 160 }, y: { type: "number", default: 0.84, min: 0, max: 1, step: 0.01 }, accent: { type: "color", default: "#7c8cff" } }, {}, () => { const d = previewDoc([N("particles", { preset: "bokeh" })]); d.captions = [{ id: "c1", style: id, cues: [{ start: 0.2, end: 1.9, text: "Captions that move with the voice" }, { start: 1.9, end: 3.8, text: "and highlight every key word" }] }]; return d; }, cap({ server: true }), perf("low"));
for (const s of SHAPES) reg("shape", "motion", `shape-${s}`, `${s[0].toUpperCase()}${s.slice(1)} Shape`, `Morphable, drawable ${s}.`, ["shape", "vector", s], NODE_SCHEMAS.shape, { shape: s }, () => previewDoc([N("shape", { shape: s, w: 320, h: 320, strokeWidth: 6, stroke: "#ffffff", draw: "stroke-then-fill", drawDuration: 45, morphTo: s === "circle" ? "star" : "none", path: "M10 80 C 40 10, 65 10, 95 80 S 150 150, 180 80" })], { seconds: 4 }), cap({ server: true }), perf("low"));
for (const t of Object.values(TEMPLATES)) reg("template", "templates", t.id, t.name, t.description, [t.category.toLowerCase(), t.aspect === "9:16" ? "vertical" : t.aspect === "1:1" ? "square" : "horizontal", ...t.tags], { headline: { type: "text", default: t.defaults.headline ?? "" }, subtitle: { type: "text", default: t.defaults.subtitle ?? "" }, cta: { type: "text", default: t.defaults.cta ?? "" }, duration: { type: "number", default: t.duration, min: 3, max: 120 } }, { templateId: t.id }, () => buildTemplate(t.id, { brand: { name: "Cupric AI" } }), cap(), perf("medium", "medium", "medium"), `const doc = buildTemplate("${t.id}", { brand: { name: "Acme" }, aspect: "${t.aspect}" });`);
for (const [id, s] of Object.entries(SCENE_BUILDERS)) reg("node", "video", `scene-${id}`, `Story: ${s.name}`, s.description, ["story", "scene", s.type], {}, {}, () => composeStory([id], { duration: s.frames / 30 }), cap(), perf("medium"));
for (const th of allThemes()) reg("theme", "themes", th.id, th.name, `${th.name} design-token theme (${th.font.id} typography).`, ["theme", ...th.tags], {}, { theme: th.id }, () => buildTemplate("minimalLaunch", { theme: th.id, duration: 8 }), cap({ server: true }), perf("low"));

export function catalogCounts() {
  const s = registryStats();
  return { ...s, entranceMotion: ENTRANCES.length, loopMotion: LOOPS.length, chartAnimationVariants: Object.keys(CHARTS).length * CHART_ANIMATIONS.length };
}
export { allAssets };


/* --- Additional registry functions and asset methods from ZIP1 --- */
const zip1Assets = new Map<string, any>();

export function registerAsset(entry: any) {
  zip1Assets.set(entry.id, entry);
  return entry;
}

export const registerComponent = registerAsset;
export const registerEffect = registerAsset;
export const registerTransition = registerAsset;
export const registerBackground = registerAsset;
export const registerMaterial = registerAsset;
export const registerMotionPreset = registerAsset;
export const register3DPreset = registerAsset;
export const registerTemplate = registerAsset;

export function getAsset(id: string) {
  return zip1Assets.get(id) || (allAssets && (allAssets as any)[id]);
}

export const getMotionPreset = getAsset;
export const getComponentSchema = (id: string) => zip1Assets.get(id)?.schema || (NODE_SCHEMAS as any)[id];

export function listAssets(category?: string) {
  const fromZip1 = [...zip1Assets.values()].filter((a) => !category || a.category === category);
  if (fromZip1.length > 0) return fromZip1;
  return Object.values(allAssets || {}).filter((a: any) => !category || a.category === category);
}

export function searchAssets(query: string, category?: string): any[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return listAssets(category)
    .map((asset: any) => {
      const name = asset.name || '';
      const desc = asset.description || '';
      const tags = (asset.tags || []).join(' ');
      const cat = asset.category || '';
      const haystack = (name + ' ' + desc + ' ' + tags + ' ' + cat).toLowerCase();
      const score = terms.reduce((total: number, term: string) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { ...asset, score };
    })
    .filter((asset: any) => asset.score > 0)
    .sort((a: any, b: any) => b.score - a.score || (a.name || '').localeCompare(b.name || ''));
}

export const searchMotionPresets = (query: string) => searchAssets(query, 'motion');
export const searchTemplates = (query: string) => searchAssets(query, 'template');
export const search3DPresets = (query: string) => searchAssets(query, 'three');
