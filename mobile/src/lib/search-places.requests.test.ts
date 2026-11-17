/**
 * The phone's search finds every setting and option too (Q334).
 *
 * The owner: "all settings and options are not being able to be searched via
 * the search bar. From the search bar everything should be searchable."
 *
 * `lib/search-places.ts` is the list; the screens are the truth it has to
 * match. The screens import React Native, which this runner does not load
 * (see vitest.config.mts), so they are read as text with comments removed —
 * the same approach as the tour's test.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nearestFocus } from '@/lib/focus-id'
import { SCREEN_TITLE, SEARCH_PLACES, focusIdsOf, parentOf } from '@/lib/search-places'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = (rel: string) => strip(readFileSync(path.join(ROOT, rel), 'utf8'))

/** Every .tsx under src, relative to the package, comments removed. */
function sources(dir: string): [string, string][] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return name.endsWith('.tsx')
      ? [[path.relative(ROOT, full), strip(readFileSync(full, 'utf8'))] as [string, string]]
      : []
  })
}
const ALL = sources(path.join(ROOT, 'src'))

/**
 * The Settings and Profile screens and everything they draw a row from. A file
 * added under `components/settings` is held to the rule without being named.
 */
const SETTINGS_SOURCES = [
  'src/screens/SettingsScreen.tsx',
  'src/screens/ProfileScreen.tsx',
  'src/components/common/CrashPanel.tsx',
  'src/components/common/AuditLog.tsx',
  'src/components/profile/BackgroundPanel.tsx',
  ...readdirSync(path.join(ROOT, 'src/components/settings'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `src/components/settings/${f}`),
]

/** English catalogs, flattened to `namespace:key`. */
const EN = path.join(ROOT, 'src/i18n/locales/en')
const PLURAL = ['_zero', '_one', '_two', '_few', '_many', '_other']
const enKeys = new Set<string>()
for (const file of readdirSync(EN).filter((f) => f.endsWith('.json'))) {
  const ns = file.slice(0, -5)
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object') walk(v as Record<string, unknown>, key)
      else enKeys.add(`${ns}:${key}`)
    }
  }
  walk(JSON.parse(readFileSync(path.join(EN, file), 'utf8')) as Record<string, unknown>, '')
}
const inEnglish = (key: string) => enKeys.has(key) || PLURAL.some((s) => enKeys.has(key + s))

/** The focus ids the screens draw, from `focusId="…"` and `<FocusTarget id="…">`. */
function drawnFocusIds(): Map<string, string> {
  const out = new Map<string, string>()
  for (const [file, text] of ALL) {
    for (const m of text.matchAll(/focusId="([^"]+)"|<FocusTarget\s+id="([^"]+)"/g)) {
      out.set(m[1] ?? m[2]!, file)
    }
  }
  return out
}

/** The text of every `options={…}` prop in a file, braces balanced. */
function optionsRegions(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\boptions=\{/g)) {
    let depth = 0
    for (let i = m.index + 'options='.length; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}' && --depth === 0) {
        out.push(text.slice(m.index, i + 1))
        break
      }
    }
  }
  return out
}

