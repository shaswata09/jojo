/**
 * The phone's third-party notices, as the Built with page reads them.
 *
 * The data is `third-party-notices.json`, written by
 * `mobile/scripts/third-party-notices.mjs` from the production dependency tree
 * and the committed native inventory (`mobile/scripts/native-inventory.json`:
 * the Maven artefacts in the APK and the CocoaPods pods in the iOS app), and
 * checked in; `third-party-notices.test.ts` regenerates it and fails when the
 * two differ. This module is the part the screen needs and a test can run
 * without React Native: the shape, the filter and the licence tally.
 *
 * Loaded with `require` inside a function rather than imported, for two
 * reasons. The file is a few hundred kilobytes, and nobody who never opens the
 * licences should pay to parse it at launch (Metro's `inlineRequires` would
 * defer an import too, but this does not depend on a bundler setting). And a
 * typed `import` of the JSON makes TypeScript infer a literal type for 683
 * entries on every check, for nothing the declared type below does not say.
 */

export type SharedKind = 'Apache-2.0' | 'MIT' | 'ISC'

export type NoticeText = { file: string; text: string }

/** One installed package: what it states, and the files it ships, verbatim. */
export type PackageNotice = {
  name: string
  version: string
  /** As the manifest states it. `null` when it states none. */
  licence: string | null
  /** Its licence files, with any shared body cut out and a pointer left. */
  texts: NoticeText[]
  /** Its NOTICE files, which Apache-2.0 §4(d) asks to be passed on. */
  notices: NoticeText[]
  /** Set when the package ships no licence file, saying what the manifest states. */
  missing: string | null
  /** The shared bodies this package's notice points at. */
  shared: SharedKind[]
}

/**
 * One native library: a Maven artefact (`group:artifact`) in the Android app or
 * a pod in the iOS app. The same fields as a package — `licence` is the SPDX id
 * when the POM or podspec names one unambiguously, otherwise its words as
 * stated — plus the third-party code it carries inside it.
 */
export type NativeNotice = PackageNotice & {
  /** Keys into `native.bundled`: what Google lists in the artefact's third_party_licenses, or what React Native compiles into its native library. */
  bundled: string[]
}

export type Notices = {
  about: string
  /** Each shared licence body, printed once. */
  shared: Partial<Record<SharedKind, string>>
  /** What ships that is neither an npm package nor a native library — the fonts — and Google's terms. */
  extra: { heading: string; text: string }[]
  native: {
    android: NativeNotice[]
    ios: NativeNotice[]
    /** Each bundled text, as indexes into `parts` — its sections, stored once across all of them. */
    bundled: Record<string, number[]>
    parts: string[]
  }
  packages: PackageNotice[]
}

let cache: Notices | null = null

/** The notices, parsed on first use. */
export function loadNotices(): Notices {
  cache ??= require('./third-party-notices.json') as Notices
  return cache
}

/**
 * The packages whose name or stated licence contains `query`, case aside.
 * An empty query is every package.
 */
export function filterNotices<T extends PackageNotice>(packages: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...packages]
  return packages.filter(
    (p) => p.name.toLowerCase().includes(q) || (p.licence ?? '').toLowerCase().includes(q),
  )
}

/**
 * How many packages state each licence, most first — the one line that tells
 * a reader the shape of the list before they open it. Ties in name order, so
 * the line does not reshuffle between builds with the same counts.
 */
export function licenceTally(packages: readonly PackageNotice[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const p of packages) {
    const key = p.licence ?? 'none stated'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
}

/** The rule Google's third_party_licenses.txt draws between sections, put back between the stored parts. */
const SECTION_RULE = '\n------------------\n'

/**
 * The full text one row expands to: its files, its NOTICE, the third-party
 * code bundled inside it (native rows only), then the shared bodies it points at.
 */
export function noticeBody(
  notice: PackageNotice | NativeNotice,
  shared: Notices['shared'],
  native?: Pick<Notices['native'], 'bundled' | 'parts'>,
): string {
  const parts: string[] = []
  if (notice.missing) parts.push(notice.missing)
  for (const t of notice.texts) parts.push(`${t.file}\n\n${t.text}`)
  for (const t of notice.notices) parts.push(`${t.file}\n\n${t.text}`)
  if ('bundled' in notice && native) {
    for (const name of notice.bundled) {
      const sections = native.bundled[name]
      if (sections) {
        parts.push(`${name}\n\n${sections.map((i) => native.parts[i] ?? '').join(SECTION_RULE)}`)
      }
    }
  }
  for (const kind of notice.shared) {
    const text = shared[kind]
    if (text) parts.push(`${kind}\n\n${text}`)
  }
  return parts.join('\n\n')
}
