/** Cupric AI's runtime-safe subset of the editing-agent EDL. Kept dependency-free so it works in Electron and browser preview. */
export type EditCaption = { text: string; start: number; end: number; emphasis?: string[] }
export type EditClip = { id: string; sourceFile: string; inSec: number; outSec: number; purpose: string; transition: 'hard_cut'|'dissolve'|'flash_white'|'push_in'|'pull_out'|'blur'|'slide'; captions: EditCaption[] }
export type EditingPlan = { schemaVersion: '1.0'; targetDurationSec: number; aspect: '16:9'|'9:16'|'1:1'; fps: 30|60; sections: { id: string; role: string; clips: EditClip[] }[]; captions: { enabled: boolean; mode: 'phrase'|'word'|'karaoke'; maxWords: number } }
export type PlanIssue = { path: string; message: string }

export function parseCaptionText(raw: string): EditCaption[] {
  const stamp = (v: string) => { const a = v.replace(',', '.').split(':').map(Number); return a.length === 3 ? a[0]*3600+a[1]*60+a[2] : a[0]*60+a[1] }
  return raw.replace(/^WEBVTT\s*/i, '').split(/\n\s*\n/).flatMap(block => {
    const m = block.match(/(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})[\s\S]*?\n([\s\S]*)/)
    if (!m) return []
    const text = m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    return text ? [{ text, start: stamp(m[1]), end: stamp(m[2]) }] : []
  })
}

export function validateEditingPlan(plan: EditingPlan): PlanIssue[] {
  const issues: PlanIssue[] = []
  if (!plan || plan.schemaVersion !== '1.0') issues.push({ path: 'schemaVersion', message: 'Unsupported editing plan schema' })
  if (!Number.isFinite(plan?.targetDurationSec) || plan.targetDurationSec <= 0 || plan.targetDurationSec > 120) issues.push({ path: 'targetDurationSec', message: 'Duration must be between 0 and 120 seconds' })
  if (![30, 60].includes(plan?.fps)) issues.push({ path: 'fps', message: 'FPS must be 30 or 60' })
  let total = 0
  for (const section of plan?.sections ?? []) for (const clip of section.clips ?? []) {
    if (!clip.sourceFile) issues.push({ path: `${section.id}.${clip.id}.sourceFile`, message: 'Source file is required' })
    if (!(clip.outSec > clip.inSec)) issues.push({ path: `${section.id}.${clip.id}`, message: 'outSec must be greater than inSec' })
    total += Math.max(0, clip.outSec - clip.inSec)
    for (const caption of clip.captions ?? []) if (!(caption.end > caption.start)) issues.push({ path: `${section.id}.${clip.id}.captions`, message: 'Caption end must be after start' })
  }
  if (total > 120.001) issues.push({ path: 'sections', message: 'Timeline exceeds the 120 second render limit' })
  return issues
}
