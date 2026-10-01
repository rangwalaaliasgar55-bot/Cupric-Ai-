/**
 * One motion language for NewBrand.
 * Spring only on the six moments listed in DESIGN.md.
 * Everyday UI uses soft ease 150–200ms.
 */

export const EASE_SOFT = [0.22, 1, 0.36, 1] as const
export const EASE_SPRING = [0.34, 1.56, 0.64, 1] as const

export const DURATION = {
  fast: 0.15,
  base: 0.18,
  slow: 0.22,
} as const

export const transitionSoft = {
  duration: DURATION.base,
  ease: EASE_SOFT,
} as const

export const transitionSpring = {
  type: 'spring' as const,
  stiffness: 500,
  damping: 38,
}

/** CSS cubic-bezier strings for non-Motion code */
export const CSS_EASE_SOFT = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const CSS_EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

/** Press scale used on every interactive control */
export const PRESS_SCALE = 0.96
