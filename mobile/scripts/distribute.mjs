/**
 * Hands a build to the testers, from this machine.
 *
 * CI does this on a tag, and this is the same call for the times a tag is the
 * wrong tool: a build for one person to check one thing, on a branch, before
 * anybody agrees it is a release. That case is most of pre-release testing, and
 * pushing a tag to get a tester a binary teaches everybody to push bad tags.
 *
 * NO SDK IS INVOLVED. App Distribution uploads a finished APK or IPA — nothing
 * is linked into the app, nothing is added to the bundle, and a build that went
 * to testers is byte-identical to one that did not. That is the reason this is
 * the Firebase product jojo can take without argument.
 *
 * Reads its configuration from the environment so no id or key is ever written
 * into this repository. `docs/RELEASE.md` says where each value comes from.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const platform = process.argv[2]
if (platform !== 'android' && platform !== 'ios') {
  console.error('usage: node scripts/distribute.mjs <android|ios>')
  process.exit(2)
}

const appId =
  platform === 'android' ? process.env.FIREBASE_ANDROID_APP_ID : process.env.FIREBASE_IOS_APP_ID
const group = process.env.FIREBASE_TESTER_GROUP ?? 'testers'

if (!appId) {
  const name = platform === 'android' ? 'FIREBASE_ANDROID_APP_ID' : 'FIREBASE_IOS_APP_ID'
  console.error(
    `${name} is not set.\n\n` +
      `It is the App ID from the Firebase console — Project settings → Your apps —\n` +
      `and looks like 1:123456789012:${platform}:0a1b2c3d4e5f6789.\n` +
      `See docs/RELEASE.md.`,
  )
  process.exit(1)
}

/** The newest build of the right kind, so nobody has to type a path. */
function findBuild() {
  if (platform === 'android') {
    const dir = 'android/app/build/outputs/apk/release'
    if (!existsSync(dir)) {
      console.error(
        `No release APK. Build one first:\n\n  cd android && ./gradlew assembleRelease\n`,
      )
      process.exit(1)
    }
    const apk = readdirSync(dir).filter((f) => f.endsWith('.apk'))
    if (apk.length === 0) {
      console.error(`No .apk in ${dir}. Run ./gradlew assembleRelease first.`)
      process.exit(1)
    }
    return join(dir, apk[0])
  }
  const dir = process.env.IOS_EXPORT_DIR ?? 'ios/build/export'
  const ipa = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ipa')) : []
  if (ipa.length === 0) {
    console.error(
      `No .ipa in ${dir}.\n\n` +
        `Archive and export from Xcode, or set IOS_EXPORT_DIR to where yours lands.\n` +
        `See docs/RELEASE.md.`,
    )
    process.exit(1)
  }
  return join(dir, ipa[0])
}

const build = findBuild()
const notes =
  process.env.RELEASE_NOTES ?? `Local build from ${new Date().toISOString().slice(0, 16)}`

console.log(`Sending ${build}\n  to app ${appId}\n  for group "${group}"`)
try {
  execFileSync(
    'npx',
    [
      'firebase-tools@13',
      'appdistribution:distribute',
      build,
      '--app',
      appId,
      '--release-notes',
      notes,
      '--groups',
      group,
    ],
    { stdio: 'inherit' },
  )
} catch {
  // The CLI has already printed why. Adding a second opinion here would bury it.
  process.exit(1)
}
