/**
 * Windows install helpers, shared by `check-install-windows.mjs` and
 * `check-update-path.mjs`.
 *
 * Both scripts drive the real NSIS installer that electron-builder produced —
 * silent install into a throwaway directory, read the version Windows sees on
 * the installed executable, uninstall — so the two scripts cannot disagree
 * about what "installed" means. Everything here is Windows-only by design; the
 * callers fail hard on any other platform rather than pretending to pass.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const APP_EXE_NAME = 'NewBrand.exe'
export const UNINSTALLER_NAME = 'Uninstall NewBrand.exe'

/** Run a program, capture output, and never throw on a non-zero exit code. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options })
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error.message) : null,
  }
}

/** PowerShell one-liner, with the module path reset the way electron does it. */
export function powershell(command, options = {}) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], options)
}

/**
 * A throwaway install directory for the NSIS installer.
 *
 * NSIS accepts `/D=<path>` only as the final argument and only unquoted, so a
 * path with a space in it is unrepresentable. That is asserted here instead of
 * being left to fail mysteriously inside the installer.
 */
export function freshInstallDir(label) {
  const drive = process.env.SystemDrive || 'C:'
  const dir = `${drive}\\newbrand-${label}-${process.pid}`
  if (/\s/.test(dir)) throw new Error(`INSTALL_DIR_HAS_SPACE: "${dir}" cannot be passed to an NSIS /D= switch`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Silent install.
 *
 * The installer is spawned directly — deliberately NOT through `cmd /c`. The
 * first version of this helper built `"path" /S /D=<dir>` and handed it to
 * `cmd /d /s /c` through spawnSync; Node re-quotes that argument for
 * CreateProcess as `\"path\" /S /D=…`, cmd does not unescape backslash-quotes,
 * and it tried to execute a program literally named `"…\NewBrand-Setup-….exe"`
 * ('is not recognized as an internal or external command' — the first Windows
 * run of check:install died exactly there). Spawned directly, Node's argv
 * quoting is exactly what the NSIS bootstrap parses: the installer path may be
 * quoted, `/S` is a plain switch, and `/D=` stays the last, unquoted argument
 * (freshInstallDir asserts the value has no spaces, which is the one thing NSIS
 * cannot represent there).
 */
export function installSilently(installerPath, installDir) {
  if (!fs.existsSync(installerPath)) throw new Error(`INSTALLER_MISSING: ${installerPath}`)
  const result = run(installerPath, ['/S', `/D=${installDir}`], { timeout: 15 * 60 * 1000 })
  if (result.code !== 0) {
    throw new Error(`INSTALL_FAILED: installer exited ${result.code}${result.stderr ? ` — ${result.stderr.trim()}` : ''}`)
  }
  return result
}

export function uninstallSilently(installDir, uninstallerName = UNINSTALLER_NAME) {
  const uninstaller = path.join(installDir, uninstallerName)
  if (!fs.existsSync(uninstaller)) throw new Error(`UNINSTALLER_MISSING: ${uninstaller}`)
  // Exactly what the installer registered as `QuietUninstallString`:
  // `"Uninstall NewBrand.exe" /currentuser /S`. `/currentuser` is not cosmetic
  // — it is how the uninstaller resolves its shell context ($SMPROGRAMS, the
  // registry hive) for a per-user install, and without it the mode is inferred
  // instead of known. cwd = the install dir, the same thing a user
  // double-clicking "Uninstall NewBrand.exe" gets. The path contains spaces;
  // spawned directly that is one argv entry, where a cmd-built command line
  // would have split it.
  const result = run(uninstaller, ['/currentuser', '/S'], { timeout: 10 * 60 * 1000, cwd: installDir })
  if (result.code !== 0) {
    throw new Error(`UNINSTALL_FAILED: uninstaller exited ${result.code}${result.stderr ? ` — ${result.stderr.trim()}` : ''}`)
  }
  return result
}

/** Wait for a path to appear (or disappear), with a real deadline. */
export async function waitFor(predicate, { timeoutMs = 120_000, intervalMs = 1000, describe = 'the condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`TIMEOUT: waited ${Math.round(timeoutMs / 1000)}s for ${describe}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * The version string Windows itself reports for an executable.
 *
 * This is the check that ties an artifact to a version: `FileVersion` and
 * `ProductVersion` come from the PE resources electron-builder stamped, not
 * from anything the build script claimed afterwards.
 */
export function readFileVersion(exePath) {
  if (!fs.existsSync(exePath)) throw new Error(`EXE_MISSING: ${exePath}`)
  const result = powershell(
    `$i = (Get-Item -LiteralPath '${exePath.replace(/'/g, "''")}').VersionInfo; `
    + `[pscustomobject]@{ FileVersion = $i.FileVersion; ProductVersion = $i.ProductVersion; ProductName = $i.ProductName } | ConvertTo-Json -Compress`,
  )
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new Error(`VERSION_READ_FAILED: PowerShell exited ${result.code} ${result.stderr.trim()}`)
  }
  try {
    return JSON.parse(result.stdout.trim())
  } catch (err) {
    throw new Error(`VERSION_READ_FAILED: could not parse "${result.stdout.trim()}" (${err.message})`)
  }
}

/** Authenticode status of a file, as Windows sees it. */
export function authenticodeStatus(filePath) {
  const result = powershell(
    `$s = Get-AuthenticodeSignature -LiteralPath '${filePath.replace(/'/g, "''")}'; `
    + `[pscustomobject]@{ Status = "$($s.Status)"; Subject = "$($s.SignerCertificate.Subject)"; TimeStamper = "$($s.TimeStamperCertificate.Subject)" } | ConvertTo-Json -Compress`,
  )
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new Error(`SIGNATURE_READ_FAILED: PowerShell exited ${result.code} ${result.stderr.trim()}`)
  }
  return JSON.parse(result.stdout.trim())
}

/** Close a running app window politely, so its quit handlers (and updater) run. */
export function closeApp(processName = APP_EXE_NAME) {
  // No /F: taskkill sends WM_CLOSE, which is what a user clicking the X does.
  // /F would kill the process and skip the updater's install-on-quit path.
  return run('taskkill.exe', ['/IM', processName, '/T'], { timeout: 60_000 })
}

export function isRunning(processName = APP_EXE_NAME) {
  const result = run('tasklist.exe', ['/FI', `IMAGENAME eq ${processName}`, '/NH'])
  return result.stdout.toLowerCase().includes(processName.toLowerCase())
}

/** Launch a packaged/installed app detached, with an isolated userData dir. */
export function launchApp(exePath, { userDataDir, env = {} } = {}) {
  if (!fs.existsSync(exePath)) throw new Error(`EXE_MISSING: ${exePath}`)
  const child = spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...(userDataDir ? { NEWBRAND_USER_DATA_DIR: userDataDir } : {}), ...env },
  })
  child.unref()
  return child
}

/** The app's own log file for today, inside an isolated userData dir. */
export function logFilePath(userDataDir) {
  const name = `${new Date().toISOString().slice(0, 10)}.log`
  return path.join(userDataDir, 'logs', name)
}

/** Every log record written so far, oldest first. Never throws on a partial line. */
export function readLog(userDataDir) {
  const file = logFilePath(userDataDir)
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
  const records = []
  for (const line of lines) {
    try {
      records.push(JSON.parse(line))
    } catch {
      records.push({ kind: 'unparsed', message: line })
    }
  }
  return records
}

export function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `newbrand-${label}-`))
  return dir
}

/** A tiny static file server for an update feed. Real HTTP, one directory. */
export function serveDirectory(dir, { contentTypeFor = (file) => (file.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream') } = {}) {
  return import('node:http').then(({ createServer }) => new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '')
      const file = path.join(dir, name)
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404, { 'content-type': 'text/plain' })
        response.end(`not found: ${name}`)
        return
      }
      const stat = fs.statSync(file)
      response.writeHead(200, { 'content-length': stat.size, 'content-type': contentTypeFor(name) })
      fs.createReadStream(file).pipe(response)
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  }))
}
