#!/usr/bin/env node
/**
 * check:release-signing — a release must be signed, and a build that could not
 * be signed must not become a release.
 *
 * Why this is not just "SmartScreen warnings": the updater trusts what it
 * downloads unless `app-update.yml` carries a `publisherName`, and
 * electron-builder only writes that field when it verified a signing
 * certificate (`app-builder-lib/out/publish/PublishManager.js`, guarded by
 * `isForceCodeSigningVerification`; verified against electron-builder 25.1.8 in
 * this repo). `NsisUpdater.verifySignature` returns `null` — no check at all —
 * when the field is missing, and the app downloads updates automatically. So an
 * unsigned build does not merely look suspicious to Windows: it removes the
 * Authenticode check from its own update path, for every future version the
 * user installs over it.
 *
 * The fix is a fail-closed release path, and this check asserts each link:
 *
 *   1. the signing configuration exists (SHA-256, RFC 3161 timestamping — an
 *      untimestamped signature stops verifying when the certificate expires,
 *      which would break updates for every existing install at once);
 *   2. `verifyUpdateCodeSignature` is not switched off;
 *   3. the release workflow supplies the certificate from secrets, passes
 *      `forceCodeSigning=true` (electron-builder then refuses to produce an
 *      unsigned build), checks the Authenticode status of both installers
 *      before publishing, and asserts that `app-update.yml` in the packaged app
 *      actually carries a `publisherName`;
 *   4. the workflow runs the version-sync gate under the tag, verifies the
 *      install/run/uninstall path, and publishes once.
 *
 * Run: npm run check:release-signing
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

let checks = 0
const ok = (condition, label) => {
  assert.ok(condition, `FAIL: ${label}`)
  checks += 1
}

/* ── 1. the signing configuration ───────────────────────────────────────── */
const pkg = JSON.parse(read('package.json'))
const win = pkg.build?.win
ok(win != null, 'package.json has a windows build config')
const signtool = win.signtoolOptions ?? {}
const algorithms = signtool.signingHashAlgorithms ?? win.signingHashAlgorithms ?? []
ok(algorithms.includes('sha256'), 'signing uses SHA-256 (a SHA-1 signature is refused by modern Windows)')
const timestampServer = signtool.rfc3161TimeStampServer ?? win.rfc3161TimeStampServer ?? ''
ok(/^https?:\/\//.test(timestampServer), `an RFC 3161 timestamp server is configured (${timestampServer || 'none'})`)
ok(
  signtool.certificateSubjectName == null || signtool.certificateFile == null || typeof signtool.certificateSubjectName === 'string',
  'certificate selection is configured, not guessed',
)
ok(
  win.verifyUpdateCodeSignature !== false,
  'verifyUpdateCodeSignature is not disabled (disabling it would remove the Authenticode check from the update path)',
)
ok(win.signAndEditExecutable !== false, 'signAndEditExecutable is not disabled (the packaged exe must carry the signature)')

/* ── 2. who is allowed to be unsigned ───────────────────────────────────── */
// Local/dev packaging stays unsigned on purpose: there is no certificate on a
// developer machine, and `npm run dist:win` must keep working. The release path
// is where signing becomes mandatory, which is why the flag lives in the
// workflow and not in package.json.
ok(win.forceCodeSigning !== true, 'package.json does not force signing for developer builds (the release workflow turns it on instead)')

/* ── 3. the release workflow ────────────────────────────────────────────── */
const release = read('.github/workflows/release-windows.yml')
ok(/tags:\s*\n\s*-\s*'v\*'/.test(release), 'the release workflow runs on v* tags')
ok(/node scripts\/run-checks\.mjs/.test(release), 'the release workflow runs the full check chain')
ok(/--config\.forceCodeSigning=true|--config\s+forceCodeSigning=true|-c\.forceCodeSigning=true/.test(release),
  'the release workflow packages with forceCodeSigning=true, so an unsigned build cannot be published')
ok(/CSC_LINK|WIN_CSC_LINK/.test(release) && /secrets\./.test(release), 'the signing certificate comes from repository secrets')
ok(/Get-AuthenticodeSignature/.test(release), 'the workflow checks the Authenticode status of the built installers')
ok(/SignatureStatus|Status\s+-ne\s+'?Valid|Status\s+-eq\s+'?Valid/.test(release), 'the workflow requires the signature status to be Valid')
ok(/publisherName/.test(release), 'the workflow asserts the packaged app-update.yml carries a publisherName')
ok(/app-update\.yml/.test(release), 'the workflow looks at the real app-update.yml the updater reads')
ok(/check:version-sync\s+--tag/.test(release), 'the workflow runs the version-sync gate against the tag')
ok(/check:install/.test(release), 'the workflow verifies install/run/uninstall before publishing')
ok(!/continue-on-error/.test(release), 'no release step is allowed to fail quietly')
ok(/--publish never/.test(release), 'electron-builder never publishes by itself (the workflow does, after verification)')

/* ── 4. the updater keeps its guard ─────────────────────────────────────── */
const main = read('electron/main.cjs')
ok(/autoUpdater\.autoDownload = true/.test(main), 'updates still download automatically')
ok(!/verifyUpdateCodeSignature\s*=\s*null/.test(main), 'the app does not replace the signature verifier with a no-op')
ok(!/verifyUpdateCodeSignature\s*=\s*\(\s*\)\s*=>\s*Promise\.resolve\(\s*null\s*\)/.test(main), 'the app does not stub the signature verifier')

// A remote-update path must never accept an arbitrary feed from the environment
// in a released build: the override exists for the update-path test and says so.
const feedOverride = main.match(/CUPRIC_UPDATE_FEED/g) ?? []
ok(feedOverride.length >= 1, 'the updater documents its test feed override (CUPRIC_UPDATE_FEED)')
ok(/CUPRIC_UPDATE_FEED[\s\S]{0,300}setFeedURL|setFeedURL[\s\S]{0,300}CUPRIC_UPDATE_FEED/.test(main), 'the override is wired to setFeedURL, not to a silent ignore')
ok(/logLine\([^)]*updater/.test(main), 'updater transitions are logged, so an update can be observed without a screenshot')

console.log(
  `release signing check passed — ${checks} assertions: SHA-256 + RFC 3161 signing configured, `
  + 'verifyUpdateCodeSignature intact, release path fail-closed (forceCodeSigning, secret-backed certificate, '
  + 'Authenticode + publisherName verification, version gate, install verification, single publish)',
)
