/* SaaS UI motion system + device mockups — deterministic canvas renderers usable in video, editor and web.
 * Each UI kind animates its internals from local time t (typing, growing bars, toggles, cursors...). */
import { clamp, getEase, hash1, withAlpha, mixColor } from "@/core/math";
import type { Theme } from "@/themes";
import { registerNodeRenderer, rr, text, linearGrad, getImage, p, type Ctx2D } from "@/render/core";
import { drawChart } from "./charts";

type UIProps = Record<string, unknown>;
export type UIKind = { id: string; name: string; w: number; h: number; tags: string[]; description: string; draw: (ctx: Ctx2D, w: number, h: number, t: number, P: UIProps, th: Theme) => void };
export const UI_KINDS: Record<string, UIKind> = {};
const U = (id: string, name: string, w: number, h: number, tags: string[], description: string, draw: UIKind["draw"]) => { UI_KINDS[id] = { id, name, w, h, tags, description, draw }; };
const e = (t: number, d = 0.8, delay = 0, ease = "emphasized") => getEase(ease)(clamp((t - delay) / d));
const str = (P: UIProps, k: string, d: string) => (typeof P[k] === "string" && P[k] ? (P[k] as string) : d);
const list = (P: UIProps, k: string, d: string[]) => (Array.isArray(P[k]) && (P[k] as unknown[]).length ? (P[k] as string[]) : d);
const acc = (P: UIProps, th: Theme) => str(P, "accent", th.colors.primary);

function panel(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number, th: Theme, fill = th.colors.surface, stroke = th.colors.border, shadow = true) {
  ctx.save();
  if (shadow) { ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = th.shadow; ctx.shadowOffsetY = th.shadow * 0.3; }
  rr(ctx, x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
  ctx.restore();
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
}
function bar(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string) { rr(ctx, x, y, Math.max(0, w), h, h / 2); ctx.fillStyle = color; ctx.fill(); }
function dot(ctx: Ctx2D, x: number, y: number, r: number, color: string) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
function cursor(ctx: Ctx2D, x: number, y: number, s = 1, pressed = false) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (pressed ? 0.9 : 1), s * (pressed ? 0.9 : 1));
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 22); ctx.lineTo(6, 17); ctx.lineTo(10, 26); ctx.lineTo(14, 24); ctx.lineTo(10, 16); ctx.lineTo(17, 16); ctx.closePath();
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke(); ctx.restore();
}
const typed = (s: string, t: number, cps = 22, delay = 0) => s.slice(0, Math.max(0, Math.floor((t - delay) * cps)));

