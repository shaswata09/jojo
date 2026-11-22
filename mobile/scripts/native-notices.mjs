/**
 * The native half of the phone's licence notices: the Maven artefacts Gradle
 * packages into the APK and the CocoaPods pods linked into the iOS app.
 *
 * Neither is an npm package, so `productionTree` cannot see them, and neither
 * can be read cheaply: the Android list is whatever Gradle resolves for the
 * release runtime classpath, and the licences sit in POMs and AARs in the Gradle
 * cache. So this splits in two.
 *
 * - `collectInventory` (run by `third-party-notices.mjs --native`) does the
 *   expensive part — runs Gradle, reads POMs, unzips AARs and JARs, reads the
 *   CocoaPods acknowledgements — and writes everything it learned, texts
 *   verbatim, to `native-inventory.json` beside this file, which is committed.
 * - `nativeSection` turns that inventory into the `native` section of
 *   `third-party-notices.json`. It reads nothing but the inventory, so the test
 *   can regenerate the notices with no Gradle, no Xcode and no network.
 *
 * `androidInputs` and `lockedPods` are the cheap checks the test runs to tell
 * whether the inventory still describes the build: the dependency lines in the
 * Gradle files and the versions of the npm packages that carry Android code,
 * and the pods `Podfile.lock` (tracked) resolves. When either moves, the
 * inventory is stale and `--native` has to run again.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cutShared, productionTree } from '../../web/scripts/licence-notices.mjs'

const MOBILE = dirname(dirname(fileURLToPath(import.meta.url)))
export const INVENTORY = join(MOBILE, 'scripts', 'native-inventory.json')
const ANDROID = join(MOBILE, 'android')
const IOS = join(MOBILE, 'ios')
const ACKNOWLEDGEMENTS = join(
  IOS,
  'Pods',
  'Target Support Files',
  'Pods-jojo',
  'Pods-jojo-acknowledgements.plist',
)

/** CRLF, a BOM, trailing spaces and surrounding blank lines are not part of a licence. */
function clean(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+|\n+$/g, '')
}

// ---------------------------------------------------------------------------
// The cheap checks: what the inventory was built from.
// ---------------------------------------------------------------------------

/** A Gradle line that adds something to what the APK packages, or picks a version of it. */
const DECLARATION = /^(?:implementation|api|runtimeOnly|releaseImplementation|releaseRuntimeOnly|kotlinVersion)\b/
/** The gradle.properties switches that change which artefacts are packaged. */
const SWITCH = /^(?:hermesEnabled|newArchEnabled)=/

/**
 * What decides the Android list, short of running Gradle: the dependency lines
 * in the two build files, the two switches in gradle.properties, and every npm
 * package with Android code of its own (React Native and the autolinked
 * modules, whose Gradle files pull in most of the list — Firebase's versions
 * come from `@react-native-firebase/app`'s package.json, so its version stands
 * for them). A change to any of these can change the classpath.
 */
export function androidInputs() {
  const declarations = []
  for (const file of ['build.gradle', join('app', 'build.gradle'), 'gradle.properties']) {
    for (const raw of readFileSync(join(ANDROID, file), 'utf8').split('\n')) {
      const line = raw.trim()
      if (DECLARATION.test(line) || SWITCH.test(line)) {
        declarations.push(`${file.split('\\').join('/')}: ${line}`)
      }
    }
  }
  const nativeModules = productionTree(MOBILE)
    .filter(
      (p) =>
        p.name === 'react-native' ||
        existsSync(join(p.dir, 'android', 'build.gradle')) ||
        existsSync(join(p.dir, 'android', 'build.gradle.kts')),
    )
    .map((p) => `${p.name}@${p.version}`)
  return { declarations, nativeModules: [...new Set(nativeModules)].sort() }
}

/**
 * The pods `Podfile.lock` resolves that are not npm packages: everything from
 * the CocoaPods trunk, and the C++ libraries React Native fetches through its
 * own podspecs (`:podspec:` under EXTERNAL SOURCES). The pods with a `:path:`
 * into node_modules — React Native's own and the modules' — are npm packages,
 * credited in the npm list. One entry per pod, subspecs folded into it.
 */
