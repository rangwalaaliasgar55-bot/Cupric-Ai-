import { cloneComposition } from "@/core/serialization";
import type { AspectRatio, Composition, MotionElement, Scene, TrackKind } from "@/core/types";
import { searchTemplates } from "@/registry";

type TemplateSeed = {
  id: string;
  name: string;
  description: string;
  accent: string;
  headline: string;
  subheadline: string;
  cta: string;
};

const FPS = 30;
const sceneDuration = 96;

function node(
  id: string,
  name: string,
  type: MotionElement["type"],
  start: number,
  props: MotionElement["props"],
  transform: MotionElement["transform"] = { x: 0, y: 0 },
  entrance = "FADE_UP",
): any {
  return {
    id,
    name,
    type,
    props: props || {},
    transform: { x: 0, y: 0, ...(transform || {}) },
    timing: { start, duration: 28, fill: "both" },
    animation: { entrance, ease: "easeOut" },
    capabilities: { browser: true, video: true, server: true, three: type === "three:model" || undefined },
  };
}

function createScenes(seed: TemplateSeed): Scene[] {
  const starts = Array.from({ length: 6 }, (_, index) => index * sceneDuration);
  return [
    {
      id: "hook",
      name: "Hook",
      startFrame: starts[0],
      durationInFrames: sceneDuration,
      nodes: [
        node("background.gradient", "Aurora field", "background", starts[0], { variant: "aurora", primary: "#7C5CFF", accent: seed.accent }, { x: 0, y: 0 }, "FADE"),
        node("hero.eyebrow", "Launch label", "text", starts[0] + 6, { content: `${seed.name.toUpperCase()} / INTELLIGENCE, AMPLIFIED`, variant: "eyebrow" }, { x: 0, y: 0 }),
        node("hero.headline", "Headline", "text", starts[0] + 14, { content: seed.headline, variant: "display" }, { x: 0, y: 0 }, "CINEMATIC"),
        node("hero.subtitle", "Subtitle", "text", starts[0] + 32, { content: seed.subheadline, variant: "body" }, { x: 0, y: 0 }, "BLUR"),
        node("hero.signal", "Signal rings", "shape", starts[0] + 18, { shape: "signal" }, { x: 285, y: 45, scale: 1 }, "SCALE"),
      ],
    },
    {
      id: "problem",
      name: "The friction",
      startFrame: starts[1],
      durationInFrames: sceneDuration,
      nodes: [
        node("background.grid", "Technical grid", "background", starts[1], { variant: "grid", primary: "#121429", accent: seed.accent }, { x: 0, y: 0 }, "FADE"),
        node("problem.kicker", "Problem label", "text", starts[1] + 5, { content: "FROM SIGNAL TO DECISION", variant: "eyebrow" }, { x: 0, y: 0 }),
        node("problem.statement", "Problem statement", "text", starts[1] + 16, { content: "The work moves fast.\nYour operating system should too.", variant: "statement" }, { x: 0, y: 0 }, "CINEMATIC"),
        node("problem.data", "Data field", "chart", starts[1] + 22, { variant: "signal", label: "Unclear handoffs", value: "43%" }, { x: 210, y: 62 }, "SCALE"),
      ],
    },
    {
      id: "solution",
      name: "The intelligence layer",
      startFrame: starts[2],
      durationInFrames: sceneDuration,
      nodes: [
        node("background.orbit", "Orbit field", "background", starts[2], { variant: "orbit", primary: "#101226", accent: seed.accent }, { x: 0, y: 0 }, "FADE"),
        node("solution.kicker", "Solution label", "text", starts[2] + 5, { content: "MEET THE INTELLIGENCE LAYER", variant: "eyebrow" }, { x: 0, y: 0 }),
        node("solution.headline", "Solution headline", "text", starts[2] + 16, { content: "Ask once.\nMove everything.", variant: "statement" }, { x: 0, y: 0 }, "CINEMATIC"),
        node("solution.orb", "Intelligence orb", "shape", starts[2] + 12, { shape: "orb", label: "AI" }, { x: 262, y: 62, scale: 1.05 }, "SPRING"),
        node("solution.caption", "Solution caption", "text", starts[2] + 40, { content: "A calm command layer for every moving part.", variant: "body" }, { x: 0, y: 0 }, "BLUR"),
      ],
    },
    {
      id: "product",
      name: "Product workspace",
      startFrame: starts[3],
      durationInFrames: sceneDuration,
      nodes: [
        node("background.product", "Product field", "background", starts[3], { variant: "mesh", primary: "#101226", accent: seed.accent }, { x: 0, y: 0 }, "FADE"),
        node("product.kicker", "Product label", "text", starts[3] + 5, { content: "ONE CLEAR WORKSPACE", variant: "eyebrow" }, { x: 0, y: 0 }),
        node("product.headline", "Product headline", "text", starts[3] + 13, { content: "A surface built\nfor momentum.", variant: "statement" }, { x: 0, y: 0 }, "FADE_UP"),
        node("product.browser", "Product browser", "ui", starts[3] + 12, { variant: "browser", productName: seed.name }, { x: 220, y: 38, scale: 1 }, "SPRING"),
      ],
    },
    {
      id: "proof",
      name: "The result",
      startFrame: starts[4],
      durationInFrames: sceneDuration,
      nodes: [
        node("background.proof", "Proof field", "background", starts[4], { variant: "aurora", primary: "#111329", accent: seed.accent }, { x: 0, y: 0 }, "FADE"),
        node("proof.kicker", "Proof label", "text", starts[4] + 5, { content: "THE RESULT", variant: "eyebrow" }, { x: 0, y: 0 }),
        node("proof.metric", "Metric", "text", starts[4] + 15, { content: "3.4×", variant: "metric" }, { x: 0, y: 0 }, "POP"),
        node("proof.label", "Metric label", "text", starts[4] + 29, { content: "faster time to a clear next move", variant: "body" }, { x: 0, y: 0 }, "FADE_UP"),
        node("proof.chart", "Growth chart", "chart", starts[4] + 15, { variant: "growth", label: "Team momentum", value: "+240%" }, { x: 235, y: 54, scale: 1 }, "SCALE"),
      ],
    },
    {
      id: "cta",
      name: "Call to action",
      startFrame: starts[5],
      durationInFrames: sceneDuration,
      nodes: [
        node("background.cta", "CTA field", "background", starts[5], { variant: "dark", primary: "#0A0B16", accent: seed.accent }, { x: 0, y: 0 }, "FADE"),
        node("cta.mark", "Brand mark", "shape", starts[5] + 8, { shape: "mark", label: seed.name.slice(0, 1) }, { x: 0, y: -8 }, "SCALE"),
        node("cta.headline", "CTA headline", "text", starts[5] + 18, { content: "Make the next move\nthe obvious one.", variant: "statement" }, { x: 0, y: 0 }, "CINEMATIC"),
        node("cta.button", "CTA button", "ui", starts[5] + 40, { variant: "button", label: seed.cta }, { x: 0, y: 0 }, "POP"),
        node("cta.url", "CTA URL", "text", starts[5] + 52, { content: `${seed.name.toLowerCase().replace(/\s+/g, "")}.studio`, variant: "micro" }, { x: 0, y: 0 }, "FADE"),
      ],
    },
  ];
}

