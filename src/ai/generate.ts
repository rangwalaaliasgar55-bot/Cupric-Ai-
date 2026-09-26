/* AI-generation API + recommendation layer + auto library selection. Works fully offline (rule-based
 * semantic analysis over the registry) — no paid AI API required. Outputs are ordinary editable VideoDocs. */
import { searchAssets, searchTemplates } from "@/core/registry";
import { createNode, uid } from "@/core/scene-graph";
import type { AnimationConfig, Aspect, SceneNode, TransitionConfig, VideoDoc } from "@/core/types";
import { TEMPLATES, STYLES, SCENE_BUILDERS, buildTemplate, composeStory, type TemplateInput } from "@/video/templates";
import "@/registry";

export type Analysis = { duration: number; aspect: Aspect; style: string; industry: string; tones: string[]; brandName?: string; scenes: string[]; wants3D: boolean; wantsCaptions: boolean; platform?: string };
const has = (q: string, ...w: string[]) => w.some((x) => q.includes(x));

/** Parse a natural-language request into structured intent. */
export function analyzePrompt(prompt: string): Analysis {
  const q = prompt.toLowerCase();
  const dm = /(\d+)\s*(?:-|\s)?(?:second|sec|s\b)/.exec(q);
  const mm = /(\d+)\s*(?:-|\s)?(?:minute|min)/.exec(q);
  let duration = dm ? Number(dm[1]) : mm ? Number(mm[1]) * 60 : 20;
  let aspect: Aspect = "16:9";
  let platform: string | undefined;
  if (has(q, "shorts", "reel", "tiktok", "story", "stories", "vertical", "9:16")) { aspect = "9:16"; platform = has(q, "tiktok") ? "tiktok" : has(q, "reel") ? "reels" : "shorts"; if (!dm) duration = 15; }
  else if (has(q, "square", "1:1", "feed", "instagram post", "linkedin")) aspect = "1:1";
  else if (has(q, "4:5", "portrait")) aspect = "4:5";
  else if (has(q, "youtube")) platform = "youtube";
  const tones = ["premium", "futuristic", "cinematic", "luxury", "minimal", "playful", "corporate", "editorial", "cyber", "neon", "energetic", "dark", "light"].filter((t) => q.includes(t));
  const style = has(q, "luxury", "gold", "elegant") ? "luxury" : has(q, "cyber", "hacker", "security") ? "cyber" : has(q, "cinematic", "film", "trailer", "dramatic") ? "cinematic" : has(q, "futuristic", "ai ", " ai", "neural", "sci-fi") ? "futuristic" : has(q, "neon", "music", "event") ? "neon" : has(q, "minimal", "clean", "simple") ? "minimal" : has(q, "editorial", "magazine") ? "editorial" : has(q, "corporate", "business", "presentation") ? "corporate" : has(q, "game", "gaming") ? "gaming" : has(q, "finance", "fintech", "bank") ? "finance" : platform === "tiktok" || platform === "reels" || has(q, "playful", "fun") ? "social" : "saas";
  const industry = has(q, "ai ", " ai", "artificial") ? "ai" : has(q, "fintech", "finance", "bank") ? "finance" : has(q, "app", "mobile") ? "app" : has(q, "game") ? "gaming" : has(q, "course", "education") ? "education" : has(q, "saas", "software", "platform", "dashboard") ? "saas" : "general";
  const bm = /(?:for|called|named|brand)\s+["“]?([A-Z][\w]*(?:\s[A-Z][\w]*)?)/.exec(prompt) ?? /["“]([^"”]+)["”]/.exec(prompt);
  const wants3D = has(q, "3d", "product shot", "glass", "chrome", "hologra");
  const scenes = pickScenes(q, industry, duration, platform);
  return { duration, aspect, style, industry, tones, brandName: bm?.[1], scenes, wants3D, wantsCaptions: has(q, "caption", "subtitle"), platform };
}
function pickScenes(q: string, industry: string, duration: number, platform?: string): string[] {
  if (has(q, "logo reveal", "logo animation", "intro")) return platform === "youtube" || has(q, "youtube") ? ["youtubeIntro"] : ["logo"];
  if (platform) return duration <= 12 ? ["kinetic", "statistic", "cta"] : ["hook", industry === "app" ? "phone" : "product", "features", "cta"];
  const n = Math.max(3, Math.min(9, Math.round(duration / 3.6)));
  const full = industry === "ai" ? ["hook", "problem", "aiProcessing", "dashboard", "features", "metrics", "cta"] : industry === "app" ? ["phone", "features", "testimonial", "metrics", "cta"] : industry === "finance" ? ["title", "metrics", "comparison", "result", "cta"] : has(q, "explainer", "how it works") ? ["title", "problem", "process", "result", "cta"] : ["logo", "hook", "product", "features", "dashboard", "metrics", "cta"];
  if (n >= full.length) return full;
  const keep = [full[0], ...full.slice(1, -1).slice(0, n - 2), full[full.length - 1]];
  return keep;
}

export type Recommendation = { template?: string; style: string; theme: string; background: string; typography: string; motion: string; transition: string; effects: string[]; threeD?: { material: string; lighting: string; camera: string }; particles?: string; music?: number; aspect: Aspect; scenes: string[]; reasoning: string[] };
/** Choose the most appropriate existing assets for an analysed request. */
export function recommend(a: Analysis, prompt = ""): Recommendation {
  const st = STYLES[a.style] ?? STYLES.saas;
  const tpl = searchTemplates(`${prompt} ${a.style} ${a.industry} ${a.platform ?? ""}`, 3)[0];
  const reasoning = [
    `Aspect ${a.aspect}${a.platform ? ` (platform: ${a.platform})` : ""}.`,
    `Visual style "${a.style}" from tone keywords [${a.tones.join(", ") || "none → default SaaS"}].`,
    `Structure: ${a.scenes.join(" → ")} (${a.duration}s, HOOK→INFO→VISUAL→FOCUS→PAYOFF→CTA).`,
    tpl ? `Closest template: ${tpl.name}.` : "No template match; composing from story scenes.",
  ];
  return { template: tpl?.id.replace("template:", ""), style: a.style, theme: st.theme, background: st.bg, typography: st.text, motion: st.enter, transition: st.transition, effects: st.effects.map((e) => e.type), threeD: a.wants3D || a.style === "futuristic" ? { material: st.material, lighting: st.lighting, camera: st.camera } : undefined, particles: st.particles, music: a.style === "minimal" || a.style === "corporate" ? 100 : a.style === "luxury" ? 90 : a.platform ? 128 : 116, aspect: a.aspect, scenes: a.wants3D && !a.scenes.includes("product3d") ? a.scenes.map((s) => (s === "product" ? "product3d" : s)) : a.scenes, reasoning };
}

export type GenerateVideoOptions = { prompt?: string; format?: Aspect; duration?: number; style?: string; brand?: { name?: string; primaryColor?: string; colors?: string[]; logoSrc?: string; url?: string }; scenes?: string[]; structure?: string[]; headline?: string; subtitle?: string; features?: string[]; cta?: string; captions?: boolean };
const SCENE_ALIASES: Record<string, string> = { solution: "product", insight: "statement", differentiation: "comparison", "social proof": "testimonial", ai: "aiProcessing", "ai visualization": "aiProcessing", "product ui": "dashboard", ui: "dashboard", demo: "dashboard", stats: "metrics", statistic: "statistic", outro: "outro", intro: "logo", brand: "logo", pricing: "pricing", benefits: "features" };

/** Generate a complete editable composition. */
export async function generateVideo(o: GenerateVideoOptions): Promise<{ doc: VideoDoc; analysis: Analysis; recommendation: Recommendation }> {
  const prompt = o.prompt ?? `${o.style ?? ""} ${o.duration ?? ""} second video for ${o.brand?.name ?? ""}`;
  const a = analyzePrompt(prompt);
  if (o.format) a.aspect = o.format;
  if (o.duration) a.duration = o.duration;
  if (o.style) { const s = analyzePrompt(o.style); a.style = s.style; a.wants3D ||= s.wants3D; }
  const req = o.scenes ?? o.structure;
  if (req?.length) a.scenes = req.map((s) => SCENE_ALIASES[s.toLowerCase()] ?? s).filter((s) => SCENE_BUILDERS[s]);
  const r = recommend(a, prompt);
  const brandName = o.brand?.name ?? a.brandName ?? "Cupric AI";
  const input: TemplateInput & { style: string } = {
    aspect: a.aspect, duration: a.duration, style: a.style,
    brand: { name: brandName, primary: o.brand?.primaryColor ?? o.brand?.colors?.[0], logoSrc: o.brand?.logoSrc, url: o.brand?.url },
    headline: o.headline ?? headlineFor(a, brandName), subtitle: o.subtitle ?? subtitleFor(a, brandName), features: o.features, cta: o.cta ?? (a.platform ? "Follow for more" : `Try ${brandName} free`), music: r.music,
  };
  const doc = composeStory(r.scenes, input);
  doc.name = `${brandName} — ${a.duration}s ${a.style} ${a.aspect}`;
  doc.meta = { ...doc.meta, generatedFrom: prompt, recommendation: r };
  if (o.captions || a.wantsCaptions) doc.captions = [{ id: uid("cap"), style: a.platform ? "highlight" : "aiSubtitle", cues: doc.scenes.map((s, i) => { const start = doc.scenes.slice(0, i).reduce((acc, x) => acc + x.durationInFrames - (x.transition?.duration ?? 0), 0) / doc.fps; const txt = String((s.nodes.find((n) => n.type === "text")?.props.text as string) ?? s.name); return { start: start + 0.3, end: start + s.durationInFrames / doc.fps - 0.2, text: txt.slice(0, 60) }; }) }];
  return { doc, analysis: a, recommendation: r };
}
function headlineFor(a: Analysis, brand: string) { return a.industry === "ai" ? "Intelligence, on autopilot." : a.industry === "finance" ? "Money that moves at your speed." : a.industry === "app" ? `${brand}. In your pocket.` : a.style === "luxury" ? "Crafted without compromise." : a.style === "cinematic" ? "Some ideas change everything." : "Work that runs itself."; }
function subtitleFor(a: Analysis, brand: string) { return a.industry === "ai" ? `${brand} turns your data into decisions — automatically.` : `${brand} helps teams ship faster with less busywork.`; }

export const generateSaaSPromo = (brand: { name: string; primaryColor?: string }, duration = 30) => generateVideo({ brand, duration, style: "premium SaaS", structure: ["logo", "hook", "product", "features", "dashboard", "metrics", "cta"] });
export function generateTemplate(query: string, input: TemplateInput = {}) { const t = searchTemplates(query, 1)[0]; return buildTemplate(t ? t.id.replace("template:", "") : "productLaunch", input); }
export function generateScene(type: string, input: TemplateInput = {}) { return composeStory([SCENE_ALIASES[type] ?? type], { ...input, duration: input.duration ?? 4 }); }
export function generateBackground(query: string, w = 1920, h = 1080): SceneNode {
  const hit = searchAssets(query, { kind: ["background", "shader"], limit: 1 })[0];
  const shader = hit?.kind === "shader";
  return createNode(shader ? "shader" : "background", { ...(hit?.defaults ?? { variant: "mesh" }), speed: 0.6 }, { x: w / 2, y: h / 2, name: "background", timing: { start: 0, duration: 300 } });
}
export function generateMotion(query: string): AnimationConfig { const hit = searchAssets(query, { kind: "motion", limit: 1 })[0]; return { preset: hit ? hit.id.replace("motion:", "") : "saas" }; }
export function generateTypography(query: string) { const hit = searchAssets(query, { kind: "typography", limit: 1 })[0]; return hit ? hit.id.replace("typography:", "") : "wordBlurUp"; }
export function generateTransition(query: string): TransitionConfig { const hit = searchAssets(query, { kind: "transition", limit: 1 })[0]; return { type: hit ? hit.id.replace("transition:", "") : "crossfade", duration: 18 }; }
export function generate3DScene(query: string, w = 900, h = 700): SceneNode {
  const q = query.toLowerCase();
  const mat = searchAssets(query, { kind: "material", limit: 1 })[0]?.id.replace("material:", "") ?? "glass";
  const light = searchAssets(query, { kind: "lighting", limit: 1 })[0]?.id.replace("lighting:", "") ?? "STUDIO";
  const cam = searchAssets(query, { kind: "camera", limit: 1 })[0]?.id.replace("camera:", "") ?? "PRODUCT";
  const obj = ["sphere", "cube", "torus", "torusKnot", "star", "heart", "blob", "icosahedron", "capsule"].find((o) => q.includes(o.toLowerCase())) ?? "torusKnot";
  return createNode("three", { object: obj, material: mat, lighting: light, camera: cam, animation: q.includes("reveal") ? "reveal" : "heroFloat", w, h }, { name: "3d", timing: { start: 0, duration: 300 } });
}

/** Auto library selection: map a plain-language task to the engine layer + concrete asset. */
export function selectLibrary(task: string) {
  const q = task.toLowerCase();
  if (has(q, "text", "headline", "typography", "title")) return { layer: "typography engine (src/render/text.ts)", asset: generateTypography(q.includes("cinematic") ? "cinematic" : q) };
  if (has(q, "3d", "three", "glass object", "product shot")) return { layer: "Three.js 3D layer (src/three)", asset: generate3DScene(q).props };
  if (has(q, "physics", "gravity", "collision", "fall")) return { layer: "Rapier physics (src/three/renderer.ts)", asset: { preset: has(q, "explo") ? "explosion" : "drop" } };
  if (has(q, "transition", "cut between")) return { layer: "transition engine (src/effects/transitions.ts)", asset: generateTransition(q.includes("professional") ? "premium clean" : q) };
  if (has(q, "background", "backdrop")) return { layer: "background/shader engine", asset: generateBackground(q).props };
  if (has(q, "particle", "sparkle", "stars", "snow")) return { layer: "particle engine (src/graphics/particles.ts)", asset: searchAssets(q, { kind: "particles", limit: 1 })[0]?.defaults };
  if (has(q, "chart", "graph", "data")) return { layer: "frame-safe charts (src/ui/charts.ts)", asset: searchAssets(q, { kind: "chart", limit: 1 })[0]?.defaults };
  if (has(q, "video", "render", "mp4", "export")) return { layer: "compositor + Mediabunny exporter (src/video/export.ts)", asset: { format: "mp4" } };
  if (has(q, "button", "hover", "ui interaction", "micro")) return { layer: "Motion (motion.dev) for DOM interaction", asset: { engine: "motion" } };
  return { layer: "motion presets (src/motion/presets.ts)", asset: generateMotion(q) };
}
export const listTemplates = () => Object.values(TEMPLATES).filter((t) => !t.id.startsWith("__"));
