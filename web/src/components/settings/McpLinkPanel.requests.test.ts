import { describe, expect, it } from 'vitest'
import source from './McpLinkPanel.tsx?raw'

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
    expect(connectStep).toContain('command not found: claude')
    // The concrete way out: the copy VS Code ships, by its path.
    expect(connectStep).toContain('resources/native-binary/claude')
  })

  it('asks for the extension only from the status that means it is missing', () => {
    const asks = source.match(/The jojo extension carries the link/g) ?? []
    expect(asks).toHaveLength(1)
    expect(source).toMatch(/case 'no-extension':\s*return '[^']*The jojo extension carries the link/)
  })
})
