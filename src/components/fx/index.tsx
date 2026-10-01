import { EASE_SOFT } from '../../lib/motion'
/**
 * App-chrome effects in the spirit of React Bits (https://github.com/DavidHDev/react-bits)
 * — shiny text, spotlight card, animated pipeline icons. Written from scratch
 * for NewBrand; no React Bits source is copied (its licence has a Commons Clause).
 * These live in the app shell only, never in the Studio renderer, and every
 * one of them goes still under reduced motion.
 */
import { useRef, type ReactNode, type PointerEvent } from 'react'
import { motion } from 'motion/react'
import { FileText, Search, Film, Mic, Captions, Music, Clapperboard, Check, type LucideIcon } from 'lucide-react'
import { useReducedMotion } from '../../lib/use-reduced-motion'
import { cn } from '../../lib/cn'

/** A light sweep across text (reduced motion: plain text). */
export function ShinyText({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()
  if (reduced) return <span className={className}>{children}</span>
  return (
    <motion.span
      className={cn('bg-clip-text text-transparent', className)}
      style={{ backgroundImage: 'linear-gradient(110deg, var(--color-text, #F4F1EA) 40%, var(--color-accent, #C6F432) 50%, var(--color-text, #F4F1EA) 60%)', backgroundSize: '250% 100%' }}
      initial={{ backgroundPosition: '100% 0' }}
      animate={{ backgroundPosition: '-100% 0' }}
      transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
      data-testid="fx-shiny-text"
    >{children}</motion.span>
  )
}

/** A card whose border glows where the pointer is (CSS variables; no re-render per move). */
export function SpotlightCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    ref.current.style.setProperty('--sx', `${e.clientX - r.left}px`)
    ref.current.style.setProperty('--sy', `${e.clientY - r.top}px`)
  }
  return (
    <div ref={ref} onPointerMove={move} data-testid="fx-spotlight-card"
      className={cn('relative overflow-hidden rounded-xl border border-line bg-panel', className)}
      style={reduced ? undefined : { backgroundImage: 'radial-gradient(260px circle at var(--sx, -300px) var(--sy, -300px), rgba(198,244,50,0.08), transparent 70%)' }}>
      {children}
    </div>
  )
}

export type PipelineStepState = 'idle' | 'active' | 'done' | 'error' | 'skipped'
export const PIPELINE_ICONS: Record<string, LucideIcon> = { script: FileText, terms: Search, footage: Film, voice: Mic, subtitles: Captions, music: Music, compose: Clapperboard }

/** Animated stage icon: pulses while active, pops a check when done. */
export function PipelineIcon({ step, state, label }: { step: keyof typeof PIPELINE_ICONS; state: PipelineStepState; label: string }) {
  const reduced = useReducedMotion()
  const Icon = PIPELINE_ICONS[step] ?? FileText
  const tone = state === 'done' ? 'border-accent/60 text-accent' : state === 'active' ? 'border-accent text-text' : state === 'error' ? 'border-danger/60 text-danger' : 'border-line text-muted'
  return (
    <div className="flex flex-col items-center gap-1" data-state={state} data-testid={`pipeline-${step}`}>
      <motion.div className={cn('relative grid h-9 w-9 place-items-center rounded-full border bg-panel-alt/60', tone, state === 'skipped' && 'opacity-40')}
        animate={!reduced && state === 'active' ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={!reduced && state === 'active' ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}>
        <Icon size={15} aria-hidden />
        {state === 'done' && (
          <motion.span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-accent text-black"
            initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.2, ease: EASE_SOFT }}>
            <Check size={10} strokeWidth={3} aria-hidden />
          </motion.span>
        )}
      </motion.div>
      <span className="text-[10px] text-muted">{label}</span>
    </div>
  )
}
