/**
 * The phone's third-party notices, as the Built with page reads them.
 *
 * The data is `third-party-notices.json`, written by
 * `mobile/scripts/third-party-notices.mjs` from the production dependency tree
 * and checked in; `third-party-notices.test.ts` regenerates it and fails when
 * the two differ. This module is the part the screen needs and a test can run
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

export type Notices = {
  about: string
  /** Each shared licence body, printed once. */
  shared: Partial<Record<SharedKind, string>>
  /** What ships that is not an npm package — the fonts, the native SDKs. */
  extra: { heading: string; text: string }[]
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
export function filterNotices(packages: readonly PackageNotice[], query: string): PackageNotice[] {
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

/** The full text one package's row expands to: its files, its NOTICE, then the shared bodies it points at. */
export function noticeBody(notice: PackageNotice, shared: Notices['shared']): string {
  const parts: string[] = []
  if (notice.missing) parts.push(notice.missing)
  for (const t of notice.texts) parts.push(`${t.file}\n\n${t.text}`)
  for (const t of notice.notices) parts.push(`${t.file}\n\n${t.text}`)
  for (const kind of notice.shared) {
    const text = shared[kind]
    if (text) parts.push(`${kind}\n\n${text}`)
  }
  return parts.join('\n\n')
}
