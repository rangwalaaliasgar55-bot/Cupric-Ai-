import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Loader2, Plus, Search, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import type { StudioClip, StudioDoc, StudioTextClip } from '../../types/project'
import { FONTSHARE_FONTS, applyLook, fontshareUrl, lookPreview, suggestTextLooks, type TextLook } from '../../lib/studio/fontStyles'
import { VIDEO_FONTS } from '../../lib/studio/videoFonts'
import { importFontFiles } from '../../lib/studio/fontZip'
import { USER_FONTS_EVENT, removeUserFontFamily, userFontFamilies, userFontsReady } from '../../lib/studio/userFonts'
import { FONTS_CHANGED_EVENT, ensureFont, fontReadiness, fontStatus, type FontStatus } from '../../lib/studio/fonts'
import { useActiveProject } from '../../state/useProjectStore'
import { cx } from '../../lib/utils'

/** Re-renders when the user adds/removes fonts, or a family finishes loading. */
export function useUserFonts(): string[] {
  const [list, setList] = useState<string[]>(userFontFamilies())
  useEffect(() => {
    const on = () => setList(userFontFamilies())
    window.addEventListener(USER_FONTS_EVENT, on)
    window.addEventListener(FONTS_CHANGED_EVENT, on)
    void userFontsReady().then(on)
    return () => {
      window.removeEventListener(USER_FONTS_EVENT, on)
      window.removeEventListener(FONTS_CHANGED_EVENT, on)
    }
  }, [])
  return list
}

const STATUS_TINT: Record<FontStatus, string> = {
  ready: 'text-accent-text',
  loading: 'text-info',
  missing: 'text-danger',
}

/**
 * One suggestion, drawn in the fonts it would actually apply.
 *
 * The chip used to paint the *ideal* family whether or not it was installed,
 * so every chip looked the same (all fallback) and clicking one on a machine
 * without that font did nothing but open a shelf. Now the chip previews the
 * stand-in it will really use and says so, and clicking always changes the
 * design — with the Fontshare link to the original right there.
 */
function LookChip({ look, sample, available, onApply, applied }: {
  look: TextLook
  sample: string
  available: (f: string) => boolean
  onApply: () => void
  applied: boolean
}) {
  const p = look.patch
  const preview = lookPreview(look, { available })
  const words = sample.split(/\s+/).filter(Boolean)
  const first = words.slice(0, 2).join(' ') || 'Your'
  const emph = words[2] ?? 'words'
  const italic = look.patch.fontFamily && !look.needs
  return (
    <button
      type="button"
      onClick={onApply}
      title={[look.why, preview.swapped ? `Applies ${preview.head} now; ${look.patch.fontFamily} is free on Fontshare.` : null].filter(Boolean).join(' ')}
      className={cx(
        'group relative flex min-h-[74px] flex-col justify-between overflow-hidden rounded-lg border bg-black/40 p-2 text-left transition',
        applied ? 'border-accent ring-1 ring-accent/40' : 'border-line hover:border-accent',
        preview.swapped && 'border-dashed',
      )}
    >
      <span
        className="block truncate leading-tight"
        style={{
          fontFamily: `'${preview.head}', system-ui`,
          fontWeight: p.weight,
          color: p.color,
          fontSize: 15,
          textShadow: p.textGlow ? `0 0 10px ${p.color}` : undefined,
        }}
      >
        {first}{' '}
        <span style={{ fontFamily: `'${preview.emphasis}', Georgia, serif`, fontStyle: italic ? 'italic' : undefined, fontWeight: 400, color: p.emphasisColor }}>{emph}</span>
      </span>
      <span className="mt-1 flex items-center gap-1">
        {[p.emphasisColor, p.boxColor, p.accentColor].map((c, i) => (
          <span key={i} className="h-2.5 w-2.5 rounded-full border border-white/20" style={{ background: c }} />
        ))}
        <span className="ml-1 truncate text-[10px] text-muted">{preview.swapped ? `Uses ${preview.head}` : look.name}</span>
      </span>
      {preview.swapped && (
        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-panel-alt text-[9px] text-info" title={`${look.patch.fontFamily} is not installed — its closest match applies instead.`}>
          <Sparkles size={9} />
        </span>
      )}
      {applied && <span className="absolute bottom-1.5 right-1.5 text-accent-text"><Check size={11} /></span>}
    </button>
  )
}

