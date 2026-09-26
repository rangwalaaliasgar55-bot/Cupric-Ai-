/**
 * next/font/google shim.
 *
 * Cupric AI ships offline (Electron, file://), so it never fetches Google
 * Fonts at runtime. Each loader returns the same shape Next.js returns —
 * `{ className, style, variable }` — pointing at a self-hosted / system stack
 * declared in `src/styles.css`.
 */

type FontOptions = {
  subsets?: string[]
  weight?: string | string[]
  style?: string | string[]
  variable?: string
  display?: string
  preload?: boolean
  adjustFontFallback?: boolean
  fallback?: string[]
  axes?: string[]
}

type FontResult = {
  className: string
  variable: string
  style: { fontFamily: string; fontWeight?: number | string; fontStyle?: string }
}

function makeLoader(className: string, fontFamily: string) {
  return (options: FontOptions = {}): FontResult => ({
    className,
    variable: options.variable ?? '',
    style: { fontFamily },
  })
}

/** Handwritten marker used by arrow-callout / confetti-button / sticky-note-peel. */
export const Caveat = makeLoader(
  'font-marker',
  "'Caveat', 'Segoe Script', 'Bradley Hand', 'Comic Sans MS', cursive",
)

export const Geist = makeLoader('font-sans', 'var(--font-sans)')
export const Geist_Mono = makeLoader('font-mono', 'var(--font-mono)')
export const Inter = makeLoader('font-sans', 'var(--font-sans)')
