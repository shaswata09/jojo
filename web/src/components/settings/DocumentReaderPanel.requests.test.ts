/**
 * The document-reader card in Settings, read as source (D20: no mounting).
 *
 * Q225 — "show the markitdown-mcp install and run commands in a box with a copy
 *        icon." One box, one CopyButton, and the button copies the very
 *        constant the box shows — so the paste cannot differ from the screen.
 *        The command strings themselves are `MARKITDOWN.install`/`.serve`,
 *        pinned in `service/kg/agent/markitdown.test.ts`.
 * Q115 — MarkItDown is credited with its licence where the person decides to
 *        install it. The notice text is pinned in `markitdown.test.ts`
 *        ("carries the notice the licence asks for, next to the setting"); this
 *        pins that the card actually renders it.
 */
import { describe, expect, it } from 'vitest'
import { MARKITDOWN } from '@jojo/service/agent/markitdown'
import source from './DocumentReaderPanel.tsx?raw'
import catalog from '@/i18n/locales/en/settings.json'

const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q225 the reader’s setup commands, in a box with a copy button', () => {
  it('builds the box text from the install and the run command, one per line', () => {
    expect(code).toContain('const SETUP_COMMANDS = `${MARKITDOWN.install}\\n${MARKITDOWN.serve}`')
    expect(MARKITDOWN.install).toContain('markitdown-mcp')
    expect(MARKITDOWN.serve).toContain('markitdown-mcp')
  })

  it('shows that text and copies that same text, side by side', () => {
    expect(code).toMatch(
      /<pre className="[^"]*font-mono[^"]*">\s*\{SETUP_COMMANDS\}\s*<\/pre>\s*<CopyButton text=\{SETUP_COMMANDS\} label=\{t\('reader\.copySetup'\)\} \/>/,
    )
    expect(catalog.reader.copySetup).toBe('Copy the setup commands')
  })
})

describe('Q115 MarkItDown is credited, with its licence, on the card', () => {
  it('renders the copyright and the licence beside the setting', () => {
    expect(code).toMatch(
      /\{t\('reader\.separate', \{ name: MARKITDOWN\.name \}\)\} \{MARKITDOWN\.copyright\}\{' '\}\s*\{MARKITDOWN\.licence\}\./,
    )
    expect(catalog.reader.separate).toBe('{{name}} is a separate program, not part of jojo.')
    expect(code).toMatch(/href=\{MARKITDOWN\.url\}/)
  })
})
