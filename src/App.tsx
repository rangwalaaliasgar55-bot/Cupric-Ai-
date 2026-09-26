import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { AppLayout } from './app-shell/AppLayout'
import { useProjectStore } from './state/useProjectStore'

export default function App() {
  const theme = useProjectStore((s) => s.theme)
  const setAskOpen = useProjectStore((s) => s.setAskOpen)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // ⌘K / Ctrl+K toggles the Ask Gemini slide-over
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAskOpen(!useProjectStore.getState().askOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setAskOpen])

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <AppLayout />
    </MotionConfig>
  )
}
