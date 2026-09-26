import { notFound } from "next/navigation";
import AssetGallery from "@/components/AssetGallery";

const PAGES: Record<string, { title: string; intro: string; categories: string[] }> = {
  components: { title: "UI motion components", intro: "Animated SaaS interface components, device mockups and frame-safe charts. Each one renders the same in a web preview, the editor and exported video, and every prop can be edited through its schema.", categories: ["components", "charts"] },
  motion: { title: "Motion presets & shapes", intro: "Configurable entrance, exit and loop presets built on the deterministic timeline, plus a shape engine where any shape can morph into any other and paths can be drawn on.", categories: ["motion"] },
  typography: { title: "Kinetic typography & logos", intro: "Split text by character, word or line with staggered presets and special effects (scramble, typewriter, chrome, holographic, liquid, extrusion), plus 30 replaceable logo animations.", categories: ["typography", "logos"] },
  backgrounds: { title: "Backgrounds, shaders & particles", intro: "Procedural Canvas2D backgrounds, WebGL shader presets and closed-form particle systems. They share one parameter contract: colors, speed, density, scale, noise, intensity, opacity, direction, blur and seed.", categories: ["backgrounds", "particles"] },
  "3d": { title: "3D engine", intro: "Three.js PBR materials, light rigs, camera moves, parametric objects, instanced layouts and deterministic Rapier physics, all composited into the video canvas.", categories: ["3d"] },
  effects: { title: "Post-processing effects", intro: "A stackable post-processing pipeline (bloom, depth of field, chromatic aberration, grain, vignette, grading, lens flares, glitch) whose output is deterministic for video.", categories: ["effects"] },
  transitions: { title: "Transition engine", intro: "Scene transitions grouped as basic, motion, mask, 3D, digital, organic and light. Each composites the outgoing and incoming scenes with its own easing.", categories: ["transitions"] },
  video: { title: "Video building blocks", intro: "Story scene types (hook, problem, product, statistic, testimonial, CTA and more) and animated caption styles. Captions can be imported from SRT, VTT or JSON.", categories: ["video"] },
  themes: { title: "Themes & design tokens", intro: "Global design-token themes. Every template inherits its colors, gradients, typography, radii, shadows and motion defaults, so switching the theme restyles the whole composition.", categories: ["themes"] },
};

export function generateStaticParams() { return Object.keys(PAGES).map((category) => ({ category })); }
export const dynamicParams = false;

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const page = PAGES[category];
  if (!page) notFound();
  return <AssetGallery categories={page.categories} title={page.title} intro={page.intro} />;
}
