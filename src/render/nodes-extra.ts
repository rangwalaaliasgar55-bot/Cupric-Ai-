/* Node renderers for backgrounds, shaders, particles and logos. */
import { clamp, getEase, hash1, hashString, withAlpha, mulberry32 } from "@/core/math";
import type { SceneNode } from "@/core/types";
import { drawBackground, type BgParams } from "@/graphics/backgrounds";
import { drawParticles, PARTICLE_PRESETS } from "@/graphics/particles";
import { renderShader } from "@/effects/shaders";
import { registerNodeRenderer, p, colorsOf, getImage, glowSprite, linearGrad, QUALITY_SCALE, type RenderContext } from "./core";
import { shapePoints } from "./shapes";
import { FONT_PRESETS } from "@/themes";

function bgParams(rc: RenderContext, node: SceneNode): BgParams {
  const audioBoost = p<string>(node, "audioReactive", "none") === "none" ? 0 : rc.audio[p<string>(node, "audioReactive", "bass") as "bass"] ?? 0;
  return {
    colors: colorsOf(node, rc.theme), speed: p<number>(node, "speed", 1), density: p<number>(node, "density", 1), scale: p<number>(node, "scale", 1),
    noise: p<number>(node, "noise", 0.2), intensity: p<number>(node, "intensity", 1) * (1 + audioBoost * 0.8), opacity: p<number>(node, "opacity", 1),
    direction: p<number>(node, "direction", 135), blur: p<number>(node, "blur", 0), seed: p<number>(node, "seed", 7), base: rc.theme.colors.bg,
  };
}
const full = (_n: SceneNode, d: { w: number; h: number }) => ({ w: d.w, h: d.h });

registerNodeRenderer("background", (rc, node) => {
  const { ctx, w, h } = rc;
  ctx.save(); ctx.translate(-w / 2, -h / 2);
  if (p<boolean>(node, "fillBase", true)) { ctx.fillStyle = p<string>(node, "base", rc.theme.colors.bg); ctx.fillRect(0, 0, w, h); }
  const P = bgParams(rc, node);
  if (P.blur > 0 && rc.quality !== "low") ctx.filter = `blur(${P.blur}px)`;
  drawBackground(p<string>(node, "variant", "mesh"), ctx, w, h, rc.frame / rc.fps, P, rc.theme, QUALITY_SCALE[rc.quality]);
  ctx.restore();
}, full, true);

registerNodeRenderer("shader", (rc, node) => {
  const { ctx, w, h } = rc;
  const P = bgParams(rc, node);
  const scale = rc.quality === "low" ? 0.35 : rc.quality === "medium" ? 0.5 : rc.quality === "ultra" ? 1 : 0.75;
  const out = renderShader(p<string>(node, "shader", "liquid"), w * scale, h * scale, { time: rc.frame / rc.fps, colors: P.colors, speed: P.speed, scale: P.scale, intensity: P.intensity, seed: P.seed });
  ctx.save(); ctx.translate(-w / 2, -h / 2); ctx.globalAlpha *= P.opacity;
  if (out) ctx.drawImage(out, 0, 0, w, h);
  else drawBackground("flowingNoise", ctx, w, h, rc.frame / rc.fps, P, rc.theme, QUALITY_SCALE[rc.quality]); // deterministic fallback
  ctx.restore();
}, full, true);

registerNodeRenderer("particles", (rc, node) => {
  const { ctx, w, h } = rc;
  const preset = PARTICLE_PRESETS[p<string>(node, "preset", "stars")] ?? PARTICLE_PRESETS.stars;
  const overrides: Record<string, unknown> = {};
  for (const k of ["count", "speed", "gravity", "turbulence", "trails", "glow"] as const) if (node.props[k] !== undefined) overrides[k] = node.props[k];
  if (Array.isArray(node.props.colors) && (node.props.colors as unknown[]).length) overrides.colors = node.props.colors;
  const react = p<string>(node, "audioReactive", "none");
  const boost = react === "none" ? 1 : 1 + (rc.audio[react as "bass"] ?? 0) * 1.5;
  ctx.save(); ctx.translate(-w / 2, -h / 2);
  drawParticles(ctx, w, h, rc.frame / rc.fps, { ...preset.config, ...overrides } as typeof preset.config, rc.theme, p<number>(node, "seed", hashString(node.id) % 997), QUALITY_SCALE[rc.quality], p<number>(node, "intensity", 1) * boost);
  ctx.restore();
}, full, true);

