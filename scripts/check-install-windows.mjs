#!/usr/bin/env node
/**
 * check:install — install, run, and uninstall the real Windows build.
 *
 * This is the acceptance test a release has to pass: the artifacts that are
 * about to be published are installed the way a user installs them, the
 * installed executable is asked for the version Windows sees on it, the
 * installed app is booted through every view (by the same harness that checks
 * the unpacked build), and then it is uninstalled and the leftovers are
 * checked.
 *
 * It is deliberately NOT part of `npm run build`: the check chain has to run on
 * a developer's machine and on any runner, and this one needs a packaged
 * Windows build with a signing certificate. It is wired into the release
 * workflow after packaging and before publishing, so a release cannot ship
 * installers nobody installed.
 *
 * What it asserts, in order:
 *   1. exactly one NSIS setup and one portable build exist in `release/`, named
 *      with the version `package.json` declares;
 *   2. the setup installs silently into a throwaway directory (exit 0);
 *   3. the installed `Cupric AI.exe` exists, and its PE `FileVersion` /
 *      `ProductVersion` equal the declared version — this is what ties the
 *      artifact to the version, rather than trusting the file name;
 *   4. the installed app carries `resources/app-update.yml` with a
 *      `publisherName`, which is the field that makes electron-updater verify
 *      the Authenticode signature of every future update. An unsigned build
 *      omits it, so this step is the fail-closed signature check on the
 *      installed app rather than on the file we just built;
 *   5. the installed app boots with zero uncaught errors on every view (delegated
 *      to `scripts/check-boot.mjs`, which is the harness that caught the 0.10.0
 *      white-screen regression);
 *   6. the uninstaller removes the installation, the Start Menu shortcut and
 *      its registry entry — a leftover registry key means the uninstall
 *      section stopped before its last step, which is also how a surviving
 *      shortcut is diagnosed; the leftover scan and the shortcut check poll
 *      until the set settles, so a file Windows holds for a second is not
 *      reported as debris;
 *   7. the portable build carries the same version as the installed one, and the
 *      same signature state as the installed executable (signed for a release;
 *      asserted *unsigned* under `--unsigned-build`, not skipped).
 *
 * Usage: npm run check:install                      (Windows only; needs `release/` built)
 *        npm run check:install -- --unsigned-build  (a build with no certificate)
 *
 * `--unsigned-build` exists because the signature assertions are the only part of
 * this check that cannot hold outside the release workflow: there is no
 * certificate on a pull request, and pretending otherwise would either fail every
 * PR or quietly skip the check. In that mode the assertions are inverted rather
 * than dropped — the build must be unsigned, and the updater must NOT claim a
 * publisher it cannot verify (an unsigned build with a publisherName would make
 * electron-updater accept any downloaded update as trusted). Everything else —
 * install, version on the installed exe, boot on every view, uninstall, no
 * leftovers, the portable build — is asserted exactly as it is for a release.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  APP_EXE_NAME,
  authenticodeStatus,
  closeApp,
  freshInstallDir,
  installSilently,
  isRunning,
  launchApp,
  powershell,
  readFileVersion,
  run,
  tempDir,
  uninstallSilently,
  waitFor,
} from './lib/windows-install.mjs'

const unsignedBuild = process.argv.includes('--unsigned-build')

/**
 * PE version resources are four-part (`0.16.0.0`); `package.json` is three-part
 * (`0.16.0`). The artifact must carry the declared version — that is the whole
 * point of reading the resource instead of trusting the file name — so accept
 * exactly the declared version or its four-part form with a zero build number,
 * and nothing else.
 */
const matchesDeclaredVersion = (reported, declared) => reported === declared || reported === `${declared}.0`

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version

const failures = []
let steps = 0
const step = (label, detail) => {
  steps += 1
  console.log(`  ${String(steps).padStart(2)}. ${label}${detail ? ` — ${detail}` : ''}`)
}
const fail = (code, message) => {
  failures.push(`${code}: ${message}`)
  console.error(`  ✗ ${code}: ${message}`)
}

if (process.platform !== 'win32') {
  console.error(
    [
      'check:install FAILED — this check runs the real Windows installer, so it only runs on Windows.',
      'It is not skipped anywhere: the release workflow runs it on windows-latest after packaging.',
      'A pass on another platform would be a claim nobody verified.',
    ].join('\n'),
  )
  process.exit(1)
}

console.log(`check:install — verifying the ${version} build in ${path.relative(root, releaseDir)}/`)

