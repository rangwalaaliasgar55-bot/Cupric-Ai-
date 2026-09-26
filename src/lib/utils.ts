export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

export const nowIso = (): string => new Date().toISOString()

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v))

export const round1 = (v: number): number => Math.round(v * 10) / 10

export const cx = (...xs: (string | false | null | undefined)[]): string =>
  xs.filter(Boolean).join(' ')

/** Deterministic hash so thumbnails / waveforms stay stable per id. */
export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/** Seeded PRNG (mulberry32) — deterministic waveform bars. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hrs = Math.round(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/** 4.5 -> "4.5s", 42.6 -> "42.6s", 121 -> "2m 1s" */
export function fmtDur(s: number): string {
  if (s < 60) return `${round1(s)}s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s % 60)
  return `${m}m ${rest}s`
}

/** Playhead clock: 65.3 -> "1:05.3" */
export function fmtClock(s: number): string {
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'untitled'
  )
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

/** Thumbnail gradients — dark, subtle, on-brand. */
export const GRADIENTS = [
  'bg-gradient-to-br from-[#233314] via-[#141c0d] to-[#0d100a]',
  'bg-gradient-to-br from-[#12303c] via-[#0d1d26] to-[#0a1116]',
  'bg-gradient-to-br from-[#33230f] via-[#1d140b] to-[#120c07]',
  'bg-gradient-to-br from-[#2a1633] via-[#180e1f] to-[#0e0813]',
]

export const gradientFor = (seed: string): string => GRADIENTS[hashStr(seed) % GRADIENTS.length]

export function deriveAspect(size: [number, number]): '16:9' | '9:16' | '1:1' {
  const [w, h] = size
  if (w === h) return '1:1'
  return w > h ? '16:9' : '9:16'
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}
