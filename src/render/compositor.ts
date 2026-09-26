/* The single deterministic compositor: renderFrame(ctx, doc, frame) — used by preview, editor, thumbnails
 * and the exporter. Scene overlap → transitions; per-scene & global post effects; captions; audio-reactivity. */
import "./text";
import "./shapes";
import "./nodes-extra";
import "@/ui/canvas-ui";
import "@/ui/charts";
import "@/three/renderer";
import { evaluateNode, type ResolvedNode } from "@/core/animation";
import { sceneSpans, docDuration } from "@/core/scene-graph";
import type { Quality, Scene, SceneNode, VideoDoc } from "@/core/types";
import { getTheme } from "@/themes";
import { applyEffects } from "@/effects/post";
import { drawTransition } from "@/effects/transitions";
import { drawCaptions } from "@/video/captions";
import { audioFeaturesAt, prepareAudio } from "@/video/audio";
import { applyClip } from "./clip";
import { getNodeRenderer, getCanvas, ctxOf, resolveQuality, loadImage, type RenderContext, type Ctx2D } from "./core";
import { loadPhysics } from "@/three/renderer";

export type RenderOptions = { quality?: Quality; requestRedraw?: () => void; transparent?: boolean; selectedId?: string | null; showSafeArea?: boolean };

function drawNode(rc: RenderContext, node: SceneNode, st: ResolvedNode) {
  const r = getNodeRenderer(node.type);
  if (!r) return;
  const { ctx } = rc;
  ctx.save();
  const react = node.props.audioReactive as string | undefined;
  if (react && react !== "none" && node.type !== "background" && node.type !== "particles") {
    const v = rc.audio[react as keyof typeof rc.audio] ?? 0;
    const amt = Number(node.props.audioAmount ?? 0.3);
    switch (node.props.audioTarget ?? "scale") {
      case "scale": st.scale *= 1 + v * amt; break;
      case "rotation": st.rotate += v * amt * 30; break;
      case "opacity": st.opacity *= 1 - amt + v * amt; break;
      case "position": st.y -= v * amt * 60; break;
      case "glow": st.brightness *= 1 + v * amt * 1.5; break;
      case "distortion": st.rgbSplit += v * amt * 20; break;
    }
  }
  ctx.translate(st.x, st.y);
  if (st.rotate) ctx.rotate((st.rotate * Math.PI) / 180);
  if (st.skewX) ctx.transform(1, 0, Math.tan((st.skewX * Math.PI) / 180), 1, 0, 0);
  const sx = st.scale * st.scaleX * Math.cos((st.rotateY * Math.PI) / 180);
  const sy = st.scale * st.scaleY * Math.cos((st.rotateX * Math.PI) / 180);
  if (Math.abs(sx) < 1e-4 || Math.abs(sy) < 1e-4) { ctx.restore(); return; }
  ctx.scale(sx, sy);
  ctx.globalAlpha *= Math.max(0, Math.min(1, st.opacity));
  const filters: string[] = [];
  if (st.blur > 0.3 && rc.quality !== "low") filters.push(`blur(${st.blur.toFixed(1)}px)`);
  if (Math.abs(st.brightness - 1) > 0.01) filters.push(`brightness(${st.brightness.toFixed(2)})`);
  if (filters.length) ctx.filter = filters.join(" ");
  if (st.clip) { const b = r.bounds(node, rc); applyClip(ctx, st.clip, -b.w / 2, -b.h / 2, b.w, b.h); }
  for (const fx of node.effects ?? []) {
    if (fx.enabled === false) continue;
    const pp = fx.params ?? {};
    if (fx.type === "glow") { ctx.shadowColor = String(pp.color ?? rc.theme.colors.primary); ctx.shadowBlur = Number(pp.radius ?? 40); }
    if (fx.type === "shadow") { ctx.shadowColor = String(pp.color ?? "rgba(0,0,0,0.5)"); ctx.shadowBlur = Number(pp.radius ?? 40); ctx.shadowOffsetY = Number(pp.y ?? 20); }
  }
  if (st.rgbSplit > 0.5) {
    ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha *= 0.55;
    ctx.translate(-st.rgbSplit, 0); r.draw(rc, node, st); ctx.translate(st.rgbSplit * 2, 0); r.draw(rc, node, st);
    ctx.restore();
  }
  r.draw(rc, node, st);
  if (node.children?.length) for (const c of node.children) { const cs = evaluateNode(c, rc.frame, rc.fps); if (cs.visible) drawNode(rc, c, cs); }
  if (node.effects?.some((e) => e.type === "reflection" && e.enabled !== false)) {
    const b = r.bounds(node, rc);
    ctx.save(); ctx.translate(0, b.h); ctx.scale(1, -1); ctx.globalAlpha *= 0.18; r.draw(rc, node, st); ctx.restore();
  }
  ctx.restore();
}

