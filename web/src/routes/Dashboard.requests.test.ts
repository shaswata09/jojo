/**
 * Owner requests about the dashboard's layout.
 *
 * Q004: no "local-first job tracker" text; overdue and due work is flagged on
 *       its own (Owed this week); there is a Recent applications card.
 * Q005: the headline stats are a compact widget BESIDE the needs-a-decision
 *       carousel, not a full-width row.
 * Q043: a paste-a-URL box with an Add application button sits above the deck,
 *       and it is the shared AddByUrl, so it opens the same flow as on
 *       /applications (what that flow is: add-by-url.requests.test.ts).
 * Q041: Pipeline and Recent applications share the bottom row's narrower column.
 * Q062: Owed this week is as tall as Recent applications plus Pipeline, and a
 *       Vault reminder row keeps its title on a phone.
 * Q313: a card with many items stops at a max height and scrolls inside, with
 *       its scrollbar on the card's right edge.
 *
 * All of this is layout, which only exists in the JSX. D20 bans mounting, so
 * these read the sources and pin the specific classes and nesting that make
 * each request true.
 */

import { describe, expect, it } from 'vitest'
import applicationsEn from '@/i18n/locales/en/applications.json'

const sources = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const read = (path: string) => sources[path] ?? ''
const dashboard = read('/src/routes/Dashboard.tsx')
const owed = read('/src/components/dashboard/OwedThisWeek.tsx')

/** The `<div className="grid ...">` blocks of the dashboard, in order. */
const grids = [...dashboard.matchAll(/<div className="(grid [^"]*)">([\s\S]*?)\n {6}<\/div>/g)].map(
  (m) => ({
    className: m[1] ?? '',
    body: m[2] ?? '',
  }),
)

const classesOf = (src: string, pattern: RegExp) => (pattern.exec(src)?.[1] ?? '').split(/\s+/)

describe('the dashboard content (Q004)', () => {
  it('says "local-first job tracker" nowhere in the app', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    for (const [path, src] of Object.entries(sources)) {
      expect(src.toLowerCase().includes('local-first job tracker'), path).toBe(false)
    }
  })

  it('has the Owed this week and Recent applications cards', () => {
    expect(dashboard).toContain('<OwedThisWeek />')
    expect(dashboard).toContain('<RecentApplications />')
  })

  it('flags overdue work by its date and lists it first', () => {
    expect(owed).toMatch(/const overdue = openItems\.filter\(\(i\) => i\.date < today\)/)
    expect(owed).toMatch(
      /groups: \[\s*\{ id: 'overdue', label: t\('owed\.groups\.overdue'\), items: overdue \}/,
    )
  })
})

describe('the top row (Q005)', () => {
  it('puts the stats widget in a narrow column beside the carousel', () => {
    const top = grids[0]
    expect(top).toBeDefined()
    expect(top?.className).toContain('lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]')
    const body = top?.body ?? ''
    expect(body.indexOf('<PriorityActions />')).toBeGreaterThanOrEqual(0)
    expect(body.indexOf('<GlancePanel />')).toBeGreaterThan(body.indexOf('<PriorityActions />'))
  })
})

describe('the bottom row (Q041, Q062)', () => {
  const bottom = grids[1]

  it('stacks Recent applications and Pipeline in the narrower column', () => {
    expect(bottom?.className).toContain('lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]')
    const body = bottom?.body ?? ''
    expect(body.indexOf('<OwedThisWeek />')).toBeGreaterThanOrEqual(0)
    const column =
      /<div className="flex min-w-0 flex-col[^"]*">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? ''
    // StatsCard opens on the Pipeline view.
    expect(column).toMatch(/<RecentApplications \/>\s*<StatsCard \/>/)
  })

  it('stretches Owed this week to the height of the column beside it', () => {
    expect(bottom?.className.split(/\s+/)).toContain('items-stretch')
    expect(owed).toMatch(/<Panel className="flex min-w-0 flex-col">/)
    // The list fills what it is given and scrolls, rather than setting the height.
    expect(classesOf(owed, /<div className="(relative lg:min-h-0 lg:flex-1)">/)).toContain(
      'lg:flex-1',
    )
    const list = classesOf(owed, /<div className="(-mx-4 -mb-4 max-h-\[30rem\][^"]*)">/)
    expect(list).toContain('lg:absolute')
    expect(list).toContain('lg:max-h-none')
  })
})

describe('a Vault reminder row on a phone (Q062)', () => {
  const row = read('/src/components/vault/reminders/ReminderRow.tsx')

  it('wraps its actions under the title below sm', () => {
    expect(row).toContain("'flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 sm:flex-nowrap'")
    expect(row).toContain(
      '<div className="min-w-0 flex-1 basis-[calc(100%-1.875rem)] sm:basis-auto">',
    )
    expect(row).toContain(
      '<div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto sm:justify-start">',
    )
  })
})

describe('cards with many items (Q313)', () => {
  /**
   * The scroll box's classes: a max height, its own vertical scroll, and a
   * negative right margin matched by the same padding, which puts the bar on
   * the card's edge while the rows keep their inset.
   */
  const scrollBoxes = {
    'Owed this week': classesOf(owed, /<div className="(-mx-4 -mb-4 max-h-\[30rem\][^"]*)">/),
    'Statistics card': classesOf(
      read('/src/components/dashboard/StatsCard.tsx'),
      /<div className="(-mx-4 -mb-4 max-h-\[30rem\][^"]*)">/,
    ),
    'Sticky notes': classesOf(
      read('/src/components/dashboard/StickyBoard.tsx'),
      /className="(-mx-2\.5 [^"]*max-h-\[26rem\][^"]*)"/,
    ),
  }

  for (const [card, classes] of Object.entries(scrollBoxes)) {
    it(`${card} caps its height and scrolls with the bar on the card edge`, () => {
      expect(
        classes.some((c) => /^max-h-\[\d+rem\]$/.test(c)),
        classes.join(' '),
      ).toBe(true)
      expect(classes).toContain('overflow-y-auto')
      const bleed = classes.find((c) => c.startsWith('-mx-'))?.slice('-mx-'.length)
      expect(bleed).toBeDefined()
      expect(classes).toContain(`px-${String(bleed)}`)
    })
  }
})

describe('the quick start above the deck (Q043)', () => {
  // Comments stripped, so a sentence about AddByUrl cannot stand in for the tag.
  const code = dashboard
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  it('uses the shared AddByUrl component, not a copy', () => {
    expect(code).toContain("import { AddByUrl } from '@/components/applications/AddByUrl'")
  })

  it('renders the URL box above the needs-a-decision deck', () => {
    const box = code.indexOf('<AddByUrl')
    expect(box).toBeGreaterThan(code.indexOf('<PageHeader'))
    expect(box).toBeLessThan(code.indexOf('<PriorityActions />'))
  })

  it('keeps the button reading Add application, on one slim row', () => {
    // No `submitLabel`: the component's default is "Add application", which is
    // what the owner asked the button to say. The /applications header shortens
    // it to "From link" only because a New application button sits beside it.
    expect(code).toMatch(
      /<Panel aria-label=\{t\('dashboard\.startFromLink'\)\} className="py-2\.5 sm:py-3">\s*<AddByUrl \/>\s*<\/Panel>/,
    )
    const addByUrl = read('/src/components/applications/AddByUrl.tsx')
    expect(addByUrl).toContain("{submitLabel ?? t('addByUrl.submit')}")
    expect(applicationsEn.addByUrl.submit).toBe('Add application')
  })
})