export function lockedPods(lockfile = readFileSync(join(IOS, 'Podfile.lock'), 'utf8')) {
  // A leading newline so the first section (PODS, on line one) matches like the rest.
  const lock = `\n${lockfile.replace(/\r\n?/g, '\n')}`
  const section = (name) => {
    const start = lock.indexOf(`\n${name}:\n`)
    if (start < 0) return ''
    const rest = lock.slice(start + name.length + 3)
    const end = rest.search(/\n\S/)
    return end < 0 ? rest : rest.slice(0, end)
  }
  const versions = new Map()
  for (const m of section('PODS').matchAll(/^ {2}- "?([^\s"(]+) \(([^)]+)\)/gm)) {
    const root = m[1].split('/')[0]
    if (!versions.has(root)) versions.set(root, m[2])
  }
  const sources = new Map()
  for (const m of section('SPEC REPOS').matchAll(/^ {4}- "?([^\s"]+)"?$/gm)) {
    sources.set(m[1], 'trunk')
  }
  let current = null
  for (const line of section('EXTERNAL SOURCES').split('\n')) {
    const name = /^ {2}"?([^\s":]+)"?:$/.exec(line)
    if (name) current = name[1]
    else if (current && /^ {4}:podspec:/.test(line)) sources.set(current, 'podspec')
  }
  return [...sources.entries()]
    .filter(([name]) => versions.has(name))
    .map(([name, source]) => ({ name, version: versions.get(name), source }))
    .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1))
}

// ---------------------------------------------------------------------------
// The expensive part: run only by `--native`.
// ---------------------------------------------------------------------------

const id = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** Every line of the init script's output, by tag. */
function runGradle(online) {
  const args = [
    '-q',
    ...(online ? [] : ['--offline']),
    '-I',
    join(MOBILE, 'scripts', 'native-inventory.gradle'),
    ':app:jojoNativeInventory',
  ]
  const out = execFileSync(join(ANDROID, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), args, {
    cwd: ANDROID,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const lines = { artifact: [], component: [], pom: [], nopom: [] }
  for (const line of out.split('\n')) {
    const m = /^JOJO-(ARTIFACT|COMPONENT|POM|NOPOM)\t(.*)$/.exec(line)
    if (m) lines[m[1].toLowerCase()].push(m[2].split('\t'))
  }
  return lines
}

/** The text inside the first `<tag>` of `xml`, or null. */
const first = (xml, tag) => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)
  return m ? m[1].trim() : null
}
const all = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) =>
    m[1].trim(),
  )
const unxml = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

/** What one POM says about licences and authorship, and its parent. */
function readPom(path) {
  const xml = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  // Top-level elements only: a developer's <organization> is not the project's.
  const top = xml
    .replace(/<developers>[\s\S]*?<\/developers>/g, '')
    .replace(/<contributors>[\s\S]*?<\/contributors>/g, '')
    .replace(/<dependencies>[\s\S]*?<\/dependencies>/g, '')
    .replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '')
  const licences = all(first(top, 'licenses') ?? '', 'license').map((l) => ({
    name: unxml(first(l, 'name') ?? ''),
    url: unxml(first(l, 'url') ?? '') || null,
  }))
  const organisation = first(top, 'organization')
  const developers = all(first(xml, 'developers') ?? '', 'developer')
    .map((d) => unxml(first(d, 'name') ?? first(d, 'organization') ?? first(d, 'id') ?? ''))
    .filter(Boolean)
  const parent = first(top, 'parent')
  return {
    licences: licences.filter((l) => l.name || l.url),
    organisation: organisation ? unxml(first(organisation, 'name') ?? '') || null : null,
    developers: [...new Set(developers)],
    parent: parent
      ? `${unxml(first(parent, 'groupId') ?? '')}:${unxml(first(parent, 'artifactId') ?? '')}:${unxml(first(parent, 'version') ?? '')}`
      : null,
  }
}