function renderScene(ctx: Ctx2D, doc: VideoDoc, scene: Scene, local: number, globalFrame: number, scale: number, o: RenderOptions, quality: RenderContext["quality"]) {
  const theme = getTheme(doc.theme);
  const rc: RenderContext = { ctx, doc, theme, w: doc.width, h: doc.height, fps: doc.fps, frame: local, globalFrame, quality, audio: audioFeaturesAt(doc, globalFrame), requestRedraw: o.requestRedraw ?? (() => {}) };
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  for (const node of scene.nodes) {
    const st = evaluateNode(node, local, doc.fps);
    if (!st.visible) continue;
    drawNode(rc, node, st);
  }
  ctx.restore();
  if (scene.effects?.length) applyEffects(ctx, ctx.canvas.width, ctx.canvas.height, local / doc.fps, scene.effects, doc.seed ?? 7, quality);
}

/** Render a frame of the document into ctx (canvas can be any resolution; content is scaled). */
export function renderFrame(ctx: Ctx2D, doc: VideoDoc, frame: number, o: RenderOptions = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const scale = W / doc.width;
  const quality = resolveQuality(o.quality);
  const theme = getTheme(doc.theme);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
  if (o.transparent) ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = doc.background ?? theme.colors.bg; ctx.fillRect(0, 0, W, H); }
  const spans = sceneSpans(doc);
  const active = spans.filter((s) => frame >= s.start && frame < s.end);
  if (active.length === 0 && spans.length) active.push(frame < 0 ? spans[0] : spans[spans.length - 1]);
  if (active.length >= 2) {
    const [a, b] = active.slice(-2);
    const ca = getCanvas("scene_a", W, H), cb = getCanvas("scene_b", W, H);
    const ga = ctxOf(ca), gb = ctxOf(cb);
    for (const [g, s] of [[ga, a], [gb, b]] as const) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = "none"; g.fillStyle = doc.background ?? theme.colors.bg; g.fillRect(0, 0, W, H); renderScene(g, doc, s.scene, frame - s.start, frame, scale, o, quality); }
    const p = (frame - b.start) / Math.max(1, b.transitionIn);
    drawTransition(ctx, b.scene.transition?.type ?? "crossfade", ca, cb, p, W, H, b.scene.transition?.params);
  } else if (active.length === 1) {
    const s = active[0];
    renderScene(ctx, doc, s.scene, Math.min(frame - s.start, s.scene.durationInFrames - 1), frame, scale, o, quality);
  }
  if (doc.effects?.length) applyEffects(ctx, W, H, frame / doc.fps, doc.effects, doc.seed ?? 7, quality);
  if (doc.captions?.length) { ctx.setTransform(scale, 0, 0, scale, 0, 0); for (const tr of doc.captions) drawCaptions(ctx, tr, frame / doc.fps, doc.width, doc.height, theme); ctx.setTransform(1, 0, 0, 1, 0, 0); }
  if (o.showSafeArea) { ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.setLineDash([6, 6]); ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9); ctx.setLineDash([]); }
  ctx.restore();
}

/** Resolve async resources before deterministic export (images, physics wasm, audio analysis, fonts). */
export async function prepareDoc(doc: VideoDoc) {
  const urls = new Set<string>();
  let physics = false;
  const walk = (ns: SceneNode[]) => ns.forEach((n) => { for (const k of ["src", "screenSrc"]) if (typeof n.props[k] === "string" && n.props[k]) urls.add(n.props[k] as string); if (n.type === "physics") physics = true; if (n.children) walk(n.children); });
  doc.scenes.forEach((s) => walk(s.nodes));
  await Promise.all([...urls].map((u) => loadImage(u)));
  if (physics) await loadPhysics();
  await prepareAudio(doc);
  if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
}

export { docDuration };
