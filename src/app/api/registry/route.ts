/* Machine-readable asset registry for AI agents: search, filter, schemas. */
import { searchAssets, registryManifest, getAsset } from "@/core/registry";
import type { AssetKind, PerfBudget } from "@/core/types";
import { catalogCounts } from "@/registry";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  if (id) {
    const a = getAsset(id);
    if (!a) return Response.json({ error: "Not found" }, { status: 404 });
    const { preview, node, ...rest } = a;
    void preview; void node;
    return Response.json({ asset: rest });
  }
  const q = sp.get("q") ?? "";
  const kind = sp.get("kind")?.split(",") as AssetKind[] | undefined;
  const category = sp.get("category") ?? undefined;
  const limit = Math.min(500, Number(sp.get("limit") ?? 50));
  const maxGpu = sp.get("maxGpu") as PerfBudget["gpu"] | null;
  if (!q && !kind && !category) return Response.json({ counts: catalogCounts(), assets: registryManifest().slice(0, limit) });
  const hits = searchAssets(q, { kind, category, limit, ...(maxGpu ? { maxPerf: { gpu: maxGpu } } : {}) });
  const ids = new Set(hits.map((h) => h.id));
  return Response.json({ query: q, assets: registryManifest((a) => ids.has(a.id)).sort((a, b) => hits.findIndex((h) => h.id === a.id) - hits.findIndex((h) => h.id === b.id)) });
}
