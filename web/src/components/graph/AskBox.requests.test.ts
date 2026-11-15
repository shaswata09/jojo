import { describe, expect, it } from 'vitest'
import webSource from './AskBox.tsx?raw'

/**
 * Owner request Q109: "Ask the graph" turns a question in words into a graph
 * query, runs it, and the agent answers from the result — on web and phone.
 *
 * The engine (`graph.query`) is tested behaviourally in
 * `service/kg/agent/graph-query.test.ts`. What is pinned here is the wiring
 * both apps' AskBox share, read off source (D20): the box runs the agent with
 * `graph.query` offered, and lifts the settled `graph.query` step's output back
 * onto the canvas. Lose either and the box still renders, still "answers" — just
 * from nothing the graph said.
 */
const mobileSource =
  (
    import.meta.glob('../../../../mobile/src/components/graph/AskBox.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
  )['../../../../mobile/src/components/graph/AskBox.tsx'] ?? ''

describe.each([
  ['web', webSource],
  ['mobile', mobileSource],
])('Q109 — the %s Ask box', (_app, source) => {
  it('is reading a real file', () => {
    expect(source).toContain('export function AskBox')
  })

  it('runs the agent with graph.query among the tools it is offered', () => {
    expect(source).toMatch(/const TOOLS = \[[^\]]*'graph\.query'[^\]]*\] as const/)
    expect(source).toMatch(/useAgent\(\{[\s\S]*?tools: TOOLS,/)
  })

  it('takes the answer from the settled graph.query step', () => {
    expect(source).toMatch(
      /e\.kind === 'step' && e\.step\.name === 'graph\.query' && e\.step\.status === 'done'/,
    )
  })
})
