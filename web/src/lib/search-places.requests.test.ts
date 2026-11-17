/**
 * Q333: the search palette finds every setting, option and place — not only
 * records and pages.
 *
 * The palette cannot see a Settings row (it is mounted on every page, the row
 * only on one), so it is told about each in `search-places.ts`. What keeps that
 * list honest is the first block below: it reads the Settings and Profile
 * sources (D20 — nothing here mounts) and fails the moment a row is drawn that
 * search cannot reach, or the registry names a row that is no longer drawn.
 */

import { describe, expect, it } from 'vitest'
import {
  DYNAMIC_FOCUS_PREFIXES,
  GUIDE_PLACES,
  PROFILE_PLACES,
  SCOUT_PLACES,
  SCOUT_SECTIONS,
  SEARCH_PLACES,
  SETTINGS_PLACES,
  STATISTICS_PLACES,
  VAULT_PLACES,
  focusFallback,
} from '@/lib/search-places'
import paletteSource from '@/components/layout/SpotlightSearch.tsx?raw'

/** Comments out, so an explanation that mentions `<SettingRow` is not one. */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const raw = (files: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(files as Record<string, string>).map(([file, src]) => [file, strip(src)]),
  )

const SETTINGS_SOURCES = raw({
  ...import.meta.glob('/src/routes/Settings.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/src/components/settings/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
})

const PROFILE_SOURCES = raw({
  ...import.meta.glob('/src/routes/Profile.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/src/components/profile/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
})

const SCOUT_SOURCES = raw(
  import.meta.glob('/src/components/scout/*.tsx', { query: '?raw', import: 'default', eager: true }),
)

const STATISTICS_SOURCES = raw({
  ...import.meta.glob('/src/routes/Statistics.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob(['/src/components/statistics/*.tsx', '/src/components/dashboard/*.tsx'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
})

const ENGLISH = import.meta.glob<Record<string, unknown>>('/src/i18n/locales/en/*.json', {
  import: 'default',
  eager: true,
})

/** `namespace:a.b.c` → the English string, or undefined. */
function english(key: string): unknown {
  const [ns, path] = key.split(':')
  const catalog = ENGLISH[`/src/i18n/locales/en/${ns}.json`]
  return path
    ?.split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      catalog,
    )
}

/** Every opening tag of `name`, as the text from `<name` up to `until`. */
function openings(src: string, name: string, until: RegExp): string[] {
  const out: string[] = []
  const start = new RegExp(`<${name}\\b`, 'g')
  for (let m = start.exec(src); m; m = start.exec(src)) {
    const rest = src.slice(m.index)
    const end = until.exec(rest.slice(1))
    out.push(rest.slice(0, end ? end.index + 1 : 400))
  }
  return out
}

type Found = { literal: Set<string>; problems: string[] }

/**
 * Every `focusId` / `data-focus-id` in a set of sources. A string literal is an
 * id; a template literal is allowed only behind a registered dynamic prefix;
 * `{focusId}` is a component passing its own prop through. Anything else is an
 * id the guard cannot read, and so cannot vouch for.
 */
function focusIdsIn(sources: Record<string, string>): Found {
  const literal = new Set<string>()
  const problems: string[] = []
  const attr = /(?:\bfocusId|data-focus-id)=(\{[^}\n]*\}?|"[^"]*")/g
  for (const [file, src] of Object.entries(sources)) {
    for (let m = attr.exec(src); m; m = attr.exec(src)) {
      const value = m[1]!
      if (value.startsWith('"')) {
        literal.add(value.slice(1, -1))
        continue
      }
      if (value === '{focusId}') continue
      const template = /^\{`([^`$]*)\$\{/.exec(value)
      if (template && DYNAMIC_FOCUS_PREFIXES.some((p) => p === template[1])) continue
      problems.push(`${file}: ${m[0]}`)
    }
  }
  return { literal, problems }
}

describe('every setting is searchable (Q333)', () => {
  it('read the sources, so the empty lists below mean something', () => {
    expect(Object.keys(SETTINGS_SOURCES).length).toBeGreaterThan(10)
    expect(Object.keys(PROFILE_SOURCES).length).toBeGreaterThan(5)
  })

  it('gives every SettingRow in Settings and Profile a focusId', () => {
    const missing: string[] = []
    for (const [file, src] of Object.entries({ ...SETTINGS_SOURCES, ...PROFILE_SOURCES })) {
      for (const tag of openings(src, 'SettingRow', /\bcontrol=/)) {
        if (!/\bfocusId=/.test(tag)) missing.push(`${file}: ${tag.slice(0, 80)}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('gives every titled panel in Settings and Profile a focusId', () => {
    const missing: string[] = []
    let titles = 0
    for (const [file, src] of Object.entries({ ...SETTINGS_SOURCES, ...PROFILE_SOURCES })) {
      const title = /<PanelTitle\b/g
      for (let m = title.exec(src); m; m = title.exec(src)) {
        titles += 1
        // The card the title heads: the nearest `<Panel` or `<Shell` above it.
        const before = src.slice(0, m.index)
        const open = Math.max(before.lastIndexOf('<Panel'), before.lastIndexOf('<Shell'))
        const tag = open < 0 ? '' : before.slice(open, before.indexOf('>', open) + 1)
        if (!/\bfocusId=/.test(tag)) missing.push(`${file}: ${tag || '(no panel found)'}`)
      }
    }
    expect(titles).toBeGreaterThan(12)
    expect(missing).toEqual([])
  })

  it('lists every focusId the Settings and Profile sources draw', () => {
    const settings = focusIdsIn(SETTINGS_SOURCES)
    const profile = focusIdsIn(PROFILE_SOURCES)
    expect([...settings.problems, ...profile.problems]).toEqual([])

    const settingsIds = new Set(SETTINGS_PLACES.map((p) => p.id))
    const profileIds = new Set(PROFILE_PLACES.map((p) => p.id))
    expect([...settings.literal].filter((id) => !settingsIds.has(id))).toEqual([])
    expect([...profile.literal].filter((id) => !profileIds.has(id))).toEqual([])
  })

  it('names no setting or profile field the sources no longer draw', () => {
    const settings = focusIdsIn(SETTINGS_SOURCES).literal
    const profile = focusIdsIn(PROFILE_SOURCES).literal
    expect(SETTINGS_PLACES.map((p) => p.id).filter((id) => !settings.has(id))).toEqual([])
    expect(PROFILE_PLACES.map((p) => p.id).filter((id) => !profile.has(id))).toEqual([])
  })

  it('names no scout panel or statistics card the sources no longer draw', () => {
    const scout = focusIdsIn(SCOUT_SOURCES).literal
    for (const section of SCOUT_SECTIONS) expect(scout).toContain(`section:${section}`)
    expect(SCOUT_PLACES).toHaveLength(SCOUT_SECTIONS.length)

    const statistics = focusIdsIn(STATISTICS_SOURCES).literal
    expect(STATISTICS_PLACES.map((p) => p.id).filter((id) => !statistics.has(id))).toEqual([])
  })
})

describe('the search registry (Q333)', () => {
  it('gives every place a unique id', () => {
    const ids = SEARCH_PLACES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('labels every place with a key that exists in the English catalogs', () => {
    const bad: string[] = []
    for (const place of SEARCH_PLACES) {
      if (!place.label && !place.text) bad.push(`${place.id}: no label`)
      for (const key of [place.label, place.detail]) {
        if (key === undefined) continue
        const value = english(key)
        // Plain strings only: the palette calls `t` with no values, so a
        // placeholder would be shown to the reader as `{{tokens}}`.
        if (typeof value !== 'string') bad.push(`${place.id}: ${key} is missing`)
        else if (/\{\{|<\w/.test(value)) bad.push(`${place.id}: ${key} needs values or markup`)
      }
    }
    expect(bad).toEqual([])
  })

  it('keeps literal labels for names that are not translated', () => {
    expect(SEARCH_PLACES.filter((p) => p.text).map((p) => p.text)).toEqual([
      'Google Scholar',
      'GitHub',
      'LinkedIn',
    ])
  })

  it('points each setting and profile row at its own row on its own page', () => {
    for (const place of SETTINGS_PLACES) expect(place.to).toBe(`/settings?focus=${place.id}`)
    for (const place of PROFILE_PLACES) expect(place.to).toBe(`/profile?focus=${place.id}`)
  })

  it('falls back from a row to a panel that is itself listed', () => {
    for (const place of [...SETTINGS_PLACES, ...PROFILE_PLACES]) {
      if (!place.panel) continue
      const panel = SEARCH_PLACES.find((p) => p.id === place.panel)
      expect(panel, place.id).toBeDefined()
      expect(panel!.panel, place.panel).toBeUndefined()
      expect(focusFallback(place.id)).toBe(place.panel)
    }
    expect(focusFallback('keyword:research')).toBe('keywords')
    expect(focusFallback('appearance')).toBeUndefined()
  })

  it('reaches the vault tools, the scout panels, the statistics cards and the guide sections', () => {
    expect(VAULT_PLACES.map((p) => p.to)).toContain('/vault?tool=tools&focus=pdf')
    expect(VAULT_PLACES.map((p) => p.to)).toContain('/vault?tool=links')
    expect(SCOUT_PLACES.map((p) => p.to)).toContain('/scout?focus=section%3Amatches')
    expect(STATISTICS_PLACES.map((p) => p.to)).toContain('/statistics?focus=stats-funnel')
    expect(GUIDE_PLACES.map((p) => p.to)).toContain('/guide#dates')
    expect(GUIDE_PLACES.map((p) => p.to)).toContain('/guide/screens#vault')
  })

  it('is listed in the palette, with the vault and scout records', () => {
    const palette = strip(paletteSource)
    expect(palette).toContain('placeRows(SETTINGS_PLACES, tAny)')
    expect(palette).toContain('placeRows(PROFILE_PLACES, tAny)')
    expect(palette).toContain('placeRows(OTHER_PLACES, tAny)')
    expect(palette).toMatch(/vaultPath\(\{ tool: 'links', focus: l\.id \}\)/)
    expect(palette).toMatch(/scoutPath\(\{ focus: \{ kind: 'pipeline', id: p\.id \} \}\)/)
    // Actions stay first; the long lists come after the pages.
    const order = [
      "t('spotlight.actions')",
      "t('spotlight.applications')",
      "t('spotlight.pages.vault')",
      "t('spotlight.pages.jobScout')",
      "t('spotlight.goTo')",
      "t('spotlight.pages.settings')",
      "t('spotlight.pages.profile')",
      "t('spotlight.places')",
    ].map((heading) => palette.indexOf(`heading={${heading}}`))
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})
