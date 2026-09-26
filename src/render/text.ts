/* Kinetic typography engine: layout (kerning-preserving per-char positions), char/word/line splitting,
 * per-unit motion presets with stagger, special effects and premium fills. Deterministic. */
import { clamp, getEase, hash1, mulberry32, shiftHue } from "@/core/math";
import { entranceProgress, presetDelta, applyDelta, isReducedMotion } from "@/core/animation";
import { identityState, type MotionState } from "@/motion/presets";
import type { SceneNode } from "@/core/types";
import { FontManager, FONT_PRESETS, type Theme } from "@/themes";
import { registerNodeRenderer, linearGrad, withAlpha, p, type Ctx2D, type RenderContext } from "./core";
import { applyClip } from "./clip";

export type Split = "none" | "char" | "word" | "line";
export type TypoPreset = { id: string; name: string; split: Split; unit?: string; stagger: number; special?: string; fill?: string; tags: string[]; description: string; duration?: number };

export const TYPO_PRESETS: Record<string, TypoPreset> = {};
function T(id: string, name: string, split: Split, unit: string | undefined, stagger: number, tags: string[], description: string, special?: string, fill?: string, duration?: number) {
  TYPO_PRESETS[id] = { id, name, split, unit, stagger, special, fill, tags, description, duration };
}
// Per-unit motion families
T("charFadeUp", "Char Fade Up", "char", "fadeUp", 1.2, ["saas", "clean"], "Characters rise and fade in sequence.");
T("charBlurUp", "Char Blur Up", "char", "blurUp", 1.4, ["saas", "premium"], "Characters resolve from blur while rising.");
T("charPop", "Char Pop", "char", "pop", 1.5, ["playful", "social"], "Characters pop with overshoot.");
T("charSpring", "Char Spring", "char", "springUp", 1.5, ["physical"], "Spring physics per character.");
T("charDrop", "Char Drop", "char", "dropIn", 2, ["playful"], "Characters fall and bounce.");
T("charElastic", "Char Elastic", "char", "elasticIn", 2, ["energetic"], "Elastic scale per character.");
T("charFlip3D", "Char Flip 3D", "char", "flipUp3D", 1.6, ["3d", "tech"], "3D flip-up per character.");
T("charRotate", "Char Rotate", "char", "rotateIn", 1.5, ["playful"], "Characters rotate into place.");
T("charGlitch", "Char Glitch", "char", "glitchIn", 1, ["cyber", "tech"], "Glitch per character.");
T("charFlicker", "Neon Flicker", "char", "flicker", 1.5, ["neon"], "Neon flicker per character.");
T("charZoom", "Char Zoom", "char", "zoomBlur", 1.2, ["energetic"], "Characters rush from camera.");
T("charScale", "Char Scale", "char", "scaleUp", 1, ["bold"], "Characters grow from small.");
T("charSkew", "Char Skew", "char", "skewIn", 1.2, ["dynamic"], "Skewed character entrance.");
T("charMask", "Char Mask", "char", "maskUp", 1.2, ["editorial"], "Characters rise through a mask.");
T("charSpiral", "Char Spiral", "char", "spiralIn", 1.5, ["space"], "Characters spiral in.");
T("charDissolve", "Char Dissolve", "char", "dissolveIn", 0.8, ["soft"], "Noisy dissolve per character.");
T("charCenter", "Center Out", "char", "fadeUp", 1.5, ["symmetric"], "Stagger from the centre outward.", "centerOut");
T("charRandom", "Random Order", "char", "blurIn", 1, ["organic"], "Characters appear in random order.", "random");
T("wordFadeUp", "Word Fade Up", "word", "fadeUp", 4, ["saas", "basic"], "Words rise sequentially.");
T("wordBlurUp", "Word Blur Up", "word", "blurUp", 4, ["saas", "premium", "cinematic"], "Words resolve from blur.");
T("wordPop", "Word Pop", "word", "pop", 4, ["social", "playful"], "Words pop in.");
T("wordSlide", "Word Slide", "word", "fadeRight", 4, ["corporate"], "Words slide in from the left.");
T("wordZoom", "Word Zoom", "word", "scaleDown", 5, ["cinematic"], "Words settle from large.");
T("wordFlip", "Word Flip", "word", "flipY", 5, ["3d"], "Words flip in.");
T("wordMask", "Word Mask", "word", "maskUp", 4, ["editorial"], "Words rise through masks.");
T("wordStomp", "Stomp", "word", "social", 6, ["social", "shorts", "bold"], "Punchy per-word stomp for short-form.");
T("wordCinematic", "Word Cinematic", "word", "cinematic", 8, ["cinematic", "film"], "Slow cinematic words.");
T("wordSpring", "Word Spring", "word", "springUp", 4, ["physical"], "Spring per word.");
T("wordLuxury", "Word Luxury", "word", "luxury", 10, ["luxury"], "Slow exposure per word.");
T("lineMaskUp", "Line Mask Up", "line", "maskUp", 6, ["editorial", "premium"], "Lines rise through masks.");
T("lineFadeUp", "Line Fade Up", "line", "fadeUp", 6, ["clean"], "Lines rise and fade.");
T("lineWipe", "Line Wipe", "line", "wipeRight", 8, ["clean"], "Lines wipe in.");
T("lineBlur", "Line Blur", "line", "blurIn", 8, ["soft"], "Lines focus in.");
T("lineEditorial", "Line Editorial", "line", "editorial", 8, ["editorial", "magazine"], "Masked rise with skew per line.");
T("linePerspective", "Line Perspective", "line", "perspectiveIn", 8, ["3d"], "Lines swing in with perspective.");
T("blockFade", "Fade", "none", "fade", 0, ["minimal"], "Whole-block fade.");
T("blockCinematic", "Cinematic Title", "none", "cinematic", 0, ["cinematic"], "Whole-block cinematic reveal.");
T("blockFuturistic", "Futuristic", "none", "futuristic", 0, ["futuristic", "ai"], "Stretch/blur/chroma resolve.");
// Specials
T("typewriter", "Typewriter", "char", undefined, 2, ["code", "tech"], "Typed characters with blinking caret.", "typewriter");
T("scramble", "Scramble Decode", "char", undefined, 1, ["tech", "hacker", "ai"], "Random glyphs decode into the text.", "scramble");
T("trackingIn", "Tracking In", "none", "fade", 0, ["cinematic", "luxury"], "Letter-spacing contracts into place.", "tracking", undefined, 60);
T("trackingOut", "Tracking Expand", "none", "fade", 0, ["cinematic"], "Letter-spacing slowly expands.", "trackingExpand", undefined, 90);
T("wave", "Wave", "char", "fade", 1, ["playful", "music"], "Continuous sine wave through characters.", "wave");
T("bounceLoop", "Bounce Loop", "char", "fade", 1, ["playful"], "Characters bounce continuously.", "bounceLoop");
T("gradientSweep", "Gradient Sweep", "none", "fade", 0, ["saas", "ai"], "Animated gradient flowing through text.", "sweep", "gradient");
T("highlight", "Marker Highlight", "word", "fadeUp", 3, ["explainer", "education"], "Marker highlight grows behind key words.", "highlight");
T("underline", "Underline Draw", "none", "fadeUp", 0, ["editorial"], "Underline draws under the text.", "underline");
T("strike", "Strike Through", "none", "fade", 0, ["comparison"], "Strike-through line draws across.", "strike");
T("chromeShine", "Chrome Shine", "none", "blurScale", 0, ["chrome", "premium"], "Chrome fill with moving specular sweep.", "shine", "chrome");
T("goldLuxury", "Gold Luxury", "word", "luxury", 10, ["luxury", "gold"], "Gold metallic fill with slow reveal.", "shine", "gold");
T("holographic", "Holographic", "none", "futuristic", 0, ["holographic", "futuristic"], "Hue-cycling holographic fill.", "holo", "holographic");
T("liquid", "Liquid", "char", "fadeUp", 1, ["liquid", "fluid"], "Characters undulate like liquid.", "liquid", "gradient");
T("extrude3D", "3D Extrusion", "none", "scaleIn", 0, ["3d", "bold"], "Stacked depth extrusion.", "extrude");
T("neonGlow", "Neon Glow", "char", "flicker", 1.5, ["neon", "cyber"], "Neon tube glow with flicker.", "neon", "neon");
T("outlineFill", "Outline to Fill", "none", "fade", 0, ["bold"], "Outline fills from bottom to top.", "outlineFill");
T("counter", "Number Counter", "none", "fadeUp", 0, ["data", "metrics"], "Counts numbers in the text up from zero.", "counter", undefined, 60);
T("rotator", "Word Rotator", "none", "fadeUp", 0, ["saas", "hero"], "Cycles the last word through alternatives (use | separators).", "rotator");
T("karaoke", "Karaoke Fill", "none", "fade", 0, ["captions", "music"], "Color fill sweeps across the text.", "karaoke", undefined, 60);
T("glitchText", "Glitch Text", "none", "glitchIn", 0, ["cyber", "gaming"], "Persistent RGB glitch slices.", "glitch");
T("longShadow", "Long Shadow", "none", "pop", 0, ["retro", "bold"], "Retro long-shadow typography.", "longShadow");
T("spotlightText", "Spotlight", "none", "fade", 0, ["cinematic"], "Spotlight passes across text.", "spotlight");
T("jitterText", "Jitter", "char", "fade", 0.5, ["grunge"], "Characters jitter nervously.", "jitter");
T("splitColor", "Split Color", "none", "maskUp", 0, ["editorial"], "Top/bottom halves in two colors.", "splitColor");