/* ---------------- Composite surfaces ---------------- */
U("browser", "Browser Window", 1280, 800, ["saas", "web", "mockup"], "Browser chrome with an animated dashboard page.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 16, th);
  ctx.save(); rr(ctx, -w / 2, -h / 2, w, h, 16); ctx.clip();
  ctx.fillStyle = th.colors.surface2; ctx.fillRect(-w / 2, -h / 2, w, 48);
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => dot(ctx, -w / 2 + 24 + i * 20, -h / 2 + 24, 6, c));
  panel(ctx, -w * 0.25, -h / 2 + 11, w * 0.5, 26, 8, th, th.colors.bg, th.colors.border, false);
  text(ctx, typed(str(P, "url", "app.cupric.ai/dashboard"), t, 30), -w * 0.25 + 14, -h / 2 + 24, { size: 13, color: th.colors.muted });
  ctx.translate(0, 24);
  UI_KINDS.dashboard.draw(ctx, w, h - 48, t - 0.3, P, th);
  ctx.restore();
});
U("dashboard", "Analytics Dashboard", 1280, 760, ["saas", "dashboard", "analytics", "data"], "Sidebar, KPI row, growing chart and activity list.", (ctx, w, h, t, P, th) => {
  const x0 = -w / 2, y0 = -h / 2, a = acc(P, th);
  ctx.fillStyle = th.colors.bg; ctx.fillRect(x0, y0, w, h);
  const sw = Math.min(220, w * 0.2);
  ctx.fillStyle = th.colors.surface; ctx.fillRect(x0, y0, sw, h);
  text(ctx, str(P, "brand", "Cupric"), x0 + 24, y0 + 36, { size: 18, weight: 700, color: th.colors.text });
  ["Overview", "Analytics", "Customers", "Automations", "Settings"].forEach((it, i) => {
    const y = y0 + 90 + i * 40, act = i === Math.floor(t / 2.5) % 5;
    if (act) { rr(ctx, x0 + 12, y - 16, sw - 24, 32, 8); ctx.fillStyle = withAlpha(a, 0.14); ctx.fill(); }
    text(ctx, it, x0 + 28, y, { size: 14, color: act ? th.colors.text : th.colors.muted, alpha: e(t, 0.5, i * 0.06) });
  });
  const cx = x0 + sw + 28, cw = w - sw - 56;
  text(ctx, str(P, "title", "Revenue overview"), cx, y0 + 40, { size: 24, weight: 650, color: th.colors.text, alpha: e(t, 0.6) });
  const kpis = list(P, "kpis", ["$128.4k|MRR|+12.4%", "8,249|Active users|+8.1%", "3.2%|Churn|-0.6%", "94|NPS|+4"]);
  const kw = (cw - 3 * 16) / 4;
  kpis.forEach((k, i) => {
    const [v, l, d] = k.split("|");
    const kx = cx + i * (kw + 16), ky = y0 + 76, pr = e(t, 0.7, 0.2 + i * 0.08);
    ctx.save(); ctx.globalAlpha *= pr; ctx.translate(0, (1 - pr) * 20);
    panel(ctx, kx, ky, kw, 96, 14, th, th.colors.surface, th.colors.border, false);
    text(ctx, l ?? "", kx + 16, ky + 26, { size: 13, color: th.colors.muted });
    text(ctx, v ?? "", kx + 16, ky + 60, { size: 26, weight: 700, color: th.colors.text });
    text(ctx, d ?? "", kx + kw - 16, ky + 60, { size: 13, weight: 600, color: (d ?? "").startsWith("-") ? th.colors.danger : th.colors.success, align: "right" });
    ctx.restore();
  });
  const chY = y0 + 196, chH = h - 196 - 28, chW = cw * 0.64;
  panel(ctx, cx, chY, chW, chH, 14, th, th.colors.surface, th.colors.border, false);
  ctx.save(); ctx.translate(cx + chW / 2, chY + chH / 2 + 10);
  drawChart(ctx, "area", chW - 40, chH - 60, t - 0.5, { data: (P.data as number[]) ?? [12, 18, 15, 26, 22, 34, 31, 42, 39, 52, 58, 66], colors: [a, th.colors.secondary] }, th);
  ctx.restore();
  text(ctx, "Monthly recurring revenue", cx + 20, chY + 26, { size: 14, weight: 600, color: th.colors.text });
  const lx = cx + chW + 16, lw = cw - chW - 16;
  panel(ctx, lx, chY, lw, chH, 14, th, th.colors.surface, th.colors.border, false);
  text(ctx, "Live activity", lx + 18, chY + 26, { size: 14, weight: 600, color: th.colors.text });
  ["New subscription · Pro", "Workflow completed", "Invoice paid · $2,400", "Team member invited", "Churn risk resolved"].forEach((it, i) => {
    const pr = e(t, 0.5, 0.8 + i * 0.35); const y = chY + 64 + i * 46;
    if (y > chY + chH - 20) return;
    ctx.save(); ctx.globalAlpha *= pr; ctx.translate((1 - pr) * 24, 0);
    dot(ctx, lx + 24, y, 5, [a, th.colors.success, th.colors.secondary, th.colors.accent, th.colors.warning][i]);
    text(ctx, it, lx + 40, y, { size: 13, color: th.colors.text, maxW: lw - 60 });
    ctx.restore();
  });
});
U("sidebar", "Sidebar", 260, 640, ["navigation", "saas"], "Navigation sidebar with animated selection pill.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 18, th);
  const items = list(P, "items", ["Home", "Inbox", "Projects", "Reports", "Integrations", "Billing"]);
  const sel = Math.floor(t / 1.5) % items.length, prev = (sel + items.length - 1) % items.length;
  const k = e(t % 1.5, 0.4, 0, "snappy");
  const y = -h / 2 + 80 + (prev + (sel - prev) * k) * 48;
  rr(ctx, -w / 2 + 12, y - 18, w - 24, 36, 10); ctx.fillStyle = withAlpha(acc(P, th), 0.16); ctx.fill();
  items.forEach((it, i) => { rr(ctx, -w / 2 + 26, -h / 2 + 72 + i * 48, 16, 16, 4); ctx.fillStyle = i === sel ? acc(P, th) : th.colors.border; ctx.fill(); text(ctx, it, -w / 2 + 56, -h / 2 + 80 + i * 48, { size: 15, color: i === sel ? th.colors.text : th.colors.muted }); });
  text(ctx, str(P, "brand", "Workspace"), -w / 2 + 24, -h / 2 + 34, { size: 17, weight: 700, color: th.colors.text });
});
U("navbar", "Navbar", 1200, 72, ["navigation", "landing"], "Landing page navbar with CTA.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, h / 2, th, withAlpha(th.colors.surface, 0.85));
  text(ctx, str(P, "brand", "Cupric"), -w / 2 + 32, 0, { size: 20, weight: 700, color: th.colors.text });
  list(P, "items", ["Product", "Solutions", "Pricing", "Docs"]).forEach((it, i) => text(ctx, it, -120 + i * 110, 0, { size: 15, color: th.colors.muted, alpha: e(t, 0.4, i * 0.08) }));
  const bw = 140; rr(ctx, w / 2 - bw - 14, -h / 2 + 14, bw, h - 28, (h - 28) / 2); ctx.fillStyle = acc(P, th); ctx.fill();
  text(ctx, str(P, "cta", "Get started"), w / 2 - bw / 2 - 14, 0, { size: 15, weight: 600, color: "#fff", align: "center" });
});
U("pricingCard", "Pricing Card", 380, 520, ["pricing", "saas", "conversion"], "Pricing tier with counting price and feature checks.", (ctx, w, h, t, P, th) => {
  const a = acc(P, th);
  panel(ctx, -w / 2, -h / 2, w, h, 24, th);
  ctx.save(); rr(ctx, -w / 2, -h / 2, w, h, 24); ctx.clip(); ctx.fillStyle = linearGrad(ctx, [withAlpha(a, 0.22), withAlpha(a, 0)], 0, -h / 2, 0, 0); ctx.fillRect(-w / 2, -h / 2, w, h / 2); ctx.restore();
  text(ctx, str(P, "tier", "Pro"), -w / 2 + 32, -h / 2 + 48, { size: 18, weight: 600, color: a });
  const price = Number(P.price ?? 49) * e(t, 1.2, 0.2, "easeOutExpo");
  text(ctx, `$${Math.round(price)}`, -w / 2 + 32, -h / 2 + 110, { size: 56, weight: 750, color: th.colors.text });
  text(ctx, "/ month", -w / 2 + 32 + 40 + String(Math.round(price)).length * 30, -h / 2 + 120, { size: 16, color: th.colors.muted });
  list(P, "features", ["Unlimited projects", "AI automations", "Advanced analytics", "Priority support", "SSO & audit logs"]).forEach((f, i) => {
    const pr = e(t, 0.4, 0.6 + i * 0.15), y = -h / 2 + 180 + i * 44;
    ctx.save(); ctx.globalAlpha *= pr;
    dot(ctx, -w / 2 + 44, y, 11, withAlpha(a, 0.2));
    ctx.strokeStyle = a; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-w / 2 + 39, y); ctx.lineTo(-w / 2 + 43, y + 4); ctx.lineTo(-w / 2 + 50, y - 4); ctx.stroke();
    text(ctx, f, -w / 2 + 66, y, { size: 16, color: th.colors.text }); ctx.restore();
  });
  const pulse = 1 + Math.sin(t * 3) * 0.015;
  ctx.save(); ctx.translate(0, h / 2 - 56); ctx.scale(pulse, pulse);
  rr(ctx, -w / 2 + 32, -24, w - 64, 48, 14); ctx.fillStyle = a; ctx.fill();
  text(ctx, str(P, "cta", "Start free trial"), 0, 0, { size: 16, weight: 650, color: "#fff", align: "center" }); ctx.restore();
});
U("metricCard", "Metric Card", 360, 180, ["kpi", "data", "saas"], "KPI card with counter and sparkline.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 20, th);
  text(ctx, str(P, "label", "Monthly revenue"), -w / 2 + 24, -h / 2 + 32, { size: 15, color: th.colors.muted });
  const v = Number(P.value ?? 128400) * e(t, 1.4, 0.1, "easeOutExpo");
  text(ctx, `${str(P, "prefix", "$")}${Math.round(v).toLocaleString("en-US")}${str(P, "suffix", "")}`, -w / 2 + 24, -h / 2 + 76, { size: 34, weight: 720, color: th.colors.text });
  text(ctx, str(P, "delta", "+12.4%"), w / 2 - 24, -h / 2 + 32, { size: 14, weight: 650, color: th.colors.success, align: "right" });
  ctx.save(); ctx.translate(0, h / 2 - 40); drawChart(ctx, "sparkline", w - 48, 44, t - 0.3, { data: [4, 6, 5, 8, 7, 10, 9, 12, 14, 13, 16], colors: [acc(P, th)] }, th); ctx.restore();
});
U("progress", "Progress", 480, 90, ["progress", "loader"], "Animated labelled progress bar.", (ctx, w, h, t, P, th) => {
  const v = Number(P.value ?? 78) / 100 * e(t, 1.6, 0.1, "easeInOutCubic");
  text(ctx, str(P, "label", "Deploying to production"), -w / 2, -h / 2 + 16, { size: 16, weight: 600, color: th.colors.text });
  text(ctx, `${Math.round(v * 100)}%`, w / 2, -h / 2 + 16, { size: 16, weight: 600, color: th.colors.muted, align: "right" });
  bar(ctx, -w / 2, 10, w, 12, th.colors.surface2);
  ctx.save(); rr(ctx, -w / 2, 10, w * v, 12, 6); ctx.clip(); ctx.fillStyle = linearGrad(ctx, [acc(P, th), th.colors.secondary], -w / 2, 0, w / 2, 0); ctx.fillRect(-w / 2, 10, w, 12);
  const sx = -w / 2 + ((t * 300) % (w + 200)) - 100; ctx.fillStyle = linearGrad(ctx, ["rgba(255,255,255,0)", "rgba(255,255,255,0.5)", "rgba(255,255,255,0)"], sx - 60, 0, sx + 60, 0); ctx.fillRect(sx - 60, 10, 120, 12); ctx.restore();
});
U("notification", "Notification", 420, 96, ["notification", "ios", "social-proof"], "Slide-in system notification.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 22, th, withAlpha(th.colors.surface2, 0.95));
  rr(ctx, -w / 2 + 18, -22, 44, 44, 12); ctx.fillStyle = linearGrad(ctx, [acc(P, th), th.colors.secondary], -w / 2, -22, -w / 2 + 60, 22); ctx.fill();
  text(ctx, str(P, "title", "New payment received"), -w / 2 + 78, -12, { size: 16, weight: 650, color: th.colors.text, maxW: w - 150 });
  text(ctx, str(P, "body", "Acme Inc. upgraded to Pro · $2,400"), -w / 2 + 78, 14, { size: 14, color: th.colors.muted, maxW: w - 100 });
  text(ctx, "now", w / 2 - 20, -12, { size: 12, color: th.colors.muted, align: "right" });
});
U("toast", "Toast", 380, 64, ["feedback", "ui"], "Success toast with countdown bar.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 14, th);
  dot(ctx, -w / 2 + 30, 0, 12, withAlpha(th.colors.success, 0.2));
  ctx.strokeStyle = th.colors.success; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-w / 2 + 24, 0); ctx.lineTo(-w / 2 + 29, 5); ctx.lineTo(-w / 2 + 37, -5); ctx.stroke();
  text(ctx, str(P, "title", "Changes saved"), -w / 2 + 56, 0, { size: 15, weight: 600, color: th.colors.text });
  bar(ctx, -w / 2 + 12, h / 2 - 6, (w - 24) * (1 - clamp(t / 4)), 3, th.colors.success);
});
U("modal", "Modal Dialog", 520, 320, ["dialog", "ui"], "Modal dialog with confirm/cancel.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 20, th);
  text(ctx, str(P, "title", "Invite your team"), -w / 2 + 32, -h / 2 + 44, { size: 22, weight: 700, color: th.colors.text });
  text(ctx, str(P, "body", "Collaborate on workflows in real time."), -w / 2 + 32, -h / 2 + 78, { size: 15, color: th.colors.muted });
  panel(ctx, -w / 2 + 32, -h / 2 + 110, w - 64, 48, 12, th, th.colors.bg, th.colors.border, false);
  text(ctx, typed("alex@company.com", t, 14, 0.4), -w / 2 + 48, -h / 2 + 134, { size: 15, color: th.colors.text });
  const click = t > 2 && t < 2.2;
  rr(ctx, w / 2 - 172, h / 2 - 72, 140, 44, 12); ctx.fillStyle = click ? mixColor(acc(P, th), "#000", 0.2) : acc(P, th); ctx.fill();
  text(ctx, "Send invite", w / 2 - 102, h / 2 - 50, { size: 15, weight: 600, color: "#fff", align: "center" });
  text(ctx, "Cancel", w / 2 - 230, h / 2 - 50, { size: 15, color: th.colors.muted, align: "center" });
  cursor(ctx, w / 2 - 110 + (1 - e(t, 1, 1)) * 120, h / 2 - 48 + (1 - e(t, 1, 1)) * 60, 1, click);
});
U("commandPalette", "Command Palette", 640, 420, ["search", "power-user", "saas"], "⌘K palette with typed query and filtered results.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 18, th);
  const q = typed(str(P, "query", "create workflow"), t, 14, 0.3);
  text(ctx, "⌕", -w / 2 + 24, -h / 2 + 32, { size: 20, color: th.colors.muted });
  text(ctx, q || "Type a command…", -w / 2 + 52, -h / 2 + 32, { size: 17, color: q ? th.colors.text : th.colors.muted });
  ctx.fillStyle = th.colors.border; ctx.fillRect(-w / 2, -h / 2 + 62, w, 1);
  const items = list(P, "items", ["Create workflow", "Create dashboard", "Invite teammate", "Open billing", "Search docs", "Toggle dark mode"]).filter((it) => it.toLowerCase().includes(q.toLowerCase().split(" ")[0] ?? ""));
  const sel = Math.floor(t * 1.2) % Math.max(1, items.length);
  items.slice(0, 6).forEach((it, i) => {
    const y = -h / 2 + 96 + i * 50;
    if (i === sel) { rr(ctx, -w / 2 + 10, y - 20, w - 20, 40, 10); ctx.fillStyle = withAlpha(acc(P, th), 0.14); ctx.fill(); }
    text(ctx, it, -w / 2 + 28, y, { size: 16, color: th.colors.text });
    text(ctx, ["⌘N", "⌘D", "⌘I", "⌘B", "⌘/", "⌘T"][i] ?? "", w / 2 - 28, y, { size: 13, color: th.colors.muted, align: "right" });
  });
});
U("search", "Search Bar", 560, 64, ["search", "input"], "Search field with typing and suggestions pulse.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, h / 2, th);
  text(ctx, "⌕", -w / 2 + 26, 0, { size: 20, color: th.colors.muted });
  const s = typed(str(P, "query", "Find customers in Berlin"), t, 16);
  text(ctx, s, -w / 2 + 56, 0, { size: 17, color: th.colors.text });
  if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = acc(P, th); ctx.font = "17px sans-serif"; ctx.fillRect(-w / 2 + 58 + ctx.measureText(s).width, -11, 2, 22); }
});
U("input", "Text Input", 420, 90, ["form", "input"], "Labelled input with focus ring.", (ctx, w, h, t, P, th) => {
  text(ctx, str(P, "label", "Work email"), -w / 2, -h / 2 + 12, { size: 14, weight: 600, color: th.colors.text });
  const focus = e(t, 0.4, 0.2);
  rr(ctx, -w / 2 - 3 * focus, -h / 2 + 30 - 3 * focus, w + 6 * focus, 50 + 6 * focus, 14); ctx.fillStyle = withAlpha(acc(P, th), 0.25 * focus); ctx.fill();
  panel(ctx, -w / 2, -h / 2 + 30, w, 50, 12, th, th.colors.surface, focus > 0.5 ? acc(P, th) : th.colors.border, false);
  text(ctx, typed(str(P, "value", "maya@northwind.io"), t, 16, 0.5), -w / 2 + 16, -h / 2 + 55, { size: 16, color: th.colors.text });
});
U("button", "Button", 240, 64, ["cta", "button"], "Primary button with hover shine and press.", (ctx, w, h, t, P, th) => {
  const press = Math.sin(t * 2) > 0.95 ? 0.96 : 1;
  ctx.save(); ctx.scale(press, press);
  ctx.shadowColor = withAlpha(acc(P, th), 0.5); ctx.shadowBlur = 30;
  rr(ctx, -w / 2, -h / 2, w, h, str(P, "shape", "pill") === "pill" ? h / 2 : 12); ctx.fillStyle = linearGrad(ctx, [acc(P, th), th.colors.secondary], -w / 2, 0, w / 2, 0); ctx.fill();
  ctx.shadowBlur = 0; ctx.clip();
  const sx = -w + ((t * 0.6) % 1.5) * w * 2; ctx.fillStyle = linearGrad(ctx, ["rgba(255,255,255,0)", "rgba(255,255,255,0.35)", "rgba(255,255,255,0)"], sx - 40, 0, sx + 40, 0); ctx.fillRect(-w / 2, -h / 2, w, h);
  text(ctx, str(P, "label", "Get started →"), 0, 0, { size: 18, weight: 650, color: "#fff", align: "center" });
  ctx.restore();
});
U("toggle", "Toggle", 120, 64, ["form", "switch"], "Spring-animated toggle switch.", (ctx, w, h, t, P, th) => {
  const on = Math.floor(t / 1.2) % 2 === 1, k = e(t % 1.2, 0.35, 0, "snappy"), pos = on ? k : 1 - k;
  rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = mixColor(th.colors.surface2, acc(P, th), pos); ctx.fill();
  dot(ctx, -w / 2 + h / 2 + pos * (w - h), 0, h / 2 - 6, "#fff");
});
U("slider", "Slider", 420, 60, ["form", "control"], "Range slider with moving thumb and value.", (ctx, w, h, t, P, th) => {
  const v = 0.5 + Math.sin(t * 1.2) * 0.35;
  bar(ctx, -w / 2, -4, w, 8, th.colors.surface2); bar(ctx, -w / 2, -4, w * v, 8, acc(P, th));
  dot(ctx, -w / 2 + w * v, 0, 14, "#fff"); dot(ctx, -w / 2 + w * v, 0, 6, acc(P, th));
  text(ctx, `${Math.round(v * 100)}%`, -w / 2 + w * v, -30, { size: 14, weight: 600, color: th.colors.text, align: "center" });
});
U("calendar", "Calendar", 420, 400, ["calendar", "scheduling"], "Month grid with selected range sweep.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 20, th);
  text(ctx, str(P, "month", "September 2026"), -w / 2 + 24, -h / 2 + 34, { size: 18, weight: 650, color: th.colors.text });
  const cw = (w - 48) / 7; const sel = Math.floor(e(t, 1.5, 0.3) * 6);
  "SMTWTFS".split("").forEach((d, i) => text(ctx, d, -w / 2 + 24 + cw * (i + 0.5), -h / 2 + 72, { size: 12, color: th.colors.muted, align: "center" }));
  for (let d = 0; d < 30; d++) { const c = (d + 2) % 7, r = Math.floor((d + 2) / 7); const x = -w / 2 + 24 + cw * (c + 0.5), y = -h / 2 + 108 + r * 48; const inRange = d >= 11 && d <= 11 + sel; if (inRange) { rr(ctx, x - cw / 2 + 2, y - 18, cw - 4, 36, 10); ctx.fillStyle = d === 11 || d === 11 + sel ? acc(P, th) : withAlpha(acc(P, th), 0.2); ctx.fill(); } text(ctx, String(d + 1), x, y, { size: 14, color: inRange ? "#fff" : th.colors.text, align: "center" }); }
});
U("avatar", "Avatar Stack", 300, 80, ["social-proof", "team"], "Overlapping avatars with counter.", (ctx, w, h, t, P, th) => {
  const n = 5;
  for (let i = 0; i < n; i++) { const pr = e(t, 0.4, i * 0.1, "overshoot"); const x = -w / 2 + 36 + i * 44; ctx.save(); ctx.translate(x, 0); ctx.scale(pr, pr); dot(ctx, 0, 0, 30, th.colors.bg); dot(ctx, 0, 0, 26, [th.colors.primary, th.colors.secondary, th.colors.accent, th.colors.success, th.colors.warning][i]); text(ctx, "AMJKL"[i], 0, 1, { size: 18, weight: 700, color: "#fff", align: "center" }); ctx.restore(); }
  text(ctx, str(P, "label", "+2.4k teams"), -w / 2 + 36 + n * 44 + 8, 0, { size: 16, weight: 600, color: th.colors.text, alpha: e(t, 0.5, 0.6) });
});
U("profile", "Profile Card", 360, 420, ["profile", "social"], "Profile card with stats.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 24, th);
  ctx.save(); rr(ctx, -w / 2, -h / 2, w, 110, 24); ctx.clip(); ctx.fillStyle = linearGrad(ctx, th.gradient, -w / 2, 0, w / 2, 0); ctx.fillRect(-w / 2, -h / 2, w, 110); ctx.restore();
  dot(ctx, 0, -h / 2 + 110, 48, th.colors.surface); dot(ctx, 0, -h / 2 + 110, 42, acc(P, th));
  text(ctx, str(P, "name", "Maya Chen"), 0, -h / 2 + 190, { size: 22, weight: 700, color: th.colors.text, align: "center" });
  text(ctx, str(P, "role", "Head of Growth · Northwind"), 0, -h / 2 + 220, { size: 14, color: th.colors.muted, align: "center" });
  [["Projects", 128], ["Followers", 4820], ["Rating", 4.9]].forEach(([l, v], i) => { const x = -w / 3 + i * (w / 3); const val = Number(v) * e(t, 1.2, 0.3, "easeOutExpo"); text(ctx, Number(v) < 10 ? val.toFixed(1) : Math.round(val).toLocaleString("en-US"), x, h / 2 - 90, { size: 22, weight: 700, color: th.colors.text, align: "center" }); text(ctx, String(l), x, h / 2 - 60, { size: 13, color: th.colors.muted, align: "center" }); });
});
U("table", "Data Table", 760, 380, ["table", "data", "crm"], "Table rows streaming in with status pills.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 16, th);
  const cols = ["Customer", "Plan", "MRR", "Status"]; const cx = [0.04, 0.4, 0.62, 0.8];
  cols.forEach((c, i) => text(ctx, c, -w / 2 + w * cx[i], -h / 2 + 30, { size: 13, weight: 600, color: th.colors.muted }));
  ctx.fillStyle = th.colors.border; ctx.fillRect(-w / 2, -h / 2 + 52, w, 1);
  const rows = [["Northwind", "Enterprise", "$12,400", "Active"], ["Acme Corp", "Pro", "$2,400", "Active"], ["Globex", "Pro", "$1,980", "Trial"], ["Initech", "Starter", "$490", "Active"], ["Umbrella", "Enterprise", "$9,800", "Review"], ["Hooli", "Pro", "$2,100", "Active"]];
  rows.forEach((r, i) => { const y = -h / 2 + 80 + i * 48; if (y > h / 2 - 10) return; const pr = e(t, 0.4, 0.2 + i * 0.12); ctx.save(); ctx.globalAlpha *= pr; ctx.translate(0, (1 - pr) * 12); r.forEach((v, j) => { if (j === 3) { const col = v === "Active" ? th.colors.success : v === "Trial" ? th.colors.secondary : th.colors.warning; rr(ctx, -w / 2 + w * cx[j], y - 13, 76, 26, 13); ctx.fillStyle = withAlpha(col, 0.16); ctx.fill(); text(ctx, v, -w / 2 + w * cx[j] + 38, y, { size: 12, weight: 600, color: col, align: "center" }); } else text(ctx, v, -w / 2 + w * cx[j], y, { size: 15, color: th.colors.text, weight: j === 0 ? 600 : 400 }); }); ctx.restore(); });
});
U("kanban", "Kanban Board", 900, 460, ["project", "productivity"], "Kanban columns with a card moving across.", (ctx, w, h, t, P, th) => {
  const cols = ["Backlog", "In progress", "Review", "Done"]; const cw = (w - 5 * 16) / 4;
  cols.forEach((c, i) => { const x = -w / 2 + 16 + i * (cw + 16); panel(ctx, x, -h / 2, cw, h, 14, th, th.colors.surface, th.colors.border, false); text(ctx, c, x + 16, -h / 2 + 28, { size: 14, weight: 650, color: th.colors.text }); for (let k = 0; k < 3; k++) { const y = -h / 2 + 56 + k * 92; panel(ctx, x + 12, y, cw - 24, 78, 10, th, th.colors.surface2, th.colors.border, false); bar(ctx, x + 24, y + 22, (cw - 48) * (0.5 + hash1(i * 3 + k) * 0.4), 8, withAlpha(th.colors.text, 0.5)); bar(ctx, x + 24, y + 44, (cw - 48) * 0.4, 8, withAlpha(th.colors.muted, 0.4)); } });
  const k = (t * 0.35) % 1; const from = Math.floor(((t * 0.35) % 3)); const pr = getEase("easeInOutCubic")(clamp((k - 0.3) / 0.5));
  const x = -w / 2 + 16 + (from + pr) * (cw + 16) + 12, y = -h / 2 + 56 + 3 * 92 - Math.sin(pr * Math.PI) * 30;
  ctx.save(); ctx.translate(x + (cw - 24) / 2, y + 39); ctx.rotate(Math.sin(pr * Math.PI) * 0.05); panel(ctx, -(cw - 24) / 2, -39, cw - 24, 78, 10, th, th.colors.surface2, acc(P, th)); text(ctx, str(P, "card", "Launch campaign"), -(cw - 24) / 2 + 12, -12, { size: 14, weight: 600, color: th.colors.text }); dot(ctx, -(cw - 24) / 2 + 20, 16, 6, acc(P, th)); ctx.restore();
});
U("chat", "Chat", 440, 560, ["messaging", "social"], "Conversation with typing indicator and bubbles.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 24, th);
  const msgs = list(P, "messages", ["Did the launch go live?", "Yes! 2,400 signups in the first hour 🚀", "That's incredible. Share the dashboard?", "Sending it now"]);
  msgs.forEach((m, i) => { const at = 0.3 + i * 1.1; if (t < at) return; const pr = e(t, 0.35, at, "overshoot"); const me = i % 2 === 1; ctx.save(); ctx.font = "15px Inter, sans-serif"; const tw = Math.min(w * 0.65, ctx.measureText(m).width + 32); const x = me ? w / 2 - 20 - tw : -w / 2 + 20; const y = -h / 2 + 40 + i * 70; ctx.translate(x + (me ? tw : 0), y + 22); ctx.scale(pr, pr); ctx.translate(-(me ? tw : 0), -22); rr(ctx, 0, 0, tw, 44, 20); ctx.fillStyle = me ? acc(P, th) : th.colors.surface2; ctx.fill(); text(ctx, m, 16, 22, { size: 15, color: me ? "#fff" : th.colors.text, maxW: tw - 24 }); ctx.restore(); });
  const k = msgs.length; if (t > 0.3 + k * 1.1 - 0.9) { for (let d = 0; d < 3; d++) dot(ctx, -w / 2 + 44 + d * 14, h / 2 - 40 + Math.sin(t * 8 - d) * 3, 4, th.colors.muted); }
});
U("aiChat", "AI Chat", 720, 520, ["ai", "chatbot", "llm"], "Prompt → streaming AI response with thinking shimmer.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 24, th);
  const prompt = str(P, "prompt", "Summarize this week's revenue and flag risks");
  const resp = str(P, "response", "Revenue grew 12.4% week over week, led by Enterprise upgrades. Two accounts show churn signals: Globex (usage -38%) and Initech (support tickets +4). I drafted outreach emails for both.");
  const pw = Math.min(w * 0.7, prompt.length * 8.5 + 40);
  rr(ctx, w / 2 - 24 - pw, -h / 2 + 28, pw, 48, 18); ctx.fillStyle = th.colors.surface2; ctx.fill();
  text(ctx, typed(prompt, t, 40), w / 2 - pw - 6, -h / 2 + 52, { size: 15, color: th.colors.text, maxW: pw - 30 });
  dot(ctx, -w / 2 + 40, -h / 2 + 118, 16, acc(P, th)); text(ctx, "✦", -w / 2 + 40, -h / 2 + 119, { size: 16, color: "#fff", align: "center" });
  if (t > 1.4 && t < 2.4) { ctx.save(); const g = linearGrad(ctx, [th.colors.muted, th.colors.text, th.colors.muted], -w / 2 + 70 + ((t * 200) % 200) - 100, 0, -w / 2 + 170 + ((t * 200) % 200), 0); text(ctx, "Thinking…", -w / 2 + 70, -h / 2 + 118, { size: 15, color: th.colors.muted }); void g; ctx.restore(); }
  if (t >= 2.4) {
    const shown = typed(resp, t, 45, 2.4); ctx.font = "16px Inter, sans-serif";
    const words = shown.split(" "); let line = "", y = -h / 2 + 118; const maxW = w - 110;
    for (const wd of words) { if (ctx.measureText(line + wd).width > maxW) { text(ctx, line, -w / 2 + 70, y, { size: 16, color: th.colors.text }); line = ""; y += 28; } line += wd + " "; }
    text(ctx, line, -w / 2 + 70, y, { size: 16, color: th.colors.text });
  }
  panel(ctx, -w / 2 + 20, h / 2 - 76, w - 40, 56, 18, th, th.colors.bg, th.colors.border, false);
  text(ctx, "Ask anything…", -w / 2 + 40, h / 2 - 48, { size: 15, color: th.colors.muted });
  dot(ctx, w / 2 - 50, h / 2 - 48, 16, acc(P, th));
});
U("codeEditor", "Code Editor", 760, 460, ["code", "developer", "api"], "Syntax-highlighted code typing in.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 16, th, "#0b0d12", "#1f2330");
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => dot(ctx, -w / 2 + 22 + i * 18, -h / 2 + 22, 5.5, c));
  text(ctx, str(P, "file", "generate.ts"), 0, -h / 2 + 22, { size: 13, color: "#8a90a2", align: "center" });
  const code = str(P, "code", `import { generateVideo } from "@motionos/ai";\n\nconst video = await generateVideo({\n  style: "premium futuristic SaaS",\n  duration: 25,\n  brand: { name: "Cupric AI" },\n  scenes: ["hook", "problem", "product", "cta"],\n});\n\nawait renderVideo({ doc: video, format: "mp4" });`);
  const shown = typed(code, t, 38);
  const kw = /\b(import|from|const|await|export|return|function)\b/;
  shown.split("\n").forEach((ln, i) => { const y = -h / 2 + 62 + i * 26; text(ctx, String(i + 1), -w / 2 + 34, y, { size: 13, color: "#3b4152", align: "right", family: "ui-monospace, Menlo, monospace" }); let x = -w / 2 + 52; ctx.font = "15px ui-monospace, Menlo, monospace"; ln.split(/(\s+|[{}(),:;[\]])/).forEach((tok) => { if (!tok) return; const col = kw.test(tok) ? "#c792ea" : /^["'`]/.test(tok) || /["'`]$/.test(tok) ? "#c3e88d" : /^\d+$/.test(tok) ? "#f78c6c" : /^[A-Z]/.test(tok) || /^[a-z]+[A-Z]/.test(tok) ? "#82aaff" : "#d6deeb"; text(ctx, tok, x, y, { size: 15, color: col, family: "ui-monospace, Menlo, monospace" }); x += ctx.measureText(tok).width; }); });
});
U("terminal", "Terminal", 720, 400, ["cli", "developer", "deploy"], "CLI session with typed commands and logs.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 14, th, "#07080b", "#1f2330");
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => dot(ctx, -w / 2 + 22 + i * 18, -h / 2 + 20, 5.5, c));
  const lines = list(P, "lines", ["$ npx motionos render launch.json --format mp4", "✓ Validated composition (7 scenes, 750 frames)", "✓ Prepared assets", "▸ Encoding H.264 1920×1080 @ 30fps", "✓ Rendered launch.mp4 in 18.4s"]);
  let y = -h / 2 + 60;
  lines.forEach((ln, i) => { const at = i === 0 ? 0.2 : 1.8 + i * 0.5; if (t < at) return; const s = i === 0 ? typed(ln, t, 30, at) : ln; text(ctx, s, -w / 2 + 24, y, { size: 15, color: ln.startsWith("✓") ? "#34d399" : ln.startsWith("▸") ? "#fbbf24" : "#e5e7eb", family: "ui-monospace, Menlo, monospace" }); y += 30; });
  if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = "#e5e7eb"; ctx.fillRect(-w / 2 + 24, y - 10, 9, 18); }
});
U("workflow", "Workflow", 900, 360, ["automation", "nodes", "ai"], "Node graph with data pulses along edges.", (ctx, w, h, t, P, th) => {
  const nodes = list(P, "steps", ["Trigger: New lead", "Enrich with AI", "Score & route", "Notify Slack"]);
  const n = nodes.length, gap = w / n;
  nodes.forEach((nm, i) => {
    const x = -w / 2 + gap * (i + 0.5), y = (i % 2 ? 1 : -1) * h * 0.14;
    if (i < n - 1) { const x2 = -w / 2 + gap * (i + 1.5), y2 = ((i + 1) % 2 ? 1 : -1) * h * 0.14; const pr = e(t, 0.6, 0.4 + i * 0.5); ctx.strokeStyle = withAlpha(acc(P, th), 0.5); ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.lineDashOffset = -t * 30; ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + gap / 2, y, x2 - gap / 2, y2, x + (x2 - x) * pr, y + (y2 - y) * pr); ctx.stroke(); ctx.setLineDash([]); const k = ((t * 0.8 - i * 0.3) % 1 + 1) % 1; if (pr >= 1) { const bx = (1 - k) ** 3 * x + 3 * (1 - k) ** 2 * k * (x + gap / 2) + 3 * (1 - k) * k * k * (x2 - gap / 2) + k ** 3 * x2; const by = (1 - k) ** 3 * y + 3 * (1 - k) ** 2 * k * y + 3 * (1 - k) * k * k * y2 + k ** 3 * y2; ctx.save(); ctx.shadowColor = acc(P, th); ctx.shadowBlur = 16; dot(ctx, bx, by, 5, acc(P, th)); ctx.restore(); } }
    const pr = e(t, 0.5, i * 0.5, "overshoot"); ctx.save(); ctx.translate(x, y); ctx.scale(pr, pr);
    panel(ctx, -gap * 0.4, -36, gap * 0.8, 72, 16, th); rr(ctx, -gap * 0.4 + 14, -16, 32, 32, 9); ctx.fillStyle = withAlpha([acc(P, th), th.colors.secondary, th.colors.accent, th.colors.success][i % 4], 0.9); ctx.fill();
    text(ctx, nm, -gap * 0.4 + 58, 0, { size: 14, weight: 600, color: th.colors.text, maxW: gap * 0.8 - 70 }); ctx.restore();
  });
});
U("automation", "Automation Run", 520, 420, ["automation", "ai", "checklist"], "Steps completing with spinners and checkmarks.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 20, th);
  text(ctx, str(P, "title", "Agent run · Q3 report"), -w / 2 + 28, -h / 2 + 38, { size: 18, weight: 700, color: th.colors.text });
  list(P, "steps", ["Fetch CRM data", "Analyze pipeline", "Generate insights", "Draft summary", "Send to team"]).forEach((s, i) => { const y = -h / 2 + 90 + i * 60; const doneAt = 0.8 + i * 0.8; const done = t > doneAt, active = t > doneAt - 0.8 && !done; if (done) { dot(ctx, -w / 2 + 44, y, 13, th.colors.success); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-w / 2 + 38, y); ctx.lineTo(-w / 2 + 43, y + 5); ctx.lineTo(-w / 2 + 51, y - 5); ctx.stroke(); } else if (active) { ctx.strokeStyle = acc(P, th); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-w / 2 + 44, y, 11, t * 6, t * 6 + 4.2); ctx.stroke(); } else { ctx.strokeStyle = th.colors.border; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-w / 2 + 44, y, 11, 0, 7); ctx.stroke(); } text(ctx, s, -w / 2 + 72, y, { size: 16, color: done || active ? th.colors.text : th.colors.muted }); if (done) text(ctx, `${(0.4 + hash1(i) * 1.6).toFixed(1)}s`, w / 2 - 28, y, { size: 13, color: th.colors.muted, align: "right" }); });
});
function iconCard(id: string, name: string, tags: string[], description: string, glyph: (ctx: Ctx2D, s: number, t: number, a: string, th: Theme) => void) {
  U(id, name, 320, 320, tags, description, (ctx, w, h, t, P, th) => {
    const a = acc(P, th);
    panel(ctx, -w / 2, -h / 2, w, h, 28, th);
    ctx.save(); ctx.translate(0, -24); glyph(ctx, Math.min(w, h) * 0.32, t, a, th); ctx.restore();
    text(ctx, str(P, "label", name), 0, h / 2 - 48, { size: 18, weight: 650, color: th.colors.text, align: "center" });
  });
}
iconCard("database", "Database", ["infra", "data", "backend"], "Stacked database cylinders with sync pulses.", (ctx, s, t, a, th) => { for (let k = 2; k >= 0; k--) { const y = (k - 1) * s * 0.42; const lit = Math.max(0, Math.sin(t * 3 - k)) ; ctx.fillStyle = mixColor(th.colors.surface2, a, 0.3 + lit * 0.5); ctx.beginPath(); ctx.ellipse(0, y + s * 0.18, s, s * 0.3, 0, 0, Math.PI); ctx.lineTo(-s, y - s * 0.12); ctx.ellipse(0, y - s * 0.12, s, s * 0.3, 0, Math.PI, 0, true); ctx.fill(); ctx.fillStyle = mixColor(th.colors.surface2, a, 0.55 + lit * 0.4); ctx.beginPath(); ctx.ellipse(0, y - s * 0.12, s, s * 0.3, 0, 0, Math.PI * 2); ctx.fill(); } });
iconCard("cloud", "Cloud", ["infra", "cloud", "deploy"], "Cloud with uploading data particles.", (ctx, s, t, a, th) => { ctx.fillStyle = linearGrad(ctx, [a, th.colors.secondary], -s, -s, s, s); ctx.beginPath(); ctx.arc(-s * 0.45, s * 0.05, s * 0.45, 0, 7); ctx.arc(0, -s * 0.25, s * 0.6, 0, 7); ctx.arc(s * 0.5, s * 0.05, s * 0.45, 0, 7); ctx.rect(-s * 0.45, s * 0.05, s * 0.95, s * 0.45); ctx.fill(); for (let i = 0; i < 5; i++) { const k = (t * 0.8 + i / 5) % 1; dot(ctx, (i - 2) * s * 0.25, s * 1.1 - k * s * 0.9, 3, withAlpha(th.colors.text, 1 - k)); } });
iconCard("api", "API", ["developer", "api", "integration"], "API endpoint with request/response packets.", (ctx, s, t, a, th) => { rr(ctx, -s * 0.35, -s * 0.35, s * 0.7, s * 0.7, 14); ctx.fillStyle = a; ctx.fill(); text(ctx, "{ }", 0, 0, { size: s * 0.3, weight: 700, color: "#fff", align: "center", family: "ui-monospace, monospace" }); for (let i = 0; i < 4; i++) { const ang = (i / 4) * Math.PI * 2; const k = (t * 0.7 + i * 0.25) % 1; const out = i % 2 === 0; const r = s * (0.5 + (out ? k : 1 - k) * 0.6); ctx.strokeStyle = withAlpha(th.colors.border, 1); ctx.beginPath(); ctx.moveTo(Math.cos(ang) * s * 0.5, Math.sin(ang) * s * 0.5); ctx.lineTo(Math.cos(ang) * s * 1.1, Math.sin(ang) * s * 1.1); ctx.stroke(); dot(ctx, Math.cos(ang) * r, Math.sin(ang) * r, 4, out ? th.colors.success : th.colors.secondary); } });
iconCard("analytics", "Analytics", ["data", "analytics", "growth"], "Animated bar growth icon.", (ctx, s, t, a, th) => { for (let i = 0; i < 5; i++) { const hh = s * (0.4 + i * 0.25) * e(t, 0.8, i * 0.1, "overshoot") * (0.9 + Math.sin(t * 2 + i) * 0.1); rr(ctx, -s + i * s * 0.42, s * 0.8 - hh, s * 0.3, hh, 6); ctx.fillStyle = mixColor(th.colors.secondary, a, i / 4); ctx.fill(); } });
U("cursorDemo", "Cursor Click-through", 800, 500, ["demo", "product", "tutorial"], "Cursor travels between UI targets with click ripples.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 18, th);
  const targets: [number, number][] = [[-w * 0.3, -h * 0.25], [w * 0.2, -h * 0.1], [-w * 0.1, h * 0.25], [w * 0.3, h * 0.2]];
  targets.forEach(([x, y], i) => { rr(ctx, x - 70, y - 22, 140, 44, 12); ctx.fillStyle = th.colors.surface2; ctx.fill(); text(ctx, ["Connect data", "Pick template", "Customize", "Publish"][i], x, y, { size: 14, weight: 600, color: th.colors.text, align: "center" }); });
  const seg = t / 1.2; const i = Math.floor(seg) % targets.length; const k = getEase("easeInOutCubic")(clamp((seg % 1) / 0.7)); const [x0, y0] = targets[i], [x1, y1] = targets[(i + 1) % targets.length];
  const cx = x0 + (x1 - x0) * k, cy = y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * 40;
  const click = (seg % 1) > 0.75; if (click) { const r = ((seg % 1) - 0.75) * 200; ctx.strokeStyle = withAlpha(acc(P, th), 1 - r / 50); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x1, y1, r, 0, 7); ctx.stroke(); }
  cursor(ctx, cx, cy, 1.2, click);
});
U("featureCard", "Feature Card", 400, 260, ["feature", "saas", "bento"], "Feature tile with icon glow and copy.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 22, th);
  ctx.save(); rr(ctx, -w / 2, -h / 2, w, h, 22); ctx.clip(); const gx = -w / 2 + ((t * 0.3) % 1) * w * 1.5; const g = ctx.createRadialGradient(gx, -h / 2, 0, gx, -h / 2, w * 0.6); g.addColorStop(0, withAlpha(acc(P, th), 0.25)); g.addColorStop(1, withAlpha(acc(P, th), 0)); ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
  rr(ctx, -w / 2 + 28, -h / 2 + 28, 52, 52, 14); ctx.fillStyle = linearGrad(ctx, [acc(P, th), th.colors.secondary], -w / 2 + 28, -h / 2 + 28, -w / 2 + 80, -h / 2 + 80); ctx.fill();
  text(ctx, str(P, "icon", "✦"), -w / 2 + 54, -h / 2 + 55, { size: 24, color: "#fff", align: "center" });
  text(ctx, str(P, "title", "Real-time automation"), -w / 2 + 28, -h / 2 + 120, { size: 22, weight: 700, color: th.colors.text, maxW: w - 56 });
  text(ctx, str(P, "body", "Trigger workflows from any event in milliseconds."), -w / 2 + 28, -h / 2 + 156, { size: 15, color: th.colors.muted, maxW: w - 56 });
});
U("testimonialCard", "Testimonial", 560, 280, ["social-proof", "testimonial"], "Quote card with stars filling in.", (ctx, w, h, t, P, th) => {
  panel(ctx, -w / 2, -h / 2, w, h, 24, th);
  for (let i = 0; i < 5; i++) text(ctx, "★", -w / 2 + 32 + i * 26, -h / 2 + 40, { size: 22, color: i < Math.floor(e(t, 1, 0.2) * 5.99) ? th.colors.warning : th.colors.border });
  const q = str(P, "quote", "“We shipped our launch video in an afternoon. It looks like a studio made it.”");
  ctx.font = "500 20px Inter, sans-serif"; const words = typed(q, t, 60, 0.4).split(" "); let line = "", y = -h / 2 + 90;
  for (const wd of words) { if (ctx.measureText(line + wd).width > w - 64) { text(ctx, line, -w / 2 + 32, y, { size: 20, weight: 500, color: th.colors.text }); line = ""; y += 30; } line += wd + " "; }
  text(ctx, line, -w / 2 + 32, y, { size: 20, weight: 500, color: th.colors.text });
  dot(ctx, -w / 2 + 52, h / 2 - 48, 20, acc(P, th));
  text(ctx, str(P, "author", "Maya Chen · Head of Growth, Northwind"), -w / 2 + 84, h / 2 - 48, { size: 15, color: th.colors.muted });
});

