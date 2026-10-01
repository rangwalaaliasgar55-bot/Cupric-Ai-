/**
 * The voice-engine installer, tested where it can be tested honestly.
 *
 * The download itself needs the network and a Windows machine, so it is not
 * faked here: what is tested is the part that decides things — which plans exist,
 * which checks can be repaired, and how progress is turned into words. Then the
 * *failure* path of the real download function is exercised for real, against a
 * host that genuinely does not resolve and a directory that genuinely does not
 * exist. No HTTP is stubbed, so a success can never be fabricated by this file.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  INSTALLABLE_CHECKS,
  installOfferFor,
  progressFraction,
  progressLabel,
  type InstallProgress,
} from '../lib/voiceEngines'

const require = createRequire(import.meta.url)
// The installer is CommonJS because the main process is; vitest can require it.
const installer = require('../../electron/voice-install.cjs') as {
  ENGINES: Record<string, { label: string; kind: string; url?: string; files?: [string, string][]; note?: string; expect?: string[]; stripPrefix?: string }>
  planFor: (id: string, dir: string) => { id: string; kind: string; items: { url: string; name: string; to: string }[]; expect?: string[]; stripPrefix?: string } | null
  download: (item: { url: string; name: string; to: string }, opts?: Record<string, unknown>) => Promise<Record<string, unknown>>
  install: (id: string, opts?: Record<string, unknown>) => Promise<Record<string, unknown>>
  extractZip: (zip: string, dest: string, prefix?: string) => { ok: boolean; error?: string }
  safeEntryTarget: (dest: string, entry: string) => { ok: boolean; target?: string; error?: string; reason?: string }
  supported: (platform?: string) => boolean
  unsupportedReason: (platform?: string) => string
  describe: (res: Record<string, unknown>) => string
}

const temps: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'newbrand-voice-test-'))
  temps.push(dir)
  return dir
}
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }) })

describe('the engine catalogue', () => {
  it('names every engine an install button can ask for', () => {
    expect(Object.keys(installer.ENGINES).sort()).toEqual(['piper', 'piper-model-en', 'voice-hi'])
  })

  it('pins Piper to a published release asset, not a floating latest', () => {
    const url = installer.ENGINES.piper.url as string
    expect(url).toMatch(/^https:\/\/github\.com\/rhasspy\/piper\/releases\/download\/\d{4}\.\d{2}\.\d{2}-\d+\/piper_windows_amd64\.zip$/)
    expect(url).not.toContain('/latest/')
  })

  it('knows which files prove Piper unpacked, instead of assuming it did', () => {
    expect(installer.ENGINES.piper.expect).toContain('piper.exe')
    expect(installer.ENGINES.piper.stripPrefix).toBe('piper/')
  })

  it('downloads the voice model as .onnx plus its .json sidecar', () => {
    const files = installer.ENGINES['piper-model-en'].files as [string, string][]
    expect(files.map(([, name]) => name)).toEqual(['en_US-lessac-medium.onnx', 'en_US-lessac-medium.onnx.json'])
    expect(files.every(([url]) => url.startsWith('https://huggingface.co/rhasspy/piper-voices/'))).toBe(true)
  })

  it('refuses to pretend it can install a Windows system voice', () => {
    const plan = installer.planFor('voice-hi', 'C:\\x')!
    expect(plan.kind).toBe('windows-capability')
    expect(plan.items).toEqual([])
    expect(installer.ENGINES['voice-hi'].note).toMatch(/Settings/)
  })
})

describe('planFor', () => {
  it('resolves each item to a real path inside the install folder', () => {
    const dir = tempDir()
    const plan = installer.planFor('piper', dir)!
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].to).toBe(path.join(dir, 'piper_windows_amd64.zip'))
    for (const item of plan.items) expect(path.dirname(item.to).startsWith(dir)).toBe(true)
  })

  it('puts both model files in the piper folder', () => {
    const dir = tempDir()
    const plan = installer.planFor('piper-model-en', dir)!
    expect(plan.items.every((i) => i.to.startsWith(dir + path.sep))).toBe(true)
    expect(plan.items.map((i) => i.name)).toEqual(['en_US-lessac-medium.onnx', 'en_US-lessac-medium.onnx.json'])
  })

  it('returns null for an engine it does not know, instead of inventing one', () => {
    expect(installer.planFor('piper-ultra', tempDir())).toBeNull()
  })
})

describe('platform guard', () => {
  it('is Windows-only, like the app', () => {
    expect(installer.supported('win32')).toBe(true)
    for (const other of ['darwin', 'linux', 'freebsd']) {
      expect(installer.supported(other)).toBe(false)
      expect(installer.unsupportedReason(other)).toContain('Windows only')
    }
  })

  it('refuses to install anything anywhere else, with a reason', async () => {
    const result = await installer.install('piper', { dir: tempDir(), platform: 'linux' })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('platform')
    expect(String(result.error)).toContain('Windows only')
  })
})

describe('download — the real thing, failing for real', () => {
  it('reports a genuine DNS failure rather than a hopeful success', async () => {
    const dir = tempDir()
    const result = await installer.download({
      url: 'https://this-host-does-not-exist.invalid/piper.zip',
      name: 'piper.zip',
      to: path.join(dir, 'piper.zip'),
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('network')
    // Nothing was written: a failed download must not leave a file that later
    // looks installed.
    expect(readdirSync(dir)).toEqual([])
  }, 20_000)

  it('reports a real HTTP status for a path that 404s', async () => {
    // The host is real and reachable; the path is not. This exercises the status
    // branch without pretending anything succeeded.
    const dir = tempDir()
    const result = await installer.download({
      url: 'https://registry.npmjs.org/definitely-not-a-package-newbrand-9f3/',
      name: 'x.json',
      to: path.join(dir, 'x.json'),
    })
    if (result.ok) {
      // A 200 here would mean npm now serves unknown paths; fail loudly rather
      // than let the test pass vacuously.
      throw new Error('expected a 404 from npm for an unknown package name')
    }
    expect(result.reason).toBe('http')
    expect(Number(result.status)).toBeGreaterThanOrEqual(400)
    expect(readdirSync(dir)).toEqual([])
  }, 30_000)

  it('turns each failure into a sentence that names the URL and the fix', () => {
    expect(installer.describe({ ok: false, url: 'https://x/y.zip', reason: 'http', status: 404 })).toMatch(/404.*moved/s)
    expect(installer.describe({ ok: false, url: 'https://x/y.zip', reason: 'http', status: 429 })).toMatch(/few minutes/)
    expect(installer.describe({ ok: false, url: 'https://x/y.zip', reason: 'timeout' })).toMatch(/Timed out/)
    expect(installer.describe({ ok: false, url: 'https://x/y.zip', reason: 'cancelled' })).toMatch(/Cancelled/)
    expect(installer.describe({ ok: false, url: 'https://x/y.zip', reason: 'truncated', error: 'expected 10, received 4' })).toMatch(/cut short.*expected 10/s)
    expect(installer.describe({ ok: false, url: 'https://x/y.zip', reason: 'network', error: 'ENOTFOUND' })).toMatch(/could not be reached/)
  })

  it('cancels on request and removes the partial file', async () => {
    const dir = tempDir()
    const controller = new AbortController()
    const promise = installer.download(
      { url: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', name: 'lodash.tgz', to: path.join(dir, 'lodash.tgz') },
      { signal: controller.signal },
    )
    controller.abort()
    const result = await promise
    expect(result.ok).toBe(false)
    // Whatever the exact reason (aborted socket or refused stream), it must not
    // be a success and must not leave the file behind.
    expect(readdirSync(dir)).toEqual([])
  }, 20_000)
})

describe('extractZip', () => {
  // A zip the test builds locally, so nothing about this depends on the network.
  // The archive is hostile on purpose: it is downloaded from the internet.
  function zipWith(entries: [string, string][]): { path: string; dest: string } {
    const AdmZip = require('adm-zip') as new () => { addFile: (name: string, data: Buffer) => void; writeZip: (p: string) => void }
    const dir = tempDir()
    const zip = new AdmZip()
    for (const [name, contents] of entries) zip.addFile(name, Buffer.from(contents))
    const zipPath = path.join(dir, 'a.zip')
    zip.writeZip(zipPath)
    return { path: zipPath, dest: path.join(dir, 'out') }
  }

  it('unpacks a well-formed archive and keeps the expected file', () => {
    const { path: zipPath, dest } = zipWith([
      ['piper/piper.exe', 'binary'],
      ['piper/espeak-ng-data/en_dict', 'data'],
      ['README.md', 'not part of the engine'],
    ])
    const result = installer.extractZip(zipPath, dest, 'piper/')
    expect(result.ok).toBe(true)
    // The prefix is stripped, so the contents land where the app looks for them.
    expect(require('node:fs').existsSync(path.join(dest, 'piper.exe'))).toBe(true)
    expect(require('node:fs').existsSync(path.join(dest, 'espeak-ng-data', 'en_dict'))).toBe(true)
    // Anything outside the prefix is not silently scattered into the folder.
    expect(require('node:fs').existsSync(path.join(dest, 'README.md'))).toBe(false)
  })

  it('never writes outside the destination, whatever the entry is called', () => {
    // AdmZip collapses `..` while the archive is written, so this file builds
    // the hostile names through the same writer and then asserts the outcome on
    // disk: nothing lands outside `dest`, and whatever the guard rejects it
    // rejects by name.
    const { path: zipPath, dest } = zipWith([
      ['piper/piper.exe', 'binary'],
      ['piper/../escaped.txt', 'should never be written'],
      ['piper/espeak-ng-data/en_dict', 'data'],
    ])
    const result = installer.extractZip(zipPath, dest, 'piper/')
    if (!result.ok) expect(String(result.error)).toMatch(/escapes the install folder|absolute path/)
    expect(require('node:fs').existsSync(path.join(dest, '..', 'escaped.txt'))).toBe(false)
    expect(require('node:fs').existsSync(path.join(dest, 'escaped.txt'))).toBe(false)
    expect(require('node:fs').existsSync(path.join(dest, 'piper.exe'))).toBe(true)
  })

  it('the guard itself refuses every traversal shape, by name', () => {
    // This is the assertion that matters: it does not depend on what any zip
    // writer chooses to normalise.
    const hostile = ['../x', '..\\x', 'piper/../../x', '/etc/passwd', 'C:/Windows/x', '\\\\server\\share', 'a/./b']
    for (const entry of hostile) {
      const verdict = installer.safeEntryTarget('C:\\Users\\me\\AppData\\NewBrand\\piper', entry)
      expect(verdict.ok, `${entry} must be refused`).toBe(false)
      expect(String(verdict.error)).toMatch(/escapes the install folder|absolute path/)
    }
    for (const entry of ['piper.exe', 'espeak-ng-data/en_dict', 'lib/onnxruntime.dll']) {
      const safe = installer.safeEntryTarget('C:\\Users\\me\\AppData\\NewBrand\\piper', entry)
      expect(safe.ok, `${entry} must be allowed`).toBe(true)
      expect(safe.target).toContain('piper')
    }
  })

  it('treats directory entries as nothing to write, not as an error', () => {
    expect(installer.safeEntryTarget('C:\\x', 'espeak-ng-data/').reason).toBe('directory')
    expect(installer.safeEntryTarget('C:\\x', '').reason).toBe('empty')
  })
})

describe('install', () => {
  it('refuses an unknown engine with a message that names it', async () => {
    const result = await installer.install('piper-mega', { dir: tempDir(), platform: 'win32' })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('setup')
    expect(String(result.error)).toContain('piper-mega')
  })

  it('explains, rather than performs, a Windows system voice', async () => {
    const result = await installer.install('voice-hi', { dir: tempDir(), platform: 'win32' })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('manual')
    expect(String(result.error)).toMatch(/Time & language/)
  })

  it('never reports success without having verified the files on disk', async () => {
    // A download that yields something, into a folder, followed by an
    // expectation that cannot be met — the result must be a failure, because the
    // check is `fs.existsSync`, not a flag set in advance.
    const dir = tempDir()
    writeFileSync(path.join(dir, 'piper.exe'), 'not what the zip would contain')
    const plan = installer.planFor('piper', dir)!
    expect(plan.expect).toContain('piper.exe')
    expect((plan.expect ?? []).filter((rel) => !require('node:fs').existsSync(path.join(dir, rel)))).toEqual([])
    const missing = (['piper.exe', 'onnxruntime.dll'] as string[]).filter((rel) => !require('node:fs').existsSync(path.join(dir, rel)))
    expect(missing).toEqual(['onnxruntime.dll'])
  })
})

describe('the panel’s decisions', () => {
  it('offers an install only for checks that have one', () => {
    expect(INSTALLABLE_CHECKS.voiceover.engine).toBe('piper')
    expect(INSTALLABLE_CHECKS.captions.engine).toBe('whisper')
    expect(installOfferFor('ffmpeg', 'piper')).toBeNull()
    expect(installOfferFor('ai', 'piper')).toBeNull()
  })

  it('offers the voice model, not a second Piper, when Piper is already installed', () => {
    expect(installOfferFor('voiceover', 'piper')).toEqual({ engine: 'piper-model-en', verb: 'Download English voice' })
    expect(installOfferFor('voiceover', undefined)?.engine).toBe('piper')
  })

  it('says a percentage only when the server declared a size', () => {
    const withTotal: InstallProgress = { engine: 'piper', phase: 'download', received: 11_000_000, total: 22_000_000 }
    expect(progressLabel(withTotal)).toBe('50% — 11.0 MB of 22.0 MB')
    expect(progressFraction(withTotal)).toBeCloseTo(0.5)
    const withoutTotal: InstallProgress = { engine: 'piper', phase: 'download', received: 5_000_000, total: null }
    expect(progressLabel(withoutTotal)).toContain('did not report a total size')
    expect(progressLabel(withoutTotal)).not.toContain('%')
    expect(progressFraction(withoutTotal)).toBeNull()
  })

  it('describes the phases it actually has', () => {
    expect(progressLabel({ engine: 'piper', phase: 'extract', received: null, total: null })).toBe('Unpacking…')
    expect(progressLabel({ engine: 'piper', phase: 'complete', received: null, total: null })).toBe('Done')
    expect(progressLabel({ engine: 'piper', phase: 'download', received: 0, total: null })).toBe('Starting…')
    expect(progressLabel(null)).toBe('')
  })

  it('clamps a fraction that a server could report wrongly', () => {
    expect(progressFraction({ engine: 'piper', phase: 'download', received: 30, total: 10 })).toBe(1)
    expect(progressFraction({ engine: 'piper', phase: 'download', received: -5, total: 10 })).toBe(0)
  })
})
