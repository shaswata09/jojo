/**
 * The owner's requests about the pipeline, pinned against `.github/workflows/ci.yml`.
 *
 * A workflow file has no test runner of its own, and every one of these was a
 * request because a run went wrong in a way nothing local could see: a push that
 * did not start a build, a Pages deploy that died at configure-pages, an Android
 * job broken by an action default, a site built without its Firebase variables.
 * So each decision is read off the file here, narrowly — the step and the line
 * that carry it, not the whole job — so an ordinary edit to a comment or a new
 * step does not fail this, and undoing the decision does.
 *
 * Text, not a YAML parse: the repository declares no YAML parser, and the shapes
 * read here are a job's block and a step's block, which indentation delimits.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** Comments stripped, so a decision that is only described in prose does not pass. */
const CI = read('.github/workflows/ci.yml')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')

/** The `on:` block, up to the next top-level key. */
function triggers(): string {
  const m = /^on:\n([\s\S]*?)^\S/m.exec(CI)
  if (!m?.[1]) throw new Error('ci.yml has no `on:` block')
  return m[1]
}

/** One job's block under `jobs:`, from its two-space key to the next job's. */
function job(name: string): string {
  const lines = CI.split('\n')
  const start = lines.findIndex((l) => l === `  ${name}:`)
  if (start < 0) throw new Error(`ci.yml has no job "${name}"`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^ {2}[\w-]+:\s*$/.test(l) || /^\S/.test(l))
  return rest.slice(0, end < 0 ? undefined : end).join('\n')
}

/** One step of a job: the `- ` item that names it (or uses it), to the next item. */
function step(jobText: string, marker: RegExp): string {
  const items = jobText.split(/\n(?= {6}- )/)
  const hit = items.find((item) => marker.test(item))
  if (!hit) throw new Error(`no step matching ${String(marker)}`)
  return hit
}

describe('Q212 — what starts a run', () => {
  it('triggers on every push to main, with no path filter that could skip one', () => {
    const on = triggers()
    const push = /^ {2}push:\n([\s\S]*?)(?=^ {2}\S)/m.exec(on)?.[1] ?? ''
    expect(push).toMatch(/^ {4}branches:\s*\[\s*main\s*\]/m)
    // A `paths:` or `paths-ignore:` filter is how a push stops starting a build.
    expect(push).not.toMatch(/paths(-ignore)?:/)
  })
})

