import { db } from "@/db";
import { projects } from "@/db/schema";
import { desc } from "drizzle-orm";
import { importDoc, docDuration, uid } from "@/core/scene-graph";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select({ id: projects.id, name: projects.name, width: projects.width, height: projects.height, durationFrames: projects.durationFrames, templateId: projects.templateId, updatedAt: projects.updatedAt }).from(projects).orderBy(desc(projects.updatedAt)).limit(100);
  return Response.json({ projects: rows });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const res = importDoc(body?.doc ?? body);
  if (!res.ok) return Response.json({ error: "Invalid composition", details: res.errors }, { status: 400 });
  const doc = res.doc;
  const id = uid("prj");
  await db.insert(projects).values({ id, name: String(body?.name ?? doc.name).slice(0, 200), doc, width: doc.width, height: doc.height, durationFrames: docDuration(doc), templateId: (doc.meta?.templateId as string) ?? null });
  return Response.json({ id }, { status: 201 });
}
