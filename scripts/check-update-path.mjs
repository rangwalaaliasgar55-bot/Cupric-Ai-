#!/usr/bin/env node
/**
 * check:update-path — a real version-to-version update, end to end.
 *
 * An updater is the one feature whose failures cannot be seen in a build log:
 * the code is right, the feed is wrong, and every existing install is stuck
 * forever. This runs the actual machinery instead of trusting it:
 *
 *   1. the OLD installer is installed silently into a throwaway directory, and
 *      the version Windows reports on the installed executable is read back;
 *   2. the NEW release directory (a real electron-builder output, with its
 *      `latest.yml`) is served over real HTTP from 127.0.0.1;
 *   3. the installed OLD app is launched with `NEWBRAND_UPDATE_FEED` pointing at
 *      that server and an isolated userData directory;
 *   4. the app's own log is watched until it records `updater-downloaded` — the
 *      moment the update exists on disk and is installable, which is the only
 *      honest signal that a download finished;
 *   5. the app is closed politely (no /F), which is what triggers
 *      `quitAndInstall` on quit;
 *   6. the installed executable is polled until Windows reports the NEW version
 *      on it, and the app's log is required to record a fresh `app-start` for
 *      that version — the app really came back up as the new release;
 *   7. the new installation is uninstalled and the feed server shut down.
 *
 * Usage:
 *   node scripts/check-update-path.mjs --from release/NewBrand-Setup-0.13.0.exe \
 *                                      --to release-next/
 *
 * Windows only, on purpose: it installs and launches the real product. On any
 * other platform it fails rather than reporting a pass nobody earned.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  closeApp,
  freshInstallDir,
  installSilently,
  isRunning,
  launchApp,
  readFileVersion,
  readLog,
  serveDirectory,
  tempDir,
  uninstallSilently,
  waitFor,
} from './lib/windows-install.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : null
}

const failures = []
const fail = (code, message) => {
  failures.push(`${code}: ${message}`)
  console.error(`  ✗ ${code}: ${message}`)
}
let steps = 0
const step = (label, detail) => {
  steps += 1
  console.log(`  ${String(steps).padStart(2)}. ${label}${detail ? ` — ${detail}` : ''}`)
}

if (process.platform !== 'win32') {
  console.error(
    [
      'check:update-path FAILED — this test installs and updates the real Windows app, so it only runs on Windows.',
      'It is not skipped anywhere: .github/workflows/update-path.yml runs it on windows-latest.',
    ].join('\n'),
  )
  process.exit(1)
}

const fromInstaller = arg('from') ? path.resolve(root, arg('from')) : null
const toDir = arg('to') ? path.resolve(root, arg('to')) : null
const timeoutSeconds = Number(arg('timeout') || 420)

if (!fromInstaller || !toDir) {
  console.error('usage: node scripts/check-update-path.mjs --from <old setup exe> --to <new release directory>')
  process.exit(1)
}

const oldVersionFromName = path.basename(fromInstaller).match(/(?:NewBrand|Cupric-AI)-Setup-(.+)\.exe$/)?.[1] ?? null
const latestYml = path.join(toDir, 'latest.yml')
if (!fs.existsSync(fromInstaller)) {
  fail('FROM_MISSING', `no installer at ${fromInstaller}`)
}
if (!fs.existsSync(latestYml)) {
  fail('FEED_MISSING', `no latest.yml in ${toDir} — electron-builder writes it next to the installer`)
}
if (!oldVersionFromName) {
  fail('FROM_NAME_UNREADABLE', `cannot read a version out of ${path.basename(fromInstaller)}`)
}
if (failures.length) {
  console.error(`check:update-path FAILED — ${failures.join(' | ')}`)
  process.exit(1)
}

const feed = fs.readFileSync(latestYml, 'utf8')
const newVersion = feed.match(/^version:\s*(.+)$/m)?.[1]?.trim()
const feedFile = feed.match(/^path:\s*(.+)$/m)?.[1]?.trim()
if (!newVersion) fail('FEED_VERSION_MISSING', 'latest.yml has no version field')
if (!feedFile) fail('FEED_FILE_MISSING', 'latest.yml has no path field')
if (newVersion && oldVersionFromName && newVersion === oldVersionFromName) {
  fail('VERSION_NOT_NEWER', `the feed offers ${newVersion}, the same version as the installed build`)
}
if (feedFile && !fs.existsSync(path.join(toDir, feedFile))) {
  fail('FEED_PAYLOAD_MISSING', `latest.yml points at ${feedFile}, which is not in ${toDir}`)
}
if (failures.length) {
  console.error(`check:update-path FAILED — ${failures.join(' | ')}`)
  process.exit(1)
}

console.log(`check:update-path — updating ${oldVersionFromName} → ${newVersion} through the real updater`)

const EXE_NAMES = ['NewBrand.exe', 'Cupric AI.exe']
const UNINSTALLER_NAMES = ['Uninstall NewBrand.exe', 'Uninstall Cupric AI.exe']
/**
 * A product rename must still update existing installs. Before NewBrand, the
 * installer and process were named Cupric AI; after the update they are named
 * NewBrand. Resolve the executable from disk on every read so this test covers
 * that migration rather than assuming either side of the rename.
 */