const LICENCE_FILE = /^(?:licen[cs]e|copying)(?:[-._].*)?$/i
const NOTICE_FILE = /^notice(?:[-._].*)?$/i
/** A name that looks like a licence but is code or data (Bouncy Castle ships `LICENSE.class`). */
const NOT_TEXT = /\.(?:class|kt|java|json|html?|xml|properties|so|dex)$/i

const unzipList = (zip) => {
  try {
    return execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}
const unzipRead = (zip, entry) =>
  execFileSync('unzip', ['-p', zip, entry], { maxBuffer: 64 * 1024 * 1024 })

/**
 * The licence and NOTICE files inside one artefact, and the third-party
 * licences Google's artefacts list in `third_party_licenses.{json,txt}` for the
 * code they bundle. An AAR's own entries and its `classes.jar`'s both count.
 */
function filesIn(path, scratch, store) {
  const licenceFiles = []
  const noticeFiles = []
  const bundled = []
  const visit = (zip, prefix) => {
    const entries = unzipList(zip)
    for (const entry of entries) {
      const name = basename(entry)
      if (entry.endsWith('/') || NOT_TEXT.test(name)) continue
      const kind = LICENCE_FILE.test(name) ? licenceFiles : NOTICE_FILE.test(name) ? noticeFiles : null
      if (kind) kind.push({ file: prefix + entry, text: store(clean(unzipRead(zip, entry).toString('utf8'))) })
    }
    if (entries.includes('third_party_licenses.json') && entries.includes('third_party_licenses.txt')) {
      const index = JSON.parse(unzipRead(zip, 'third_party_licenses.json').toString('utf8'))
      const body = unzipRead(zip, 'third_party_licenses.txt')
      for (const [name, at] of Object.entries(index)) {
        // Offsets are bytes into the .txt, not characters.
        const text = clean(body.subarray(at.start, at.start + at.length).toString('utf8'))
        bundled.push({ name, text: store(text) })
      }
    }
    return entries
  }
  const entries = visit(path, '')
  if (path.endsWith('.aar') && entries.includes('classes.jar')) {
    const inner = join(scratch, 'classes.jar')
    writeFileSync(inner, unzipRead(path, 'classes.jar'))
    visit(inner, 'classes.jar!/')
  }
  const order = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
  return {
    licenceFiles: licenceFiles.sort(order),
    noticeFiles: noticeFiles.sort(order),
    bundled: bundled.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.text < b.text ? -1 : 1)),
    entries,
  }
}

/**
 * The C++ libraries React Native compiles into `libreactnative.so`. They are
 * not Maven artefacts — react-android carries them inside its native library —
 * but its AAR ships their headers under `prefab/modules/reactnative/include/`,
 * which is what this checks for, and react-native's own version catalog names
 * the versions built. Each points at the iOS pod of the same project for its
 * licence text, because that pod is where a copy of the file is on disk.
 */
const COMPILED_IN = [
  { key: 'boost', name: 'boost', include: 'boost', pod: 'boost' },
  { key: 'doubleconversion', name: 'double-conversion', include: 'double-conversion', pod: 'DoubleConversion' },
  { key: 'fastFloat', name: 'fast_float', include: 'fast_float', pod: 'fast_float' },
  { key: 'fmt', name: 'fmt', include: 'fmt', pod: 'fmt' },
  { key: 'folly', name: 'folly', include: 'folly', pod: 'RCT-Folly' },
  { key: 'glog', name: 'glog', include: 'glog', pod: 'glog' },
]

function compiledIntoReactAndroid(entries) {
  const reactNative = productionTree(MOBILE).find((p) => p.name === 'react-native')
  if (!reactNative) return []
  const catalog = readFileSync(join(reactNative.dir, 'gradle', 'libs.versions.toml'), 'utf8')
  return COMPILED_IN.flatMap((lib) => {
    const version = new RegExp(`^${lib.key}\\s*=\\s*"([^"]+)"`, 'm').exec(catalog)?.[1]
    const shipped = entries.some((e) => e.startsWith(`prefab/modules/reactnative/include/${lib.include}/`))
    return version && shipped ? [{ name: lib.name, version, include: lib.include, pod: lib.pod }] : []
  })
}

