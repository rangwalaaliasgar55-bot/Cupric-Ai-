import type { Project, SceneRundown } from '../types/project'
import { nowIso, uid } from './utils'

/** Seed projects so the first launch feels alive. Persisted to localStorage afterwards. */
export function makeSeedProjects(): Project[] {
  const mins = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

  const auroraRundown: SceneRundown = {
    title: 'Aurora — 12s Launch Bumper',
    durationSec: 12,
    fps: 30,
    size: [1920, 1080],
    style: 'Kinetic type on near-black, lime accent, generous tracking, tabular numerals',
    scenes: [
      { id: uid(), from: 0, to: 3, type: 'logo', copy: 'AURORA', motion: 'spring scale-in with overshoot' },
      { id: uid(), from: 3, to: 7.5, type: 'hook', copy: 'Edit video with a sentence.', motion: 'word-by-word reveal, 9 words/s' },
      { id: uid(), from: 7.5, to: 12, type: 'cta', copy: 'aurora.app — shipping Oct 2', motion: 'counter ticks in tabular numerals, fade to logo' },
    ],
    arenaPrompt:
      'Build a SINGLE FILE index.html motion-graphics piece. HARD CONSTRAINTS: one file, inline CSS/JS, no build step. Root #scene exactly 1920x1080 px. Duration 12s at 30fps. Implement window.__seek(t) — all motion must be a pure function of t, no CSS animations, no setTimeout, no Math.random in the frame loop. Style: kinetic type on near-black #0B0B10, lime #C8F542 accent, generous tracking on the logo, tabular numerals on the date.',
  }

  const stingRundown: SceneRundown = {
    title: 'Logo Sting v2 — 3s Pulse',
    durationSec: 3,
    fps: 30,
    size: [1080, 1080],
    style: 'Single mark, spring scale 0.96→1 with overshoot, ring wipe on the last beat',
    scenes: [
      { id: uid(), from: 0, to: 3, type: 'logo', copy: 'NORTHFRAME', motion: 'spring scale-in with overshoot, ring wipe at 2.2s' },
    ],
    arenaPrompt:
      'Build a SINGLE FILE index.html motion-graphics piece. HARD CONSTRAINTS: one file, inline CSS/JS, no build step. Root #scene exactly 1080x1080 px. Duration 3s at 30fps. Implement window.__seek(t) — all motion must be a pure function of t, no CSS animations, no setTimeout, no Math.random in the frame loop. Style: single mark, spring scale-in with overshoot, ring wipe on the last beat, lime on near-black.',
  }

  return [
    {
      id: uid(),
      name: 'Aurora Launch Teaser',
      createdAt: mins(3 * 24 * 60),
      updatedAt: mins(42),
      brief: {
        messages: [
          { role: 'user', text: '12s launch bumper for Aurora — dark, lime, confident. Big type energy.', at: mins(3 * 24 * 60) },
          { role: 'gemini', text: 'Love this direction. I sketched a 12s launch bumper — 3 scenes, dark base with one lime accent. I filled the rundown on the right. Tweak anything, or tell me to push the copy harder.', at: mins(3 * 24 * 60 - 1) },
          { role: 'user', text: 'Good. Make the CTA tick in with the date — tabular numbers, no wobble.', at: mins(2 * 24 * 60) },
          { role: 'gemini', text: 'Tightened. The CTA counter now runs on tabular numerals and the Arena prompt is at the bottom of the rundown — copy it into arena.ai/code, run the battle, vote, then drop the winning .zip into the Arena Desk.', at: mins(2 * 24 * 60 - 1) },
        ],
        draftRundown: auroraRundown,
        lockedRundown: auroraRundown,
      },
      arenaAssets: [
        { id: uid(), name: 'aurora-bumper-v2.html', status: 'rendered', prompt: auroraRundown.arenaPrompt, htmlFileName: 'aurora-bumper-v2.html', thumbnailDataUrl: null, createdAt: mins(2 * 24 * 60) },
        { id: uid(), name: 'aurora-bumper-v1.html', status: 'imported', prompt: auroraRundown.arenaPrompt, htmlFileName: 'aurora-bumper-v1.html', thumbnailDataUrl: null, createdAt: mins(2 * 24 * 60 + 40) },
      ],
      footageAssets: [
        { id: uid(), name: 'founder-interview-take3.mp4', durationSec: 42.6, status: 'edited', silenceRanges: [[6.2, 9.4], [21, 24.8], [33.1, 35]], captionStyle: 'hormozi', crop: '9:16' },
      ],
      timeline: [
        { id: uid(), sourceType: 'arena', sourceId: '', startSec: 0, durationSec: 4 },
        { id: uid(), sourceType: 'footage', sourceId: '', startSec: 4, durationSec: 9.5 },
        { id: uid(), sourceType: 'arena', sourceId: '', startSec: 13.5, durationSec: 2.5 },
      ],
      renderJobs: [
        { id: uid(), aspect: '9:16', fps: 30, quality: 'draft', status: 'done', progressPct: 100, outputName: 'aurora-teaser-9x16-draft.mp4', createdAt: mins(38) },
        { id: uid(), aspect: '16:9', fps: 60, quality: 'final', status: 'error', progressPct: 37, outputName: 'aurora-teaser-16x9-final.mp4', createdAt: mins(12) },
      ],
      brandKit: { colors: ['#0B0B10', '#15151B', '#C8F542', '#F4F1EA'], font: 'Inter Variable', logoDataUrl: null },
    },
    {
      id: uid(),
      name: 'Podcast Clip — Ep. 12',
      createdAt: mins(26 * 60),
      updatedAt: mins(3 * 60),
      brief: {
        messages: [
          { role: 'user', text: 'Cut the ep. 12 cold-open into a 45s vertical clip, Hormozi captions.', at: mins(26 * 60) },
          { role: 'gemini', text: 'On it — drop the raw episode file into the Footage Desk and I\'ll mark the silences. This one wants a strong 2s cold-open, then the laugh.', at: mins(26 * 60 - 1) },
        ],
        draftRundown: null,
        lockedRundown: null,
      },
      arenaAssets: [],
      footageAssets: [
        { id: uid(), name: 'ep12-full-episode.mp4', durationSec: 61.3, status: 'uploaded', silenceRanges: [[12, 15.5], [40, 44.2]], captionStyle: 'standard', crop: '1:1' },
      ],
      timeline: [],
      renderJobs: [],
      brandKit: { colors: ['#0B0B10', '#4FB6E8', '#F4F1EA'], font: 'Inter Variable', logoDataUrl: null },
    },
    {
      id: uid(),
      name: 'Logo Sting v2',
      createdAt: mins(8 * 24 * 60),
      updatedAt: mins(20 * 60),
      brief: {
        messages: [
          { role: 'user', text: '3s logo reveal — NORTHFRAME, square, ring wipe at the end.', at: mins(8 * 24 * 60) },
          { role: 'gemini', text: 'Clean brief. Three seconds is one scene: snap in at 0.96 scale with spring overshoot, hold, ring wipe on the last beat. Rundown locked and the Arena prompt is ready.', at: mins(8 * 24 * 60 - 1) },
        ],
        draftRundown: stingRundown,
        lockedRundown: stingRundown,
      },
      arenaAssets: [
        { id: uid(), name: 'logo-sting-round1.html', status: 'awaiting-vote', prompt: stingRundown.arenaPrompt, htmlFileName: null, thumbnailDataUrl: null, createdAt: mins(20 * 60) },
      ],
      footageAssets: [],
      timeline: [],
      renderJobs: [],
      brandKit: { colors: ['#0B0B10', '#C8F542'], font: 'Inter Variable', logoDataUrl: null },
    },
  ]
}

export const seedTimestamp = nowIso
