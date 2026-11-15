import { describe, expect, it } from 'vitest'
import guideTools from '@/components/guide/GuideTools.tsx?raw'

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
    expect(code).toMatch(/<PageHeader\s+title="The tools"/)
  })

  it('explains the tools with diagrams', () => {
    for (const diagram of ['ToolGateDiagram', 'ToolGraphDiagram']) {
      expect(code).toMatch(new RegExp(`<${diagram} \\/>`))
    }
  })
})

describe('the workflow engine, as the guide explains it (Q202)', () => {
  /** The panel titled "Work that takes several steps", up to the next panel. */
  const panel = (() => {
    const start = code.indexOf('Work that takes several steps')
    return start < 0 ? '' : code.slice(start, code.indexOf('</Panel>', start))
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
