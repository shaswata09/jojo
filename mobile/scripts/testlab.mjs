/**
 * Drives the app on a real Android device in Google's lab.
 *
 * Two modes, and the default is the one with assertions in it.
 *
 * INSTRUMENTATION (default) runs `android/app/src/androidTest` — the suite that
 * checks the app launches, the tabs navigate, a `jojo://` link opens it,
 * Settings renders, and it survives being backgrounded. Those are the questions
 * nothing else in this project can answer: every Vitest suite passes on a build
 * whose JS bundle was never embedded.
 *
 * ROBO (`--robo`) walks the app with no test code and reports crashes and ANRs
 * on paths the suite never visits. Useful, and a poor gate — a crawler takes a
 * different route each run, so a failure from one is not reproducible.
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

const robo = process.argv.includes('--robo')

const dir = 'android/app/build/outputs/apk/release'
const testDir = 'android/app/build/outputs/apk/androidTest/release'

const oneApk = (where) => {
  const found = existsSync(where) ? readdirSync(where).filter((f) => f.endsWith('.apk')) : []
  return found.length > 0 ? join(where, found[0]) : null
}

/*
 * `-PjojoTestBuildType=release` is what makes `assembleReleaseAndroidTest`
 * exist, and release is what has to be tested: a debug APK expects Metro to be
 * serving the JS, and there is no Metro in Google's lab.
 */
const BUILD =
  '  cd android && ./gradlew -PjojoTestBuildType=release assembleRelease assembleReleaseAndroidTest'

const app = oneApk(dir)
if (!app) {
  console.error(`No release APK in ${dir}.\n\n${BUILD}\n`)
  process.exit(1)
}

const test = robo ? null : oneApk(testDir)
if (!robo && !test) {
  console.error(
    `No instrumentation APK in ${testDir}.\n\n${BUILD}\n\n` +
      'Or run the crawl instead, which needs no test APK:\n\n  npm run testlab -- --robo\n',
  )
  process.exit(1)
}

/*
 * API 33 by default: jojo's declared floor is Android 12 (API 31), and testing
 * below it would fail for a reason that is written down rather than a bug.
 * Override with TESTLAB_DEVICE to check a specific handset.
 */
const device =
  process.env.TESTLAB_DEVICE ?? 'model=MediumPhone.arm,version=33,locale=en,orientation=portrait'

const args = [
  'firebase',
  'test',
  'android',
  'run',
  '--type',
  robo ? 'robo' : 'instrumentation',
  '--app',
  app,
  ...(robo ? [] : ['--test', test]),
  '--device',
  device,
  '--timeout',
  process.env.TESTLAB_TIMEOUT ?? (robo ? '5m' : '12m'),
  '--project',
  project,
  // A fresh store per device, so a run cannot pass because a previous one had
  // already dismissed the first-run flow.
  ...(robo ? [] : ['--environment-variables', 'clearPackageData=true']),
]

console.log(`${robo ? 'Crawling' : 'Running the instrumentation suite'} on ${device}`)
console.log(`  app:  ${app}`)
if (test) console.log(`  test: ${test}`)
try {
  execFileSync('gcloud', args, { stdio: 'inherit' })
} catch {
  process.exit(1)
}
