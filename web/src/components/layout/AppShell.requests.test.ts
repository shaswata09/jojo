import { describe, expect, it } from 'vitest'
import appShell from '@/components/layout/AppShell.tsx?raw'
import sidebar from '@/components/layout/Sidebar.tsx?raw'
import topbar from '@/components/layout/Topbar.tsx?raw'

/**
 * How page content meets the topbar (G6). Source reads, because D20 forbids
 * mounting; comments stripped so the explanation is not mistaken for the code.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const shell = strip(appShell)

/** The z-index a class string gives, or NaN. */
const z = (classes: string) => Number(/(?:^|\s)z-(\d+)\b/.exec(classes)?.[1])

const scrim =
  /<div\s+aria-hidden\s+className="(pointer-events-none fixed[^"]*)"\s+style=\{\{\s*background:\s*'([^']*)'/.exec(
    shell,
  )
const topbarClasses = /<div className="(surface sticky[^"]*)"/.exec(strip(topbar))?.[1] ?? ''
const sidebarClasses = /'(surface z-\d+[^']*)'/.exec(strip(sidebar))?.[1] ?? ''

describe('content scrolling under the topbar (Q028)', () => {
  it('fades into a scrim that is solid page colour at the top and clear below', () => {
    expect(scrim).not.toBeNull()
    expect(scrim![2]).toMatch(
      /^linear-gradient\(to bottom, var\(--page\) 0%, .*transparent 100%\)$/,
    )
  })

  it('never covers the topbar or the mascot card', () => {
    const under = z(scrim![1])
    expect(under).toBeGreaterThan(0)
    expect(z(topbarClasses)).toBeGreaterThan(under)
    expect(z(sidebarClasses)).toBeGreaterThan(under)
  })

  it('leaves the page column without a z-index, so the bars are not trapped beneath it', () => {
    const column = /<div className="(relative mx-auto flex min-h-dvh[^"]*)"/.exec(shell)?.[1] ?? ''
    expect(column).not.toBe('')
    expect(column).not.toMatch(/(^|\s)z-/)
  })
})

describe('where a page starts (Q091)', () => {
  it('puts the topbar in the flow above <main>, so a title starts below it', () => {
    // Sticky, not fixed: a fixed bar takes no room and the page slides under it.
    expect(topbarClasses).toMatch(/\bsticky\b/)
    expect(topbarClasses).not.toMatch(/\bfixed\b/)
    const bar = shell.indexOf('<Topbar ')
    const main = shell.indexOf('<main')
    expect(bar).toBeGreaterThan(-1)
    expect(main).toBeGreaterThan(bar)
  })

  it('opens each new page at its top', () => {
    expect(shell).toMatch(
      /if \(isDesktop && isSamePage\(from, pathname\)\) return\s*window\.scrollTo\(0, 0\)/,
    )
  })
})
