/**
 * Drives the app on a real Android device in Google's lab, with no test code.
 *
 * A Robo test installs the APK, walks the UI on its own, and reports a crash or
 * an ANR. That is worth having here specifically because of what this project
 * cannot otherwise check: nothing in the gate runs the phone app at all, and the
 * end-to-end audit had to mark every mobile finding as read-not-observed.
 *
 * THE FREE TIER IS SMALL — 10 virtual-device runs a day and 5 physical — so this
 * is a command somebody runs, and CI only runs it on a tag. Wiring it to every
 * push would exhaust the quota by mid-morning and then fail builds for a reason
 * that has nothing to do with the code.
 *
 * `gcloud` rather than the Firebase CLI: Test Lab is a Google Cloud product and
 * `firebase-tools` does not front it.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const project = process.env.FIREBASE_PROJECT_ID
if (!project) {
  console.error(
    'FIREBASE_PROJECT_ID is not set.\n\n' +
      'It is the project id from the Firebase console — Project settings → General.\n' +
      'See docs/RELEASE.md.',
  )
  process.exit(1)
}

const dir = 'android/app/build/outputs/apk/release'
const apks = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.apk')) : []
if (apks.length === 0) {
  console.error(`No release APK in ${dir}.\n\n  cd android && ./gradlew assembleRelease\n`)
  process.exit(1)
}

/*
 * API 33 by default: jojo's declared floor is Android 12 (API 31), and testing
 * below it would fail for a reason that is written down rather than a bug.
 * Override with TESTLAB_DEVICE to check a specific handset.
 */
const device =
  process.env.TESTLAB_DEVICE ?? 'model=MediumPhone.arm,version=33,locale=en,orientation=portrait'

console.log(`Running a Robo test on ${device}`)
try {
  execFileSync(
    'gcloud',
    [
      'firebase',
      'test',
      'android',
      'run',
      '--type',
      'robo',
      '--app',
      join(dir, apks[0]),
      '--device',
      device,
      '--timeout',
      process.env.TESTLAB_TIMEOUT ?? '5m',
      '--project',
      project,
    ],
    { stdio: 'inherit' },
  )
} catch {
  process.exit(1)
}
