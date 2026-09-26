import type { ClipShape } from "@/motion/presets";
import type { Ctx2D } from "./core";

/** Apply a reveal clip region for progress p (0 hidden → 1 full) over the rect (x,y,w,h). */
export function applyClip(ctx: Ctx2D, clip: { shape: ClipShape; p: number }, x: number, y: number, w: number, h: number) {
  const pr = Math.max(0, Math.min(1, clip.p));
  const pad = 4;
  ctx.beginPath();
  switch (clip.shape) {
    case "rect-up": ctx.rect(x - pad, y + h * (1 - pr) - pad, w + pad * 2, h * pr + pad * 2); break;
    case "rect-down": ctx.rect(x - pad, y - pad, w + pad * 2, h * pr + pad); break;
    case "rect-right": ctx.rect(x - pad, y - pad, w * pr + pad, h + pad * 2); break;
    case "rect-left": ctx.rect(x + w * (1 - pr), y - pad, w * pr + pad, h + pad * 2); break;
    case "center-x": ctx.rect(x + (w * (1 - pr)) / 2, y - pad, w * pr, h + pad * 2); break;
    case "center-y": ctx.rect(x - pad, y + (h * (1 - pr)) / 2, w + pad * 2, h * pr); break;
    case "circle": ctx.arc(x + w / 2, y + h / 2, (Math.hypot(w, h) / 2) * pr + 0.01, 0, Math.PI * 2); break;
    case "diamond": {
      const cx = x + w / 2, cy = y + h / 2, r = (w + h) * 0.5 * pr;
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
      break;
    }
  }
  ctx.clip();
}
