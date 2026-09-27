import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import type { StudioClip, StudioTextClip } from '../../types/project'
import { FONTSHARE_FONTS, fontshareUrl, suggestTextLooks, type TextLook } from '../../lib/studio/fontStyles'
import { VIDEO_FONT_FAMILIES } from '../../lib/studio/videoFonts'
import { importFontFiles } from '../../lib/studio/fontZip'
import { USER_FONTS_EVENT, removeUserFontFamily, userFontFamilies, userFontsReady } from '../../lib/studio/userFonts'
import { useActiveProject } from '../../state/useProjectStore'
import { cx } from '../../lib/utils'

/** Re-renders when the user adds/removes fonts. */
export function useUserFonts(): string[] {
  const [list, setList] = useState<string[]>(userFontFamilies())
  useEffect(() => {
    const on = () => setList(userFontFamilies())
    window.addEventListener(USER_FONTS_EVENT, on)
    void userFontsReady().then(on)
    return () => window.removeEventListener(USER_FONTS_EVENT, on)
  }, [])
  return list
}

function LookChip({ look, sample, onApply }: { look: TextLook; sample: string; onApply: () => void }) {
  const p = look.patch
  const words = sample.split(/\s+/).filter(Boolean)
  const first = words.slice(0, 2).join(' ') || 'Your'
  const emph = words[2] ?? 'words'
  return (
    <button type="button" onClick={onApply} title={look.why + (look.needs ? ` — get ${look.needs.family} free on Fontshare first.` : '')}
      className={cx('group relative flex min-h-[64px] flex-col justify-between overflow-hidden rounded-lg border border-line bg-black/40 p-2 text-left transition hover:border-accent', look.needs && 'border-dashed')}>
      <span className="block truncate leading-tight" style={{ fontFamily: `'${p.fontFamily}', system-ui`, fontWeight: p.weight, color: p.color, fontSize: 15, textShadow: p.textGlow ? `0 0 10px ${p.color}` : undefined }}>
        {first}{' '}
        <span style={{ fontFamily: `'${p.emphasisFont}', Georgia, serif`, fontStyle: 'italic', fontWeight: 400, color: p.emphasisColor }}>{emph}</span>
      </span>
      <span className="mt-1 flex items-center gap-1">
        {[p.emphasisColor, p.boxColor, p.accentColor].map((c, i) => <span key={i} className="h-2.5 w-2.5 rounded-full border border-white/20" style={{ background: c }} />)}
        <span className="ml-1 truncate text-[10px] text-muted">{look.needs ? `Needs ${look.needs.family}` : look.name}</span>
      </span>
    </button>
  )
}

/**
 * Suggested looks (font pairing + colours from the brand kit and in-between
 * tones), the user's own fonts, and the Fontshare shelf with a compliant
 * "download it yourself, drop it here" flow.
 */
