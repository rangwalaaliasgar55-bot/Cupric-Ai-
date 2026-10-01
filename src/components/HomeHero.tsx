"use client";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Sparkles, Wand2 } from "lucide-react";
import Player from "./Player";
import { buildTemplate } from "@/video/templates";
import { generateVideo, type Recommendation } from "@/ai/generate";
import type { VideoDoc } from "@/core/types";
import { sendToEditor } from "./customize";

const EXAMPLES = ["Create a 25-second premium futuristic AI SaaS advertisement for NewBrand", "15 second TikTok for a fintech app called Ledger", "Cinematic logo reveal for Aurora", "30 second corporate explainer with 3D glass product"];

export default function HomeHero() {
  const initial = useMemo(() => buildTemplate("futuristicAd", { brand: { name: "NewBrand" } }), []);
  const [doc, setDoc] = useState<VideoDoc>(initial);
  const [prompt, setPrompt] = useState(EXAMPLES[0]);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (p: string) => { setBusy(true); const out = await generateVideo({ prompt: p }); setDoc(out.doc); setRec(out.recommendation); setBusy(false); };
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 h-[520px] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(124,140,255,0.22),transparent_70%)]" />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-6 pb-16 pt-16 lg:grid-cols-[1fr_1.25fr] lg:items-center lg:pt-24">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.05, 0.7, 0.1, 1] }}>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400"><Sparkles size={12} className="text-indigo-300" />Motion · 3D · Typography · Video · AI-ready</p>
          <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.035em] text-white md:text-6xl">The motion design operating system for React.</h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-400">One deterministic engine renders every preview, editor frame and exported MP4. Scenes are serializable JSON, so developers, editors and AI agents build the same compositions.</p>
          <form onSubmit={(e) => { e.preventDefault(); run(prompt); }} className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
            <label htmlFor="prompt" className="sr-only">Describe a video</label>
            <textarea id="prompt" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600" placeholder="Describe the video you want…" />
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <div className="flex flex-wrap gap-1.5">{EXAMPLES.slice(1).map((ex) => <button type="button" key={ex} onClick={() => { setPrompt(ex); run(ex); }} className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-white">{ex.split(" ").slice(0, 4).join(" ")}…</button>)}</div>
              <button type="submit" disabled={busy} title={(busy) ? 'Composing — wait for the current draft' : undefined} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"><Wand2 size={13} />{busy ? "Composing…" : "Generate"}</button>
            </div>
          </form>
          {rec && <ul className="mt-4 space-y-1 text-xs text-zinc-500">{rec.reasoning.map((r) => <li key={r}>— {r}</li>)}</ul>}
        </motion.div>
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, delay: 0.1, ease: [0.05, 0.7, 0.1, 1] }} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 shadow-[0_40px_120px_-40px_rgba(124,140,255,0.35)]">
          <Player key={doc.id} doc={doc} audio quality="auto" className={doc.height > doc.width ? "mx-auto max-w-[320px]" : ""} />
          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
            <span className="truncate">{doc.name} · {doc.scenes.length} scenes · {doc.width}×{doc.height}</span>
            <button type="button" onClick={() => sendToEditor(doc)} className="rounded-lg bg-indigo-500 px-3 py-1.5 font-medium text-white hover:bg-indigo-400">Edit every element →</button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
