"use client";
import { Diamond, Save, Trash2, Plus, X } from "lucide-react";
import type { EffectConfig, KeyframeTrack, Scene, SceneNode, VideoDoc } from "@/core/types";
import { NODE_SCHEMAS, ANIMATION_SCHEMA } from "@/registry";
import { EFFECTS } from "@/effects/post";
import { TRANSITIONS } from "@/effects/transitions";
import SchemaForm from "../SchemaForm";
import { uid } from "@/core/scene-graph";

const inp = "w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-400";
const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 first:mt-0">{children}</h3>;
function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return <label className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="w-12 shrink-0">{label}</span><input type="number" step={step} value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0} onChange={(e) => onChange(Number(e.target.value))} className={inp} /></label>;
}

export type InspectorProps = {
  doc: VideoDoc; node: SceneNode | null; scene: Scene | null; sceneFrame: number; isFirstScene: boolean;
  onNode: (fn: (n: SceneNode) => SceneNode, key?: string) => void; onScene: (fn: (s: Scene) => Scene, key?: string) => void; onDoc: (fn: (d: VideoDoc) => VideoDoc, key?: string) => void;
  onDelete: () => void; onSavePreset: (n: SceneNode) => void;
};

function EffectStack({ effects, onChange }: { effects: EffectConfig[]; onChange: (e: EffectConfig[]) => void }) {
  return (
    <div className="space-y-2">
      {effects.map((fx, i) => { const def = EFFECTS[fx.type]; if (!def) return null; return (
        <div key={fx.id ?? i} className="rounded-lg border border-white/[0.06] p-2">
          <div className="mb-2 flex items-center justify-between"><label className="flex items-center gap-2 text-xs text-zinc-200"><input type="checkbox" checked={fx.enabled !== false} onChange={(e) => onChange(effects.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} className="accent-indigo-400" />{def.name}</label><button type="button" aria-label={`Remove ${def.name}`} onClick={() => onChange(effects.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-white"><X size={12} /></button></div>
          <SchemaForm groups={false} schema={Object.fromEntries(Object.entries(def.defaults).map(([k, v]) => [k, typeof v === "number" ? { type: "number" as const, default: v, min: 0, max: Math.max(1, v * 4), step: v < 2 ? 0.01 : 1 } : { type: "color" as const, default: String(v) }]))} values={{ ...def.defaults, ...(fx.params ?? {}) }} onChange={(k, v) => onChange(effects.map((x, j) => (j === i ? { ...x, params: { ...(x.params ?? {}), [k]: v } } : x)))} />
        </div>); })}
      <select aria-label="Add effect" value="" onChange={(e) => e.target.value && onChange([...effects, { id: uid("fx"), type: e.target.value }])} className={inp}><option value="">+ Add effect…</option>{Object.values(EFFECTS).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.group})</option>)}</select>
    </div>
  );
}

function AnimRow({ title, value, options, onChange, loop }: { title: string; value?: SceneNode["enter"]; options: string[]; onChange: (v: SceneNode["enter"] | undefined) => void; loop?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="w-12 shrink-0">{title}</span><select value={value?.preset ?? ""} onChange={(e) => onChange(e.target.value ? { ...(value ?? {}), preset: e.target.value } : undefined)} className={inp}><option value="">None</option>{options.map((o) => <option key={o}>{o}</option>)}</select></label>
      {value && <div className="grid grid-cols-2 gap-1.5 pl-[54px]">
        {loop ? <Num label="Speed" step={0.1} value={value.speed ?? 1} onChange={(v) => onChange({ ...value, speed: v })} /> : <Num label="Dur" value={value.duration ?? 20} onChange={(v) => onChange({ ...value, duration: v })} />}
        <Num label="Delay" value={value.delay ?? 0} onChange={(v) => onChange({ ...value, delay: v })} />
        <Num label="Amount" step={0.1} value={value.intensity ?? 1} onChange={(v) => onChange({ ...value, intensity: v })} />
        {!loop && <select aria-label={`${title} easing`} value={value.ease ?? ""} onChange={(e) => onChange({ ...value, ease: e.target.value || undefined })} className={inp}><option value="">Preset ease</option>{ANIMATION_SCHEMA.easings.map((x) => <option key={x}>{x}</option>)}{["bouncy", "snappy", "gentle"].map((s) => <option key={s} value={`spring:${s}`}>spring · {s}</option>)}</select>}
      </div>}
    </div>
  );
}