export function FontStudio({ clip, onPatch }: { clip: StudioTextClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const project = useActiveProject()
  const userFonts = useUserFonts()
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showShelf, setShowShelf] = useState(false)
  const [seed, setSeed] = useState(0)
  const available = (f: string) => VIDEO_FONT_FAMILIES.has(f) || userFonts.includes(f)
  const sample = clip.text.replace(/[*={}^]/g, '').replace(/\s+/g, ' ').trim() || 'Your headline here'
  const looks = useMemo(() => {
    const all = suggestTextLooks(sample, { brandColors: project?.brandKit?.colors, available, includeMissing: true })
    return [...all.slice(seed % all.length), ...all.slice(0, seed % all.length)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, project?.brandKit?.colors, userFonts.join('|'), seed])

  const apply = (look: TextLook) => {
    if (look.needs) { setMsg(`${look.needs.family} is a free Fontshare font. Download it (link below), then drop the .zip on “Add fonts” — Cupric keeps it on this computer and this look applies.`); setShowShelf(true); return }
    onPatch(look.patch as Partial<StudioClip>)
    setMsg(`Applied “${look.name}”: ${look.patch.fontFamily} + ${look.patch.emphasisFont} italic. ${look.why}`)
  }

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const r = await importFontFiles([...files], [...files].some((f) => /fontshare|satoshi|clash|general|cabinet|switzer|zodiak/i.test(f.name)) ? 'fontshare' : 'file')
      const fams = [...new Set(r.added.map((f) => f.family))]
      setMsg(fams.length ? `Added ${fams.join(', ')} (${r.added.length} style${r.added.length === 1 ? '' : 's'}). Pick it above or use a suggested look.${r.skipped.length ? ` Skipped: ${r.skipped.slice(0, 3).join('; ')}.` : ''}` : `No fonts found. ${r.skipped.slice(0, 3).join('; ') || 'Use .zip, .woff2, .otf or .ttf.'}`)
    } catch (e) {
      setMsg(`Could not read those files: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="cu-section space-y-2.5 px-3 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text">Suggested looks</span>
        <button type="button" className="cu-chip px-2 py-0.5 text-[11px]" onClick={() => setSeed((s) => s + 3)}>Shuffle</button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {looks.slice(0, 6).map((l) => <LookChip key={l.id} look={l} sample={sample} onApply={() => apply(l)} />)}
      </div>
      <p className="text-[11px] text-muted">Picked for the mood of your words. Colours come from your Brand Kit plus the tones between them.</p>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
        <span className="mr-auto text-xs font-medium text-text">Your fonts</span>
        <input ref={fileRef} type="file" multiple accept=".zip,.woff2,.woff,.otf,.ttf" className="hidden" onChange={(e) => void add(e.target.files)} />
        <button type="button" disabled={busy} className="cu-chip flex items-center gap-1 px-2 py-0.5 text-[11px]" onClick={() => fileRef.current?.click()}><Plus size={11} /> {busy ? 'Adding…' : 'Add fonts'}</button>
        <button type="button" className={cx('cu-chip px-2 py-0.5 text-[11px]', showShelf && 'border-accent text-accent')} onClick={() => setShowShelf((v) => !v)}>Fontshare</button>
      </div>
      {userFonts.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {userFonts.map((f) => (
            <span key={f} className={cx('cu-chip flex items-center gap-1 px-2 py-0.5 text-xs', clip.fontFamily === f && 'border-accent')}>
              <button type="button" style={{ fontFamily: `'${f}'` }} onClick={() => onPatch({ fontFamily: f } as Partial<StudioClip>)}>{f}</button>
              <button type="button" aria-label={`Remove ${f}`} className="text-muted hover:text-danger" onClick={() => void removeUserFontFamily(f)}><Trash2 size={10} /></button>
            </span>
          ))}
        </div>
      ) : <p className="text-[11px] text-muted">Drop a font .zip (e.g. from Fontshare), .woff2, .otf or .ttf. It stays on this computer and is embedded in your exports.</p>}
      {showShelf && (
        <div className="space-y-1.5 rounded-lg border border-line bg-black/20 p-2">
          <p className="text-[11px] leading-relaxed text-muted">Fontshare fonts are free, but their licence doesn’t let apps hand them out — so download the family yourself (one click on Fontshare), then press <b className="text-text">Add fonts</b> and choose the .zip.</p>
          <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto pr-1">
            {FONTSHARE_FONTS.map((f) => {
              const have = userFonts.includes(f.family)
              return (
                <a key={f.slug} href={fontshareUrl(f.slug)} target="_blank" rel="noreferrer" title={f.bestFor}
                  onClick={(e) => { if (have) { e.preventDefault(); onPatch({ fontFamily: f.family } as Partial<StudioClip>) } }}
                  className="flex items-center justify-between gap-1 rounded-md border border-line px-2 py-1 text-xs hover:border-accent">
                  <span className="truncate text-text">{f.family}</span>
                  {have ? <span className="text-[10px] text-accent">added · use</span> : <ExternalLink size={10} className="shrink-0 text-muted" />}
                </a>
              )
            })}
          </div>
        </div>
      )}
      {msg && <p className="rounded-md bg-accent/10 px-2 py-1.5 text-[11px] text-text" role="status">{msg}</p>}
    </div>
  )
}
