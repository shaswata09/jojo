import { describe, expect, it } from 'vitest'
import shellSource from './AppShell.tsx?raw'
import dockSource from '../chat-dock/ChatDock.tsx?raw'

/**
 * Owner request Q285: a floating chat dock at the bottom right, on every page,
 * that moves left beside an open application rather than over it.
 *
 * Where it sits is `dockLayout`, pinned in `lib/chat-dock.test.ts` ("sits
 * beside the sheet, never over it"). What is pinned here, on source (D20), is
 * the wiring that makes those rules apply everywhere: the shell mounts the dock
 * once, outside any one page, and the dock lays itself out against the width
 * the open sheet publishes.
 */
describe('Q285 — the floating chat dock', () => {
  it('is mounted by the shell on every page but the Assistant’s own', () => {
    expect(shellSource.match(/<ChatDock \/>/g)).toHaveLength(1)
    expect(shellSource).toContain('{pathname.startsWith(assistantPath()) ? null : <ChatDock />}')
  })

  it('lays itself out against the open sheet’s width', () => {
    expect(dockSource).toContain('const sheet = useSheetPresence()')
    expect(dockSource).toMatch(/dockLayout\(viewport, sheet\.width,/)
  })
})
