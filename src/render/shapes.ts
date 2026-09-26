/* Shape engine: every shape is a resampled closed/open polyline → universal morphing, path drawing,
 * noise deformation, dashes and gradient fills. SVG path strings are sampled via SVGPathElement. */
import { clamp, getEase, lerp, noise3 } from "@/core/math";
import type { SceneNode } from "@/core/types";
import { registerNodeRenderer, angleGrad, p, withAlpha, type RenderContext } from "./core";

export type Pt = [number, number];
export const SHAPES = ["circle", "rect", "roundedRect", "triangle", "polygon", "star", "line", "arrow", "ring", "blob", "capsule", "heart", "cross", "spiral", "wave", "hexagon", "diamond", "burst", "check", "infinity", "path"] as const;
const N = 160;

function resample(pts: Pt[], n = N, closed = true): Pt[] {
  const src = closed ? [...pts, pts[0]] : pts;
  const lens = [0];
  for (let i = 1; i < src.length; i++) lens.push(lens[i - 1] + Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]));
  const total = lens[lens.length - 1] || 1;
  const out: Pt[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const d = (k / (closed ? n : n - 1)) * total;
    while (j < lens.length - 1 && lens[j] < d) j++;
    const seg = lens[j] - lens[j - 1] || 1;
    const t = (d - lens[j - 1]) / seg;
    out.push([lerp(src[j - 1][0], src[j][0], t), lerp(src[j - 1][1], src[j][1], t)]);
  }
  return out;
}
const svgCache = new Map<string, Pt[]>();
function samplePath(d: string, w: number, h: number): Pt[] {
  const key = `${d}|${w}|${h}`;
  const hit = svgCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return shapePoints("circle", w, h, {});
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  svg.style.position = "absolute"; svg.style.visibility = "hidden";
  document.body.appendChild(svg);
  let pts: Pt[] = [];
  try {
    const L = path.getTotalLength();
    const bb = path.getBBox();
    const s = Math.min(w / (bb.width || 1), h / (bb.height || 1));
    for (let i = 0; i < N; i++) { const q = path.getPointAtLength((i / N) * L); pts.push([(q.x - bb.x - bb.width / 2) * s, (q.y - bb.y - bb.height / 2) * s]); }
  } catch { pts = shapePoints("circle", w, h, {}); }
  svg.remove();
  svgCache.set(key, pts);
  return pts;
}

