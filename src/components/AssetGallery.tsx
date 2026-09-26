"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Tabs } from "radix-ui";
import { Check, Copy, Cpu, Download, ExternalLink, MonitorPlay, Save, Search, X, Zap, Box } from "lucide-react";
import "@/registry";
import { allAssets, scoreAsset } from "@/core/registry";
import type { AssetDef } from "@/core/types";
import Player from "./Player";
import SchemaForm from "./SchemaForm";
import { customizePreview, sendToEditor } from "./customize";
import { download, exportTemplateJSON } from "@/video/export";

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => { const el = ref.current; if (!el) return; const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" }); io.observe(el); return () => io.disconnect(); }, []);
  return [ref, seen] as const;
}
const perfColor = (v: string) => (v === "high" ? "text-amber-400" : v === "medium" ? "text-sky-400" : "text-emerald-400");

function Card({ a, onOpen }: { a: AssetDef; onOpen: () => void }) {
  const [ref, seen] = useInView<HTMLButtonElement>();
  const doc = useMemo(() => (seen && a.preview ? a.preview() : null), [seen, a]);
  return (
    <button ref={ref} type="button" onClick={onOpen} className="group flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] text-left transition hover:border-white/15 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400">
      <div className="aspect-video w-full bg-zinc-950">{doc ? <Player doc={doc} thumbnail controls={false} quality="medium" maxPixels={480 * 270} /> : null}</div>
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-zinc-100">{a.name}</span><span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">{a.kind}</span></div>
        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">{a.description}</p>
        <div className="mt-auto flex items-center gap-3 pt-1 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1"><Cpu size={11} className={perfColor(a.performance.cpu)} />CPU {a.performance.cpu}</span>
          <span className="flex items-center gap-1"><Zap size={11} className={perfColor(a.performance.gpu)} />GPU {a.performance.gpu}</span>
          {a.capabilities.video && <span className="flex items-center gap-1"><MonitorPlay size={11} />video</span>}
          {a.capabilities.three && <span className="flex items-center gap-1"><Box size={11} />3D</span>}
        </div>
      </div>
    </button>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return <button type="button" onClick={async () => { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1400); }} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10">{ok ? <Check size={13} /> : <Copy size={13} />}{ok ? "Copied" : label}</button>;
}

