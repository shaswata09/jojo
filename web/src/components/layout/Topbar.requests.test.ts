import { describe, expect, it } from 'vitest'
import topbarSource from '@/components/layout/Topbar.tsx?raw'

/**
 * The topbar (G6). Protected design: Guide, Profile, Assistant and Settings stay
 * as topbar icons. Source reads, because D20 forbids mounting.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const code = strip(topbarSource)

/** The `<nav>` that holds the icon buttons. */
const nav = /<nav aria-label="Account and support"[\s\S]*?<\/nav>/.exec(code)?.[0] ?? ''

describe('the topbar icons (Q013)', () => {
  it('are separate links, not a dropdown', () => {
    expect(nav).not.toBe('')
    expect(code).not.toMatch(/DropdownMenu|<select\b|Popover/)
    expect(nav).toMatch(/<NavLink\b/)
  })

  it('run My profile, Settings | Assistant | How to use', () => {
    expect(code).toMatch(
      /const ACCOUNT: UtilityLink\[\] = \[\s*\{ to: '\/profile', label: 'My profile'[^}]*\},\s*\{ to: '\/settings', label: 'Settings'[^}]*\},?\s*\]/,
    )
    expect(code).toMatch(/const HELP: UtilityLink\[\] = \[\{ to: '\/guide', label: 'How to use'/)
    // The groups render in that order, a divider before each.
    const order = [...nav.matchAll(/<Divider \/>|(ACCOUNT|ASSISTANT|HELP)\.map/g)].map(
      (m) => m[1] ?? '|',
    )
    expect(order).toEqual(['|', 'ACCOUNT', '|', 'ASSISTANT', '|', 'HELP'])
  })

  it('draw the assistant as the robot icon', () => {
    expect(code).toMatch(
      /const ASSISTANT: UtilityLink\[\] = \[\s*\{ to: '\/assistant', label: 'Assistant', icon: RobotIcon\b/,
    )
  })
})

describe('the search box (Q008)', () => {
  it('lives in a bar pinned to the top, so it does not scroll away', () => {
    const bar = /<div className="surface (sticky [^"]*)"/.exec(code)?.[1] ?? ''
    expect(bar).toMatch(/^sticky top-3 z-30\b/)
    expect(code).toMatch(/onClick=\{\(\) => spotlight\.setOpen\(true\)\}/)
  })
})

describe('the role filter (Q024)', () => {
  it('has no Academia/Industry switch', () => {
    expect(code).not.toMatch(/academia|industry/i)
  })

  // The owner moved it back to the top bar on 2026-11-15, after a spell in the
  // Applications toolbar. It sits with the actions, outside the icon nav.
  it('sits in the top bar, beside New', () => {
    expect(code).toMatch(/import \{ RoleFilter \} from '@\/components\/layout\/RoleFilter'/)
    expect(code).toMatch(/<RoleFilter \/>\s*<NewMenu \/>/)
    expect(nav).not.toMatch(/<RoleFilter\b/)
  })
})
