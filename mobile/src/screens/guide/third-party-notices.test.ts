/**
 * The phone's licence notices against what is actually installed.
 *
 * The APK shipped some 770 packages with the notice of none of them (the
 * fonts' OFL.txt aside). The notices are now generated into
 * `third-party-notices.json` and shown on Guide → Built with; this is what
 * keeps that file from going quietly stale. It regenerates the whole file in
 * memory from `node_modules` and the committed native inventory — the
 * generator is deterministic — and fails on any difference, so an
 * `npm install` that adds, removes or upgrades a phone dependency fails here
 * until `node mobile/scripts/third-party-notices.mjs` is run again.
 *
 * The native libraries (Maven artefacts in the APK, pods in the iOS app) come
 * from `mobile/scripts/native-inventory.json`, which only
 * `third-party-notices.mjs --native` can rewrite, because it needs Gradle and
 * the Pods tree. This cannot run either, so it checks the inventory against
 * what it can read cheaply: the pods `Podfile.lock` resolves, and the Gradle
 * dependency lines and native npm modules the Android classpath follows from.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OUT, build, readInventory, serialise } from '../../../scripts/third-party-notices.mjs'
import { androidInputs, lockedPods, spdxFor } from '../../../scripts/native-notices.mjs'
import { productionTree } from '../../../../web/scripts/licence-notices.mjs'
import { filterNotices, licenceTally, noticeBody } from './third-party-notices'
import type { NativeNotice, Notices, PackageNotice } from './third-party-notices'

const committed = readFileSync(OUT, 'utf8')
const data = JSON.parse(committed) as Notices
const MOBILE = new URL('../../../', import.meta.url).pathname

describe('the committed notices', () => {
  it('are exactly what the generator writes from node_modules today', () => {
    expect(
      committed === serialise(build()),
      'third-party-notices.json is stale — run: node mobile/scripts/third-party-notices.mjs (and add --native after a native dependency change)',
    ).toBe(true)
  })

  it('cover every package in the production dependency tree, at its installed version', () => {
    const listed = new Set(data.packages.map((p) => `${p.name}@${p.version}`))
    const missing = productionTree(MOBILE)
      .map((p) => `${p.name}@${p.version}`)
      .filter((key) => !listed.has(key))
    expect(missing).toEqual([])
    // Not vacuous: the tree is the size of a React Native app.
    expect(data.packages.length).toBeGreaterThan(300)
  })

  it('carry the packages a review found credited nowhere', () => {
    const names = new Set(data.packages.map((p) => p.name))
    for (const name of [
      'jsqr',
      '@react-native-firebase/app',
      '@react-native-firebase/analytics',
      '@react-native-firebase/crashlytics',
      'react-native',
    ]) {
      expect(names.has(name), name).toBe(true)
    }
  })

  it('give every Apache-2.0 package the full licence text, not a URL to it', () => {
    const apache = data.packages.filter((p) => p.licence === 'Apache-2.0')
    expect(apache.length).toBeGreaterThan(0)
    expect(apache.filter((p) => !p.shared.includes('Apache-2.0')).map((p) => p.name)).toEqual([])
    expect(data.shared['Apache-2.0']).toContain('END OF TERMS AND CONDITIONS')
  })

  it('point only at shared texts the file contains', () => {
    const dangling = data.packages.filter((p) => p.shared.some((k) => !data.shared[k]))
    expect(dangling.map((p) => p.name)).toEqual([])
  })

  it('keep the copyright line when the shared body is cut out', () => {
    const react = data.packages.find((p) => p.name === 'react')
    expect(react?.shared).toContain('MIT')
    expect(react?.texts[0]?.text).toContain('Copyright (c) Meta Platforms, Inc. and affiliates.')
    expect(react?.texts[0]?.text).not.toContain('Permission is hereby granted')
  })

  it('include the fonts and Google\'s terms, which are neither packages nor libraries', () => {
    const headings = data.extra.map((e) => e.heading).join('\n')
    expect(headings).toMatch(/Inter and JetBrains Mono/)
    expect(headings).toMatch(/Firebase and Google Play services/)
    expect(data.extra[0]?.text).toContain('SIL Open Font License')
    // The section that said the native libraries were not listed is gone
    // with the gap it described.
    expect(headings).not.toMatch(/not yet listed/)
  })

  // Apache's appendix is where several packages write their only copyright
  // line; cutting it whole lost these (web-vitals' "Copyright 2020 Google LLC"
  // among them). Each must still name a copyright holder after the cut.
  it('keep a copyright line written into the Apache appendix', () => {
    for (const name of [
      'web-vitals',
      'exponential-backoff',
      'human-signals',
      'chrome-launcher',
      'chromium-edge-launcher',
      'lighthouse-logger',
    ]) {
      const pkg = data.packages.find((p) => p.name === name)
      expect(pkg, name).toBeDefined()
      expect(pkg?.texts.map((t) => t.text).join('\n'), name).toMatch(
        /Copyright\s+(?:\(c\)\s*)?\d{4}/i,
      )
    }
    const vitals = data.packages.find((p) => p.name === 'web-vitals')
    expect(vitals?.texts.map((t) => t.text).join('\n')).toContain('Copyright 2020 Google LLC')
  })
})

const inventory = readInventory() as {
  android: {
    inputs: { declarations: string[]; nativeModules: string[] }
    artifacts: { name: string; version: string }[]
    withoutFiles: string[]
  }
  ios: { pods: { name: string; version: string; source: string }[] }
}

describe('the native libraries', () => {
  const android = data.native.android
  const ios = data.native.ios

  // The inventory is what Gradle resolved when --native last ran. Gradle cannot
  // run here, so what it resolved from is compared instead: a new dependency
  // line, a flipped Hermes switch or an upgraded native npm module (React
  // Native, the Firebase modules, whose package.json pins the Firebase BoM)
  // can change the classpath, and all of them show here.
  it('were collected from the Android build as it is declared today', () => {
    expect(
      androidInputs(),
      'the Android build changed since the native inventory was written — run: node mobile/scripts/third-party-notices.mjs --native',
    ).toEqual(inventory.android.inputs)
  })

  it('list every pod Podfile.lock resolves that is not an npm package, at its locked version', () => {
    const locked = lockedPods().map((p) => `${p.name}@${p.version}`)
    expect(
      inventory.ios.pods.map((p) => `${p.name}@${p.version}`),
      'Podfile.lock changed since the native inventory was written — run pod install, then: node mobile/scripts/third-party-notices.mjs --native',
    ).toEqual(locked)
    expect(ios.map((p) => `${p.name}@${p.version}`)).toEqual(locked)
  })

  it('credit every Android artefact the release classpath packages', () => {
    expect(android.map((a) => `${a.name}@${a.version}`)).toEqual(
      inventory.android.artifacts.map((a) => `${a.name}@${a.version}`),
    )
    // Not vacuous: React Native with Firebase is well over a hundred.
    expect(android.length).toBeGreaterThan(100)
    expect(ios.length).toBeGreaterThan(15)
    // A BOM or a Kotlin Multiplatform root resolves but ships no file.
    expect(inventory.android.withoutFiles).toContain('com.google.firebase:firebase-bom:34.15.0')
  })

  it('carry the libraries the review named as credited nowhere', () => {
    const names = new Set(android.map((a) => a.name))
    for (const name of [
      'androidx.core:core',
      'org.jetbrains.kotlin:kotlin-stdlib',
      'com.squareup.okhttp3:okhttp',
      'com.squareup.okio:okio-jvm',
      'com.facebook.fresco:fresco',
      'com.facebook.soloader:soloader',
      'com.facebook.fbjni:fbjni',
      'com.facebook.react:hermes-android',
      'com.google.firebase:firebase-crashlytics',
      'com.google.firebase:firebase-analytics',
    ]) {
      expect(names.has(name), name).toBe(true)
    }
    const pods = new Set(ios.map((p) => p.name))
    for (const name of [
      'FirebaseCore',
      'FirebaseCrashlytics',
      'GoogleUtilities',
      'nanopb',
      'PromisesObjC',
      'RCT-Folly',
      'glog',
      'boost',
      'fmt',
      'DoubleConversion',
      'hermes-engine',
    ]) {
      expect(pods.has(name), name).toBe(true)
    }
    // Folly and friends are compiled into react-android's native library on
    // Android, not shipped as artefacts of their own.
    const react = android.find((a) => a.name === 'com.facebook.react:react-android')
    expect(react?.bundled.map((b) => b.split(' ')[0])).toEqual(
      expect.arrayContaining(['folly', 'glog', 'boost', 'fmt', 'double-conversion']),
    )
  })

  it('give every Apache-2.0 library the full licence text', () => {
    const apache = [...android, ...ios].filter((p) => p.licence === 'Apache-2.0')
    expect(apache.length).toBeGreaterThan(100)
    expect(apache.filter((p) => !p.shared.includes('Apache-2.0')).map((p) => p.name)).toEqual([])
  })

  it('pass on the NOTICE files the artefacts carry', () => {
    const okhttp = android.find((a) => a.name === 'com.squareup.okhttp3:okhttp')
    expect(okhttp?.notices.map((n) => n.file)).toContain('okhttp3/internal/publicsuffix/NOTICE')
    const lang = android.find((a) => a.name === 'org.apache.commons:commons-lang3')
    expect(lang?.notices[0]?.text).toContain('The Apache Software Foundation')
  })

  it('say where a licence comes from when the artefact ships no file', () => {
    const fresco = android.find((a) => a.name === 'com.facebook.fresco:fresco')
    expect(fresco?.licence).toBe('MIT')
    expect(fresco?.missing).toMatch(/POM declares MIT/)
    expect(fresco?.shared).toContain('MIT')
  })

  it('point only at shared and bundled texts the file contains', () => {
    const rows: NativeNotice[] = [...android, ...ios]
    expect(rows.filter((p) => p.shared.some((k) => !data.shared[k])).map((p) => p.name)).toEqual(
      [],
    )
    expect(
      rows.filter((p) => p.bundled.some((b) => !data.native.bundled[b])).map((p) => p.name),
    ).toEqual([])
    const parts = data.native.parts.length
    expect(
      Object.entries(data.native.bundled)
        .filter(([, ids]) => ids.some((i) => i < 0 || i >= parts))
        .map(([name]) => name),
    ).toEqual([])
  })

  // Google's AARs list the open-source code inside them in
  // third_party_licenses.txt, the list the oss-licenses plugin would show.
  it('carry what Google bundles inside its artefacts', () => {
    const base = android.find((a) => a.name === 'com.google.android.gms:play-services-base')
    expect(base?.bundled.length).toBeGreaterThan(5)
    const body = noticeBody(base!, data.shared, data.native)
    expect(body).toMatch(/Android Software Development Kit License/)
  })

  it('map a stated licence to SPDX only when it names exactly one', () => {
    expect(spdxFor('The Apache Software License, Version 2.0')).toBe('Apache-2.0')
    expect(spdxFor('Apache-2')).toBe('Apache-2.0')
    expect(spdxFor('MIT License')).toBe('MIT')
    expect(spdxFor('Boost Software License')).toBe('BSL-1.0')
    expect(spdxFor('BSD License')).toBeNull()
    expect(spdxFor('Bouncy Castle Licence')).toBeNull()
    expect(spdxFor('Android Software Development Kit License')).toBeNull()
  })

  it('read the Podfile.lock sections, subspecs folded into their pod', () => {
    const lock = [
      'PODS:',
      '  - Firebase/CoreOnly (12.15.0):',
      '    - FirebaseCore (~> 12.15.0)',
      '  - FirebaseCore (12.15.0)',
      '  - fmt (11.0.2)',
      '  - React-Core (0.81.5)',
      '',
      'SPEC REPOS:',
      '  trunk:',
      '    - Firebase',
      '    - FirebaseCore',
      '',
      'EXTERNAL SOURCES:',
      '  fmt:',
      '    :podspec: "../../node_modules/react-native/third-party-podspecs/fmt.podspec"',
      '  React-Core:',
      '    :path: "../../node_modules/react-native/"',
      '',
      'COCOAPODS: 1.16.2',
    ].join('\n')
    expect(lockedPods(lock)).toEqual([
      { name: 'Firebase', version: '12.15.0', source: 'trunk' },
      { name: 'FirebaseCore', version: '12.15.0', source: 'trunk' },
      { name: 'fmt', version: '11.0.2', source: 'podspec' },
    ])
  })
})

describe('reading them on the phone', () => {
  const pkgs: PackageNotice[] = [
    {
      name: 'react',
      version: '1',
      licence: 'MIT',
      texts: [{ file: 'LICENSE', text: 'Copyright (c) Meta' }],
      notices: [],
      missing: null,
      shared: ['MIT'],
    },
    {
      name: 'jsqr',
      version: '1',
      licence: 'Apache-2.0',
      texts: [],
      notices: [{ file: 'NOTICE', text: 'jsQR notice' }],
      missing: 'ships no licence file',
      shared: ['Apache-2.0'],
    },
    {
      name: 'odd',
      version: '1',
      licence: null,
      texts: [],
      notices: [],
      missing: 'states nothing',
      shared: [],
    },
  ]

  it('filters by package name or licence, case aside', () => {
    expect(filterNotices(pkgs, 'REA').map((p) => p.name)).toEqual(['react'])
    expect(filterNotices(pkgs, 'apache').map((p) => p.name)).toEqual(['jsqr'])
    expect(filterNotices(pkgs, '  ')).toHaveLength(3)
  })

  it('tallies licences most first, naming a package that states none', () => {
    expect(licenceTally([...pkgs, pkgs[0]!])).toEqual([
      ['MIT', 2],
      ['Apache-2.0', 1],
      ['none stated', 1],
    ])
  })

  it('expands a native row to its bundled code, sections rejoined, before the shared text', () => {
    const row: NativeNotice = { ...pkgs[1]!, bundled: ['Dagger'] }
    const body = noticeBody(
      row,
      { 'Apache-2.0': 'APACHE TERMS' },
      { bundled: { Dagger: [1, 0] }, parts: ['second', 'first'] },
    )
    expect(body).toContain('Dagger\n\nfirst\n------------------\nsecond')
    expect(body.indexOf('jsQR notice')).toBeLessThan(body.indexOf('Dagger'))
    expect(body.indexOf('Dagger')).toBeLessThan(body.indexOf('APACHE TERMS'))
  })

  it('expands a row to its own files, its NOTICE, then the shared text it points at', () => {
    const body = noticeBody(pkgs[1]!, { 'Apache-2.0': 'APACHE TERMS' })
    expect(body.indexOf('ships no licence file')).toBeLessThan(body.indexOf('jsQR notice'))
    expect(body.indexOf('jsQR notice')).toBeLessThan(body.indexOf('APACHE TERMS'))
  })
})
