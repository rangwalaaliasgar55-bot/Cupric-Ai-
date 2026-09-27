/**
 * Rich caption markup — the creator-caption look in one text field:
 *   *word*        → emphasis: serif italic (Instrument Serif), tinted
 *   ==words==     → highlight box behind the words
 *   {words}       → accent colour
 *   ^word^        → big (1.5×, heavy) — stats and punch words
 *   new line      → stacked hook lines
 * Markers may combine: ^*30*^ is a big italic word. Pure parsing.
 */
export type RichStyle = { em: boolean; box: boolean; accent: boolean; big: boolean }
export type RichWord = { text: string; style: RichStyle; line: number }

const MARKUP = /(\*[^*\n]+\*|==[^=\n]+==|\{[^}\n]+\}|\^[^^\n]+\^)/

export function hasRichMarkup(text: string): boolean {
  return MARKUP.test(text)
}

/** Strip markup (for word counts, captions export, accessibility). */
export function plainText(text: string): string {
  return text.replace(/==([^=\n]+)==/g, '$1').replace(/\*([^*\n]+)\*/g, '$1').replace(/\{([^}\n]+)\}/g, '$1').replace(/\^([^^\n]+)\^/g, '$1')
}

export function parseRich(text: string): RichWord[] {
  const out: RichWord[] = []
  const st: RichStyle = { em: false, box: false, accent: false, big: false }
  let line = 0
  let word = ''
  let wordStyle: RichStyle | null = null
  const flush = () => {
    if (word) out.push({ text: word, style: wordStyle ?? { ...st }, line })
    word = ''
    wordStyle = null
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') { flush(); line++; continue }
    if (ch === ' ' || ch === '\t') { flush(); continue }
    if (ch === '=' && text[i + 1] === '=') { flush(); st.box = !st.box; i++; continue }
    if (ch === '*') { flush(); st.em = !st.em; continue }
    if (ch === '{') { flush(); st.accent = true; continue }
    if (ch === '}') { flush(); st.accent = false; continue }
    if (ch === '^') { flush(); st.big = !st.big; continue }
    if (!word) wordStyle = { ...st }
    word += ch
  }
  flush()
  return out
}

export const RICH_DEFAULTS = { emphasisColor: '#D9B8FF', boxColor: '#A970FF', accentColor: '#FF6B6B', emphasisFont: 'Instrument Serif' }

/** Creator-caption presets built on the markup (seen in talking-head edits). */
export const RICH_PRESETS = [
  { id: 'stacked-hook', name: 'Stacked hook', text: 'If you’re\na *woman*\nover ^30^', hint: 'Left-stacked lines, one serif emphasis word, a big number.', patch: { align: 'left', weight: 800, fontFamily: 'Montserrat Variable', anim: 'kinetic', textGlow: 0.5 } },
  { id: 'highlight-box', name: 'Highlight box', text: 'it’s likely because you’ve been ==following advice==', hint: 'Bold caption with the key phrase in a colour box.', patch: { align: 'center', weight: 800, fontFamily: 'Montserrat Variable', anim: 'word-reveal' } },
  { id: 'accent-phrase', name: 'Accent phrase', text: 'that {wasn’t designed for}', hint: 'Lead-in in white, the turn of the sentence in the accent colour.', patch: { align: 'center', weight: 800, fontFamily: 'Montserrat Variable', anim: 'kinetic' } },
  { id: 'big-stat', name: 'Big stat', text: 'helped over\n^500^ *women*\n*transform their bodies*', hint: 'Social proof: big number, serif italic payoff.', patch: { align: 'center', weight: 800, fontFamily: 'Geist Variable', anim: 'pop', textGlow: 0.35 } },
  { id: 'name-intro', name: 'Name + detail', text: '*Lauren* who’s in her {mid ^30s^}', hint: 'Serif first name, accent detail — case-study title.', patch: { align: 'center', weight: 800, fontFamily: 'Geist Variable', anim: 'fade-up' } },
  { id: 'years-claim', name: 'Credibility line', text: 'I’ve been in the *{fitness industry}* for\n^17^ *years*', hint: 'Authority claim next to a photo collage.', patch: { align: 'center', weight: 800, fontFamily: 'Geist Variable', anim: 'kinetic' } },
] as const