function createComposition(seed: TemplateSeed): Composition {
  const scenes = createScenes(seed);
  const nodes = scenes.flatMap((scene) => scene.nodes);
  const kindFor = (item: MotionElement): TrackKind => {
    if (item.type === "background") return "BACKGROUND";
    if (item.type === "text") return "TEXT";
    if (item.type === "shape") return "SHAPE";
    if (item.type === "ui") return "UI";
    if (item.type === "chart") return "CHART";
    return "EFFECT";
  };
  return {
    version: 1,
    id: seed.id,
    name: seed.name,
    description: seed.description,
    fps: FPS,
    width: 1920,
    height: 1080,
    durationInFrames: sceneDuration * scenes.length,
    aspectRatio: "16:9",
    quality: "high",
    seed: 42,
    brand: { name: seed.name.replace(" Launch", ""), primary: "#7C5CFF", accent: seed.accent, ink: "#F5F4FF" },
    scenes,
    tracks: (["BACKGROUND", "TEXT", "SHAPE", "UI", "CHART"] as TrackKind[]).map((kind) => ({
      id: `track.${kind.toLowerCase()}`,
      kind,
      name: kind[0] + kind.slice(1).toLowerCase(),
      nodeIds: nodes.filter((item) => kindFor(item as any) === kind).map((item) => item.id),
    })),
    propertyTracks: [
      { id: "signal-breathe", nodeId: "hero.signal", property: "scale", keyframes: [{ frame: 0, value: 0.92 }, { frame: 40, value: 1.06, ease: "easeInOut" }, { frame: 80, value: 0.92, ease: "easeInOut" }] },
      { id: "orb-breathe", nodeId: "solution.orb", property: "scale", keyframes: [{ frame: 0, value: 0.94 }, { frame: 42, value: 1.1, ease: "easeInOut" }, { frame: 86, value: 0.94, ease: "easeInOut" }] },
    ],
    markers: scenes.map((scene) => ({ id: `marker.${scene.id}`, frame: scene.startFrame ?? 0, label: scene.name, color: seed.accent })),
    layoutVariants: {
      "9:16": {
        width: 1080,
        height: 1920,
        nodeTransforms: {
          "hero.signal": { x: 0, y: 220, scale: 0.88 },
          "problem.data": { x: 0, y: 250, scale: 0.94 },
          "solution.orb": { x: 0, y: 290, scale: 0.92 },
          "product.browser": { x: 0, y: 310, scale: 0.78 },
          "proof.chart": { x: 0, y: 290, scale: 0.86 },
        },
      },
      "1:1": { width: 1080, height: 1080, nodeTransforms: { "product.browser": { x: 165, y: 142, scale: 0.8 } } },
    },
  };
}

