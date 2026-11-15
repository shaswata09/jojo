import { describe, expect, it } from 'vitest'
import explorerSource from './BenchExplorer.tsx?raw'
import flowSource from './WorkflowFlow.tsx?raw'
import pageSource from './GuideTools.tsx?raw'
import reasoningSource from './ReasoningTables.tsx?raw'

/**
 * Owner requests about the benchmark on the guide's Tools page, pinned on
 * source (D20). The numbers themselves are pinned in `bench-payload.test.ts`
 * and `bench-runs.test.ts`; this pins that the page shows them.
 *
 * Q161 — the page shows benchmark results with diagrams, and an explorer of the
 *   cases grouped by evaluation category.
 * Q222 — picking a case shows its chat input, its ground-truth workflow drawn
 *   with React Flow arrows, and what it expects.
 * Q304 — the results carry time-per-token figures.
 */

describe('Q161 — the Tools page shows the benchmark', () => {
  it('renders the results tables, the diagrams and the explorer', () => {
    for (const tag of ['<ToolBenchTable />', '<ReasoningTables />', '<BenchAxesDiagram />', '<BenchExplorer />']) {
      expect(pageSource, tag).toContain(tag)
    }
  })

  it('groups the explorer’s cases by evaluation category, each with its blurb', () => {
    expect(explorerSource).toMatch(/const BY_GROUP = GROUPS\.map\(\(group\) => \(\{/)
    expect(explorerSource).toContain('CONVERSATIONS.filter((c) => c.group === group)')
    expect(explorerSource).toContain('{GROUP_BLURB[group]}')
  })
})

describe('Q222 — one case, opened', () => {
  it('offers the conversation, its workflow and what it expects', () => {
    expect(explorerSource).toMatch(/const TABS: readonly Tab\[\] = \[[^\]]*'Conversation'[^\]]*'Workflow'[^\]]*'Expected'/)
  })

  it('shows each turn’s chat input', () => {
    expect(explorerSource).toMatch(/selected\.turns\.map\(\(turn, i\) =>[\s\S]*?\{turn\.say\}/)
  })

  it('draws the ground-truth workflow with React Flow', () => {
    expect(explorerSource).toMatch(/tab === 'Workflow' \?[\s\S]*?<WorkflowFlow conversation=\{selected\} \/>/)
    expect(flowSource).toMatch(/from '@xyflow\/react'/)
    expect(flowSource).toMatch(/<ReactFlow\b[\s\S]*?edges=\{edges\}/)
  })

  it('shows the expected outputs', () => {
    expect(explorerSource).toContain("{tab === 'Expected' ? <ExpectedView conversation={selected} /> : null}")
    expect(explorerSource).toContain('{selected.finalState.map((check, i) => (')
  })
})

describe('Q304 — time per token', () => {
  it('prints milliseconds per token and tokens per second for each row', () => {
    expect(reasoningSource).toContain('<th className={TH}>Per token</th>')
    expect(reasoningSource).toMatch(/\{row\.msPerToken\} ms/)
    expect(reasoningSource).toMatch(/\{row\.tokensPerSecond\} tokens\/s/)
  })
})
