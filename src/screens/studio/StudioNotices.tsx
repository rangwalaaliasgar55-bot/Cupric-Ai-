/**
 * One-line Studio notices (0.10.1): when something the document asks for is
 * not available, the Studio still renders with a fallback — and says so,
 * instead of silently looking wrong.
 *   - background id this build cannot paint → fallback colour
 *   - bundled UI/canvas font (Inter Variable) failed to load → system font
 *   - a document font that could not be fetched → system font
 */
import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import type { StudioDoc } from '../../types/project'
import { STUDIO_BACKGROUNDS } from '../../lib/studio/backgrounds'
import { ensureDocFonts, FONTS_CHANGED_EVENT } from '../../lib/studio/fonts'
import { rlog } from '../../lib/log'

const KNOWN_BACKGROUNDS = new Set(STUDIO_BACKGROUNDS.map((b) => b.id))

/** True when the bundled face actually loaded (document.fonts.check() is true for unknown families). */
async function bundledFontLoaded(family: string): Promise<boolean> {
  if (typeof document === 'undefined' || !('fonts' in document)) return true
  try {
    const faces = await document.fonts.load(`800 16px "${family}"`)
    return faces.length > 0
  } catch {
    return false
  }
}

export function StudioNotices({ doc }: { doc: StudioDoc }) {
  const [missingInter, setMissingInter] = useState(false)
  const [failedFonts, setFailedFonts] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    void bundledFontLoaded('Inter Variable').then((ok) => {
      if (!alive) return
      setMissingInter(!ok)
      if (!ok) rlog.warn('studio', 'Inter Variable did not load — canvas text uses the system font')
    })
    return () => {
      alive = false
    }
  }, [])

  const fontKey = doc.clips.map((c) => (c.kind === 'text' ? c.fontFamily ?? '' : '')).join('|')
  useEffect(() => {
    let alive = true
    const check = () =>
      void ensureDocFonts(doc).then((failed) => {
        if (!alive) return
        setFailedFonts(failed)
        if (failed.length) rlog.warn('studio', 'fonts unavailable, using system font', { failed })
      })
    check()
    window.addEventListener(FONTS_CHANGED_EVENT, check)
    return () => {
      alive = false
      window.removeEventListener(FONTS_CHANGED_EVENT, check)
    }
    // Re-check only when the set of fonts changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey])

  const notices: string[] = []
  if (!doc.customBackground && !KNOWN_BACKGROUNDS.has(doc.backgroundId)) {
    notices.push(`Background "${doc.backgroundId}" isn't available in this build — showing a plain fallback colour.`)
  }
  if (missingInter) notices.push('Inter Variable failed to load — text is drawn in the system font.')
  if (failedFonts.length) {
    const names = failedFonts.slice(0, 2).map((f) => `"${f}"`).join(', ')
    notices.push(`Font ${names}${failedFonts.length > 2 ? ` +${failedFonts.length - 2}` : ''} couldn't be loaded (offline?) — using the system font.`)
  }
  if (!notices.length) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-center gap-1 px-4">
      {notices.map((text) => (
        <p
          key={text}
          data-newbrand-notice
          className="pointer-events-auto flex max-w-full items-center gap-1.5 truncate rounded-md border border-line bg-panel/90 px-2.5 py-1 text-[11px] text-muted shadow backdrop-blur"
          title={text}
        >
          <Info size={12} className="shrink-0 text-info" />
          <span className="truncate">{text}</span>
        </p>
      ))}
    </div>
  )
}
