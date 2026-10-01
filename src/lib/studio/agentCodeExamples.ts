/**
 * Few-shot examples for the addAnimation op (project-original code, written
 * for NewBrand). Each one follows every rule in agentCode.ts; the Node check
 * validates them, so a prompt never teaches the model something we'd reject.
 */
export const AGENT_ANIMATION_FEWSHOTS: Array<{ request: string; answer: { name: string; kind: string; durationSec: number; ease: string; props: Record<string, string | number | boolean>; code: string } }> = [
  {
    request: 'a title that rises in and settles, 1.5s',
    answer: {
      name: 'Rise Title',
      kind: 'title',
      durationSec: 1.5,
      ease: 'expo-out',
      props: { text: 'Your title' },
      code: `export default function RiseTitle({ t, seed, reducedMotion, props, h, ease, color }) {
  const inT = ease['expo-out'](Math.min(1, t / 0.6))
  const y = reducedMotion ? 0 : (1 - inT) * 24
  return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '640px', height: '240px' } },
    h('span', { style: { fontSize: 64, fontWeight: 800, color: color('text'), opacity: inT, transform: 'translateY(' + y + 'px)' } }, props.text || 'Your title'))
}`,
    },
  },
  {
    request: 'glitch-rgb title 2s',
    answer: {
      name: 'Glitch RGB Title',
      kind: 'title',
      durationSec: 2,
      ease: 'ease-out',
      props: { text: 'GLITCH' },
      code: `export default function GlitchRgbTitle({ t, seed, reducedMotion, props, h, mulberry32, ease, color }) {
  const text = props.text || 'GLITCH'
  const rand = mulberry32(seed + Math.floor(t * 24))
  const settle = 1 - ease['ease-out'](Math.min(1, t / 0.8))
  const burst = t < 0.8 ? settle : 0
  const jx = reducedMotion ? 0 : (rand() - 0.5) * 18 * burst
  const jy = reducedMotion ? 0 : (rand() - 0.5) * 6 * burst
  const split = reducedMotion ? 0 : 6 * burst
  const fade = Math.min(1, t / 0.15)
  const layer = (tone, dx, blend) => h('span', { style: { position: 'absolute', left: 0, top: 0, width: '100%', textAlign: 'center', fontSize: 72, fontWeight: 800, letterSpacing: '0.04em', color: color(tone), opacity: fade * (blend ? 0.85 : 1), mixBlendMode: blend ? 'screen' : 'normal', transform: 'translate(' + (jx + dx) + 'px,' + jy + 'px)' } }, text)
  return h('div', { style: { position: 'relative', width: '640px', height: '96px' } },
    layer('danger', -split, true),
    layer('info', split, true),
    layer('text', 0, false))
}`,
    },
  },
]
