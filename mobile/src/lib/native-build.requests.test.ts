/**
 * The native projects, read as files — three owner requests that live in
 * Gradle, Xcode and npm metadata rather than in TypeScript.
 *
 * Q069 — "we want native android and iOS build. Not through expo." Expo was
 *        removed completely (docs/EXPO-REMOVAL.md); `android/` and `ios/` are
 *        hand-owned React Native projects.
 * Q077 — "gradle and JVM compatibility issue. use the stable version". The
 *        wrapper is the stable Gradle the installed React Native Gradle plugin
 *        is built with, AGP comes from React Native rather than a hand pin, and
 *        CI builds on JDK 17.
 * Q177 — the Google services plugin and Firebase dependencies are added, and
 *        `google-services.json` is kept out of git.
 *
 * None of these is reachable from JavaScript, and a Gradle or Xcode run is not
 * something this runner does, so "it assembles" is CI's job (`ci.yml`, Android
 * APK). What this holds is the configuration that decides it. Comments are
 * stripped before searching: every one of these files still explains, in prose,
 * what Expo used to do here.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROOT = path.resolve(MOBILE, '..')
const read = (rel: string) => readFileSync(path.join(MOBILE, rel), 'utf8')

/** Source with `/* *\/`, `//` and `#` comments removed — code only. */
const code = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .replace(/^\s*#.*$/gm, '')

/**
 * Expo in any spelling — `expo`, `expo-*`, `@expo/*`, `useExpoModules`,
 * `ExpoAppDelegate` — but not the `expo` in `export`/`exports`.
 */
const EXPO = /expo(?!rt)/i

const pkg = JSON.parse(read('package.json')) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scripts: Record<string, string>
}

describe('Q069: native Android and iOS projects, with no Expo', () => {
  it('has no expo package among its dependencies', () => {
    const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]
    expect(names.filter((n) => /^(expo|expo-.*|@expo\/.*|babel-preset-expo)$/.test(n))).toEqual([])
  })

  it('runs through the React Native CLI, not expo', () => {
    expect(pkg.scripts.android).toBe('react-native run-android')
    expect(pkg.scripts.ios).toBe('react-native run-ios')
    expect(Object.values(pkg.scripts).join('\n')).not.toMatch(/\bexpo\b/)
  })

  it('has no Expo config files', () => {
    for (const file of ['app.json', 'app.config.js', 'app.config.ts', 'eas.json']) {
      expect(existsSync(path.join(MOBILE, file)), file).toBe(false)
    }
  })

  it.each([
    'android/settings.gradle',
    'android/build.gradle',
    'android/app/build.gradle',
    'android/app/src/main/java/dev/jojo/tracker/MainApplication.kt',
    'android/app/src/main/java/dev/jojo/tracker/MainActivity.kt',
    'ios/Podfile',
    'ios/jojo/AppDelegate.swift',
    'index.ts',
    'babel.config.js',
  ])('%s carries no Expo code', (file) => {
    expect(code(read(file))).not.toMatch(EXPO)
  })

  it('names Expo in Metro only to cut the optional expo-font edge out of the bundle', () => {
    const metro = code(read('metro.config.js'))
    expect(metro.match(new RegExp(EXPO.source, 'gi'))).toEqual(['expo'])
    expect(metro).toContain("const STUBBED = new Set(['expo-font'])")
    expect(metro).toContain("if (STUBBED.has(moduleName)) return { type: 'empty' }")
  })

  it('is a React Native Android application project', () => {
    const app = code(read('android/app/build.gradle'))
    expect(app).toContain('apply plugin: "com.android.application"')
    expect(app).toContain('apply plugin: "com.facebook.react"')
    expect(read('android/app/src/main/java/dev/jojo/tracker/MainApplication.kt')).toMatch(
      /class MainApplication : Application\(\), ReactApplication/,
    )
  })

  it('is a React Native iOS Xcode project', () => {
    expect(existsSync(path.join(MOBILE, 'ios/jojo.xcodeproj/project.pbxproj'))).toBe(true)
    expect(code(read('ios/Podfile'))).toContain('use_react_native!(')
    expect(read('ios/jojo/AppDelegate.swift')).toContain(
      'RCTReactNativeFactory(delegate: delegate)',
    )
  })
})

