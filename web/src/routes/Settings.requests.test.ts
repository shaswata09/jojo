import { describe, expect, it } from 'vitest'
import settingsPage from '@/routes/Settings.tsx?raw'
import connections from '@/components/settings/ConnectionsSection.tsx?raw'
import captureExtension from '@/components/settings/CaptureExtensionPanel.tsx?raw'
import dataPanel from '@/components/settings/DataPanel.tsx?raw'
import firstRunChoice from '@/components/common/FirstRunChoice.tsx?raw'

/**
 * The Settings page (G6). Source reads, because D20 forbids mounting; comments
 * stripped so an explanation of a removed field cannot count as the field.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** The page and every panel under it. */
const everything = {
  '/src/routes/Settings.tsx': settingsPage,
  ...(import.meta.glob('/src/components/settings/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
}

const anywhere = (pattern: RegExp) =>
  Object.entries(everything)
    .filter(([, src]) => pattern.test(strip(src)))
    .map(([file]) => file)

describe('what Settings no longer shows', () => {
  it('read the panels, so the empty lists below mean something', () => {
    expect(Object.keys(everything).length).toBeGreaterThan(10)
  })

  it('has no field showing the page’s own address (Q086)', () => {
    expect(anywhere(/location\.href|location\.host\b|label="(?:Page )?(?:URL|Address of this page)"/)).toEqual([])
  })

  it('has no bridge pairing code (Q088)', () => {
    expect(anywhere(/pairing (?:code|token)/i)).toEqual([])
    expect(anywhere(/bridge token|bridgeToken/i)).toEqual([])
  })
})

describe('the Settings layout', () => {
  it('runs the extension paragraph the full width of its card (Q116)', () => {
    const paragraph = /<p className="([^"]*)">\s*A job posting is the one document/.exec(
      strip(captureExtension),
    )
    expect(paragraph).not.toBeNull()
    expect(paragraph![1]).not.toMatch(/\bmax-w-/)
  })

  it('sets the local model and the document reader side by side (Q117)', () => {
    const code = strip(connections)
    expect(code).toMatch(
      /<div className="grid grid-cols-1 [^"]*lg:grid-cols-2">\s*<LocalModelPanel \/>\s*<DocumentReaderPanel \/>/,
    )
    expect(code).not.toMatch(/<DocumentsPanel\b/)
  })

  it('puts Your documents directly after the data panel (Q117)', () => {
    expect(strip(settingsPage)).toMatch(/<DataPanel \/>\s*<DocumentsPanel \/>/)
  })
})

describe('starting empty and loading the demo again (Q073)', () => {
  it('offers Start empty on first run', () => {
    expect(strip(firstRunChoice)).toMatch(/choice: 'empty',\s*icon: \w+,\s*title: 'Start empty'/)
  })

  it('offers the demo data again from Settings → Data', () => {
    expect(strip(dataPanel)).toMatch(/const onLoadDemo = async \(\) => \{\s*if \(!\(await chooseDataSet\('demo'\)\)\) return/)
  })
})
