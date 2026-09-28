import { EASE_SPRING } from '../lib/motion'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useProjectStore, type Toast } from '../state/useProjectStore'
import { cx } from '../lib/utils'

const ICONS: Record<Toast['kind'], typeof Info> = {
  success: CheckCircle2,
  info: Info,
  error: AlertTriangle,
}

const TONES: Record<Toast['kind'], string> = {
  success: 'text-accent-text',
  info: 'text-info',
  error: 'text-danger',
}

/**
 * Bottom-right toasts, auto-dismissed after 4s (design-system rule).
 *
 * A sticky toast opts out of the timer and waits — used only where missing
 * the message would cost the user something, and still dismissible by
 * clicking it, so it never becomes an obstacle.
 */
export function Toasts() {
  const toasts = useProjectStore((s) => s.toasts)
  const dismiss = useProjectStore((s) => s.dismissToast)

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICONS[t.kind]
          return (
            <motion.div
              key={t.id}
              layout
              role="status"
              onClick={() => dismiss(t.id)}
              className="pointer-events-auto flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-panel-alt px-3.5 py-3"
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.2, ease: EASE_SPRING }}
            >
              <Icon size={16} className={cx('mt-0.5 shrink-0', TONES[t.kind])} />
              <div className="min-w-0 flex-1">
                <span className="text-sm leading-snug text-text">{t.text}</span>
                {t.action && (
                  <button
                    type="button"
                    className="mt-1.5 block text-sm font-medium text-accent-text underline underline-offset-2"
                    onClick={(event) => {
                      // The toast itself dismisses on click; the action must
                      // not be swallowed by that.
                      event.stopPropagation()
                      t.action?.run()
                      dismiss(t.id)
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
