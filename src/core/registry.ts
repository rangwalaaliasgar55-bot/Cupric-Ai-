/* Universal, machine-readable asset registry with semantic tag search. */
import type { AssetDef, AssetKind, PerfBudget, PropSchema } from "./types";

const assets = new Map<string, AssetDef>();

export function register(def: AssetDef): AssetDef {
  assets.set(def.id, def);
  return def;
}
export const registerComponent = register;
export const registerTemplate = register;
export const registerEffect = register;
export const registerTransition = register;
export const registerBackground = register;
export const registerMaterial = register;
export const register3DPreset = register;

export function getAsset(id: string): AssetDef | undefined {
  return assets.get(id);
}
export function allAssets(): AssetDef[] {
  return [...assets.values()];
}
export function assetsByKind(kind: AssetKind | AssetKind[]): AssetDef[] {
  const ks = Array.isArray(kind) ? kind : [kind];
  return allAssets().filter((a) => ks.includes(a.kind));
}
export function assetsByCategory(cat: string): AssetDef[] {
  return allAssets().filter((a) => a.category === cat);
}
export function getComponentSchema(id: string): PropSchema | undefined {
  return assets.get(id)?.schema;
}

export function defaultsFromSchema(schema: PropSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(schema)) out[k] = f.default;
  return out;
}

/* ---- Semantic search: tokens + synonyms + field weighting ---- */
const SYNONYMS: Record<string, string[]> = {
  premium: ["luxury", "cinematic", "elegant", "high-end"],
  luxury: ["premium", "gold", "elegant", "dark"],
  futuristic: ["tech", "cyber", "neon", "holographic", "sci-fi"],
  ai: ["neural", "tech", "futuristic", "data", "saas"],
  saas: ["product", "dashboard", "startup", "tech", "ui"],
  launch: ["product", "saas", "startup", "reveal"],
  cinematic: ["film", "dramatic", "premium", "movie"],
  liquid: ["fluid", "wave", "blob", "morph"],
  minimal: ["clean", "simple", "subtle"],
  social: ["vertical", "shorts", "reels", "tiktok"],
  youtube: ["intro", "horizontal", "creator"],
  shorts: ["vertical", "social", "reels", "tiktok"],
  text: ["typography", "headline", "kinetic"],
  reveal: ["intro", "entrance", "mask", "logo"],
  product: ["hero", "3d", "saas", "launch"],
  glass: ["transmission", "frosted", "crystal"],
  data: ["chart", "metrics", "analytics", "dashboard"],
  background: ["backdrop", "gradient", "aurora"],
  energy: ["glow", "electric", "neon"],
  space: ["stars", "galaxy", "cosmic"],
};

function tokenize(q: string): string[] {
  return q.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((t) => t.length > 1);
}

export type SearchOptions = { kind?: AssetKind | AssetKind[]; category?: string; limit?: number; maxPerf?: Partial<PerfBudget>; capability?: keyof AssetDef["capabilities"] };

const PERF_RANK = { low: 0, medium: 1, high: 2 } as const;

export function scoreAsset(a: AssetDef, query: string): number {
  const toks = tokenize(query);
  if (!toks.length) return 1;
  const hay = {
    name: a.name.toLowerCase(),
    id: a.id.toLowerCase(),
    tags: a.tags.map((t) => t.toLowerCase()),
    desc: a.description.toLowerCase(),
    cat: a.category.toLowerCase(),
  };
  let score = 0;
  for (const t of toks) {
    const variants = [t, ...(SYNONYMS[t] ?? [])];
    variants.forEach((v, i) => {
      const w = i === 0 ? 1 : 0.4;
      if (hay.tags.includes(v)) score += 4 * w;
      if (hay.name.includes(v)) score += 3 * w;
      if (hay.id.includes(v)) score += 2 * w;
      if (hay.cat.includes(v)) score += 1.5 * w;
      if (hay.desc.includes(v)) score += 1 * w;
    });
  }
  return score;
}

export function searchAssets(query: string, opts: SearchOptions = {}): AssetDef[] {
  let list = allAssets();
  if (opts.kind) {
    const ks = Array.isArray(opts.kind) ? opts.kind : [opts.kind];
    list = list.filter((a) => ks.includes(a.kind));
  }
  if (opts.category) list = list.filter((a) => a.category === opts.category);
  if (opts.capability) list = list.filter((a) => a.capabilities[opts.capability!]);
  if (opts.maxPerf) {
    list = list.filter((a) =>
      (Object.keys(opts.maxPerf!) as (keyof PerfBudget)[]).every((k) => PERF_RANK[a.performance[k]] <= PERF_RANK[opts.maxPerf![k]!]),
    );
  }
  const scored = list.map((a) => ({ a, s: scoreAsset(a, query) })).filter((x) => x.s > 0);
  scored.sort((x, y) => y.s - x.s || x.a.name.localeCompare(y.a.name));
  return scored.slice(0, opts.limit ?? 50).map((x) => x.a);
}
export const searchTemplates = (q: string, limit = 10) => searchAssets(q, { kind: "template", limit });
export const searchMotionPresets = (q: string, limit = 10) => searchAssets(q, { kind: ["motion", "typography"], limit });
export const search3DPresets = (q: string, limit = 10) => searchAssets(q, { kind: ["three", "material", "lighting", "camera"], limit });
export const searchTransitions = (q: string, limit = 10) => searchAssets(q, { kind: "transition", limit });

/** Serializable (no functions) manifest for AI agents / API. */
export function registryManifest(filter?: (a: AssetDef) => boolean) {
  return allAssets()
    .filter((a) => (filter ? filter(a) : true))
    .map(({ id, name, kind, category, description, tags, schema, defaults, capabilities, performance, tier, code }) => ({
      id, name, kind, category, description, tags, schema, defaults, capabilities, performance, tier, code,
    }));
}

export function registryStats() {
  const byKind: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  for (const a of assets.values()) {
    byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    byCat[a.category] = (byCat[a.category] ?? 0) + 1;
  }
  return { total: assets.size, byKind, byCat };
}
