"use client";
import { useRef, useState } from "react";
import { Eye, EyeOff, Lock, Unlock, Scissors, Copy, Trash2, ChevronUp, ChevronDown, Flag, Magnet, Volume2, VolumeX } from "lucide-react";
import type { SceneNode, VideoDoc } from "@/core/types";
import type { SceneSpan } from "@/core/scene-graph";

const TRACK: Record<string, [string, string]> = { text: ["TEXT", "bg-indigo-500/70"], shape: ["SHAPE", "bg-fuchsia-500/60"], background: ["BG", "bg-zinc-600/70"], shader: ["BG", "bg-zinc-600/70"], particles: ["FX", "bg-amber-500/60"], ui: ["UI", "bg-sky-500/60"], chart: ["UI", "bg-cyan-500/60"], device: ["UI", "bg-sky-600/60"], image: ["IMAGE", "bg-emerald-500/60"], logo: ["TEXT", "bg-violet-500/70"], three: ["3D", "bg-rose-500/60"], physics: ["3D", "bg-rose-600/60"] };

export type TimelineProps = {
  doc: VideoDoc; spans: SceneSpan[]; current: SceneSpan | undefined; frame: number; setFrame: (f: number) => void; total: number;
  selectedId: string | null; onSelect: (id: string | null) => void; onSceneSelect: (id: string) => void;
  onTiming: (id: string, start: number, duration: number) => void; onToggle: (id: string, key: "hidden" | "locked") => void; onReorder: (id: string, dir: -1 | 1) => void;
  onSplit: () => void; onDuplicate: () => void; onDelete: () => void; onAddMarker: () => void; onSceneDuration: (id: string, frames: number) => void; onToggleAudio: (id: string) => void;
};

