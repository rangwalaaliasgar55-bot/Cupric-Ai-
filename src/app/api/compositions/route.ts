import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { studioCompositions } from "@/db/schema";
import { validateComposition } from "@/core/serialization";

export async function GET() {
  const compositions = await db
    .select({ id: studioCompositions.compositionId, name: studioCompositions.name, updatedAt: studioCompositions.updatedAt })
    .from(studioCompositions)
    .orderBy(desc(studioCompositions.updatedAt))
    .limit(30);
  return NextResponse.json({ compositions });
}

export async function POST(request: Request) {
  let candidate: unknown;
  try {
    candidate = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const validation = validateComposition(candidate);
  if (!validation.success) return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 422 });

  const composition = validation.data;
  await db
    .insert(studioCompositions)
    .values({ compositionId: composition.id, name: composition.name, data: composition })
    .onConflictDoUpdate({
      target: studioCompositions.compositionId,
      set: { name: composition.name, data: composition, updatedAt: sql`now()` },
    });

  return NextResponse.json({ id: composition.id, savedAt: new Date().toISOString() }, { status: 201 });
}
