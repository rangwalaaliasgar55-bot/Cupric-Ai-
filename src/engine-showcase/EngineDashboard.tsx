import Link from "next/link";
import HomeHero from "@/components/HomeHero";
import { catalogCounts } from "@/registry";

export const dynamic = "force-static";

const LAYERS = [
  ["Scene graph", "Serializable VideoDoc → Scene → Node JSON. Addressable paths such as scene.get(\"hero.headline\"), Zod-validated import, URL sanitization."],
  ["Motion engine", "Deterministic timeline with tweens, springs, keyframes, stagger, labels, markers, repeat and yoyo. The animation engine behind it can be swapped (native or Motion)."],
  ["Typography", "Char, word and line splitting with 60+ kinetic presets: scramble, typewriter, chrome, holographic, liquid, extrusion."],
  ["2D graphics", "About 45 procedural backgrounds, 22 WebGL shaders, a point-based shape engine with universal morphing, and closed-form particles."],
  ["3D", "Three.js PBR materials, light rigs, camera moves, instancing, GLTF, plus Rapier physics cached per frame so it can be scrubbed."],
  ["Effects", "A post stack (bloom, depth of field, chromatic aberration, grain, grade, lens flares) and 50+ scene transitions."],
  ["Video", "A single compositor drives preview, editor and export. MP4/WebM export via WebCodecs (Mediabunny) with mixed audio. SRT/VTT captions."],
  ["AI registry", "Every asset has a schema, tags, capabilities and a performance budget. Semantic search, recommendations and generateVideo()."],
];

export default function Home() {
  const c = catalogCounts();
  const stats: [string, number][] = [["Motion presets", c.byKind.motion ?? 0], ["Typography", c.byKind.typography ?? 0], ["Backgrounds & shaders", (c.byKind.background ?? 0) + (c.byKind.shader ?? 0)], ["Transitions", c.byKind.transition ?? 0], ["Effects", c.byKind.effect ?? 0], ["3D presets", (c.byKind.three ?? 0) + (c.byKind.material ?? 0) + (c.byKind.lighting ?? 0) + (c.byKind.camera ?? 0)], ["Particles", c.byKind.particles ?? 0], ["UI & devices", (c.byKind.ui ?? 0) + (c.byKind.device ?? 0)], ["Charts", c.byKind.chart ?? 0], ["Logo animations", c.byKind.logo ?? 0], ["Templates", c.byKind.template ?? 0], ["Total assets", c.total]];
  return (
    <>
      <HomeHero />
      <section aria-labelledby="catalog" className="mx-auto max-w-7xl px-6 py-12">
        <h2 id="catalog" className="sr-only">Catalog</h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([l, n]) => <div key={l} className="bg-[#07080c] p-5"><dt className="text-xs text-zinc-500">{l}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-white">{n}</dd></div>)}
        </dl>
      </section>
      <section className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="text-2xl font-semibold tracking-tight text-white">Architecture, layer by layer</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {LAYERS.map(([t, d]) => <article key={t} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"><h3 className="text-sm font-medium text-white">{t}</h3><p className="mt-2 text-xs leading-relaxed text-zinc-400">{d}</p></article>)}
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/editor" className="rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-zinc-200">Open the editor</Link>
          <Link href="/templates" className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/10">Template playground</Link>
          <Link href="/docs" className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/10">Read the docs</Link>
        </div>
      </section>
    </>
  );
}
