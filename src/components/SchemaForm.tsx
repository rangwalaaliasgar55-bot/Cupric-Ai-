"use client";
/* Schema-driven inspector: any registered component's PropSchema → automatic, accessible controls. */
import { useId } from "react";
import { Plus, X } from "lucide-react";
import type { PropField, PropSchema } from "@/core/types";

type Props = { schema: PropSchema; values: Record<string, unknown>; onChange: (key: string, value: unknown) => void; groups?: boolean; compact?: boolean };

const label = (k: string, f: PropField) => f.label ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
const inputCls = "w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-400";

function Field({ k, f, v, onChange }: { k: string; f: PropField; v: unknown; onChange: (v: unknown) => void }) {
  const id = useId();
  const val = v ?? f.default;
  switch (f.type) {
    case "number": return (
      <div className="grid grid-cols-[1fr_64px] items-center gap-2">
        <input id={id} aria-label={label(k, f)} type="range" min={f.min ?? 0} max={f.max ?? 100} step={f.step ?? 1} value={Number(val)} onChange={(e) => onChange(Number(e.target.value))} className="accent-indigo-400" />
        <input aria-label={`${label(k, f)} value`} type="number" step={f.step ?? 1} value={Number(val)} onChange={(e) => onChange(Number(e.target.value))} className={inputCls} />
      </div>);
    case "color": return <div className="flex items-center gap-2"><input id={id} aria-label={label(k, f)} type="color" value={/^#[0-9a-f]{6}$/i.test(String(val)) ? String(val) : "#ffffff"} onChange={(e) => onChange(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent" /><input aria-label={`${label(k, f)} hex`} value={String(val)} onChange={(e) => onChange(e.target.value)} className={inputCls} /></div>;
    case "colors": { const arr = (Array.isArray(val) ? val : f.default) as string[]; return (
      <div className="flex flex-wrap items-center gap-1.5">
        {arr.map((c, i) => (
          <span key={i} className="group relative">
            <input aria-label={`${label(k, f)} ${i + 1}`} type="color" value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#ffffff"} onChange={(e) => { const n = [...arr]; n[i] = e.target.value; onChange(n); }} className="h-7 w-8 cursor-pointer rounded border border-white/10 bg-transparent" />
            {arr.length > 1 && <button type="button" aria-label="Remove color" onClick={() => onChange(arr.filter((_, j) => j !== i))} className="absolute -right-1 -top-1 hidden h-4 w-4 place-items-center rounded-full bg-zinc-700 text-white group-hover:grid"><X size={10} /></button>}
          </span>))}
        {arr.length < 6 && <button type="button" aria-label="Add color" onClick={() => onChange([...arr, arr[arr.length - 1] ?? "#ffffff"])} className="grid h-7 w-7 place-items-center rounded border border-dashed border-white/20 text-zinc-400 hover:text-white"><Plus size={12} /></button>}
      </div>); }
    case "select": return <select id={id} aria-label={label(k, f)} value={String(val)} onChange={(e) => onChange(e.target.value)} className={inputCls}>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
    case "boolean": return <label className="flex items-center gap-2 text-xs text-zinc-300"><input id={id} type="checkbox" checked={Boolean(val)} onChange={(e) => onChange(e.target.checked)} className="accent-indigo-400" />{Boolean(val) ? "On" : "Off"}</label>;
    case "text": return f.multiline ? <textarea id={id} aria-label={label(k, f)} rows={2} value={String(val)} onChange={(e) => onChange(e.target.value)} className={inputCls} /> : <input id={id} aria-label={label(k, f)} value={String(val)} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
    case "url": return <input id={id} aria-label={label(k, f)} type="url" placeholder="https://… or /image.png" value={String(val)} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
    case "list": return <input id={id} aria-label={label(k, f)} value={((val as string[]) ?? []).join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} className={inputCls} placeholder="comma, separated" />;
    case "data": return <input id={id} aria-label={label(k, f)} value={((val as number[]) ?? []).join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)))} className={inputCls} placeholder="12, 19, 14" />;
  }
}

export default function SchemaForm({ schema, values, onChange, groups = true }: Props) {
  const entries = Object.entries(schema);
  const byGroup = new Map<string, [string, PropField][]>();
  for (const e of entries) { const g = groups ? e[1].group ?? "Properties" : "Properties"; byGroup.set(g, [...(byGroup.get(g) ?? []), e]); }
  if (!entries.length) return <p className="text-xs text-zinc-500">This asset has no editable properties.</p>;
  return (
    <div className="space-y-4">
      {[...byGroup].map(([g, fields]) => (
        <fieldset key={g} className="space-y-2">
          {groups && <legend className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{g}</legend>}
          {fields.map(([k, f]) => (
            <div key={k} className="grid grid-cols-[92px_1fr] items-center gap-2">
              <span className="truncate text-[11px] text-zinc-400" title={k}>{label(k, f)}</span>
              <Field k={k} f={f} v={values[k]} onChange={(v) => onChange(k, v)} />
            </div>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