export function shapePoints(shape: string, w: number, h: number, o: { sides?: number; points?: number; inner?: number; radius?: number; path?: string }): Pt[] {
  const rx = w / 2, ry = h / 2;
  const poly = (n: number, rot = -Math.PI / 2) => Array.from({ length: n }, (_, i) => [Math.cos(rot + (i / n) * Math.PI * 2) * rx, Math.sin(rot + (i / n) * Math.PI * 2) * ry] as Pt);
  switch (shape) {
    case "circle": case "ring": case "blob": return Array.from({ length: N }, (_, i) => [Math.cos((i / N) * Math.PI * 2 - Math.PI / 2) * rx, Math.sin((i / N) * Math.PI * 2 - Math.PI / 2) * ry] as Pt);
    case "rect": return resample([[-rx, -ry], [rx, -ry], [rx, ry], [-rx, ry]]);
    case "roundedRect": case "capsule": {
      const r = shape === "capsule" ? Math.min(rx, ry) : Math.min(o.radius ?? 32, rx, ry);
      const pts: Pt[] = [];
      const corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 10; i++) { const a = a0 + (i / 10) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
      corner(rx - r, -ry + r, -Math.PI / 2); corner(rx - r, ry - r, 0); corner(-rx + r, ry - r, Math.PI / 2); corner(-rx + r, -ry + r, Math.PI);
      return resample(pts);
    }
    case "triangle": return resample(poly(3));
    case "hexagon": return resample(poly(6, 0));
    case "diamond": return resample(poly(4));
    case "polygon": return resample(poly(Math.max(3, o.sides ?? 5)));
    case "star": case "burst": {
      const n = o.points ?? (shape === "burst" ? 16 : 5), inner = o.inner ?? (shape === "burst" ? 0.75 : 0.45);
      const pts: Pt[] = [];
      for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2; const r = i % 2 ? inner : 1; pts.push([Math.cos(a) * rx * r, Math.sin(a) * ry * r]); }
      return resample(pts);
    }
    case "heart": return Array.from({ length: N }, (_, i) => { const t = (i / N) * Math.PI * 2; const x = 16 * Math.sin(t) ** 3; const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)); return [(x / 17) * rx, (y / 17) * ry] as Pt; });
    case "cross": { const a = rx * 0.33, b = ry * 0.33; return resample([[-a, -ry], [a, -ry], [a, -b], [rx, -b], [rx, b], [a, b], [a, ry], [-a, ry], [-a, b], [-rx, b], [-rx, -b], [-a, -b]]); }
    case "infinity": return Array.from({ length: N }, (_, i) => { const t = (i / N) * Math.PI * 2; const d = 1 + Math.sin(t) ** 2; return [(Math.cos(t) / d) * rx, ((Math.sin(t) * Math.cos(t)) / d) * ry * 2] as Pt; });
    case "line": return resample([[-rx, 0], [rx, 0]], N, false);
    case "arrow": return resample([[-rx, 0], [rx, 0], [rx - ry, -ry], [rx, 0], [rx - ry, ry]], N, false);
    case "check": return resample([[-rx, 0], [-rx * 0.3, ry], [rx, -ry]], N, false);
    case "wave": return Array.from({ length: N }, (_, i) => [lerp(-rx, rx, i / (N - 1)), Math.sin((i / (N - 1)) * Math.PI * 4) * ry] as Pt);
    case "spiral": return Array.from({ length: N }, (_, i) => { const t = i / (N - 1); const a = t * Math.PI * 6; return [Math.cos(a) * rx * t, Math.sin(a) * ry * t] as Pt; });
    case "path": return o.path ? samplePath(o.path, w, h) : shapePoints("circle", w, h, {});
    default: return shapePoints("circle", w, h, {});
  }
}
export const OPEN_SHAPES = new Set(["line", "arrow", "check", "wave", "spiral"]);

/** Morph between two point sets (aligned by best rotation offset). */
export function morphPoints(a: Pt[], b: Pt[], t: number): Pt[] {
  const A = a.length === N ? a : resample(a), B = b.length === N ? b : resample(b);
  let best = 0, bestD = Infinity;
  for (let off = 0; off < N; off += 4) { let d = 0; for (let i = 0; i < N; i += 8) { const q = B[(i + off) % N]; d += (A[i][0] - q[0]) ** 2 + (A[i][1] - q[1]) ** 2; } if (d < bestD) { bestD = d; best = off; } }
  return A.map((pa, i) => { const q = B[(i + best) % N]; return [lerp(pa[0], q[0], t), lerp(pa[1], q[1], t)] as Pt; });
}

