import Link from "next/link";
import { notFound } from "next/navigation";
import type { AssetCategory } from "@/core/types";
import { listAssets } from "@/registry";

const sections: Record<string, { title: string; eyebrow: string; description: string; category?: AssetCategory }> = {
  components: { title: "Composable surfaces", eyebrow: "COMPONENTS", description: "UI, charts, shapes and device-ready visual surfaces are data-first assets. Open the studio to place and edit them.", category: "ui" },
  motion: { title: "Motion with hierarchy", eyebrow: "MOTION", description: "Frame-safe keyframes and preset-driven entrances are evaluated in the core before any renderer is chosen.", category: "motion" },
  typography: { title: "Kinetic typography", eyebrow: "TYPOGRAPHY", description: "Typography assets expose content, motion language and style tokens while preserving readable DOM text.", category: "typography" },
  backgrounds: { title: "Atmosphere, not noise", eyebrow: "BACKGROUNDS", description: "Procedural gradient, grid and orbit fields are original parameterized surfaces with colors, intensity, speed and seed controls.", category: "background" },
  "3d": { title: "3D with a fallback", eyebrow: "THREE DIMENSIONS", description: "The serializable 3D contract is ready for a lazy R3F adapter and falls back gracefully when WebGL is unavailable.", category: "three" },
  effects: { title: "Deliberate finishing", eyebrow: "EFFECTS", description: "Grain, vignette and chromatic treatments are declared assets with performance and video capability metadata.", category: "effect" },
  transitions: { title: "Continuity between scenes", eyebrow: "TRANSITIONS", description: "Transitions are composition-level decisions. The deterministic core keeps a video renderer and browser preview in sync.", category: "transition" },
  video: { title: "Ready for frames", eyebrow: "VIDEO", description: "The current Studio is a real deterministic player. A separately licensed Remotion adapter maps the same data to media output.", category: "template" },
  templates: { title: "Original editable stories", eyebrow: "TEMPLATES", description: "Every template is an inspectable scene graph with scene markers, responsive variants and editable brand and copy properties.", category: "template" },
  editor: { title: "Edit the composition", eyebrow: "EDITOR", description: "Canvas selection, inspector controls, timeline playhead, asset search and JSON persistence already operate on one shared state model." },
  themes: { title: "Tokens reach every scene", eyebrow: "THEMES", description: "Color, typography, motion and quality tokens are a portable layer rather than decoration scattered across component code." },
};

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const detail = sections[section];
  if (!detail) notFound();
  const assets = detail.category ? listAssets(detail.category) : listAssets();
  return (
    <main className="catalogue-page">
      <header className="docs-nav"><Link className="brand" href="/"><span className="brand-sigil"><i /><i /><i /></span><span>PRISM <em>MOTION OS</em></span></Link><div><Link href="/docs">Docs</Link><Link href="/">Open studio</Link></div></header>
      <section className="catalogue-hero"><p>{detail.eyebrow} / SYSTEM CATALOG</p><h1>{detail.title}</h1><p>{detail.description}</p><Link href="/">Open in Prism Studio <span>↗</span></Link></section>
      <section className="catalogue-list"><div className="catalogue-list-title"><span>{assets.length} registry entries</span><span>Typed • schema-driven • capability-marked</span></div>{assets.map((asset: any, index: number) => <article key={asset.id}><div className={`catalogue-art art-${asset.category}`}><b>{String(index + 1).padStart(2, "0")}</b><i>{asset.category === "typography" ? "Aa" : asset.category === "three" ? "◇" : asset.category === "background" ? "◌" : "✦"}</i></div><div><small>{asset.category} / {asset.capabilities?.video ? "frame safe" : "browser"}</small><h2>{asset.name}</h2><p>{asset.description}</p><div>{(asset.tags || []).map((tag: string) => <span key={tag}>{tag}</span>)}</div></div><aside><b>CPU {asset.performance?.cpu || "low"}</b><b>GPU {asset.performance?.gpu || "low"}</b><b>MEM {asset.performance?.memory || "low"}</b></aside></article>)}</section>
    </main>
  );
}