function Detail({ a, onClose }: { a: AssetDef; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...Object.fromEntries(Object.entries(a.schema).map(([k, f]) => [k, f.default])), ...a.defaults }));
  const doc = useMemo(() => customizePreview(a, values), [a, values]);
  const [status, setStatus] = useState("");
  const config = JSON.stringify({ asset: a.id, props: values }, null, 2);
  const save = async () => {
    setStatus("Saving…");
    const r = await fetch("/api/presets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `${a.name} (custom)`, kind: a.kind === "motion" ? "animation" : a.kind === "effect" ? "effects" : a.kind === "theme" ? "theme" : "node", nodeType: a.kind, data: { asset: a.id, props: values }, tags: a.tags.slice(0, 8) }) });
    setStatus(r.ok ? "Saved to your preset library" : `Save failed (${r.status})`);
  };
  return (
    <Dialog.Root open onOpenChange={(o: boolean) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(1200px,96vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl lg:flex-row">
          <div className="flex-1 overflow-y-auto p-5">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div><Dialog.Title className="text-lg font-semibold text-white">{a.name}</Dialog.Title><Dialog.Description className="text-sm text-zinc-400">{a.description}</Dialog.Description></div>
              <Dialog.Close aria-label="Close" className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"><X size={18} /></Dialog.Close>
            </div>
            <Player doc={doc} audio quality="high" />
            <div className="mt-4 flex flex-wrap gap-2">
              <CopyBtn text={a.code ?? config} label="Copy code" />
              <CopyBtn text={config} label="Copy config" />
              <button type="button" onClick={() => download(exportTemplateJSON(doc), `${a.id.replace(":", "-")}.json`)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10"><Download size={13} />Export JSON</button>
              <button type="button" onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10"><Save size={13} />Save as preset</button>
              <button type="button" onClick={() => sendToEditor(doc)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400"><ExternalLink size={13} />Open in editor</button>
              {status && <span className="self-center text-xs text-zinc-400" role="status">{status}</span>}
            </div>
          </div>
          <Tabs.Root defaultValue="customize" className="flex w-full flex-col border-t border-white/10 lg:w-[380px] lg:border-l lg:border-t-0">
            <Tabs.List aria-label="Asset details" className="flex border-b border-white/10 px-3">
              {["customize", "code", "docs"].map((t) => <Tabs.Trigger key={t} value={t} className="px-3 py-3 text-xs capitalize text-zinc-400 data-[state=active]:border-b-2 data-[state=active]:border-indigo-400 data-[state=active]:text-white">{t === "customize" ? "Customize" : t === "code" ? "Code & Config" : "Docs"}</Tabs.Trigger>)}
            </Tabs.List>
            <Tabs.Content value="customize" className="flex-1 overflow-y-auto p-4"><SchemaForm schema={a.schema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} /></Tabs.Content>
            <Tabs.Content value="code" className="flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Usage</p>
              <pre className="overflow-x-auto rounded-lg bg-black/60 p-3 text-[11px] leading-relaxed text-emerald-300">{a.code ?? "// Insert via editor or registry"}</pre>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Configuration</p>
              <pre className="overflow-x-auto rounded-lg bg-black/60 p-3 text-[11px] leading-relaxed text-sky-300">{config}</pre>
            </Tabs.Content>
            <Tabs.Content value="docs" className="flex-1 space-y-3 overflow-y-auto p-4 text-xs text-zinc-300">
              <p><span className="text-zinc-500">ID:</span> <code>{a.id}</code></p>
              <p><span className="text-zinc-500">Category:</span> {a.category} · <span className="text-zinc-500">Tier:</span> {a.tier}</p>
              <p><span className="text-zinc-500">Tags:</span> {a.tags.join(", ")}</p>
              <p><span className="text-zinc-500">Capabilities:</span> {Object.entries(a.capabilities).filter(([, v]) => v).map(([k]) => k).join(", ")}</p>
              <p><span className="text-zinc-500">Performance:</span> CPU {a.performance.cpu} · GPU {a.performance.gpu} · Memory {a.performance.memory}</p>
              <p><span className="text-zinc-500">Video:</span> deterministic from (frame, fps, props, seed); renders identically in preview and MP4/WebM export.</p>
              <p><span className="text-zinc-500">Props:</span> {Object.keys(a.schema).join(", ") || "—"}</p>
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function AssetGallery({
  categories = ["typography", "motion", "background", "effects", "shapes", "ui", "chart", "3d", "templates", "particle", "shader", "material"],
  title = "Universal Asset Catalog",
  intro = "Explore every motion preset, background shader, 3D object, UI mockup, chart and template."
}: {
  categories?: string[];
  title?: string;
  intro?: string;
}) {
  const assets = useMemo(() => allAssets().filter((a) => categories.includes(a.category) && a.preview), [categories]);
  const kinds = useMemo(() => [...new Set(assets.map((a) => a.kind))], [assets]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [limit, setLimit] = useState(24);
  const [open, setOpen] = useState<AssetDef | null>(null);
  const list = useMemo(() => {
    let l = assets.filter((a) => kind === "all" || a.kind === kind);
    if (q.trim()) l = l.map((a) => ({ a, s: scoreAsset(a, q) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.a);
    return l;
  }, [assets, kind, q]);
  return (
    <section className="mx-auto max-w-7xl px-6 pb-24 pt-12">
      <header className="mb-8 max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">{title}</h1>
        <p className="mt-3 text-base leading-relaxed text-zinc-400">{intro}</p>
        <p className="mt-2 text-xs text-zinc-500">{assets.length} assets · hover a card to play · click to customize, copy and export</p>
      </header>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[240px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Semantic search — e.g. "premium AI background", "cinematic text"' aria-label="Search assets" className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-indigo-400" /></label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
          {["all", ...kinds].map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1.5 text-xs capitalize ${kind === k ? "bg-white text-black" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`}>{k}</button>)}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.slice(0, limit).map((a) => <Card key={a.id} a={a} onOpen={() => setOpen(a)} />)}
      </div>
      {list.length === 0 && <p className="py-16 text-center text-sm text-zinc-500">No assets match “{q}”.</p>}
      {list.length > limit && <div className="mt-8 text-center"><button type="button" onClick={() => setLimit((l) => l + 24)} className="rounded-xl bg-white/5 px-5 py-2.5 text-sm text-zinc-200 hover:bg-white/10">Show more ({list.length - limit} remaining)</button></div>}
      {open && <Detail a={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
