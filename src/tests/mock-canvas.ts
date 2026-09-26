/* Minimal recording Canvas2D mock so the real compositor can run under Node for render/determinism tests. */
export type CallLog = string[];
export function makeCtx(w: number, h: number, log: CallLog) {
  const canvas: Record<string, unknown> = { width: w, height: h };
  const grad = { addColorStop: () => {} };
  const state: Record<string, unknown> = { font: "10px sans-serif", globalAlpha: 1, filter: "none" };
  const ctx: Record<string, unknown> = new Proxy(state, {
    get(t, k: string) {
      if (k === "canvas") return canvas;
      if (k in t) return t[k];
      if (k === "measureText") return (s: string) => { const m = /(\d+(?:\.\d+)?)px/.exec(String(t.font)); return { width: String(s).length * (m ? Number(m[1]) : 10) * 0.55 }; };
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createConicGradient" || k === "createPattern") return () => grad;
      if (k === "createImageData") return (iw: number, ih: number) => ({ width: iw, height: ih, data: new Uint8ClampedArray(Math.max(1, iw * ih * 4)) });
      if (k === "getImageData") return (_x: number, _y: number, iw: number, ih: number) => ({ width: iw, height: ih, data: new Uint8ClampedArray(Math.max(1, iw * ih * 4)) });
      if (k === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return (...args: unknown[]) => { log.push(`${k}(${args.map((a) => (typeof a === "number" ? a.toFixed(2) : typeof a === "string" ? a : typeof a)).join(",")})`); };
    },
    set(t, k: string, v) { t[k] = v; if (k === "fillStyle" || k === "globalAlpha") log.push(`${k}=${typeof v === "number" ? v.toFixed(3) : typeof v === "string" ? v : "obj"}`); return true; },
  });
  canvas.getContext = (type: string) => (type === "2d" ? ctx : null);
  return ctx as unknown as CanvasRenderingContext2D;
}
export function installDom() {
  const g = globalThis as Record<string, unknown>;
  if (g.document) return;
  g.document = {
    createElement: (tag: string) => { if (tag !== "canvas") return {}; const log: CallLog = []; return (makeCtx(2, 2, log) as unknown as { canvas: unknown }).canvas; },
    createElementNS: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {}, remove: () => {} }),
    body: { appendChild: () => {} },
  };
}
