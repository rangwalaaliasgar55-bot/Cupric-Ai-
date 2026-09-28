// Live acceptance for JOB 1/2/4 on a FRESH browser profile (no keys, no local
// servers). Run against `npx vite preview --port 4173` with CHROME_PATH set.
// Electron cannot run in CI/sandbox, so a MOCKED bridge stands in for the main
// process: it answers agent:generateAnimation with the project-original
// few-shot (as the keyless brain would), serves a model list with NEW/retired
// rows, and emits ai:notice events. Everything else is the real built app.
import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }) // fresh profile
const p = await ctx.newPage()
const errs = []; p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', (e) => errs.push('PAGE ' + e.message))
await p.addInitScript(() => {
  const listeners = {}
  const calls = []
  const glitch = `export default function GlitchRgbTitle({ t, seed, reducedMotion, props, h, mulberry32, ease, color }) {
  const text = props.text || 'GLITCH'
  const rand = mulberry32(seed + Math.floor(t * 24))
  const settle = 1 - ease['ease-out'](Math.min(1, t / 0.8))
  const burst = t < 0.8 ? settle : 0
  const jx = reducedMotion ? 0 : (rand() - 0.5) * 18 * burst
  const jy = reducedMotion ? 0 : (rand() - 0.5) * 6 * burst
  const split = reducedMotion ? 0 : 6 * burst
  const fade = Math.min(1, t / 0.15)
  const layer = (tone, dx, blend) => h('span', { style: { position: 'absolute', left: 0, top: 0, width: '100%', textAlign: 'center', fontSize: 72, fontWeight: 800, color: color(tone), opacity: fade, mixBlendMode: blend ? 'screen' : 'normal', transform: 'translate(' + (jx + dx) + 'px,' + jy + 'px)' } }, text)
  return h('div', { style: { position: 'relative', width: '640px', height: '96px' } }, layer('danger', -split, true), layer('info', split, true), layer('text', 0, false))
}`
  const ipc = Object.freeze({
    invoke: async (channel, payload) => {
      calls.push(channel)
      if (channel === 'state:save') { window.__saved = payload; return { ok: true } }
      if (channel === 'agent:generateAnimation') return { name: 'Glitch RGB Title', kind: 'title', ease: 'ease-out', props: { text: 'CUPRIC' }, code: glitch, durationSec: payload.durationSec, route: 'LLM7 free · default (mock)' }
      if (channel === 'agent:saveGenerated') return { ok: true, file: 'src/lab/generated/' + payload.slug + '.tsx' }
      if (channel === 'ai:freeModels') return { fetchedAt: 1, models: [
        { id: 'default', source: 'llm7', kind: 'keyless', badge: 'FREE', isNew: false, retired: false },
        { id: 'meta/muse-spark-2.0:free', source: 'openrouter', kind: 'user', badge: 'FREE', isNew: true, retired: false },
        { id: 'qwen/qwen3-old:free', source: 'openrouter', kind: 'user', badge: 'FREE', isNew: false, retired: true },
        { id: 'openai/gpt-5', source: 'openrouter', kind: 'user', badge: 'paid', isNew: false, retired: false },
      ] }
      if (channel === 'settings:get') return { aiMode: 'auto', autoPick: { kind: 'keyless', label: 'LLM7 free · built in', reason: 'Built-in free brain — no key or setup needed.' }, setupRequired: false, statusDots: {} }
      if (channel === 'ai:autoDiscover') return { pick: { kind: 'keyless', label: 'LLM7 free · built in', reason: 'Built-in free brain — no key or setup needed.' }, setupRequired: false }
      return null
    },
    on: (channel, cb) => { (listeners[channel] ||= []).push(cb); return () => { listeners[channel] = listeners[channel].filter((x) => x !== cb) } },
  })
  Object.defineProperty(window, 'cupric', { value: Object.freeze({ isDesktop: false, platform: 'linux', versions: {}, ipc, filePathFor: () => null, paths: {} }), writable: false })
  window.__mockEmit = (channel, payload) => (listeners[channel] || []).forEach((cb) => cb(payload))
  window.__mockCalls = calls
})
const results = []
const step = async (name, fn) => { try { const note = await fn(); results.push(['✓', name, note ?? '']); console.log('✓', name, note ?? '') } catch (e) { results.push(['✗', name]); console.log('✗', name, e.message.split('\n')[0]); await p.screenshot({ path: `/home/user/fail-${name.replace(/\W+/g, '_')}.png` }) } }
const idle = async () => { await p.waitForTimeout(800); await p.locator('[role=dialog][aria-label^="Recording"]').waitFor({ state: 'detached', timeout: 90000 }).catch(() => {}); await p.waitForTimeout(500) }
const clips = () => p.evaluate(() => { let s = window.__saved?.value ?? window.__saved; if (typeof s === 'string') s = JSON.parse(s); if (s && !s.state) s = { state: s.state ?? s }; if (!s?.state?.projects) return []; const pr = s.state.projects.find((x) => x.id === s.state.activeProjectId) ?? s.state.projects[0]; return (pr.studio?.clips ?? []).map((c) => ({ name: c.name, d: c.durationSec, frames: c.frames?.length ?? 0, gen: c.component?.generated?.source, rec: c.component?.recordSec, status: c.component?.status })) })

