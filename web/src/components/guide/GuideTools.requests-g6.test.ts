import { describe, expect, it } from 'vitest'
import guideTools from '@/components/guide/GuideTools.tsx?raw'
import en from '@/i18n/locales/en/guideReference.json'

/**
 * The guide's Tools page (G6). Source reads, because D20 forbids mounting;
 * comments stripped so a section marker cannot stand in for the section.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const code = strip(guideTools)

describe('the Tools page (Q148)', () => {
  it('is titled as the tools page', () => {
    // The words live in the catalog; the page reads them by key.
    expect(en.tools.pageTitle).toBe('The tools')
    expect(code).toMatch(/<PageHeader\s+title=\{t\('tools\.pageTitle'\)\}/)
  })

  it('explains the tools with diagrams', () => {
    for (const diagram of ['ToolGateDiagram', 'ToolGraphDiagram']) {
      expect(code).toMatch(new RegExp(`<${diagram} \\/>`))
    }
  })
})

describe('the workflow engine, as the guide explains it (Q202)', () => {
  /**
   * The panel titled "Work that takes several steps": its English words, read
   * from the catalog, and only if the page still renders that panel's title
   * and every one of its paragraphs.
   */
  const panel = (() => {
    const { workflow } = en.tools
    if (workflow.title !== 'Work that takes several steps') return ''
    const start = code.indexOf("t('tools.workflow.title')")
    if (start < 0) return ''
    const jsx = code.slice(start, code.indexOf('</Panel>', start))
    const rendered = ['p1', 'p2', 'p3', 'p4'].every((k) => jsx.includes(`tools.workflow.${k}`))
    return rendered ? Object.values(workflow).join(' ') : ''
  })()

  it('has a section on it', () => {
    expect(panel).not.toBe('')
  })

  it('says how it runs: steps joined by edges, retried one at a time, optional ones skippable, with a cap', () => {
    expect(panel).toMatch(/steps with edges between them/)
    expect(panel).toMatch(/how many times it is worth retrying/)
    expect(panel).toMatch(/never by asking the model/)
    expect(panel).toMatch(/marked\s+optional/)
    expect(panel).toMatch(/hard cap on total steps/)
  })
})
