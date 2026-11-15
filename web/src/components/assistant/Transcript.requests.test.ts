import { describe, expect, it } from 'vitest'
import transcriptSource from './Transcript.tsx?raw'
import agentTraceSource from './AgentTrace.tsx?raw'

/**
 * Owner requests about what a conversation shows, pinned on source (D20).
 *
 * Q302 — the model's thinking is shown: a `thought` entry draws a ThoughtRow
 *   that opens to the full text. That the loop emits it, and the thread keeps
 *   it, is pinned in the service (`loop.test.ts`, `use-threads.test.ts`).
 * Q163 — long text wraps inside its bubble rather than overflowing it.
 * Q142 — tool-call arguments and results are pretty-printed JSON.
 */

describe('Q302 — the model’s thinking, on screen', () => {
  it('draws a thought entry as a ThoughtRow carrying its text', () => {
    expect(transcriptSource).toMatch(
      /if \(entry\.kind === 'thought'\) \{\s*return \(\s*<ThoughtRow\b[\s\S]*?text=\{entry\.text\}/,
    )
  })

  it('opens the row to the whole thought', () => {
    const row = transcriptSource.slice(transcriptSource.indexOf('function ThoughtRow'))
    expect(row).toMatch(/\{open \? \(\s*<p\b[\s\S]*?>\s*\{text\}\s*<\/p>/)
  })
})

describe('Q163 — long text stays inside the bubble', () => {
  it('lets the person’s bubble and the answer break anywhere', () => {
    const wraps = transcriptSource.match(/wrap-anywhere whitespace-pre-line text-text-1/g) ?? []
    // The person's bubble and the agent's answer.
    expect(wraps.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Q142 — tool calls read as JSON', () => {
  it('pretty-prints a step’s arguments', () => {
    expect(agentTraceSource).toContain('value={JSON.stringify(step.args, null, 2)}')
  })

  it('pretty-prints a structured result, in a block that keeps the indentation', () => {
    expect(agentTraceSource).toMatch(/<pre\b[^>]*whitespace-pre[^>]*>\s*\{JSON\.stringify\(detail\.value, null, 2\)\}/)
  })
})
