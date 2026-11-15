import { describe, expect, it } from 'vitest'
import controlFlow from '@/components/guide/GuideControlFlow.tsx?raw'
import { GUIDE_PAGE_META } from '@/components/guide/pages'

/**
 * The guide's Control flow graph page (G6). Source reads, because D20 forbids
 * mounting; comments stripped first.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const code = strip(controlFlow)

describe('the Control flow graph page (Q310)', () => {
  it('is named Control flow graph, not FAQ', () => {
    expect(code).toMatch(/<PageHeader\s+title="Control flow graph"/)
    expect(GUIDE_PAGE_META.find((p) => p.id === 'control-flow')?.label).toBe('Control flow graph')
    expect(GUIDE_PAGE_META.some((p) => /faq/i.test(p.label))).toBe(false)
  })

  it('draws the hierarchical code graph and the journey graphs', () => {
    expect(code).toMatch(/<CodeFlowGraph \/>/)
    expect(code).toMatch(/<ControlFlowGraph\b/)
  })
})

describe('paragraphs on the page (Q311)', () => {
  it('use the full width of their container', () => {
    const paragraphs = [...code.matchAll(/<p className="([^"]*)"/g)].map((m) => m[1]!)
    expect(paragraphs.length).toBeGreaterThan(3)
    for (const classes of paragraphs) expect(classes).not.toMatch(/\bmax-w-/)
  })
})
