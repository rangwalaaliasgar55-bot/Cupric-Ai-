import { NextResponse } from 'next/server';
import { COMPLETE_ASSET_CATALOG } from '@/core/registry/asset-catalog';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const search = searchParams.get('search')?.toLowerCase();

  let results = COMPLETE_ASSET_CATALOG;

  if (category && category !== 'all') {
    results = results.filter((item) => item.category === category);
  }

  if (search) {
    results = results.filter(
      (item) =>
        item.title.toLowerCase().includes(search) ||
        item.description.toLowerCase().includes(search) ||
        item.tags.some((t) => t.toLowerCase().includes(search))
    );
  }

  return NextResponse.json({
    total: results.length,
    assets: results,
  });
}
