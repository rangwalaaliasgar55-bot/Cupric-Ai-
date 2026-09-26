"use client";
import { useMemo, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import Player from "./Player";
import { TEMPLATES, STYLES, buildTemplate } from "@/video/templates";
import { sendToEditor } from "./customize";
import { download, exportTemplateJSON } from "@/video/export";
import type { Aspect } from "@/core/types";

const cls = "w-full rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-sm text-white outline-none focus:border-indigo-400";
export default function TemplatePlayground() {
  const ids = Object.keys(TEMPLATES).filter((k) => !k.startsWith("__"));
  const [tpl, setTpl] = useState("aiLaunch");
  const def = TEMPLATES[tpl];
  const [f, setF] = useState({ brand: "Cupric AI", logo: "", primary: "#7c8cff", useColor: false, headline: "", subtitle: "", features: "", cta: "", duration: 0, music: 118, style: "", aspect: "" as "" | Aspect, screenshot: "" });
  const set = (k: keyof typeof f, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  const doc = useMemo(() => {
    if (f.style && def) TEMPLATES[tpl] = { ...def, style: f.style };
    const d = buildTemplate(tpl, { brand: { name: f.brand || "Cupric AI", ...(f.useColor ? { primary: f.primary } : {}), ...(f.logo ? { logoSrc: f.logo } : {}) }, headline: f.headline || undefined, subtitle: f.subtitle || undefined, cta: f.cta || undefined, features: f.features ? f.features.split(",").map((s) => s.trim()).filter(Boolean) : undefined, duration: f.duration || undefined, music: f.music || null, aspect: f.aspect || undefined, screenshot: f.screenshot || undefined });
    if (def) TEMPLATES[tpl] = def;
    return d;
  }, [tpl, f, def]);
  const onLogo = (file?: File) => { if (!file) return; const r = new FileReader(); r.onload = () => set("logo", String(r.result)); r.readAsDataURL(file); };
  return (
    <section className="mx-auto max-w-7xl px-6 pt-12">
      <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">Video template playground</h1>
      <p className="mt-3 max-w-2xl text-zinc-400">Choose a template and change its brand, copy, color, duration, music, style or aspect ratio. The preview rebuilds immediately, and portrait/square formats get alternate layouts rather than a crop.</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-[340px_1fr]">
        <form className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4" onSubmit={(e) => e.preventDefault()}>
          <label className="block text-xs text-zinc-400">Template<select className={cls} value={tpl} onChange={(e) => setTpl(e.target.value)}>{ids.map((i) => <option key={i} value={i}>{TEMPLATES[i].name} · {TEMPLATES[i].category}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-zinc-400">Aspect<select className={cls} value={f.aspect} onChange={(e) => set("aspect", e.target.value)}><option value="">Default ({def?.aspect})</option>{["16:9", "9:16", "1:1", "4:5", "4:3"].map((a) => <option key={a}>{a}</option>)}</select></label>
            <label className="block text-xs text-zinc-400">Style<select className={cls} value={f.style} onChange={(e) => set("style", e.target.value)}><option value="">Default ({def?.style})</option>{Object.keys(STYLES).map((s) => <option key={s}>{s}</option>)}</select></label>
          </div>
          <label className="block text-xs text-zinc-400">Brand name<input className={cls} value={f.brand} onChange={(e) => set("brand", e.target.value)} /></label>
          <label className="block text-xs text-zinc-400">Logo image (optional)<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => onLogo(e.target.files?.[0])} className="mt-1 block w-full text-xs text-zinc-400 file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-zinc-200" /></label>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={f.useColor} onChange={(e) => set("useColor", e.target.checked)} className="accent-indigo-400" />Brand color</label>
            <input type="color" aria-label="Primary color" value={f.primary} onChange={(e) => { set("primary", e.target.value); set("useColor", true); }} className="h-8 w-12 rounded border border-white/10 bg-transparent" />
          </div>
          <label className="block text-xs text-zinc-400">Headline<input className={cls} placeholder={def?.defaults.headline} value={f.headline} onChange={(e) => set("headline", e.target.value)} /></label>
          <label className="block text-xs text-zinc-400">Subtitle<input className={cls} placeholder={def?.defaults.subtitle} value={f.subtitle} onChange={(e) => set("subtitle", e.target.value)} /></label>
          <label className="block text-xs text-zinc-400">Features (comma separated)<input className={cls} placeholder={def?.defaults.features?.join(", ")} value={f.features} onChange={(e) => set("features", e.target.value)} /></label>
          <label className="block text-xs text-zinc-400">Screenshot URL (optional)<input className={cls} placeholder="https://…/screen.png" value={f.screenshot} onChange={(e) => set("screenshot", e.target.value)} /></label>
          <label className="block text-xs text-zinc-400">CTA<input className={cls} placeholder={def?.defaults.cta} value={f.cta} onChange={(e) => set("cta", e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-zinc-400">Duration (s)<input type="number" min={3} max={120} className={cls} placeholder={String(def?.duration)} value={f.duration || ""} onChange={(e) => set("duration", Number(e.target.value))} /></label>
            <label className="block text-xs text-zinc-400">Music BPM (0 = off)<input type="number" min={0} max={200} className={cls} value={f.music} onChange={(e) => set("music", Number(e.target.value))} /></label>
          </div>
        </form>
        <div>
          <Player key={`${doc.width}x${doc.height}`} doc={doc} audio className={doc.height > doc.width ? "mx-auto max-w-[400px]" : ""} />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{doc.scenes.map((s) => s.name).join(" → ")}</span>
            <span className="ml-auto" />
            <button type="button" onClick={() => download(exportTemplateJSON(doc), `${tpl}.template.json`)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-zinc-200 hover:bg-white/10"><Download size={13} />template.json</button>
            <button type="button" onClick={() => sendToEditor(doc)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 font-medium text-white hover:bg-indigo-400"><ExternalLink size={13} />Open in editor to render</button>
          </div>
        </div>
      </div>
    </section>
  );
}
