/**
 * The phone's licence notices against what is actually installed.
 *
 * The APK shipped some 770 packages with the notice of none of them (the
 * fonts' OFL.txt aside). The notices are now generated into
 * `third-party-notices.json` and shown on Guide → Built with; this is what
 * keeps that file from going quietly stale. It regenerates the whole file in
 * memory from `node_modules` — the generator is deterministic — and fails on
 * any difference, so an `npm install` that adds, removes or upgrades a phone
 * dependency fails here until `node mobile/scripts/third-party-notices.mjs` is
 * run again.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OUT, build, serialise } from '../../../scripts/third-party-notices.mjs'
import { productionTree } from '../../../../web/scripts/licence-notices.mjs'
import { filterNotices, licenceTally, noticeBody } from './third-party-notices'
import type { Notices, PackageNotice } from './third-party-notices'

const committed = readFileSync(OUT, 'utf8')
const data = JSON.parse(committed) as Notices
const MOBILE = new URL('../../../', import.meta.url).pathname

describe('the committed notices', () => {
  it('are exactly what the generator writes from node_modules today', () => {
    expect(
      committed === serialise(build()),
      'third-party-notices.json is stale — run: node mobile/scripts/third-party-notices.mjs',
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

  it('include the fonts and the native SDKs, which are not npm packages', () => {
    const headings = data.extra.map((e) => e.heading).join('\n')
    expect(headings).toMatch(/Inter and JetBrains Mono/)
    expect(headings).toMatch(/Native libraries not yet listed/)
    expect(data.extra[0]?.text).toContain('SIL Open Font License')
  })

  // The list is npm's tree; the Maven/Gradle and CocoaPods libraries React
  // Native links are not in it. The sheet must say so rather than read as
  // complete, and name the main ones and the way to collect them.
  it('say the native Android and iOS libraries are not listed yet, naming the main ones', () => {
    const native = data.extra.find((e) => /Native libraries/.test(e.heading))?.text ?? ''
    for (const name of [
      'AndroidX',
      'Kotlin',
      'OkHttp',
      'Fresco',
      'SoLoader',
      'fbjni',
      'Hermes',
      'Folly',
      'Firebase',
    ]) {
      expect(native).toContain(name)
    }
    expect(native).toMatch(/Gradle licence plugin/)
    expect(native).toMatch(/CocoaPods acknowledgements/)
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

  it('expands a row to its own files, its NOTICE, then the shared text it points at', () => {
    const body = noticeBody(pkgs[1]!, { 'Apache-2.0': 'APACHE TERMS' })
    expect(body.indexOf('ships no licence file')).toBeLessThan(body.indexOf('jsQR notice'))
    expect(body.indexOf('jsQR notice')).toBeLessThan(body.indexOf('APACHE TERMS'))
  })
})
