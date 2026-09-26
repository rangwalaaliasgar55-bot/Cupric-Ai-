/* Server-side AI scene generation (rule-based, offline — no external AI service required). */
import { z } from "zod";
import { generateVideo, selectLibrary } from "@/ai/generate";
import { importDoc } from "@/core/scene-graph";

export const dynamic = "force-dynamic";

const schema = z.object({
  prompt: z.string().max(2000).optional(),
  format: z.enum(["16:9", "9:16", "1:1", "4:5", "4:3"]).optional(),
  duration: z.number().min(2).max(300).optional(),
  style: z.string().max(200).optional(),
  brand: z.object({ name: z.string().max(80).optional(), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), url: z.string().max(200).optional() }).optional(),
  scenes: z.array(z.string().max(40)).max(20).optional(),
  headline: z.string().max(200).optional(),
  subtitle: z.string().max(400).optional(),
  cta: z.string().max(120).optional(),
  captions: z.boolean().optional(),
  task: z.string().max(400).optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request", details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  if (parsed.data.task) return Response.json({ selection: selectLibrary(parsed.data.task) });
  const out = await generateVideo(parsed.data);
  const check = importDoc(out.doc); // guarantee the output is a valid, importable composition
  if (!check.ok) return Response.json({ error: "Generated document failed validation", details: check.errors }, { status: 500 });
  return Response.json(out);
}
