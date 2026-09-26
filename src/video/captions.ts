/* Caption pipeline: SRT / VTT / JSON parsing → editable cues → animated caption styles. */
import { clamp, getEase, withAlpha } from "@/core/math";
import type { CaptionCue, CaptionTrack } from "@/core/types";
import type { Theme } from "@/themes";
import { rr, type Ctx2D } from "@/render/core";

const ts = (s: string) => { const m = /(?:(\d+):)?(\d+):(\d+)[,.](\d+)/.exec(s.trim()); if (!m) return 0; return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0").slice(0, 3)) / 1000; };
export function parseSRT(src: string): CaptionCue[] {
  return src.replace(/\r/g, "").split(/\n\n+/).map((block) => {
    const lines = block.trim().split("\n");
    const tl = lines.findIndex((l) => l.includes("-->"));
    if (tl < 0) return null;
    const [a, b] = lines[tl].split("-->");
    const textLines = lines.slice(tl + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    const sp = /^([A-Z][\w ]{0,20}):\s*(.*)$/.exec(textLines);
    return { start: ts(a), end: ts(b), text: sp ? sp[2] : textLines, ...(sp ? { speaker: sp[1] } : {}) } as CaptionCue;
  }).filter((c): c is CaptionCue => !!c && c.text.length > 0 && c.end > c.start);
}
export const parseVTT = (src: string) => parseSRT(src.replace(/^WEBVTT[^\n]*\n/, "").replace(/<v ([^>]+)>/g, "$1: "));
export function parseCaptionJSON(src: string): CaptionCue[] {
  const raw = JSON.parse(src) as unknown;
  const arr = Array.isArray(raw) ? raw : (raw as { cues?: unknown[] }).cues ?? [];
  return (arr as Record<string, unknown>[]).map((c) => ({ start: Number(c.start), end: Number(c.end), text: String(c.text ?? "").slice(0, 500), ...(c.speaker ? { speaker: String(c.speaker) } : {}) })).filter((c) => Number.isFinite(c.start) && c.end > c.start);
}
export function parseCaptions(src: string, filename = ""): CaptionCue[] {
  const s = src.trim();
  if (filename.endsWith(".json") || s.startsWith("[") || s.startsWith("{")) return parseCaptionJSON(s);
  if (filename.endsWith(".vtt") || s.startsWith("WEBVTT")) return parseVTT(s);
  return parseSRT(s);
}
export function toSRT(cues: CaptionCue[]) {
  const f = (t: number) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`; };
  return cues.map((c, i) => `${i + 1}\n${f(c.start)} --> ${f(c.end)}\n${c.speaker ? c.speaker + ": " : ""}${c.text}`).join("\n\n");
}
/** Evenly distribute a script into timed cues (for quick caption authoring). */
export function scriptToCues(script: string, start = 0.5, wordsPerSecond = 2.6, maxWords = 6): CaptionCue[] {
  const words = script.split(/\s+/).filter(Boolean);
  const cues: CaptionCue[] = [];
  let t = start;
  for (let i = 0; i < words.length; i += maxWords) { const chunk = words.slice(i, i + maxWords); const d = chunk.length / wordsPerSecond; cues.push({ start: t, end: t + d, text: chunk.join(" ") }); t += d; }
  return cues;
}

export const CAPTION_STYLES: Record<string, { name: string; description: string; tags: string[] }> = {
  basic: { name: "Basic", description: "Clean centred subtitle.", tags: ["subtitle", "minimal"] },
  wordByWord: { name: "Word by Word", description: "Words appear as they're spoken.", tags: ["social", "kinetic"] },
  karaoke: { name: "Karaoke", description: "Active word colour sweep.", tags: ["music", "social"] },
  highlight: { name: "Highlight", description: "Active word gets a marker box.", tags: ["social", "shorts", "tiktok"] },
  kinetic: { name: "Kinetic", description: "Active word pops large with spring.", tags: ["shorts", "reels", "energetic"] },
  speaker: { name: "Speaker", description: "Speaker label + subtitle for interviews.", tags: ["podcast", "interview"] },
  social: { name: "Social Bold", description: "Heavy uppercase with stroke (short-form).", tags: ["tiktok", "reels", "shorts"] },
  aiSubtitle: { name: "AI Gradient", description: "Glassy pill with gradient active word.", tags: ["ai", "saas", "futuristic"] },
  youtube: { name: "YouTube", description: "Classic boxed YouTube CC style.", tags: ["youtube", "accessibility"] },
};

export function drawCaptions(ctx: Ctx2D, track: CaptionTrack, tSec: number, w: number, h: number, th: Theme) {
  if (track.hidden) return;
  const cue = track.cues.find((c) => tSec >= c.start && tSec < c.end);
  if (!cue) return;
  const style = track.style in CAPTION_STYLES ? track.style : "basic";
  const P = track.props ?? {};
  const portrait = h > w;
  const size = Number(P.size ?? (style === "social" || style === "kinetic" ? (portrait ? 72 : 64) : portrait ? 48 : 40));
  const y = h * Number(P.y ?? (portrait ? 0.7 : 0.86));
  const accent = String(P.accent ?? th.colors.primary);
  const words = cue.text.split(/\s+/);
  const dur = cue.end - cue.start;
  const local = tSec - cue.start;
  const activeIdx = Math.min(words.length - 1, Math.floor((local / dur) * words.length));
  const upper = style === "social" || style === "kinetic";
  const weight = style === "social" || style === "kinetic" ? 900 : 600;
  ctx.save();
  ctx.font = `${weight} ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  const disp = words.map((wd) => (upper ? wd.toUpperCase() : wd));
  const space = ctx.measureText(" ").width;
  const widths = disp.map((d) => ctx.measureText(d).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * (disp.length - 1);
  const enter = getEase("emphasized")(clamp(local / 0.18));
  ctx.globalAlpha = enter;
  let x = w / 2 - total / 2;
  if (style === "youtube" || style === "basic" || style === "speaker" || style === "aiSubtitle") {
    const pad = size * 0.4;
    rr(ctx, x - pad, y - size * 0.75, total + pad * 2, size * 1.5, style === "aiSubtitle" ? size : style === "youtube" ? 4 : 12);
    ctx.fillStyle = style === "aiSubtitle" ? withAlpha(th.colors.surface, 0.75) : "rgba(0,0,0,0.72)";
    ctx.fill();
    if (style === "aiSubtitle") { ctx.strokeStyle = withAlpha(accent, 0.5); ctx.lineWidth = 1.5; ctx.stroke(); }
    if (style === "speaker" && cue.speaker) { ctx.font = `700 ${size * 0.5}px Inter, sans-serif`; ctx.fillStyle = accent; ctx.fillText(cue.speaker.toUpperCase(), x - pad, y - size * 1.25); ctx.font = `${weight} ${size}px Inter, sans-serif`; }
  }
  disp.forEach((wd, i) => {
    const ww = widths[i];
    const active = i === activeIdx;
    const shown = style !== "wordByWord" || i <= activeIdx;
    if (!shown) { x += ww + space; return; }
    ctx.save();
    let fill = "#ffffff";
    if (style === "karaoke") fill = i <= activeIdx ? accent : "rgba(255,255,255,0.6)";
    if (style === "highlight" && active) { rr(ctx, x - size * 0.12, y - size * 0.62, ww + size * 0.24, size * 1.24, size * 0.18); ctx.fillStyle = accent; ctx.fill(); }
    if (style === "aiSubtitle" && active) { const g = ctx.createLinearGradient(x, 0, x + ww, 0); th.gradient.forEach((c, k) => g.addColorStop(k / Math.max(1, th.gradient.length - 1), c)); fill = g as unknown as string; }
    if (style === "kinetic" && active) { const wordStart = cue.start + (activeIdx / words.length) * dur; const k = getEase("overshoot")(clamp((tSec - wordStart) / 0.2)); ctx.translate(x + ww / 2, y); ctx.scale(1 + 0.25 * k, 1 + 0.25 * k); ctx.translate(-(x + ww / 2), -y); fill = accent; }
    if (style === "wordByWord" && active) { const wordStart = cue.start + (activeIdx / words.length) * dur; const k = getEase("emphasized")(clamp((tSec - wordStart) / 0.15)); ctx.globalAlpha *= k; ctx.translate(0, (1 - k) * size * 0.3); }
    if (style === "social" || style === "kinetic") { ctx.lineWidth = size * 0.14; ctx.strokeStyle = "#000"; ctx.lineJoin = "round"; ctx.strokeText(wd, x, y); if (style === "social" && active) fill = String(P.highlight ?? "#ffe14d"); }
    if (style === "wordByWord") { ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12; }
    ctx.fillStyle = fill;
    ctx.fillText(wd, x, y);
    ctx.restore();
    x += ww + space;
  });
  ctx.restore();
}
