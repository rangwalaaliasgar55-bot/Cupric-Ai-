"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Undo2, Redo2, Save, FolderOpen, Upload, Download, Film, Image as ImageIcon, Wand2, AlertTriangle, X, Loader2, Plus } from "lucide-react";
import "@/registry";
import { allAssets } from "@/core/registry";
import type { AssetDef, Aspect, SceneNode, VideoDoc, Scene } from "@/core/types";
import { ASPECT_SIZES } from "@/core/types";
import { createNode, createScene, sceneSpans, docDuration, updateNode, updateScene, removeNode, splitNode, cloneWithNewIds, importDoc, uid } from "@/core/scene-graph";
import { getNodeRenderer } from "@/render/core";
import { buildTemplate, composeStory, TEMPLATES, type TemplateInput } from "@/video/templates";
import { generateVideo } from "@/ai/generate";
import { allThemes, generateTheme, registerTheme, getTheme } from "@/themes";
import { parseCaptions, scriptToCues, CAPTION_STYLES } from "@/video/captions";
import { renderVideo, exportFrame, download, exportTemplateJSON, exportCaptionsSRT, canEncode } from "@/video/export";
import Player from "../Player";
import Inspector from "./Inspector";
import Timeline from "./Timeline";
import { LOCAL_DOC_KEY } from "../customize";

type Tab = "ai" | "templates" | "text" | "shapes" | "media" | "backgrounds" | "particles" | "3d" | "ui" | "charts" | "logos" | "effects" | "transitions" | "motion" | "audio" | "captions" | "presets";
const TABS: [Tab, string, string[]][] = [["ai", "AI", []], ["templates", "Templates", ["template"]], ["text", "Text", ["typography"]], ["shapes", "Shapes", ["shape"]], ["media", "Media", []], ["backgrounds", "Backgrounds", ["background", "shader"]], ["particles", "Particles", ["particles"]], ["3d", "3D", ["material", "three", "lighting", "camera"]], ["ui", "UI", ["ui", "device"]], ["charts", "Charts", ["chart"]], ["logos", "Logos", ["logo"]], ["motion", "Motion", ["motion"]], ["effects", "Effects", ["effect"]], ["transitions", "Transitions", ["transition"]], ["audio", "Audio", []], ["captions", "Captions", ["caption"]], ["presets", "Presets", []]];
const HEAVY = new Set(["three", "physics", "shader"]);