export default function Inspector(p: InspectorProps) {
  const { node, scene, doc } = p;
  if (node) {
    const schema = NODE_SCHEMAS[node.type] ?? {};
    const tr = node.transform;
    const setT = (k: keyof SceneNode["transform"], v: number) => p.onNode((n) => ({ ...n, transform: { ...n.transform, [k]: v } }), `t-${k}`);
    const local = p.sceneFrame - node.timing.start;
    const addKey = (prop: KeyframeTrack["property"]) => p.onNode((n) => {
      const cur = (n.transform as unknown as Record<string, number>)[prop] ?? (prop === "scale" || prop === "opacity" ? 1 : 0);
      const tracks = [...(n.keyframes ?? [])];
      const i = tracks.findIndex((t) => t.property === prop);
      const kf = { frame: Math.max(0, Math.round(local)), value: cur, ease: "easeInOutCubic" };
      if (i < 0) tracks.push({ property: prop, keyframes: [kf] });
      else tracks[i] = { ...tracks[i], keyframes: [...tracks[i].keyframes.filter((k) => k.frame !== kf.frame), kf].sort((a, b) => a.frame - b.frame) };
      return { ...n, keyframes: tracks };
    });
    const setEase = (v: SceneNode["enter"]) => { if (v?.ease?.startsWith("spring:")) return { ...v, ease: undefined, spring: v.ease.slice(7) }; return v; };
    const fx = (type: string) => node.effects?.find((e) => e.type === type);
    const toggleFx = (type: string, on: boolean, params: Record<string, unknown> = {}) => p.onNode((n) => ({ ...n, effects: on ? [...(n.effects ?? []).filter((e) => e.type !== type), { type, params }] : (n.effects ?? []).filter((e) => e.type !== type) }));
    return (
      <div className="p-3">
        <div className="mb-3 flex items-center gap-2"><input aria-label="Layer name" value={node.name ?? ""} onChange={(e) => p.onNode((n) => ({ ...n, name: e.target.value }), "name")} className={`${inp} text-sm`} /><span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">{node.type}</span></div>
        <H>Transform</H>
        <div className="grid grid-cols-2 gap-1.5">
          <Num label="X" value={tr.x ?? 0} onChange={(v) => setT("x", v)} /><Num label="Y" value={tr.y ?? 0} onChange={(v) => setT("y", v)} />
          <Num label="Scale" step={0.01} value={tr.scale ?? 1} onChange={(v) => setT("scale", v)} /><Num label="Rotate" value={tr.rotate ?? 0} onChange={(v) => setT("rotate", v)} />
          <Num label="Rot X" value={tr.rotateX ?? 0} onChange={(v) => setT("rotateX", v)} /><Num label="Rot Y" value={tr.rotateY ?? 0} onChange={(v) => setT("rotateY", v)} />
          <Num label="Opacity" step={0.01} value={tr.opacity ?? 1} onChange={(v) => setT("opacity", v)} /><Num label="Blur" value={tr.blur ?? 0} onChange={(v) => setT("blur", v)} />
        </div>
        <H>Timing (frames)</H>
        <div className="grid grid-cols-2 gap-1.5"><Num label="Start" value={node.timing.start} onChange={(v) => p.onNode((n) => ({ ...n, timing: { ...n.timing, start: Math.max(0, v) } }), "ts")} /><Num label="Length" value={node.timing.duration} onChange={(v) => p.onNode((n) => ({ ...n, timing: { ...n.timing, duration: Math.max(1, v) } }), "td")} /></div>
        <H>Animation</H>
        <div className="space-y-2">
          <AnimRow title="Enter" value={node.enter} options={ANIMATION_SCHEMA.entrances} onChange={(v) => p.onNode((n) => ({ ...n, enter: setEase(v) }), "enter")} />
          <AnimRow title="Exit" value={node.exit} options={ANIMATION_SCHEMA.entrances} onChange={(v) => p.onNode((n) => ({ ...n, exit: setEase(v) }), "exit")} />
          <AnimRow title="Loop" value={node.loop} options={ANIMATION_SCHEMA.loops} loop onChange={(v) => p.onNode((n) => ({ ...n, loop: v }), "loop")} />
        </div>
        <H>Keyframes</H>
        <div className="flex flex-wrap gap-1">{(["x", "y", "scale", "rotate", "opacity", "blur"] as const).map((k) => <button type="button" key={k} onClick={() => addKey(k)} className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10"><Diamond size={10} />{k}</button>)}</div>
        <p className="mt-1 text-[10px] text-zinc-600">Adds a keyframe at the playhead using the current transform value. Move the playhead, change the value, then add another keyframe.</p>
        {node.keyframes?.map((t) => <div key={t.property} className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-zinc-400"><span className="w-12">{t.property}</span>{t.keyframes.map((k) => <button type="button" key={k.frame} title="Remove keyframe" onClick={() => p.onNode((n) => ({ ...n, keyframes: (n.keyframes ?? []).map((x) => (x.property === t.property ? { ...x, keyframes: x.keyframes.filter((y) => y.frame !== k.frame) } : x)).filter((x) => x.keyframes.length) }))} className="rounded bg-white/5 px-1.5 py-0.5 hover:bg-rose-500/30">@{k.frame}={(typeof k.value === "number" ? Math.round(k.value * 100) / 100 : k.value)}</button>)}</div>)}
        <H>Layer effects</H>
        <div className="space-y-1.5 text-xs text-zinc-300">
          {[["glow", { radius: 40 }], ["shadow", { radius: 40, y: 20 }], ["reflection", {}]].map(([t, prm]) => <label key={t as string} className="flex items-center gap-2 capitalize"><input type="checkbox" className="accent-indigo-400" checked={!!fx(t as string)} onChange={(e) => toggleFx(t as string, e.target.checked, prm as Record<string, unknown>)} />{t as string}{fx(t as string) && t !== "reflection" && <input aria-label={`${t} radius`} type="range" min={0} max={120} value={Number(fx(t as string)?.params?.radius ?? 40)} onChange={(e) => toggleFx(t as string, true, { ...(fx(t as string)?.params ?? {}), radius: Number(e.target.value) })} className="ml-auto w-24 accent-indigo-400" />}</label>)}
        </div>
        {node.type !== "background" && node.type !== "particles" && node.type !== "shader" && <>
          <H>Audio reactive</H>
          <div className="grid grid-cols-2 gap-1.5">
            <select aria-label="Audio band" value={String(node.props.audioReactive ?? "none")} onChange={(e) => p.onNode((n) => ({ ...n, props: { ...n.props, audioReactive: e.target.value } }))} className={inp}>{["none", "amplitude", "bass", "mid", "treble", "beat"].map((o) => <option key={o}>{o}</option>)}</select>
            <select aria-label="Audio target" value={String(node.props.audioTarget ?? "scale")} onChange={(e) => p.onNode((n) => ({ ...n, props: { ...n.props, audioTarget: e.target.value } }))} className={inp}>{["scale", "rotation", "opacity", "position", "glow", "distortion"].map((o) => <option key={o}>{o}</option>)}</select>
          </div>
        </>}
        <H>Properties</H>
        <SchemaForm schema={schema} values={node.props} onChange={(k, v) => p.onNode((n) => ({ ...n, props: { ...n.props, [k]: v } }), `p-${k}`)} />
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => p.onSavePreset(node)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-xs text-zinc-200 hover:bg-white/10"><Save size={12} />Save as preset</button>
          <button type="button" onClick={p.onDelete} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-500/15 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/25"><Trash2 size={12} />Delete</button>
        </div>
      </div>
    );
  }
  return (
    <div className="p-3">
      {scene && <>
        <H>Scene</H>
        <div className="space-y-1.5">
          <input aria-label="Scene name" value={scene.name} onChange={(e) => p.onScene((s) => ({ ...s, name: e.target.value }), "sn")} className={inp} />
          <Num label="Frames" value={scene.durationInFrames} onChange={(v) => p.onScene((s) => ({ ...s, durationInFrames: Math.max(10, Math.round(v)) }), "sd")} />
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="w-12 shrink-0">Story</span><select value={scene.type} onChange={(e) => p.onScene((s) => ({ ...s, type: e.target.value as Scene["type"] }))} className={inp}>{["hook", "title", "problem", "statement", "product", "feature", "demo", "comparison", "statistic", "testimonial", "process", "result", "cta", "outro", "logo", "custom"].map((t) => <option key={t}>{t}</option>)}</select></label>
        </div>
        {!p.isFirstScene && <>
          <H>Transition in</H>
          <div className="grid grid-cols-[1fr_80px] gap-1.5">
            <select aria-label="Transition" value={scene.transition?.type ?? ""} onChange={(e) => p.onScene((s) => ({ ...s, transition: e.target.value ? { type: e.target.value, duration: s.transition?.duration ?? TRANSITIONS[e.target.value].duration } : undefined }))} className={inp}><option value="">Cut</option>{Object.values(TRANSITIONS).map((t) => <option key={t.id} value={t.id}>{t.name} · {t.group}</option>)}</select>
            <input aria-label="Transition frames" type="number" value={scene.transition?.duration ?? 0} onChange={(e) => p.onScene((s) => ({ ...s, transition: { type: s.transition?.type ?? "crossfade", duration: Math.max(0, Number(e.target.value)) } }), "trd")} className={inp} />
          </div>
        </>}
        <H>Scene effects</H>
        <EffectStack effects={scene.effects ?? []} onChange={(e) => p.onScene((s) => ({ ...s, effects: e }))} />
      </>}
      <H>Global effects (whole video)</H>
      <EffectStack effects={doc.effects ?? []} onChange={(e) => p.onDoc((d) => ({ ...d, effects: e }))} />
      <H>Document</H>
      <div className="grid grid-cols-2 gap-1.5">
        <Num label="FPS" value={doc.fps} onChange={(v) => p.onDoc((d) => ({ ...d, fps: Math.max(1, Math.min(120, Math.round(v))) }), "fps")} />
        <Num label="Seed" value={doc.seed ?? 7} onChange={(v) => p.onDoc((d) => ({ ...d, seed: Math.round(v) }), "seed")} />
      </div>
      <p className="mt-4 flex items-center gap-1 text-[10px] text-zinc-600"><Plus size={10} />Select a layer on the canvas or timeline to edit it.</p>
    </div>
  );
}
