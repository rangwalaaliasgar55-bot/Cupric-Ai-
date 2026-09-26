import { db } from "@/db";
import { presets } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { uid } from "@/core/scene-graph";

export const dynamic = "force-dynamic";

const body = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["node", "animation", "effects", "theme"]),
  nodeType: z.string().max(40).optional(),
  data: z.record(z.string(), z.unknown()),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind");
  const q = db.select().from(presets);
  const rows = await (kind ? q.where(eq(presets.kind, kind)) : q).orderBy(desc(presets.createdAt)).limit(200);
  return Response.json({ presets: rows });
}

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid preset", details: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  if (JSON.stringify(parsed.data.data).length > 200_000) return Response.json({ error: "Preset too large" }, { status: 413 });
  const id = uid("pre");
  await db.insert(presets).values({ id, name: parsed.data.name, kind: parsed.data.kind, nodeType: parsed.data.nodeType ?? null, data: parsed.data.data, tags: parsed.data.tags ?? [] });
  return Response.json({ id }, { status: 201 });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await db.delete(presets).where(eq(presets.id, id));
  return Response.json({ ok: true });
}
