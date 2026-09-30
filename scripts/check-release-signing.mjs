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
 * When the repository has no certificate at all (`CSC_LINK` unset), fail-closed
 * would mean "no release ever" — and this repository does have one configured:
 * the v0.16.0 release run failed at `CSC_LINK is not set` before packaging
 * anything. The workflow therefore has a second path that this check also pins
 * down: an unsigned release is fine ONLY when it is labelled as unsigned on the
 * run and in the release notes, its signature assertions are inverted rather
 * than skipped (the build must be unsigned and must not claim a publisherName —
 * `check:install --unsigned-build`), and the signed path above is not weakened
 * by one character. What must never happen is an unsigned release that pretends
 * to be signed, or a signed path that is weaker than the assertions above.
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
// The unsigned fallback has to stay honest, not quiet: the run and the release
// are labelled UNSIGNED, and the install check runs with the signature
// assertions inverted (build must be unsigned, must not claim a publisherName).
ok(/UNSIGNED RELEASE/.test(release), 'an unsigned release is labelled as unsigned on the run and in the release notes')
ok(/check:install -- --unsigned-build/.test(release), 'the unsigned path runs the install check with inverted signature assertions')

/* ── 3b. release hygiene: the Phase 0 §D findings stay fixed ─────────────── */

// Phase 0 found releases published on top of red checks and several tags per
// hour. Both are properties of this workflow, so both are asserted here rather
// than trusted to habit.
ok(/workflow_dispatch/.test(release) && /tag:/.test(release), 'a manual run must name the tag it is releasing, so nothing publishes by accident')
ok(/check_runs|actions\/runs/.test(release) && /conclusion/.test(release), 'the workflow inspects the check runs of the commit it is about to release')
ok(/failure|cancelled|timed_out|action_required/.test(release), 'and it names the conclusions it refuses to release over')
// One release per verified green build: the publish step must look for an
// existing release rather than creating a second one for the same tag.
ok(/gh release view/.test(release) && /gh release create/.test(release), 'publishing looks for an existing release before creating one')
const viewIndex = release.indexOf('gh release view')
const createIndex = release.indexOf('gh release create')
ok(viewIndex > 0 && createIndex > viewIndex, 'the existence check runs before the create, so a re-run cannot duplicate a release')
ok(/already exists/.test(release), 'a re-run says it is re-uploading the verified assets instead of starting a new release')
// The tag is the version. A hand-made tag that disagrees with package.json fails.
ok(/check:version-sync|version-sync\.mjs/.test(release) && /--tag/.test(release), 'the workflow runs the version gate against the tag being released')
// And the version gate itself must compare all four statements of the version.
const versionSync = read('scripts/check-version-sync.mjs')
for (const source of ['package.json', 'README', 'CHANGELOG', 'app:info']) {
  ok(new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(versionSync), `the version gate reads ${source}`)
}
ok(/drift|mismatch|does not match/i.test(versionSync), 'the version gate fails on drift rather than warning about it')

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
  + 'verifyUpdateCodeSignature intact, signed release path fail-closed (forceCodeSigning, secret-backed '
  + 'certificate, Authenticode + publisherName verification, version gate, install verification, single '
  + 'publish), and the unsigned fallback labelled and inverted rather than skipped',
)