export const templates = {
  "ai-product-launch": createComposition({
    id: "ai-product-launch",
    name: "NOVA / AI PRODUCT LAUNCH",
    description: "A premium data-forward AI SaaS launch composition with six editable scenes.",
    accent: "#4EE7C0",
    headline: "Intelligence\nwith momentum.",
    subheadline: "NOVA turns a moving system into a clear next move.",
    cta: "Start with NOVA",
  }),
  "product-launch": createComposition({
    id: "product-launch",
    name: "ASTER / PRODUCT LAUNCH",
    description: "A clean premium product launch sequence.",
    accent: "#FFB86B",
    headline: "Build clarity.\nShip beautifully.",
    subheadline: "ASTER aligns every signal around the work that matters.",
    cta: "Meet ASTER",
  }),
  "startup-story": createComposition({
    id: "startup-story",
    name: "VECTOR / STARTUP STORY",
    description: "A startup narrative from friction to traction.",
    accent: "#75A7FF",
    headline: "Your sharpest\noperating edge.",
    subheadline: "VECTOR gives focused teams a system that compounds.",
    cta: "See VECTOR in motion",
  }),
  "vertical-app": createComposition({
    id: "vertical-app",
    name: "PULSE / APP TEASER",
    description: "A vertical-ready app teaser composition.",
    accent: "#FF6EAA",
    headline: "Make every\nmoment move.",
    subheadline: "PULSE keeps your work close, clear and already in motion.",
    cta: "Get PULSE",
  }),
};

export type TemplateId = keyof typeof templates;

export function getTemplate(id: TemplateId = "ai-product-launch") {
  return cloneComposition(templates[id]);
}

export function listTemplates() {
  return Object.entries(templates).map(([id, composition]) => ({ id, name: composition.name, description: composition.description }));
}

export function applyAspectRatio(composition: Composition, aspectRatio: AspectRatio) {
  const next = cloneComposition(composition);
  const variant = aspectRatio === "custom" ? undefined : next.layoutVariants?.[aspectRatio];
  if (variant) {
    next.width = variant.width;
    next.height = variant.height;
    for (const scene of next.scenes) {
      for (const item of scene.nodes as any[]) {
        const override = variant.nodeTransforms[item.id];
        if (override) item.transform = { ...item.transform, ...override };
      }
    }
  }
  next.aspectRatio = aspectRatio;
  return next;
}

export function generateScene(kind: "hook" | "problem" | "solution" | "product" | "features" | "cta") {
  const base = getTemplate();
  const index = kind === "features" ? 4 : base.scenes.findIndex((scene) => scene.id === kind);
  return cloneComposition({ ...base, scenes: [base.scenes[Math.max(0, index)]] });
}

export function generateTemplate(options: { style?: string; format?: AspectRatio; brand?: Partial<Composition["brand"]> } = {}) {
  const template = recommendTemplate(options.style ?? "premium AI SaaS");
  const composition = getTemplate(template);
  if (options.brand) composition.brand = { ...composition.brand, ...options.brand };
  return options.format ? applyAspectRatio(composition, options.format) : composition;
}

export function generateVideo(options: {
  style?: string;
  format?: AspectRatio;
  duration?: number;
  brand?: Partial<Composition["brand"]>;
  structure?: string[];
} = {}) {
  const composition = generateTemplate({ style: options.style, format: options.format, brand: options.brand });
  if (options.duration && options.duration > 3) composition.durationInFrames = Math.round(options.duration * composition.fps);
  return composition;
}

export function generateBackground(style = "premium AI") {
  return searchTemplates(style).length ? "background.aurora" : "background.mesh";
}

export const generateMotion = (style = "cinematic") => (style.includes("cinematic") ? "motion.cinematic" : "motion.fade-up");
export const generateTransition = (style = "minimal") => (style.includes("tech") ? "transition.glitch" : "transition.crossfade");
export const generate3DScene = () => "three.product-hero";
export const generateSaaSPromo = generateVideo;

export function recommendTemplate(prompt: string): TemplateId {
  const text = prompt.toLowerCase();
  if (text.includes("vertical") || text.includes("short") || text.includes("reel") || text.includes("tiktok")) return "vertical-app";
  if (text.includes("startup")) return "startup-story";
  if (text.includes("product") && !text.includes("ai")) return "product-launch";
  return "ai-product-launch";
}