/* ── 1. the artifacts ───────────────────────────────────────────────────── */
const setupName = `Cupric-AI-Setup-${version}.exe`
const portableName = `Cupric-AI-${version}-x64-Portable.exe`
const setupPath = path.join(releaseDir, setupName)
const portablePath = path.join(releaseDir, portableName)
const setups = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir).filter((f) => /^Cupric-AI-Setup-.*\.exe$/.test(f)) : []
const portables = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir).filter((f) => /^Cupric-AI-.*-Portable\.exe$/.test(f)) : []

if (setups.length !== 1) fail('INSTALLER_MISSING', `expected exactly one setup in release/, found ${setups.length}: ${setups.join(', ') || 'none'}`)
else if (setups[0] !== setupName) fail('INSTALLER_VERSION_MISMATCH', `expected ${setupName}, found ${setups[0]}`)
else step('the setup installer exists', `${setupName} (${(fs.statSync(setupPath).size / 1024 / 1024).toFixed(1)} MB)`)

if (portables.length !== 1) fail('PORTABLE_MISSING', `expected exactly one portable build in release/, found ${portables.length}: ${portables.join(', ') || 'none'}`)
else if (portables[0] !== portableName) fail('PORTABLE_VERSION_MISMATCH', `expected ${portableName}, found ${portables[0]}`)
else step('the portable build exists', portableName)

if (failures.length) {
  console.error(`check:install FAILED — ${failures.join(' | ')}`)
  process.exit(1)
}