describe('Q134 — the gate, the Pages deploy behind it, and the APK', () => {
  it('runs every workspace’s typecheck, lint and tests in the gate job', () => {
    const gate = job('gate')
    for (const command of [
      'npm -w @jojo/service run lint',
      'npm -w @jojo/service exec -- tsc -b',
      'npm -w @jojo/service run test:coverage',
      'npm -w web exec -- tsc -b --force',
      'npm -w web run lint',
      'npm -w web run test',
      'npm -w jojo-mobile exec -- tsc --noEmit',
      'npm -w jojo-mobile run lint',
      'npm -w jojo-mobile run test',
    ]) {
      expect(gate, command).toContain(`run: ${command}`)
    }
  })

  it('deploys the site to GitHub Pages only behind the gate, and only from main', () => {
    const deploy = job('deploy')
    expect(deploy).toMatch(/^ {4}needs: gate$/m)
    expect(deploy).toMatch(/^ {4}if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'$/m)
    expect(deploy).toContain('uses: actions/upload-pages-artifact@')
    expect(deploy).toMatch(/path: web\/dist$/m)
    expect(deploy).toContain('uses: actions/deploy-pages@')
  })

  it('builds the release APK behind the gate and publishes it as an artifact', () => {
    const android = job('android')
    expect(android).toMatch(/^ {4}needs: gate$/m)
    expect(step(android, /name: Build the release APK/)).toMatch(/^\s+assembleRelease$/m)
    const upload = step(android, /name: Publish the APK as a build artifact/)
    expect(upload).toContain('path: mobile/android/app/build/outputs/apk/release/*.apk')
  })

  it('attaches the APK to a release on a version tag', () => {
    expect(triggers()).toMatch(/tags:\s*\['v\*'\]/)
    const release = job('release')
    expect(release).toMatch(/^ {4}needs: \[android, extension\]$/m)
    expect(release).toMatch(/^ {4}if: startsWith\(github\.ref, 'refs\/tags\/v'\)/m)
    const attach = step(release, /uses: softprops\/action-gh-release@/)
    expect(attach).toContain('release/android/*.apk')
  })
})

describe('Q135 — the service suite runs with its coverage floors', () => {
  it('gates on test:coverage, and the floors it enforces are declared', () => {
    expect(job('gate')).toContain('run: npm -w @jojo/service run test:coverage')
    expect(read('gate.sh')).toMatch(/npm -w @jojo\/service run test:coverage/)
    const config = read('service/vitest.config.mts')
    for (const dir of ['kg/core', 'kg/agent', 'kg/tools', 'kg/repo']) {
      expect(config, dir).toMatch(new RegExp(`'${dir}/\\*\\*': \\{ lines: \\d+`))
    }
  })
})

describe('Q138 — the Pages deploy can get past configure-pages', () => {
  it('holds the two permissions deploy-pages needs and asks configure-pages to enable the site', () => {
    const deploy = job('deploy')
    expect(deploy).toMatch(/^ {6}pages: write$/m)
    expect(deploy).toMatch(/^ {6}id-token: write$/m)
    const configure = step(deploy, /uses: actions\/configure-pages@/)
    expect(configure).toMatch(/enablement: true/)
  })
})

describe('Q182 — the deployed web build gets its reporting config from repository variables', () => {
  const build = () => step(job('deploy'), /name: Build$/m)

  it('maps CRASH_REPORTING, ANALYTICS and every Firebase value from vars into the build', () => {
    const text = build()
    expect(text).toMatch(/VITE_CRASH_REPORTING: \$\{\{ vars\.CRASH_REPORTING \}\}/)
    expect(text).toMatch(/VITE_ANALYTICS: \$\{\{ vars\.ANALYTICS \}\}/)
    for (const key of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']) {
      expect(text, key).toContain(`VITE_FIREBASE_${key}: \${{ vars.FIREBASE_${key} }}`)
    }
  })

  it('passes every VITE_ variable the web app’s reporting code reads', () => {
    const text = build()
    const source = read('web/src/lib/analytics.ts') + read('web/src/lib/crash-log.ts')
    const names = new Set([...source.matchAll(/['"](VITE_[A-Z_]+)['"]/g)].map((m) => m[1]))
    expect(names.size).toBeGreaterThan(5)
    for (const name of names) expect(text, name).toMatch(new RegExp(`^\\s+${name ?? ''}: \\$\\{\\{ vars\\.`, 'm'))
  })
})

describe('Q176 / Q180 — Firebase App Distribution and Test Lab', () => {
  it('sends the release APK to testers through App Distribution', () => {
    const send = step(job('android'), /name: Send the APK to testers/)
    expect(send).toContain('firebase appdistribution:distribute "$APK"')
    expect(send).toContain('apk/release/*.apk')
  })

  it('runs the instrumentation suite on Test Lab against the release APK, on pushes to main', () => {
    const android = job('android')
    const build = step(android, /name: Build the release APK/)
    expect(build).toMatch(/^\s+assembleReleaseAndroidTest$/m)
    expect(build).toContain('-PjojoTestBuildType=release')

    const lab = step(android, /name: Run the instrumentation suite on Test Lab/)
    expect(lab).toContain("github.ref == 'refs/heads/main'")
    expect(lab).toContain('gcloud firebase test android run')
    expect(lab).toContain('--type instrumentation')
    expect(lab).toContain('apk/release/*.apk')
    expect(lab).toContain('apk/androidTest/release/*.apk')
    // It gates: a failure is not swallowed into a warning the way the Robo crawl's is.
    expect(lab).not.toMatch(/\|\|\s*echo/)
  })
})

describe('Q273 — the Android SDK setup', () => {
  it('does not ask sdkmanager for the withdrawn "tools" package', () => {
    const setup = step(job('android'), /uses: android-actions\/setup-android@/)
    const packages = /packages:\s*(.+)$/m.exec(setup)?.[1]
    // Leaving `packages` unset falls back to the action's default, which is `tools platform-tools`.
    expect(packages).toBeDefined()
    expect((packages ?? '').split(/\s+/)).not.toContain('tools')
    expect(packages).toContain('platform-tools')
  })
})

describe('Q183 — iOS builds report analytics', () => {
  it('switches IS_ANALYTICS_ENABLED on in the Firebase plist CI puts in place', () => {
    // The secret holds whatever plist was downloaded; one taken before
    // analytics was enabled says false, so the build sets it rather than
    // depending on the secret's copy. Placed after the decode it must follow.
    const decode = CI.indexOf('> mobile/ios/jojo/GoogleService-Info.plist')
    const flip = CI.indexOf('plutil -replace IS_ANALYTICS_ENABLED -bool YES mobile/ios/jojo/GoogleService-Info.plist')
    expect(decode).toBeGreaterThan(-1)
    expect(flip).toBeGreaterThan(decode)
  })
})
