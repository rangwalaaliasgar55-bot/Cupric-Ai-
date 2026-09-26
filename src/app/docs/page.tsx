import { allAssets, catalogCounts } from "@/registry";

export const dynamic = "force-static";

const API = `// 1. Build from a template (pure, serializable)
import { buildTemplate } from "@/video/templates";
const doc = buildTemplate("aiLaunch", { brand: { name: "Acme", primary: "#22d3ee" }, aspect: "9:16", duration: 20 });

// 2. Or let the AI layer choose everything (offline, rule-based)
import { generateVideo } from "@/ai/generate";
const { doc: video, recommendation } = await generateVideo({
  prompt: "25-second premium futuristic AI SaaS advertisement",
  brand: { name: "Cupric AI", primaryColor: "#7c8cff" },
  structure: ["hook", "problem", "ai visualization", "product ui", "features", "stats", "cta"],
});

// 3. Address & edit any node
import { SceneGraph, updateNode } from "@/core/scene-graph";
const g = new SceneGraph(video);
g.get("hook.headline");          // → SceneNode
g.paths();                       // every addressable path

// 4. Render — the same renderFrame() drives preview, editor and export
import { renderVideo, download } from "@/video/export";
const { blob } = await renderVideo({ doc: video, format: "mp4", width: 1920, height: 1080, fps: 30 });
download(blob, "launch.mp4");

// 5. Engine-agnostic animation for DOM/UI
import { animate } from "@/core/animation";
animate({ target: el, property: "opacity", from: 0, to: 1, duration: 0.6, easing: "emphasized", engine: "motion" });

// 6. Deterministic timeline
import { timeline } from "@/core/timeline";
const tl = timeline({ repeat: 1, repeatType: "reverse" })
  .to(state, "x", { to: 200, duration: 0.8, ease: "easeOutBack" })
  .addLabel("reveal")
  .stagger(items, "opacity", { from: 0, to: 1, duration: 0.4, each: 0.05 }, "reveal")
  .call(() => console.log("done"));
tl.seek(1.2); // pure: same state every time`;

const AGENT = `GET  /api/registry?q=premium+AI+background&kind=background,shader
GET  /api/registry?id=typography:scramble          → full schema
POST /api/generate { "prompt": "20 second premium AI SaaS launch" }
POST /api/generate { "task": "make this text cinematic" }  → library selection
GET|POST /api/projects         GET|PUT|DELETE /api/projects/:id
GET|POST|DELETE /api/presets`;

export default function Docs() {
  const c = catalogCounts();
  const assets = allAssets();
  const kinds = [...new Set(assets.map((a) => a.kind))].sort();
  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-4xl font-semibold tracking-tight text-white">Documentation</h1>
      <p className="mt-3 text-zinc-400">This page is generated from the live registry: {c.total} assets. Each entry below lists its props, capabilities and performance budget. The design documents (RESEARCH.md, TECHNOLOGY_DECISIONS.md, ARCHITECTURE.md, MOTION_SPEC.md, VIDEO_SPEC.md, TEMPLATE_SPEC.md, 3D_SPEC.md, ASSET_CATALOG.md) are in the repository root.</p>
      <h2 className="mt-10 text-xl font-semibold text-white">Developer API</h2>
      <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-4 text-[12px] leading-relaxed text-zinc-300">{API}</pre>
      <h2 className="mt-10 text-xl font-semibold text-white">AI agent endpoints</h2>
      <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-4 text-[12px] leading-relaxed text-emerald-300">{AGENT}</pre>
      <h2 className="mt-10 text-xl font-semibold text-white">Rendering & compatibility</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-zinc-400">
        <li>Every render-safe asset is deterministic from (frame, fps, props, seed). No wall-clock time, and no unseeded randomness.</li>
        <li>MP4 (H.264 + AAC) and WebM (VP9 + Opus, optional alpha) are encoded in the browser with WebCodecs via Mediabunny. This works in Chromium browsers and Safari 17+. Where WebCodecs is missing, export shows a clear error instead of failing silently.</li>
        <li>3D and shader assets need WebGL. Without it they draw a deterministic 2D fallback.</li>
        <li>Quality levels (auto/low/medium/high/ultra) scale particle counts, shader resolution, 3D geometry detail and heavy post effects.</li>
        <li><code>prefers-reduced-motion</code> reduces presets to opacity-only fades.</li>
        <li>Server-side video rendering is not bundled; it would need headless Chromium. The frame-based scene graph maps directly onto a Remotion <code>&lt;Composition&gt;</code> if you have a Remotion license.</li>
      </ul>
      <h2 className="mt-10 text-xl font-semibold text-white">Asset reference</h2>
      <div className="mt-4 space-y-3">
        {kinds.map((k) => {
          const list = assets.filter((a) => a.kind === k);
          return (
            <details key={k} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <summary className="cursor-pointer text-sm font-medium capitalize text-white">{k} <span className="text-zinc-500">({list.length})</span></summary>
              <ul className="mt-3 divide-y divide-white/[0.05]">
                {list.map((a) => (
                  <li key={a.id} className="py-2.5 text-xs">
                    <div className="flex flex-wrap items-baseline gap-2"><code className="text-indigo-300">{a.id}</code><span className="text-zinc-200">{a.name}</span><span className="text-zinc-500">— {a.description}</span></div>
                    <div className="mt-1 text-zinc-500">props: {Object.keys(a.schema).join(", ") || "—"} · perf cpu/gpu/mem: {a.performance.cpu}/{a.performance.gpu}/{a.performance.memory} · {Object.entries(a.capabilities).filter(([, v]) => v).map(([x]) => x).join(", ")}</div>
                    {a.code && <pre className="mt-1 overflow-x-auto text-[11px] text-emerald-300/80">{a.code}</pre>}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </div>
  );
}
