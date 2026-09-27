/**
 * 2.12 — AI text variants. Asks the connected model for rewrites; when none is
 * connected (or it fails) returns the rule-based variants and says so, so the
 * user always knows which they are looking at.
 */
import { getIpc } from '../bridge'
import { chat as openCodeChat, isConfigured as isOpenCodeConfigured } from '../opencode'
import { localTextVariants, parseVariantReply } from './textTools'

export type VariantResult = { variants: string[]; source: 'model' | 'local'; note?: string }

const PROMPT = (text: string) =>
  `Rewrite this on-screen video text 4 different ways (punchy, friendly, formal, shorter). Keep the meaning; do not add claims, numbers or testimonials that are not in the original. Max 10 words each. One per line, no numbering.\n\nText: "${text}"`

export async function requestTextVariants(text: string): Promise<VariantResult> {
  const clean = text.trim()
  if (!clean) return { variants: [], source: 'local', note: 'Type some text first.' }
  const local = (note: string): VariantResult => ({ variants: localTextVariants(clean).map((v) => v.text), source: 'local', note })
  try {
    const api = getIpc()
    let reply = ''
    if (api) {
      const r = await api.invoke('gemini:chat', { text: PROMPT(clean), ctx: { projectName: null, view: 'studio' }, history: [], images: [] })
      reply = typeof r === 'string' ? r : r && typeof r === 'object' && 'text' in r ? String((r as { text: unknown }).text ?? '') : ''
    } else if (isOpenCodeConfigured()) {
      reply = await openCodeChat([{ role: 'user', content: PROMPT(clean) }])
    } else {
      return local('No live model connected — these are rule-based rewrites of your own words.')
    }
    const variants = parseVariantReply(reply, clean)
    return variants.length ? { variants, source: 'model' } : local('The model returned nothing usable — showing rule-based rewrites.')
  } catch {
    return local('The model could not be reached — showing rule-based rewrites.')
  }
}