export function drawShape(rc: RenderContext, node: SceneNode) {
  const { ctx, theme, fps } = rc;
  const f = rc.frame - node.timing.start;
  const t = f / fps;
  const shape = p<string>(node, "shape", "circle");
  const w = p<number>(node, "w", 300), h = p<number>(node, "h", 300);
  const opts = { sides: p<number>(node, "sides", 6), points: p<number>(node, "points", 5), inner: p<number>(node, "inner", 0.45), radius: p<number>(node, "radius", 40), path: p<string>(node, "path", "") };
  let pts = shapePoints(shape, w, h, opts);
  const morphTo = p<string>(node, "morphTo", "none");
  if (morphTo !== "none") {
    const cycle = p<number>(node, "morphDuration", 40);
    const hold = 20;
    const period = (cycle + hold) * 2;
    const m = f % period;
    const k = m < hold ? 0 : m < hold + cycle ? (m - hold) / cycle : m < hold * 2 + cycle ? 1 : 1 - (m - hold * 2 - cycle) / cycle;
    pts = morphPoints(pts, shapePoints(morphTo, w, h, opts), getEase("easeInOutCubic")(clamp(k)));
  }
  const noise = p<number>(node, "noise", shape === "blob" ? 0.18 : 0);
  if (noise > 0) {
    const sp = p<number>(node, "speed", 0.6);
    pts = pts.map(([x, y], i) => { const a = (i / pts.length) * Math.PI * 2; const n = noise3(Math.cos(a) * 1.2, Math.sin(a) * 1.2, t * sp, 3) * noise; return [x * (1 + n), y * (1 + n)] as Pt; });
  }
  const open = OPEN_SHAPES.has(shape) && morphTo === "none";
  ctx.beginPath();
  if (shape === "circle" && morphTo === "none" && noise === 0) ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else { pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (!open) ctx.closePath(); }
  if (shape === "ring") { ctx.moveTo(w * 0.32, 0); ctx.ellipse(0, 0, w * 0.32, h * 0.32, 0, 0, Math.PI * 2, true); }

  const fillMode = p<string>(node, "fillMode", open ? "none" : "gradient");
  const colors = (node.props.colors as string[]) ?? [theme.colors.primary, theme.colors.secondary];
  const drawP = p<string>(node, "draw", "none") !== "none" ? getEase("easeInOutCubic")(clamp((f - p<number>(node, "drawDelay", 0)) / p<number>(node, "drawDuration", 40))) : 1;
  if (fillMode !== "none") {
    ctx.save();
    ctx.globalAlpha *= p<string>(node, "draw", "none") === "stroke-then-fill" ? clamp((drawP - 0.7) / 0.3) : 1;
    ctx.fillStyle = fillMode === "solid" ? p<string>(node, "fill", colors[0]) : angleGrad(ctx, colors, 0, 0, w, h, p<number>(node, "gradientAngle", 45) + t * p<number>(node, "gradientSpin", 0));
    ctx.fill("evenodd");
    ctx.restore();
  }
  const sw = p<number>(node, "strokeWidth", open ? 8 : 0);
  if (sw > 0) {
    ctx.save();
    ctx.lineWidth = sw; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = p<string>(node, "stroke", colors[0]);
    if (p<boolean>(node, "glow", false)) { ctx.shadowColor = p<string>(node, "stroke", colors[0]); ctx.shadowBlur = sw * 3; }
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (!open) len += Math.hypot(pts[0][0] - pts.at(-1)![0], pts[0][1] - pts.at(-1)![1]);
    if (shape === "circle" && morphTo === "none" && noise === 0) len = Math.PI * (w + h) / 2;
    const dash = p<number>(node, "dash", 0);
    if (dash > 0) { ctx.setLineDash([dash, dash * 0.8]); ctx.lineDashOffset = -t * p<number>(node, "dashSpeed", 60); }
    else if (drawP < 1) { ctx.setLineDash([len * drawP, len]); }
    ctx.stroke();
    ctx.restore();
  }
  // Path-following dot
  if (p<boolean>(node, "follower", false)) {
    const k = (t * p<number>(node, "followSpeed", 0.3)) % 1;
    const q = pts[Math.floor(k * (pts.length - 1))];
    ctx.save();
    ctx.fillStyle = theme.colors.text; ctx.shadowColor = colors[0]; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(4, sw * 1.2), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  void withAlpha;
}

registerNodeRenderer("shape", (rc, node) => drawShape(rc, node), (node) => ({ w: (node.props.w as number) ?? 300, h: (node.props.h as number) ?? 300 }));

/* Image node */
import { getImage } from "./core";
registerNodeRenderer(
  "image",
  (rc, node) => {
    const { ctx, theme } = rc;
    const w = p<number>(node, "w", 800), h = p<number>(node, "h", 500), r = p<number>(node, "radius", 16);
    const img = getImage(node.props.src);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, r); ctx.clip();
    if (img) {
      const fit = p<string>(node, "fit", "cover");
      const s = fit === "cover" ? Math.max(w / img.naturalWidth, h / img.naturalHeight) : Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
    } else {
      ctx.fillStyle = angleGrad(ctx, [theme.colors.surface2, theme.colors.surface], 0, 0, w, h, 120);
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.restore();
  },
  (node) => ({ w: (node.props.w as number) ?? 800, h: (node.props.h as number) ?? 500 }),
);
