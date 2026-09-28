// Live acceptance for the shared record length (run against `npx vite preview --port 4173`).
// Needs playwright-core + a Chromium; see the header of /tmp/pw/t3.mjs in the session for the sandbox launcher.

import { chromium } from 'playwright-core'
const launch = () => chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
const b = await launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []; p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push('PAGE '+e.message))
const clips = () => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('northframe-v1')); const pr = s.state.projects.find(x => x.id === s.state.activeProjectId) ?? s.state.projects[0]; return { clips: (pr.studio?.clips ?? []).map(c => `${c.name}:${c.durationSec}s@${c.startSec}`), shelf: (pr.studio?.shelf ?? []).map(c => `${c.name}:${c.durationSec}s`) } })
const idle = async () => { await p.waitForTimeout(800); await p.locator('[role=dialog][aria-label^="Recording"]').waitFor({ state: 'detached', timeout: 90000 }).catch(() => {}); await p.waitForTimeout(500) }
const step = async (name, fn) => { try { await fn(); console.log('✓', name, JSON.stringify(await clips())) } catch (e) { console.log('✗', name, e.message.split('\n')[0]); await p.screenshot({ path: `/home/user/fail-${name.replace(/\W+/g,'_')}.png` }) } }
await p.goto('http://localhost:4173/'); await p.waitForTimeout(1500)
await p.getByRole('button', { name: 'New project' }).first().click(); await p.waitForTimeout(800)
await p.getByRole('button', { name: 'Studio', exact: true }).click(); await p.waitForTimeout(1200)
await step('panel 1s Add Like', async () => {
  await p.getByRole('button', { name: 'Components' }).click(); await p.waitForTimeout(600)
  await p.getByPlaceholder('Search components…').fill('like'); await p.waitForTimeout(600)
  await p.getByText(/^Like button$/i).first().click(); await p.waitForTimeout(600)
  await p.getByLabel('Recording length in seconds').fill('1')
  await p.getByLabel(/^Add Like button to the timelin/).click(); await idle()
  if (/A still/.test(await p.locator('body').innerText())) throw new Error('recorded as a still')
})
await step('Library Apply Odometer', async () => {
  await p.getByRole('button', { name: 'Resources' }).click(); await p.waitForTimeout(1200)
  await p.locator('select').filter({ hasText: 'Lab components' }).first().selectOption('components'); await p.waitForTimeout(1500)
  await p.getByLabel('Search pack').fill('odometer'); await p.waitForTimeout(1500)
  await p.locator('button[aria-label$=": Odometer"]').first().click(); await idle()
})
await step('Lab send to Studio', async () => {
  await p.getByRole('button', { name: 'UI Lab', exact: true }).click(); await p.waitForTimeout(1500)
  await p.getByLabel('Open Hold to delete').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
  await p.getByRole('button', { name: /Add animated to Studio/ }).click(); await idle()
})
await step('Record only → shelf → Place', async () => {
  await p.getByRole('button', { name: 'Studio', exact: true }).click(); await p.waitForTimeout(1200)
  if (!(await p.getByPlaceholder('Search components…').isVisible())) { await p.getByRole('button', { name: 'Components' }).click(); await p.waitForTimeout(600) }
  await p.getByPlaceholder('Search components…').fill('like'); await p.waitForTimeout(600)
  await p.getByText(/^Like button$/i).first().click(); await p.waitForTimeout(600)
  console.log('  panel length now', await p.getByLabel('Recording length in seconds').inputValue())
  await p.getByLabel(/^Record Like button to the shel/).click(); await idle()
  const shelfText = (await p.locator('body').innerText()).match(/\d+(\.\d+)?s\s*·\s*\d+\s*frames?/g); console.log('  shelf shows', shelfText)
  await p.locator('button[aria-label^="Place "]:not([disabled])').first().click(); await p.waitForTimeout(1000)
})
await step('inspector re-record 0.5 → panel shows 0.5', async () => {
  await p.locator('[aria-label^="Like button"], [role=button]:has-text("Like button")').first().click().catch(() => {})
  const f = p.getByLabel('Record length in seconds'); await f.fill('0.5'); await f.press('Enter'); await idle()
  const v = await p.getByLabel('Recording length in seconds').inputValue(); console.log('  panel length after inspector', v)
  if (v !== '0.5') throw new Error('panel did not sync: ' + v)
})
await p.screenshot({ path: '/home/user/acc-final.png' })
console.log('CONSOLE ERRORS', errs.length, errs.slice(0, 5)); await b.close()