/* ---------------- Logo animation system ---------------- */
export const LOGO_STYLES: Record<string, { name: string; tags: string[]; description: string; duration: number }> = {
  fade: { name: "Fade", tags: ["minimal"], description: "Soft fade with slight scale.", duration: 1.2 },
  minimal: { name: "Minimal", tags: ["minimal", "clean"], description: "Mark then wordmark slide.", duration: 1.4 },
  lineDraw: { name: "Line Draw", tags: ["elegant", "outline"], description: "Mark outline draws, then fills.", duration: 2 },
  shapeBuild: { name: "Shape Build", tags: ["geometric", "tech"], description: "Mark assembles from rotating shards.", duration: 1.8 },
  particle: { name: "Particle Assemble", tags: ["particles", "ai", "magic"], description: "Particles converge into the mark.", duration: 2.2 },
  lightSweep: { name: "Light Sweep", tags: ["premium", "shine"], description: "Specular sweep across the logo.", duration: 2 },
  glitch: { name: "Glitch", tags: ["cyber", "gaming"], description: "Glitch-in with RGB split.", duration: 1.4 },
  neon: { name: "Neon", tags: ["neon", "night"], description: "Neon tube flicker on.", duration: 1.8 },
  chrome: { name: "Chrome", tags: ["chrome", "premium"], description: "Chrome gradient with shine.", duration: 2 },
  glass: { name: "Glass", tags: ["glass", "frosted"], description: "Frosted glass plate reveal.", duration: 1.8 },
  liquid: { name: "Liquid", tags: ["liquid", "fluid"], description: "Liquid fill rising inside the wordmark.", duration: 2.2 },
  holographic: { name: "Holographic", tags: ["holographic", "futuristic"], description: "Hue-shifting foil.", duration: 2 },
  energy: { name: "Energy", tags: ["energy", "electric"], description: "Charging rings then burst.", duration: 2 },
  luxury: { name: "Luxury", tags: ["luxury", "gold"], description: "Slow gold reveal with tracking.", duration: 3 },
  logo3d: { name: "3D Extrude", tags: ["3d", "bold"], description: "Extruded depth with tilt.", duration: 1.8 },
  stamp: { name: "Stamp", tags: ["impact", "bold"], description: "Slams in with shake.", duration: 1 },
  typewriter: { name: "Typewriter", tags: ["code", "tech"], description: "Wordmark types in.", duration: 1.8 },
  split: { name: "Split Reveal", tags: ["editorial"], description: "Halves slide apart to reveal.", duration: 1.6 },
  orbitRing: { name: "Orbit Ring", tags: ["space", "ai"], description: "Orbiting ring settles around mark.", duration: 2 },
  zoomThrough: { name: "Zoom Through", tags: ["energetic", "youtube"], description: "Rushes out of depth.", duration: 1.2 },
  blurFocus: { name: "Blur Focus", tags: ["cinematic"], description: "Rack focus into logo.", duration: 1.6 },
  strokeFill: { name: "Stroke to Fill", tags: ["outline"], description: "Outline wordmark fills in.", duration: 1.8 },
  kinetic: { name: "Kinetic Letters", tags: ["kinetic", "playful"], description: "Letters bounce in sequence.", duration: 1.6 },
  spinMark: { name: "Spin Mark", tags: ["dynamic"], description: "Mark spins in, wordmark follows.", duration: 1.6 },
  pixelBuild: { name: "Pixel Build", tags: ["retro", "gaming"], description: "Mark builds from pixels.", duration: 1.8 },
  shutter: { name: "Shutter", tags: ["camera", "photo"], description: "Aperture blades open.", duration: 1.4 },
  burst: { name: "Burst", tags: ["celebration"], description: "Radial burst behind the logo.", duration: 1.6 },
  inkReveal: { name: "Ink Reveal", tags: ["organic", "artistic"], description: "Ink blot mask reveal.", duration: 1.8 },
  gradientFlow: { name: "Gradient Flow", tags: ["saas", "vibrant"], description: "Flowing gradient wordmark.", duration: 1.6 },
  pulseRings: { name: "Pulse Rings", tags: ["tech", "signal"], description: "Sonar rings emanate from the mark.", duration: 1.8 },
};

