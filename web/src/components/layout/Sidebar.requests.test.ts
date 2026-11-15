import { describe, expect, it } from 'vitest'
import brandCard from '@/components/brand/BrandCard.tsx?raw'
import sidebar from '@/components/layout/Sidebar.tsx?raw'
import sidebarNav from '@/components/layout/SidebarNav.tsx?raw'
import sidebarRuntime from '@/components/layout/SidebarRuntime.tsx?raw'
import topbar from '@/components/layout/Topbar.tsx?raw'

/**
 * The sidebar (G6). Protected design — left alone by the owner's choice; these
 * pin the requests that shaped it so they cannot be undone by accident.
 *
 * Source reads (D20). Comments stripped: the sidebar's own comment explains why
 * the research-preview line went, and that must not count as the line.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const aside = strip(sidebar)

describe('the sidebar on a narrow screen (Q003)', () => {
  it('is a fixed drawer that slides off to the left until opened', () => {
    expect(aside).toMatch(/'fixed top-3 bottom-3 left-3 /)
    expect(aside).toMatch(/open \? 'translate-x-0' : '-translate-x-\[calc\(100%\+1rem\)\]'/)
  })

  it('becomes a permanent column from lg up', () => {
    expect(aside).toMatch(/'lg:sticky lg:top-5 /)
    expect(aside).toMatch(/lg:translate-x-0/)
  })

  it('is opened from a menu button that only exists below lg', () => {
    const menu = /<button\s+ref=\{navButtonRef\}[\s\S]*?<\/button>/.exec(strip(topbar))?.[0] ?? ''
    expect(menu).toContain('onClick={onOpenNav}')
    expect(menu).toContain('lg:hidden')
  })
})

describe('what the sidebar does not say (Q271)', () => {
  it.each([
    ['Sidebar', sidebar],
    ['BrandCard', brandCard],
    ['SidebarNav', sidebarNav],
    ['SidebarRuntime', sidebarRuntime],
  ])('%s renders no research-preview text', (_name, src) => {
    const code = strip(src)
    expect(code).not.toMatch(/research preview/i)
    expect(code).not.toMatch(/STATUS_HEADLINE/)
  })
})