/** The CocoaPods acknowledgements plist, as { Title: { licence, text } }. */
function readAcknowledgements() {
  const xml = readFileSync(ACKNOWLEDGEMENTS, 'utf8')
  const out = new Map()
  for (const dict of xml.matchAll(/<dict>([\s\S]*?)<\/dict>/g)) {
    const fields = {}
    for (const m of dict[1].matchAll(/<key>([^<]*)<\/key>\s*<string>([\s\S]*?)<\/string>/g)) {
      fields[m[1]] = m[2]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
    }
    if (fields.Title) out.set(fields.Title, { licence: fields.License ?? null, text: clean(fields.FooterText ?? '') })
  }
  return out
}

/**
 * Runs Gradle and reads the Pods tree; returns the inventory to commit.
 * Throws, naming the fix, rather than writing an inventory with holes in it.
 */
export function collectInventory({ online = false } = {}) {
  const texts = {}
  const store = (text) => {
    const key = id(text)
    texts[key] = text
    return key
  }

  // ----- Android
  const g = runGradle(online)
  const files = new Map()
  for (const [coord, path] of g.artifact) {
    if (!files.has(coord)) files.set(coord, new Set())
    files.get(coord).add(path)
  }
  const poms = new Map(g.pom.map(([coord, path]) => [coord, path]))
  const missingPoms = g.nopom.map(([coord]) => coord)
  if (g.component.length === 0) throw new Error('Gradle reported no components — did the init script run?')

  const scratch = mkdtempSync(join(tmpdir(), 'jojo-native-notices-'))
  const artifacts = []
  const withoutFiles = []
  try {
    for (const [coord] of [...new Set(g.component.map((c) => c[0]))].sort().map((c) => [c])) {
      const paths = [...(files.get(coord) ?? [])].sort()
      if (paths.length === 0) {
        withoutFiles.push(coord)
        continue
      }
      // The licence, organisation and developers, from the POM or the nearest
      // parent that states them — as Maven inherits them.
      let licences = []
      let licencesFrom = null
      let organisation = null
      let developers = []
      for (let at = coord, hops = 0; at && hops < 10; hops++) {
        const path = poms.get(at)
        if (!path) {
          if (licences.length === 0) {
            throw new Error(
              `No POM for ${at} in the Gradle cache (${missingPoms.length} missing). Run once with --online to fetch them.`,
            )
          }
          break
        }
        const pom = readPom(path)
        if (licences.length === 0 && pom.licences.length > 0) {
          licences = pom.licences
          licencesFrom = at
        }
        organisation ??= pom.organisation
        if (developers.length === 0) developers = pom.developers
        if (licences.length > 0 && organisation && developers.length > 0) break
        at = pom.parent
      }
      const found = { licenceFiles: [], noticeFiles: [], bundled: [], entries: [] }
      for (const path of paths) {
        const one = filesIn(path, scratch, store)
        found.licenceFiles.push(...one.licenceFiles)
        found.noticeFiles.push(...one.noticeFiles)
        found.bundled.push(...one.bundled)
        found.entries.push(...one.entries)
      }
      const [group, module, version] = coord.split(':')
      artifacts.push({
        name: `${group}:${module}`,
        version,
        files: paths.map((p) => basename(p)),
        licences,
        licencesFrom,
        organisation,
        developers,
        licenceFiles: found.licenceFiles,
        noticeFiles: found.noticeFiles,
        bundled: found.bundled,
        compiledIn: coord.startsWith('com.facebook.react:react-android:')
          ? compiledIntoReactAndroid(found.entries)
          : [],
      })
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  // ----- iOS
  const lock = readFileSync(join(IOS, 'Podfile.lock'), 'utf8')
  const manifest = join(IOS, 'Pods', 'Manifest.lock')
  if (!existsSync(manifest) || readFileSync(manifest, 'utf8') !== lock) {
    throw new Error('ios/Pods does not match ios/Podfile.lock. Run `pod install` in mobile/ios first.')
  }
  const acks = readAcknowledgements()
  const pods = lockedPods(lock).map((pod) => {
    const ack = acks.get(pod.name)
    if (!ack) throw new Error(`${pod.name} is in Podfile.lock but not in the CocoaPods acknowledgements.`)
    return { ...pod, licence: ack.licence, text: ack.text ? store(ack.text) : null }
  })

  // Only the texts something still points at, in a stable order.
  const used = new Set()
  for (const a of artifacts) {
    for (const f of [...a.licenceFiles, ...a.noticeFiles, ...a.bundled]) used.add(f.text)
  }
  for (const p of pods) if (p.text) used.add(p.text)
  return {
    about:
      'Written by `node mobile/scripts/third-party-notices.mjs --native` from Gradle (release runtime classpath, POMs and artefacts in the Gradle cache) and the CocoaPods Pods tree. Committed so the notices can be regenerated without either. Do not edit by hand.',
    android: {
      inputs: androidInputs(),
      artifacts,
      withoutFiles,
    },
    ios: { pods },
    texts: Object.fromEntries([...used].sort().map((k) => [k, texts[k]])),
  }
}

// ---------------------------------------------------------------------------
// The inventory, as the phone shows it.
// ---------------------------------------------------------------------------

/**
 * A stated licence name as an SPDX id, when it names exactly one. Anything
 * this does not recognise stays as the source states it; nothing is guessed.
 */
export function spdxFor(name) {
  const key = name
    .toLowerCase()
    .replace(/\b(?:the|software|licen[cs]e|version|v)\b/g, '')
    .replace(/[\s,_-]+/g, '')
  return (
    {
      apache2: 'Apache-2.0',
      'apache2.0': 'Apache-2.0',
      mit: 'MIT',
      bsd3clause: 'BSD-3-Clause',
      bsd2clause: 'BSD-2-Clause',
      isc: 'ISC',
      zlib: 'Zlib',
      boost: 'BSL-1.0',
      'boost1.0': 'BSL-1.0',
      bsl1: 'BSL-1.0',
      'bsl1.0': 'BSL-1.0',
    }[key] ?? null
  )
}

const SHAREABLE = ['Apache-2.0', 'MIT', 'ISC']

/** `cutShared` takes one copy per kind; Google's bundled texts can hold several. */
function cutAll(text, shared) {
  let rest = text
  for (let i = 0; i < 20; i++) {
    const cut = cutShared(rest, SHAREABLE)
    if (cut.shared.length === 0) break
    for (const k of cut.shared) shared.add(k)
    rest = cut.text
  }
  return rest
}

/** "name (url)" for each licence a POM states, joined. */
const statedList = (licences) =>
  licences.map((l) => (l.url ? `${l.name || 'unnamed'} (${l.url})` : l.name)).join(', ')

/**
 * The `native` section of `third-party-notices.json`: one row per Android
 * artefact and per iOS pod, shaped like a package row so the screen draws both
 * the same way, plus the texts bundled inside them, stored once by name.
 */
export function nativeSection(inventory) {
  const texts = inventory.texts
  const bundled = {}
  const bundledKey = new Map()
  /** One key per distinct (name, text); a second text under one name gets " (2)". */
  const keep = (name, text) => {
    const k = `${name}\u0000${text}`
    if (bundledKey.has(k)) return bundledKey.get(k)
    let key = name
    for (let n = 2; key in bundled; n++) key = `${name} (${n})`
    bundled[key] = text
    bundledKey.set(k, key)
    return key
  }
  const podText = new Map(inventory.ios.pods.map((p) => [p.name, p]))

  const android = inventory.android.artifacts.map((a) => {
    const shared = new Set()
    const mapped = a.licences.map((l) => spdxFor(l.name) ?? (l.name || null))
    const licence = mapped.length === 0 || mapped.includes(null) ? null : [...new Set(mapped)].join(' AND ')
    const ownTexts = a.licenceFiles.map((f) => ({ file: f.file, text: cutAll(texts[f.text], shared) }))
    let missing = null
    if (ownTexts.length === 0) {
      const who = a.organisation ?? (a.developers.length > 0 ? a.developers.join(', ') : null)
      missing =
        a.licences.length > 0
          ? `This artifact ships no licence file. Its POM${a.licencesFrom && a.licencesFrom !== `${a.name}:${a.version}` ? ` (through its parent ${a.licencesFrom})` : ''} declares ${statedList(a.licences)}` +
            (who ? ` and names ${who} as its ${a.organisation ? 'organisation' : 'developers'}.` : '.')
          : 'This artifact ships no licence file and its POM declares no licence.'
    }
    // Where the artefact carries only a pointer or nothing, the terms its POM
    // names travel with it, as for an npm package with no file.
    for (const l of mapped) if (SHAREABLE.includes(l) && (ownTexts.length === 0 || l === 'Apache-2.0')) shared.add(l)
    const rows = a.bundled.map((b) => keep(b.name, cutAll(texts[b.text], shared)))
    for (const lib of a.compiledIn) {
      const pod = podText.get(lib.pod)
      const where = `Compiled into libreactnative.so; its headers ship in this artifact under prefab/modules/reactnative/include/${lib.include}.`
      const head = pod?.text
        ? `${where} The licence text below is the one the iOS build's ${lib.pod} ${pod.version} pod carries.`
        : `${where} No copy of its licence text was found (the iOS ${lib.pod} pod is not in the inventory).`
      const body = pod?.text ? cutAll(texts[pod.text], shared) : ''
      rows.push(keep(`${lib.name} ${lib.version}`, body ? `${head}\n\n${body}` : head))
    }
    return {
      name: a.name,
      version: a.version,
      licence,
      texts: ownTexts,
      notices: a.noticeFiles.map((f) => ({ file: f.file, text: texts[f.text] })),
      missing,
      shared: [...shared].sort(),
      bundled: [...new Set(rows)],
    }
  })

  const ios = inventory.ios.pods.map((p) => {
    const shared = new Set()
    // CocoaPods' "Copyright" type is a podspec that names no licence — the
    // closed-source Google pods — so it is not a licence id.
    const stated = p.licence && p.licence !== 'Copyright' ? p.licence : null
    const licence = stated ? (spdxFor(stated) ?? stated) : null
    const body = p.text ? cutAll(texts[p.text], shared) : null
    let missing = null
    if (!stated) {
      missing = `The podspec names no open-source licence${p.licence ? ` (its licence type is "${p.licence}")` : ''}; the text below is what it gives.`
    } else if (!body) {
      missing = `The podspec states ${stated} but CocoaPods found no licence text.`
    }
    if (!body && SHAREABLE.includes(licence)) shared.add(licence)
    if (licence === 'Apache-2.0') shared.add('Apache-2.0')
    return {
      name: p.name,
      version: p.version,
      licence,
      texts: body ? [{ file: 'LICENSE (CocoaPods acknowledgements)', text: body }] : [],
      notices: [],
      missing,
      shared: [...shared].sort(),
      bundled: [],
    }
  })

  // Google's bundled texts are long and overlap: the four "Kotlin" texts its
  // artefacts carry are one list of "Files: …" sections in different
  // combinations, and the long licences in them (LGPL, MPL, EPL) recur. Each
  // section is stored once, in `parts`, and each bundled text is the list of
  // its sections — half the size of storing the texts whole.
  const parts = []
  const partIndex = new Map()
  const names = Object.keys(bundled).sort()
  const split = Object.fromEntries(
    names.map((name) => [
      name,
      bundled[name].split(SECTION_RULE).map((part) => {
        const text = part.replace(/^\n+|\n+$/g, '')
        if (!partIndex.has(text)) {
          partIndex.set(text, parts.length)
          parts.push(text)
        }
        return partIndex.get(text)
      }),
    ]),
  )
  return { android, ios, bundled: split, parts }
}

/** The rule between sections in Google's third_party_licenses.txt entries. */
const SECTION_RULE = /\n-{10,}\n/