await p.goto('http://localhost:4173/'); await p.waitForTimeout(2000)
await step('fresh install: no setup screen, no dialog', async () => {
  const dialogs = await p.locator('[role=dialog], [role=alertdialog]').count()
  const body = await p.locator('body').innerText()
  if (dialogs) throw new Error(`${dialogs} dialog(s) on first launch`)
  if (/enter (your )?api key|setup required|choose a provider|\bSETUP\b|configured in settings/.test(body)) throw new Error('setup copy on first launch')
  return 'dialogs=0'
})
await step('inline "free brain busy, retrying" (not a dialog)', async () => {
  await p.evaluate(() => window.__mockEmit('ai:notice', { text: 'free brain busy, retrying', kind: 'inline' }))
  await p.getByRole('status').filter({ hasText: 'free brain busy, retrying' }).waitFor({ timeout: 3000 })
  if (await p.locator('[role=dialog]').count()) throw new Error('dialog shown')
})
await step('toast "local brain found, switched"', async () => {
  await p.evaluate(() => window.__mockEmit('ai:notice', { text: 'local brain found, switched to Ollama', kind: 'toast' }))
  await p.getByText('local brain found, switched to Ollama').waitFor({ timeout: 3000 })
})
await step('inline "offline brain"', async () => {
  await p.evaluate(() => window.__mockEmit('ai:notice', { text: 'offline brain', kind: 'inline' }))
  await p.getByRole('status').filter({ hasText: 'offline brain' }).waitFor({ timeout: 3000 })
})
await step('model list: NEW badge, retired greyed, Free only toggle', async () => {
  const ask = p.getByRole('button', { name: /^Ask/ }).first()
  if (await ask.isVisible().catch(() => false)) await ask.click()
  await p.getByLabel('AI settings').click(); await p.waitForTimeout(600)
  const box = p.getByTestId('free-models'); await box.waitFor({ timeout: 4000 })
  const t1 = await box.innerText()
  if (!/NEW/.test(t1) || !/muse-spark-2\.0/.test(t1) || !/retired/.test(t1)) throw new Error('badges missing: ' + t1)
  if (/gpt-5/.test(t1)) throw new Error('Free only should hide paid by default')
  await box.getByLabel('Free only').uncheck(); if (!/gpt-5/.test(await box.innerText())) throw new Error('toggle did not show paid')
  await box.getByLabel('Free only').check()
  await p.getByLabel('AI settings').click()
  await p.getByLabel('Close panel').click().catch(() => {})
  return 'NEW + retired + FREE/paid'
})
await p.getByRole('button', { name: 'New project' }).first().click(); await p.waitForTimeout(800)
await p.getByRole('button', { name: 'Studio', exact: true }).click(); await p.waitForTimeout(1500)
const box = p.getByPlaceholder(/How do you want this edit to feel/)
await step('"use Date.now" → rejected quoting the rule', async () => {
  await box.fill('glitch title 2s but use Date.now for the jitter'); await box.press('Enter'); await p.waitForTimeout(1200)
  await p.getByText(/rule “only-t”: Motion must be a pure function of t/).first().waitFor({ timeout: 4000 })
  if ((await clips()).length) throw new Error('something was added')
})
await step('"glitch-rgb title 2s" → preview diff → Accept → 2s recorded clip', async () => {
  await box.fill('glitch-rgb title 2s'); await box.press('Enter')
  await p.getByText(/Write a new “Glitch RGB Title” title animation \(2s, agent-generated, validated\)/).waitFor({ timeout: 8000 })
  await p.getByRole('button', { name: 'Accept all' }).click(); await idle()
  const c = await clips()
  const g = c.find((x) => x.gen === 'agent-generated')
  if (!g || g.d !== 2 || g.rec !== 2 || g.status !== 'ready' || g.frames < 12) throw new Error(JSON.stringify(c))
  const saved = await p.evaluate(() => window.__mockCalls.includes('agent:saveGenerated'))
  if (!saved) throw new Error('file save not requested')
  return `${g.name} ${g.d}s · ${g.frames} frames · saveGenerated requested`
})
await step('badge + re-record at a new length', async () => {
  await p.getByText('Glitch RGB Title').first().click().catch(() => {})
  const f = p.getByLabel('Record length in seconds'); await f.fill('3'); await f.press('Enter'); await idle()
  const g = (await clips()).find((x) => x.gen === 'agent-generated')
  if (!g || g.rec !== 3 || g.status !== 'ready') throw new Error(JSON.stringify(g))
  return `re-recorded ${g.rec}s · ${g.frames} frames`
})
await step('full undo removes the animation', async () => {
  await p.locator('main').click({ position: { x: 5, y: 5 } }).catch(() => {})
  for (let i = 0; i < 6 && (await clips()).some((x) => x.gen); i += 1) { await p.keyboard.press('Control+z'); await p.waitForTimeout(500) }
  if ((await clips()).some((x) => x.gen)) throw new Error('still present after undo')
})
await p.screenshot({ path: '/home/user/acc-zero-setup.png' })
console.log('CONSOLE ERRORS', errs.length, errs.slice(0, 6))
console.log('IPC CALLS', [...new Set(await p.evaluate(() => window.__mockCalls))].join(','))
await b.close()
process.exit(results.some((r) => r[0] === '✗') || errs.length ? 1 : 0)