registerNodeRenderer("logo", (rc, node) => {
  const { ctx, theme } = rc;
  const t = (rc.frame - node.timing.start) / rc.fps;
  const style = p<string>(node, "style", "minimal");
  const def = LOGO_STYLES[style] ?? LOGO_STYLES.minimal;
  const k = clamp(t / def.duration);
  const ek = getEase("emphasized")(k);
  const name = p<string>(node, "text", "Cupric");
  const size = p<number>(node, "size", 120);
  const colors = colorsOf(node, theme);
  const markKind = p<string>(node, "mark", "spark");
  const font = FONT_PRESETS[p<string>(node, "fontPreset", theme.font.id)] ?? theme.font;
  ctx.font = `${font.displayWeight >= 500 ? 700 : font.displayWeight} ${size}px ${font.display}`;
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(name).width;
  const ms = size * 1.05;
  const gap = size * 0.35;
  const hasMark = markKind !== "none";
  const total = (hasMark ? ms + gap : 0) + tw;
  const mx = -total / 2 + ms / 2, tx = -total / 2 + (hasMark ? ms + gap : 0);
  const img = markKind === "image" ? getImage(node.props.src) : undefined;
  const pts = shapePoints(markKind === "hex" ? "hexagon" : markKind === "spark" ? "star" : markKind === "ring" ? "circle" : markKind === "image" ? "roundedRect" : markKind, ms, ms, { points: 4, inner: 0.28, radius: ms * 0.25 });
  const markPath = () => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(mx + x, y) : ctx.moveTo(mx + x, y))); ctx.closePath(); };
  const markFill = style === "chrome" ? linearGrad(ctx, ["#ffffff", "#9aa3b2", "#2b2f38", "#e9ecf2"], 0, -ms / 2, 0, ms / 2) : style === "luxury" ? linearGrad(ctx, ["#fff4d6", "#e2b85a", "#7a5a1c", "#f5d98a"], 0, -ms / 2, 0, ms / 2) : linearGrad(ctx, colors, mx - ms / 2, -ms / 2, mx + ms / 2, ms / 2);
  const drawMark = (alpha = 1, fill = true) => { if (!hasMark) return; ctx.save(); ctx.globalAlpha *= alpha; if (img) { ctx.save(); markPath(); ctx.clip(); ctx.drawImage(img, mx - ms / 2, -ms / 2, ms, ms); ctx.restore(); } else { markPath(); if (fill) { ctx.fillStyle = markFill; ctx.fill(); } if (markKind === "ring") { ctx.globalCompositeOperation = "destination-out"; ctx.beginPath(); ctx.arc(mx, 0, ms * 0.28, 0, Math.PI * 2); ctx.fill(); } } ctx.restore(); };
  const wordFill = style === "chrome" ? linearGrad(ctx, ["#ffffff", "#c9ced8", "#6b7280", "#ffffff"], 0, -size / 2, 0, size / 2) : style === "luxury" ? linearGrad(ctx, ["#fff1c1", "#d4b16a", "#8a6a2a"], 0, -size / 2, 0, size / 2) : style === "gradientFlow" || style === "holographic" ? linearGrad(ctx, [...colors, colors[0]], tx - tw * ((t * 0.3) % 1), 0, tx + tw * (2 - ((t * 0.3) % 1)), 0) : p<string>(node, "color", theme.colors.text);
  const drawWord = (alpha = 1, dx = 0) => { ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = wordFill; ctx.fillText(name, tx + dx, size * 0.04); ctx.restore(); };

  switch (style) {
    case "fade": ctx.globalAlpha *= ek; ctx.scale(0.96 + 0.04 * ek, 0.96 + 0.04 * ek); drawMark(); drawWord(); break;
    case "lineDraw": { markPath(); ctx.strokeStyle = colors[0]; ctx.lineWidth = 3; const len = ms * 4; ctx.setLineDash([len * clamp(k * 1.6), len]); ctx.stroke(); ctx.setLineDash([]); drawMark(clamp((k - 0.55) / 0.3)); drawWord(clamp((k - 0.6) / 0.3), (1 - clamp((k - 0.6) / 0.4)) * -20); break; }
    case "shapeBuild": { for (let i = 0; i < 6; i++) { const kk = getEase("easeOutBack")(clamp((k - i * 0.06) / 0.6)); ctx.save(); ctx.translate(mx, 0); ctx.rotate((1 - kk) * (i - 3)); ctx.translate(-mx + (1 - kk) * (i - 3) * 60, (1 - kk) * (i % 2 ? 80 : -80)); ctx.beginPath(); ctx.moveTo(mx, 0); const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2; ctx.lineTo(mx + Math.cos(a0) * ms / 2, Math.sin(a0) * ms / 2); ctx.lineTo(mx + Math.cos(a1) * ms / 2, Math.sin(a1) * ms / 2); ctx.closePath(); ctx.fillStyle = colors[i % colors.length]; ctx.globalAlpha *= kk; ctx.fill(); ctx.restore(); } drawWord(clamp((k - 0.6) / 0.3)); break; }
    case "particle": { const n = 220; const rnd = mulberry32(5); ctx.save(); ctx.globalCompositeOperation = "lighter"; for (let i = 0; i < n; i++) { const q = pts[Math.floor(rnd() * pts.length)]; const tx0 = mx + q[0] * rnd(), ty0 = q[1] * rnd(); const sx = (rnd() - 0.5) * rc.w, sy = (rnd() - 0.5) * rc.h; const kk = getEase("easeInOutCubic")(clamp((k - rnd() * 0.3) / 0.6)); ctx.drawImage(glowSprite(colors[i % colors.length], 32), sx + (tx0 - sx) * kk - 4, sy + (ty0 - sy) * kk - 4, 8, 8); } ctx.restore(); drawMark(clamp((k - 0.75) / 0.2)); drawWord(clamp((k - 0.8) / 0.2)); break; }
    case "glitch": { const on = k < 0.7 && hash1(Math.floor(t * 20)) > 0.4; for (const [c, dx] of [["#ff2bd6", -8], ["#00f0ff", 8]] as const) if (k < 0.8) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha *= 0.6 * (1 - k); ctx.fillStyle = c; ctx.fillText(name, tx + dx * (on ? 2 : 1), 0); ctx.restore(); } ctx.globalAlpha *= k < 0.1 ? 0 : on ? 0.4 : 1; ctx.translate(on ? (hash1(t * 50) - 0.5) * 30 : 0, 0); drawMark(); drawWord(); break; }
    case "neon": { const lit = k > 0.8 || hash1(Math.floor(t * 18)) > 0.45; ctx.shadowColor = colors[0]; ctx.shadowBlur = lit ? size * 0.4 : 0; ctx.globalAlpha *= lit ? 1 : 0.15; ctx.strokeStyle = colors[0]; ctx.lineWidth = 3; if (hasMark) { markPath(); ctx.stroke(); } ctx.strokeText(name, tx, 0); ctx.fillStyle = "#fff"; ctx.globalAlpha *= 0.9; ctx.fillText(name, tx, 0); break; }
    case "glass": { ctx.save(); ctx.globalAlpha *= ek; ctx.beginPath(); ctx.roundRect(-total / 2 - 60, -size, total + 120, size * 2, 32); ctx.fillStyle = withAlpha("#ffffff", 0.08); ctx.fill(); ctx.strokeStyle = withAlpha("#ffffff", 0.25); ctx.stroke(); ctx.restore(); ctx.filter = `blur(${(1 - ek) * 12}px)`; drawMark(ek); drawWord(ek); ctx.filter = "none"; break; }
    case "liquid": { drawMark(ek); ctx.save(); ctx.strokeStyle = withAlpha(theme.colors.text, 0.35); ctx.lineWidth = 1.5; ctx.strokeText(name, tx, 0); ctx.beginPath(); const lvl = size / 2 - size * 1.1 * ek; ctx.moveTo(tx - 10, size); for (let x = 0; x <= tw + 20; x += 8) ctx.lineTo(tx - 10 + x, lvl + Math.sin(x / 30 + t * 5) * 6); ctx.lineTo(tx + tw + 10, size); ctx.closePath(); ctx.clip(); ctx.fillStyle = linearGrad(ctx, colors, tx, 0, tx + tw, 0); ctx.fillText(name, tx, 0); ctx.restore(); break; }
    case "energy": { for (let i = 0; i < 3; i++) { const r = ms * (0.2 + (1 - ek) * (1.5 + i * 0.5)); ctx.strokeStyle = withAlpha(colors[i % colors.length], 0.7 * (1 - ek)); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(mx, 0, r, t * 4 + i, t * 4 + i + 4); ctx.stroke(); } if (k > 0.7) { const b = clamp((k - 0.7) / 0.3); ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha *= 1 - b; ctx.drawImage(glowSprite(colors[0], 128), mx - ms * 2 * b - 20, -ms * 2 * b - 20, ms * 4 * b + 40, ms * 4 * b + 40); ctx.restore(); } drawMark(clamp((k - 0.6) / 0.2)); drawWord(clamp((k - 0.7) / 0.2)); break; }
    case "luxury": { ctx.globalAlpha *= getEase("luxury")(k); const track = (1 - getEase("luxury")(k)) * 0.3 * size; drawMark(); ctx.fillStyle = wordFill; let x = tx; for (const ch of name) { ctx.fillText(ch, x, 0); x += ctx.measureText(ch).width + track; } break; }
    case "logo3d": { ctx.transform(1, 0, -0.15 * (1 - ek), 1, 0, 0); for (let d = 12; d > 0; d--) { ctx.fillStyle = withAlpha(colors[1] ?? colors[0], 0.5); ctx.fillText(name, tx + d * 1.2 * ek, d * 1.2 * ek); } ctx.globalAlpha *= ek; drawMark(); drawWord(); break; }
    case "stamp": { const s = 1 + (1 - getEase("easeOutExpo")(k)) * 2; const shake = k > 0.3 && k < 0.6 ? Math.sin(t * 80) * 8 : 0; ctx.translate(shake, 0); ctx.scale(s, s); ctx.globalAlpha *= clamp(k * 4); drawMark(); drawWord(); break; }
    case "typewriter": { drawMark(clamp(k * 3)); const n = Math.floor(clamp((k - 0.2) / 0.7) * name.length); ctx.fillStyle = wordFill; ctx.fillText(name.slice(0, n), tx, 0); if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = colors[0]; ctx.fillRect(tx + ctx.measureText(name.slice(0, n)).width + 6, -size * 0.4, size * 0.07, size * 0.8); } break; }
    case "split": { ctx.save(); ctx.beginPath(); ctx.rect(-rc.w, -rc.h, rc.w * 2, rc.h); ctx.clip(); ctx.translate(0, -(1 - ek) * size); ctx.globalAlpha *= ek; drawMark(); drawWord(); ctx.restore(); ctx.save(); ctx.beginPath(); ctx.rect(-rc.w, 0, rc.w * 2, rc.h); ctx.clip(); ctx.translate(0, (1 - ek) * size); ctx.globalAlpha *= ek; drawMark(); drawWord(); ctx.restore(); break; }
    case "orbitRing": { ctx.save(); ctx.translate(mx, 0); ctx.rotate(-0.4); ctx.scale(1, 0.35); ctx.strokeStyle = colors[0]; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, ms * (0.9 + (1 - ek) * 2), t * 2, t * 2 + Math.PI * 1.6 * ek + 0.1); ctx.stroke(); ctx.restore(); drawMark(ek); drawWord(clamp((k - 0.4) / 0.4)); break; }
    case "zoomThrough": { const s = 4 - 3 * getEase("easeOutExpo")(k); ctx.scale(s, s); ctx.filter = `blur(${(1 - k) * 16}px)`; ctx.globalAlpha *= clamp(k * 2); drawMark(); drawWord(); ctx.filter = "none"; break; }
    case "blurFocus": ctx.filter = `blur(${(1 - ek) * 24}px)`; ctx.globalAlpha *= 0.3 + 0.7 * ek; drawMark(); drawWord(); ctx.filter = "none"; break;
    case "strokeFill": { ctx.strokeStyle = theme.colors.text; ctx.lineWidth = 2; ctx.strokeText(name, tx, 0); if (hasMark) { markPath(); ctx.stroke(); } drawMark(clamp((k - 0.4) / 0.4)); drawWord(clamp((k - 0.4) / 0.4)); break; }
    case "kinetic": { drawMark(clamp(k * 3)); let x = tx; [...name].forEach((ch, i) => { const kk = getEase("easeOutBack")(clamp((k - i * 0.05) / 0.4)); ctx.save(); ctx.globalAlpha *= kk; ctx.fillStyle = wordFill; ctx.fillText(ch, x, (1 - kk) * -size); ctx.restore(); x += ctx.measureText(ch).width; }); break; }
    case "spinMark": { ctx.save(); ctx.translate(mx, 0); ctx.rotate((1 - getEase("easeOutBack")(clamp(k / 0.6))) * Math.PI * 2); ctx.scale(clamp(k / 0.3), clamp(k / 0.3)); ctx.translate(-mx, 0); drawMark(); ctx.restore(); drawWord(clamp((k - 0.5) / 0.3), (1 - clamp((k - 0.5) / 0.5)) * -40); break; }
    case "pixelBuild": { const cells = 10, cs = ms / cells; ctx.save(); markPath(); ctx.clip(); for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) if (hash1(x * 7 + y * 13) < k * 1.4) { ctx.fillStyle = colors[(x + y) % colors.length]; ctx.fillRect(mx - ms / 2 + x * cs, -ms / 2 + y * cs, cs - 1, cs - 1); } ctx.restore(); drawWord(clamp((k - 0.6) / 0.3)); break; }
    case "shutter": { drawMark(); drawWord(); const open = getEase("easeInOutCubic")(k); ctx.fillStyle = theme.colors.bg; for (let i = 0; i < 6; i++) { ctx.save(); ctx.rotate((i / 6) * Math.PI * 2 + open); ctx.fillRect(-rc.w, (1 - open) * -10 + open * total * 0.6, rc.w * 2, rc.h); ctx.restore(); } break; }
    case "burst": { const b = getEase("easeOutExpo")(k); for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ctx.strokeStyle = withAlpha(colors[i % colors.length], 1 - b); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * ms * b, Math.sin(a) * ms * b); ctx.lineTo(mx + Math.cos(a) * ms * (0.4 + b * 1.4), Math.sin(a) * ms * (0.4 + b * 1.4)); ctx.stroke(); } ctx.scale(0.8 + 0.2 * getEase("overshoot")(k), 0.8 + 0.2 * getEase("overshoot")(k)); drawMark(clamp(k * 3)); drawWord(clamp(k * 2)); break; }
    case "inkReveal": { ctx.save(); ctx.beginPath(); const rnd = mulberry32(3); for (let i = 0; i < 7; i++) { const x = (rnd() - 0.5) * total, y = (rnd() - 0.5) * size, r = Math.max(0, k - rnd() * 0.3) * total * 0.7; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); } ctx.clip(); drawMark(); drawWord(); ctx.restore(); break; }
    case "pulseRings": { for (let i = 0; i < 3; i++) { const ph = (t * 0.8 + i / 3) % 1; ctx.strokeStyle = withAlpha(colors[0], (1 - ph) * 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, 0, ms * 0.5 + ph * ms * 1.5, 0, Math.PI * 2); ctx.stroke(); } drawMark(ek); drawWord(clamp((k - 0.3) / 0.4)); break; }
    case "lightSweep": case "chrome": case "holographic": case "gradientFlow": default: {
      ctx.globalAlpha *= ek; ctx.translate((1 - ek) * -20, 0); drawMark(); drawWord();
      if (style === "lightSweep" || style === "chrome") { const x = -total / 2 - 200 + (((t * 0.5) % 1.4) / 1.4) * (total + 400); ctx.save(); ctx.globalCompositeOperation = "source-atop"; ctx.transform(1, 0, -0.4, 1, 0, 0); const g = ctx.createLinearGradient(x - 80, 0, x + 80, 0); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,0.85)"); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - 80, -size, 160, size * 2); ctx.restore(); }
    }
  }
  if (p<string>(node, "tagline", "")) { ctx.globalAlpha = clamp((k - 0.7) / 0.3); ctx.font = `500 ${size * 0.22}px ${font.body}`; ctx.fillStyle = theme.colors.muted; ctx.textAlign = "center"; ctx.fillText(p<string>(node, "tagline", ""), 0, size * 0.95); }
}, (node) => ({ w: String(node.props.text ?? "Logo").length * ((node.props.size as number) ?? 120) * 0.6 + 200, h: ((node.props.size as number) ?? 120) * 1.4 }));