function StatusDot({ status }: { status: FontStatus }) {
  return (
    <span className={cx('inline-flex items-center', STATUS_TINT[status])} title={status === 'ready' ? 'Loaded — renders exactly like this' : status === 'loading' ? 'Loading…' : 'Not on this machine — text falls back'}>
      {status === 'loading' ? <Loader2 size={10} className="animate-spin" /> : status === 'ready' ? <Check size={10} /> : <AlertTriangle size={10} />}
    </span>
  )
}

/**
 * Suggested looks (font pairing + colours from the brand kit and in-between
 * tones), the user's own fonts, and the Fontshare shelf with a compliant
 * "download it yourself, drop it here" flow.
 */
export function FontStudio({ clip, doc, onPatch }: { clip: StudioTextClip; doc?: StudioDoc; onPatch: (p: Partial<StudioClip>) => void }) {
  const project = useActiveProject()
  const userFonts = useUserFonts()
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [link, setLink] = useState<{ label: string; href: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [showShelf, setShowShelf] = useState(false)
  const [query, setQuery] = useState('')
  const [seed, setSeed] = useState(0)
  const [appliedId, setAppliedId] = useState<string | null>(null)
  const [, forceStatus] = useState(0)
  const available = (f: string) => VIDEO_FONTS.some((v) => v.family === f) || userFonts.includes(f)
  const sample = clip.text.replace(/[*={}^]/g, '').replace(/\s+/g, ' ').trim() || 'Your headline here'
  const looks = useMemo(() => {
    const all = suggestTextLooks(sample, { brandColors: project?.brandKit?.colors, available, includeMissing: true })
    if (!all.length) return all
    const at = seed % all.length
    return [...all.slice(at), ...all.slice(0, at)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, project?.brandKit?.colors, userFonts.join('|'), seed])
  const visible = looks.slice(0, 6)

  // Keep the clip's own family honest: ask the browser to load it, then report.
  useEffect(() => {
    if (!clip.fontFamily) return
    let live = true
    void ensureFont(clip.fontFamily, [clip.weight]).then(() => live && forceStatus((n) => n + 1))
    return () => { live = false }
  }, [clip.fontFamily, clip.weight])

  const shelf = useMemo(() => {
    const q = query.trim().toLowerCase()
    return FONTSHARE_FONTS.filter((f) => !q || f.family.toLowerCase().includes(q) || f.bestFor.toLowerCase().includes(q) || f.role.includes(q))
  }, [query])

  async function apply(look: TextLook) {
    setApplying(look.id)
    setLink(null)
    try {
      const result = applyLook(look, { available })
      // Prove the faces are usable *before* claiming the look is applied.
      const ready = await Promise.all([
        ensureFont(result.patch.fontFamily, [result.patch.weight]),
        ensureFont(result.patch.emphasisFont, [result.patch.weight]),
      ])
      const failed = !ready[0] || !ready[1]
      onPatch(result.patch as Partial<StudioClip>)
      setAppliedId(look.id)
      const parts = [result.note, failed ? 'One of these fonts could not be loaded, so the fallback face is showing — add the family file to fix it.' : null].filter(Boolean)
      setMsg(`Applied “${look.name}”: ${result.patch.fontFamily}${result.patch.emphasisFont ? ` + ${result.patch.emphasisFont}` : ''}. ${look.why}${parts.length ? ` ${parts.join(' ')}` : ''}`)
      if (result.downloadUrl && result.wanted) setLink({ label: `Get ${result.wanted} free on Fontshare`, href: result.downloadUrl })
    } finally {
      setApplying(null)
    }
  }

  async function applyFamily(family: string) {
    setApplying(family)
    setLink(null)
    try {
      const ok = await ensureFont(family, [clip.weight])
      onPatch({ fontFamily: family } as Partial<StudioClip>)
      setMsg(ok ? `${family} is loaded and applied — the preview, the timeline and the export all use it.` : `${family} could not be loaded on this machine, so the canvas is showing the fallback face. Add the font file below to fix that.`)
    } finally {
      setApplying(null)
    }
  }

  async function add(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      const r = await importFontFiles([...files], [...files].some((f) => /fontshare|satoshi|clash|general|cabinet|switzer|zodiak/i.test(f.name)) ? 'fontshare' : 'file')
      const fams = [...new Set(r.added.map((f) => f.family))]
      if (fams.length) {
        await Promise.all(fams.map((f) => ensureFont(f, [clip.weight])))
        onPatch({ fontFamily: fams[0] } as Partial<StudioClip>)
      }
      setMsg(fams.length ? `Added ${fams.join(', ')} (${r.added.length} style${r.added.length === 1 ? '' : 's'}) and applied ${fams[0]}. They stay on this computer and are embedded in your exports.${r.skipped.length ? ` Skipped: ${r.skipped.slice(0, 3).join('; ')}.` : ''}` : `No fonts found. ${r.skipped.slice(0, 3).join('; ') || 'Use .zip, .woff2, .otf or .ttf.'}`)
    } catch (e) {
      setMsg(`Could not read those files: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function verifyProjectFonts() {
    const target = doc ?? ({ clips: [clip] } as Pick<StudioDoc, 'clips'>)
    setBusy(true)
    try {
      const report = await fontReadiness(target)
      const bad = report.filter((r) => r.status !== 'ready')
      setMsg(bad.length
        ? `${bad.length} of ${report.length} font(s) used here are not ready: ${bad.map((b) => b.family).join(', ')}. Texts in those families render in the fallback face until the font is added.`
        : `All ${report.length} font(s) used in this project are loaded — preview and export match.`)
    } finally {
      setBusy(false)
    }
  }

  const currentStatus = clip.fontFamily ? fontStatus(clip.fontFamily, [clip.weight]) : 'missing'
  const currentKind = clip.fontFamily && VIDEO_FONTS.some((v) => v.family === clip.fontFamily) ? 'Bundled' : userFonts.includes(clip.fontFamily ?? '') ? 'Yours' : 'Not installed'

  return (
    <div className="cu-section space-y-3 px-3 py-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-text">
          Suggested looks
          <span className="rounded-full border border-line bg-panel-alt px-1.5 py-px text-[10px] font-normal text-muted">{visible.length} of {looks.length}</span>
        </span>
        <button type="button" className="cu-chip px-2 py-0.5 text-[11px]" onClick={() => setSeed((s) => s + 3)}>Shuffle</button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {visible.map((l) => (
          <LookChip key={l.id} look={l} sample={sample} available={available} applied={appliedId === l.id} onApply={() => void apply(l)} />
        ))}
      </div>
      <p className="text-[11px] text-muted">
        Picked for the mood of your words, with colours from your Brand Kit plus the tones between them.
        {applying ? ' Loading the fonts…' : ''}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
        <span className="mr-auto text-xs font-medium text-text">Your fonts</span>
        <button type="button" className="cu-chip flex items-center gap-1 px-2 py-0.5 text-[11px]" disabled={busy} onClick={() => void verifyProjectFonts()} title="Check that every font this project uses is really loaded">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />} Verify
        </button>
        <input ref={fileRef} type="file" multiple accept=".zip,.woff2,.woff,.otf,.ttf" className="hidden" onChange={(e) => void add(e.target.files)} />
        <button type="button" disabled={busy} title={(busy) ? 'Adding font…' : undefined} className="cu-chip flex items-center gap-1 px-2 py-0.5 text-[11px]" onClick={() => fileRef.current?.click()}><Plus size={11} /> {busy ? 'Adding…' : 'Add fonts'}</button>
        <button type="button" className={cx('cu-chip px-2 py-0.5 text-[11px]', showShelf && 'border-accent text-accent')} onClick={() => setShowShelf((v) => !v)}>Fontshare</button>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-line bg-black/20 px-2 py-1.5 text-[11px]">
        <StatusDot status={currentStatus} />
        <span className="truncate text-text" style={{ fontFamily: `'${clip.fontFamily ?? 'Inter Variable'}', system-ui` }}>{clip.fontFamily ?? 'Inter Variable'}</span>
        <span className="ml-auto shrink-0 text-muted">{currentKind}{currentStatus === 'missing' ? ' · falls back' : ''}</span>
      </div>

      {userFonts.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {userFonts.map((f) => (
            <span key={f} className={cx('cu-chip flex items-center gap-1 px-2 py-0.5 text-xs', clip.fontFamily === f && 'border-accent')}>
              <button type="button" style={{ fontFamily: `'${f}'` }} onClick={() => void applyFamily(f)}>{f}</button>
              <button type="button" aria-label={`Remove ${f}`} className="text-muted hover:text-danger" onClick={() => void removeUserFontFamily(f)}><Trash2 size={10} /></button>
            </span>
          ))}
        </div>
      ) : <p className="text-[11px] text-muted">Drop a font .zip (e.g. from Fontshare), .woff2, .otf or .ttf. It stays on this computer and is embedded in your exports.</p>}

      {showShelf && (
        <div className="space-y-1.5 rounded-lg border border-line bg-black/20 p-2">
          <p className="text-[11px] leading-relaxed text-muted">
            Fontshare fonts are free, but their licence doesn’t let apps hand them out — download the family yourself (one click), press <b className="text-text">Add fonts</b> and choose the .zip. Until then, each suggested look uses the closest font you already have, so nothing silently falls back.
          </p>
          <label className="flex items-center gap-1.5 rounded-md border border-line bg-bg px-2 py-1">
            <Search size={11} className="text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 21 Fontshare families…" className="w-full bg-transparent text-xs text-text outline-none placeholder:text-muted/60" />
          </label>
          <div className="grid max-h-52 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
            {shelf.map((f) => {
              const have = userFonts.includes(f.family)
              const status = have ? 'ready' : fontStatus(f.family)
              return (
                <div key={f.slug} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs">
                  <StatusDot status={status} />
                  <span className="truncate text-text" style={{ fontFamily: `'${f.family}', system-ui` }}>{f.family}</span>
                  {have
                    ? <button type="button" className="ml-auto shrink-0 text-[10px] text-accent-text hover:underline" onClick={() => void applyFamily(f.family)}>use</button>
                    : <a className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] text-muted hover:text-accent-text" href={fontshareUrl(f.slug)} target="_blank" rel="noreferrer" title={`${f.bestFor} · weights ${f.weights[0]}–${f.weights[1]}${f.italic ? ' · italic' : ''}`}>
                        free <ExternalLink size={9} />
                      </a>}
                </div>
              )
            })}
            {!shelf.length && <p className="px-1 py-2 text-[11px] text-muted">No family matches “{query}”.</p>}
          </div>
        </div>
      )}

      {msg && (
        <p className="rounded-md bg-accent/10 px-2 py-1.5 text-[11px] leading-relaxed text-text" role="status">
          {msg}
          {link && (
            <>
              {' '}
              <a className="inline-flex items-center gap-0.5 text-accent-text underline" href={link.href} target="_blank" rel="noreferrer">
                {link.label} <ExternalLink size={9} />
              </a>
            </>
          )}
        </p>
      )}
    </div>
  )
}
