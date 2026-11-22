/**
 * The notices the build writes beside the bundle, and the phone carries.
 *
 * Neither app shipped a licence text for its dependencies: the minifier strips
 * every licence comment, and the Built with page pointed at
 * `node_modules/<pkg>/LICENSE`, which is not a place a visitor to GitHub Pages
 * can look. `scripts/licence-notices.mjs` now reads each package's own files
 * into `THIRD-PARTY-NOTICES.txt` (web, `jojo:licence-notices`) and into the
 * phone's generated JSON. These pin the parts a mistake in would lose text a
 * licence requires: cutting a shared body must keep the copyright line, a file
 * that only resembles a licence must keep every word, and a package with no
 * licence file — or only Apache's short header — must still arrive with the
 * terms it states.
 */

import { describe, expect, it } from 'vitest'
import {
  APACHE_2_TEXT,
  MIT_BODY,
  SHARED_LABEL,
  cutShared,
  noticeFor,
  renderNotices,
  resolvePackage,
  uniqueNotices,
} from '../../../scripts/licence-notices.mjs'
import type { PackageNotice } from '../../../scripts/licence-notices.mjs'

/** Repo-relative from this file's directory (web/src/components/guide). */
const WEB = new URL('../../../', import.meta.url).pathname
const MOBILE = new URL('../../../../mobile/', import.meta.url).pathname