function installedExe(installDir) {
  return EXE_NAMES.map((name) => path.join(installDir, name)).find((file) => fs.existsSync(file)) ?? null
}
function installedUninstaller(installDir) {
  return UNINSTALLER_NAMES.find((name) => fs.existsSync(path.join(installDir, name))) ?? null
}

let installDir = null
let feedServer = null
try {
  /* ── 1. install the old build ─────────────────────────────────────────── */
  installDir = freshInstallDir('update-path')
  installSilently(fromInstaller, installDir)
  const oldExePath = installedExe(installDir)
  if (!oldExePath) throw new Error(`EXE_MISSING: expected one of ${EXE_NAMES.join(', ')} in ${installDir}`)
  const versionNow = () => {
    try {
      const exePath = installedExe(installDir)
      if (!exePath) return null // mid-update, momentarily absent
      const info = readFileVersion(exePath)
      return (info.FileVersion || info.ProductVersion || '').trim()
    } catch (err) {
      if (/EXE_MISSING/.test(String(err?.message))) return null // mid-update, momentarily absent
      throw err
    }
  }
  if (versionNow() !== oldVersionFromName) {
    fail('INSTALL_VERSION_MISMATCH', `installed executable reports ${versionNow()}, installer name says ${oldVersionFromName}`)
    throw new Error('installed version does not match the installer')
  }
  step('installed the old build', `${oldVersionFromName} into ${installDir}`)

  /* ── 2. serve the new release ─────────────────────────────────────────── */
  const served = await serveDirectory(toDir)
  feedServer = served.server
  step('served the new release over HTTP', `http://127.0.0.1:${served.port}/latest.yml (${feedFile})`)

  /* ── 3. launch the old app against that feed ──────────────────────────── */
  const userData = tempDir('update-path-data')
  launchApp(oldExePath, {
    userDataDir: userData,
    // The installed release may predate the namespace rename. Supply both
    // names so the old process receives the test feed and writes its log to
    // this isolated profile; current builds use the NEWBRAND names.
    env: {
      NEWBRAND_USER_DATA_DIR: userData,
      CUPRIC_USER_DATA_DIR: userData,
      NEWBRAND_UPDATE_FEED: `http://127.0.0.1:${served.port}`,
      CUPRIC_UPDATE_FEED: `http://127.0.0.1:${served.port}`,
    },
  })
  const oldProcessName = path.basename(oldExePath)
  await waitFor(() => isRunning(oldProcessName), { timeoutMs: 60_000, describe: 'the app to start' })
  step('launched the installed app', `userData ${userData}`)

  const kinds = () => readLog(userData).map((record) => record.kind)
  const recordFor = (kind) => readLog(userData).find((record) => record.kind === kind)

  /* ── 4. the update must be offered, then really downloaded ────────────── */
  await waitFor(() => kinds().includes('updater-available') || kinds().includes('updater-error') || kinds().includes('updater-current'), {
    timeoutMs: timeoutSeconds * 1000,
    describe: 'the updater to decide about the offer',
  })
  const decision = recordFor('updater-error') ?? recordFor('updater-current') ?? recordFor('updater-available')
  if (decision.kind === 'updater-error') {
    fail('UPDATE_ERROR', `the updater failed: ${decision.message}`)
    throw new Error('updater error')
  }
  if (decision.kind === 'updater-current') {
    fail('UPDATE_NOT_OFFERED', `the feed offers ${newVersion} but the app reported it is already current (${decision.message})`)
    throw new Error('update not offered')
  }
  const offered = (decision.message || '').match(newVersion)
  if (!offered) fail('UPDATE_WRONG_VERSION', `the updater announced "${decision.message}" instead of ${newVersion}`)
  step('the updater saw the new version', decision.message)

  await waitFor(() => kinds().includes('updater-downloaded') || kinds().includes('updater-error'), {
    timeoutMs: timeoutSeconds * 1000,
    describe: 'the update to finish downloading',
  })
  const download = recordFor('updater-downloaded')
  if (!download) {
    const error = recordFor('updater-error')
    fail('UPDATE_NOT_DOWNLOADED', `the download did not complete${error ? `: ${error.message}` : ''}`)
    throw new Error('download failed')
  }
  step('downloaded the update', `${download.message}${download.extra?.file ? ` (${download.extra.file})` : ''}`)

  const publisherName = fs.existsSync(path.join(installDir, 'resources', 'app-update.yml'))
    ? fs.readFileSync(path.join(installDir, 'resources', 'app-update.yml'), 'utf8').match(/^publisherName:\s*(.+)$/m)?.[1]?.trim()
    : null
  console.log(
    publisherName
      ? `     note: this build pins publisherName ${publisherName}, so the updater verified the downloaded installer's Authenticode signature`
      : '     note: this build has no publisherName, so the updater did not verify the downloaded installer — that is what the signed release build adds (check:install asserts it)',
  )

  /* ── 5. quit politely: that is what installs the update ───────────────── */
  closeApp(oldProcessName)
  await waitFor(() => !isRunning(oldProcessName), { timeoutMs: 120_000, describe: 'the app to exit so the update installs on quit' })
  const startedAt = Date.now()
  step('closed the app, letting it install on quit')

  /* ── 6. the installed version must actually change ────────────────────── */
  await waitFor(() => versionNow() === newVersion, {
    timeoutMs: timeoutSeconds * 1000,
    describe: `the installed executable to report ${newVersion}`,
  })
  step('the installed executable is now the new version', `${oldVersionFromName} → ${newVersion} in ${Math.round((Date.now() - startedAt) / 1000)}s`)

  await waitFor(() => readLog(userData).some((record) => record.kind === 'app-start' && String(record.message).includes(newVersion)), {
    timeoutMs: timeoutSeconds * 1000,
    describe: 'the app to come back up as the new version',
  })
  step('the app relaunched as the new version', `log records an app-start for ${newVersion}`)

  /* ── 7. clean up after ourselves ──────────────────────────────────────── */
  const updatedExe = installedExe(installDir)
  const updatedProcessName = updatedExe ? path.basename(updatedExe) : 'NewBrand.exe'
  if (isRunning(updatedProcessName)) closeApp(updatedProcessName)
  await waitFor(() => !isRunning(updatedProcessName), { timeoutMs: 60_000, describe: 'the updated app to exit' })
  const uninstallerName = installedUninstaller(installDir)
  if (!uninstallerName) throw new Error(`UNINSTALLER_MISSING: expected one of ${UNINSTALLER_NAMES.join(', ')} in ${installDir}`)
  uninstallSilently(installDir, uninstallerName)
  await waitFor(() => !installedExe(installDir), { timeoutMs: 120_000, describe: 'the uninstaller to remove the executable' })
  step('uninstalled the updated build', installDir)

  console.log(`\ncheck:update-path observed ${steps} real steps: ${oldVersionFromName} → ${newVersion}`)
} catch (err) {
  if (!failures.length) fail(err?.code ?? 'CHECK_THREW', err?.message || String(err))
} finally {
  if (feedServer) feedServer.close()
  const runningExe = installedExe(installDir)
  if (isRunning(runningExe ? path.basename(runningExe) : 'NewBrand.exe')) closeApp(runningExe ? path.basename(runningExe) : 'NewBrand.exe')
}

if (failures.length) {
  console.error(`\ncheck:update-path FAILED\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('check:update-path passed — an installed build really updated itself to the next release and came back up')
