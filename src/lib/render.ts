/**
 * Mocked render worker. Reports 0-100% over ~6 seconds through the same
 * progress-callback shape the real Puppeteer-seek + ffmpeg pipeline will use,
 * so the Render screen needs zero changes when the desktop shell lands.
 */
export function fakeStartRender(
  onUpdate: (pct: number) => void,
  onDone: () => void,
): () => void {
  const total = 6000
  const t0 = performance.now()
  let last = -1
  const iv = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - t0) / total)
    const eased = 1 - Math.pow(1 - t, 1.7) // fast start, gentle settle
    const pct = Math.floor(eased * 100)
    if (pct === last) return
    last = pct
    onUpdate(pct)
    if (t >= 1) {
      window.clearInterval(iv)
      onDone()
    }
  }, 110)
  return () => window.clearInterval(iv)
}
