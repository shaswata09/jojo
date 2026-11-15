import { describe, expect, it } from 'vitest'
import pageHeader from '@/components/common/PageHeader.tsx?raw'

/**
 * The page header's settings button (G6). Source reads, because D20 forbids
 * mounting; comments stripped so the header's own history is not read as code.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const header = strip(pageHeader)

const routes = import.meta.glob(
  ['/src/routes/*.tsx', '/src/components/scout/ScoutHeader.tsx', '/src/components/assistant/AgentHeader.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

/** Whether a file's `<PageHeader …>` passes a `settings` slot. */
const passesSettings = (file: string) => {
  const src = strip(routes[file] ?? '')
  const tags = src.match(/<PageHeader\b[\s\S]*?(?:\/>|>\s*$)/gm) ?? []
  return tags.some((t) => /\bsettings=/.test(t))
}

describe('the round settings button left of a page title (Q050)', () => {
  it('is round, and drawn before the title', () => {
    const trigger = /<PopoverTrigger[\s\S]*?className="([^"]*)"/.exec(header)?.[1] ?? ''
    expect(trigger).toMatch(/\brounded-full\b/)
    expect(header.indexOf('<PopoverTrigger')).toBeLessThan(header.indexOf('<h1'))
  })

  it.each(['Graph', 'Transfer', 'Applications', 'Calendar', 'Statistics', 'Profile', 'Vault'])(
    'is on the %s page',
    (page) => {
      expect(passesSettings(`/src/routes/${page}.tsx`)).toBe(true)
    },
  )

  it('is not on the dashboard', () => {
    expect(passesSettings('/src/routes/Dashboard.tsx')).toBe(false)
  })
})

describe('a page with no settings (Q084)', () => {
  it('reserves no gap before its title', () => {
    // The button or nothing: no spacer standing in for an absent control.
    expect(header).toMatch(/\{settings \? \(\s*<Popover>[\s\S]*?<\/Popover>\s*\) : null\}/)
  })

  it.each(['/src/routes/Settings.tsx', '/src/components/assistant/AgentHeader.tsx'])(
    'includes %s, which passes none',
    (file) => {
      expect(routes[file]).toBeDefined()
      expect(passesSettings(file)).toBe(false)
    },
  )
})
