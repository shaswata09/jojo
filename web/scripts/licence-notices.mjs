/**
 * The third-party notices that have to travel with what jojo ships.
 *
 * ## Why this exists
 *
 * MIT, ISC and BSD ask that a package's copyright line and permission notice go
 * wherever the code goes; Apache-2.0 asks for a copy of the licence and of any
 * NOTICE file (§4(a), §4(d)). A minifier strips every licence comment from the
 * bundle, so the only place those texts can reach a person who loaded the web
 * app or installed the APK is a file shipped beside the code. Before this file
 * neither app shipped one: the web build put nothing next to its chunks, and the
 * APK carried the fonts' `OFL.txt` and nothing else for some 770 packages.
 *
 * ## Where it is used
 *
 *  - `web/vite.config.ts` (`jojo:licence-notices`) calls `noticeFor` for every
 *    package copy the production bundle contains — the same trace the
 *    `jojo:credited-bundle` check makes — and writes `THIRD-PARTY-NOTICES.txt`
 *    into `dist/` with `renderNotices`. Built from what was bundled, never from
 *    a hand-kept list, so a dependency that arrives three levels down arrives in
 *    the notices too.
 *  - `mobile/scripts/third-party-notices.mjs` calls `productionTree` on the
 *    phone app's manifest and writes the JSON the phone's Guide → Built with
 *    page shows. The phone has no build hook that sees its bundle the way Vite
 *    does, so it takes the whole production dependency tree instead — more than
 *    Metro bundles (native-only and build-time packages are in it), which errs
 *    toward crediting too much rather than too little.
 *
 * ## What it reads
 *
 * Each package's own licence file (`LICENSE`, `LICENCE`, `COPYING`, with any
 * extension) and NOTICE file, verbatim. Where a package ships no licence file
 * the manifest's `license` field is what it states, and the notice says so
 * rather than inventing a copyright line — the same rule `credits.ts` follows.
 *
 * ## Deduplication
 *
 * The full Apache-2.0 text runs to eleven thousand words, and several packages
 * carry it word for word. Repeating it per package is what makes a notices file
 * nobody can read, so the terms are printed once and each Apache package keeps
 * whatever else its file says (its copyright line, its NOTICE). The phone does
 * the same for the MIT and ISC permission notices, because there the file is
 * part of the JavaScript bundle and 600 copies of three identical paragraphs
 * would be most of it. A body is only cut out where it matches the canonical
 * text word for word (quote style and line wrapping aside); a variant keeps its
 * own wording in full, which is always the safe direction.
 *
 * Deterministic on purpose: no dates, no absolute paths, packages sorted by name
 * and version. The phone's generated file is checked in, and a test regenerates
 * it and compares, so it can only go stale loudly.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The repository's own LICENSE: the standard Apache-2.0 text, unmodified. */
export const APACHE_2_TEXT = clean(readFileSync(join(REPO, 'LICENSE'), 'utf8'))

/** The MIT permission notice, as nearly every MIT package words it. */
export const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

/** The ISC permission notice. */
export const ISC_BODY = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`

/** The texts a notice may print once and point at, by SPDX id. */
export const SHARED_TEXTS = { 'Apache-2.0': APACHE_2_TEXT, MIT: MIT_BODY, ISC: ISC_BODY }

/** CRLF, a BOM, trailing spaces and surrounding blank lines are not part of a licence. */
function clean(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * A pattern matching `body` word for word, whatever the line wrapping, quote
 * style or letter case — the three ways copies of one licence differ.
 */
function wordPattern(body) {
  const words = body.split(/\s+/).filter(Boolean)
  const parts = words.map((word) =>
    word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/["'“”‘’]/g, `["'“”‘’]`),
  )
  return new RegExp(parts.join('\\s+'), 'i')
}

const MIT_PATTERN = wordPattern(MIT_BODY)
const ISC_PATTERN = wordPattern(ISC_BODY)
/**
 * The Apache-2.0 terms: from the title to "END OF TERMS AND CONDITIONS", and
 * the appendix after it, captured separately so `cutShared` can decide whether
 * it goes too. Cut only when the title and the closing line are both there, so
 * a file that merely mentions the licence keeps every word.
 *
 * The appendix is how-to boilerplate only while it still holds the
 * `[yyyy] [name of copyright owner]` placeholder. Many packages fill it in
 * instead — web-vitals' LICENSE ends "Copyright 2020 Google LLC" there, and so
 * do exponential-backoff, human-signals and the chrome launchers — and that
 * filled-in line is the package's only copyright notice. Cutting the appendix
 * whole lost it from the phone's notices, so a filled-in appendix is kept
 * verbatim after the pointer.
 */
