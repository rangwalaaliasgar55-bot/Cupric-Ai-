/**
 * Ambient background for the whole app.
 *
 * A single fixed layer behind every screen: a slow mesh gradient plus a fine
 * grain. It sits at `-z-10` with `pointer-events-none`, so it can never
 * intercept a click, and it is skipped entirely under reduced motion — the
 * flat near-black base remains, which is what the design tokens specify.
 *
 * Deliberately CSS-only: no canvas, no rAF loop, nothing to schedule.
 */

import { useReducedMotion } from '../lib/use-reduced-motion'

export function AppBackdrop() {
  const reduced = useReducedMotion()

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: '#0B0B10',
          backgroundImage: [
            'radial-gradient(at 12% 8%, rgba(200,245,66,0.10) 0px, transparent 45%)',
            'radial-gradient(at 88% 12%, rgba(79,182,232,0.10) 0px, transparent 42%)',
            'radial-gradient(at 70% 92%, rgba(120,88,232,0.10) 0px, transparent 45%)',
          ].join(','),
        }}
      />
      {!reduced && (
        <div
          className="absolute -inset-1/4 opacity-60 mix-blend-screen [animation:cupric-drift_46s_ease-in-out_infinite]"
          style={{
            backgroundImage:
              'radial-gradient(closest-side, rgba(200,245,66,0.07), transparent 70%), radial-gradient(closest-side, rgba(79,182,232,0.07), transparent 70%)',
            backgroundSize: '60% 60%, 55% 55%',
            backgroundPosition: '20% 30%, 80% 70%',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0.6) 1px, transparent 1px, transparent 3px)',
        }}
      />
    </div>
  )
}