describe('Q077: stable Gradle, AGP and JDK 17', () => {
  const gradleOf = (props: string) =>
    /distributionUrl=.*\/gradle-([\d.]+(?:-[a-z0-9-]+)?)-(?:bin|all)\.zip/.exec(props)?.[1]

  it('wraps a stable Gradle release, the one React Native builds its own plugin with', () => {
    const ours = gradleOf(read('android/gradle/wrapper/gradle-wrapper.properties'))
    const rn = gradleOf(
      readFileSync(
        path.join(
          ROOT,
          'node_modules/@react-native/gradle-plugin/gradle/wrapper/gradle-wrapper.properties',
        ),
        'utf8',
      ),
    )
    expect(ours).toMatch(/^\d+\.\d+(\.\d+)?$/) // no -rc, -milestone, -beta
    expect(ours).toBe(rn)
  })

  it('takes AGP from React Native rather than pinning its own', () => {
    // Unversioned: the React Native Gradle plugin's included build supplies the
    // AGP it was tested with. A hand pin is how the two drift apart.
    expect(code(read('android/build.gradle'))).toContain(
      "classpath('com.android.tools.build:gradle')",
    )
  })

  it('uses the Kotlin React Native builds against', () => {
    const ours = /kotlinVersion = "([^"]+)"/.exec(read('android/build.gradle'))?.[1]
    const rn = /^kotlin = "([^"]+)"/m.exec(
      readFileSync(
        path.join(ROOT, 'node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml'),
        'utf8',
      ),
    )?.[1]
    expect(ours).toBeDefined()
    expect(ours).toBe(rn)
  })

  it('builds the Android APK in CI on Temurin JDK 17', () => {
    const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const java =
      /uses: actions\/setup-java@[^\n]*\n\s*with:\n((?:\s+[a-z-]+: .*\n)+)/.exec(ci)?.[1] ?? ''
    expect(java).toMatch(/distribution: temurin/)
    expect(java).toMatch(/java-version: 17\b/)
  })
})

describe('Q177: Firebase on Android, with its config kept out of git', () => {
  it('puts the Google services and Crashlytics Gradle plugins on the classpath', () => {
    const top = code(read('android/build.gradle'))
    expect(top).toMatch(/classpath\('com\.google\.gms:google-services:[\d.]+'\)/)
    expect(top).toMatch(/classpath\('com\.google\.firebase:firebase-crashlytics-gradle:[\d.]+'\)/)
  })

  it('applies both plugins in the app module when google-services.json is present', () => {
    const app = code(read('android/app/build.gradle'))
    const guarded =
      /if \(file\('google-services\.json'\)\.exists\(\)\) \{([\s\S]*?)\}/.exec(app)?.[1] ?? ''
    expect(guarded).toContain('apply plugin: "com.google.gms.google-services"')
    expect(guarded).toContain('apply plugin: "com.google.firebase.crashlytics"')
  })

  it('depends on the Firebase app, analytics and crashlytics modules', () => {
    for (const name of [
      '@react-native-firebase/app',
      '@react-native-firebase/analytics',
      '@react-native-firebase/crashlytics',
    ]) {
      expect(pkg.dependencies[name], name).toBeDefined()
    }
  })

  it.each(['mobile/android/app/google-services.json', 'mobile/ios/jojo/GoogleService-Info.plist'])(
    'git ignores %s',
    (file) => {
      // `check-ignore` exits 0 when the path is ignored and throws otherwise.
      expect(() => execFileSync('git', ['check-ignore', '-q', file], { cwd: ROOT })).not.toThrow()
    },
  )
})