/* ---------------- Node renderers ---------------- */
registerNodeRenderer("ui", (rc, node) => {
  const kind = UI_KINDS[p<string>(node, "kind", "dashboard")] ?? UI_KINDS.dashboard;
  const w = p<number>(node, "w", kind.w), h = p<number>(node, "h", kind.h);
  const t = (rc.frame - node.timing.start) / rc.fps - p<number>(node, "animDelay", 0) / rc.fps;
  kind.draw(rc.ctx, w, h, Math.max(0, t * p<number>(node, "speed", 1)), { ...node.props, accent: node.props.accent ?? rc.theme.colors.primary }, rc.theme);
}, (node) => { const k = UI_KINDS[(node.props.kind as string) ?? "dashboard"] ?? UI_KINDS.dashboard; return { w: (node.props.w as number) ?? k.w, h: (node.props.h as number) ?? k.h }; });

/* ---------------- Devices ---------------- */
export type DeviceDef = { id: string; name: string; w: number; h: number; screen: [number, number, number, number, number]; tags: string[] };
export const DEVICES: Record<string, DeviceDef> = {
  iphone: { id: "iphone", name: "iPhone", w: 400, h: 820, screen: [16, 16, 368, 788, 52], tags: ["mobile", "ios", "app"] },
  android: { id: "android", name: "Android", w: 400, h: 830, screen: [12, 12, 376, 806, 36], tags: ["mobile", "android", "app"] },
  laptop: { id: "laptop", name: "Laptop", w: 1200, h: 760, screen: [70, 30, 1060, 660, 8], tags: ["desktop", "macbook"] },
  desktop: { id: "desktop", name: "Desktop Display", w: 1200, h: 900, screen: [24, 24, 1152, 648, 6], tags: ["desktop", "imac"] },
  tablet: { id: "tablet", name: "Tablet", w: 900, h: 660, screen: [28, 28, 844, 604, 22], tags: ["tablet", "ipad"] },
  watch: { id: "watch", name: "Watch", w: 260, h: 320, screen: [26, 30, 208, 260, 48], tags: ["wearable", "watch"] },
  browserFrame: { id: "browserFrame", name: "Browser", w: 1200, h: 780, screen: [0, 44, 1200, 736, 0], tags: ["web", "browser"] },
  tv: { id: "tv", name: "TV", w: 1300, h: 820, screen: [20, 20, 1260, 710, 4], tags: ["tv", "streaming"] },
};
registerNodeRenderer("device", (rc, node) => {
  const { ctx, theme: th } = rc;
  const d = DEVICES[p<string>(node, "device", "iphone")] ?? DEVICES.iphone;
  const w = d.w, h = d.h, [sx, sy, sw, sh, sr] = d.screen;
  const x0 = -w / 2, y0 = -h / 2;
  const t = (rc.frame - node.timing.start) / rc.fps;
  const frameCol = p<string>(node, "frameColor", "#1c1d22");
  if (p<boolean>(node, "shadow", true)) { ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.filter = "blur(30px)"; ctx.beginPath(); ctx.ellipse(0, h / 2 + 20, w * 0.42, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  if (d.id === "laptop") { ctx.fillStyle = linearGrad(ctx, ["#d6d8de", "#8d9098"], 0, h / 2 - 50, 0, h / 2); ctx.beginPath(); ctx.moveTo(x0 - 40, h / 2 - 40); ctx.lineTo(x0 + w + 40, h / 2 - 40); ctx.lineTo(x0 + w + 10, h / 2); ctx.lineTo(x0 - 10, h / 2); ctx.closePath(); ctx.fill(); rr(ctx, x0 + 30, y0, w - 60, h - 40, 24); ctx.fillStyle = frameCol; ctx.fill(); }
  else if (d.id === "desktop") { ctx.fillStyle = "#b9bcc4"; ctx.fillRect(-60, y0 + 690, 120, 150); rr(ctx, -180, y0 + 830, 360, 22, 10); ctx.fill(); rr(ctx, x0, y0, w, 700, 20); ctx.fillStyle = frameCol; ctx.fill(); }
  else if (d.id === "browserFrame") { rr(ctx, x0, y0, w, h, 14); ctx.fillStyle = th.colors.surface2; ctx.fill(); ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => { ctx.beginPath(); ctx.arc(x0 + 22 + i * 20, y0 + 22, 6, 0, 7); ctx.fillStyle = c; ctx.fill(); }); }
  else if (d.id === "tv") { rr(ctx, x0, y0, w, 750, 12); ctx.fillStyle = frameCol; ctx.fill(); ctx.fillStyle = "#2a2c33"; ctx.fillRect(-120, y0 + 750, 240, 60); }
  else if (d.id === "watch") { rr(ctx, x0 + 60, y0 - 60, w - 120, h + 120, 30); ctx.fillStyle = "#2b2d33"; ctx.fill(); rr(ctx, x0, y0, w, h, 64); ctx.fillStyle = frameCol; ctx.fill(); }
  else { rr(ctx, x0, y0, w, h, d.id === "tablet" ? 40 : 64); ctx.fillStyle = linearGrad(ctx, [mixColor(frameCol, "#ffffff", 0.25), frameCol, mixColor(frameCol, "#000", 0.3)], x0, 0, x0 + w, 0); ctx.fill(); }
  // Screen
  ctx.save();
  rr(ctx, x0 + sx, y0 + sy, sw, sh, sr); ctx.clip();
  ctx.fillStyle = th.colors.bg; ctx.fillRect(x0 + sx, y0 + sy, sw, sh);
  const screen = p<string>(node, "screen", d.id === "iphone" || d.id === "android" || d.id === "watch" ? "chat" : "dashboard");
  const img = screen === "image" ? getImage(node.props.screenSrc) : undefined;
  if (img) { const s = Math.max(sw / img.naturalWidth, sh / img.naturalHeight); ctx.drawImage(img, x0 + sx + sw / 2 - (img.naturalWidth * s) / 2, y0 + sy, img.naturalWidth * s, img.naturalHeight * s); }
  else if (UI_KINDS[screen]) { const k = UI_KINDS[screen]; ctx.translate(x0 + sx + sw / 2, y0 + sy + sh / 2); const sc = Math.min(sw / k.w, sh / k.h) * (screen === "dashboard" || screen === "browser" ? 1 : 0.98); const fill = Math.max(sw / k.w, sh / k.h); const s2 = screen === "dashboard" ? fill : sc; ctx.scale(s2, s2); k.draw(ctx, screen === "dashboard" ? sw / s2 : k.w, screen === "dashboard" ? sh / s2 : k.h, Math.max(0, t - 0.3), { ...node.props, accent: node.props.accent ?? th.colors.primary }, th); }
  ctx.restore();
  if (p<boolean>(node, "reflection", true)) { ctx.save(); rr(ctx, x0 + sx, y0 + sy, sw, sh, sr); ctx.clip(); ctx.fillStyle = linearGrad(ctx, ["rgba(255,255,255,0.14)", "rgba(255,255,255,0)"], x0, y0, x0 + w * 0.6, y0 + h * 0.6); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + w * 0.55, y0); ctx.lineTo(x0, y0 + h * 0.7); ctx.fill(); ctx.restore(); }
  if (d.id === "iphone") { rr(ctx, -60, y0 + 30, 120, 34, 17); ctx.fillStyle = "#000"; ctx.fill(); }
  if (p<boolean>(node, "screenGlow", false)) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.shadowColor = th.colors.primary; ctx.shadowBlur = 80; rr(ctx, x0 + sx, y0 + sy, sw, sh, sr); ctx.strokeStyle = withAlpha(th.colors.primary, 0.3); ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
}, (node) => { const d = DEVICES[(node.props.device as string) ?? "iphone"] ?? DEVICES.iphone; return { w: d.w, h: d.h }; });