describe('the phone search finds every setting and option (Q334)', () => {
  it('marks every settings row, field and panel on Settings and Profile with a focus id', () => {
    const unmarked: string[] = []
    for (const file of SETTINGS_SOURCES) {
      const text = read(file)
      // First attribute, so the rule is checkable without parsing JSX: a row
      // that is not a search result says so with `focusId={null}`.
      for (const m of text.matchAll(/<(SettingRow|TextField|Panel)(?![A-Za-z])/g)) {
        const after = text.slice(m.index + m[0].length)
        if (!/^\s+focusId=/.test(after)) {
          unmarked.push(`${file}:${text.slice(0, m.index).split('\n').length} <${m[1]}>`)
        }
      }
    }
    expect(unmarked).toEqual([])
  })

  it('names focus ids as plain strings, or null for a row that is deliberately not a result', () => {
    const dynamic = ALL.flatMap(([file, text]) =>
      [...text.matchAll(/focusId=\{(?!null\})|<FocusTarget\s+id=\{(?!focusId\})/g)].map(
        (m) => `${file}:${text.slice(0, m.index).split('\n').length}`,
      ),
    )
    expect(dynamic).toEqual([])
  })

  it('lists every focus id the screens draw, and draws every focus id it lists', () => {
    const drawn = drawnFocusIds()
    const listed = new Set(SEARCH_PLACES.flatMap(focusIdsOf))
    expect([...drawn.keys()].filter((id) => !listed.has(id))).toEqual([])
    expect([...listed].filter((id) => !drawn.has(id))).toEqual([])
  })

  it('reaches every switch behind a page options sheet', () => {
    const missing: string[] = []
    for (const [file, text] of ALL) {
      if (!file.startsWith('src/screens/')) continue
      // The page's ⋯ sheet is the `options` prop that holds a SettingRow; a
      // Segment's `options` is a list of values.
      const region = optionsRegions(text).find((r) => r.includes('<SettingRow'))
      if (!region) continue
      const route = path.basename(file).replace(/Screen\.tsx$/, '')
      const ns = /useTranslation\(\s*'([^']+)'/.exec(text)?.[1] ?? 'common'
      const rows = [...region.matchAll(/<SettingRow\s+label=\{t\('([^']+)'\)\}/g)]
      expect(rows.length, `${file}: every options row labelled by a plain key`).toBe(
        region.split('<SettingRow').length - 1,
      )
      for (const [, key] of rows) {
        const hit = SEARCH_PLACES.some(
          (p) =>
            p.label === `${ns}:${key}` &&
            p.to.screen === route &&
            'options' in p.to &&
            p.to.options === true,
        )
        if (!hit) missing.push(`${file}: ${ns}:${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('gives every place a label key that is in the English catalog', () => {
    const problems: string[] = []
    for (const p of SEARCH_PLACES) {
      if (p.label === undefined && p.name === undefined) problems.push(`${p.id}: no label`)
      for (const key of [p.label, p.detail]) {
        if (key === undefined) continue
        if (!/^[a-z]+:/.test(key)) problems.push(`${p.id}: "${key}" names no namespace`)
        else if (!inEnglish(key)) problems.push(`${p.id}: "${key}" is not in the English catalog`)
      }
    }
    for (const key of Object.values(SCREEN_TITLE)) {
      if (!inEnglish(key)) problems.push(`screen title "${key}" is not in the English catalog`)
    }
    expect(problems).toEqual([])
  })

  it('gives every place its own id and some English words to be found by', () => {
    const ids = SEARCH_PLACES.map((p) => p.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
    expect(SEARCH_PLACES.filter((p) => p.keywords.trim().length === 0).map((p) => p.id)).toEqual([])
    // The synonyms the owner's examples reach for.
    const find = (word: string) =>
      SEARCH_PLACES.filter((p) => p.keywords.includes(word)).map((p) => p.id)
    expect(find('dark mode')).toContain('settings.appearance.theme')
    expect(find('token')).toContain('settings.model.apiKey')
    expect(parentOf(SEARCH_PLACES.find((p) => p.id === 'settings.model.apiKey')!)?.id).toBe(
      'settings.model',
    )
  })

  it('lands on the nearest drawn panel when the row itself is not drawn', () => {
    const drawn = new Set(['settings.model', 'settings'])
    expect(nearestFocus('settings.model.apiKey', (id) => drawn.has(id))).toBe('settings.model')
    expect(nearestFocus('settings.model', (id) => drawn.has(id))).toBe('settings.model')
    expect(nearestFocus('profile.links.github', (id) => drawn.has(id))).toBeNull()
  })

  it('lists settings and places in search, under a heading in every language', () => {
    const search = read('src/screens/SearchScreen.tsx')
    expect(search).toMatch(/for \(const p of SEARCH_PLACES\)/)
    expect(search).toMatch(/goToPlace\(navigation, p\.to\)/)
    // Resolved when drawn, through the screen's `t`, never at module scope.
    expect(read('src/lib/search-places.ts')).not.toMatch(/i18next|useTranslation|\bt\(/)
    const locales = path.join(ROOT, 'src/i18n/locales')
    const missing: string[] = []
    for (const locale of readdirSync(locales)) {
      const screens = JSON.parse(
        readFileSync(path.join(locales, locale, 'screens.json'), 'utf8'),
      ) as { search: { groups: Record<string, string> } }
      for (const group of ['settings', 'places']) {
        if (!screens.search.groups[group]?.trim()) missing.push(`${locale}: ${group}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('scrolls to the row and lights it once, then clears the param', () => {
    for (const file of ['src/screens/SettingsScreen.tsx', 'src/screens/ProfileScreen.tsx']) {
      const text = read(file)
      expect(text, file).toMatch(/focus=\{route\.params\?\.focus\}/)
      expect(text, file).toMatch(/setParams\(\{ focus: undefined \}\)/)
    }
    const screen = read('src/components/ui/Screen.tsx')
    expect(screen).toMatch(/innerViewRef=/)
    expect(screen).toMatch(/useFocusScope\(focus, onArrived/)
    // Measured against the scroll content, so a row nested in a column or a
    // panel lands where it is; and still under reduced motion.
    expect(read('src/components/ui/focus-scope.ts')).toMatch(/measureLayout\(/)
    expect(read('src/components/ui/FocusTarget.tsx')).toMatch(/isReduceMotionEnabled/)
  })
})