const APACHE_PATTERN =
  /[ \t]*Apache License\s+Version 2\.0, January 2004[\s\S]*?END OF TERMS AND CONDITIONS(\s*APPENDIX: How to apply the Apache License to your work\.[\s\S]*?limitations under the License\.)?/i

/** The appendix's unfilled placeholder, in either bracket style Apache's copies use. */
const APPENDIX_PLACEHOLDER =
  /\[yyyy\]\s+\[name of copyright owner\]|\{yyyy\}\s+\{name of copyright owner\}/i

/** Which shared body each pattern stands for. */
const CUTTERS = { 'Apache-2.0': APACHE_PATTERN, MIT: MIT_PATTERN, ISC: ISC_PATTERN }

/**
 * Takes the shared licence bodies named in `kinds` out of `text`, leaving what
 * is particular to the package — its copyright lines, mostly.
 *
 * Returns the remainder and which bodies were cut, so the reader can be told
 * where the rest of the text is.
 */
export function cutShared(text, kinds) {
  let rest = text
  const shared = []
  for (const kind of kinds) {
    const pattern = CUTTERS[kind]
    if (pattern === undefined || !pattern.test(rest)) continue
    // Only the Apache pattern has a group: an appendix to keep unless it is
    // still the placeholder boilerplate.
    rest = rest.replace(pattern, (_whole, appendix) => {
      const keep = typeof appendix === 'string' && !APPENDIX_PLACEHOLDER.test(appendix)
      return `[${SHARED_LABEL[kind]}]${keep ? appendix : ''}`
    })
    shared.push(kind)
  }
  return { text: clean(rest.replace(/\n{3,}/g, '\n\n')), shared }
}

/** The placeholder left where a shared body was cut out. */
export const SHARED_LABEL = {
  'Apache-2.0': 'The Apache License 2.0 terms, printed once under "Apache License 2.0"',
  MIT: 'The MIT permission notice, printed once under "MIT"',
  ISC: 'The ISC permission notice, printed once under "ISC"',
}

const LICENCE_FILE = /^(?:un)?licen[cs]e(?:[-._].*)?$|^copying(?:[-._].*)?$/i
const NOTICE_FILE = /^notice(?:[-._].*)?$/i
/** A file whose name looks like a licence but is code, types or data. */
const NOT_TEXT = /\.(?:[cm]?[jt]sx?|json|map|d\.ts|html?|png|svg)$/i

/** A package's licence and NOTICE files, verbatim, in name order. */
export function licenceFiles(dir) {
  const files = readdirSync(dir)
    .filter((name) => !NOT_TEXT.test(name))
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isFile()
      } catch {
        return false
      }
    })
    .sort()
  const read = (name) => ({ file: name, text: clean(readFileSync(join(dir, name), 'utf8')) })
  return {
    licence: files.filter((name) => LICENCE_FILE.test(name)).map(read),
    notice: files.filter((name) => NOTICE_FILE.test(name)).map(read),
  }
}

/** The licence a manifest states, as one string: SPDX, the legacy object, or the legacy array. */
export function statedLicence(manifest) {
  const one = (value) =>
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && typeof value.type === 'string'
        ? value.type
        : null
  if (manifest.license !== undefined) return one(manifest.license)
  if (Array.isArray(manifest.licenses)) {
    const all = manifest.licenses.map(one).filter((v) => v !== null)
    return all.length > 0 ? all.join(' OR ') : null
  }
  return null
}

/** `author` as the manifest gives it: a string, or `{ name, email }`. */
function statedAuthor(manifest) {
  const a = manifest.author
  if (typeof a === 'string') return a
  if (a && typeof a === 'object' && typeof a.name === 'string') return a.name
  return null
}

/**
 * One package's notice.
 *
 * `share` names the licence bodies to print once rather than per package
 * (see "Deduplication" above). `shared` in the result lists the ones this
 * package points at — cut from its file, or, where it ships no file, the body
 * its stated licence names, so a package with only a manifest still arrives
 * with its terms.
 */
export function noticeFor(dir, share = ['Apache-2.0']) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const licence = statedLicence(manifest)
  const files = licenceFiles(dir)
  const shared = new Set()
  const texts = files.licence.map(({ file, text }) => {
    const cut = cutShared(text, share)
    for (const kind of cut.shared) shared.add(kind)
    return { file, text: cut.text }
  })
  let missing = null
  if (texts.length === 0) {
    const author = statedAuthor(manifest)
    missing =
      `This package ships no licence file. Its manifest states ${licence ?? 'no licence'}` +
      (author ? ` and names ${author} as its author.` : '.')
    // The terms it states, so the notice is complete without the file.
    for (const kind of Object.keys(SHARED_TEXTS)) if (licence === kind) shared.add(kind)
  } else if (licence === 'Apache-2.0') {
    // An Apache package whose file is only the short "Licensed under the
    // Apache License … you may obtain a copy at" header (the
    // @react-native-firebase modules) still owes the reader the licence
    // itself under §4(a). A URL is not a copy, so the full text is attached.
    shared.add('Apache-2.0')
  }
  return {
    name: manifest.name,
    version: manifest.version,
    licence,
    texts,
    notices: files.notice,
    missing,
    shared: [...shared].sort(),
  }
}