/* ---------- Layout ---------- */
type Glyph = { ch: string; x: number; w: number; line: number; word: number; idx: number };
type Layout = { glyphs: Glyph[]; lines: { width: number; y: number; words: number[] }[]; width: number; height: number; lineHeight: number; size: number };
const layoutCache = new Map<string, Layout>();

export function layoutText(ctx: Ctx2D, text: string, font: string, size: number, tracking: number, maxWidth: number, lineHeight: number, align: string): Layout {
  const key = `${text}|${font}|${tracking}|${maxWidth}|${lineHeight}|${align}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  ctx.save();
  ctx.font = font;
  const track = tracking * size;
  const measureWord = (w: string) => ctx.measureText(w).width + track * w.length;
  const space = ctx.measureText(" ").width + track;
  const paragraphs = text.split("\n");
  const lines: { words: string[]; width: number }[] = [];
  for (const para of paragraphs) {
    const words = para.split(/ +/);
    let cur: string[] = [], cw = 0;
    for (const w of words) {
      const ww = measureWord(w);
      if (cur.length && cw + space + ww > maxWidth) { lines.push({ words: cur, width: cw }); cur = [w]; cw = ww; }
      else { cw += (cur.length ? space : 0) + ww; cur.push(w); }
    }
    lines.push({ words: cur, width: cw });
  }
  const lh = size * lineHeight;
  const glyphs: Glyph[] = [];
  const outLines: Layout["lines"] = [];
  let wordIdx = 0, idx = 0;
  lines.forEach((ln, li) => {
    const startX = align === "left" ? 0 : align === "right" ? -ln.width : -ln.width / 2;
    let x = startX;
    const wordIds: number[] = [];
    ln.words.forEach((w, wi) => {
      for (let i = 0; i < w.length; i++) {
        const pre = ctx.measureText(w.slice(0, i)).width + track * i;
        const cw = ctx.measureText(w[i]).width;
        glyphs.push({ ch: w[i], x: x + pre, w: cw, line: li, word: wordIdx, idx: idx++ });
      }
      wordIds.push(wordIdx++);
      x += measureWord(w) + (wi < ln.words.length - 1 ? space : 0);
    });
    outLines.push({ width: ln.width, y: (li - (lines.length - 1) / 2) * lh, words: wordIds });
  });
  ctx.restore();
  const width = Math.max(...lines.map((l) => l.width), 1);
  const res: Layout = { glyphs, lines: outLines, width, height: lines.length * lh, lineHeight: lh, size };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, res);
  return res;
}

/* ---------- Fills ---------- */
function fillStyle(ctx: Ctx2D, kind: string, colors: string[], color: string, L: Layout, t: number, alignOffset: number): string | CanvasGradient {
  const x0 = alignOffset - L.width / 2, x1 = alignOffset + L.width / 2, y0 = -L.height / 2, y1 = L.height / 2;
  switch (kind) {
    case "gradient": { const sh = (t * 0.25) % 1; return linearGrad(ctx, [...colors, colors[0]], x0 - L.width * sh, 0, x1 + L.width * (1 - sh), 0); }
    case "chrome": return linearGrad(ctx, ["#ffffff", "#e6e9ef", "#8a92a3", "#2b2f38", "#c9ced8", "#ffffff"], 0, y0, 0, y1);
    case "gold": return linearGrad(ctx, ["#fff4d6", "#f0cf7a", "#b98a2e", "#6e4f14", "#e9c46a", "#fff1c1"], 0, y0, 0, y1);
    case "silver": return linearGrad(ctx, ["#ffffff", "#c9ced6", "#6b7280", "#e5e7eb"], 0, y0, 0, y1);
    case "holographic": { const hs = [0, 1, 2, 3, 4].map((i) => shiftHue(colors[0] ?? "#8b5cf6", t * 60 + i * 70, 0.3, 0.15)); return linearGrad(ctx, hs, x0, y0, x1, y1); }
    case "metallic": return linearGrad(ctx, [shiftHue(color, 0, 0, 0.35), color, shiftHue(color, 0, 0, -0.3), shiftHue(color, 0, 0, 0.2)], 0, y0, 0, y1);
    default: return color;
  }
}

const SCRAMBLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/\\";

export function drawKineticText(rc: RenderContext, node: SceneNode, st: MotionState) {
  const { ctx, theme, fps } = rc;
  const f = rc.frame - node.timing.start;
  const t = f / fps;
  const presetId = p<string>(node, "animation", "wordBlurUp");
  const preset = TYPO_PRESETS[presetId] ?? TYPO_PRESETS.wordBlurUp;
  const fontPreset = FONT_PRESETS[p<string>(node, "fontPreset", theme.font.id)] ?? theme.font;
  const role = p<string>(node, "role", "display");
  const family = p<string>(node, "fontFamily", role === "body" ? fontPreset.body : role === "mono" ? fontPreset.mono : fontPreset.display);
  const size = p<number>(node, "size", 96);
  const weight = p<number>(node, "weight", role === "body" ? fontPreset.bodyWeight : fontPreset.displayWeight);
  let tracking = p<number>(node, "tracking", role === "body" ? 0 : fontPreset.tracking);
  const lineHeight = p<number>(node, "lineHeight", role === "body" ? 1.4 : fontPreset.lineHeight);
  const align = p<string>(node, "align", "center");
  const color = p<string>(node, "color", role === "body" ? theme.colors.muted : theme.colors.text);
  const colors = (node.props.colors as string[] | undefined) ?? theme.gradient;
  const fillKind = p<string>(node, "fill", preset.fill ?? "solid");
  let raw = String(p<string>(node, "text", "Text"));
  const textCase = p<string>(node, "case", fontPreset.uppercase && role !== "body" ? "upper" : "none");
  raw = FontManager.transformCase(raw, textCase);
  const maxWidth = p<number>(node, "maxWidth", rc.w * 0.8);
  const special = preset.special;

  // Special pre-processing
  if (special === "rotator" && raw.includes("|")) {
    const parts = raw.split("|");
    const baseStr = parts[0];
    const alts = parts.slice(1);
    const per = 1.6;
    const i = Math.floor(t / per) % alts.length;
    raw = baseStr + alts[i];
  }
  if (special === "counter") {
    const prog = getEase("easeOutExpo")(clamp(f / (preset.duration ?? 60)));
    raw = raw.replace(/(\d[\d,]*\.?\d*)/g, (m) => {
      const n = parseFloat(m.replace(/,/g, ""));
      const dec = (m.split(".")[1] ?? "").length;
      const v = n * prog;
      return m.includes(",") ? v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec);
    });
  }
  if (special === "tracking") tracking += (1 - getEase("cinematic")(clamp(f / (preset.duration ?? 60)))) * 0.5;
  if (special === "trackingExpand") tracking += getEase("easeOutQuad")(clamp(f / 150)) * 0.25;

  const font = FontManager.css({ family, size, weight });
  const L = layoutText(ctx, raw, font, size, tracking, maxWidth, lineHeight, align);
  const alignOffset = align === "left" ? L.width / 2 : align === "right" ? -L.width / 2 : 0;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const fs = fillStyle(ctx, fillKind, colors, color, L, t, alignOffset);
  const stagger = p<number>(node, "stagger", preset.stagger);
  const unitCfg = { preset: preset.unit ?? "fade", duration: p<number>(node, "unitDuration", undefined as unknown as number) || undefined, intensity: p<number>(node, "intensity", 1), distance: size * 0.5 };
  const reduced = isReducedMotion();
  const units = preset.split === "char" ? L.glyphs.length : preset.split === "word" ? (L.glyphs.at(-1)?.word ?? 0) + 1 : preset.split === "line" ? L.lines.length : 1;
  const order = (i: number) => {
    if (special === "centerOut") return Math.abs(i - (units - 1) / 2);
    if (special === "random") return Math.floor(hash1(i * 13.37) * units);
    return i;
  };
  const rng = mulberry32(Math.floor(t * 20) + 99);

  // Decorations behind
  if (special === "highlight") {
    const hl = String(p<string>(node, "highlightWords", "")).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    L.lines.forEach((ln) => ln.words.forEach((wid) => {
      const gs = L.glyphs.filter((g) => g.word === wid);
      const word = gs.map((g) => g.ch).join("").toLowerCase().replace(/[^\w]/g, "");
      if (!hl.length ? wid !== ln.words.at(-1) : !hl.includes(word)) return;
      const x0 = gs[0].x - size * 0.08, x1 = gs.at(-1)!.x + gs.at(-1)!.w + size * 0.08;
      const pr = getEase("easeInOutCubic")(clamp((f - 12 - wid * stagger) / 18));
      ctx.fillStyle = withAlpha(p<string>(node, "highlightColor", theme.colors.primary), 0.45);
      ctx.fillRect(x0, ln.y - size * 0.32, (x1 - x0) * pr, size * 0.7);
    }));
  }

  const drawGlyphs = (gs: Glyph[], s: MotionState, style: string | CanvasGradient, unitIndex: number) => {
    if (s.opacity <= 0.001) return;
    const cx = gs.reduce((a, g) => a + g.x + g.w / 2, 0) / gs.length;
    const cy = L.lines[gs[0].line].y;
    ctx.save();
    ctx.translate(cx + s.x, cy + s.y);
    ctx.rotate((s.rotate * Math.PI) / 180);
    if (s.skewX) ctx.transform(1, 0, Math.tan((s.skewX * Math.PI) / 180), 1, 0, 0);
    const sx = s.scale * s.scaleX * Math.cos((s.rotateY * Math.PI) / 180);
    const sy = s.scale * s.scaleY * Math.cos((s.rotateX * Math.PI) / 180);
    ctx.scale(sx || 0.0001, sy || 0.0001);
    ctx.globalAlpha *= clamp(s.opacity);
    if (s.blur > 0.3 && rc.quality !== "low") ctx.filter = `blur(${s.blur.toFixed(1)}px)`;
    if (s.clip) {
      const x0 = gs[0].x - cx, x1 = gs.at(-1)!.x + gs.at(-1)!.w - cx;
      applyClip(ctx, s.clip, x0, -L.lineHeight / 2, x1 - x0, L.lineHeight);
    }
    ctx.fillStyle = style;
    if (s.rgbSplit > 0.5) {
      ctx.globalCompositeOperation = "lighter";
      const off = s.rgbSplit;
      for (const [c, dx] of [["#ff0040", -off], ["#00ffd0", off]] as const) { ctx.fillStyle = withAlpha(c, 0.7); for (const g of gs) ctx.fillText(g.ch, g.x - cx + dx, 0); }
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = style;
    }
    for (const g of gs) {
      let ch = g.ch;
      let dy = 0;
      if (special === "scramble") {
        const reveal = clamp((f - g.idx * stagger) / 12);
        if (reveal < 1 && ch !== " ") ch = SCRAMBLE[Math.floor(rng() * SCRAMBLE.length)];
        if (f < g.idx * stagger * 0.5) continue;
      }
      if (special === "wave" && !reduced) dy = Math.sin(t * 5 - g.idx * 0.45) * size * 0.12;
      if (special === "bounceLoop" && !reduced) dy = -Math.abs(Math.sin(t * 4 - g.idx * 0.3)) * size * 0.2;
      if (special === "liquid" && !reduced) dy = Math.sin(t * 2.4 + g.idx * 0.6) * size * 0.06 + Math.sin(t * 4.1 + g.idx) * size * 0.03;
      if (special === "jitter" && !reduced) dy = (hash1(g.idx + Math.floor(t * 12) * 7.1) - 0.5) * size * 0.08;
      const gx = g.x - cx;
      if (special === "extrude") {
        const depth = p<number>(node, "depth", 14);
        for (let d = depth; d > 0; d--) { ctx.fillStyle = shiftHue(p<string>(node, "extrudeColor", theme.colors.primary), 0, 0, -0.25 - d * 0.015); ctx.fillText(ch, gx + d * 0.9, dy + d * 0.9); }
        ctx.fillStyle = style;
      }
      if (special === "longShadow") {
        ctx.fillStyle = withAlpha(theme.colors.primary, 0.5);
        for (let d = 1; d < 24; d += 1) ctx.fillText(ch, gx + d, dy + d);
        ctx.fillStyle = style;
      }
      if (special === "neon") {
        ctx.shadowColor = colors[0] ?? theme.colors.primary; ctx.shadowBlur = size * 0.35;
        ctx.strokeStyle = colors[0] ?? theme.colors.primary; ctx.lineWidth = Math.max(1, size * 0.03);
        ctx.strokeText(ch, gx, dy);
        ctx.fillStyle = "#ffffff";
      }
      ctx.fillText(ch, gx, dy);
      if (special === "neon") ctx.shadowBlur = 0;
    }
    ctx.restore();
    void unitIndex;
  };

  if (special === "typewriter") {
    const n = Math.floor(clamp(f / Math.max(0.5, stagger)) * 0 + f / Math.max(0.5, stagger));
    const vis = L.glyphs.slice(0, Math.min(L.glyphs.length, n));
    ctx.fillStyle = fs;
    for (const g of vis) ctx.fillText(g.ch, g.x, L.lines[g.line].y);
    const last = vis.at(-1);
    const cx = last ? last.x + last.w + 4 : (L.glyphs[0]?.x ?? 0);
    const cy = last ? L.lines[last.line].y : (L.lines[0]?.y ?? 0);
    if (Math.floor(t * 2) % 2 === 0 || n < L.glyphs.length) { ctx.fillStyle = colors[0] ?? theme.colors.primary; ctx.fillRect(cx, cy - size * 0.42, Math.max(2, size * 0.06), size * 0.84); }
  } else if (preset.split === "none" || reduced) {
    const s = identityState();
    if (!reduced) {
      const pr = entranceProgress({ ...unitCfg, preset: preset.unit ?? "fade" }, f, fps);
      applyDelta(s, presetDelta({ ...unitCfg, preset: preset.unit ?? "fade" }, pr, 3));
    } else s.opacity = clamp(f / 12);
    // group by line so line-level draws remain crisp
    L.lines.forEach((_, li) => drawGlyphs(L.glyphs.filter((g) => g.line === li), s, fs, li));
  } else {
    const groups: Glyph[][] = [];
    if (preset.split === "char") L.glyphs.forEach((g) => groups.push([g]));
    else if (preset.split === "word") L.glyphs.forEach((g) => { (groups[g.word] ??= []).push(g); });
    else L.glyphs.forEach((g) => { (groups[g.line] ??= []).push(g); });
    groups.forEach((gs, i) => {
      if (!gs?.length) return;
      const s = identityState();
      const pr = entranceProgress({ ...unitCfg, delay: order(i) * stagger }, f, fps);
      applyDelta(s, presetDelta(unitCfg, pr, i));
      drawGlyphs(gs, s, fs, i);
    });
  }

  // Decorations on top
  const bottom = L.height / 2;
  if (special === "underline" || special === "strike") {
    const pr = getEase("easeInOutCubic")(clamp((f - 10) / 24));
    const y = special === "underline" ? bottom + size * 0.05 : 0;
    ctx.fillStyle = colors[0] ?? theme.colors.primary;
    const x0 = alignOffset - L.width / 2;
    ctx.fillRect(x0, y - size * 0.03, L.width * pr, Math.max(2, size * 0.06));
  }
  if (special === "shine" || special === "spotlight") {
    const sweep = ((t * 0.45) % 1.6) - 0.3;
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    const x = alignOffset - L.width / 2 + L.width * sweep;
    const g = ctx.createLinearGradient(x - size, 0, x + size, 0);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, special === "spotlight" ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.75)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(alignOffset - L.width / 2 - size, -L.height / 2, L.width + size * 2, L.height);
    ctx.restore();
  }
  if (special === "karaoke" || special === "outlineFill") {
    const pr = clamp(f / (preset.duration ?? 60));
    ctx.save();
    ctx.beginPath();
    if (special === "karaoke") ctx.rect(alignOffset - L.width / 2, -L.height, L.width * pr, L.height * 2);
    else ctx.rect(alignOffset - L.width / 2 - 10, L.height / 2 - L.height * pr, L.width + 20, L.height * pr);
    ctx.clip();
    ctx.fillStyle = colors[0] ?? theme.colors.primary;
    for (const g of L.glyphs) ctx.fillText(g.ch, g.x, L.lines[g.line].y);
    ctx.restore();
    if (special === "outlineFill") { ctx.strokeStyle = color; ctx.lineWidth = 1.5; for (const g of L.glyphs) ctx.strokeText(g.ch, g.x, L.lines[g.line].y); }
  }
  if (special === "splitColor") {
    ctx.save(); ctx.beginPath(); ctx.rect(-rc.w, 0, rc.w * 2, L.height); ctx.clip();
    ctx.fillStyle = colors[0] ?? theme.colors.primary;
    for (const g of L.glyphs) ctx.fillText(g.ch, g.x, L.lines[g.line].y);
    ctx.restore();
  }
  if (special === "glitch" && !reduced) {
    const r2 = mulberry32(Math.floor(t * 12) + 5);
    if (r2() > 0.4) {
      for (let k = 0; k < 3; k++) {
        const y = (r2() - 0.5) * L.height, hh = r2() * size * 0.25 + 2, dx = (r2() - 0.5) * size * 0.4;
        ctx.save(); ctx.beginPath(); ctx.rect(-rc.w, y, rc.w * 2, hh); ctx.clip();
        ctx.fillStyle = k % 2 ? "#00f0ff" : "#ff2bd6";
        for (const g of L.glyphs) ctx.fillText(g.ch, g.x + dx, L.lines[g.line].y);
        ctx.restore();
      }
    }
  }
}

registerNodeRenderer(
  "text",
  (rc, node, st) => drawKineticText(rc, node, st),
  (node, d) => {
    const size = (node.props.size as number) ?? 96;
    const lines = String(node.props.text ?? "").split("\n").length;
    return { w: Math.min((node.props.maxWidth as number) ?? d.w * 0.8, String(node.props.text ?? "").length * size * 0.55), h: size * 1.2 * lines };
  },
);

export function themeFont(theme: Theme) { return theme.font; }
