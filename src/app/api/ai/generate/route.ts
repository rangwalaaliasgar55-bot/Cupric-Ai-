import { NextResponse } from 'next/server';
import { COMPLETE_ASSET_CATALOG } from '@/core/registry/asset-catalog';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prompt, format = '16:9', duration = 30 } = body;

    // AI Scene Generation Pipeline
    // Analyzes prompt keywords to dynamically construct an editable Scene Graph AST
    const isMobile = format === '9:16' || prompt?.toLowerCase().includes('mobile');
    const isCyber = prompt?.toLowerCase().includes('cyber') || prompt?.toLowerCase().includes('tech');

    const generatedComposition = {
      id: `ai-comp-${Date.now()}`,
      title: prompt ? `AI Generated: ${prompt.slice(0, 32)}...` : 'AI Generated Promo',
      aspectRatio: isMobile ? '9:16' : '16:9',
      fps: 30,
      durationInFrames: duration * 30,
      theme: {
        primaryColor: isCyber ? '#06b6d4' : '#6366f1',
        secondaryColor: isCyber ? '#ec4899' : '#8b5cf6',
        accentColor: '#10b981',
        backgroundColor: '#05070f',
      },
      scenes: [
        {
          id: 'scene_hook',
          title: '01 // Hook & Proposition',
          startFrame: 0,
          durationFrames: 90,
          background: isCyber ? 'cyber_grid' : 'aurora',
          headline: prompt?.includes('AI') ? 'Autonomous Motion AI' : 'Supercharge Your Vision',
          subheadline: 'Render deterministic 4K motion graphics at the speed of thought.',
          preset: 'liquid_chrome',
        },
        {
          id: 'scene_tech',
          title: '02 // 3D Architecture',
          startFrame: 90,
          durationFrames: 90,
          background: 'matrix_rain',
          threeObject: 'torus_knot',
          metric1: { label: 'Inference Throughput', value: 450, suffix: ' fps' },
          metric2: { label: 'GPU Memory Footprint', value: 3.2, suffix: ' GB' },
        },
        {
          id: 'scene_cta',
          title: '03 // Call to Action',
          startFrame: 180,
          durationFrames: 90,
          headline: 'Start Building Today',
          buttonText: 'Deploy Instant Preview',
        },
      ],
      recommendedAssets: COMPLETE_ASSET_CATALOG.filter((item) =>
        prompt ? prompt.toLowerCase().split(' ').some((word: string) => item.tags.includes(word)) : true
      ).slice(0, 6),
    };

    return NextResponse.json({
      success: true,
      composition: generatedComposition,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Generation failed' },
      { status: 500 }
    );
  }
}
