// Libraries.dev area: exactly the 7 libraries from the installed skill, a
// read-only review that re-generates identically, and UI wiring.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')
const status = () => execFileSync('git', ['status', '--porcelain', '--', 'src', 'electron'], { encoding: 'utf8' })
const before = status()
execFileSync(process.execPath, ['scripts/libraries-review.mjs'], { encoding: 'utf8' })
ok(status() === before, 'libraries review is read-only (no src/electron changes)')
const r = JSON.parse(read('resources/libraries-dev/review.json'))
const pk = r.libraries.map((l) => l.package).sort().join(',')
ok(pk === 'border-beam,bot-avatars,img-fx,liquid-gooey,metal-fx,thinking-orbs,voice-glow', `exactly the 7 skill libraries (${pk})`)
ok(r.libraries.every((l) => l.license === 'MIT' && l.version && l.homepage), 'every library has licence, version and source')
ok(r.findings.length > 0 && r.findings.every((f) => f.file && f.target && f.suggestedLibrary && f.why && f.risks && f.status), 'findings carry file/target/library/why/risk/status')
ok(r.findings.some((f) => f.status === 'applied' && f.package === 'thinking-orbs'), 'the live ThinkingOrb placement is reported as applied')
ok(r.findings.some((f) => f.status === 'no-fit'), 'review also says where NOT to add an effect')
const ui = read('src/screens/library/LibrariesDev.tsx')
ok(/<LibrariesDev \/>/.test(read('src/screens/Library.tsx')), 'Libraries tab mounted in Library')
ok(/libraries review/.test(ui) && /libraries \$\{t\}/.test(ui) && !/ipc|invoke\(|exec/.test(ui), 'UI exposes review/apply without any shell/IPC install path')
console.log(`libraries-dev: ${n} assertions passed`)
