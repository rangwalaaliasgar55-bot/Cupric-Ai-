import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { importDoc, docDuration } from "@/core/scene-graph";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ project: row });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const res = importDoc(body?.doc ?? body);
  if (!res.ok) return Response.json({ error: "Invalid composition", details: res.errors }, { status: 400 });
  const doc = res.doc;
  const updated = await db.update(projects).set({ name: String(body?.name ?? doc.name).slice(0, 200), doc, width: doc.width, height: doc.height, durationFrames: docDuration(doc), updatedAt: new Date() }).where(eq(projects.id, id)).returning({ id: projects.id });
  if (!updated.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ id });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await db.delete(projects).where(eq(projects.id, id));
  return Response.json({ ok: true });
}
