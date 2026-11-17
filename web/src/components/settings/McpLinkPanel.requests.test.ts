import { describe, expect, it } from 'vitest'
import source from './McpLinkPanel.tsx?raw'
import catalog from '@/i18n/locales/en/settings.json'

/**
 * Owner request Q236: the steps for connecting Claude Code to jojo-bridge work
 * when `claude` is not on the PATH, and the panel only says the extension is
 * needed when it is missing.
 *
 * The second half is behaviour in `lib/mcp-link.ts` and is pinned there ("does
 * not accuse the extension of being missing over one dropped poll", "names the
 * extension once the miss repeats"). The first is copy on the connect step, read
 * off source (D20): without it a VS Code user, whose `claude` lives inside the
 * extension folder, is told to run a command their shell cannot find.
 */
const connectStep = /<Step\s+n=\{2\}[\s\S]*?\/>/.exec(source)?.[0] ?? ''

describe('Q236 — connecting Claude Code', () => {
  it('runs the client command on the connect step', () => {
    expect(connectStep).toContain('command={clientCommand(link.token)}')
  })

  it('says what to do when the shell cannot find claude', () => {
    // The step's note is a catalog key; its English is what is pinned.
    expect(connectStep).toContain("note={t('mcp.connect.note')}")
    expect(catalog.mcp.connect.note).toContain('command not found: claude')
    // The concrete way out: the copy VS Code ships, by its path.
    expect(catalog.mcp.connect.note).toContain('resources/native-binary/claude')
  })

  it('asks for the extension only from the status that means it is missing', () => {
    const asks = Object.entries(catalog.mcp.explain).filter(([, text]) =>
      text.includes('The jojo extension carries the link'),
    )
    expect(asks.map(([key]) => key)).toEqual(['noExtension'])
    expect(source.match(/mcp\.explain\.noExtension/g) ?? []).toHaveLength(1)
    expect(source).toMatch(/case 'no-extension':\s*return t\('mcp\.explain\.noExtension'\)/)
  })
})