export default function Timeline(p: TimelineProps) {
  const [zoom, setZoom] = useState(4); // px per frame
  const [snap, setSnap] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: "move" | "start" | "end" | "scene"; x0: number; start: number; dur: number } | null>(null);
  const W = p.total * zoom;
  const LABEL = 132;
  const nodes = p.current?.scene.nodes ?? [];
  const off = p.current?.start ?? 0;
  const snapTo = (f: number, self: string) => {
    if (!snap) return Math.round(f);
    const targets = [p.frame - off, 0, p.current?.scene.durationInFrames ?? 0, ...nodes.filter((n) => n.id !== self).flatMap((n) => [n.timing.start, n.timing.start + n.timing.duration])];
    for (const t of targets) if (Math.abs(t - f) * zoom < 6) return t;
    return Math.round(f);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const df = (e.clientX - d.x0) / zoom;
    if (d.mode === "scene") { p.onSceneDuration(d.id, Math.max(10, Math.round(d.dur + df))); return; }
    if (d.mode === "move") { const s = snapTo(d.start + df, d.id); p.onTiming(d.id, Math.max(0, s), d.dur); }
    if (d.mode === "start") { const s = Math.min(d.start + d.dur - 2, Math.max(0, snapTo(d.start + df, d.id))); p.onTiming(d.id, s, d.dur - (s - d.start)); }
    if (d.mode === "end") { const e2 = snapTo(d.start + d.dur + df, d.id); p.onTiming(d.id, d.start, Math.max(2, e2 - d.start)); }
  };
  const seekFromEvent = (e: React.PointerEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); p.setFrame(Math.max(0, Math.min(p.total - 1, Math.round((e.clientX - r.left) / zoom)))); };
  const ticks = []; const step = zoom > 6 ? 15 : zoom > 2 ? 30 : 90;
  for (let f = 0; f <= p.total; f += step) ticks.push(f);
  const btn = "grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30";
  return (
    <div className="flex h-full flex-col bg-[#0a0b10] text-xs" onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
      <div className="flex items-center gap-1 border-b border-white/[0.06] px-2 py-1">
        <button type="button" className={btn} title="Split at playhead (S)" aria-label="Split at playhead" onClick={p.onSplit} disabled={!p.selectedId}><Scissors size={14} /></button>
        <button type="button" className={btn} title="Duplicate (⌘D)" aria-label="Duplicate" onClick={p.onDuplicate} disabled={!p.selectedId}><Copy size={14} /></button>
        <button type="button" className={btn} title="Delete (Del)" aria-label="Delete" onClick={p.onDelete} disabled={!p.selectedId}><Trash2 size={14} /></button>
        <button type="button" className={btn} title="Add marker at playhead" aria-label="Add marker" onClick={p.onAddMarker}><Flag size={14} /></button>
        <button type="button" className={`${btn} ${snap ? "text-indigo-300" : ""}`} aria-pressed={snap} title="Snapping" aria-label="Toggle snapping" onClick={() => setSnap(!snap)}><Magnet size={14} /></button>
        <span className="ml-2 text-zinc-500">Zoom</span>
        <input aria-label="Timeline zoom" type="range" min={0.5} max={14} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-28 accent-indigo-400" />
        <span className="ml-auto font-mono text-zinc-500">frame {p.frame} · {(p.frame / p.doc.fps).toFixed(2)}s</span>
      </div>
      <div ref={scroller} className="relative flex-1 overflow-auto">
        <div style={{ width: W + LABEL + 40 }} className="relative">
          {/* Ruler */}
          <div className="sticky top-0 z-20 flex h-6 border-b border-white/[0.06] bg-[#0a0b10]">
            <div style={{ width: LABEL }} className="sticky left-0 z-10 shrink-0 bg-[#0a0b10]" />
            <div className="relative flex-1 cursor-pointer" onPointerDown={(e) => { seekFromEvent(e); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }} onPointerMove={(e) => { if (e.buttons) seekFromEvent(e); }}>
              {ticks.map((f) => <span key={f} className="absolute top-0 h-full border-l border-white/10 pl-1 text-[10px] text-zinc-500" style={{ left: f * zoom }}>{(f / p.doc.fps).toFixed(0)}s</span>)}
              {(p.doc.markers ?? []).map((m, i) => <span key={i} title={m.label} className="absolute top-0 h-full w-0.5 bg-amber-400" style={{ left: m.frame * zoom }} />)}
            </div>
          </div>
          {/* Scenes strip */}
          <div className="flex h-8 border-b border-white/[0.06]">
            <div style={{ width: LABEL }} className="sticky left-0 z-10 flex shrink-0 items-center bg-[#0a0b10] px-2 font-semibold text-zinc-500">SCENES</div>
            <div className="relative flex-1">
              {p.spans.map((s) => (
                <div key={s.scene.id} role="button" tabIndex={0} onClick={() => p.onSceneSelect(s.scene.id)} onKeyDown={(e) => e.key === "Enter" && p.onSceneSelect(s.scene.id)} className={`absolute top-1 flex h-6 items-center overflow-hidden rounded-md border px-2 ${p.current?.scene.id === s.scene.id ? "border-indigo-400 bg-indigo-500/25 text-white" : "border-white/10 bg-white/5 text-zinc-400"}`} style={{ left: s.start * zoom, width: (s.end - s.start) * zoom }}>
                  {s.transitionIn > 0 && <span className="absolute inset-y-0 left-0 bg-white/10" style={{ width: s.transitionIn * zoom }} title={`Transition: ${s.scene.transition?.type}`} />}
                  <span className="relative truncate">{s.scene.name}</span>
                  <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/20" onPointerDown={(e) => { e.stopPropagation(); drag.current = { id: s.scene.id, mode: "scene", x0: e.clientX, start: 0, dur: s.scene.durationInFrames }; }} />
                </div>
              ))}
            </div>
          </div>
          {/* Node tracks of the current scene */}
          {nodes.map((n: SceneNode, i) => {
            const [label, color] = TRACK[n.type] ?? ["NODE", "bg-zinc-500/60"];
            const sel = n.id === p.selectedId;
            return (
              <div key={n.id} className={`flex h-8 border-b border-white/[0.04] ${sel ? "bg-white/[0.03]" : ""}`}>
                <div style={{ width: LABEL }} className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-[#0a0b10] px-1.5">
                  <span className="w-9 shrink-0 text-[9px] font-semibold text-zinc-600">{label}</span>
                  <button type="button" onClick={() => p.onSelect(n.id)} className={`flex-1 truncate text-left ${sel ? "text-white" : "text-zinc-400"}`}>{n.name ?? n.type}</button>
                  <button type="button" aria-label={n.hidden ? "Show" : "Hide"} onClick={() => p.onToggle(n.id, "hidden")} className="text-zinc-500 hover:text-white">{n.hidden ? <EyeOff size={11} /> : <Eye size={11} />}</button>
                  <button type="button" aria-label={n.locked ? "Unlock" : "Lock"} onClick={() => p.onToggle(n.id, "locked")} className="text-zinc-500 hover:text-white">{n.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => p.onReorder(n.id, -1)} className="text-zinc-500 hover:text-white disabled:opacity-20"><ChevronUp size={11} /></button>
                  <button type="button" aria-label="Move down" disabled={i === nodes.length - 1} onClick={() => p.onReorder(n.id, 1)} className="text-zinc-500 hover:text-white disabled:opacity-20"><ChevronDown size={11} /></button>
                </div>
                <div className="relative flex-1">
                  <div
                    className={`absolute top-1 h-6 rounded-md ${color} ${sel ? "ring-2 ring-white" : ""} ${n.hidden ? "opacity-30" : ""} ${n.locked ? "cursor-not-allowed" : "cursor-grab"}`}
                    style={{ left: (off + n.timing.start) * zoom, width: Math.max(4, n.timing.duration * zoom) }}
                    onPointerDown={(e) => { p.onSelect(n.id); if (n.locked) return; drag.current = { id: n.id, mode: "move", x0: e.clientX, start: n.timing.start, dur: n.timing.duration }; }}
                  >
                    <span className="pointer-events-none absolute inset-0 truncate px-2 leading-6 text-[10px] text-white/90">{n.enter?.preset ?? ""}{n.loop ? ` ∞${n.loop.preset}` : ""}</span>
                    {n.keyframes?.flatMap((tr) => tr.keyframes.map((k) => <span key={`${tr.property}${k.frame}`} title={`${tr.property} @${k.frame}`} className="pointer-events-none absolute top-2 h-2 w-2 rotate-45 bg-white" style={{ left: k.frame * zoom - 4 }} />))}
                    {!n.locked && <><span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-md bg-white/30" onPointerDown={(e) => { e.stopPropagation(); p.onSelect(n.id); drag.current = { id: n.id, mode: "start", x0: e.clientX, start: n.timing.start, dur: n.timing.duration }; }} />
                    <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-md bg-white/30" onPointerDown={(e) => { e.stopPropagation(); p.onSelect(n.id); drag.current = { id: n.id, mode: "end", x0: e.clientX, start: n.timing.start, dur: n.timing.duration }; }} /></>}
                  </div>
                </div>
              </div>
            );
          })}
          {/* Audio & captions */}
          {(p.doc.audio ?? []).map((a) => (
            <div key={a.id} className="flex h-8 border-b border-white/[0.04]">
              <div style={{ width: LABEL }} className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-[#0a0b10] px-1.5"><span className="w-9 text-[9px] font-semibold text-zinc-600">AUDIO</span><span className="flex-1 truncate text-zinc-400">{a.name}</span><button type="button" aria-label={a.muted ? "Unmute" : "Mute"} onClick={() => p.onToggleAudio(a.id)} className="text-zinc-500 hover:text-white">{a.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}</button></div>
              <div className="relative flex-1"><div className={`absolute top-1 h-6 rounded-md bg-teal-500/40 ${a.muted ? "opacity-30" : ""}`} style={{ left: a.start * zoom, width: (a.duration ?? p.total - a.start) * zoom }}>
                <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 10" aria-hidden>{Array.from({ length: 100 }, (_, i) => <rect key={i} x={i} y={5 - (Math.abs(Math.sin(i * 1.7)) * 4 + 0.5)} width={0.6} height={Math.abs(Math.sin(i * 1.7)) * 8 + 1} fill="rgba(255,255,255,0.5)" />)}</svg>
              </div></div>
            </div>
          ))}
          {(p.doc.captions ?? []).map((c) => (
            <div key={c.id} className="flex h-8 border-b border-white/[0.04]">
              <div style={{ width: LABEL }} className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-[#0a0b10] px-1.5"><span className="w-9 text-[9px] font-semibold text-zinc-600">CAPTION</span><span className="truncate text-zinc-400">{c.style}</span></div>
              <div className="relative flex-1">{c.cues.map((q, i) => <div key={i} title={q.text} className="absolute top-1 h-6 truncate rounded-md bg-yellow-500/40 px-1 text-[10px] leading-6 text-white" style={{ left: q.start * p.doc.fps * zoom, width: (q.end - q.start) * p.doc.fps * zoom }}>{q.text}</div>)}</div>
            </div>
          ))}
          {/* Playhead */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-rose-400" style={{ left: LABEL + p.frame * zoom }}><span className="absolute -left-1 top-0 h-2 w-2 rotate-45 bg-rose-400" /></div>
        </div>
      </div>
    </div>
  );
}