/** Sort by name, then version, so two runs over one install are byte-identical. */
export function byNameAndVersion(a, b) {
  return a.name < b.name
    ? -1
    : a.name > b.name
      ? 1
      : a.version < b.version
        ? -1
        : a.version > b.version
          ? 1
          : 0
}

/**
 * The folder Node would load package `name` from, starting at `from` and
 * climbing no higher than `top` — or `null` when it is not installed. Through
 * the package's folder rather than `require.resolve`, because a package whose
 * `exports` map hides `package.json` cannot be resolved that way.
 */
export function resolvePackage(name, from, top = REPO) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return realpathSync(dirname(candidate))
    if (dir === top || dirname(dir) === dir) return null
  }
}

/**
 * Every package the production dependency tree of `root` installs, once per
 * folder, the way Node would resolve it.
 *
 * The same walk `npm ls --omit=dev --all --parseable` does, done here so the
 * generator and its test need nothing but the filesystem: `dependencies`,
 * `optionalDependencies` and `peerDependencies` (npm installs peers), resolved
 * from each package's own folder upward. A peer or an optional package that is
 * not installed is skipped, as npm skips it. jojo's own workspace packages are
 * walked through but not listed — they are jojo, under the project's licence.
 *
 * `root` is the folder holding the app's package.json; `top` is the outermost
 * folder resolution may climb to (the repository).
 */
export function productionTree(root, top = REPO) {
  const found = new Map()
  const seen = new Set()
  const resolve = (name, from) => resolvePackage(name, from, top)
  const visit = (dir, isRoot) => {
    if (seen.has(dir)) return
    seen.add(dir)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const own = isRoot || !dir.split(sep).includes('node_modules')
    if (!own) found.set(dir, { name: manifest.name, version: manifest.version, dir })
    const names = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...(isRoot ? [] : Object.keys(manifest.peerDependencies ?? {})),
    ])
    for (const name of [...names].sort()) {
      const at = resolve(name, dir)
      if (at !== null) visit(at, false)
    }
  }
  visit(realpathSync(root), true)
  return [...found.values()].sort(byNameAndVersion)
}

/**
 * The same package at the same version, installed twice, is one notice: the
 * files are the same files. Different versions stay separate entries.
 */
export function uniqueNotices(notices) {
  const out = new Map()
  for (const notice of notices) {
    const key = `${notice.name}@${notice.version}`
    if (!out.has(key)) out.set(key, notice)
  }
  return [...out.values()].sort(byNameAndVersion)
}

const RULE = '='.repeat(78)
const THIN = '-'.repeat(78)

/**
 * A plain-text notices file: a preface, the shared bodies the packages point
 * at, then one section per package.
 *
 * Plain text rather than HTML or Markdown because it is a legal text first: it
 * reads the same in a browser tab, a terminal and a file viewer, and there is
 * no markup in it that could change what a sentence says.
 */
export function renderNotices({ title, preface, notices, extra = [] }) {
  const used = new Set(notices.flatMap((n) => n.shared))
  const lines = [title, RULE, '', preface.trim(), '']
  for (const kind of Object.keys(SHARED_TEXTS)) {
    if (!used.has(kind)) continue
    const heading = kind === 'Apache-2.0' ? 'Apache License 2.0' : kind
    lines.push(RULE, heading, RULE, '', SHARED_TEXTS[kind], '')
  }
  for (const section of extra) {
    lines.push(RULE, section.heading, RULE, '', section.text.trim(), '')
  }
  lines.push(RULE, `Packages (${String(notices.length)})`, RULE, '')
  for (const n of notices) {
    lines.push(THIN, `${n.name} ${n.version} — ${n.licence ?? 'no licence stated'}`, THIN, '')
    if (n.missing) lines.push(n.missing, '')
    for (const t of n.texts) lines.push(`${t.file}:`, '', t.text, '')
    for (const t of n.notices) lines.push(`${t.file}:`, '', t.text, '')
    for (const kind of n.shared) {
      if (!n.texts.some((t) => t.text.includes(SHARED_LABEL[kind])))
        lines.push(`[${SHARED_LABEL[kind]}]`, '')
    }
  }
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}
