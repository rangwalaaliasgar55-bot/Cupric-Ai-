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

/** Bottom-right toasts, auto-dismiss after 4s (design-system rule). */
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
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            >
              <Icon size={16} className={cx('mt-0.5 shrink-0', TONES[t.kind])} />
              <span className="text-sm leading-snug text-text">{t.text}</span>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