export default function Editor() {
  const [doc, setDoc] = useState<VideoDoc>(() => buildTemplate("productLaunch", { brand: { name: "Cupric AI" } }));
  const hist = useRef<{ past: VideoDoc[]; future: VideoDoc[]; lastKey?: string; lastAt: number }>({ past: [], future: [], lastAt: 0 });
  const [, bump] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<Tab>("ai");
  const [quality, setQuality] = useState<"auto" | "low" | "medium" | "high">("auto");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [toast, setToast] = useState<string>("");
  const [errors, setErrors] = useState<string[]>([]);
  const [render, setRender] = useState<{ busy: boolean; p: number; abort?: AbortController }>({ busy: false, p: 0 });
  const [fmt, setFmt] = useState<"mp4" | "webm">("mp4");
  const [res, setRes] = useState(1);
  const [alpha, setAlpha] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string; updatedAt: string }[] | null>(null);
  const [presets, setPresets] = useState<{ id: string; name: string; kind: string; data: { asset?: string; props?: Record<string, unknown>; node?: SceneNode } }[]>([]);
  const [prompt, setPrompt] = useState("Create a 25-second premium futuristic AI SaaS advertisement for Cupric AI");
  const [search, setSearch] = useState("");
  const [brandColor, setBrandColor] = useState("#7c8cff");
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const commit = useCallback((fn: (d: VideoDoc) => VideoDoc, key?: string) => {
    setDoc((d) => {
      const next = fn(d);
      if (next === d) return d;
      const h = hist.current, now = Date.now();
      if (!(key && h.lastKey === key && now - h.lastAt < 700)) { h.past.push(d); if (h.past.length > 100) h.past.shift(); }
      h.future = []; h.lastKey = key; h.lastAt = now;
      return next;
    });
    bump((x) => x + 1);
  }, []);
  const undo = () => { const h = hist.current; const prev = h.past.pop(); if (prev) { h.future.push(doc); setDoc(prev); h.lastKey = undefined; bump((x) => x + 1); } };
  const redo = () => { const h = hist.current; const n = h.future.pop(); if (n) { h.past.push(doc); setDoc(n); bump((x) => x + 1); } };
  const replaceDoc = (d: VideoDoc) => { commit(() => d); setSelectedId(null); setSceneId(null); setFrame(0); };

  // Load: ?from=local | ?project=id
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("from") === "local") { const raw = localStorage.getItem(LOCAL_DOC_KEY); if (raw) { const r = importDoc(raw); if (r.ok) setDoc(r.doc); else setErrors(r.errors); } }
    const pid = sp.get("project");
    if (pid) fetch(`/api/projects/${pid}`).then((r) => r.json()).then((j) => { if (j.project) { const r = importDoc(j.project.doc); if (r.ok) { setDoc(r.doc); setProjectId(pid); } } });
  }, []);

  const spans = useMemo(() => sceneSpans(doc), [doc]);
  const total = docDuration(doc);
  const byFrame = spans.filter((s) => frame >= s.start && frame < s.end).at(-1) ?? spans.at(-1);
  const current = spans.find((s) => s.scene.id === sceneId) ?? byFrame;
  const sceneFrame = frame - (current?.start ?? 0);
  const node = selectedId ? current?.scene.nodes.find((n) => n.id === selectedId) ?? null : null;
  useEffect(() => { if (playing) setSceneId(null); }, [playing]);

  const heavy = useMemo(() => { let g = 0, parts = 0; doc.scenes.forEach((s) => s.nodes.forEach((n) => { if (HEAVY.has(n.type)) g++; if (n.type === "particles") parts++; })); return { g, parts, warn: g > 6 || parts > 8 || (doc.effects?.length ?? 0) > 5 }; }, [doc]);

  /* ---------- Insert from library ---------- */
  const insert = (n: SceneNode, atBottom = false) => {
    if (!current) return;
    const start = Math.max(0, Math.min(sceneFrame, current.scene.durationInFrames - 10));
    const nn = { ...n, id: uid(n.type.slice(0, 3)), timing: atBottom ? { start: 0, duration: current.scene.durationInFrames } : { start, duration: current.scene.durationInFrames - start } };
    commit((d) => updateScene(d, current.scene.id, (s) => ({ ...s, nodes: atBottom ? [nn, ...s.nodes] : [...s.nodes, nn] })));
    setSelectedId(nn.id); setSceneId(current.scene.id);
  };
  const cx = doc.width / 2, cy = doc.height / 2, s = Math.min(doc.width, doc.height) / 1080;
  const fromAsset = (a: AssetDef) => {
    const d = a.defaults;
    const at = { x: cx, y: cy };
    switch (a.kind) {
      case "template": { const id = a.id.replace("template:", ""); const inp = (doc.meta?.input ?? {}) as TemplateInput; replaceDoc(buildTemplate(id, { brand: inp.brand ?? { name: "Cupric AI" }, aspect: (inp.aspect as Aspect) ?? TEMPLATES[id]?.aspect })); flash(`Loaded template: ${a.name}`); return; }
      case "typography": return insert(createNode("text", { text: "Your headline here", size: 110 * s, animation: d.animation }, { ...at, name: "Text" }));
      case "shape": return insert(createNode("shape", { shape: d.shape, w: 320 * s, h: 320 * s, colors: [getTheme(doc.theme).colors.primary, getTheme(doc.theme).colors.secondary] }, { ...at, name: String(d.shape), enter: { preset: "pop" } }));
      case "background": case "shader": return insert(createNode(a.kind, { ...d, colors: getTheme(doc.theme).gradient, speed: 0.6 }, { ...at, name: a.name }), true);
      case "particles": return insert(createNode("particles", { ...d }, { ...at, name: a.name }));
      case "material": case "three": case "lighting": case "camera": return insert(createNode(d.preset ? "physics" : "three", { object: "torusKnot", material: "glass", w: 800 * s, h: 700 * s, color: getTheme(doc.theme).colors.primary, ...d }, { ...at, name: a.name, enter: { preset: "blurScale" } }));
      case "ui": return insert(createNode("ui", { ...d }, { transform: { ...at, scale: 0.8 * s }, name: a.name, enter: { preset: "saas" } }));
      case "device": return insert(createNode("device", { ...d }, { transform: { ...at, scale: 0.6 * s }, name: a.name, enter: { preset: "perspectiveIn" } }));
      case "chart": return insert(createNode("chart", { ...d, w: 800 * s, h: 440 * s, card: true, title: "Revenue" }, { ...at, name: a.name }));
      case "logo": return insert(createNode("logo", { ...d, text: (doc.meta?.input as TemplateInput | undefined)?.brand?.name ?? "Cupric", size: 130 * s }, { ...at, name: "Logo" }));
      case "motion": { if (!node) { flash("Select a layer first, then choose a motion preset."); return; } const id = a.id.replace("motion:", ""); const loop = a.tags.includes("loop"); commit((dd) => updateNode(dd, node.id, (n) => (loop ? { ...n, loop: { preset: id } } : { ...n, enter: { preset: id } }))); flash(`${loop ? "Loop" : "Entrance"} set to ${a.name}`); return; }
      case "effect": { if (!current) return; commit((dd) => updateScene(dd, current.scene.id, (sc) => ({ ...sc, effects: [...(sc.effects ?? []), { id: uid("fx"), type: a.id.replace("effect:", "") }] }))); flash(`${a.name} added to scene “${current.scene.name}”`); return; }
      case "transition": { if (!current || current.index === 0) { flash("Select the second scene or later; the transition plays into that scene."); return; } commit((dd) => updateScene(dd, current.scene.id, (sc) => ({ ...sc, transition: { type: a.id.replace("transition:", ""), duration: sc.transition?.duration || 18 } }))); flash(`Transition into “${current.scene.name}”: ${a.name}`); return; }
      case "caption": { const style = a.id.replace("caption:caption-", ""); commit((dd) => ({ ...dd, captions: dd.captions?.length ? dd.captions.map((c) => ({ ...c, style })) : [{ id: uid("cap"), style, cues: scriptToCues("Add your script in the Captions tab to generate timed, animated captions.") }] })); flash(`Caption style: ${a.name}`); return; }
    }
  };

  /* ---------- Canvas interaction ---------- */
  const hitTest = (x: number, y: number) => {
    if (!current) return null;
    const nodes = [...current.scene.nodes].reverse();
    for (const n of nodes) {
      if (n.hidden || n.locked) continue;
      const r = getNodeRenderer(n.type);
      if (!r || r.fullscreen) continue;
      const lf = sceneFrame - n.timing.start;
      if (lf < 0 || lf >= n.timing.duration) continue;
      const b = r.bounds(n, { w: doc.width, h: doc.height });
      const sc = n.transform.scale ?? 1;
      if (Math.abs(x - (n.transform.x ?? 0)) <= (b.w * sc) / 2 && Math.abs(y - (n.transform.y ?? 0)) <= (b.h * sc) / 2) return n;
    }
    return null;
  };
  const selBox = node && getNodeRenderer(node.type) && !getNodeRenderer(node.type)!.fullscreen ? (() => { const b = getNodeRenderer(node.type)!.bounds(node, { w: doc.width, h: doc.height }); const sc = node.transform.scale ?? 1; return { l: (((node.transform.x ?? 0) - (b.w * sc) / 2) / doc.width) * 100, t: (((node.transform.y ?? 0) - (b.h * sc) / 2) / doc.height) * 100, w: ((b.w * sc) / doc.width) * 100, h: ((b.h * sc) / doc.height) * 100 }; })() : null;

  /* ---------- Keyboard ---------- */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { commit((d) => removeNode(d, selectedId)); setSelectedId(null); }
      else if (e.key === "ArrowRight") setFrame((f) => Math.min(total - 1, f + (e.shiftKey ? 10 : 1)));
      else if (e.key === "ArrowLeft") setFrame((f) => Math.max(0, f - (e.shiftKey ? 10 : 1)));
      else if (e.key === "s" && selectedId) commit((d) => splitNode(d, selectedId, sceneFrame));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  /* ---------- Persistence & IO ---------- */
  const save = async () => {
    const r = await fetch(projectId ? `/api/projects/${projectId}` : "/api/projects", { method: projectId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: doc.name, doc }) });
    const j = await r.json();
    if (!r.ok) { setErrors(j.details ?? [j.error]); return; }
    if (!projectId) { setProjectId(j.id); window.history.replaceState(null, "", `/editor?project=${j.id}`); }
    flash("Project saved");
  };
  const openProjects = async () => { const j = await fetch("/api/projects").then((r) => r.json()); setProjects(j.projects ?? []); };
  const loadPresets = async () => { const j = await fetch("/api/presets").then((r) => r.json()); setPresets(j.presets ?? []); };
  useEffect(() => { if (tab === "presets") loadPresets(); }, [tab]);
  const importFile = async (f?: File) => { if (!f) return; const r = importDoc(await f.text()); if (r.ok) { replaceDoc(r.doc); flash("Template imported"); } else setErrors(r.errors); };
  const doRender = async () => {
    const check = await canEncode(fmt, Math.round(doc.width * res), Math.round(doc.height * res));
    if (!check.ok) { setErrors([check.reason ?? "Encoding not supported"]); return; }
    const abort = new AbortController();
    setRender({ busy: true, p: 0, abort });
    try {
      const out = await renderVideo({ doc, format: fmt, width: doc.width * res, height: doc.height * res, alpha: alpha && fmt === "webm", onProgress: (p) => setRender((r) => ({ ...r, p })), signal: abort.signal, quality: "high" });
      download(out.blob, `${doc.name.replace(/[^\w-]+/g, "_")}.${fmt}`);
      flash(`Rendered ${out.frames} frames (${out.codec}${out.audio ? " + audio" : ""}) — ${(out.blob.size / 1e6).toFixed(1)} MB`);
    } catch (e) { if ((e as Error).name !== "AbortError") setErrors([(e as Error).message]); }
    setRender({ busy: false, p: 0 });
  };
  const changeAspect = (a: Aspect) => {
    const [w, h] = ASPECT_SIZES[a as Exclude<Aspect, "custom">];
    const story = doc.meta?.story as string[] | undefined;
    if (story?.length) { replaceDoc(composeStory(story, { ...((doc.meta?.input ?? {}) as TemplateInput), aspect: a, style: doc.meta?.style as string | undefined })); flash("Story re-laid out for " + a); return; }
    const tid = doc.meta?.templateId as string | undefined;
    if (tid && TEMPLATES[tid]) { replaceDoc(buildTemplate(tid, { ...((doc.meta?.input ?? {}) as TemplateInput), aspect: a })); flash("Template re-laid out for " + a); return; }
    const kx = w / doc.width, ky = h / doc.height;
    commit((d) => ({ ...d, width: w, height: h, scenes: d.scenes.map((sc) => ({ ...sc, nodes: sc.nodes.map((n) => ({ ...n, transform: { ...n.transform, x: (n.transform.x ?? 0) * kx, y: (n.transform.y ?? 0) * ky, scale: (n.transform.scale ?? 1) * Math.min(kx, ky) } })) })) }));
    flash("Repositioned proportionally for " + a);
  };
  const applyBrand = () => { const t = generateTheme({ primary: brandColor, mode: getTheme(doc.theme).dark ? "dark" : "light" }); registerTheme(t); commit((d) => ({ ...d, theme: t.id })); flash("Brand theme generated from color"); };

  const libAssets = useMemo(() => { const kinds = TABS.find((t) => t[0] === tab)?.[2] ?? []; const q = search.toLowerCase(); return allAssets().filter((a) => kinds.includes(a.kind) && (!q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q)))); }, [tab, search]);
  const bar = "inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40";
  const sel = "rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200";

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col bg-stage-deep">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <input aria-label="Project name" value={doc.name} onChange={(e) => commit((d) => ({ ...d, name: e.target.value }), "docname")} className="w-56 rounded-lg bg-transparent px-2 py-1 text-sm font-medium text-white outline-none hover:bg-white/5 focus:bg-white/5" />
        <button type="button" className={bar} onClick={undo} disabled={!hist.current.past.length} title={(!hist.current.past.length) ? 'Nothing to undo' : undefined} aria-label="Undo"><Undo2 size={13} /></button>
        <button type="button" className={bar} onClick={redo} disabled={!hist.current.future.length} title={(!hist.current.future.length) ? 'Nothing to redo' : undefined} aria-label="Redo"><Redo2 size={13} /></button>
        <select aria-label="Aspect ratio" className={sel} value={Object.entries(ASPECT_SIZES).find(([, [w, h]]) => w === doc.width && h === doc.height)?.[0] ?? "custom"} onChange={(e) => changeAspect(e.target.value as Aspect)}>{Object.keys(ASPECT_SIZES).map((a) => <option key={a}>{a}</option>)}{!Object.values(ASPECT_SIZES).some(([w, h]) => w === doc.width && h === doc.height) && <option value="custom">custom</option>}</select>
        <select aria-label="Theme" className={sel} value={doc.theme} onChange={(e) => commit((d) => ({ ...d, theme: e.target.value }))}>{allThemes().map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <input aria-label="Brand color" type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-7 w-9 rounded border border-white/10 bg-transparent" />
        <button type="button" className={bar} onClick={applyBrand}>Apply brand</button>
        <select aria-label="Preview quality" className={sel} value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>{["auto", "low", "medium", "high"].map((q) => <option key={q}>{q}</option>)}</select>
        {heavy.warn && <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] text-amber-300" title="Many GPU-heavy layers; lower preview quality if playback stutters."><AlertTriangle size={12} />Expensive: {heavy.g} GPU layers, {heavy.parts} particle systems</span>}
        <span className="flex-1" />
        <button type="button" className={bar} onClick={save}><Save size={13} />Save</button>
        <button type="button" className={bar} onClick={openProjects}><FolderOpen size={13} />Projects</button>
        <label className={`${bar} cursor-pointer`}><Upload size={13} />Import<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} /></label>
        <button type="button" className={bar} onClick={() => download(exportTemplateJSON(doc), "template.json")}><Download size={13} />JSON</button>
        <button type="button" className={bar} onClick={async () => download(await exportFrame(doc, frame), `frame-${frame}.png`)}><ImageIcon size={13} />PNG</button>
        <button type="button" className={bar} onClick={async () => download(await exportFrame(doc, frame, "image/webp"), `frame-${frame}.webp`)}>WebP</button>
        {!!doc.captions?.length && <button type="button" className={bar} onClick={() => download(exportCaptionsSRT(doc), "captions.srt")}>SRT</button>}
        <select aria-label="Render format" className={sel} value={fmt} onChange={(e) => setFmt(e.target.value as "mp4" | "webm")}><option value="mp4">MP4</option><option value="webm">WebM</option></select>
        <select aria-label="Render resolution" className={sel} value={res} onChange={(e) => setRes(Number(e.target.value))}><option value={1}>{doc.width}×{doc.height}</option><option value={0.5}>{doc.width / 2}×{doc.height / 2}</option></select>
        {fmt === "webm" && <label className="flex items-center gap-1 text-[11px] text-zinc-400"><input type="checkbox" checked={alpha} onChange={(e) => setAlpha(e.target.checked)} className="accent-indigo-400" />alpha</label>}
        {render.busy ? <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs text-rose-200" onClick={() => render.abort?.abort()}><Loader2 size={13} className="animate-spin" />{Math.round(render.p * 100)}% · Cancel</button>
          : <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400" onClick={doRender}><Film size={13} />Render</button>}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr_300px]">
        {/* Library */}
        <aside aria-label="Library" className="flex min-h-0 flex-col border-r border-white/[0.06]">
          <div className="flex flex-wrap gap-1 border-b border-white/[0.06] p-2">{TABS.map(([id, l]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={`rounded-md px-2 py-1 text-[11px] ${tab === id ? "bg-white text-black" : "text-zinc-400 hover:bg-white/5"}`}>{l}</button>)}</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {tab === "ai" && <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); const out = await generateVideo({ prompt }); replaceDoc(out.doc); flash(out.recommendation.reasoning.join(" ")); }}>
              <label htmlFor="ai-prompt" className="text-[11px] text-zinc-400">Describe the video. The system picks aspect ratio, template, style, typography, background, transitions, effects and music.</label>
              <textarea id="ai-prompt" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs text-white outline-none focus:border-indigo-400" />
              <button type="submit" className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-xs font-semibold text-black"><Wand2 size={13} />Generate composition</button>
              <p className="text-[10px] text-zinc-600">Runs locally with a rule-based analyzer over the asset registry. No external AI service is used.</p>
            </form>}
            {tab === "media" && <div className="space-y-2">
              <label className="block text-[11px] text-zinc-400">Upload image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="mt-1 block w-full text-[11px] file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-zinc-200" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => insert(createNode("image", { src: String(r.result), w: 800 * s, h: 500 * s, radius: 20 }, { x: cx, y: cy, name: f.name, enter: { preset: "blurScale" } })); r.readAsDataURL(f); }} /></label>
              <form onSubmit={(e) => { e.preventDefault(); const url = new FormData(e.currentTarget).get("url") as string; if (url) insert(createNode("image", { src: url, w: 800 * s, h: 500 * s }, { x: cx, y: cy, name: "Image" })); }} className="flex gap-1"><input name="url" placeholder="https://image URL" className="flex-1 rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] text-white" /><button className="rounded-md bg-white/10 px-2 text-[11px]" type="submit">Add</button></form>
              <form onSubmit={(e) => { e.preventDefault(); const url = new FormData(e.currentTarget).get("glb") as string; if (url) insert(createNode("three", { object: "gltf", model: url, material: "glossy", w: 800 * s, h: 700 * s, animation: "turntable" }, { x: cx, y: cy, name: "GLB model" })); }} className="flex gap-1"><input name="glb" placeholder="https://model.glb" className="flex-1 rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] text-white" /><button className="rounded-md bg-white/10 px-2 text-[11px]" type="submit">3D</button></form>
            </div>}
            {tab === "audio" && <div className="space-y-3 text-[11px] text-zinc-400">
              <form onSubmit={(e) => { e.preventDefault(); const bpm = Number(new FormData(e.currentTarget).get("bpm")) || 120; commit((d) => ({ ...d, audio: [...(d.audio ?? []), { id: uid("au"), name: `Beat ${bpm} BPM`, kind: "music", generator: { type: "beat", bpm }, start: 0, volume: 0.8, fadeIn: 15, fadeOut: 30 }] })); }} className="flex items-center gap-1">Procedural beat<input name="bpm" type="number" defaultValue={120} className="w-16 rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-white" /><button type="submit" className="rounded-md bg-white/10 px-2 py-1" aria-label="Add beat track"><Plus size={11} /></button></form>
              <label className="block">Upload music / voiceover / SFX<input type="file" accept="audio/*" className="mt-1 block w-full file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-zinc-200" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 12e6) { setErrors(["Audio file must be under 12 MB"]); return; } const r = new FileReader(); r.onload = () => commit((d) => ({ ...d, audio: [...(d.audio ?? []), { id: uid("au"), name: f.name, kind: "music", src: String(r.result), start: 0, volume: 1, fadeIn: 10, fadeOut: 20 }] })); r.readAsDataURL(f); }} /></label>
              {(doc.audio ?? []).map((a) => <div key={a.id} className="space-y-1 rounded-lg border border-white/[0.06] p-2"><div className="flex items-center justify-between text-zinc-200"><span className="truncate">{a.name}</span><button type="button" aria-label="Remove track" onClick={() => commit((d) => ({ ...d, audio: d.audio?.filter((x) => x.id !== a.id) }))}><X size={11} /></button></div>
                {(["volume", "start", "fadeIn", "fadeOut", "trimStart"] as const).map((k) => <label key={k} className="flex items-center gap-1"><span className="w-14">{k}</span><input type="number" step={k === "volume" || k === "trimStart" ? 0.1 : 1} value={Number(a[k] ?? 0)} onChange={(e) => commit((d) => ({ ...d, audio: d.audio?.map((x) => (x.id === a.id ? { ...x, [k]: Number(e.target.value) } : x)) }), `au-${k}`)} className="w-full rounded border border-white/10 bg-zinc-900 px-1 text-white" /></label>)}
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!a.loop} onChange={(e) => commit((d) => ({ ...d, audio: d.audio?.map((x) => (x.id === a.id ? { ...x, loop: e.target.checked } : x)) }))} />loop</label></div>)}
              <p className="text-[10px] text-zinc-600">Audio drives audio-reactive layers (bass, mid, treble, beat) deterministically and is mixed into MP4/WebM exports where the browser can encode audio.</p>
            </div>}
            {tab === "captions" && <div className="mb-3 space-y-2 text-[11px] text-zinc-400">
              <label className="block">Import SRT / VTT / JSON<input type="file" accept=".srt,.vtt,.json,text/vtt" className="mt-1 block w-full file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-zinc-200" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const cues = parseCaptions(await f.text(), f.name); commit((d) => ({ ...d, captions: [{ id: uid("cap"), style: d.captions?.[0]?.style ?? "highlight", cues }] })); flash(`${cues.length} caption cues imported`); } catch (err) { setErrors([(err as Error).message]); } }} /></label>
              <form onSubmit={(e) => { e.preventDefault(); const t = String(new FormData(e.currentTarget).get("script") ?? ""); if (t.trim()) commit((d) => ({ ...d, captions: [{ id: uid("cap"), style: d.captions?.[0]?.style ?? "highlight", cues: scriptToCues(t) }] })); }} className="space-y-1"><textarea name="script" rows={3} placeholder="Paste a script to auto-time captions…" className="w-full rounded-md border border-white/10 bg-zinc-900 p-2 text-white" /><button type="submit" className="w-full rounded-md bg-white/10 py-1">Create captions</button></form>
              <p>{Object.keys(CAPTION_STYLES).length} styles — choose one below.</p>
            </div>}
            {tab === "presets" && <div className="space-y-1">{presets.length === 0 && <p className="text-[11px] text-zinc-500">No saved presets yet. Use “Save as preset” in the inspector or in the gallery.</p>}{presets.map((pr) => <div key={pr.id} className="flex items-center gap-1 rounded-lg bg-white/[0.03] px-2 py-1.5 text-[11px]"><button type="button" className="flex-1 truncate text-left text-zinc-200" onClick={() => { if (pr.data.node) insert(cloneWithNewIds(pr.data.node)); else if (pr.data.asset) { const a = allAssets().find((x) => x.id === pr.data.asset); if (a) fromAsset({ ...a, defaults: { ...a.defaults, ...(pr.data.props ?? {}) } }); } }}>{pr.name}<span className="ml-1 text-zinc-500">{pr.kind}</span></button><button type="button" aria-label="Delete preset" onClick={async () => { await fetch(`/api/presets?id=${pr.id}`, { method: "DELETE" }); loadPresets(); }} className="text-zinc-500 hover:text-white"><X size={11} /></button></div>)}</div>}
            {libAssets.length > 0 && <>
              <input aria-label="Filter library" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter…" className="mb-2 w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
              <ul className="space-y-1">{libAssets.slice(0, 200).map((a) => <li key={a.id}><button type="button" onClick={() => fromAsset(a)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/5"><span className="block truncate text-[12px] text-zinc-200">{a.name}</span><span className="block truncate text-[10px] text-zinc-500">{a.description}</span></button></li>)}</ul>
            </>}
          </div>
        </aside>
        {/* Canvas */}
        <section aria-label="Canvas" className="flex min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,var(--color-stage-raised),var(--color-stage-deep))] p-4">
          <div className="relative w-full" style={{ maxWidth: `min(100%, calc((100vh - 400px) * ${doc.width / doc.height}))` }}>
            <Player doc={doc} frame={frame} onFrameChange={setFrame} playing={playing} onPlayingChange={setPlaying} quality={quality} audio loop={false}
              onCanvasPointerDown={(e, x, y) => { const hit = hitTest(x, y); setSelectedId(hit?.id ?? null); if (current) setSceneId(current.scene.id); if (hit) { dragRef.current = { id: hit.id, dx: x - (hit.transform.x ?? 0), dy: y - (hit.transform.y ?? 0) }; e.currentTarget.setPointerCapture(e.pointerId); } }}
              onCanvasPointerMove={(_e, x, y) => { const d = dragRef.current; if (!d) return; commit((dd) => updateNode(dd, d.id, (n) => ({ ...n, transform: { ...n.transform, x: Math.round(x - d.dx), y: Math.round(y - d.dy) } })), `drag-${d.id}`); }}
              onCanvasPointerUp={() => { dragRef.current = null; }} />
            {selBox && <div aria-hidden className="pointer-events-none absolute rounded-sm border border-indigo-400/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${selBox.l}%`, top: `calc(${selBox.t}% * ${1})`, width: `${selBox.w}%`, height: `${selBox.h}%`, transform: `translateY(calc(${0}px))`, maxHeight: "100%" }} />}
          </div>
          {toast && <p role="status" className="mt-3 max-w-2xl text-center text-xs text-zinc-400">{toast}</p>}
        </section>
        {/* Inspector */}
        <aside aria-label="Inspector" className="min-h-0 overflow-y-auto border-l border-white/[0.06]">
          <Inspector doc={doc} node={node} scene={current?.scene ?? null} sceneFrame={sceneFrame} isFirstScene={current?.index === 0}
            onNode={(fn, key) => node && commit((d) => updateNode(d, node.id, fn), key ? `${node.id}-${key}` : undefined)}
            onScene={(fn, key) => current && commit((d) => updateScene(d, current.scene.id, fn), key ? `${current.scene.id}-${key}` : undefined)}
            onDoc={(fn, key) => commit(fn, key)}
            onDelete={() => { if (node) { commit((d) => removeNode(d, node.id)); setSelectedId(null); } }}
            onSavePreset={async (n) => { const r = await fetch("/api/presets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `${n.name ?? n.type} preset`, kind: "node", nodeType: n.type, data: { node: n }, tags: [n.type] }) }); flash(r.ok ? "Preset saved" : "Preset save failed"); }} />
        </aside>
      </div>
      <div className="h-[230px] border-t border-white/[0.06]">
        <Timeline doc={doc} spans={spans} current={current} frame={frame} setFrame={(f) => { setPlaying(false); setFrame(f); }} total={total}
          selectedId={selectedId} onSelect={(id) => { setSelectedId(id); if (current) setSceneId(current.scene.id); }} onSceneSelect={(id) => { setSceneId(id); setSelectedId(null); const sp = spans.find((x) => x.scene.id === id); if (sp) setFrame(sp.start + sp.transitionIn); }}
          onTiming={(id, start, duration) => commit((d) => updateNode(d, id, (n) => ({ ...n, timing: { start: Math.round(start), duration: Math.round(duration) } })), `timing-${id}`)}
          onToggle={(id, k) => commit((d) => updateNode(d, id, (n) => ({ ...n, [k]: !n[k] })))}
          onReorder={(id, dir) => current && commit((d) => updateScene(d, current.scene.id, (sc: Scene) => { const i = sc.nodes.findIndex((n) => n.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= sc.nodes.length) return sc; const nodes = [...sc.nodes]; [nodes[i], nodes[j]] = [nodes[j], nodes[i]]; return { ...sc, nodes }; }))}
          onSplit={() => selectedId && commit((d) => splitNode(d, selectedId, sceneFrame))}
          onDuplicate={() => { if (!node || !current) return; const c = cloneWithNewIds(node); c.name = `${node.name ?? node.type} copy`; c.transform = { ...c.transform, x: (c.transform.x ?? 0) + 30, y: (c.transform.y ?? 0) + 30 }; commit((d) => updateScene(d, current.scene.id, (sc) => ({ ...sc, nodes: [...sc.nodes, c] }))); setSelectedId(c.id); }}
          onDelete={() => { if (selectedId) { commit((d) => removeNode(d, selectedId)); setSelectedId(null); } }}
          onAddMarker={() => commit((d) => ({ ...d, markers: [...(d.markers ?? []), { frame, label: `M${(d.markers?.length ?? 0) + 1}` }] }))}
          onSceneDuration={(id, f) => commit((d) => updateScene(d, id, (sc) => ({ ...sc, durationInFrames: f })), `scene-dur-${id}`)}
          onToggleAudio={(id) => commit((d) => ({ ...d, audio: d.audio?.map((a) => (a.id === id ? { ...a, muted: !a.muted } : a)) }))} />
      </div>
      <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-1 text-[10px] text-zinc-600">
        <button type="button" className="hover:text-white" onClick={() => current && commit((d) => { const i = d.scenes.findIndex((x) => x.id === current.scene.id); const sc = createScene("New scene", 90, [createNode("background", { variant: "mesh", colors: getTheme(d.theme).gradient }, { x: d.width / 2, y: d.height / 2, name: "background", timing: { start: 0, duration: 90 } })], { transition: { type: "crossfade", duration: 15 } }); const scenes = [...d.scenes]; scenes.splice(i + 1, 0, sc); return { ...d, scenes }; })}>+ Add scene</button>
        <button type="button" className="hover:text-white" onClick={() => current && commit((d) => { const i = d.scenes.findIndex((x) => x.id === current.scene.id); const c = cloneWithNewIds(current.scene); c.name += " copy"; const scenes = [...d.scenes]; scenes.splice(i + 1, 0, c); return { ...d, scenes }; })}>Duplicate scene</button>
        <button type="button" className="hover:text-white disabled:opacity-30" disabled={doc.scenes.length < 2} title={doc.scenes.length < 2 ? 'A project needs at least one scene — add another before deleting' : undefined} onClick={() => current && commit((d) => ({ ...d, scenes: d.scenes.filter((x) => x.id !== current.scene.id) }))}>Delete scene</button>
        <span className="ml-auto">Space play/pause · ←/→ step · S split · Del delete · ⌘Z undo · drag layers on the canvas</span>
      </div>
      {errors.length > 0 && <div role="alert" className="fixed bottom-4 right-4 z-50 max-w-md rounded-xl border border-rose-500/30 bg-rose-950/90 p-4 text-xs text-rose-100 shadow-xl"><div className="mb-1 flex items-center justify-between font-semibold">Something needs attention<button type="button" aria-label="Dismiss" onClick={() => setErrors([])}><X size={14} /></button></div><ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      {projects && <div role="dialog" aria-modal="true" aria-label="Projects" className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={() => setProjects(null)}><div className="w-[480px] rounded-2xl border border-white/10 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}><div className="mb-3 flex items-center justify-between text-sm font-semibold text-white">Saved projects<button type="button" aria-label="Close" onClick={() => setProjects(null)}><X size={16} /></button></div>{projects.length === 0 && <p className="text-xs text-zinc-500">Nothing saved yet.</p>}<ul className="max-h-80 space-y-1 overflow-y-auto">{projects.map((pr) => <li key={pr.id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs"><button type="button" className="flex-1 truncate text-left text-zinc-200" onClick={() => { window.location.href = `/editor?project=${pr.id}`; }}>{pr.name}</button><span className="text-zinc-500">{new Date(pr.updatedAt).toLocaleString()}</span><button type="button" aria-label="Delete project" onClick={async () => { await fetch(`/api/projects/${pr.id}`, { method: "DELETE" }); openProjects(); }}><X size={12} /></button></li>)}</ul></div></div>}
    </div>
  );
}
