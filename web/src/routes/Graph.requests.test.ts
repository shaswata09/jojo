import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import graphSource from './Graph.tsx?raw'
import queryPanelSource from '../components/graph/QueryPanel.tsx?raw'

/**
 * Owner requests about the knowledge graph page, pinned on its source (D20: no
 * mounting).
 *
 * Q059 — `/graph` draws the graph and, on the same page, the query view where a
 *   question can be built or asked in words.
 * Q246 — the preview has a Reorganize button that re-lays the same records out.
 *   `force.test.ts` pins that a new seed gives a different arrangement; what is
 *   pinned here is that the button is the thing that hands the canvas one.
 */

/** The JSX of one element, from its opening tag to the end of that tag. */
const tagOf = (source: string, name: string) =>
  new RegExp(`<${name}\\b[\\s\\S]*?\\/>`).exec(source)?.[0] ?? ''

describe('Q059 — the graph page', () => {
  it('is routed at graph and renders the Graph page', () => {
    expect(appSource).toMatch(/path="graph"[\s\S]{0,200}<Graph \/>/)
  })

  it('draws the graph canvas and the query panel together', () => {
    expect(tagOf(graphSource, 'GraphCanvas')).not.toBe('')
    expect(tagOf(graphSource, 'QueryPanel')).toContain('onAsk={onAsk}')
  })

  it('puts the ask-in-words box inside the query panel', () => {
    expect(queryPanelSource).toMatch(/<AskBox\b[^>]*onAnswer=\{onAsk\}/)
  })
})

describe('Q246 — reorganising the preview', () => {
  /** The `<Button …>…</Button>` whose label is the given word. */
  const buttonLabelled = (label: string) =>
    new RegExp(`<Button\\b(?:(?!<\\/Button>)[\\s\\S])*?${label}\\s*<\\/Button>`).exec(graphSource)?.[0] ?? ''

  it('has a Reorganize button that moves the layout seed on', () => {
    const button = buttonLabelled('Reorganize')
    expect(button).not.toBe('')
    expect(button).toMatch(/onClick=\{\(\) => setLayoutSeed\(\(seed\) => seed \+ 1\)\}/)
  })

  it('hands that seed to the canvas', () => {
    expect(tagOf(graphSource, 'GraphCanvas')).toContain('layoutSeed={layoutSeed}')
  })
})