describe('cutting a shared licence body out of a package file', () => {
  it('keeps the copyright line and leaves a pointer where the MIT body was', () => {
    const file = `MIT License\n\nCopyright (c) 2024 Someone\n\n${MIT_BODY.replace(/\n/g, ' ')}\n`
    const cut = cutShared(file, ['MIT'])
    expect(cut.shared).toEqual(['MIT'])
    expect(cut.text).toContain('Copyright (c) 2024 Someone')
    expect(cut.text).toContain(SHARED_LABEL.MIT)
    expect(cut.text).not.toContain('Permission is hereby granted')
  })

  it('matches across curly quotes and rewrapped lines, which copies differ by', () => {
    const curly = MIT_BODY.replace(/"/g, '“').replace(/\n/g, '\n   ')
    expect(cutShared(`Copyright X\n\n${curly}`, ['MIT']).shared).toEqual(['MIT'])
  })

  it('leaves a variant wording whole rather than cutting it to a near match', () => {
    // The last sentence without its full stop — @types packages and `clone`
    // ship exactly this, and a pointer to a text that is not theirs would be wrong.
    const variant = `Copyright X\n\n${MIT_BODY.replace(/SOFTWARE\.$/, 'SOFTWARE')}`
    const cut = cutShared(variant, ['MIT'])
    expect(cut.shared).toEqual([])
    expect(cut.text).toContain('Permission is hereby granted')
  })

  it('cuts the Apache terms and appendix but keeps a filled-in copyright header', () => {
    const file = `${APACHE_2_TEXT}\n\n   Copyright 2022 Joe Bell\n`
    const cut = cutShared(file, ['Apache-2.0'])
    expect(cut.shared).toEqual(['Apache-2.0'])
    expect(cut.text).toContain('Copyright 2022 Joe Bell')
    expect(cut.text).not.toContain('TERMS AND CONDITIONS FOR USE')
  })

  // web-vitals, exponential-backoff, human-signals and the chrome launchers
  // write their copyright line into Apache's appendix rather than a header.
  // Cutting the appendix whole dropped those lines from the phone's notices;
  // only the unfilled placeholder appendix is boilerplate.
  it('keeps an appendix whose copyright line is filled in, and cuts only the placeholder one', () => {
    const terms = APACHE_2_TEXT.slice(
      0,
      APACHE_2_TEXT.indexOf('END OF TERMS AND CONDITIONS') + 'END OF TERMS AND CONDITIONS'.length,
    )
    const appendix = (owner: string) =>
      [
        '   APPENDIX: How to apply the Apache License to your work.',
        '',
        '      To apply the Apache License to your work, attach the following',
        '      boilerplate notice.',
        '',
        `   Copyright ${owner}`,
        '',
        '   Licensed under the Apache License, Version 2.0 (the "License");',
        '   you may not use this file except in compliance with the License.',
        '   See the License for the specific language governing permissions and',
        '   limitations under the License.',
      ].join('\n')

    const filled = cutShared(`${terms}\n\n${appendix('2020 Google LLC')}\n`, ['Apache-2.0'])
    expect(filled.shared).toEqual(['Apache-2.0'])
    expect(filled.text).toContain('Copyright 2020 Google LLC')
    expect(filled.text).not.toContain('TERMS AND CONDITIONS FOR USE')

    for (const placeholder of [
      '[yyyy] [name of copyright owner]',
      '{yyyy} {name of copyright owner}',
    ]) {
      const cut = cutShared(`${terms}\n\n${appendix(placeholder)}\n`, ['Apache-2.0'])
      expect(cut.text).toBe(`[${SHARED_LABEL['Apache-2.0']}]`)
    }
  })

  it('does not cut a body it was not asked to', () => {
    expect(cutShared(`Copyright X\n\n${MIT_BODY}`, ['Apache-2.0']).shared).toEqual([])
  })
})

describe('one package’s notice, read from node_modules', () => {
  it('prints pdf.js’s Apache terms once rather than per package', () => {
    const dir = resolvePackage('pdfjs-dist', WEB)
    if (dir === null) return // Not installed in this checkout.
    const n = noticeFor(dir)
    expect(n.licence).toBe('Apache-2.0')
    expect(n.shared).toEqual(['Apache-2.0'])
    expect(n.texts[0]?.text).toContain(SHARED_LABEL['Apache-2.0'])
  })

  it('says so when a package ships no licence file, and attaches the terms it states', () => {
    const dir = resolvePackage('react-remove-scroll-bar', WEB)
    if (dir === null) return
    const n = noticeFor(dir)
    expect(n.texts).toEqual([])
    expect(n.missing).toMatch(/ships no licence file.*MIT/)
    expect(n.shared).toEqual(['MIT'])
  })

  it('attaches the full Apache text to a package whose file is only the short header', () => {
    // @react-native-firebase ships "Licensed under the Apache License … you
    // may obtain a copy at <url>"; §4(a) wants the copy, not the URL.
    const dir = resolvePackage('@react-native-firebase/app', MOBILE)
    if (dir === null) return
    const n = noticeFor(dir, ['Apache-2.0', 'MIT', 'ISC'])
    expect(n.texts[0]?.text).toContain('Invertase')
    expect(n.shared).toContain('Apache-2.0')
  })
})

describe('the rendered notices file', () => {
  const pkg = (
    name: string,
    version: string,
    over: Partial<PackageNotice> = {},
  ): PackageNotice => ({
    name,
    version,
    licence: 'MIT',
    texts: [{ file: 'LICENSE', text: `Copyright ${name}` }],
    notices: [],
    missing: null,
    shared: [],
    ...over,
  })

  it('lists each package once per version, in name order', () => {
    const notices = uniqueNotices([pkg('b', '1'), pkg('a', '2'), pkg('a', '1'), pkg('b', '1')])
    expect(notices.map((n) => `${n.name}@${n.version}`)).toEqual(['a@1', 'a@2', 'b@1'])
  })

  it('prints a shared body only when a package points at it, and only once', () => {
    const text = renderNotices({
      title: 'T',
      preface: 'P',
      notices: [
        pkg('x', '1', { licence: 'Apache-2.0', shared: ['Apache-2.0'] }),
        pkg('y', '1', { licence: 'Apache-2.0', shared: ['Apache-2.0'] }),
      ],
    })
    expect(text.split('END OF TERMS AND CONDITIONS')).toHaveLength(2)
    expect(text).not.toContain('Permission is hereby granted')
    expect(text).toContain('x 1 — Apache-2.0')
    expect(text).toContain(SHARED_LABEL['Apache-2.0'])
  })

  it('carries NOTICE files and the extra sections verbatim', () => {
    const text = renderNotices({
      title: 'T',
      preface: 'P',
      notices: [pkg('z', '1', { notices: [{ file: 'NOTICE', text: 'Z attribution' }] })],
      extra: [{ heading: 'Model', text: 'CC BY 4.0 credit' }],
    })
    expect(text).toContain('Z attribution')
    expect(text).toContain('CC BY 4.0 credit')
  })
})