/* ── 2/3. install and read the version Windows sees ─────────────────────── */
let installDir = null
try {
  installDir = freshInstallDir('install-check')
  installSilently(setupPath, installDir)
  step('the installer ran silently', `into ${installDir} (exit 0)`)

  const exePath = path.join(installDir, APP_EXE_NAME)
  const info = readFileVersion(exePath)
  step('the installed executable exists', `${APP_EXE_NAME} (${(fs.statSync(exePath).size / 1024 / 1024).toFixed(1)} MB)`)
  const seen = [info.FileVersion, info.ProductVersion].filter(Boolean).map((v) => v.trim())
  if (!seen.length) fail('VERSION_MISSING', 'the installed executable carries no FileVersion/ProductVersion')
  else if (!seen.every((v) => matchesDeclaredVersion(v, version))) fail('VERSION_MISMATCH', `installed exe reports ${seen.join(' / ')}, package.json says ${version} (accepted: ${version} or its PE form ${version}.0)`)
  else step('the installed version matches package.json', `FileVersion ${info.FileVersion}${info.ProductVersion && info.ProductVersion !== info.FileVersion ? ` · ProductVersion ${info.ProductVersion}` : ''}`)

  /* ── the signature the updater will require ───────────────────────────── */
  const exeSignature = authenticodeStatus(exePath)
  if (unsignedBuild) {
    // Inverted, not skipped. An unsigned build is expected here — and it is
    // asserted, so a build that *is* signed when we think it is not is still a
    // surprise worth failing on.
    if (/Valid/.test(exeSignature.Status)) {
      fail('SIGNED_UNEXPECTEDLY', `this was expected to be an unsigned build, but the installed executable's Authenticode status is "Valid" (${exeSignature.Subject || 'no subject'}) — run the check without --unsigned-build`)
    } else {
      step('the build is unsigned, as this run expects', `Authenticode status "${exeSignature.Status}" — Windows SmartScreen will warn on install and the app cannot verify update signatures`)
    }
  } else if (!/Valid/.test(exeSignature.Status)) {
    fail('EXE_UNSIGNED', `the installed executable's Authenticode status is "${exeSignature.Status}"${exeSignature.Subject ? ` (${exeSignature.Subject})` : ''}`)
  } else if (!/CN=/.test(exeSignature.Subject || '')) {
    fail('EXE_PUBLISHER_UNKNOWN', `signed but with no CN in the signer subject: ${exeSignature.Subject}`)
  } else if (!exeSignature.TimeStamper) {
    fail('EXE_UNSTAMPED', 'the signature is not timestamped, so it stops verifying when the certificate expires and every installed app loses the ability to update')
  } else {
    step('the installed executable is signed and timestamped', `${exeSignature.Subject} · ${exeSignature.TimeStamper}`)
  }

  const updaterConfig = path.join(installDir, 'resources', 'app-update.yml')
  if (!fs.existsSync(updaterConfig) && unsignedBuild) {
    // electron-builder writes this file only for a packager build that carries
    // the update configuration; a certificate-less pull-request build may not.
    // Reported, not failed, and the difference matters: a build with no feed at
    // all cannot be tricked into installing anything, while a build that claims
    // a publisher it cannot verify is dangerous — that case is the failure below,
    // and it is checked whenever the file exists. Releases must have the file.
    step('the unsigned build carries no updater feed', `no ${path.relative(installDir, updaterConfig)} — nothing to verify, and the release workflow still requires it`)
  } else if (!fs.existsSync(updaterConfig)) {
    fail('APP_UPDATE_MISSING', `the installed app has no ${path.relative(installDir, updaterConfig)} — the updater would have no feed`)
  } else {
    const yaml = fs.readFileSync(updaterConfig, 'utf8')
    const publisher = yaml.match(/^publisherName:\s*(.+)$/m)
    if (!publisher && unsignedBuild) {
      // The fail-closed half of the signature rule, and it still applies: with no
      // valid signature there must be no publisher to verify against, or the
      // updater would trust anything.
      step('the updater makes no signature claim it cannot keep', 'app-update.yml has no publisherName, which is correct for an unsigned build')
    } else if (!publisher) {
      fail('PUBLISHER_NAME_MISSING', 'app-update.yml has no publisherName, so electron-updater accepts any downloaded update without verifying its signature')
    } else if (unsignedBuild) {
      fail('PUBLISHER_UNVERIFIABLE', `app-update.yml claims publisherName "${publisher[1].trim()}" on an unsigned build — electron-updater would check every update against a publisher this build cannot satisfy`)
    } else {
      step('the updater will verify update signatures', `publisherName: ${publisher[1].trim()}`)
      if (!exeSignature.Subject?.includes(publisher[1].trim().replace(/^['"]|['"]$/g, ''))) {
        fail('PUBLISHER_MISMATCH', `app-update.yml says ${publisher[1].trim()} but the executable is signed by ${exeSignature.Subject}`)
      }
    }
  }

  /* ── 4/5. the installed app boots ─────────────────────────────────────── */
  const boot = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-boot.mjs'), '--no-build'], {
    cwd: root,
    env: { ...process.env, CUPRIC_BOOT_EXE: exePath },
    encoding: 'utf8',
    timeout: 20 * 60 * 1000,
  })
  const bootTail = `${boot.stdout || ''}${boot.stderr || ''}`.trim().split(/\r?\n/).slice(-6).join('\n')
  if (boot.status !== 0) fail('BOOT_FAILED', `the installed app failed the boot check (exit ${boot.status})\n${bootTail}`)
  else step('the installed app booted every view', 'scripts/check-boot.mjs, zero uncaught errors')

  /* ── 6. uninstall ─────────────────────────────────────────────────────── */
  // The boot check above force-crashes routes and can leave windowless child
  // processes behind; `taskkill` without `/F` only closes windows and does not
  // reach them, and their loaded modules keep files busy while the uninstaller
  // walks the directory. Ask nicely, wait, and insist if the wait times out.
  closeApp()
  await waitFor(() => !isRunning(), { timeoutMs: 30_000, describe: 'the app to exit before uninstalling' }).catch(async () => {
    run('taskkill.exe', ['/F', '/IM', APP_EXE_NAME, '/T'])
    await waitFor(() => !isRunning(), { timeoutMs: 30_000, describe: 'the app to die after being force-killed' })
  })
  uninstallSilently(installDir)
  await waitFor(() => !fs.existsSync(path.join(installDir, APP_EXE_NAME)), { timeoutMs: 120_000, describe: 'the uninstaller to remove the executable' })

  // The uninstaller removes each file once, with no retry: anything Windows is
  // holding at that instant (a module a process has not released, Defender's
  // first scan of a freshly written file) survives and stays forever. Poll
  // before judging — the set is watched until it stops shrinking, and only the
  // stable remainder is reported.
  const settle = async (read, { timeoutMs = 60_000, stableMs = 10_000 } = {}) => {
    const deadline = Date.now() + timeoutMs
    let last = JSON.stringify(read())
    let stableSince = Date.now()
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const value = JSON.stringify(read())
      if (value !== last) {
        last = value
        stableSince = Date.now()
      } else if (Date.now() - stableSince >= stableMs) {
        return read()
      }
      if (Date.now() >= deadline) return read()
    }
  }

  let leftovers = fs.existsSync(installDir) ? fs.readdirSync(installDir) : []
  if (leftovers.length) {
    leftovers = await settle(() => (fs.existsSync(installDir) ? fs.readdirSync(installDir) : []))
  }
  if (leftovers.length) fail('UNINSTALL_LEFTOVERS', `the uninstall left ${leftovers.length} item(s) after settling: ${leftovers.slice(0, 8).join(', ')}`)
  else step('the uninstaller removed the installation', installDir)

  const shortcut = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Cupric AI.lnk')
  if (fs.existsSync(shortcut)) await settle(() => fs.existsSync(shortcut))
  if (fs.existsSync(shortcut)) fail('UNINSTALL_SHORTCUT_LEFT', `the Start Menu shortcut survived: ${shortcut}`)
  else step('the Start Menu shortcut is gone', 'no Cupric AI.lnk')

  // The registry entry is the uninstaller's own work (it is the last thing the
  // uninstall section does): if it survives, the section never reached its end,
  // which is also how a shortcut left behind is diagnosed — a gone registry key
  // with a live shortcut means Delete failed; a live key means the section
  // stopped early.
  const regLeft = powershell(
    `$k = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue `
    + `| Where-Object { $_.DisplayName -like 'Cupric AI*' }; if ($k) { $k.DisplayName }`,
  )
  const regNames = regLeft.stdout.trim()
  if (regNames) fail('UNINSTALL_REGISTRY_LEFTOVER', `the uninstall registry entry survived: ${regNames}`)
  else step('the uninstall registry entry is gone', 'no Cupric AI entry under HKCU Uninstall')

  /* ── 7. the portable build carries the same version ───────────────────── */
  const portableInfo = readFileVersion(portablePath)
  const portableSeen = [portableInfo.FileVersion, portableInfo.ProductVersion].filter(Boolean).map((v) => v.trim())
  if (!portableSeen.length) fail('PORTABLE_VERSION_MISSING', 'the portable executable carries no version resource')
  else if (!portableSeen.every((v) => matchesDeclaredVersion(v, version))) fail('PORTABLE_VERSION_MISMATCH', `portable reports ${portableSeen.join(' / ')}, package.json says ${version} (accepted: ${version} or its PE form ${version}.0)`)
  else step('the portable build reports the same version', portableSeen[0])

  const portableSignature = authenticodeStatus(portablePath)
  if (unsignedBuild) {
    // Same rule as the installed executable: asserted, inverted, not skipped.
    if (/Valid/.test(portableSignature.Status)) {
      fail('PORTABLE_SIGNED_UNEXPECTEDLY', `the portable build is signed (${portableSignature.Subject || 'no subject'}) but this run expects an unsigned build — run the check without --unsigned-build`)
    } else {
      step('the portable build is unsigned, as this run expects', `Authenticode status "${portableSignature.Status}"`)
    }
  } else if (!/Valid/.test(portableSignature.Status)) {
    fail('PORTABLE_UNSIGNED', `portable Authenticode status is "${portableSignature.Status}"`)
  } else {
    step('the portable build is signed', portableSignature.Subject || 'valid')
  }

  /* ── a real run of the portable build, from a temp directory ──────────── */
  const portableDir = tempDir('portable-check')
  const portableRun = spawnSync(portablePath, [], { env: { ...process.env, CUPRIC_USER_DATA_DIR: portableDir }, timeout: 90_000, encoding: 'utf8' })
  // The portable build is a self-extracting app: it runs until closed. A timeout
  // here means it started and stayed up, which is what "it runs" means for a GUI.
  const logFile = path.join(portableDir, 'logs')
  const wroteLog = fs.existsSync(logFile) && fs.readdirSync(logFile).some((f) => f.endsWith('.log'))
  if (!wroteLog) fail('PORTABLE_DID_NOT_START', `the portable build wrote no log into its userData dir (exit ${portableRun.status}${portableRun.error ? `, ${portableRun.error.message}` : ''})`)
  else step('the portable build started and logged', `${path.relative(root, logFile)}`)

  console.log(`\ncheck:install observed ${steps} real steps against ${setupName}`)
} catch (err) {
  fail(err?.code ?? 'CHECK_THREW', err?.message || String(err))
} finally {
  // Never leave a running app behind on a runner with a shared desktop.
  if (isRunning()) closeApp()
  await new Promise((resolve) => setTimeout(resolve, 2000))
  if (isRunning()) {
    console.error('  ! the app is still running after the check; killing it so the next check is not confused')
    run('taskkill.exe', ['/IM', APP_EXE_NAME, '/T', '/F'])
  }
}

if (failures.length) {
  console.error(`\ncheck:install FAILED\n  ${failures.join('\n  ')}`)
  // GitHub annotations, because the raw step log is not always reachable and a
  // failure nobody can read is a failure nobody can fix. One annotation per
  // failure code, so the first thing anyone sees is *which* assertion failed.
  for (const failure of failures) {
    const [code] = failure.split(':')
    console.error(`::error title=check:install ${code}::${failure.replace(/[%\r\n]/g, ' ')}`)
  }
  process.exit(1)
}
console.log('check:install passed — the published installers install, run, carry the right version and publisher, and uninstall cleanly')
