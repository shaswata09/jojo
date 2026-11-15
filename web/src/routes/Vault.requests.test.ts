import { describe, expect, it } from 'vitest'
import { VAULT_TOOLS } from '@/lib/links'
import vaultSource from './Vault.tsx?raw'
import remindersSource from '@/components/vault/RemindersTool.tsx?raw'
import linksSource from '@/components/vault/LinksTool.tsx?raw'
import filesSource from '@/components/vault/FilesTool.tsx?raw'
import snippetsSource from '@/components/vault/SnippetsTool.tsx?raw'
import instrumentsSource from '@/components/vault/InstrumentsTool.tsx?raw'
import applicationFieldsSource from '@/components/applications/dialog/ApplicationFields.tsx?raw'
import itemFormSource from '@/components/timeline/dialog/ItemForm.tsx?raw'

/**
 * What the Vault page is made of, read as source (D20: nothing here mounts).
 *
 * Q046: one page holding reminders, links, files, snippets and tools.
 * Q054: one keyword filter across those four record tabs, and the same
 *       keywords attachable to applications and reminders.
 * Q055/Q261: the Tools tab holds the calculator and the PDF editor.
 *
 * The keyword RULE (`lit.size === 0 || carries(id, lit)`) is unit-tested in
 * `lib/label-selection.test.ts`; what is pinned here is that every tab is
 * actually run through it. Each tool filters its own rows inline, so dropping
 * the `matches` call from one of them leaves the chips lit over a list they no
 * longer narrow, and no other test would notice.
 */

/** Comments stripped, so an assertion cannot pass on prose describing the wiring. */
const strip = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

const vault = strip(vaultSource)

describe('the Vault holds every tool (Q046)', () => {
  it('offers reminders, links, files, snippets and tools as tabs', () => {
    for (const tool of ['reminders', 'links', 'files', 'snippets', 'tools'] as const) {
      expect(VAULT_TOOLS).toContain(tool)
      expect(vault).toContain(`{ value: '${tool}', label:`)
    }
  })

  it('renders each tab’s own tool component', () => {
    expect(vault).toMatch(/tool === 'reminders' \? <RemindersTool\b/)
    expect(vault).toMatch(/tool === 'links' \? <LinksTool\b/)
    expect(vault).toMatch(/tool === 'files' \? <FilesTool\b/)
    expect(vault).toMatch(/tool === 'snippets' \? <SnippetsTool\b/)
    expect(vault).toMatch(/tool === 'tools' \? <InstrumentsTool\b/)
  })
})

describe('one keyword filter across the Vault (Q054)', () => {
  it('draws a single LabelFilter scoped to the tab on screen', () => {
    expect(vault.match(/<LabelFilter\b/g)).toHaveLength(1)
    expect(vault).toMatch(/<LabelFilter scopeIds=\{scopeIds\}/)
    for (const [tool, list] of [
      ['reminders', 'reminders'],
      ['links', 'links'],
      ['files', 'files'],
      ['snippets', 'snippets'],
    ] as const) {
      expect(vault).toMatch(new RegExp(`tool === '${tool}'\\s*\\?\\s*${list}\\.map\\(`))
    }
  })

  it.each([
    ['reminders', remindersSource, /labelMatches\(r\.id\)/],
    ['links', linksSource, /matches\(l\.id\)/],
    ['snippets', snippetsSource, /matches\(s\.id\)/],
    ['files', filesSource, /keywords: matches\b/],
  ])('narrows the %s list by the lit keywords', (_name, source, call) => {
    const code = strip(source)
    expect(code).toContain('useLabels()')
    expect(code).toMatch(call)
  })

  it('lets a keyword be attached to an application and to a reminder', () => {
    expect(strip(applicationFieldsSource)).toMatch(/<KeywordPicker\s+value=\{keywords\}/)
    expect(strip(itemFormSource)).toMatch(/<KeywordPicker\s+value=\{keywords\}/)
  })
})

describe('the Tools tab (Q055, Q261)', () => {
  const tools = strip(instrumentsSource)

  it('offers the calculator and the PDF editor', () => {
    expect(tools).toContain("{ value: 'calculator', label: 'Calculator' }")
    expect(tools).toContain("{ value: 'pdf', label: 'PDF editor' }")
    expect(tools).toMatch(/<Calculator\s*\/>/)
    expect(tools).toMatch(/<PdfEditor\s*\/>/)
    expect(tools).toContain("import('@/components/vault/pdf/PdfEditor')")
  })
})
